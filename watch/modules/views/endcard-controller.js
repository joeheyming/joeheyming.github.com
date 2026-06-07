/**
 * End-of-episode card controller for the watch view.
 *
 * Owns: the end-card overlay DOM, the 8-second autoplay countdown
 * timer, the Replay / Share / Back / Play-next button handlers, and
 * the `<video>` `ended` listener that triggers everything.
 *
 * The orchestrator (watch-view.js `mount()`) supplies three callbacks
 * that keep policy decisions outside the controller:
 *
 *   - `resolveNext()`     - "what plays after the current episode?"
 *                          encodes shuffle vs sequential vs movie.
 *   - `shouldAutoplay()`  - "should the countdown start?" - reads
 *                          `prefs.autoplayNext`.
 *   - `onAdvance(ep)`     - "the user (or countdown) picked this
 *                          episode" - mount calls loadEpisode.
 *
 * Why a controller and not free functions on `mount()`:
 * the end-card has its own lifecycle (autoplay timer with backdrop-
 * click cancel, dynamic next-thumb image with fallback, hide on
 * every loadEpisode entry). Bundling the timer + DOM repaint + four
 * button handlers into one object means mount only has to call
 * `hide()` on episode change and `dispose()` on teardown.
 */

import { pad } from '../ui.js';

/** @typedef {import('../shows.js').ShowConfig} ShowConfig */
/** @typedef {import('../movies.js').MovieConfig} MovieConfig */
/** @typedef {import('../catalog.js').Episode} Episode */

/**
 * @typedef {Object} EndCardControllerDom
 * @property {HTMLElement} endCard Backdrop + content wrapper.
 * @property {HTMLElement} endThumb
 * @property {HTMLElement} endTitle
 * @property {HTMLElement} endSub
 * @property {HTMLElement} endEyebrow
 * @property {HTMLButtonElement} endPlayBtn
 * @property {HTMLButtonElement} endReplayBtn
 * @property {HTMLButtonElement} endShareBtn
 * @property {HTMLButtonElement} endBackBtn
 * @property {HTMLElement} endCountdown
 */

/**
 * @typedef {Object} EndCardControllerDeps
 * @property {HTMLVideoElement} video Listened to for `ended`; replayed on Replay.
 * @property {ShowConfig | MovieConfig} show Read: `name`, `shortName`, `emoji`,
 *   and `kind` (movies omit the "browse other shows" copy in the
 *   no-next branch).
 * @property {EndCardControllerDom} dom DOM nodes built by mount().
 * @property {(msg: string) => void} flash Marquee toast helper (for share result).
 * @property {() => Episode | null} resolveNext
 *   Strategy for the "Up next" pick. Mount supplies this as a closure
 *   over the live current episode + the shuffle decision.
 * @property {() => boolean} shouldAutoplay Reads `prefs.autoplayNext`.
 * @property {(ep: Episode) => void} onAdvance Mount's loadEpisode.
 * @property {() => void} onNavigateBack Mount's navigate-to-show.
 * @property {() => Promise<boolean>} shareCurrent Share the currently-playing episode.
 */

/**
 * @param {EndCardControllerDeps} deps
 * @returns {{ hide: () => void, dispose: () => void }}
 */
export function createEndCardController(deps) {
  const {
    video,
    show,
    dom,
    flash,
    resolveNext,
    shouldAutoplay,
    onAdvance,
    onNavigateBack,
    shareCurrent
  } = deps;
  const {
    endCard,
    endThumb,
    endTitle,
    endSub,
    endEyebrow,
    endPlayBtn,
    endReplayBtn,
    endShareBtn,
    endBackBtn,
    endCountdown
  } = dom;

  /** @type {number | null} */
  let countdownTimer = null;
  /** @type {Episode | null} */
  let pendingNext = null;

  function cancelCountdown() {
    if (countdownTimer != null) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
  }

  function hide() {
    cancelCountdown();
    endCard.classList.add('hidden');
    endCountdown.classList.add('hidden');
    pendingNext = null;
  }

  function paintNextThumb(next) {
    endThumb.replaceChildren();
    endThumb.classList.remove('is-empty');
    if (next && next.image) {
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.decoding = 'async';
      img.alt = '';
      img.src = next.image;
      // Fall back to the show emoji if the TVMaze still fails — we
      // explicitly don't fall back to archive.org's auto-thumbs.
      img.addEventListener(
        'error',
        () => {
          img.remove();
          endThumb.classList.add('is-empty');
          endThumb.textContent = show.emoji || '📺';
        },
        { once: true }
      );
      endThumb.appendChild(img);
    } else {
      endThumb.classList.add('is-empty');
      endThumb.textContent = show.emoji || '📺';
    }
  }

  function showCard() {
    const next = resolveNext();
    pendingNext = next;

    paintNextThumb(next);

    if (next) {
      endEyebrow.textContent = 'Up next';
      endPlayBtn.classList.remove('hidden');
      endTitle.textContent = next.title || `Episode ${next.episode}`;
      endSub.textContent =
        next.season === 0
          ? 'Special'
          : `${show.shortName} · S${pad(next.season)}E${pad(next.episode)}`;
    } else {
      // No next entry — series ran out, or this was a movie / special
      // (resolveNext returns null for season 0). Movies get an
      // "all done" sub that doesn't pretend they were watching one of
      // many episodes; series get the regular "browse other shows"
      // copy.
      const isMovie = /** @type {any} */ (show).kind === 'movie';
      endEyebrow.textContent = isMovie ? 'Movie ended' : 'Episode ended';
      endPlayBtn.classList.add('hidden');
      endTitle.textContent = isMovie ? 'Roll credits.' : "That's the last one on the shelf.";
      endSub.textContent = isMovie
        ? `${show.name} — replay, share, or browse the catalog.`
        : `${show.name} — replay, share, or browse other shows.`;
    }

    endCard.classList.remove('hidden');

    if (next && shouldAutoplay()) {
      let remaining = 8;
      endCountdown.textContent = `Playing in ${remaining}s — tap outside to cancel.`;
      endCountdown.classList.remove('hidden');
      countdownTimer = setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
          const target = pendingNext;
          cancelCountdown();
          endCountdown.classList.add('hidden');
          endCard.classList.add('hidden');
          pendingNext = null;
          if (target) onAdvance(target);
        } else {
          endCountdown.textContent = `Playing in ${remaining}s — tap outside to cancel.`;
        }
      }, 1000);
    } else {
      endCountdown.classList.add('hidden');
    }
  }

  // ---- Event wiring ---------------------------------------------------

  function onEnded() {
    showCard();
  }

  function onPlayNext() {
    const target = pendingNext;
    hide();
    if (target) onAdvance(target);
  }

  function onReplay() {
    hide();
    try {
      video.currentTime = 0;
      const p = video.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      /* ignore */
    }
  }

  async function onShare() {
    const ok = await shareCurrent();
    flash(ok ? 'SHARED' : 'SHARE FAILED');
  }

  function onBack() {
    hide();
    onNavigateBack();
  }

  // Clicking the backdrop (outside the inner card) cancels the
  // countdown but leaves the card visible so the user can still
  // pick Replay / Share / Back.
  function onBackdropClick(e) {
    if (e.target === endCard && countdownTimer != null) {
      cancelCountdown();
      endCountdown.textContent = 'Autoplay cancelled — pick something.';
      endCountdown.classList.remove('hidden');
    }
  }

  video.addEventListener('ended', onEnded);
  endPlayBtn.addEventListener('click', onPlayNext);
  endReplayBtn.addEventListener('click', onReplay);
  endShareBtn.addEventListener('click', onShare);
  endBackBtn.addEventListener('click', onBack);
  endCard.addEventListener('click', onBackdropClick);

  return {
    hide,
    dispose() {
      cancelCountdown();
      video.removeEventListener('ended', onEnded);
      endPlayBtn.removeEventListener('click', onPlayNext);
      endReplayBtn.removeEventListener('click', onReplay);
      endShareBtn.removeEventListener('click', onShare);
      endBackBtn.removeEventListener('click', onBack);
      endCard.removeEventListener('click', onBackdropClick);
      endCard.classList.add('hidden');
    }
  };
}

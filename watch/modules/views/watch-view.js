/**
 * Watch view — the actual TV player for a specific episode.
 *
 * Loads the merged catalog for the active show, finds the episode at
 * `(s, e)`, and renders the TV chassis + <video> + marquee + summary
 * + remote-control row. Prev / Next / Shuffle stay in this view and
 * use `history.replaceState` so the URL tracks the active episode
 * without polluting history with one entry per skip.
 *
 * "Up next" strip below the player surfaces the next 4 episodes in
 * the same season so adjacent navigation isn't a round-trip through
 * the episodes view. The full season + show grid live in the other
 * views.
 *
 * On `<video>` end with autoplay on, the view skips to the next
 * episode in the same season (wrapping); the breadcrumb + URL update
 * to match.
 *
 * Structure: this view is the orchestrator. It builds the DOM, loads
 * the catalog, owns the `current` episode, and routes events to
 * three sibling controllers that own their own UI lifecycles:
 *
 *   - SubtitleController       (CC button + language menu + sync slider + <track>)
 *   - OfflineSaveController    (Save button + IDB + AbortController + blob URL)
 *   - EndCardController        (autoplay-next overlay + countdown timer)
 *
 * Each controller exposes `setEpisode` (or `hide` for end-card) +
 * `dispose`; loadEpisode and unmount fan out to them.
 */

import { getMergedCatalog, getNextEpisode } from '../catalog.js';
import { createMarquee, createSummaryCard, describeEpisode, copyToClipboard, pad } from '../ui.js';
import { loadPrefs, savePrefs, saveLastEpisode } from '../prefs.js';
import { createSubtitleController } from './subtitle-controller.js';
import { createOfflineSaveController } from './offline-save-controller.js';
import { createEndCardController } from './endcard-controller.js';

/** @typedef {import('../shows.js').ShowConfig} ShowConfig */
/** @typedef {import('../catalog.js').Catalog} Catalog */
/** @typedef {import('../catalog.js').Episode} Episode */

/**
 * @typedef {Object} MountCtx
 * @property {ShowConfig} show
 * @property {number} initialSeason
 * @property {number} initialEpisode
 * @property {(params: { show?: string, s?: number, e?: number }) => void} navigate
 * @property {(label: string) => void} setBreadcrumbTitle
 *   The router hands us a setter so the breadcrumb's "current page"
 *   crumb stays in sync as the user steps Prev / Next.
 */

/**
 * @param {HTMLElement} slot
 * @param {MountCtx} ctx
 * @returns {Promise<{ unmount: () => void, jumpTo?: (s: number, e: number) => void }>}
 */
export async function mount(slot, ctx) {
  const { show, navigate, setBreadcrumbTitle } = ctx;
  const prefs = loadPrefs();

  /** @type {Catalog | null} */
  let catalog = null;
  /** @type {Episode | null} */
  let current = null;

  // ---- DOM -----------------------------------------------------------
  const root = document.createElement('section');
  root.className = 'tv-player';

  // TV chassis
  const setEl = document.createElement('div');
  setEl.className = 'tv-set';
  const bezel = document.createElement('div');
  bezel.className = 'tv-bezel';
  bezel.style.setProperty('--show-accent', show.accent);

  const bezelLabel = document.createElement('div');
  bezelLabel.className = 'tv-bezel-label';
  const bezelBrand = document.createElement('span');
  bezelBrand.textContent = 'FLATRON · ULTRA HD';
  const channelChip = document.createElement('span');
  channelChip.className = 'tv-channel-chip';
  channelChip.textContent = '—';
  bezelLabel.appendChild(bezelBrand);
  bezelLabel.appendChild(channelChip);

  const screen = document.createElement('div');
  screen.className = 'tv-screen';
  const video = document.createElement('video');
  video.id = 'tv-video';
  video.className = 'tv-video';
  video.controls = true;
  video.playsInline = true;
  video.preload = 'metadata';
  const loadingOverlay = document.createElement('div');
  loadingOverlay.className = 'tv-overlay';
  loadingOverlay.setAttribute('role', 'status');
  loadingOverlay.innerHTML =
    '<p class="tv-overlay-title">TUNING</p><p class="tv-overlay-detail">Pulling the channel guide…</p>';
  const noSignalOverlay = document.createElement('div');
  noSignalOverlay.className = 'tv-overlay hidden';
  noSignalOverlay.setAttribute('role', 'alert');
  noSignalOverlay.innerHTML =
    '<p class="tv-overlay-title">NO SIGNAL</p><p class="tv-overlay-detail">Channel is off the air. Try reloading later.</p>';
  const errorBanner = document.createElement('div');
  errorBanner.className = 'tv-error hidden';
  errorBanner.setAttribute('role', 'alert');
  const errorMsg = document.createElement('p');
  errorMsg.textContent = 'This episode failed to load. The source may be temporarily offline.';
  const errorLink = document.createElement('a');
  errorLink.className = 'tv-error-link';
  errorLink.target = '_blank';
  errorLink.rel = 'noopener';
  errorLink.href = `https://archive.org/details/${show.iaItem}`;
  errorLink.textContent = '⇪ Open on archive.org';
  errorBanner.appendChild(errorMsg);
  errorBanner.appendChild(errorLink);

  // End-of-episode "Up next" card. Built here so the chassis layout
  // stays in one place; the EndCardController owns its behavior and
  // visibility, populated lazily when the video ends.
  const endCard = document.createElement('div');
  endCard.className = 'tv-endcard hidden';
  endCard.setAttribute('role', 'dialog');
  endCard.setAttribute('aria-label', 'Episode ended');
  const endInner = document.createElement('div');
  endInner.className = 'tv-endcard-inner';
  const endEyebrow = document.createElement('p');
  endEyebrow.className = 'tv-endcard-eyebrow';
  endEyebrow.textContent = 'Up next';
  const endThumb = document.createElement('div');
  endThumb.className = 'tv-endcard-thumb';
  const endMeta = document.createElement('div');
  endMeta.className = 'tv-endcard-meta';
  const endTitle = document.createElement('h3');
  endTitle.className = 'tv-endcard-title';
  const endSub = document.createElement('p');
  endSub.className = 'tv-endcard-sub';
  endMeta.appendChild(endTitle);
  endMeta.appendChild(endSub);
  const endCountdown = document.createElement('p');
  endCountdown.className = 'tv-endcard-countdown hidden';
  const endActions = document.createElement('div');
  endActions.className = 'tv-endcard-actions';
  const endPlayBtn = mkBtn('▶ Play next', 'tv-endcard-btn tv-endcard-btn--primary');
  const endReplayBtn = mkBtn('↻ Replay', 'tv-endcard-btn');
  const endShareBtn = mkBtn('📤 Share', 'tv-endcard-btn');
  const endBackBtn = mkBtn('← All episodes', 'tv-endcard-btn');
  endActions.appendChild(endPlayBtn);
  endActions.appendChild(endReplayBtn);
  endActions.appendChild(endShareBtn);
  endActions.appendChild(endBackBtn);
  endInner.appendChild(endEyebrow);
  endInner.appendChild(endThumb);
  endInner.appendChild(endMeta);
  endInner.appendChild(endCountdown);
  endInner.appendChild(endActions);
  endCard.appendChild(endInner);

  screen.appendChild(video);
  screen.appendChild(loadingOverlay);
  screen.appendChild(noSignalOverlay);
  screen.appendChild(errorBanner);
  screen.appendChild(endCard);

  const base = document.createElement('div');
  base.className = 'tv-base';
  const stand = document.createElement('div');
  stand.className = 'tv-stand';
  base.appendChild(stand);

  bezel.appendChild(bezelLabel);
  bezel.appendChild(screen);
  bezel.appendChild(base);
  setEl.appendChild(bezel);

  const marquee = createMarquee();
  const summary = createSummaryCard();

  // Controls row
  const controls = document.createElement('div');
  controls.className = 'tv-controls';
  const prevBtn = mkBtn('◀ Prev', 'tv-btn');
  const back10Btn = mkBtn('⏪ 10s', 'tv-btn tv-btn--seek');
  back10Btn.title = 'Skip back 10 seconds (J)';
  back10Btn.setAttribute('aria-label', 'Skip back 10 seconds');
  const fwd10Btn = mkBtn('10s ⏩', 'tv-btn tv-btn--seek');
  fwd10Btn.title = 'Skip forward 10 seconds (L)';
  fwd10Btn.setAttribute('aria-label', 'Skip forward 10 seconds');
  const nextBtn = mkBtn('Next ▶', 'tv-btn');
  const autoplayLabel = document.createElement('label');
  autoplayLabel.className = 'tv-toggle';
  const autoplayInput = document.createElement('input');
  autoplayInput.type = 'checkbox';
  autoplayInput.checked = prefs.autoplayNext;
  const autoplaySpan = document.createElement('span');
  autoplaySpan.textContent = 'Autoplay next';
  autoplayLabel.appendChild(autoplayInput);
  autoplayLabel.appendChild(autoplaySpan);

  // Shuffle is a *mode* (mp3-player style), not a "shuffle now" button —
  // clicking it doesn't load a new episode. It just flips Next/Prev and
  // the end-card autoplay path to pick a random episode from the show's
  // numbered seasons. Persisted across episodes via prefs.
  const shuffleLabel = document.createElement('label');
  shuffleLabel.className = 'tv-toggle';
  shuffleLabel.title = 'Shuffle: Next / Previous pick a random episode';
  const shuffleInput = document.createElement('input');
  shuffleInput.type = 'checkbox';
  shuffleInput.checked = prefs.shuffle;
  const shuffleSpan = document.createElement('span');
  shuffleSpan.textContent = '⇄ Shuffle';
  shuffleLabel.appendChild(shuffleInput);
  shuffleLabel.appendChild(shuffleSpan);
  const copyLinkBtn = mkBtn('⌘ Copy link', 'tv-btn tv-btn--ghost');
  const copyTitleBtn = mkBtn('✎ Copy title', 'tv-btn tv-btn--ghost');

  // "Save offline" button. The label encodes three states (idle /
  // downloading / saved) via classes + textContent — separate buttons
  // would have been cleaner but worse for muscle memory: users expect
  // one slot in the row that toggles between "save" and "remove".
  const saveBtn = mkBtn('💾 Save offline', 'tv-btn tv-btn--ghost tv-save-btn');
  saveBtn.title = 'Download this episode for offline playback';

  // CC button + lazy language menu. Only rendered when the show has
  // an IMDb id (Stremio's addon needs one to look up subtitles).
  const subsWrap = document.createElement('div');
  subsWrap.className = 'tv-subs-wrap';
  const subsBtn = mkBtn('CC', 'tv-btn tv-btn--ghost tv-subs-btn');
  subsBtn.setAttribute('aria-haspopup', 'menu');
  subsBtn.setAttribute('aria-expanded', 'false');
  subsBtn.title = 'Subtitles';
  const subsMenu = document.createElement('div');
  subsMenu.className = 'tv-subs-menu hidden';
  subsMenu.setAttribute('role', 'menu');
  subsWrap.appendChild(subsBtn);
  subsWrap.appendChild(subsMenu);

  // Subtitle sync slider — only visible while a track is active.
  // A range input with directional labels removes the +/- guesswork:
  // the user drags toward "Earlier" if dialogue happens before subs
  // appear, or "Later" if subs flash before they hear words. Live
  // preview means they can just feel their way to alignment without
  // knowing the sign.
  const subsSyncWrap = document.createElement('div');
  subsSyncWrap.className = 'tv-subs-sync hidden';
  subsSyncWrap.setAttribute('role', 'group');
  subsSyncWrap.setAttribute('aria-label', 'Subtitle sync');
  const subsSyncHint = document.createElement('span');
  subsSyncHint.className = 'tv-subs-sync-hint tv-subs-sync-hint--left';
  subsSyncHint.textContent = '⏪ Earlier';
  const subsSyncSlider = document.createElement('input');
  subsSyncSlider.type = 'range';
  subsSyncSlider.min = '-10';
  subsSyncSlider.max = '10';
  subsSyncSlider.step = '0.5';
  subsSyncSlider.value = '0';
  subsSyncSlider.className = 'tv-subs-sync-slider';
  subsSyncSlider.setAttribute('aria-label', 'Subtitle delay in seconds');
  subsSyncSlider.title =
    'Drag toward Earlier if dialogue happens before subtitles appear, or Later if subtitles flash before you hear the words.';
  const subsSyncHintRight = document.createElement('span');
  subsSyncHintRight.className = 'tv-subs-sync-hint tv-subs-sync-hint--right';
  subsSyncHintRight.textContent = 'Later ⏩';
  const subsSyncReadout = document.createElement('button');
  subsSyncReadout.type = 'button';
  subsSyncReadout.className = 'tv-subs-sync-readout';
  subsSyncReadout.textContent = '0.0s';
  subsSyncReadout.title = 'Reset subtitle delay to zero';
  subsSyncReadout.setAttribute('aria-label', 'Reset subtitle delay');
  subsSyncWrap.appendChild(subsSyncHint);
  subsSyncWrap.appendChild(subsSyncSlider);
  subsSyncWrap.appendChild(subsSyncHintRight);
  subsSyncWrap.appendChild(subsSyncReadout);

  controls.appendChild(prevBtn);
  controls.appendChild(back10Btn);
  controls.appendChild(fwd10Btn);
  controls.appendChild(nextBtn);
  if (show.imdbId) {
    controls.appendChild(subsWrap);
    controls.appendChild(subsSyncWrap);
  }
  controls.appendChild(saveBtn);
  controls.appendChild(autoplayLabel);
  controls.appendChild(shuffleLabel);
  controls.appendChild(copyLinkBtn);
  controls.appendChild(copyTitleBtn);

  // Up-next strip — populated after catalog loads
  const upNextSection = document.createElement('div');
  upNextSection.className = 'tv-section hidden';
  const upNextLabel = document.createElement('div');
  upNextLabel.className = 'tv-section-label';
  upNextLabel.textContent = 'Up next this season';
  const upNextRow = document.createElement('div');
  upNextRow.className = 'tv-upnext-row';
  upNextSection.appendChild(upNextLabel);
  upNextSection.appendChild(upNextRow);

  // "All episodes" link to bounce back to the episode browser.
  const allEpsLink = document.createElement('a');
  allEpsLink.className = 'tv-all-eps-link';
  allEpsLink.href = `?show=${encodeURIComponent(show.id)}`;
  allEpsLink.textContent = `All episodes of ${show.name} →`;
  allEpsLink.addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
    e.preventDefault();
    navigate({ show: show.id });
  });

  const help = document.createElement('div');
  help.className = 'tv-help';
  help.innerHTML =
    '<kbd>◀</kbd><kbd>▶</kbd> prev / next · <kbd>J</kbd><kbd>L</kbd> ±10s · <kbd>R</kbd> toggle shuffle · <kbd>Space</kbd> play';

  root.appendChild(setEl);
  root.appendChild(marquee.root);
  root.appendChild(summary.root);
  root.appendChild(controls);
  root.appendChild(upNextSection);
  root.appendChild(allEpsLink);
  root.appendChild(help);
  slot.appendChild(root);

  // ---- Behaviour -----------------------------------------------------
  /** @param {string} text @param {string} klass */
  function mkBtn(text, klass) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = klass;
    b.textContent = text;
    return b;
  }

  try {
    catalog = await getMergedCatalog(show);
  } catch (err) {
    loadingOverlay.classList.add('hidden');
    noSignalOverlay.classList.remove('hidden');
    const detail = noSignalOverlay.querySelector('.tv-overlay-detail');
    if (detail) {
      const msg = err && /** @type {Error} */ (err).message;
      detail.textContent = `Could not reach the Internet Archive — ${msg || 'unknown error'}`;
    }
    return { unmount: () => root.remove() };
  }

  loadingOverlay.classList.add('hidden');
  if (!catalog || catalog.total === 0) {
    noSignalOverlay.classList.remove('hidden');
    return { unmount: () => root.remove() };
  }

  // Find the requested episode. The URL is the source of truth on
  // mount — we do NOT silently substitute a different episode here.
  // The previous behavior of falling through to a random pick when
  // findEpisode returned null meant that refreshing a URL pointing
  // at a slot the catalog can't find (e.g. a parser mismatch on a
  // single file) yanked the user to a different episode and rewrote
  // the URL, which reads as a bug.
  const initial = findEpisode(catalog, ctx.initialSeason, ctx.initialEpisode);
  if (!initial) {
    noSignalOverlay.classList.remove('hidden');
    const detail = noSignalOverlay.querySelector('.tv-overlay-detail');
    if (detail) {
      const slot =
        ctx.initialSeason === 0
          ? 'this special'
          : `S${pad(ctx.initialSeason)}E${pad(ctx.initialEpisode)}`;
      detail.textContent = '';
      const head = document.createElement('span');
      head.textContent = `Episode ${slot} isn't on this channel — pick another from `;
      const link = document.createElement('a');
      link.href = `?show=${encodeURIComponent(show.id)}`;
      link.textContent = `${show.name} episodes`;
      link.addEventListener('click', (e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
        e.preventDefault();
        ctx.navigate({ show: show.id });
      });
      const tail = document.createElement('span');
      tail.textContent = '.';
      detail.appendChild(head);
      detail.appendChild(link);
      detail.appendChild(tail);
    }
    return { unmount: () => root.remove() };
  }

  // ---- Controllers ----------------------------------------------------
  // Each owns its own DOM region + state + event lifecycle. Mount
  // routes episode changes via setEpisode / hide and teardown via
  // dispose.
  const subtitleCtrl = createSubtitleController({
    video,
    show,
    prefs,
    savePrefs,
    flash: (msg) => marquee.flash(msg),
    dom: { subsBtn, subsMenu, subsWrap, subsSyncWrap, subsSyncSlider, subsSyncReadout }
  });

  const offlineCtrl = createOfflineSaveController({
    video,
    show,
    saveBtn,
    flash: (msg) => marquee.flash(msg)
  });

  const endcardCtrl = createEndCardController({
    video,
    show,
    dom: {
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
    },
    flash: (msg) => marquee.flash(msg),
    // "What plays next?" — shuffle picks across all numbered seasons;
    // sequential crosses season boundaries (unlike manual Prev/Next
    // which wraps within the current season).
    resolveNext: () => {
      if (!catalog || !current) return null;
      return prefs.shuffle ? shufflePick(catalog, current) : getNextEpisode(catalog, current);
    },
    shouldAutoplay: () => prefs.autoplayNext,
    onAdvance: (ep) => loadEpisode(ep),
    onNavigateBack: () => navigate({ show: show.id }),
    shareCurrent: async () => (current ? shareEpisode(show, current) : false)
  });

  await offlineCtrl.hydrate();

  loadEpisode(initial, { autoplay: false });

  // ---- Event wiring -------------------------------------------------
  prevBtn.addEventListener('click', () => stepEpisode(-1));
  nextBtn.addEventListener('click', () => stepEpisode(1));
  back10Btn.addEventListener('click', () => seekRelative(-10));
  fwd10Btn.addEventListener('click', () => seekRelative(10));

  autoplayInput.addEventListener('change', () => {
    prefs.autoplayNext = autoplayInput.checked;
    savePrefs(prefs);
  });
  shuffleInput.addEventListener('change', () => {
    prefs.shuffle = shuffleInput.checked;
    savePrefs(prefs);
    marquee.flash(prefs.shuffle ? 'SHUFFLE ON' : 'SHUFFLE OFF');
  });
  copyLinkBtn.addEventListener('click', () =>
    copyToClipboard(location.href, marquee, 'LINK COPIED', 'COPY FAILED')
  );
  copyTitleBtn.addEventListener('click', () =>
    copyToClipboard(describeEpisode(show, current), marquee, 'TITLE COPIED', 'COPY FAILED')
  );

  video.addEventListener('error', () => {
    errorBanner.classList.remove('hidden');
  });

  const keydown = (e) => {
    if (e.target instanceof HTMLElement) {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
    }
    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        stepEpisode(-1);
        break;
      case 'ArrowRight':
        e.preventDefault();
        stepEpisode(1);
        break;
      // YouTube-style ±10s seek. Arrow keys are already claimed for
      // episode navigation; J/L is the next-best convention and what
      // people who watch a lot of video on the web reach for.
      case 'j':
      case 'J':
        e.preventDefault();
        seekRelative(-10);
        break;
      case 'l':
      case 'L':
        e.preventDefault();
        seekRelative(10);
        break;
      case 'r':
      case 'R':
        e.preventDefault();
        // R now toggles the shuffle *mode* (mp3-player style) instead
        // of doing a one-shot random jump. Click the checkbox so the
        // change handler does the save + marquee flash for us.
        shuffleInput.checked = !shuffleInput.checked;
        shuffleInput.dispatchEvent(new Event('change'));
        break;
    }
  };
  document.addEventListener('keydown', keydown);

  // Media Session integration so OS-level / Bluetooth media keys drive
  // the player. Best-effort; some browsers reject specific actions.
  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.setActionHandler('play', togglePlay);
      navigator.mediaSession.setActionHandler('pause', togglePlay);
      navigator.mediaSession.setActionHandler('nexttrack', () => stepEpisode(1));
      navigator.mediaSession.setActionHandler('previoustrack', () => stepEpisode(-1));
      navigator.mediaSession.setActionHandler('seekforward', (d) =>
        seekRelative(d?.seekOffset || 10)
      );
      navigator.mediaSession.setActionHandler('seekbackward', (d) =>
        seekRelative(-(d?.seekOffset || 10))
      );
    } catch {
      /* ignore */
    }
  }

  // Expose currentEpisodeData for analytics + share-button.
  Object.defineProperty(window, 'currentEpisodeData', {
    get() {
      return current
        ? {
            url: location.href,
            title: describeEpisode(show, current),
            episode: current,
            show: show.id
          }
        : null;
    },
    configurable: true
  });

  const shareBtn = document.querySelector('share-button');
  if (shareBtn) {
    /** @type {any} */ (shareBtn).textGenerator = () => {
      if (!current) return `${show.name} on Watch`;
      return `Watching ${describeEpisode(show, current)} on Watch — ${location.href}`;
    };
  }

  return {
    unmount() {
      document.removeEventListener('keydown', keydown);
      // Tear down each controller in turn — they each handle their
      // own listeners + blob URLs + timers.
      subtitleCtrl.dispose();
      offlineCtrl.dispose();
      endcardCtrl.dispose();
      try {
        // Stop playback before tearing down — otherwise Safari can keep
        // streaming the file in the background after the element is gone.
        video.pause();
        video.removeAttribute('src');
        video.load();
      } catch {
        /* ignore */
      }
      // Detach the analytics/share hook so it doesn't keep reporting a
      // stale episode after the user has navigated to another view.
      try {
        Object.defineProperty(window, 'currentEpisodeData', {
          value: null,
          writable: true,
          configurable: true
        });
      } catch {
        /* ignore */
      }
      root.remove();
    },
    /**
     * Hot-update the active episode without re-mounting. Called by the
     * router when only `s`/`e` changes (e.g. browser back to a
     * previous episode within the same show).
     */
    jumpTo(s, e) {
      if (!catalog) return;
      const ep = findEpisode(catalog, s, e);
      if (ep) loadEpisode(ep, { autoplay: false, urlSync: false });
    }
  };

  // ---- Local helpers -------------------------------------------------

  /**
   * @param {Episode} ep
   * @param {{ autoplay?: boolean, urlSync?: boolean }} [opts]
   */
  function loadEpisode(ep, opts = {}) {
    const autoplay = opts.autoplay !== false;
    const urlSync = opts.urlSync !== false;
    current = ep;

    // Loading a new episode hides any leftover end-card. Important
    // for both autoplay and manual Prev/Next transitions.
    endcardCtrl.hide();

    marquee.update(show, ep);
    summary.update(ep);
    channelChip.textContent =
      ep.season === 0
        ? show.movieDetector
          ? 'MOV'
          : 'SPC'
        : `S${pad(ep.season)}E${pad(ep.episode)}`;
    errorLink.href = ep.archiveUrl;
    errorBanner.classList.add('hidden');
    setBreadcrumbTitle(crumbLabelFor(ep));
    renderUpNext(ep);

    if (urlSync) updateDeepLink(ep);
    saveLastEpisode(show.id, ep.season, ep.episode);

    // Network URL is the safe default. The offline controller swaps
    // to a Blob URL inside setEpisode() when the episode is cached;
    // the swap is fire-and-forget so we never block initial src
    // assignment on an IDB round-trip.
    if (video.src !== ep.url) {
      video.src = ep.url;
      // Poster is the TVMaze still when available; we don't fall back
      // to archive.org's `.thumbs/` JPGs because the CDN sometimes
      // 403s those and a missing poster reads better than a broken one.
      video.poster = ep.image || '';
    }
    video.load();
    if (autoplay) {
      const p = video.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }

    // Fan out the episode change to controllers. Each handles its
    // own concern: subtitles auto-loads the saved language; offline
    // swaps to a Blob URL if cached and repaints the save button.
    offlineCtrl.setEpisode(ep, { autoplay });
    subtitleCtrl.setEpisode(ep);
  }

  /** @param {1 | -1} delta */
  function stepEpisode(delta) {
    if (!catalog || !current) return;
    if (prefs.shuffle) {
      // Shuffle mode: ignore `delta` direction and pull a random
      // episode from the full numbered-season pool. mp3 players don't
      // distinguish next/prev under shuffle either — both jump.
      const next = shufflePick(catalog, current);
      if (next) loadEpisode(next);
      return;
    }
    if (current.season === 0) return;
    const season = catalog.seasons.find((s) => s.number === current.season);
    if (!season || season.episodes.length === 0) return;
    const idx = season.episodes.findIndex(
      (x) => x.episode === current.episode && x.season === current.season
    );
    const len = season.episodes.length;
    const next = (((idx + delta) % len) + len) % len;
    loadEpisode(season.episodes[next]);
  }

  function togglePlay() {
    if (video.paused || video.ended) {
      const p = video.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } else {
      video.pause();
    }
  }

  /** @param {number} seconds */
  function seekRelative(seconds) {
    if (!Number.isFinite(video.duration)) return;
    const next = Math.max(0, Math.min(video.duration, video.currentTime + seconds));
    video.currentTime = next;
  }

  /**
   * Replace the URL with the active episode without pushing a history
   * entry. Stepping through 30 episodes shouldn't bury the browser
   * back button under 30 back presses.
   *
   * @param {Episode} ep
   */
  function updateDeepLink(ep) {
    const params = new URLSearchParams();
    params.set('show', show.id);
    params.set('s', String(ep.season));
    params.set('e', String(ep.episode));
    history.replaceState(null, '', `${location.pathname}?${params.toString()}`);
  }

  /** @param {Episode} ep */
  function renderUpNext(ep) {
    if (!catalog) return;
    if (ep.season === 0) {
      upNextSection.classList.add('hidden');
      return;
    }
    const season = catalog.seasons.find((s) => s.number === ep.season);
    if (!season || season.episodes.length <= 1) {
      upNextSection.classList.add('hidden');
      return;
    }
    upNextSection.classList.remove('hidden');
    const idx = season.episodes.findIndex(
      (x) => x.episode === ep.episode && x.season === ep.season
    );
    const list = [];
    for (let i = 1; i <= 4; i += 1) {
      const j = (idx + i) % season.episodes.length;
      if (j === idx) break;
      list.push(season.episodes[j]);
    }
    upNextRow.replaceChildren();
    for (const next of list) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'tv-upnext-card';
      const t = document.createElement('div');
      t.className = 'tv-upnext-thumb';
      if (next.image) {
        const img = document.createElement('img');
        img.loading = 'lazy';
        img.src = next.image;
        img.alt = '';
        // Hide and fall back to the show emoji if the TVMaze still
        // can't be reached — the archive.org auto-thumbs aren't used.
        img.addEventListener(
          'error',
          () => {
            img.remove();
            t.classList.add('is-empty');
            t.textContent = show.emoji || '📺';
          },
          { once: true }
        );
        t.appendChild(img);
      } else {
        t.classList.add('is-empty');
        t.textContent = show.emoji || '📺';
      }
      const label = document.createElement('span');
      label.className = 'tv-upnext-label';
      label.textContent = `S${pad(next.season)}E${pad(next.episode)} — ${next.title || ''}`;
      card.appendChild(t);
      card.appendChild(label);
      card.addEventListener('click', () => loadEpisode(next));
      upNextRow.appendChild(card);
    }
  }
}

/** @param {Catalog} catalog @param {number} s @param {number} e */
function findEpisode(catalog, s, e) {
  if (s === 0 && catalog.movie) return catalog.movie;
  const season = catalog.seasons.find((x) => x.number === s);
  return season?.episodes.find((x) => x.episode === e) || null;
}

/**
 * Pool-respecting shuffle pick used by the Next/Prev buttons and the
 * end-card autoplay path when `prefs.shuffle` is on.
 *
 *  - Skips season 0 (movies / specials). Shuffling into a Christmas
 *    special between two regular episodes reads as a glitch.
 *  - Avoids returning the currently-playing episode so a click on
 *    Next can never land on the same one (which would feel broken).
 *    Returns the current episode anyway if it's the only option in
 *    the pool — better than `null` in that degenerate case.
 *
 * @param {Catalog} catalog
 * @param {Episode|null} current
 * @returns {Episode|null}
 */
function shufflePick(catalog, current) {
  const pool = [];
  for (const season of catalog.seasons) {
    if (season.number === 0) continue;
    pool.push(...season.episodes);
  }
  if (pool.length === 0) return null;
  if (pool.length === 1) return pool[0];
  let pick = pool[Math.floor(Math.random() * pool.length)];
  if (current && pick.season === current.season && pick.episode === current.episode) {
    // Bias away from a repeat by drawing once more — with 2+ entries
    // the second draw is guaranteed to land somewhere, even if it
    // happens to choose the same slot the first try did.
    pick = pool[Math.floor(Math.random() * pool.length)];
    if (pick.season === current.season && pick.episode === current.episode) {
      pick = pool[(pool.indexOf(pick) + 1) % pool.length];
    }
  }
  return pick;
}

/** @param {Episode} ep */
function crumbLabelFor(ep) {
  if (ep.season === 0) return ep.title || 'Movie';
  const tag = `S${pad(ep.season)}E${pad(ep.episode)}`;
  return ep.title ? `${tag} — ${ep.title}` : tag;
}

/**
 * Share the current episode via the Web Share API when available,
 * falling back to copying the canonical URL to the clipboard. Returns
 * `true` when something user-visible happened (system share completed
 * or clipboard write succeeded), `false` on outright failure or when
 * the user cancelled the native share sheet.
 *
 * @param {ShowConfig} show
 * @param {Episode} ep
 * @returns {Promise<boolean>}
 */
async function shareEpisode(show, ep) {
  const url = location.href;
  const title = describeEpisode(show, ep);
  if (navigator.share) {
    try {
      await navigator.share({ url, title, text: `Watching ${title}` });
      return true;
    } catch (err) {
      // User dismissed the native sheet — treat as a no-op, don't
      // fall back to clipboard (the user explicitly chose not to share).
      if (err && /** @type {DOMException} */ (err).name === 'AbortError') {
        return false;
      }
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    return false;
  }
}

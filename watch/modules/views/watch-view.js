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
 */

import { getMergedCatalog, getNextEpisode } from '../catalog.js';
import { createMarquee, createSummaryCard, describeEpisode, copyToClipboard, pad } from '../ui.js';
import { loadPrefs, savePrefs, saveLastEpisode } from '../prefs.js';
import {
  searchSubtitles,
  groupByLanguage,
  sortLanguageGroups,
  languageLabel,
  loadVttUrl,
  applyCueOffset
} from '../subtitles.js';

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

  // End-of-episode "Up next" card — populated lazily by showEndCard().
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
  const shuffleBtn = mkBtn('⇄ Shuffle', 'tv-btn is-accent');
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
  const copyLinkBtn = mkBtn('⌘ Copy link', 'tv-btn tv-btn--ghost');
  const copyTitleBtn = mkBtn('✎ Copy title', 'tv-btn tv-btn--ghost');

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
  controls.appendChild(shuffleBtn);
  controls.appendChild(fwd10Btn);
  controls.appendChild(nextBtn);
  if (show.imdbId) {
    controls.appendChild(subsWrap);
    controls.appendChild(subsSyncWrap);
  }
  controls.appendChild(autoplayLabel);
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
    '<kbd>◀</kbd><kbd>▶</kbd> prev / next · <kbd>J</kbd><kbd>L</kbd> ±10s · <kbd>R</kbd> shuffle · <kbd>Space</kbd> play';

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

  // End-of-episode card state. Declared up here (before any code path
  // that calls loadEpisode → hideEndCard) so the references aren't in
  // the temporal dead zone when the initial episode is loaded.
  /** @type {number | null} */
  let countdownTimer = null;
  /** @type {Episode | null} */
  let pendingNext = null;

  // Subtitle state. Declared early for the same TDZ reason — loadEpisode
  // calls clearSubtitles() on entry so the old track doesn't carry over.
  /** @type {HTMLTrackElement | null} */
  let activeTrack = null;
  /** @type {string | null} */
  let activeTrackUrl = null;
  /** @type {string | null} */
  let activeLang = null;
  /** @type {string | null} */
  let menuCacheKey = null;
  // Manual sync offset in seconds. Persists across episode changes
  // within a session because most OpenSubtitles uploads for a given
  // show come from the same source release — once the user has
  // dialled in the right delay, it usually carries over.
  let subtitleOffset = 0;

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

  // Find the requested episode, falling back to the season opener / a
  // random pick when the URL points at a slot we don't have.
  let initial = findEpisode(catalog, ctx.initialSeason, ctx.initialEpisode);
  if (!initial) {
    const season = catalog.seasons.find((s) => s.number === ctx.initialSeason);
    initial = season?.episodes[0] || randomEpisode(catalog);
  }
  if (!initial) {
    noSignalOverlay.classList.remove('hidden');
    return { unmount: () => root.remove() };
  }

  loadEpisode(initial, { autoplay: false });

  // ---- Event wiring -------------------------------------------------
  prevBtn.addEventListener('click', () => stepEpisode(-1));
  nextBtn.addEventListener('click', () => stepEpisode(1));
  back10Btn.addEventListener('click', () => seekRelative(-10));
  fwd10Btn.addEventListener('click', () => seekRelative(10));

  // Subtitles: click CC to open / close the language picker. Click
  // elsewhere on the page to dismiss. The menu is lazy — we don't
  // search the addon until the user actually asks.
  subsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (subsMenu.classList.contains('hidden')) {
      openSubsMenu();
    } else {
      closeSubsMenu();
    }
  });
  const outsideClick = (e) => {
    if (!subsWrap.contains(e.target instanceof Node ? e.target : null)) {
      closeSubsMenu();
    }
  };
  document.addEventListener('click', outsideClick);

  // Slider drives the offset live as the user drags. The readout doubles
  // as a "reset to zero" button so a misadjust is one click away from
  // undo, no need to drag back to dead-center on a sticky range input.
  subsSyncSlider.addEventListener('input', () => {
    const v = parseFloat(subsSyncSlider.value);
    if (Number.isFinite(v)) setSubtitleOffset(v);
  });
  subsSyncReadout.addEventListener('click', () => setSubtitleOffset(0));
  shuffleBtn.addEventListener('click', () => {
    if (!catalog) return;
    const ep = randomEpisode(catalog);
    if (ep) loadEpisode(ep);
  });
  autoplayInput.addEventListener('change', () => {
    prefs.autoplayNext = autoplayInput.checked;
    savePrefs(prefs);
  });
  copyLinkBtn.addEventListener('click', () =>
    copyToClipboard(location.href, marquee, 'LINK COPIED', 'COPY FAILED')
  );
  copyTitleBtn.addEventListener('click', () =>
    copyToClipboard(describeEpisode(show, current), marquee, 'TITLE COPIED', 'COPY FAILED')
  );

  video.addEventListener('ended', () => {
    showEndCard();
  });
  video.addEventListener('error', () => {
    errorBanner.classList.remove('hidden');
  });

  // ---- End-of-episode card wiring ----------------------------------
  endPlayBtn.addEventListener('click', () => {
    const target = pendingNext;
    hideEndCard();
    if (target) loadEpisode(target);
  });
  endReplayBtn.addEventListener('click', () => {
    hideEndCard();
    try {
      video.currentTime = 0;
      const p = video.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      /* ignore */
    }
  });
  endShareBtn.addEventListener('click', async () => {
    if (!current) return;
    const ok = await shareEpisode(show, current);
    marquee.flash(ok ? 'SHARED' : 'SHARE FAILED');
  });
  endBackBtn.addEventListener('click', () => {
    hideEndCard();
    navigate({ show: show.id });
  });
  // Clicking the backdrop (outside the inner card) cancels the
  // countdown — but leaves the card visible so the user can still
  // choose Replay / Share / Back.
  endCard.addEventListener('click', (e) => {
    if (e.target === endCard && countdownTimer != null) {
      cancelCountdown();
      endCountdown.textContent = 'Autoplay cancelled — pick something.';
      endCountdown.classList.remove('hidden');
    }
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
        shuffleBtn.click();
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
      document.removeEventListener('click', outsideClick);
      // Cancel any in-flight end-card countdown before removing the
      // DOM — leaking the interval would keep loadEpisode firing
      // against a torn-down view.
      if (countdownTimer != null) {
        clearInterval(countdownTimer);
        countdownTimer = null;
      }
      // Revoke any active subtitle blob URL so it doesn't sit in
      // memory after the view is torn down.
      clearSubtitles();
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
    hideEndCard();
    // Subtitles are episode-specific — drop the old track + close the
    // language menu so it isn't showing stale options for the previous
    // episode the next time the user pokes CC.
    clearSubtitles();
    closeSubsMenu();

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

    if (video.src !== ep.url) {
      video.src = ep.url;
      video.poster = ep.image || ep.thumbUrl || '';
    }
    video.load();
    if (autoplay) {
      const p = video.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }

    // Auto-apply the user's saved subtitle language (if any). Fired
    // unawaited so video playback isn't blocked on a subtitle round-trip;
    // a check inside maybeAutoLoadSubtitles bails if the user navigated
    // away before the fetch resolved.
    if (prefs.subtitleLang && show.imdbId && ep.season > 0) {
      maybeAutoLoadSubtitles(ep, prefs.subtitleLang);
    }
  }

  /** @param {1 | -1} delta */
  function stepEpisode(delta) {
    if (!catalog || !current) return;
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

  /**
   * Cancel the autoplay countdown timer (if running) without hiding
   * the end-card. The card stays up so the user can still pick an
   * action explicitly.
   */
  function cancelCountdown() {
    if (countdownTimer != null) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
  }

  function hideEndCard() {
    cancelCountdown();
    endCard.classList.add('hidden');
    endCountdown.classList.add('hidden');
    pendingNext = null;
  }

  /**
   * Display the end-of-episode card. Populated with the next episode
   * (across seasons) when one exists; falls back to a "you've reached
   * the end" state with only Replay / Share / Back available.
   */
  function showEndCard() {
    if (!catalog || !current) return;
    const next = getNextEpisode(catalog, current);
    pendingNext = next;

    endThumb.replaceChildren();
    endThumb.classList.remove('is-empty');

    if (next) {
      endEyebrow.textContent = 'Up next';
      endPlayBtn.classList.remove('hidden');
      endTitle.textContent = next.title || `Episode ${next.episode}`;
      endSub.textContent =
        next.season === 0
          ? 'Special'
          : `${show.shortName} · S${pad(next.season)}E${pad(next.episode)}`;
      const thumbSrc = next.image || next.thumbUrl;
      if (thumbSrc) {
        const img = document.createElement('img');
        img.loading = 'lazy';
        img.decoding = 'async';
        img.alt = '';
        img.src = thumbSrc;
        endThumb.appendChild(img);
      } else {
        endThumb.classList.add('is-empty');
        endThumb.textContent = '📺';
      }
    } else {
      endEyebrow.textContent = 'Episode ended';
      endPlayBtn.classList.add('hidden');
      endTitle.textContent = "That's the last one on the shelf.";
      endSub.textContent = `${show.name} — replay, share, or browse other shows.`;
      endThumb.classList.add('is-empty');
      endThumb.textContent = show.emoji || '📺';
    }

    endCard.classList.remove('hidden');

    if (next && prefs.autoplayNext) {
      let remaining = 8;
      endCountdown.textContent = `Playing in ${remaining}s — tap outside to cancel.`;
      endCountdown.classList.remove('hidden');
      countdownTimer = window.setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
          const target = pendingNext;
          cancelCountdown();
          endCountdown.classList.add('hidden');
          endCard.classList.add('hidden');
          pendingNext = null;
          if (target) loadEpisode(target);
        } else {
          endCountdown.textContent = `Playing in ${remaining}s — tap outside to cancel.`;
        }
      }, 1000);
    } else {
      endCountdown.classList.add('hidden');
    }
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

  /* ---------- Subtitles ---------- */

  /**
   * Set the absolute subtitle offset (in seconds) and re-apply it to
   * the active track. Rounded to 100ms because the on-screen readout
   * caps at one decimal anyway.
   *
   * @param {number} offsetSec
   */
  function setSubtitleOffset(offsetSec) {
    const clamped = Math.max(-30, Math.min(30, offsetSec));
    subtitleOffset = Math.round(clamped * 10) / 10;
    applyOffsetToActiveTrack();
    updateSyncReadout();
  }

  /**
   * Apply the current `subtitleOffset` to whatever cues are currently
   * loaded on the active track. No-op when no track is attached or
   * when the cues haven't finished parsing yet — callers should also
   * wire up the `<track>` `load` event so the offset re-applies once
   * cues become available.
   */
  function applyOffsetToActiveTrack() {
    if (!activeTrack || !activeTrack.track) return;
    applyCueOffset(activeTrack.track.cues, subtitleOffset);
  }

  /** Refresh the on-screen offset readout + CC button label + slider. */
  function updateSyncReadout() {
    const sign = subtitleOffset > 0 ? '+' : subtitleOffset < 0 ? '−' : '';
    const abs = Math.abs(subtitleOffset).toFixed(1);
    subsSyncReadout.textContent = `${sign}${abs}s`;
    if (subtitleOffset !== 0) {
      subsSyncReadout.classList.add('is-shifted');
    } else {
      subsSyncReadout.classList.remove('is-shifted');
    }
    // Keep the slider's thumb in sync — important after the user hits
    // Reset, on cross-episode auto-load, and any other path that
    // mutates the offset without dragging the slider.
    if (subsSyncSlider.value !== String(subtitleOffset)) {
      subsSyncSlider.value = String(subtitleOffset);
    }
    // Reflect the offset on the CC button label so the user can tell
    // at a glance that subs are shifted even when the sync row is
    // off-screen on narrow viewports.
    if (activeLang) {
      subsBtn.textContent =
        subtitleOffset === 0
          ? `CC ${activeLang.toUpperCase()}`
          : `CC ${activeLang.toUpperCase()} ${sign}${abs}s`;
    }
  }

  /**
   * Silently fetch + attach the user's preferred subtitle language for
   * the given episode. Runs in the background after each episode load
   * so "I want English on every episode" works without further input.
   *
   * Failures are silent — the visible CC button is the user's
   * acknowledgement that captions are missing, not a toast.
   *
   * @param {Episode} ep
   * @param {string} lang
   */
  async function maybeAutoLoadSubtitles(ep, lang) {
    const stamp = `${ep.season}:${ep.episode}`;
    const candidates = await searchSubtitles(show.imdbId || '', ep.season, ep.episode);
    // Bail if the user navigated to a different episode while the
    // search was in flight, or the current episode no longer matches.
    if (!current || `${current.season}:${current.episode}` !== stamp) return;
    const groups = groupByLanguage(candidates);
    const group = groups.find((g) => g.lang === lang);
    if (!group) return;
    const url = await loadVttUrl(group.candidates);
    if (!url) return;
    if (!current || `${current.season}:${current.episode}` !== stamp) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* ignore */
      }
      return;
    }
    attachSubtitleTrack(url, lang);
  }

  /**
   * Tear down any active subtitle track. Safe to call when nothing is
   * attached. Always revokes the blob URL even if the `<track>` is
   * already detached.
   */
  function clearSubtitles() {
    if (activeTrack && activeTrack.parentNode) {
      activeTrack.remove();
    }
    if (activeTrackUrl) {
      try {
        URL.revokeObjectURL(activeTrackUrl);
      } catch {
        /* ignore */
      }
    }
    activeTrack = null;
    activeTrackUrl = null;
    activeLang = null;
    subsBtn.textContent = 'CC';
    subsBtn.classList.remove('is-active');
    subsBtn.setAttribute('aria-expanded', 'false');
    // Hide the sync controls but keep `subtitleOffset` in place so the
    // value carries over when the user re-enables subs on the next
    // episode. The offset is reset only when the user explicitly
    // clicks "Off" in the menu (see openSubsMenu()).
    subsSyncWrap.classList.add('hidden');
  }

  function closeSubsMenu() {
    subsMenu.classList.add('hidden');
    subsBtn.setAttribute('aria-expanded', 'false');
  }

  /**
   * Open the language picker, populating it lazily on first open per
   * episode. Subsequent opens for the same episode reuse the rendered
   * list so the UI doesn't flash a "Loading…" state needlessly.
   */
  async function openSubsMenu() {
    if (!show.imdbId || !current) return;
    subsMenu.classList.remove('hidden');
    subsBtn.setAttribute('aria-expanded', 'true');

    const epKey = `${current.season}:${current.episode}`;
    if (menuCacheKey === epKey && subsMenu.childElementCount > 0) {
      return;
    }
    menuCacheKey = epKey;

    subsMenu.replaceChildren();
    if (current.season === 0) {
      subsMenu.appendChild(menuMessage('Subtitles for specials / movies are not supported yet.'));
      return;
    }

    subsMenu.appendChild(menuMessage('Loading…'));

    const candidates = await searchSubtitles(show.imdbId, current.season, current.episode);
    if (menuCacheKey !== epKey) return; // user already navigated away

    subsMenu.replaceChildren();

    // Always include an "Off" entry first so the user has an easy
    // out, even when no languages were returned. Picking Off also
    // clears the saved preference so future episodes don't re-arm.
    subsMenu.appendChild(
      makeMenuItem('Off', null, () => {
        clearSubtitles();
        // Explicit "Off" also forgets the offset — the user is
        // starting fresh next time they turn captions on.
        setSubtitleOffset(0);
        prefs.subtitleLang = null;
        savePrefs(prefs);
        closeSubsMenu();
      })
    );

    const groups = sortLanguageGroups(groupByLanguage(candidates));
    if (groups.length === 0) {
      subsMenu.appendChild(menuMessage('No subtitles found for this episode.'));
      return;
    }
    for (const g of groups) {
      const label = `${languageLabel(g.lang)} · ${g.candidates.length}`;
      subsMenu.appendChild(
        makeMenuItem(label, g.lang, async () => {
          // Persist the choice so subsequent episodes auto-load this
          // language without a second visit to the menu.
          prefs.subtitleLang = g.lang;
          savePrefs(prefs);
          // Optimistic UI: switch the button immediately so the user
          // sees feedback while the SRT downloads.
          subsBtn.textContent = `CC ${g.lang.toUpperCase()}`;
          subsBtn.classList.add('is-active');
          closeSubsMenu();
          const url = await loadVttUrl(g.candidates);
          if (!url) {
            // Roll back the optimistic state — the download failed.
            clearSubtitles();
            marquee.flash('SUBS UNAVAILABLE');
            return;
          }
          // Bail out if the episode changed while we were fetching.
          if (menuCacheKey !== epKey || !current) {
            try {
              URL.revokeObjectURL(url);
            } catch {
              /* ignore */
            }
            return;
          }
          attachSubtitleTrack(url, g.lang);
        })
      );
    }
  }

  /** @param {string} text */
  function menuMessage(text) {
    const p = document.createElement('p');
    p.className = 'tv-subs-empty';
    p.textContent = text;
    return p;
  }

  /**
   * @param {string} label
   * @param {string | null} lang Currently-active lang gets a check; null = "Off" row.
   * @param {() => void} onClick
   */
  function makeMenuItem(label, lang, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tv-subs-item';
    b.setAttribute('role', 'menuitem');
    if (lang === activeLang || (lang === null && !activeLang)) {
      b.classList.add('is-current');
    }
    b.textContent = label;
    b.addEventListener('click', () => onClick());
    return b;
  }

  /**
   * Attach a `<track>` element pointing at the converted blob URL.
   * Removes any prior track first; the player is single-track by design.
   *
   * @param {string} blobUrl
   * @param {string} lang ISO 639-2 code.
   */
  function attachSubtitleTrack(blobUrl, lang) {
    if (activeTrack && activeTrack.parentNode) activeTrack.remove();
    if (activeTrackUrl) {
      try {
        URL.revokeObjectURL(activeTrackUrl);
      } catch {
        /* ignore */
      }
    }
    const track = document.createElement('track');
    track.kind = 'subtitles';
    track.srclang = lang;
    track.label = languageLabel(lang);
    track.src = blobUrl;
    track.default = true;
    // The `load` event fires once the browser has parsed the WebVTT,
    // which is when `track.track.cues` becomes non-empty. That's the
    // earliest we can apply the user's manual offset.
    track.addEventListener('load', () => {
      if (subtitleOffset !== 0) applyCueOffset(track.track?.cues, subtitleOffset);
    });
    video.appendChild(track);
    // `<track>.mode = 'showing'` is what actually flips captions on;
    // setting `default` only matters when the element is added
    // *before* the video starts playing. Set both for safety.
    if (track.track) track.track.mode = 'showing';
    activeTrack = track;
    activeTrackUrl = blobUrl;
    activeLang = lang;
    subsBtn.classList.add('is-active');
    subsSyncWrap.classList.remove('hidden');
    updateSyncReadout();
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
      const src = next.image || next.thumbUrl;
      if (src) {
        const img = document.createElement('img');
        img.loading = 'lazy';
        img.src = src;
        img.alt = '';
        t.appendChild(img);
      } else {
        t.classList.add('is-empty');
        t.textContent = '📺';
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

/** @param {Catalog} catalog */
function randomEpisode(catalog) {
  const pool = [];
  for (const season of catalog.seasons) pool.push(...season.episodes);
  if (catalog.movie) pool.push(catalog.movie);
  return pool[Math.floor(Math.random() * pool.length)];
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

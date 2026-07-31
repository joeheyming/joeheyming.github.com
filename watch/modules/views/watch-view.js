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

import { getMergedCatalog, getMovieCatalog, getNextEpisode } from '../catalog.js';
import { buildPlaybackQueue } from '../playback-urls.js';
import { createMarquee, createSummaryCard, describeEpisode, copyToClipboard, pad } from '../ui.js';
import {
  loadPrefs,
  savePrefs,
  saveLastEpisode,
  loadResumePosition,
  saveResumePosition,
  clearResumePosition
} from '../prefs.js';
import { isTvMode } from '../mode.js';
import { createSubtitleController } from './subtitle-controller.js';
import { createOfflineSaveController } from './offline-save-controller.js';
import { createEndCardController } from './endcard-controller.js';
import { mediaLabel, trackWatch, trackWatchConversion } from '../track.js';

/** @typedef {import('../shows.js').ShowConfig} ShowConfig */
/** @typedef {import('../movies.js').MovieConfig} MovieConfig */
/** @typedef {import('../catalog.js').Catalog} Catalog */
/** @typedef {import('../catalog.js').Episode} Episode */

/**
 * @typedef {Object} MountCtx
 * @property {ShowConfig | MovieConfig} show
 *   The "subject" for this watch session. Either a series (ShowConfig)
 *   or a standalone movie (MovieConfig, with `kind === 'movie'`). The
 *   field name stays `show` for historical reasons; the view branches
 *   on `show.kind === 'movie'` where movie-specific behaviour
 *   diverges (no Prev/Next, no autoplay-next, single-file catalog,
 *   `?movie=` deep-link shape).
 * @property {number} initialSeason
 *   For movies the router always passes 0; the catalog's single
 *   Episode lives at (s=0, e=0).
 * @property {number} initialEpisode
 * @property {(params: { show?: string, movie?: string, s?: number, e?: number }) => void} navigate
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

  // `show.kind === 'movie'` is the discriminator for standalone-movie
  // mode. Pulled out once here so every branch below can ask the
  // same question without re-reading the field. Movies hide
  // Prev/Next/Shuffle/Autoplay-next/Up-next, route through a
  // single-file catalog loader, and write `?movie=<id>` URLs.
  const isMovie = /** @type {any} */ (show).kind === 'movie';

  /** @type {Catalog | null} */
  let catalog = null;
  /** @type {Episode | null} */
  let current = null;
  /** Ordered network URLs for the active episode; advanced on `<video>` error. */
  let playbackQueue = /** @type {string[]} */ ([]);
  let playbackIndex = 0;
  /** One-shot play tracking — reset whenever loadEpisode swaps the source. */
  let playStartTracked = false;
  /**
   * One-shot `loadedmetadata` handler for the pending resume seek.
   * Tracked so a rapid Prev/Next can detach it before it fires
   * against the wrong episode.
   * @type {(() => void) | null}
   */
  let resumeArmed = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let resumeHideTimer = null;
  /** Throttle floor for `snapshotPosition`. ms epoch. */
  let lastSnapshotAt = 0;

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

  // Resume / restart prompt. Shown for ~6s when the user re-enters an
  // episode they previously abandoned mid-playback. Plex/Netflix-style
  // — Resume is the focused default so a single OK on the remote
  // confirms it; Play-from-start is one D-pad right away. The overlay
  // disposes itself if the user touches any other key, so it never
  // blocks input for long.
  const resumeOverlay = document.createElement('div');
  resumeOverlay.className = 'tv-resume hidden';
  resumeOverlay.setAttribute('role', 'dialog');
  resumeOverlay.setAttribute('aria-label', 'Resume playback');
  const resumeInner = document.createElement('div');
  resumeInner.className = 'tv-resume-inner';
  const resumeEyebrow = document.createElement('p');
  resumeEyebrow.className = 'tv-resume-eyebrow';
  resumeEyebrow.textContent = '↻ Continue watching';
  const resumeTitle = document.createElement('h3');
  resumeTitle.className = 'tv-resume-title';
  const resumeActions = document.createElement('div');
  resumeActions.className = 'tv-resume-actions';
  // Visible Back fallback for users who forget the hardware key.
  // Resume stays the autofocused primary action (see showResumeOverlay).
  const backFromOverlayBtn = mkBtn('← Back', 'tv-resume-btn tv-resume-btn--ghost');
  const resumeBtn = mkBtn('▶ Resume', 'tv-resume-btn tv-resume-btn--primary');
  const restartFromOverlayBtn = mkBtn('↺ From start', 'tv-resume-btn');
  resumeActions.appendChild(backFromOverlayBtn);
  resumeActions.appendChild(resumeBtn);
  resumeActions.appendChild(restartFromOverlayBtn);
  resumeInner.appendChild(resumeEyebrow);
  resumeInner.appendChild(resumeTitle);
  resumeInner.appendChild(resumeActions);
  resumeOverlay.appendChild(resumeInner);

  screen.appendChild(video);
  screen.appendChild(loadingOverlay);
  screen.appendChild(noSignalOverlay);
  screen.appendChild(errorBanner);
  screen.appendChild(resumeOverlay);
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
  // "Restart this episode" — surfaces the same action as the resume
  // overlay's "Play from start", but persistently. Listed alongside
  // the seek buttons so it sits next to the existing scrub affordances.
  const restartBtn = mkBtn('↺ Restart', 'tv-btn tv-btn--seek');
  restartBtn.title = 'Restart this episode from the beginning (Home)';
  restartBtn.setAttribute('aria-label', 'Restart episode from the beginning');
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

  // Movies suppress Prev/Next (no neighbour episode), Autoplay-next
  // (nothing to autoplay), and Shuffle (no pool to shuffle through).
  // The seek buttons + Restart + Save + Copy + CC all still apply
  // because they operate on the active file, which is identical in
  // shape between an episode and a standalone movie.
  if (!isMovie) controls.appendChild(prevBtn);
  controls.appendChild(back10Btn);
  controls.appendChild(fwd10Btn);
  controls.appendChild(restartBtn);
  if (!isMovie) controls.appendChild(nextBtn);
  if (show.imdbId) {
    controls.appendChild(subsWrap);
    controls.appendChild(subsSyncWrap);
  }
  controls.appendChild(saveBtn);
  if (!isMovie) controls.appendChild(autoplayLabel);
  if (!isMovie) controls.appendChild(shuffleLabel);
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

  // "All episodes" link to bounce back to the episode browser. Movies
  // don't have an episode browser to return to — back to the landing
  // page is the natural exit.
  const allEpsLink = document.createElement('a');
  allEpsLink.className = 'tv-all-eps-link';
  if (isMovie) {
    allEpsLink.href = './';
    allEpsLink.textContent = '← All movies';
    allEpsLink.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
      e.preventDefault();
      navigate({});
    });
  } else {
    allEpsLink.href = `?show=${encodeURIComponent(show.id)}`;
    allEpsLink.textContent = `All episodes of ${show.name} →`;
    allEpsLink.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
      e.preventDefault();
      navigate({ show: show.id });
    });
  }

  const help = document.createElement('div');
  help.className = 'tv-help';
  // Two short rows so the line wrap stays predictable on narrow
  // viewports. Order roughly matches YouTube's docs: playback, then
  // seek, then volume / captions, then this app's prev/next.
  help.innerHTML =
    '<div><kbd>Space</kbd>/<kbd>K</kbd> play · <kbd>J</kbd>/<kbd>L</kbd> ±10s · <kbd>F</kbd> fullscreen · <kbd>M</kbd> mute · <kbd>C</kbd> captions</div>' +
    '<div><kbd>↑</kbd>/<kbd>↓</kbd> volume · <kbd>0</kbd>–<kbd>9</kbd> seek · <kbd>Home</kbd>/<kbd>End</kbd> start/end · <kbd>&lt;</kbd>/<kbd>&gt;</kbd> speed</div>' +
    '<div><kbd>◀</kbd>/<kbd>▶</kbd> or <kbd>N</kbd>/<kbd>P</kbd> prev / next episode · <kbd>R</kbd> shuffle</div>';

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
    catalog = isMovie
      ? await getMovieCatalog(/** @type {MovieConfig} */ (show))
      : await getMergedCatalog(/** @type {ShowConfig} */ (show));
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
      detail.textContent = '';
      if (isMovie) {
        // A movie that can't be found on the catalog means the IA
        // metadata didn't contain a matching file (most likely the
        // `iaFile` exact-basename match failed). Direct the user back
        // to the landing page; there's nowhere more useful to send
        // them inside this view.
        const head = document.createElement('span');
        head.textContent = `${show.name} couldn't be found on archive.org — try `;
        const link = document.createElement('a');
        link.href = './';
        link.textContent = 'all movies';
        link.addEventListener('click', (e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
          e.preventDefault();
          ctx.navigate({});
        });
        const tail = document.createElement('span');
        tail.textContent = '.';
        detail.appendChild(head);
        detail.appendChild(link);
        detail.appendChild(tail);
      } else {
        const slot =
          ctx.initialSeason === 0
            ? 'this special'
            : `S${pad(ctx.initialSeason)}E${pad(ctx.initialEpisode)}`;
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
    // which wraps within the current season). Movies always return
    // null (resolveNext returns null when the current episode is in
    // season 0, which is how every movie / special is keyed); the
    // end-card then collapses its "Play next" affordance to Replay /
    // Share / Back only.
    resolveNext: () => {
      if (!catalog || !current) return null;
      return prefs.shuffle ? shufflePick(catalog, current) : getNextEpisode(catalog, current);
    },
    shouldAutoplay: () => prefs.autoplayNext,
    onAdvance: (ep) => loadEpisode(ep),
    // Movies don't have an episodes view to return to; send the user
    // back to the landing page (where they'll see the Movies grid).
    onNavigateBack: () => navigate(isMovie ? {} : { show: show.id }),
    shareCurrent: async () => (current ? shareEpisode(show, current) : false)
  });

  await offlineCtrl.hydrate();

  loadEpisode(initial, { autoplay: false });

  // ---- Event wiring -------------------------------------------------
  prevBtn.addEventListener('click', () => stepEpisode(-1));
  nextBtn.addEventListener('click', () => stepEpisode(1));
  back10Btn.addEventListener('click', () => seekRelative(-10));
  fwd10Btn.addEventListener('click', () => seekRelative(10));
  restartBtn.addEventListener('click', () => restartEpisode());

  // Resume = explicit dismiss (video already seeked). From start =
  // wipe + rewind. Back = walk history (lands on the episode list).
  backFromOverlayBtn.addEventListener('click', () => {
    hideResumeOverlay();
    history.back();
  });
  resumeBtn.addEventListener('click', () => hideResumeOverlay());
  restartFromOverlayBtn.addEventListener('click', () => restartEpisode());

  // Save the scrub position at a coarse cadence while playing, plus
  // on every pause (covers the common "user pauses, walks away,
  // closes the tab" path). The throttle inside snapshotPosition()
  // keeps this from hammering localStorage.
  video.addEventListener('timeupdate', snapshotPosition);
  video.addEventListener('pause', flushPosition);
  // End of episode is "watched" — drop the resume point so a future
  // visit starts fresh. The end-card controller handles autoplay-next
  // separately; this only owns the storage write.
  video.addEventListener('ended', () => {
    if (current) clearResumePosition(show.id, current.season, current.episode);
  });
  // Any keypress outside the overlay dismisses it. Inside the
  // overlay we have to shield the main player keydown handler
  // (also on document/capture) from claiming ArrowLeft/Right for
  // seek and 'k' for togglePlay while the user is picking a button.
  const overlayDismiss = (e) => {
    if (resumeOverlay.classList.contains('hidden')) return;
    const inOverlay = e.target instanceof Node && resumeOverlay.contains(e.target);
    if (!inOverlay) {
      hideResumeOverlay();
      return;
    }
    // stopImmediatePropagation, not stopPropagation — both listeners
    // live on `document` and we have to keep this event from reaching
    // the sibling listener on the same node.
    e.stopImmediatePropagation();
    // The TV remote's OK arrives as 'k' — translate to a button
    // click so OK actually picks Resume / From-start. Enter / Space
    // already fire native clicks.
    if (e.key === 'k' || e.key === 'K') {
      e.preventDefault();
      if (e.target instanceof HTMLButtonElement) e.target.click();
    }
  };
  document.addEventListener('keydown', overlayDismiss, true);

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
    // Offline blob failures: fall back into the network queue rather
    // than giving up immediately — a corrupt IDB blob shouldn't brick
    // an episode that still has archive.org mirrors.
    const src = video.currentSrc || video.src || '';
    if (src.startsWith('blob:') && current && playbackQueue.length === 0) {
      playbackQueue = buildPlaybackQueue(current, catalog);
      playbackIndex = -1;
    }
    if (tryNextPlaybackUrl()) return;
    errorBanner.classList.remove('hidden');
    if (current) {
      trackWatch('watch_playback_error', mediaLabel(isMovie ? 'movie' : 'show', show.id, current));
    }
  });

  video.addEventListener('play', () => {
    if (playStartTracked || !current) return;
    playStartTracked = true;
    trackWatch('watch_play_start', mediaLabel(isMovie ? 'movie' : 'show', show.id, current));
    trackWatchConversion('watch_played', 1);
  });

  const keydown = (e) => {
    if (e.target instanceof HTMLElement) {
      const tag = e.target.tagName;
      // Don't intercept anything while the user is typing in a real
      // text field. Checkboxes / range sliders also live under INPUT,
      // but Space on those produces a benign toggle/no-op that doesn't
      // conflict with our shortcuts, so the broad INPUT bail is fine.
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
    }

    // Modifier-bearing keys (Ctrl/Cmd/Alt) belong to the browser or OS.
    // Shift is in-bounds because YouTube uses it for `<` / `>`.
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    switch (e.key) {
      case ' ':
      case 'k':
      case 'K':
        e.preventDefault();
        togglePlay();
        break;
      // ArrowLeft/Right scrub ±10s on TV (Plex/Netflix convention) but
      // step prev/next episode on desktop (mirrors the chevron buttons).
      // TV episode nav is still available via Channel +/-, N/P, and the
      // Prev/Next buttons.
      case 'ArrowLeft':
        e.preventDefault();
        if (isTvMode) {
          seekRelative(-10);
          flashSeek(-10);
        } else {
          stepEpisode(-1);
        }
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (isTvMode) {
          seekRelative(10);
          flashSeek(10);
        } else {
          stepEpisode(1);
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        adjustVolume(0.05);
        break;
      case 'ArrowDown':
        e.preventDefault();
        adjustVolume(-0.05);
        break;
      // YouTube-style ±10s seek. Arrow keys are already claimed for
      // episode navigation; J/L is the next-best convention and what
      // people who watch a lot of video on the web reach for.
      case 'j':
      case 'J':
        e.preventDefault();
        seekRelative(-10);
        flashSeek(-10);
        break;
      case 'l':
      case 'L':
        e.preventDefault();
        seekRelative(10);
        flashSeek(10);
        break;
      case 'f':
      case 'F':
        e.preventDefault();
        toggleFullscreen();
        break;
      case 'm':
      case 'M':
        e.preventDefault();
        toggleMute();
        break;
      case 'c':
      case 'C':
        e.preventDefault();
        subtitleCtrl.toggleCaptions();
        break;
      // Alias: N/P mirror YouTube's "next/previous in playlist" keys
      // so muscle memory carries over. Same season-wrapping rules as
      // the Next / Prev buttons.
      case 'n':
      case 'N':
        e.preventDefault();
        stepEpisode(1);
        break;
      case 'p':
      case 'P':
        e.preventDefault();
        stepEpisode(-1);
        break;
      case 'Home':
        e.preventDefault();
        seekTo(0);
        break;
      case 'End':
        e.preventDefault();
        if (Number.isFinite(video.duration)) seekTo(video.duration);
        break;
      // Shifted comma/period produce `<` / `>` on US layouts — same
      // keys YouTube uses to step playback rate down/up. Hold Shift
      // is implicit in the character itself, so we don't check shiftKey.
      case '<':
        e.preventDefault();
        adjustPlaybackRate(-0.25);
        break;
      case '>':
        e.preventDefault();
        adjustPlaybackRate(0.25);
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
      default:
        // Digit keys 0..9 seek to N×10% of the duration. `0` doubles
        // as "rewind to start", matching YouTube.
        if (/^[0-9]$/.test(e.key)) {
          e.preventDefault();
          seekPercent(Number(e.key) / 10);
        }
        break;
    }
  };
  // Capture-phase listener. Chromium-based WebViews on Android TV
  // (and any browser launched with `--enable-spatial-navigation`)
  // route arrow keys to focus moves at user-agent priority. A normal
  // bubble-phase listener fires too late to call preventDefault on
  // them — spatial nav will have already consumed the keystroke. By
  // listening in capture, we see the keydown before the UA, and our
  // preventDefault() suppresses the focus-shift default action so
  // ArrowLeft/Right in TV mode actually scrub the timeline instead
  // of moving focus to the previous/next on-screen control.
  document.addEventListener('keydown', keydown, true);

  // TV mode: collapse the chassis chrome (bezel label, marquee,
  // controls row, summary, up-next rail, header / breadcrumbs) and
  // float the video to fill the panel — Plex/Netflix-style fullscreen
  // by default. The CSS for this lives behind the
  // [data-fullscreen='player'] attribute on <html>; we set/remove
  // it here so the home / episodes views stay in their normal
  // 10-foot layout.
  if (isTvMode) {
    document.documentElement.dataset.fullscreen = 'player';
  }

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
      // Snapshot the scrub position FIRST so the back-button path
      // ("watching, hit Back, come back later") restores where the
      // user left off. Has to happen before video.pause() / src
      // removal because both can reset currentTime.
      flushPosition();
      hideResumeOverlay();
      if (resumeArmed) {
        video.removeEventListener('loadedmetadata', resumeArmed);
        resumeArmed = null;
      }
      document.removeEventListener('keydown', keydown, true);
      document.removeEventListener('keydown', overlayDismiss, true);
      // Restore normal layout when leaving the player so the
      // episodes view paints with its full chrome again.
      if (document.documentElement.dataset.fullscreen === 'player') {
        delete document.documentElement.dataset.fullscreen;
      }
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

    // Snapshot the outgoing episode's scrub position before we swap
    // sources. If the user is jumping Prev/Next mid-episode we want
    // to remember where they left so coming back to it later resumes.
    snapshotPosition();
    hideResumeOverlay();

    current = ep;
    playStartTracked = false;

    // Loading a new episode hides any leftover end-card. Important
    // for both autoplay and manual Prev/Next transitions.
    endcardCtrl.hide();

    marquee.update(show, ep);
    summary.update(ep);
    // Channel chip — for series this is the SxxExx tag; for the
    // bundled-movie case (Simpsons Movie etc., where the show carries
    // a `movieDetector`) and for standalone movies we show "MOV". Any
    // other season-0 entry (specials, behind-the-scenes) stays "SPC".
    channelChip.textContent =
      ep.season === 0
        ? isMovie || /** @type {any} */ (show).movieDetector
          ? 'MOV'
          : 'SPC'
        : `S${pad(ep.season)}E${pad(ep.episode)}`;
    errorLink.href = ep.archiveUrl;
    errorBanner.classList.add('hidden');
    setBreadcrumbTitle(isMovie ? show.name : crumbLabelFor(ep));
    renderUpNext(ep);

    if (urlSync) updateDeepLink(ep);
    saveLastEpisode(show.id, ep.season, ep.episode);

    trackWatch('watch_episode_open', mediaLabel(isMovie ? 'movie' : 'show', show.id, ep));

    // Build the soft-fallback queue once per episode. Offline controller
    // may still swap to a Blob URL after this; network retries only run
    // when the active src fails.
    playbackQueue = buildPlaybackQueue(ep, catalog);
    playbackIndex = 0;
    const primary = playbackQueue[0] || ep.url;
    if (video.src !== primary) {
      video.src = primary;
      // Poster is the TVMaze still when available; we don't fall back
      // to archive.org's `.thumbs/` JPGs because the CDN sometimes
      // 403s those and a missing poster reads better than a broken one.
      video.poster = ep.image || '';
    }
    video.load();

    // Resume point: fire-and-forget seek as soon as we know the
    // duration, plus a brief overlay so the user can choose to start
    // from zero instead. Reading from storage at mount time means
    // we don't depend on the previous in-memory `current` — works
    // for the cold-start case (new tab, refreshed URL) too.
    armResumeFor(ep);

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

  /**
   * Advance to the next candidate in `playbackQueue`. Returns true when
   * a new src was assigned (caller should not show the error banner yet).
   * @returns {boolean}
   */
  function tryNextPlaybackUrl() {
    if (!playbackQueue.length) return false;
    const next = playbackIndex + 1;
    if (next >= playbackQueue.length) return false;
    playbackIndex = next;
    const url = playbackQueue[playbackIndex];
    console.warn(`[watch] playback fallback ${playbackIndex + 1}/${playbackQueue.length}:`, url);
    video.src = url;
    video.load();
    const p = video.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
    return true;
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
      marquee.flash('▶ PLAY');
    } else {
      video.pause();
      marquee.flash('❚❚ PAUSED');
    }
  }

  /** @param {number} seconds */
  function seekRelative(seconds) {
    if (!Number.isFinite(video.duration)) return;
    const next = Math.max(0, Math.min(video.duration, video.currentTime + seconds));
    video.currentTime = next;
  }

  /**
   * Resume / restart machinery. Pulls the saved scrub position for
   * `ep`, seeks the video as soon as `loadedmetadata` fires, and
   * shows the bottom-of-screen prompt for ~6s with focus on Resume.
   * The actual seek is unconditional — picking "From start" just
   * undoes it. This matches Netflix: the video is already at the
   * resume point when the prompt appears, so doing nothing is the
   * commit path.
   *
   * @param {Episode} ep
   */
  function armResumeFor(ep) {
    if (resumeArmed) {
      // Detach a previous arming if the user thrashed Prev/Next
      // before the metadata of the prior episode arrived.
      video.removeEventListener('loadedmetadata', resumeArmed);
      resumeArmed = null;
    }
    const saved = loadResumePosition(show.id, ep.season, ep.episode);
    if (!saved) return;
    const apply = () => {
      // Bail if the video swapped to a different episode while we
      // were still waiting on metadata (rapid Prev/Next).
      if (current !== ep) return;
      const target = Math.max(0, Math.min(saved.position, video.duration - 5));
      try {
        video.currentTime = target;
      } catch {
        /* some sources fail seeks before the buffer arrives */
      }
      showResumeOverlay(ep, target);
    };
    if (Number.isFinite(video.duration) && video.duration > 0) {
      apply();
    } else {
      resumeArmed = apply;
      video.addEventListener('loadedmetadata', apply, { once: true });
    }
  }

  /**
   * Render the resume prompt for the active episode. Auto-focus the
   * primary "Resume" button so a single OK confirms; auto-hides on
   * a 6s timer so the overlay doesn't sit on the screen forever.
   *
   * @param {Episode} ep
   * @param {number} resumeAt seconds the video has already seeked to
   */
  function showResumeOverlay(ep, resumeAt) {
    resumeTitle.textContent = `${describeEpisode(show, ep)} · ${formatClock(resumeAt)}`;
    resumeOverlay.classList.remove('hidden');
    if (resumeHideTimer) {
      clearTimeout(resumeHideTimer);
    }
    resumeHideTimer = setTimeout(hideResumeOverlay, 6000);
    // Defer focus until after the browser has finished its own focus
    // pass — otherwise spatial-nav can yank focus back to whatever
    // was active in the slot.
    setTimeout(() => {
      try {
        resumeBtn.focus();
      } catch {
        /* ignore */
      }
    }, 0);
  }

  function hideResumeOverlay() {
    resumeOverlay.classList.add('hidden');
    if (resumeHideTimer) {
      clearTimeout(resumeHideTimer);
      resumeHideTimer = null;
    }
  }

  /**
   * Persist the active scrub position for the current episode. Called
   * frequently (timeupdate throttle, pause, unmount) so it has to be
   * cheap and self-throttling. The 5-second floor keeps storage
   * writes well under 1Hz even during scrub-heavy sessions.
   */
  function snapshotPosition() {
    if (!current) return;
    const t = video.currentTime;
    const d = video.duration;
    if (!Number.isFinite(t) || !Number.isFinite(d) || d <= 0) return;
    const now = Date.now();
    if (now - lastSnapshotAt < 4000) return;
    lastSnapshotAt = now;
    saveResumePosition(show.id, current.season, current.episode, t, d);
  }

  /** Force a save regardless of throttle; used on unmount + pause. */
  function flushPosition() {
    lastSnapshotAt = 0;
    snapshotPosition();
  }

  /** @param {number} seconds */
  function formatClock(seconds) {
    const total = Math.max(0, Math.floor(seconds));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  /** @param {number} time Absolute seconds. Clamped to [0, duration]. */
  function seekTo(time) {
    if (!Number.isFinite(video.duration)) return;
    video.currentTime = Math.max(0, Math.min(video.duration, time));
  }

  /**
   * Restart the active episode from the beginning. Clears the saved
   * resume point so the next visit also starts fresh — otherwise the
   * "From start" button would only reset the current session and the
   * resume prompt would re-appear on the next entry.
   */
  function restartEpisode() {
    if (!current) return;
    clearResumePosition(show.id, current.season, current.episode);
    hideResumeOverlay();
    seekTo(0);
    marquee.flash('↺ FROM START');
    if (video.paused) {
      const p = video.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }
  }

  /** @param {number} fraction `0` → start, `0.9` → 90% in, etc. */
  function seekPercent(fraction) {
    if (!Number.isFinite(video.duration)) return;
    const clamped = Math.max(0, Math.min(1, fraction));
    video.currentTime = clamped * video.duration;
    marquee.flash(`⤳ ${Math.round(clamped * 100)}%`);
  }

  /** Marquee feedback for J/L; toggles direction glyph. @param {number} dt */
  function flashSeek(dt) {
    marquee.flash(dt < 0 ? `⏪ ${Math.abs(dt)}s` : `⏩ ${dt}s`);
  }

  /** @param {number} delta Added to `video.volume`, clamped [0, 1]. */
  function adjustVolume(delta) {
    const next = Math.max(0, Math.min(1, video.volume + delta));
    video.volume = next;
    // Bumping volume should un-mute — otherwise the on-screen change
    // is invisible until the user presses M, which feels broken.
    if (next > 0 && video.muted) video.muted = false;
    marquee.flash(`🔊 VOL ${Math.round(next * 100)}%`);
  }

  function toggleMute() {
    video.muted = !video.muted;
    marquee.flash(video.muted ? '🔇 MUTED' : '🔊 UNMUTED');
  }

  /**
   * Snap playback rate to the same 0.25-stop ladder YouTube uses
   * (0.25, 0.5, …, 2.0). Rounding to two decimals keeps floating-point
   * drift out of the marquee readout.
   *
   * @param {number} delta
   */
  function adjustPlaybackRate(delta) {
    const next = Math.max(0.25, Math.min(2, video.playbackRate + delta));
    video.playbackRate = Math.round(next * 100) / 100;
    marquee.flash(`⏱ ${video.playbackRate}×`);
  }

  /**
   * Fullscreen the screen element (video + overlays). Vendor-prefixed
   * fallbacks cover Safari, where `requestFullscreen()` is still only
   * on the webkit-prefixed variant for some surfaces.
   */
  function toggleFullscreen() {
    const fsEl =
      document.fullscreenElement || /** @type {any} */ (document).webkitFullscreenElement;
    if (fsEl) {
      const exit = document.exitFullscreen || /** @type {any} */ (document).webkitExitFullscreen;
      if (exit) exit.call(document);
      return;
    }
    const target = /** @type {any} */ (screen);
    const req = target.requestFullscreen || target.webkitRequestFullscreen;
    if (req) {
      try {
        const p = req.call(target);
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * Replace the URL with the active episode without pushing a history
   * entry. Stepping through 30 episodes shouldn't bury the browser
   * back button under 30 back presses. For movies the canonical URL
   * is just `?movie=<id>` (no S/E) regardless of how the user arrived.
   *
   * @param {Episode} ep
   */
  function updateDeepLink(ep) {
    const params = new URLSearchParams();
    if (isMovie) {
      params.set('movie', show.id);
    } else {
      params.set('show', show.id);
      params.set('s', String(ep.season));
      params.set('e', String(ep.episode));
    }
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
        img.alt = `${show.name} — S${pad(next.season)}E${pad(next.episode)}${
          next.title ? ` ${next.title}` : ''
        }`;
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
 * Random episode pick for shuffle mode. Skips season 0 (specials
 * mid-shuffle reads as a glitch) and biases away from `current`
 * unless it's the only one in the pool.
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
 * @param {ShowConfig | MovieConfig} show
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

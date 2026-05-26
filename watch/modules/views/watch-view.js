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

import { getMergedCatalog } from '../catalog.js';
import { createMarquee, createSummaryCard, describeEpisode, copyToClipboard, pad } from '../ui.js';
import { loadPrefs, savePrefs, saveLastEpisode } from '../prefs.js';

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
  screen.appendChild(video);
  screen.appendChild(loadingOverlay);
  screen.appendChild(noSignalOverlay);
  screen.appendChild(errorBanner);

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
  controls.appendChild(prevBtn);
  controls.appendChild(shuffleBtn);
  controls.appendChild(nextBtn);
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
    '<kbd>◀</kbd><kbd>▶</kbd> prev / next · <kbd>R</kbd> shuffle · <kbd>Space</kbd> play';

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
    if (prefs.autoplayNext) stepEpisode(1);
  });
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

/**
 * Simpleton TV entry module.
 *
 * Loaded as `<script type="module">` from index.html. Responsibilities:
 *   1. Fetch the season catalog from archive.org's `doh_20240725` item.
 *   2. Render the season chip row + episode grid.
 *   3. Wire the <video> element to the selected episode.
 *   4. Handle keyboard shortcuts, deep-links, autoplay-next, copy/share.
 *   5. Register Media Session handlers so OS-level / Bluetooth play-pause
 *      and hardware keys drive the player.
 *
 * The source files are MP4 (H.264 + AAC), so the browser plays sound
 * natively. No audio sidecar, no proxy, no sync. Casting to a TV is
 * delegated to the browser's built-in Cast / AirPlay UI on the video
 * element — works on Chrome (Android/desktop) and Safari (iOS/macOS).
 */

import { loadCatalog } from './modules/catalog.js';
import { loadDescriptions, makeKey as descKey } from './modules/descriptions.js';
import {
  setLoadingVisible,
  showNoSignal,
  renderSeasonChips,
  renderEpisodes,
  updateMarquee,
  bindCopyButtons,
  bindShareButton,
  describeEpisode
} from './modules/ui.js';

/** @typedef {import('./modules/catalog.js').Catalog} Catalog */
/** @typedef {import('./modules/catalog.js').Episode} Episode */

const STATE = {
  /** @type {Catalog|null} */
  catalog: null,
  /** @type {Episode|null} */
  current: null,
  /** @type {number} */
  currentSeason: 1,
  /** @type {((sn: number) => void) | null} */
  setActiveSeason: null,
  /** @type {((ep: Episode|null) => void) | null} */
  setActiveEpisode: null,
  /** Autoplay-next toggle, persisted to localStorage. */
  autoplayNext: true
};

const STORAGE_KEY = 'heyming.simpletons.v1';

function $(id) {
  return document.getElementById(id);
}

async function main() {
  setLoadingVisible(true);
  loadPrefs();

  bindCopyButtons(() => STATE.current);
  bindShareButton(() => STATE.current);
  bindButtons();
  bindKeyboard();
  bindVideoEvents();
  registerMediaSession();

  /** @type {Catalog} */
  let catalog;
  /** @type {Map<string, import('./modules/descriptions.js').EpisodeInfo>} */
  let descriptions;
  try {
    // Catalog is required; descriptions are best-effort and never throw.
    [catalog, descriptions] = await Promise.all([loadCatalog(), loadDescriptions()]);
  } catch (err) {
    showNoSignal(
      `Could not reach the Internet Archive — ${err && err.message ? err.message : 'unknown error'}`
    );
    return;
  }

  if (!catalog || catalog.total === 0) {
    showNoSignal('Catalog loaded, but no episodes were found.');
    return;
  }

  mergeDescriptions(catalog, descriptions);
  STATE.catalog = catalog;
  $('tv-total')?.replaceChildren(document.createTextNode(`${catalog.total}`));

  const seasonChips = /** @type {HTMLElement} */ ($('tv-season-chips'));

  STATE.setActiveSeason = renderSeasonChips(seasonChips, catalog.seasons, catalog.movie, (s) => {
    showSeason(s);
  });

  const initial = pickInitialEpisode(catalog);
  showSeason(initial.season, { skipRender: false });
  // Initial load: don't autoplay (browsers gate that) and don't yank the
  // page upward — the user hasn't asked us to focus the TV yet.
  playEpisode(initial, { autoplay: false, scrollToVideo: false });
  setLoadingVisible(false);
}

/**
 * Decide which episode to land on. Order of preference:
 *   1. `?s=N&e=N` from the URL (deep link).
 *   2. The last episode the user watched (localStorage).
 *   3. A random episode across all seasons.
 *
 * @param {Catalog} catalog
 * @returns {Episode}
 */
function pickInitialEpisode(catalog) {
  const params = new URLSearchParams(location.search);
  const s = Number(params.get('s'));
  const e = Number(params.get('e'));
  if (Number.isFinite(s) && Number.isFinite(e)) {
    if (s === 0 && catalog.movie) return catalog.movie;
    const season = catalog.seasons.find((x) => x.number === s);
    const ep = season?.episodes.find((x) => x.episode === e);
    if (ep) return ep;
  }

  const last = loadLastEpisode(catalog);
  if (last) return last;

  return randomEpisode(catalog);
}

/**
 * Graft TVMaze descriptions + episode stills onto each catalog Episode.
 * Mutates in place — keeps downstream UI code from juggling two maps.
 *
 * @param {Catalog} catalog
 * @param {Map<string, import('./modules/descriptions.js').EpisodeInfo>} descMap
 */
function mergeDescriptions(catalog, descMap) {
  if (!descMap || descMap.size === 0) return;
  for (const season of catalog.seasons) {
    for (const ep of season.episodes) {
      const info = descMap.get(descKey(ep.season, ep.episode));
      if (!info) continue;
      ep.description = info.summary || '';
      ep.image = info.image || null;
      ep.airdate = info.airdate || null;
      // TVMaze titles preserve `?` / `:` / etc. that filesystem-safe
      // file names had to mangle — prefer them when present.
      if (info.name) ep.title = info.name;
    }
  }
}

/** @param {Catalog} catalog */
function randomEpisode(catalog) {
  const pool = [];
  for (const season of catalog.seasons) pool.push(...season.episodes);
  if (catalog.movie) pool.push(catalog.movie);
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Swap the episode grid to show a different season. Defaults to keeping the
 * current selection highlighted, but won't render unless the season changes
 * or the user explicitly asks (e.g. on initial load).
 *
 * @param {number} seasonNumber  0 means the movie row.
 * @param {{ skipRender?: boolean }} [opts]
 */
function showSeason(seasonNumber, opts = {}) {
  if (!STATE.catalog) return;
  STATE.currentSeason = seasonNumber;
  STATE.setActiveSeason?.(seasonNumber);

  const episodes =
    seasonNumber === 0
      ? STATE.catalog.movie
        ? [STATE.catalog.movie]
        : []
      : STATE.catalog.seasons.find((s) => s.number === seasonNumber)?.episodes || [];

  const grid = /** @type {HTMLElement} */ ($('tv-ep-grid'));
  if (!opts.skipRender) {
    STATE.setActiveEpisode = renderEpisodes(grid, episodes, (ep) => playEpisode(ep));
  }
  STATE.setActiveEpisode?.(STATE.current);
}

/**
 * Load + start a given episode. Updates the video element, the marquee,
 * the URL, and localStorage. `autoplay: true` is the default — set to false
 * for the initial load so the user has to hit play (saves bandwidth and
 * dodges browser autoplay-with-sound restrictions).
 *
 * `scrollToVideo: true` (default) brings the player into view if it isn't
 * already — important on narrow viewports where the episode grid is below
 * the fold and clicking a card otherwise gives no visual feedback.
 *
 * @param {Episode} ep
 * @param {{ autoplay?: boolean, scrollToVideo?: boolean }} [opts]
 */
function playEpisode(ep, opts = {}) {
  if (!ep) return;
  const autoplay = opts.autoplay !== false;
  const scroll = opts.scrollToVideo !== false;

  STATE.current = ep;

  if (ep.season !== STATE.currentSeason) {
    showSeason(ep.season);
  } else {
    STATE.setActiveEpisode?.(ep);
  }

  updateMarquee(ep);
  updateDeepLink(ep);
  saveLastEpisode(ep);

  const video = /** @type {HTMLVideoElement|null} */ ($('tv-video'));
  if (!video) return;

  if (video.src !== ep.url) {
    video.src = ep.url;
    video.poster = ep.image || ep.thumbUrl || '';
  }
  video.load();

  if (autoplay) {
    const p = video.play();
    if (p && typeof p.catch === 'function') {
      p.catch(() => {
        // Browser blocked autoplay; the user can click play manually.
      });
    }
  }

  setFallbackLink(ep);
  hidePlaybackError();

  if (scroll) scrollToVideo();
}

/**
 * Scroll the page back to the top so the TV is in view. Browsers turn
 * the smooth animation into an instant jump when prefers-reduced-motion
 * is set, so we don't need a separate code path for that.
 */
function scrollToVideo() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function registerMediaSession() {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.setActionHandler('play', togglePlay);
    navigator.mediaSession.setActionHandler('pause', togglePlay);
    navigator.mediaSession.setActionHandler('nexttrack', () => stepEpisode(1));
    navigator.mediaSession.setActionHandler('previoustrack', () => stepEpisode(-1));
    navigator.mediaSession.setActionHandler('seekforward', (d) =>
      seekRelative(d && d.seekOffset ? d.seekOffset : 10)
    );
    navigator.mediaSession.setActionHandler('seekbackward', (d) =>
      seekRelative(-(d && d.seekOffset ? d.seekOffset : 10))
    );
  } catch {
    /* Some browsers reject specific actions; ignore. */
  }
}

/**
 * Step to the previous or next episode within the current season. Falls off
 * the ends by wrapping inside the same season — keeps the UX predictable.
 * The user can hop seasons via the season chips.
 *
 * @param {1 | -1} delta
 */
function stepEpisode(delta) {
  if (!STATE.catalog || !STATE.current) return;
  const ep = STATE.current;
  if (ep.season === 0) return;
  const season = STATE.catalog.seasons.find((s) => s.number === ep.season);
  if (!season || season.episodes.length === 0) return;
  const idx = season.episodes.findIndex((x) => x.episode === ep.episode && x.season === ep.season);
  const len = season.episodes.length;
  const next = (((idx + delta) % len) + len) % len;
  playEpisode(season.episodes[next]);
}

function shuffleEpisode() {
  if (!STATE.catalog) return;
  const ep = randomEpisode(STATE.catalog);
  if (ep) playEpisode(ep);
}

function bindButtons() {
  $('tv-prev')?.addEventListener('click', () => stepEpisode(-1));
  $('tv-next')?.addEventListener('click', () => stepEpisode(1));
  $('tv-shuffle')?.addEventListener('click', () => shuffleEpisode());

  const auto = /** @type {HTMLInputElement|null} */ ($('tv-autoplay'));
  if (auto) {
    auto.checked = STATE.autoplayNext;
    auto.addEventListener('change', () => {
      STATE.autoplayNext = auto.checked;
      savePrefs();
    });
  }
}

function bindKeyboard() {
  document.addEventListener('keydown', (e) => {
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
        shuffleEpisode();
        break;
    }
  });
}

/** Toggle the player's play/pause state. Used by the Media Session API. */
function togglePlay() {
  const video = /** @type {HTMLVideoElement|null} */ ($('tv-video'));
  if (!video) return;
  if (video.paused || video.ended) {
    const p = video.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } else {
    video.pause();
  }
}

/** @param {number} seconds */
function seekRelative(seconds) {
  const video = /** @type {HTMLVideoElement|null} */ ($('tv-video'));
  if (!video || !Number.isFinite(video.duration)) return;
  const next = Math.max(0, Math.min(video.duration, video.currentTime + seconds));
  video.currentTime = next;
}

function bindVideoEvents() {
  const video = /** @type {HTMLVideoElement|null} */ ($('tv-video'));
  if (!video) return;

  video.addEventListener('ended', () => {
    if (STATE.autoplayNext) stepEpisode(1);
  });

  video.addEventListener('error', () => {
    showPlaybackError();
  });
}

/* ----- Playback-error fallback --------------------------------------- */

/** @param {Episode} ep */
function setFallbackLink(ep) {
  const link = /** @type {HTMLAnchorElement|null} */ ($('tv-archive-link'));
  if (link) link.href = ep.archiveUrl;
}

/** @param {string} [message] */
function showPlaybackError(message) {
  const el = $('tv-playback-error');
  if (!el) return;
  el.classList.remove('hidden');
  if (message) {
    const p = el.querySelector('p');
    if (p) p.textContent = message;
  }
}

function hidePlaybackError() {
  $('tv-playback-error')?.classList.add('hidden');
}

/* ----- Deep link + localStorage -------------------------------------- */

/** @param {Episode} ep */
function updateDeepLink(ep) {
  const params = new URLSearchParams(location.search);
  params.set('s', String(ep.season));
  params.set('e', String(ep.episode));
  const url = `${location.pathname}?${params.toString()}`;
  history.replaceState(null, '', url);
}

/** @param {Catalog} catalog */
function loadLastEpisode(catalog) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const s = Number(parsed?.lastSeason);
    const e = Number(parsed?.lastEpisode);
    if (!Number.isFinite(s) || !Number.isFinite(e)) return null;
    if (s === 0 && catalog.movie) return catalog.movie;
    const season = catalog.seasons.find((x) => x.number === s);
    return season?.episodes.find((x) => x.episode === e) || null;
  } catch {
    return null;
  }
}

/** @param {Episode} ep */
function saveLastEpisode(ep) {
  try {
    const prev = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...prev, lastSeason: ep.season, lastEpisode: ep.episode })
    );
  } catch {
    /* localStorage unavailable; skip */
  }
}

function loadPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    if (typeof raw.autoplayNext === 'boolean') STATE.autoplayNext = raw.autoplayNext;
  } catch {
    /* defaults */
  }
}

function savePrefs() {
  try {
    const prev = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...prev, autoplayNext: STATE.autoplayNext })
    );
  } catch {
    /* skip */
  }
}

// Expose for window-level consumers (analytics, share-button fallback).
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'currentEpisodeData', {
    get() {
      const ep = STATE.current;
      return ep ? { url: location.href, title: describeEpisode(ep), episode: ep } : null;
    },
    configurable: true
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}

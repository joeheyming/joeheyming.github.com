/**
 * Episodes view — per-show season + episode browser.
 *
 * Loads the merged catalog for the active show, renders a season-chip
 * row + an episode grid. Clicking an episode card navigates to the
 * watch view via `ctx.navigate({ show, s, e })`. There is no <video>
 * element in this view's DOM.
 *
 * The view picks an initial active season from the URL (`?s=N`) so
 * deep-linking to a specific season works (`/watch/?show=southpark&s=5`).
 * Otherwise it lands on the season of the last-watched episode for
 * that show, or season 1.
 */

import { getMergedCatalog } from '../catalog.js';
import { renderSeasonChips, renderEpisodes } from '../ui.js';
import { loadLastEpisode } from '../prefs.js';
import { isTvMode } from '../mode.js';
import { applyRovingTabindex } from '../roving-tabindex.js';

/** @typedef {import('../shows.js').ShowConfig} ShowConfig */
/** @typedef {import('../catalog.js').Catalog} Catalog */
/** @typedef {import('../catalog.js').Episode} Episode */

/**
 * @typedef {Object} MountCtx
 * @property {ShowConfig} show
 * @property {URLSearchParams} params       Current URL query string.
 * @property {(params: { show?: string, s?: number, e?: number }) => void} navigate
 */

/**
 * @param {HTMLElement} slot
 * @param {MountCtx} ctx
 * @returns {Promise<{ unmount: () => void }>}
 */
export async function mount(slot, ctx) {
  const { show, navigate } = ctx;

  const root = document.createElement('section');
  root.className = 'tv-episodes';

  // Header banner — show name + tagline + IA item link
  const banner = document.createElement('div');
  banner.className = 'tv-show-banner';
  banner.style.setProperty('--show-accent', show.accent);
  const bannerEmoji = document.createElement('span');
  bannerEmoji.className = 'tv-show-banner-emoji';
  bannerEmoji.textContent = show.emoji;
  const bannerText = document.createElement('div');
  bannerText.className = 'tv-show-banner-text';
  const bannerName = document.createElement('h2');
  bannerName.className = 'tv-show-banner-name';
  bannerName.textContent = show.name;
  const bannerTagline = document.createElement('p');
  bannerTagline.className = 'tv-show-banner-tag';
  bannerTagline.textContent = show.tagline;
  bannerText.appendChild(bannerName);
  bannerText.appendChild(bannerTagline);
  banner.appendChild(bannerEmoji);
  banner.appendChild(bannerText);

  // Loading state
  const loading = document.createElement('div');
  loading.className = 'tv-inline-loading';
  loading.textContent = 'Loading channel guide…';

  // Section containers (filled in after catalog loads)
  const seasonSection = document.createElement('div');
  seasonSection.className = 'tv-section';
  const seasonLabel = document.createElement('div');
  seasonLabel.className = 'tv-section-label';
  const seasonLabelText = document.createElement('span');
  seasonLabelText.textContent = 'Seasons';
  const seasonMeta = document.createElement('span');
  seasonMeta.className = 'tv-section-meta';
  seasonLabel.appendChild(seasonLabelText);
  seasonLabel.appendChild(seasonMeta);
  const chipRow = document.createElement('div');
  chipRow.className = 'tv-chip-row';
  chipRow.setAttribute('role', 'tablist');
  seasonSection.appendChild(seasonLabel);
  seasonSection.appendChild(chipRow);

  const grid = document.createElement('div');
  grid.className = 'tv-ep-grid';

  const epSection = document.createElement('div');
  epSection.className = 'tv-section';
  const epLabel = document.createElement('div');
  epLabel.className = 'tv-section-label';
  epLabel.textContent = 'Episodes';
  epSection.appendChild(epLabel);
  epSection.appendChild(grid);

  // Shuffle pill above the grid — quick way to land on a random episode
  // without clicking through. Hidden until catalog loads.
  const tools = document.createElement('div');
  tools.className = 'tv-ep-tools hidden';
  const shuffle = document.createElement('button');
  shuffle.type = 'button';
  shuffle.className = 'tv-btn is-accent';
  shuffle.textContent = '⇄ Shuffle';
  tools.appendChild(shuffle);

  root.appendChild(banner);
  root.appendChild(loading);
  slot.appendChild(root);

  /** @type {AbortController} */
  const abort = new AbortController();
  /** @type {Catalog | null} */
  let catalog = null;
  /** @type {((sn: number) => void) | null} */
  let setActiveSeason = null;
  let currentSeason = 1;

  try {
    catalog = await getMergedCatalog(show);
  } catch (err) {
    loading.remove();
    const errBox = document.createElement('div');
    errBox.className = 'tv-error-banner';
    errBox.textContent = `Could not reach the Internet Archive — ${
      err && /** @type {Error} */ (err).message
        ? /** @type {Error} */ (err).message
        : 'unknown error'
    }`;
    root.appendChild(errBox);
    return { unmount: () => root.remove() };
  }

  if (abort.signal.aborted) return { unmount: () => root.remove() };
  loading.remove();

  if (!catalog || catalog.total === 0) {
    const errBox = document.createElement('div');
    errBox.className = 'tv-error-banner';
    errBox.textContent = 'Catalog loaded, but no episodes were found.';
    root.appendChild(errBox);
    return { unmount: () => root.remove() };
  }

  seasonMeta.textContent = `${catalog.total} episodes`;
  root.appendChild(seasonSection);
  root.appendChild(tools);
  tools.classList.remove('hidden');
  root.appendChild(epSection);

  setActiveSeason = renderSeasonChips(chipRow, catalog.seasons, catalog.movie, (s) => {
    showSeason(s, { push: true });
  });

  // Roving-tabindex ONLY on the 2D episode grid. The chip row is
  // one-dimensional (single horizontal strip) so the WebView's native
  // spatial navigation handles left/right within it perfectly without
  // a managed cursor — and crucially, leaving it as plain natural
  // focus means every chip stays at `tabindex=0`, so arrow-up from
  // the first episode card lands on the nearest chip instead of
  // skipping over the whole row to the breadcrumbs (which is what
  // happens when 7 of 8 chips have `tabindex=-1` from a roving
  // helper — Chromium's spatial-nav excludes those).
  const gridRoving = applyRovingTabindex(grid, { selector: '.tv-ep-card' });

  // Decide which season to show first: URL ?s, then last-watched, then 1.
  // Guard against missing `?s` — `Number(null)` is 0 and would otherwise
  // route every fresh `?show=X` landing to the movie tab.
  const urlSeasonRaw = ctx.params.get('s');
  const urlSeason = urlSeasonRaw === null ? Number.NaN : Number(urlSeasonRaw);
  let initialSeason = Number.NaN;
  if (Number.isFinite(urlSeason)) {
    if (urlSeason === 0 && catalog.movie) initialSeason = 0;
    else if (catalog.seasons.some((sx) => sx.number === urlSeason)) initialSeason = urlSeason;
  }
  if (!Number.isFinite(initialSeason)) {
    const last = loadLastEpisode(show.id);
    if (last && catalog.seasons.some((sx) => sx.number === last.lastSeason)) {
      initialSeason = last.lastSeason;
    } else {
      initialSeason = catalog.seasons[0]?.number ?? 1;
    }
  }
  showSeason(initialSeason, { push: false });

  // On TV mode, drop the user straight onto the first episode card so
  // the remote can press OK to start watching. Skipped on desktop.
  if (isTvMode) gridRoving.focusFirst();

  shuffle.addEventListener('click', () => {
    if (!catalog) return;
    const ep = randomEpisode(catalog);
    if (ep) {
      navigate({ show: show.id, s: ep.season, e: ep.episode });
    }
  });

  /**
   * @param {number} seasonNumber  0 = movie / specials.
   * @param {{ push?: boolean }} [opts]   Whether to update the URL.
   */
  function showSeason(seasonNumber, opts = {}) {
    if (!catalog) return;
    currentSeason = seasonNumber;
    setActiveSeason?.(seasonNumber);
    const episodes =
      seasonNumber === 0
        ? catalog.movie
          ? [catalog.movie]
          : catalog.seasons.find((sx) => sx.number === 0)?.episodes || []
        : catalog.seasons.find((sx) => sx.number === seasonNumber)?.episodes || [];
    renderEpisodes(grid, episodes, (ep) => {
      navigate({ show: show.id, s: ep.season, e: ep.episode });
    });
    // Episode cards just got rebuilt; tell the roving helper to
    // re-scan so its tabindex assignments + cursor stay valid.
    gridRoving.refresh();
    // Reflect the chosen season in the URL so refresh / share preserves it.
    if (opts.push !== false) {
      const params = new URLSearchParams();
      params.set('show', show.id);
      params.set('s', String(seasonNumber));
      const url = `${location.pathname}?${params.toString()}`;
      history.replaceState(null, '', url);
    }
  }

  return {
    unmount() {
      abort.abort();
      gridRoving.dispose();
      root.remove();
    }
  };
}

/** @param {Catalog} catalog */
function randomEpisode(catalog) {
  const pool = [];
  for (const season of catalog.seasons) pool.push(...season.episodes);
  if (catalog.movie) pool.push(catalog.movie);
  return pool[Math.floor(Math.random() * pool.length)];
}

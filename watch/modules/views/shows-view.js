/**
 * Shows view — the /watch/ landing page.
 *
 * A poster grid of every show in the registry. Clicking a card
 * navigates to that show's episodes view via `ctx.navigate({ show })`.
 *
 * Above the grid we surface a "Continue watching" row built from the
 * per-show resume entries in localStorage (see `prefs.js`). It's only
 * rendered when there's at least one entry; each card links straight
 * to the last-watched episode and ships with a ✕ button so users can
 * forget shows they've finished or no longer want listed.
 *
 * The poster URLs come from TVMaze; we cache the resolved image
 * locations in localStorage so subsequent visits don't redo the
 * lookup. If a lookup fails the card falls back to an emoji.
 */

import { SHOWS, getShow } from '../shows.js';
import { listContinueWatching, clearLastEpisode } from '../prefs.js';
import {
  listSaved as listOfflineSaved,
  deleteSavedEpisode as deleteOfflineEpisode,
  formatBytes
} from '../offline.js';

/** @typedef {import('../shows.js').ShowConfig} ShowConfig */

/**
 * @typedef {Object} MountCtx
 * @property {(params: { show?: string, s?: number, e?: number }) => void} navigate
 */

/**
 * @param {HTMLElement} slot
 * @param {MountCtx} ctx
 * @returns {{ unmount: () => void }}
 */
export function mount(slot, ctx) {
  const root = document.createElement('section');
  root.className = 'tv-landing';

  const intro = document.createElement('div');
  intro.className = 'tv-landing-intro';
  const introTitle = document.createElement('h1');
  introTitle.className = 'tv-landing-title';
  introTitle.textContent = '📺 Watch';
  const introBlurb = document.createElement('p');
  introBlurb.className = 'tv-landing-blurb';
  introBlurb.textContent =
    'Smart-TV style player that streams classic TV series straight from the Internet Archive. No accounts, no ads — MP4 over HTTPS. Cast to a Chromecast or AirPlay receiver from the player.';
  intro.appendChild(introTitle);
  intro.appendChild(introBlurb);

  // Continue-watching row. Lives between the intro and the grid; the
  // wrapper stays in the DOM even when there are no entries so the
  // ✕ button on the last card can re-render it back to empty/hidden
  // without poking at sibling layout.
  const continueSection = document.createElement('div');
  continueSection.className = 'tv-continue-section hidden';
  const continueLabel = document.createElement('div');
  continueLabel.className = 'tv-section-label';
  const continueLabelText = document.createElement('span');
  continueLabelText.textContent = 'Continue watching';
  const continueLabelMeta = document.createElement('span');
  continueLabelMeta.className = 'tv-section-meta';
  continueLabelMeta.textContent = 'tap ✕ to remove';
  continueLabel.appendChild(continueLabelText);
  continueLabel.appendChild(continueLabelMeta);
  const continueGrid = document.createElement('div');
  continueGrid.className = 'tv-continue-grid';
  continueSection.appendChild(continueLabel);
  continueSection.appendChild(continueGrid);

  // Saved-offline row. Sits between Continue watching and the show
  // grid so the user's most-active state (cached episodes ready to
  // play with no network) is closest to the fold. Hidden when empty.
  const savedSection = document.createElement('div');
  savedSection.className = 'tv-saved-section hidden';
  const savedLabel = document.createElement('div');
  savedLabel.className = 'tv-section-label';
  const savedLabelText = document.createElement('span');
  savedLabelText.textContent = 'Saved offline';
  const savedLabelMeta = document.createElement('span');
  savedLabelMeta.className = 'tv-section-meta';
  savedLabel.appendChild(savedLabelText);
  savedLabel.appendChild(savedLabelMeta);
  const savedGrid = document.createElement('div');
  savedGrid.className = 'tv-saved-grid';
  savedSection.appendChild(savedLabel);
  savedSection.appendChild(savedGrid);

  const grid = document.createElement('div');
  grid.className = 'tv-show-grid';
  grid.setAttribute('role', 'list');
  for (const show of SHOWS) {
    grid.appendChild(makeShowCard(show, ctx));
  }

  root.appendChild(intro);
  root.appendChild(continueSection);
  root.appendChild(savedSection);
  root.appendChild(grid);
  slot.appendChild(root);

  renderContinue(continueSection, continueGrid, ctx);
  void renderSaved(savedSection, savedGrid, savedLabelMeta, ctx);

  return {
    unmount() {
      root.remove();
    }
  };
}

/**
 * Build / rebuild the continue-watching row. Called once on mount and
 * again after every successful remove so the row reflects storage
 * without a full page reload.
 *
 * @param {HTMLElement} section
 * @param {HTMLElement} gridEl
 * @param {MountCtx} ctx
 */
function renderContinue(section, gridEl, ctx) {
  const entries = listContinueWatching();
  gridEl.replaceChildren();
  let rendered = 0;
  for (const entry of entries) {
    const show = getShow(entry.showId);
    if (!show) continue; // stale entry for a show we no longer ship
    gridEl.appendChild(
      makeContinueCard(show, entry, ctx, () => renderContinue(section, gridEl, ctx))
    );
    rendered += 1;
  }
  section.classList.toggle('hidden', rendered === 0);
}

/**
 * Build / rebuild the offline-cache row from IndexedDB. Re-runs after
 * each remove. The label's meta text gets the cumulative footprint so
 * users can see how much disk their saves are taking.
 *
 * @param {HTMLElement} section
 * @param {HTMLElement} gridEl
 * @param {HTMLElement} metaEl
 * @param {MountCtx} ctx
 */
async function renderSaved(section, gridEl, metaEl, ctx) {
  const entries = await listOfflineSaved();
  gridEl.replaceChildren();
  if (entries.length === 0) {
    section.classList.add('hidden');
    metaEl.textContent = '';
    return;
  }
  section.classList.remove('hidden');
  let total = 0;
  for (const meta of entries) {
    total += Number(meta.sizeBytes) || 0;
    gridEl.appendChild(makeSavedCard(meta, ctx, () => renderSaved(section, gridEl, metaEl, ctx)));
  }
  metaEl.textContent = `${entries.length} ${
    entries.length === 1 ? 'episode' : 'episodes'
  } · ${formatBytes(total)} · tap ✕ to delete`;
}

/**
 * @param {import('../offline.js').SavedEpisodeMeta} meta
 * @param {MountCtx} ctx
 * @param {() => void} onChange
 */
function makeSavedCard(meta, ctx, onChange) {
  const card = document.createElement('a');
  card.className = 'tv-continue-card tv-saved-card';
  card.style.setProperty('--show-accent', meta.showAccent || 'var(--tv-accent)');
  const query = new URLSearchParams({
    show: meta.showId,
    s: String(meta.season),
    e: String(meta.episode)
  });
  card.href = `?${query.toString()}`;

  const thumb = document.createElement('div');
  thumb.className = 'tv-continue-thumb';
  thumb.style.background = `linear-gradient(160deg, ${meta.showAccent || '#444'}33, #111)`;
  if (meta.thumbUrl) {
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = '';
    img.src = meta.thumbUrl;
    img.addEventListener(
      'error',
      () => {
        img.remove();
        thumb.classList.add('is-empty');
        thumb.textContent = meta.showEmoji || '📺';
      },
      { once: true }
    );
    thumb.appendChild(img);
  } else {
    thumb.classList.add('is-empty');
    thumb.textContent = meta.showEmoji || '📺';
  }

  const play = document.createElement('div');
  play.className = 'tv-continue-play';
  play.textContent = '▶';
  thumb.appendChild(play);

  // "Offline" chip in the corner doubles as visual confirmation that
  // this card plays without a network — the home page renders the
  // Continue-watching row right above with very similar styling.
  const badge = document.createElement('span');
  badge.className = 'tv-saved-badge';
  badge.textContent = '💾 Offline';
  thumb.appendChild(badge);

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'tv-continue-remove';
  remove.setAttribute(
    'aria-label',
    `Delete saved copy of ${meta.showName} S${pad(meta.season)}E${pad(meta.episode)}`
  );
  remove.title = 'Delete this cached episode';
  remove.textContent = '✕';
  thumb.appendChild(remove);

  const body = document.createElement('div');
  body.className = 'tv-continue-meta';
  const showLine = document.createElement('div');
  showLine.className = 'tv-continue-show';
  showLine.textContent = `${meta.showEmoji || '📺'} ${meta.showName}`;
  const tagLine = document.createElement('div');
  tagLine.className = 'tv-continue-tag';
  const epLabel = meta.season === 0 ? 'Movie' : `S${pad(meta.season)}E${pad(meta.episode)}`;
  tagLine.textContent = meta.title ? `${epLabel} · ${meta.title}` : epLabel;
  const sizeLine = document.createElement('div');
  sizeLine.className = 'tv-saved-size';
  sizeLine.textContent = formatBytes(meta.sizeBytes);
  body.appendChild(showLine);
  body.appendChild(tagLine);
  body.appendChild(sizeLine);

  card.appendChild(thumb);
  card.appendChild(body);

  remove.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    // Confirm destructive action — saved videos take real disk, but
    // re-downloading is also free, so we keep the prompt minimal.
    if (!window.confirm(`Delete the cached copy of "${meta.title || epLabel}"?`)) return;
    await deleteOfflineEpisode(meta.showId, meta.season, meta.episode);
    onChange();
  });
  card.addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
    e.preventDefault();
    ctx.navigate({ show: meta.showId, s: meta.season, e: meta.episode });
  });

  return card;
}

/**
 * @param {ShowConfig} show
 * @param {{ season: number, episode: number }} entry
 * @param {MountCtx} ctx
 * @param {() => void} onChange  Called after a successful remove so the
 *                               caller can re-render the row.
 */
function makeContinueCard(show, entry, ctx, onChange) {
  const card = document.createElement('a');
  card.className = 'tv-continue-card';
  card.style.setProperty('--show-accent', show.accent);
  const query = new URLSearchParams({
    show: show.id,
    s: String(entry.season),
    e: String(entry.episode)
  });
  card.href = `?${query.toString()}`;

  const thumb = document.createElement('div');
  thumb.className = 'tv-continue-thumb';
  thumb.style.background = `linear-gradient(160deg, ${show.accent}33, #111)`;
  const img = document.createElement('img');
  img.loading = 'lazy';
  img.decoding = 'async';
  img.alt = '';
  fetchPoster(show.tvmazeId).then((url) => {
    if (url) img.src = url;
  });
  img.addEventListener(
    'error',
    () => {
      img.remove();
      thumb.classList.add('is-empty');
      thumb.textContent = show.emoji;
    },
    { once: true }
  );
  thumb.appendChild(img);

  // Play glyph overlays the thumb on hover/focus — same affordance as
  // the per-show episode cards so users read it as a video tile.
  const play = document.createElement('div');
  play.className = 'tv-continue-play';
  play.textContent = '▶';
  thumb.appendChild(play);

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'tv-continue-remove';
  remove.setAttribute('aria-label', `Remove ${show.name} from Continue watching`);
  remove.title = 'Remove from Continue watching';
  remove.textContent = '✕';
  thumb.appendChild(remove);

  const meta = document.createElement('div');
  meta.className = 'tv-continue-meta';
  const showName = document.createElement('div');
  showName.className = 'tv-continue-show';
  showName.textContent = `${show.emoji} ${show.shortName}`;
  const tag = document.createElement('div');
  tag.className = 'tv-continue-tag';
  tag.textContent =
    entry.season === 0 ? show.movieTitle || 'Movie' : `S${pad(entry.season)}E${pad(entry.episode)}`;
  meta.appendChild(showName);
  meta.appendChild(tag);

  card.appendChild(thumb);
  card.appendChild(meta);

  remove.addEventListener('click', (e) => {
    // ✕ sits inside the <a>, so we have to cancel the link nav on
    // every modifier combination — otherwise ⌘-click on the corner
    // would still open the watch view in a new tab.
    e.preventDefault();
    e.stopPropagation();
    clearLastEpisode(show.id);
    onChange();
  });
  card.addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
    e.preventDefault();
    ctx.navigate({ show: show.id, s: entry.season, e: entry.episode });
  });

  return card;
}

/**
 * @param {ShowConfig} show
 * @param {MountCtx} ctx
 */
function makeShowCard(show, ctx) {
  const card = document.createElement('a');
  card.className = 'tv-show-card';
  card.style.setProperty('--show-accent', show.accent);
  card.setAttribute('data-show', show.id);
  card.href = `?show=${encodeURIComponent(show.id)}`;
  card.setAttribute('role', 'listitem');

  const poster = document.createElement('div');
  poster.className = 'tv-show-poster';
  poster.style.background = `linear-gradient(160deg, ${show.accent}33, #111)`;

  const img = document.createElement('img');
  img.loading = 'lazy';
  img.decoding = 'async';
  img.alt = '';
  // Asynchronously resolve the actual poster URL — until then the
  // gradient background fills the tile so we don't show a broken icon.
  fetchPoster(show.tvmazeId).then((url) => {
    if (url) img.src = url;
  });
  img.addEventListener(
    'error',
    () => {
      img.remove();
      poster.classList.add('is-empty');
      poster.textContent = show.emoji;
    },
    { once: true }
  );
  poster.appendChild(img);

  const meta = document.createElement('div');
  meta.className = 'tv-show-meta';
  const name = document.createElement('h2');
  name.className = 'tv-show-name';
  name.textContent = `${show.emoji} ${show.name}`;
  const tag = document.createElement('p');
  tag.className = 'tv-show-tag';
  tag.textContent = show.tagline;
  meta.appendChild(name);
  meta.appendChild(tag);

  card.appendChild(poster);
  card.appendChild(meta);
  card.addEventListener('click', (e) => {
    // Let middle-click / ⌘-click open in a new tab as the user expects;
    // otherwise route in-app so we don't blow away in-memory state.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
    e.preventDefault();
    ctx.navigate({ show: show.id });
  });
  return card;
}

/**
 * Memoized TVMaze poster lookup. Returns the medium-sized URL or null.
 * localStorage cache lives ~30 days; we'd rather show a slightly stale
 * poster than block the grid on a network round-trip.
 *
 * @param {number} tvmazeId
 * @returns {Promise<string|null>}
 */
async function fetchPoster(tvmazeId) {
  const key = `heyming.watch.poster.${tvmazeId}`;
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const cached = JSON.parse(raw);
      if (cached && Date.now() - cached.ts < 30 * 24 * 60 * 60 * 1000) {
        return cached.url || null;
      }
    }
  } catch {
    /* refetch on parse error */
  }
  try {
    const res = await fetch(`https://api.tvmaze.com/shows/${tvmazeId}/images`, {
      credentials: 'omit'
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data)) return null;
    // Posters are vertical (book-cover proportions) which suits TV-guide tiles.
    // Fall back to anything with a `medium` resolution if no poster is tagged.
    const posters = data.filter((img) => img?.type === 'poster' && img?.resolutions);
    const pick = posters[0] || data.find((img) => img?.resolutions) || null;
    const url = pick?.resolutions?.medium?.url || pick?.resolutions?.original?.url || null;
    try {
      localStorage.setItem(key, JSON.stringify({ ts: Date.now(), url }));
    } catch {
      /* quota; we just refetch next visit */
    }
    return url;
  } catch {
    return null;
  }
}

function pad(n) {
  return String(n).padStart(2, '0');
}

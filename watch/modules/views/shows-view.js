/**
 * Shows view — the /watch/ landing page.
 *
 * A poster grid of every show in the registry. Clicking a card
 * navigates to that show's episodes view via `ctx.navigate({ show })`.
 *
 * The poster URLs come from TVMaze; we cache the resolved image
 * locations in localStorage so subsequent visits don't redo the
 * lookup. If a lookup fails the card falls back to an emoji.
 */

import { SHOWS } from '../shows.js';

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
    'Smart-TV style player that streams classic animated series straight from the Internet Archive. No accounts, no ads — MP4 over HTTPS. Cast to a Chromecast or AirPlay receiver from the player.';
  intro.appendChild(introTitle);
  intro.appendChild(introBlurb);

  const grid = document.createElement('div');
  grid.className = 'tv-show-grid';
  grid.setAttribute('role', 'list');
  for (const show of SHOWS) {
    grid.appendChild(makeShowCard(show, ctx));
  }

  root.appendChild(intro);
  root.appendChild(grid);
  slot.appendChild(root);

  return {
    unmount() {
      root.remove();
    }
  };
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

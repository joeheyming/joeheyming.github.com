/**
 * /watch/ router.
 *
 * URL shape is `?show=<id>&s=<n>&e=<n>` (static-hosting friendly). One
 * route function reads `location.search`, picks the right view module,
 * unmounts the previous view, and mounts the new one into the
 * `<main id="tv-view">` slot.
 *
 * `popstate` re-runs the router so the browser back button (and any
 * deep-link refresh) Just Works.
 */

// Side-effect import: mode.js stamps `data-mode` + `data-modality`
// on <html> at module-load time and wires up the modality flippers.
// It MUST run before any view mounts so view code can branch on
// `isTvMode` consistently from first paint.
import './modules/mode.js';
import { getShow } from './modules/shows.js';
import { renderBreadcrumbs } from './modules/breadcrumbs.js';

/** @typedef {import('./modules/shows.js').ShowConfig} ShowConfig */

/**
 * @typedef {Object} ViewHandle
 * @property {() => void} unmount
 * @property {(s: number, e: number) => void} [jumpTo]
 *   Only watch-view supports this; used when the next URL is "same view
 *   different episode" so we don't re-mount the whole player.
 */

/**
 * Tracks the currently-mounted view so `route()` can decide between
 * a hot update (`jumpTo`) and a full unmount/mount cycle.
 *
 * @type {{ name: string, showId: string | null, handle: ViewHandle } | null}
 */
let current = null;

function $(id) {
  return document.getElementById(id);
}

async function main() {
  window.addEventListener('popstate', () => {
    void route();
  });
  await route();
}

/**
 * Parse `?s` / `?e` from a URLSearchParams. Returns NaN when the key
 * is absent — guarding against `Number(params.get('s'))` returning
 * `0` for missing params (because `Number(null) === 0`), which would
 * otherwise route a bare `?show=X` URL into the watch view at S00E00.
 *
 * @param {URLSearchParams} params
 * @param {string} key
 */
function readNum(params, key) {
  const raw = params.get(key);
  return raw === null ? Number.NaN : Number(raw);
}

/** Read the URL and mount whichever view it asks for. */
async function route() {
  const params = new URLSearchParams(location.search);
  const showId = params.get('show');
  const s = readNum(params, 's');
  const e = readNum(params, 'e');
  const show = showId ? getShow(showId) : null;

  // ---- Decide which view ---------------------------------------------
  let nextView;
  if (!show) {
    nextView = 'shows';
  } else if (Number.isFinite(s) && Number.isFinite(e)) {
    nextView = 'watch';
  } else {
    nextView = 'episodes';
  }

  // Hot path: same show + same view + same view supports updates →
  // call `jumpTo` instead of re-mounting. Currently only the watch
  // view does (so Prev/Next on the URL doesn't reload the video chrome).
  if (
    nextView === 'watch' &&
    current?.name === 'watch' &&
    current.showId === show?.id &&
    current.handle.jumpTo
  ) {
    current.handle.jumpTo(s, e);
    setBreadcrumbsFor(nextView, show, params);
    return;
  }

  // ---- Tear down the previous view -----------------------------------
  current?.handle.unmount();
  current = null;
  const slot = $('tv-view');
  if (slot) slot.replaceChildren();

  // ---- Mount the new one ---------------------------------------------
  if (!slot) return;
  setBreadcrumbsFor(nextView, show, params);
  setPageTitle(nextView, show, params);

  if (nextView === 'shows') {
    const mod = await import('./modules/views/shows-view.js');
    const handle = await mod.mount(slot, { navigate });
    current = { name: 'shows', showId: null, handle };
    document.documentElement.style.removeProperty('--tv-accent');
    return;
  }

  if (nextView === 'episodes' && show) {
    const mod = await import('./modules/views/episodes-view.js');
    document.documentElement.style.setProperty('--tv-accent', show.accent);
    const handle = await mod.mount(slot, { show, params, navigate });
    current = { name: 'episodes', showId: show.id, handle };
    return;
  }

  if (nextView === 'watch' && show) {
    const mod = await import('./modules/views/watch-view.js');
    document.documentElement.style.setProperty('--tv-accent', show.accent);
    const handle = await mod.mount(slot, {
      show,
      initialSeason: s,
      initialEpisode: e,
      navigate,
      setBreadcrumbTitle: (label) => updateBreadcrumbCurrent(label)
    });
    current = { name: 'watch', showId: show.id, handle };
    return;
  }

  // Fallback — should be unreachable.
  navigate({});
}

/**
 * Programmatic navigation. Pushes a new history entry by default so
 * the browser back button steps through view changes (catalog → show →
 * episode). Pass `{ replace: true }` to update the URL without growing
 * history (used e.g. when the watch view changes seasons internally).
 *
 * @param {{ show?: string, s?: number, e?: number }} update
 * @param {{ replace?: boolean }} [opts]
 */
function navigate(update, opts = {}) {
  const params = new URLSearchParams();
  if (update.show) params.set('show', update.show);
  if (typeof update.s === 'number') params.set('s', String(update.s));
  if (typeof update.e === 'number') params.set('e', String(update.e));
  const qs = params.toString();
  const url = qs ? `${location.pathname}?${qs}` : location.pathname;
  if (opts.replace) history.replaceState(null, '', url);
  else history.pushState(null, '', url);
  void route();
}

/**
 * Set up the breadcrumb trail for the given view + show. The watch
 * view then updates the trailing crumb's label once it knows the
 * episode title (see `setBreadcrumbTitle` in MountCtx).
 *
 * @param {'shows'|'episodes'|'watch'} view
 * @param {ShowConfig|null} show
 * @param {URLSearchParams} params
 */
function setBreadcrumbsFor(view, show, params) {
  const slot = $('tv-breadcrumbs');
  if (!slot) return;
  const crumbs = [];
  if (view === 'shows') {
    crumbs.push({ label: '📺 Watch' });
  } else if (view === 'episodes' && show) {
    crumbs.push({ label: 'Watch', emoji: '📺', href: '' });
    crumbs.push({ label: show.name, emoji: show.emoji });
  } else if (view === 'watch' && show) {
    crumbs.push({ label: 'Watch', emoji: '📺', href: '' });
    crumbs.push({
      label: show.name,
      emoji: show.emoji,
      href: `?show=${encodeURIComponent(show.id)}`
    });
    // Initial placeholder; the watch view updates it once the episode
    // is resolved against the catalog.
    const s = Number(params.get('s'));
    const e = Number(params.get('e'));
    const seasonLabel = s === 0 ? 'Movie' : `S${pad(s)}E${pad(e)}`;
    crumbs.push({ label: seasonLabel });
  }
  renderBreadcrumbs(slot, crumbs, (href) => {
    const target = href ? `${location.pathname}${href}` : location.pathname;
    history.pushState(null, '', target);
    void route();
  });
}

/**
 * Replace the trailing breadcrumb's label. Used by the watch view
 * when it learns the episode title after the catalog finishes loading.
 */
function updateBreadcrumbCurrent(label) {
  const slot = $('tv-breadcrumbs');
  if (!slot) return;
  const crumbs = slot.querySelectorAll('.tv-crumb');
  const last = crumbs[crumbs.length - 1];
  if (last) last.textContent = label;
}

/**
 * Update `<title>` so browser tabs / share previews reflect the
 * current view. The watch view will overwrite again with the episode
 * title via `setBreadcrumbTitle` indirectly (the breadcrumb update
 * doesn't reach into <title>; we set it once at mount time and again
 * on each route change, which covers the common cases).
 */
function setPageTitle(view, show, params) {
  if (view === 'shows') {
    document.title = 'Watch — Classic TV from the Internet Archive | Joe Heyming 📺';
    return;
  }
  if (view === 'episodes' && show) {
    document.title = `${show.name} · Episodes | Watch 📺`;
    return;
  }
  if (view === 'watch' && show) {
    const s = Number(params.get('s'));
    const e = Number(params.get('e'));
    const tag = s === 0 ? 'Movie' : `S${pad(s)}E${pad(e)}`;
    document.title = `${show.name} · ${tag} | Watch 📺`;
  }
}

function pad(n) {
  return String(n).padStart(2, '0');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    void main();
  });
} else {
  void main();
}

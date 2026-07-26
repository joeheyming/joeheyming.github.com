/**
 * /watch/ router.
 *
 * Two URL shapes, both static-hosting friendly:
 *
 *   - `?show=<id>` / `?show=<id>&s=<n>&e=<n>`  — series flow. The
 *     landing page links to `?show=<id>`, which renders the episodes
 *     view; clicking through to a specific episode adds `&s` and `&e`
 *     and mounts the watch view.
 *   - `?movie=<id>`                              — standalone-movie
 *     flow. Always mounts the watch view directly; there's no
 *     intermediate episode picker because there's only one file. The
 *     watch view writes back the same `?movie=<id>` URL when it
 *     refreshes the deep link.
 *
 * The route function reads `location.search`, picks the right view
 * module, unmounts the previous view, and mounts the new one into the
 * `<main id="tv-view">` slot. `popstate` re-runs the router so the
 * browser back button (and any deep-link refresh) Just Works.
 *
 * When both `?show` and `?movie` are present the movie param wins —
 * it's the more specific intent and writing a deep link with both set
 * usually means the URL was hand-edited.
 */

// Side-effect import: mode.js stamps `data-mode` + `data-modality`
// on <html> at module-load time and wires up the modality flippers.
// It MUST run before any view mounts so view code can branch on
// `isTvMode` consistently from first paint.
import './modules/mode.js';
// Side-effect import: quicknav.js mounts a fixed left-edge rail
// with Shows / Movies shortcuts. Mounts to <body> on
// DOMContentLoaded, self-contained, no API surface other than the
// `popstate` it listens for to refresh its active-state.
import './modules/quicknav.js';
import { getShow, getMovie } from './modules/data-source.js';
import { renderBreadcrumbs } from './modules/breadcrumbs.js';

/** @typedef {import('./modules/shows.js').ShowConfig} ShowConfig */
/** @typedef {import('./modules/movies.js').MovieConfig} MovieConfig */

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
 * `subjectId` is either a show id (for the shows / episodes / watch
 * views in series mode) or a movie id (for the movie watch view); the
 * jump-to fast path only applies within the same subject.
 *
 * @type {{ name: string, subjectId: string | null, handle: ViewHandle } | null}
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
  const movieId = params.get('movie');
  const showId = params.get('show');
  const s = readNum(params, 's');
  const e = readNum(params, 'e');

  // Movie takes precedence over show when both are present — a deep
  // link with both is almost always a hand-edit; honouring the more
  // specific intent matches what the user typed last.
  const movie = movieId ? await getMovie(movieId) : null;
  const show = !movie && showId ? await getShow(showId) : null;

  // ---- Decide which view ---------------------------------------------
  let nextView;
  if (movie) {
    nextView = 'movie';
  } else if (!show) {
    nextView = 'shows';
  } else if (Number.isFinite(s) && Number.isFinite(e)) {
    nextView = 'watch';
  } else {
    nextView = 'episodes';
  }

  // Hot path: same show + same view + same view supports updates →
  // call `jumpTo` instead of re-mounting. Currently only the watch
  // view does (so Prev/Next on the URL doesn't reload the video chrome).
  // Movies skip this entirely: there's only one file, so a same-subject
  // remount can't happen via URL change (the movie URL has no S/E
  // params to flip).
  if (
    nextView === 'watch' &&
    current?.name === 'watch' &&
    current.subjectId === show?.id &&
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
  if (nextView === 'movie' && movie) {
    setBreadcrumbsFor('movie', movie, params);
    setPageTitleForMovie(movie);
  } else {
    setBreadcrumbsFor(nextView, show, params);
    setPageTitle(nextView, show, params);
  }

  if (nextView === 'shows') {
    const mod = await import('./modules/views/shows-view.js');
    const handle = await mod.mount(slot, { navigate });
    current = { name: 'shows', subjectId: null, handle };
    document.documentElement.style.removeProperty('--tv-accent');
    return;
  }

  if (nextView === 'episodes' && show) {
    const mod = await import('./modules/views/episodes-view.js');
    document.documentElement.style.setProperty('--tv-accent', show.accent);
    const handle = await mod.mount(slot, { show, params, navigate });
    current = { name: 'episodes', subjectId: show.id, handle };
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
    current = { name: 'watch', subjectId: show.id, handle };
    return;
  }

  if (nextView === 'movie' && movie) {
    const mod = await import('./modules/views/watch-view.js');
    document.documentElement.style.setProperty('--tv-accent', movie.accent);
    // Movies always mount at S0E0 — the catalog has exactly one
    // Episode and findEpisode(s=0) returns it. The watch view reads
    // `show.kind === 'movie'` (set on MovieConfig but not ShowConfig)
    // to suppress Prev/Next/Shuffle/Up-next chrome.
    const handle = await mod.mount(slot, {
      show: movie,
      initialSeason: 0,
      initialEpisode: 0,
      navigate,
      setBreadcrumbTitle: (label) => updateBreadcrumbCurrent(label)
    });
    current = { name: 'watch', subjectId: movie.id, handle };
    return;
  }

  // Fallback — should be unreachable.
  navigate({});
}

/**
 * Programmatic navigation. Pushes a new history entry by default so
 * the browser back button steps through view changes (catalog → show
 * → episode, or catalog → movie). Pass `{ replace: true }` to update
 * the URL without growing history (used e.g. when the watch view
 * changes episodes internally).
 *
 * The two URL shapes (`?show=` and `?movie=`) are mutually exclusive
 * — passing `update.movie` writes the movie URL and clears any show
 * params; passing `update.show` writes the show URL.
 *
 * @param {{ show?: string, movie?: string, s?: number, e?: number }} update
 * @param {{ replace?: boolean }} [opts]
 */
function navigate(update, opts = {}) {
  const params = new URLSearchParams();
  if (update.movie) {
    params.set('movie', update.movie);
  } else {
    if (update.show) params.set('show', update.show);
    if (typeof update.s === 'number') params.set('s', String(update.s));
    if (typeof update.e === 'number') params.set('e', String(update.e));
  }
  const qs = params.toString();
  const url = qs ? `${location.pathname}?${qs}` : location.pathname;
  if (opts.replace) history.replaceState(null, '', url);
  else history.pushState(null, '', url);
  // Dispatch popstate so every listener gets a single, consistent
  // route-change signal — `route()` itself is wired through popstate
  // (see `main()`), so a manually-dispatched event covers both the
  // router re-mount AND any cross-cutting subscribers (currently the
  // quicknav rail, which uses popstate to refresh its active-state).
  // `pushState` / `replaceState` don't auto-emit popstate; this is
  // the one place we materialise the signal so the rest of the app
  // can listen to a single source of truth.
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/**
 * Set up the breadcrumb trail for the given view + subject. The watch
 * view then updates the trailing crumb's label once it knows the
 * episode/movie title (see `setBreadcrumbTitle` in MountCtx).
 *
 * For the movie flow the trail is shorter (`📺 Watch › 🎬 <name>`)
 * because there's no intermediate "all episodes" view.
 *
 * @param {'shows'|'episodes'|'watch'|'movie'} view
 * @param {ShowConfig|MovieConfig|null} subject
 * @param {URLSearchParams} params
 */
function setBreadcrumbsFor(view, subject, params) {
  const slot = $('tv-breadcrumbs');
  if (!slot) return;
  const crumbs = [];
  if (view === 'shows') {
    crumbs.push({ label: '📺 Watch' });
  } else if (view === 'episodes' && subject) {
    crumbs.push({ label: 'Watch', emoji: '📺', href: '' });
    crumbs.push({ label: subject.name, emoji: subject.emoji });
  } else if (view === 'watch' && subject) {
    crumbs.push({ label: 'Watch', emoji: '📺', href: '' });
    crumbs.push({
      label: subject.name,
      emoji: subject.emoji,
      href: `?show=${encodeURIComponent(subject.id)}`
    });
    // Initial placeholder; the watch view updates it once the episode
    // is resolved against the catalog.
    const s = Number(params.get('s'));
    const e = Number(params.get('e'));
    const seasonLabel = s === 0 ? 'Movie' : `S${pad(s)}E${pad(e)}`;
    crumbs.push({ label: seasonLabel });
  } else if (view === 'movie' && subject) {
    crumbs.push({ label: 'Watch', emoji: '📺', href: '' });
    // No intermediate "all episodes" crumb — there's nothing to browse.
    // Use 🎬 as the emoji-side glyph regardless of what the registry
    // entry chose (the registry emoji feels like a poster, the
    // breadcrumb glyph is a context tag for "this is a movie").
    crumbs.push({ label: subject.name, emoji: '🎬' });
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
    document.title = 'Watch — Classic TV from the Internet Archive 📺';
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

/**
 * Page title for the standalone-movie watch view. Movies don't carry
 * an S/E tag in the title — the movie name is the whole identifier.
 *
 * @param {MovieConfig} movie
 */
function setPageTitleForMovie(movie) {
  document.title = `${movie.name} · Movie | Watch 🎬`;
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

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

import { getShows, getMovies, TAG_GROUPS } from '../data-source.js';
import { listContinueWatching, clearLastEpisode } from '../prefs.js';
import {
  listSaved as listOfflineSaved,
  deleteSavedEpisode as deleteOfflineEpisode,
  formatBytes
} from '../offline.js';
import { isTvMode } from '../mode.js';
import { applyRovingTabindex } from '../roving-tabindex.js';

/** @typedef {import('../shows.js').ShowConfig} ShowConfig */
/** @typedef {import('../movies.js').MovieConfig} MovieConfig */

// Module-scope refs populated by `mount()`. The data-source layer is
// async (the registry lives in a Google Sheet fetched via gviz), but
// once mount has resolved the registry we want all the in-view
// helpers (`getSubject`, `makeSavedCard`, etc.) to stay synchronous —
// they run during rendering and React-ish re-renders, and threading
// a Promise through every call site would obscure the logic. The
// refs are guaranteed to be populated by the time any helper here
// runs because mount() awaits them before building DOM.

/** @type {import('../shows.js').ShowConfig[]} */
let _shows = [];
/** @type {import('../movies.js').MovieConfig[]} */
let _movies = [];
/** @type {Map<string, import('../movies.js').MovieConfig>} */
let _moviesById = new Map();
/** @type {Map<string, ShowConfig | MovieConfig>} */
let _subjectById = new Map();

/**
 * Sync movie lookup, populated by `mount()`. Used by `makeSavedCard`
 * to decide whether a stale continue-watching record points at a
 * series episode or a movie.
 * @param {string} id
 */
function getMovieById(id) {
  return _moviesById.get(id) || null;
}

/**
 * Look up a continue-watching / saved-offline subject by id, trying
 * the shows registry first and the movies registry second. Returns
 * `null` for stale entries pointing at something neither registry
 * remembers. The two registries enforce non-collision at test time
 * (movie ids ≠ show ids), so falling through here can't return the
 * wrong-kind subject.
 *
 * @param {string} id
 * @returns {ShowConfig | MovieConfig | null}
 */
function getSubject(id) {
  return _subjectById.get(id) || null;
}

/**
 * @typedef {Object} MountCtx
 * @property {(params: { show?: string, movie?: string, s?: number, e?: number }) => void} navigate
 *   Series flow uses `show` + optional `s`/`e`; standalone movies use
 *   `movie`. The router rejects mixed parameters — pass one or the
 *   other, not both.
 */

/**
 * Best-scoring focusable element in `dir` from `src`'s center.
 * Fallback for when Chromium spatial-nav refuses to run — notably
 * from a tabindex=-1 element, which the WebView won't navigate
 * away from. Scoring follows the W3C spatial-nav draft: primary
 * axis = direction, secondary axis ×1.5 so well-aligned candidates
 * win over closer-but-skewed ones.
 *
 * @param {DOMRect} src
 * @param {Element} self  Excluded from results along with its
 *                        ancestors and descendants.
 * @param {'up'|'down'|'left'|'right'} dir
 * @returns {HTMLElement|null}
 */
function findFocusableInDirection(src, self, dir) {
  const sx = src.left + src.width / 2;
  const sy = src.top + src.height / 2;
  const candidates = /** @type {HTMLElement[]} */ (
    Array.from(
      document.querySelectorAll(
        'a[href], button:not([disabled]), input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]'
      )
    ).filter((el) => {
      if (el === self) return false;
      // Skip ancestors and descendants — the ✕ shouldn't navigate
      // back into its own card via "spatial up", and the card
      // shouldn't see its own ✕ as a navigation target.
      if (self.contains(el) || el.contains(self)) return false;
      const ti = /** @type {HTMLElement} */ (el).tabIndex;
      if (ti < 0) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      // offsetParent === null catches display:none and detached
      // subtrees; visibility:hidden also yields a 0-sized rect.
      if (/** @type {HTMLElement} */ (el).offsetParent === null) return false;
      const ex = rect.left + rect.width / 2;
      const ey = rect.top + rect.height / 2;
      if (dir === 'up' && ey >= sy) return false;
      if (dir === 'down' && ey <= sy) return false;
      if (dir === 'left' && ex >= sx) return false;
      if (dir === 'right' && ex <= sx) return false;
      return true;
    })
  );

  let best = null;
  let bestScore = Infinity;
  for (const el of candidates) {
    const r = el.getBoundingClientRect();
    const ex = r.left + r.width / 2;
    const ey = r.top + r.height / 2;
    const dx = ex - sx;
    const dy = ey - sy;
    const primary = dir === 'up' || dir === 'down' ? Math.abs(dy) : Math.abs(dx);
    const orthogonal = dir === 'up' || dir === 'down' ? Math.abs(dx) : Math.abs(dy);
    const score = primary + orthogonal * 1.5;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}

/**
 * D-pad sub-navigation between a card and its inline ✕ button.
 * The ✕ stays at tabindex=-1 so spatial-nav doesn't accidentally
 * land on it from outside the card; this is how a remote-only user
 * still reaches it.
 *
 *   on card:  ArrowUp → focus ✕  ·  Delete/Backspace → click ✕  ·  MediaPlay → click card
 *   on ✕:     ArrowDown → focus card  ·  ArrowUp/Left/Right → findFocusableInDirection
 *
 * Up/Left/Right on the ✕ uses findFocusableInDirection because
 * Chromium WebView won't run native spatial-nav from a tabindex=-1
 * element.
 *
 * @param {HTMLAnchorElement} card
 * @param {HTMLButtonElement} remove
 */
function wireRemoveSubNav(card, remove) {
  card.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      remove.focus();
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      e.stopPropagation();
      remove.click();
      return;
    }
    // Treat the remote's Play key like OK on the home grid — the
    // shell's 'k' translation only matters inside the player view.
    if (e.key === 'MediaPlay' || e.key === 'MediaPlayPause') {
      e.preventDefault();
      e.stopPropagation();
      card.click();
    }
  });

  remove.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      // Inverse of card.ArrowUp — return focus to the card body.
      e.preventDefault();
      e.stopPropagation();
      card.focus();
      return;
    }
    /** @type {Record<string, 'up'|'left'|'right'>} */
    const dirMap = { ArrowUp: 'up', ArrowLeft: 'left', ArrowRight: 'right' };
    const dir = dirMap[e.key];
    if (!dir) return;

    // Use the card's rect, not the ✕'s — the ✕ in the top-right
    // corner would skew ArrowLeft toward the previous card's own
    // ✕ (filtered out, and nothing else nearby).
    const next = findFocusableInDirection(card.getBoundingClientRect(), card, dir);
    if (next) {
      e.preventDefault();
      e.stopPropagation();
      next.focus();
    }
  });
}

/**
 * @param {HTMLElement} slot
 * @param {MountCtx} ctx
 * @returns {Promise<{ unmount: () => void }>}
 */
export async function mount(slot, ctx) {
  // Render a synchronous shell skeleton (title + "Loading channel
  // guide…") into the slot before awaiting the registry, so the user
  // sees *something* in the same frame the router clears the slot.
  // Without this the screen is blank for the duration of the gviz
  // round-trip (~200-2000ms on a cold cache) — fast enough on desktop,
  // perceived as a hang on a TV where you can't open devtools to see
  // what's happening. The placeholder is wiped and replaced with the
  // real DOM as soon as the await resolves, so steady-state behaviour
  // is unchanged.
  //
  // data-source eagerly kicks off the same fetch at module-import
  // time, so by the time we get here the promise is usually already
  // in flight or fulfilled — the skeleton frame is brief on first
  // boot and instant on warm navigation.
  const root = document.createElement('section');
  root.className = 'tv-landing';
  const bootIntro = document.createElement('div');
  bootIntro.className = 'tv-landing-intro';
  const bootTitle = document.createElement('h2');
  bootTitle.className = 'tv-landing-title';
  bootTitle.textContent = '📺 Watch';
  const bootStatus = document.createElement('p');
  bootStatus.className = 'tv-landing-blurb tv-inline-loading';
  bootStatus.textContent = 'Loading channel guide…';
  bootIntro.appendChild(bootTitle);
  bootIntro.appendChild(bootStatus);
  root.appendChild(bootIntro);
  slot.appendChild(root);

  // Resolve the registry. The data-source layer pays one gviz
  // round-trip on cold start (eagerly kicked off at module import,
  // so it's usually already in flight by the time we await it),
  // then serves everything from a module-scope in-memory snapshot
  // for the rest of the page session. Module-scope refs let the
  // in-view helpers (`getSubject`, `makeSavedCard`) stay synchronous
  // — they're called dozens of times during render and we don't want
  // every lookup to be a Promise.
  const [shows, movies] = await Promise.all([getShows(), getMovies()]);
  // The skeleton served its purpose; wipe it before we rebuild the
  // real DOM. `root` stays in the slot so the rest of mount can keep
  // appending to it.
  root.replaceChildren();
  _shows = shows;
  _movies = movies;
  _moviesById = new Map(movies.map((m) => /** @type {[string, MovieConfig]} */ ([m.id, m])));
  /** @type {Array<[string, ShowConfig | MovieConfig]>} */
  const subjectEntries = [
    ...shows.map((s) => /** @type {[string, ShowConfig]} */ ([s.id, s])),
    ...movies.map((m) => /** @type {[string, MovieConfig]} */ ([m.id, m]))
  ];
  _subjectById = new Map(subjectEntries);

  // `root` was created (and inserted into `slot`) above as the boot
  // skeleton; the rest of this function appends the real DOM to it.

  const intro = document.createElement('div');
  intro.className = 'tv-landing-intro';
  const introTitle = document.createElement('h2');
  introTitle.className = 'tv-landing-title';
  introTitle.textContent = '📺 Watch';
  const introBlurb = document.createElement('p');
  introBlurb.className = 'tv-landing-blurb';
  introBlurb.textContent =
    'Smart-TV style player that streams classic TV series straight from the Internet Archive. No accounts, no ads — MP4 over HTTPS. Cast to a Chromecast or AirPlay receiver from the player.';
  intro.appendChild(introTitle);
  intro.appendChild(introBlurb);

  // Live filter for the show grid. The wrapper is also a click target
  // for the clear button so the input + ✕ read as one widget. Continue
  // Watching and Saved Offline rows are deliberately not filtered —
  // those reflect user-specific state, not catalog browsing.
  const searchWrap = document.createElement('div');
  searchWrap.className = 'tv-search';
  // Scroll anchor for `#search` — the quicknav rail's Search button
  // writes `./#search`, the hash handler scrolls here, focuses the
  // input, and then clears the hash from the URL so a subsequent
  // refresh doesn't auto-focus mid-typing.
  searchWrap.id = 'search';
  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.className = 'tv-search-input';
  searchInput.placeholder = 'Search shows…';
  searchInput.setAttribute('aria-label', 'Search shows');
  searchInput.autocomplete = 'off';
  searchInput.spellcheck = false;
  const searchClear = document.createElement('button');
  searchClear.type = 'button';
  searchClear.className = 'tv-search-clear hidden';
  searchClear.setAttribute('aria-label', 'Clear search');
  searchClear.title = 'Clear search';
  searchClear.textContent = '✕';
  // Status region is visually hidden but announced — screen readers
  // hear "3 shows match" without sighted users seeing a duplicate line.
  const searchStatus = document.createElement('div');
  searchStatus.className = 'tv-search-status';
  searchStatus.setAttribute('role', 'status');
  searchStatus.setAttribute('aria-live', 'polite');
  searchWrap.appendChild(searchInput);
  searchWrap.appendChild(searchClear);
  searchWrap.appendChild(searchStatus);
  intro.appendChild(searchWrap);

  // Tag-filter chip row. One chip per canonical tag from TAG_GROUPS,
  // rendered in semantic order (Format → Audience → Era → Genre).
  // Chips are toggleable buttons; an active chip narrows the grid to
  // shows carrying that tag. Multiple active chips combine with OR
  // semantics (show appears if it matches ANY active chip) — the
  // intersection model gives empty results too often on a catalog
  // this small. The search input still ANDs on top so users can
  // combine "comedy" + "tick" to find The Tick within the comedy
  // subset.
  const tagRow = document.createElement('div');
  tagRow.className = 'tv-tags';
  tagRow.setAttribute('role', 'group');
  tagRow.setAttribute('aria-label', 'Filter shows by tag');
  /** @type {Set<string>} */
  const activeTags = new Set();
  /** @type {HTMLButtonElement[]} */
  const chipButtons = [];
  // Only emit chips for tags that at least one registry entry (show
  // OR movie) actually carries — keeps the row tight if either
  // registry shrinks. Order is Format → Audience → Era → Genre; we
  // walk TAG_GROUPS in that declared order rather than alphabetising.
  const tagsInUse = new Set();
  for (const show of shows) for (const t of show.tags || []) tagsInUse.add(t);
  for (const movie of movies) for (const t of movie.tags || []) tagsInUse.add(t);
  for (const [groupName, tags] of /** @type {[string, readonly string[]][]} */ (
    Object.entries(TAG_GROUPS)
  )) {
    for (const tag of tags) {
      if (!tagsInUse.has(tag)) continue;
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'tv-tag-chip';
      chip.dataset.tag = tag;
      chip.dataset.group = groupName;
      chip.setAttribute('aria-pressed', 'false');
      chip.textContent = tag;
      tagRow.appendChild(chip);
      chipButtons.push(chip);
    }
  }
  // "Clear filters" reset button sits at the end of the row; hidden
  // until at least one chip is active. We don't need an "All" chip up
  // front — when no chips are active the grid already shows
  // everything.
  const tagReset = document.createElement('button');
  tagReset.type = 'button';
  tagReset.className = 'tv-tag-reset hidden';
  tagReset.textContent = 'clear filters';
  tagRow.appendChild(tagReset);
  intro.appendChild(tagRow);

  // Continue-watching row. Lives between the intro and the grid; the
  // wrapper stays in the DOM even when there are no entries so the
  // ✕ button on the last card can re-render it back to empty/hidden
  // without poking at sibling layout.
  const continueSection = document.createElement('div');
  continueSection.className = 'tv-continue-section hidden';
  // Scroll anchor for `#continue` — the quicknav rail's "Recent"
  // button writes `./#continue` and relies on this id. The section
  // keeps the `hidden` class when there are no entries; the hash
  // scroll falls through to "top of page" in that case.
  continueSection.id = 'continue';
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

  // Shows section: label + grid. We always render the label so the
  // page has a stable "📺 Shows" heading even when the search/chip
  // filter zeroes the grid out — it makes the empty-state message
  // ("No shows match …") less surprising.
  const showsSection = document.createElement('div');
  showsSection.className = 'tv-shows-section';
  // ID is the scroll anchor the quicknav rail's "📺 Shows" button
  // jumps to (via `#shows`). The id is generic — matches both the
  // hash name in the URL and the role this block plays in the page.
  showsSection.id = 'shows';
  const showsLabel = document.createElement('div');
  showsLabel.className = 'tv-section-label';
  const showsLabelText = document.createElement('span');
  showsLabelText.textContent = '📺 Shows';
  showsLabel.appendChild(showsLabelText);
  const grid = document.createElement('div');
  grid.className = 'tv-show-grid';
  grid.setAttribute('role', 'list');
  // Sentinel for scroll-based windowing: a thin invisible sliver right
  // after the grid that an IntersectionObserver watches. When it enters
  // view (with rootMargin ahead-of-fold), the next page of cards is
  // appended. Cards start empty here — `applyFilter()` below runs once
  // at mount-time and renders the first page; subsequent pages append
  // as the user scrolls.
  const showsSentinel = document.createElement('div');
  showsSentinel.className = 'tv-scroll-sentinel';
  showsSentinel.setAttribute('aria-hidden', 'true');
  showsSection.appendChild(showsLabel);
  showsSection.appendChild(grid);
  showsSection.appendChild(showsSentinel);

  // Movies section: same shape, separate grid. Renders nothing (whole
  // section hidden) when no movies are registered in the sheet so the
  // framework can ship before any movies are added. When movies exist
  // they're filtered by the same search + chip row as the shows grid
  // (one filter pass walks both grids).
  const moviesSection = document.createElement('div');
  moviesSection.className = 'tv-movies-section';
  // Scroll anchor for `#movies` — see the matching `id` on
  // `showsSection` above for the pattern. The quicknav rail's
  // Movies button writes `./#movies` and relies on this id.
  moviesSection.id = 'movies';
  if (movies.length === 0) moviesSection.classList.add('hidden');
  const moviesLabel = document.createElement('div');
  moviesLabel.className = 'tv-section-label';
  const moviesLabelText = document.createElement('span');
  moviesLabelText.textContent = '🎬 Movies';
  moviesLabel.appendChild(moviesLabelText);
  const moviesGrid = document.createElement('div');
  moviesGrid.className = 'tv-show-grid tv-movie-grid';
  moviesGrid.setAttribute('role', 'list');
  // Same windowing pattern as the shows grid above — sentinel sits
  // after the grid so the observer can spot it without re-positioning
  // it as pages get appended.
  const moviesSentinel = document.createElement('div');
  moviesSentinel.className = 'tv-scroll-sentinel';
  moviesSentinel.setAttribute('aria-hidden', 'true');
  moviesSection.appendChild(moviesLabel);
  moviesSection.appendChild(moviesGrid);
  moviesSection.appendChild(moviesSentinel);

  // Empty state lives alongside the grid (not inside it) so the grid's
  // CSS `display: grid` doesn't try to lay the message out as a tile.
  // One shared empty-state covers both grids — when no entry across
  // shows + movies matches, the message reflects the whole search.
  const empty = document.createElement('p');
  empty.className = 'tv-search-empty hidden';

  root.appendChild(intro);
  root.appendChild(continueSection);
  root.appendChild(savedSection);
  root.appendChild(showsSection);
  root.appendChild(moviesSection);
  root.appendChild(empty);
  // root is already in slot (appended above as the boot skeleton); we
  // just hydrated its contents in place.

  renderContinue(continueSection, continueGrid, ctx);
  void renderSaved(savedSection, savedGrid, savedLabelMeta, ctx);

  // ─── Scroll-loaded windowing for the shows + movies grids ─────────
  //
  // We render the catalog in pages of `PAGE_SIZE` cards instead of
  // dumping all 100+ tiles into the DOM upfront. An IntersectionObserver
  // watches a sentinel sliver placed just after each grid; when the
  // sentinel enters view (with a generous ahead-of-fold margin) the
  // next page is appended. Filter changes rewind the window from the
  // top of the newly-filtered set.
  //
  // Why this matters on a TV: building 100 card subtrees on cold boot
  // is the dominant chunk of mount() time, and most of those tiles
  // are below the fold on first paint anyway. CSS `content-visibility`
  // already defers their *paint*, but the DOM-creation cost still
  // happens; windowing removes it from the critical path.
  //
  // Filter semantics are unchanged: search input + active tag chips
  // narrow `shows` / `movies` to `filteredShows` / `filteredMovies`,
  // and the windowed grid renders pages of that subset.
  const PAGE_SIZE = 24;

  /**
   * @param {ShowConfig | MovieConfig} item
   * @returns {string}
   */
  const haystackFor = (item) =>
    [item.name, item.shortName, item.tagline, item.emoji].filter(Boolean).join(' ').toLowerCase();
  // Precompute haystacks once — the filter runs on every keystroke and
  // string concat per item per keystroke adds up at scale. Map keys are
  // the item objects themselves so we don't have to thread ids around.
  /** @type {Map<ShowConfig, string>} */
  const showHays = new Map(shows.map((s) => [s, haystackFor(s)]));
  /** @type {Map<MovieConfig, string>} */
  const movieHays = new Map(movies.map((m) => [m, haystackFor(m)]));

  /** @type {ShowConfig[]} */
  let filteredShows = shows.slice();
  /** @type {MovieConfig[]} */
  let filteredMovies = movies.slice();
  let renderedShowsCount = 0;
  let renderedMoviesCount = 0;

  // Roving-tabindex defined up front (before any append) so the page-
  // append helpers can call `.refresh()` after adding cards. The grids
  // are empty at this point; applyRovingTabindex tolerates that and
  // picks up children on each `.refresh()` call.
  // Always-on (helps desktop keyboard users too); the visible focus
  // ring is what TV mode adds.
  const gridRoving = applyRovingTabindex(grid, { selector: '.tv-show-card' });
  // Movies grid gets its own roving region when there are movies to
  // navigate — keeps the two grids as independent tabstops. When the
  // registry is empty we skip wiring (no children to roam) and the
  // section is hidden anyway.
  const moviesRoving =
    movies.length > 0 ? applyRovingTabindex(moviesGrid, { selector: '.tv-show-card' }) : null;

  const appendNextShows = () => {
    if (renderedShowsCount >= filteredShows.length) return;
    const next = filteredShows.slice(renderedShowsCount, renderedShowsCount + PAGE_SIZE);
    const frag = document.createDocumentFragment();
    for (const show of next) frag.appendChild(makeShowCard(show, ctx));
    grid.appendChild(frag);
    renderedShowsCount += next.length;
    gridRoving.refresh();
  };

  const appendNextMovies = () => {
    if (renderedMoviesCount >= filteredMovies.length) return;
    const next = filteredMovies.slice(renderedMoviesCount, renderedMoviesCount + PAGE_SIZE);
    const frag = document.createDocumentFragment();
    for (const movie of next) frag.appendChild(makeMovieCard(movie, ctx));
    moviesGrid.appendChild(frag);
    renderedMoviesCount += next.length;
    moviesRoving?.refresh();
  };

  // Sentinel observer: fires when each grid's trailing sliver scrolls
  // into the (extended) viewport. 600px rootMargin starts loading
  // before the user actually sees the bottom of the rendered set,
  // which on TV at fast scroll speeds keeps the experience seamless.
  // Falls back to "render everything upfront" when IntersectionObserver
  // is unavailable (very old browsers) — we'd rather pay the upfront
  // cost than break the page.
  /** @type {IntersectionObserver | null} */
  const sentinelObserver =
    typeof IntersectionObserver === 'undefined'
      ? null
      : new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (!entry.isIntersecting) continue;
              if (entry.target === showsSentinel) appendNextShows();
              else if (entry.target === moviesSentinel) appendNextMovies();
            }
          },
          { rootMargin: '600px 0px' }
        );
  if (sentinelObserver) {
    sentinelObserver.observe(showsSentinel);
    sentinelObserver.observe(moviesSentinel);
  }

  // Cancel any pending lazy-poster observations on cards we're about
  // to throw away. The IntersectionObserver inside lazyResolvePoster
  // holds *strong* refs to its observed nodes, so without an explicit
  // unobserve, every filter change leaks the previous window's cards.
  /** @param {HTMLElement} container */
  const releaseLazyPostersIn = (container) => {
    const imgs = container.querySelectorAll('img');
    for (const img of imgs) cancelLazyPoster(/** @type {HTMLElement} */ (img));
  };

  const applyFilter = () => {
    const query = searchInput.value.trim().toLowerCase();
    searchClear.classList.toggle('hidden', query.length === 0);
    tagReset.classList.toggle('hidden', activeTags.size === 0);

    // Walk the in-memory registries (not the DOM) so the count reflects
    // the *full* filtered set, not just what's currently windowed in.
    filteredShows = shows.filter((s) => {
      const hay = showHays.get(s) || '';
      const hitsSearch = query === '' || hay.includes(query);
      const hitsTags = activeTags.size === 0 || (s.tags || []).some((t) => activeTags.has(t));
      return hitsSearch && hitsTags;
    });
    filteredMovies = movies.filter((m) => {
      const hay = movieHays.get(m) || '';
      const hitsSearch = query === '' || hay.includes(query);
      const hitsTags = activeTags.size === 0 || (m.tags || []).some((t) => activeTags.has(t));
      return hitsSearch && hitsTags;
    });

    // Rewind both windows: clear the rendered cards, reset counters,
    // append the first page of the freshly-filtered set. The sentinel
    // stays in place (we appended it to the section, not the grid);
    // if it's still in view after appending one page (e.g. small
    // filtered set + tall viewport), the observer will re-fire and
    // append the next page automatically until it scrolls below fold.
    releaseLazyPostersIn(grid);
    releaseLazyPostersIn(moviesGrid);
    grid.replaceChildren();
    moviesGrid.replaceChildren();
    renderedShowsCount = 0;
    renderedMoviesCount = 0;
    appendNextShows();
    appendNextMovies();

    const showMatches = filteredShows.length;
    const movieMatches = filteredMovies.length;

    // Hide the whole section when its filtered set is empty so an
    // active filter doesn't leave a lonely section label floating
    // over a blank grid. The Movies section additionally stays hidden
    // when the registry has no entries at all — `movies.length === 0`
    // already produces `filteredMovies.length === 0`, so the same
    // toggle covers both cases.
    showsSection.classList.toggle('hidden', showMatches === 0);
    if (movies.length > 0) {
      moviesSection.classList.toggle('hidden', movieMatches === 0);
    }
    // Mirror the active state back onto the chips so re-renders (or
    // future programmatic toggles) stay in sync with `activeTags`.
    for (const chip of chipButtons) {
      const on = activeTags.has(chip.dataset.tag || '');
      chip.classList.toggle('is-active', on);
      chip.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    const totalMatches = showMatches + movieMatches;
    const noFilter = query === '' && activeTags.size === 0;
    if (noFilter) {
      empty.classList.add('hidden');
      empty.textContent = '';
      searchStatus.textContent = '';
      return;
    }
    if (totalMatches === 0) {
      const bits = [];
      if (query) bits.push(`“${searchInput.value.trim()}”`);
      if (activeTags.size) bits.push([...activeTags].join(' / '));
      // "shows" copy stays accurate even with movies registered —
      // both registries contribute to the same search, and "shows"
      // here is shorthand for "anything in the catalog".
      empty.textContent = `Nothing matches ${bits.join(' + ')}`;
      empty.classList.remove('hidden');
    } else {
      empty.classList.add('hidden');
      empty.textContent = '';
    }
    // Status string mentions movies only when at least one is
    // registered; the framework can ship empty without the screen-
    // reader announcement reading "0 movies match".
    const parts = [`${showMatches} ${showMatches === 1 ? 'show' : 'shows'}`];
    if (movies.length > 0) {
      parts.push(`${movieMatches} ${movieMatches === 1 ? 'movie' : 'movies'}`);
    }
    searchStatus.textContent = `${parts.join(' · ')} match`;
  };

  // Render the initial (no-filter) window. Must happen before any
  // focus call below — `focusFirst()` needs at least one card in DOM.
  applyFilter();

  const onInput = () => applyFilter();
  const onKeydown = (e) => {
    if (e.key === 'Escape' && searchInput.value !== '') {
      e.preventDefault();
      searchInput.value = '';
      applyFilter();
    }
  };
  const onClear = () => {
    searchInput.value = '';
    applyFilter();
    searchInput.focus();
  };
  const onChipClick = (chip) => {
    const tag = chip.dataset.tag;
    if (!tag) return;
    if (activeTags.has(tag)) activeTags.delete(tag);
    else activeTags.add(tag);
    applyFilter();
  };
  const onTagReset = () => {
    activeTags.clear();
    applyFilter();
  };
  searchInput.addEventListener('input', onInput);
  searchInput.addEventListener('keydown', onKeydown);
  searchClear.addEventListener('click', onClear);
  const chipHandlers = chipButtons.map((chip) => {
    const handler = () => onChipClick(chip);
    chip.addEventListener('click', handler);
    return { chip, handler };
  });
  tagReset.addEventListener('click', onTagReset);

  // On TV mode, autofocus the first show card so the remote can drive
  // immediately without a "press any key" beat. Skipped on desktop —
  // we don't want to steal focus from the search input or the URL bar.
  // `gridRoving` was set up above (alongside the windowing helpers),
  // and `applyFilter()` already rendered the first page of cards, so
  // there's a tile to land on.
  if (isTvMode) gridRoving.focusFirst();

  // Honour deep-link hashes by scrolling the corresponding section
  // into view (and, for `#search`, focusing the input) after first
  // paint. The quicknav rail writes these hashes, but direct URL-bar
  // hits / bookmarks work the same way:
  //
  //   #shows     → scroll the Shows section to top
  //   #movies    → scroll the Movies section to top
  //   #continue  → scroll the Continue Watching row to top
  //                (falls through to "scroll to top of page" when the
  //                section is empty/hidden — the user pressed Recent
  //                while they had nothing to resume, the next-best
  //                landing spot is the top of the home grid)
  //   #search    → scroll top + focus the search input, then clear
  //                the hash from the URL so a refresh doesn't
  //                re-focus mid-typing
  //
  // Two rAFs because grid layout settles after first paint.
  const hash = window.location.hash;
  if (hash === '#search' || hash === '#continue' || hash === '#shows' || hash === '#movies') {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (hash === '#search') {
          window.scrollTo({ top: 0, behavior: 'smooth' });
          searchInput.focus({ preventScroll: true });
          // Pop the hash off the URL — it was a one-shot action
          // signal, not a persistent state we want to round-trip.
          history.replaceState(null, '', window.location.pathname + window.location.search);
          return;
        }
        const target = document.getElementById(hash.slice(1));
        if (target && !target.classList.contains('hidden')) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      });
    });
  }

  return {
    unmount() {
      searchInput.removeEventListener('input', onInput);
      searchInput.removeEventListener('keydown', onKeydown);
      searchClear.removeEventListener('click', onClear);
      for (const { chip, handler } of chipHandlers) {
        chip.removeEventListener('click', handler);
      }
      tagReset.removeEventListener('click', onTagReset);
      gridRoving.dispose();
      moviesRoving?.dispose();
      // Tear down scroll-windowing wiring: stop watching the sentinels
      // and release any pending lazy-poster observations on cards
      // still in DOM. Both observers hold strong refs to their targets
      // and would keep this view's DOM alive past unmount otherwise.
      sentinelObserver?.disconnect();
      releaseLazyPostersIn(grid);
      releaseLazyPostersIn(moviesGrid);
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
    // Falls back from shows registry to movies registry. Stale
    // entries (the user once watched something we no longer ship)
    // resolve to null and get dropped silently — same behaviour as
    // pre-movies, just over a wider lookup space.
    const subject = getSubject(entry.showId);
    if (!subject) continue;
    gridEl.appendChild(
      makeContinueCard(subject, entry, ctx, () => renderContinue(section, gridEl, ctx))
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
  // Saved offline records don't carry a `kind` field — they were
  // written before movies existed and the schema is meant to be
  // ID-agnostic. We re-derive the kind here by checking whether the
  // showId resolves to a movie in the registry; for the saved-offline
  // path that's enough because the record's showId is the only thing
  // we'd otherwise dispatch on. Stale entries (movie removed from
  // the registry) fall through to the legacy `?show=` URL, which the
  // router will refuse and bounce back to the landing page.
  const isMovie = getMovieById(meta.showId) !== null;
  const card = document.createElement('a');
  card.className = 'tv-continue-card tv-saved-card';
  card.style.setProperty('--show-accent', meta.showAccent || 'var(--tv-accent)');
  const query = isMovie
    ? new URLSearchParams({ movie: meta.showId })
    : new URLSearchParams({
        show: meta.showId,
        s: String(meta.season),
        e: String(meta.episode)
      });
  card.href = `?${query.toString()}`;

  const thumb = document.createElement('div');
  thumb.className = 'tv-continue-thumb';
  thumb.style.background = `linear-gradient(160deg, ${meta.showAccent || '#444'}33, #111)`;
  // `meta.thumbUrl` is stamped at save-time from `ep.image` (TVMaze
  // episode still). Standalone movies don't have an episode still, so
  // for any movie record (including ones saved before saveEpisode
  // learned to fall back to `show.posterUrl`) we recover the thumb
  // from the current registry's posterUrl by id. Stale records (movie
  // removed from registry) just keep the emoji fallback.
  const recoveredPosterUrl = isMovie ? getMovieById(meta.showId)?.posterUrl : null;
  const thumbSrc = meta.thumbUrl || recoveredPosterUrl || null;
  if (thumbSrc) {
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = isMovie
      ? `${meta.showName} poster`
      : `${meta.showName} — ${
          meta.title ||
          `S${String(meta.season).padStart(2, '0')}E${String(meta.episode).padStart(2, '0')}`
        }`;
    img.src = thumbSrc;
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
  // tabindex=-1 — see makeContinueCard for the rationale.
  remove.tabIndex = -1;
  remove.setAttribute(
    'aria-label',
    `Delete saved copy of ${meta.showName} S${pad(meta.season)}E${pad(meta.episode)}`
  );
  remove.title = 'Delete this cached episode (Delete)';
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
    if (isMovie) {
      ctx.navigate({ movie: meta.showId });
    } else {
      ctx.navigate({ show: meta.showId, s: meta.season, e: meta.episode });
    }
  });
  // Delete shortcut still routes through the window.confirm above,
  // so accidental keypresses are gated.
  wireRemoveSubNav(card, remove);

  return card;
}

/**
 * @param {ShowConfig | MovieConfig} show
 * @param {{ season: number, episode: number }} entry
 * @param {MountCtx} ctx
 * @param {() => void} onChange  Called after a successful remove so the
 *                               caller can re-render the row.
 */
function makeContinueCard(show, entry, ctx, onChange) {
  const isMovie = /** @type {any} */ (show).kind === 'movie';
  const card = document.createElement('a');
  card.className = 'tv-continue-card';
  card.style.setProperty('--show-accent', show.accent);
  // URL shape mirrors how the user would reach this episode via the
  // landing-page card: `?movie=<id>` for standalone movies (no S/E
  // since there's only one file), `?show=<id>&s&e` for series.
  const query = isMovie
    ? new URLSearchParams({ movie: show.id })
    : new URLSearchParams({
        show: show.id,
        s: String(entry.season),
        e: String(entry.episode)
      });
  card.href = `?${query.toString()}`;

  const thumb = document.createElement('div');
  thumb.className = 'tv-continue-thumb';
  thumb.style.background = `linear-gradient(160deg, ${show.accent}33, #111)`;
  // Three-tier thumbnail strategy, same priority order as makeMovieCard:
  //
  //   1. `posterUrl` (movies) — direct https URL the registry author
  //      curated. No round-trip, no cache layer.
  //   2. `tvmazeId` (shows) — async fetch of the TVMaze series poster.
  //      Movies never have this since TVMaze is series-only.
  //   3. emoji on the accent gradient — fallback when neither matches.
  //
  // Previously this only checked tvmazeId, so every movie in
  // continue-watching collapsed to step 3 — the row read as a wall of
  // emoji while the show cards on the same row showed real posters.
  const posterUrl = /** @type {any} */ (show).posterUrl;
  const tvmazeId = /** @type {any} */ (show).tvmazeId;
  if (posterUrl) {
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = `${show.name} poster`;
    img.src = posterUrl;
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
  } else if (tvmazeId) {
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = `${show.name} poster`;
    lazyResolvePoster(img, () => {
      fetchPoster(tvmazeId).then((url) => {
        if (url) img.src = url;
      });
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
  } else {
    thumb.classList.add('is-empty');
    thumb.textContent = show.emoji;
  }

  // Play glyph overlays the thumb on hover/focus — same affordance as
  // the per-show episode cards so users read it as a video tile.
  const play = document.createElement('div');
  play.className = 'tv-continue-play';
  play.textContent = '▶';
  thumb.appendChild(play);

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'tv-continue-remove';
  // tabindex=-1 takes ✕ out of the spatial-nav graph — otherwise a
  // D-pad press from the row above frequently lands focus on the ✕
  // (top-right of the thumb) and OK *removes* the entry instead of
  // playing it. wireRemoveSubNav adds the explicit D-pad path back.
  remove.tabIndex = -1;
  remove.setAttribute('aria-label', `Remove ${show.name} from Continue watching`);
  remove.title = 'Remove from Continue watching (Delete)';
  remove.textContent = '✕';
  thumb.appendChild(remove);

  const meta = document.createElement('div');
  meta.className = 'tv-continue-meta';
  const showName = document.createElement('div');
  showName.className = 'tv-continue-show';
  showName.textContent = `${show.emoji} ${show.shortName}`;
  const tag = document.createElement('div');
  tag.className = 'tv-continue-tag';
  // Standalone movies: tag is "🎬 Movie" (the title is already on the
  // top line). Bundled-with-show movies (show.movieTitle set): use
  // the movie's title there. Series: SxxExx.
  if (isMovie) {
    tag.textContent = '🎬 Movie';
  } else if (entry.season === 0) {
    tag.textContent = /** @type {any} */ (show).movieTitle || 'Movie';
  } else {
    tag.textContent = `S${pad(entry.season)}E${pad(entry.episode)}`;
  }
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
    if (isMovie) {
      ctx.navigate({ movie: show.id });
    } else {
      ctx.navigate({ show: show.id, s: entry.season, e: entry.episode });
    }
  });
  wireRemoveSubNav(card, remove);

  return card;
}

/**
 * Build a poster card for a standalone movie. Uses the same DOM
 * shape as the show card (same .tv-show-card class so the existing
 * grid CSS, hover, and roving-tabindex apply uniformly) but the link
 * target is `?movie=<id>` instead of `?show=<id>` and a small "Movie"
 * badge sits in the corner of the poster so the user reads the tile
 * differently at a glance.
 *
 * @param {MovieConfig} movie
 * @param {MountCtx} ctx
 */
function makeMovieCard(movie, ctx) {
  const card = document.createElement('a');
  card.className = 'tv-show-card tv-movie-card';
  card.style.setProperty('--show-accent', movie.accent);
  card.setAttribute('data-movie', movie.id);
  card.setAttribute(
    'data-search',
    [movie.name, movie.shortName, movie.tagline, movie.emoji]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
  );
  card.setAttribute('data-tags', (movie.tags || []).join(' '));
  card.href = `?movie=${encodeURIComponent(movie.id)}`;
  card.setAttribute('role', 'listitem');

  const poster = document.createElement('div');
  poster.className = 'tv-show-poster';
  poster.style.background = `linear-gradient(160deg, ${movie.accent}33, #111)`;

  // Poster strategy for movies:
  //
  //   1. `posterUrl` (preferred) — author-curated direct URL (usually
  //      Wikipedia's `upload.wikimedia.org` infobox poster). Synchronous
  //      `<img src>`, no network round-trip to resolve, no localStorage
  //      cache layer. Cheapest path.
  //   2. `tvmazeId` (fallback for the rare movie that's in TVMaze) —
  //      same `fetchPoster` flow the show grid uses.
  //   3. Emoji on the accent gradient — the placeholder both above
  //      paths fall back to on `<img>` error, and the bare default when
  //      neither field is set.
  if (movie.posterUrl) {
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = `${movie.name} poster`;
    img.src = movie.posterUrl;
    img.addEventListener(
      'error',
      () => {
        img.remove();
        poster.classList.add('is-empty');
        poster.textContent = movie.emoji;
      },
      { once: true }
    );
    poster.appendChild(img);
  } else if (movie.tvmazeId) {
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = `${movie.name} poster`;
    lazyResolvePoster(img, () => {
      fetchPoster(movie.tvmazeId).then((url) => {
        if (url) img.src = url;
      });
    });
    img.addEventListener(
      'error',
      () => {
        img.remove();
        poster.classList.add('is-empty');
        poster.textContent = movie.emoji;
      },
      { once: true }
    );
    poster.appendChild(img);
  } else {
    poster.classList.add('is-empty');
    poster.textContent = movie.emoji;
  }

  // Small "MOVIE" pill in the top-right corner of the poster so the
  // card reads as a movie even when the poster art does a good job
  // looking like a show. Doubles as visual hint that clicking goes
  // straight to playback (no episode picker in between).
  const badge = document.createElement('span');
  badge.className = 'tv-saved-badge tv-movie-badge';
  badge.textContent = '🎬 Movie';
  poster.appendChild(badge);

  const meta = document.createElement('div');
  meta.className = 'tv-show-meta';
  const name = document.createElement('h2');
  name.className = 'tv-show-name';
  name.textContent = movie.shortName || movie.name;
  name.title = movie.name;
  meta.appendChild(name);

  card.appendChild(poster);
  card.appendChild(meta);
  card.addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
    e.preventDefault();
    ctx.navigate({ movie: movie.id });
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
  // Lowercased haystack for the landing-page search input. Pre-computed
  // so the filter loop is a plain `.includes()` instead of re-lowercasing
  // four fields per card per keystroke.
  card.setAttribute(
    'data-search',
    [show.name, show.shortName, show.tagline, show.emoji].filter(Boolean).join(' ').toLowerCase()
  );
  // Space-separated tag list for the chip filter to scan with a quick
  // `.split(' ').some(...)` per card. Empty for shows missing tags
  // (the registry test forbids that, but the default keeps the chip
  // filter from blowing up if a future bug slips one through).
  card.setAttribute('data-tags', (show.tags || []).join(' '));
  card.href = `?show=${encodeURIComponent(show.id)}`;
  card.setAttribute('role', 'listitem');

  const poster = document.createElement('div');
  poster.className = 'tv-show-poster';
  poster.style.background = `linear-gradient(160deg, ${show.accent}33, #111)`;

  const img = document.createElement('img');
  img.loading = 'lazy';
  img.decoding = 'async';
  img.alt = `${show.name} poster`;
  // Resolve the actual poster URL via TVMaze only once this card is
  // near the viewport. See `lazyResolvePoster` for why — TL;DR
  // `loading="lazy"` defers the byte download once src is set, but
  // not the metadata round-trip that produces the src. Until the
  // observer fires the gradient background fills the tile so we
  // don't show a broken icon.
  lazyResolvePoster(img, () => {
    fetchPoster(show.tvmazeId).then((url) => {
      if (url) img.src = url;
    });
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

  // Plex/Netflix-style compact caption: just the show title, single
  // line, sub-poster. No tagline blurb — the row reads as a poster
  // wall first, with the title there for shows whose poster art
  // doesn't include the name. The full tagline + emoji etc. live on
  // the show's own episodes view if a user wants more context.
  const meta = document.createElement('div');
  meta.className = 'tv-show-meta';
  const name = document.createElement('h2');
  name.className = 'tv-show-name';
  // shortName when present keeps very long titles ("Spider-Man: The
  // Animated Series") from blowing past the ellipsis on narrow tiles.
  name.textContent = show.shortName || show.name;
  name.title = show.name;
  meta.appendChild(name);

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
 * TVMaze's CDN is reliable once warm but the *first* request to a
 * cold-cached show id (e.g. one whose sheet row was just added)
 * frequently hangs past the browser's CORS-preflight timeout, producing the
 * "blocked by CORS policy: No 'Access-Control-Allow-Origin'" symptom
 * in devtools. We handle that with: short per-attempt timeout (so a
 * cold edge doesn't burn 30 s), one fast retry, then a fallback
 * through `window.proxyService` (corsproxy.io etc.) which warms a
 * different cache path.
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
  // The main `/shows/<id>` endpoint already includes the canonical
  // poster as `image.medium` / `image.original`. That's both more
  // reliable than `/shows/<id>/images` (one request, one cache entry
  // on TVMaze's side) and matches what most other TVMaze consumers
  // use, so we hit a hotter CDN path.
  const url = `https://api.tvmaze.com/shows/${tvmazeId}`;
  const data = await fetchTvmazeShow(url);
  const posterUrl = data?.image?.medium || data?.image?.original || null;
  try {
    localStorage.setItem(key, JSON.stringify({ ts: Date.now(), url: posterUrl }));
  } catch {
    /* quota; we just refetch next visit */
  }
  return posterUrl;
}

/**
 * Two direct attempts (5 s + 8 s) then one proxy attempt. Returns the
 * parsed JSON object, or `null` if every path failed. We don't throw
 * — a missing poster is recoverable (the emoji fallback kicks in via
 * `img.error`) and we don't want to spam the console with rejections.
 *
 * @param {string} url
 * @returns {Promise<any | null>}
 */
async function fetchTvmazeShow(url) {
  for (const timeoutMs of [5000, 8000]) {
    try {
      const res = await fetch(url, {
        credentials: 'omit',
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (res.ok) return await res.json();
    } catch {
      /* try next attempt */
    }
  }
  if (typeof window !== 'undefined' && window.proxyService?.fetchJson) {
    try {
      return await window.proxyService.fetchJson(url, { skipDirect: true });
    } catch {
      /* swallow — caller handles null */
    }
  }
  return null;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

/**
 * Single shared IntersectionObserver that defers TVMaze poster
 * resolution until a card is about to enter the viewport. The native
 * `loading="lazy"` attribute on the `<img>` itself already handles
 * deferring the byte download once `img.src` is set, but the metadata
 * round-trip that *produces* that src (`fetchPoster` → TVMaze API +
 * localStorage cache) still fires synchronously at card-creation
 * time. On a cold cache with 50+ cards on the home grid that's a
 * burst of TVMaze requests for cards the user may never scroll to.
 *
 * `rootMargin: 400px` is generous on purpose: we'd rather start
 * resolving 1–2 viewport-heights early than have the user see a
 * placeholder gradient flash in. The cost is asymmetric — a
 * speculative fetch is cheap (cached for 30 days after) but a
 * visible placeholder where art should be is a UX miss, especially
 * on TV where you can't quickly scroll back to "double-check" what
 * a card was. Threshold 0 fires as soon as any pixel intersects.
 *
 * Falls back to immediate (synchronous) loading when
 * `IntersectionObserver` isn't available — older WebViews on cheap
 * TV firmware sometimes ship without it.
 * @type {IntersectionObserver | null}
 */
const _posterObserver =
  typeof IntersectionObserver === 'undefined'
    ? null
    : new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const el = entry.target;
            _posterObserver?.unobserve(el);
            const fn = _posterLoaders.get(el);
            if (!fn) continue;
            _posterLoaders.delete(el);
            try {
              fn();
            } catch {
              /* loader is the caller's TVMaze fetch; failures are
                 already surfaced via img.error → emoji fallback. */
            }
          }
        },
        { rootMargin: '400px 0px', threshold: 0 }
      );

/**
 * Per-element loader registry. WeakMap so removing a card from the
 * DOM before the observer fires lets the entry GC naturally without
 * us tracking unmount lifecycles.
 * @type {WeakMap<Element, () => void>}
 */
const _posterLoaders = new WeakMap();

/**
 * Register a callback that resolves an `<img>`'s `src` lazily — fired
 * once when the element is within ~400px of the viewport. Use this
 * for cards whose poster URL has to be looked up asynchronously
 * (TVMaze) rather than handed in directly. Callers whose poster URL
 * is already known (`posterUrl` registry field) should just set
 * `img.src` synchronously; the browser's native `loading="lazy"`
 * already handles deferring the byte download.
 *
 * @param {HTMLElement} el      The element to observe (usually the `<img>` itself).
 * @param {() => void} load     Synchronous trigger; called at most once.
 */
function lazyResolvePoster(el, load) {
  if (!_posterObserver) {
    load();
    return;
  }
  _posterLoaders.set(el, load);
  _posterObserver.observe(el);
}

/**
 * Release a lazy-poster observation early — call when the host card is
 * about to be removed from the DOM (e.g. the scroll window rewinds on
 * a filter change). IntersectionObserver targets are *strong* refs
 * inside the observer, so without an explicit `unobserve` the removed
 * card and its `<img>` stay alive for as long as the observer does.
 *
 * Idempotent: safe to call on elements that were never registered.
 *
 * @param {HTMLElement} el
 */
function cancelLazyPoster(el) {
  if (!_posterObserver) return;
  _posterLoaders.delete(el);
  _posterObserver.unobserve(el);
}

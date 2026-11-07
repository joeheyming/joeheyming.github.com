/**
 * Fixed-position left-edge "quick nav" rail for the /watch/ app.
 *
 * The breadcrumb trail and back button cover "go up a level" — they
 * don't cover "I'm watching an episode of show X, jump straight to
 * the movies grid". This rail closes that gap with two big tap
 * targets that are always reachable regardless of which view is
 * mounted (landing, episodes, watch, movie watch).
 *
 * Design notes:
 *
 *   - Imported for side effects from `index.js`. The module mounts a
 *     single `<aside>` to `document.body` at first paint and updates
 *     the active-state on `popstate` (matches the router's own
 *     re-route trigger). No coupling to specific view modules.
 *   - Auto-hides inside an iframe (same heuristic `nav.js` uses) so
 *     Heyming OS windows don't double up with the OS taskbar.
 *   - Auto-hides on narrow viewports (CSS media query) so the rail
 *     doesn't overlap the video player on phones; the breadcrumb +
 *     back button cover the mobile case.
 *   - Auto-hides on the watch view *in TV mode only*. On a 10-foot
 *     Android-TV display the rail intercepts D-pad focus and
 *     overlaps the player chrome (and the user reported it physically
 *     gets in the way during playback). Desktop / mouse browsers
 *     keep the rail on every view — same `isTvMode` check that the
 *     watch view itself uses to decide between TV chrome and laptop
 *     chrome. The "player view" is detected by the same `e=` / `movie=`
 *     query-string heuristic the Android shell's `isWatchUrl` uses.
 *   - The Movies button writes a `#movies` hash before re-routing.
 *     `shows-view` reads the hash on mount and scrolls its Movies
 *     section into view.
 *   - If the sheet has no `type='movie'` subjects the rail still
 *     renders but the Movies button is hidden — keeps the Shows button
 *     useful as a "back to all shows" shortcut.
 */

import { getMovies } from './data-source.js';
import { isTvMode } from './mode.js';
import { listContinueWatching } from './prefs.js';

/**
 * Match the Android shell's `isWatchUrl` heuristic: any `?show=…&e=`
 * or `?movie=` URL is a playback view. Episodes-list URLs
 * (`?show=foo` with no `e=`) and the landing page itself do *not*
 * count — those are navigation views where the rail is useful.
 *
 * Keep this in lockstep with `MainActivity.kt` in the watch-tv repo;
 * both files care about the same set of URL shapes for different
 * reasons (rail visibility here, D-pad center-press routing there).
 *
 * @param {Location} loc
 */
function isPlayerView(loc) {
  const q = loc.search.startsWith('?') ? loc.search.slice(1) : loc.search;
  if (!q) return false;
  return q.split('&').some((p) => p.startsWith('e=') || p.startsWith('movie='));
}

/**
 * Run the rail mount. Guards against double-mount (the script could
 * in principle be imported twice through a refactor) by checking for
 * an existing `#tv-quicknav` node.
 *
 * Async because the Movies-pill visibility depends on the registry
 * size (`getMovies().length > 0`); the registry comes from a gviz
 * fetch the data-source layer caches client-side, so cold start is
 * one round-trip and every subsequent mount is a cache hit. The mount
 * is fire-and-forget from the boot site — the rail just appears a
 * frame later on the very first page load.
 */
async function init() {
  // Inside an iframe (Heyming OS windowed app, embedded preview,
  // etc.) the parent shell owns the navigation. The same hide-rule
  // nav.js uses keeps the two in lockstep — if one hides the other
  // should hide too.
  if (window.top !== window) return;
  if (document.getElementById('tv-quicknav')) return;

  const nav = document.createElement('aside');
  nav.id = 'tv-quicknav';
  nav.className = 'tv-quicknav';
  nav.setAttribute('aria-label', 'Watch quick navigation');

  // The Recent button is conditional: only rendered when the user
  // has at least one continue-watching entry. We re-check on each
  // popstate so first-watch + back-to-landing flips it on without
  // a full reload. Reference is captured here so updateActive can
  // refresh visibility.
  /** @type {HTMLAnchorElement | null} */
  let recentBtn = null;

  const searchBtn = makeNavButton({
    emoji: '🔍',
    label: 'Search',
    href: './#search',
    // Search is an action, not a destination. The hash is consumed +
    // cleared by the landing page, so there's no persistent URL state
    // we can highlight from. Leave inactive always.
    matches: () => false
  });
  nav.appendChild(searchBtn.el);

  recentBtn = makeNavButton({
    emoji: '🕒',
    label: 'Recent',
    href: './#continue',
    // Hash gets cleared on scroll by the landing page (continue
    // section is at the top of the grid anyway), so there's no
    // long-lived URL state to match against. Inactive when no
    // continue list, otherwise neutral.
    matches: () => false
  }).el;
  nav.appendChild(recentBtn);

  const showsBtn = makeNavButton({
    emoji: '📺',
    label: 'Shows',
    href: './',
    matches: (loc) => !loc.search.includes('movie=') && loc.hash !== '#movies'
  });
  nav.appendChild(showsBtn.el);

  // Hide the Movies pill entirely when the registry has no entries —
  // the Shows pill stays useful as a one-tap "home" shortcut.
  const movies = await getMovies();
  if (movies.length > 0) {
    const moviesBtn = makeNavButton({
      emoji: '🎬',
      label: 'Movies',
      href: './#movies',
      matches: (loc) => loc.search.includes('movie=') || loc.hash === '#movies'
    });
    nav.appendChild(moviesBtn.el);
  }

  document.body.appendChild(nav);
  attachQuicknavKeys();

  // Refresh active-state when the URL changes. `popstate` fires on
  // browser back/forward AND on the router's own manually-dispatched
  // PopStateEvent (see navigate() in index.js). `pushState` itself
  // doesn't fire popstate, so the manual dispatch from the router is
  // load-bearing — without it, clicking a quicknav button wouldn't
  // re-highlight on the destination view.
  window.addEventListener('popstate', updateActive);
  // Also re-check after our own clicks (we don't always get a
  // popstate for same-document navigations to the same path).
  window.addEventListener('hashchange', updateActive);
  // Re-check on tab focus so cross-tab edits to localStorage (rare,
  // but possible if the user has two /watch/ tabs open) show up the
  // next time this tab is active.
  window.addEventListener('focus', updateActive);
  updateActive();

  function updateActive() {
    const loc = window.location;
    // Hide the entire rail on the player view *in TV mode only*. On
    // the Android-TV WebView the rail intercepts D-pad focus and
    // overlaps the chassis chrome; on desktop / mouse browsers it
    // stays put on every view (the user can just move the mouse).
    nav.classList.toggle('tv-quicknav--hidden-on-player', isTvMode && isPlayerView(loc));
    for (const node of nav.querySelectorAll('[data-quicknav]')) {
      const matches = matchersById[/** @type {HTMLElement} */ (node).dataset.quicknav || ''];
      if (matches && matches(loc)) node.classList.add('is-active');
      else node.classList.remove('is-active');
    }
    // Show/hide the Recent button based on whether the user has
    // anything to continue. Empty list => the button would jump to a
    // hidden section, which is dishonest UI; hide it instead.
    if (recentBtn) {
      const hasRecent = listContinueWatching().length > 0;
      recentBtn.classList.toggle('hidden', !hasRecent);
    }
  }
}

/** @type {Record<string, (loc: Location) => boolean>} */
const matchersById = {};

/**
 * @param {{emoji: string, label: string, href: string, matches: (loc: Location) => boolean}} opts
 */
function makeNavButton({ emoji, label, href, matches }) {
  const id = label.toLowerCase();
  matchersById[id] = matches;

  const a = document.createElement('a');
  a.className = 'tv-quicknav-btn';
  a.href = href;
  a.dataset.quicknav = id;
  a.setAttribute('role', 'button');
  a.setAttribute('aria-label', `Jump to ${label}`);

  const emojiSpan = document.createElement('span');
  emojiSpan.className = 'tv-quicknav-emoji';
  emojiSpan.setAttribute('aria-hidden', 'true');
  emojiSpan.textContent = emoji;
  const labelSpan = document.createElement('span');
  labelSpan.className = 'tv-quicknav-label';
  labelSpan.textContent = label;
  a.appendChild(emojiSpan);
  a.appendChild(labelSpan);

  // Intercept clicks so we can stay inside the SPA router. Middle-
  // click, cmd/ctrl-click, etc. fall through to the browser default
  // and open a new tab — that's why `href` is a real URL, not a
  // `javascript:` link.
  a.addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1) return;
    e.preventDefault();
    const targetUrl = new URL(href, window.location.href);
    // Only push history when we're actually moving. Re-clicking the
    // currently-active button just smooth-scrolls (handy if the user
    // scrolled away from the section and wants to snap back).
    const samePath =
      targetUrl.pathname === window.location.pathname &&
      targetUrl.search === window.location.search;
    if (samePath && targetUrl.hash === window.location.hash) {
      scrollForHash(targetUrl.hash);
      return;
    }
    window.history.pushState(null, '', targetUrl.toString());
    // The router's popstate handler does the actual view swap.
    window.dispatchEvent(new PopStateEvent('popstate'));
    // The view mounts asynchronously (dynamic import + IA fetch),
    // so defer scroll to after the next microtask + a beat so the
    // landing-page sections exist in the DOM.
    if (targetUrl.hash) {
      requestAnimationFrame(() => requestAnimationFrame(() => scrollForHash(targetUrl.hash)));
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });

  return { el: a };
}

/** @param {string} hash */
function scrollForHash(hash) {
  if (!hash) return;
  const id = hash.replace(/^#/, '');
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

let quicknavKeysBound = false;

/**
 * Where Right from a rail button should land: the search field, or
 * the first poster in that button's section. The card the user left
 * can be a long way from the section the button names.
 * @param {HTMLElement} btn
 * @returns {HTMLElement | null}
 */
function sectionTarget(btn) {
  /** @type {Record<string, string>} */
  const sectionId = {
    search: 'search',
    recent: 'continue',
    shows: 'shows',
    movies: 'movies'
  };
  const id = sectionId[btn.dataset.quicknav || ''];
  const section = id ? document.getElementById(id) : null;
  if (!section || section.hidden || section.classList.contains('hidden')) return null;
  if (id === 'search') {
    return /** @type {HTMLElement | null} */ (section.querySelector('input, textarea')) || section;
  }
  return /** @type {HTMLElement | null} */ (
    section.querySelector('a.tv-continue-card, a.tv-show-card, a.tv-ep-card')
  );
}

/**
 * Visible rail buttons, top to bottom. Hidden entries (no continue
 * list, or the whole rail on a phone) are skipped.
 * @returns {HTMLElement[]}
 */
function railButtons() {
  const nav = document.getElementById('tv-quicknav');
  if (!nav) return [];
  const rail = getComputedStyle(nav);
  if (rail.display === 'none' || rail.visibility === 'hidden') return [];
  return /** @type {HTMLElement[]} */ ([...nav.querySelectorAll('a.tv-quicknav-btn')]).filter(
    (btn) => {
      if (btn.hidden || btn.classList.contains('hidden')) return false;
      const rect = btn.getBoundingClientRect();
      return rect.width >= 2 && rect.height >= 2;
    }
  );
}

/**
 * The card under `node` when it is the leftmost poster in its row.
 * Left from that card is the only arrow that may enter the rail.
 * @param {EventTarget | null} node
 * @returns {HTMLElement | null}
 */
function farLeftCard(node) {
  if (!node || /** @type {Node} */ (node).nodeType !== 1) return null;
  const el = /** @type {Element} */ (node);
  const card = /** @type {HTMLElement | null} */ (
    el.closest('a.tv-show-card, a.tv-continue-card, a.tv-ep-card')
  );
  if (!card || !card.parentElement) return null;
  const siblings = /** @type {HTMLElement[]} */ (
    [...card.parentElement.children].filter(
      (child) =>
        child.classList.contains('tv-show-card') ||
        child.classList.contains('tv-continue-card') ||
        child.classList.contains('tv-ep-card')
    )
  );
  const top = card.offsetTop;
  let minLeft = card.offsetLeft;
  for (const sibling of siblings) {
    if (Math.abs(sibling.offsetTop - top) > 2) continue;
    if (sibling.offsetLeft < minLeft) minLeft = sibling.offsetLeft;
  }
  if (card.offsetLeft > minLeft + 2) return null;
  return card;
}

/**
 * @param {HTMLElement} card
 * @param {HTMLElement[]} buttons
 */
function nearestButton(card, buttons) {
  const origin = card.getBoundingClientRect();
  const cy = origin.top + origin.height / 2;
  let best = buttons[0];
  let bestDist = Infinity;
  for (const btn of buttons) {
    const rect = btn.getBoundingClientRect();
    const dist = Math.abs(rect.top + rect.height / 2 - cy);
    if (dist < bestDist) {
      bestDist = dist;
      best = btn;
    }
  }
  return best;
}

/**
 * Left from a far-left poster enters the rail. On the rail, Up and
 * Down move between the buttons, and Right focuses the first poster
 * in that button's section (the search field for Search). Every
 * other arrow leaves the rail alone, and geometry-based arrow
 * movement never targets it (see `inQuicknav` in remote.js).
 */
export function attachQuicknavKeys() {
  if (quicknavKeysBound) return;
  quicknavKeysBound = true;

  /** @param {KeyboardEvent & { heymingGridNav?: boolean }} e */
  const onKey = (e) => {
    if (e.heymingGridNav || !/^Arrow/.test(e.key || '')) return;
    const node = e.target;
    if (!node || /** @type {Node} */ (node).nodeType !== 1) return;
    const el = /** @type {Element} */ (node);
    const railBtn = /** @type {HTMLElement | null} */ (el.closest('a.tv-quicknav-btn'));
    if (railBtn && railBtn.closest('#tv-quicknav')) {
      const buttons = railButtons();
      const index = buttons.indexOf(railBtn);
      if (index < 0) return;
      e.preventDefault();
      e.heymingGridNav = true;
      if (e.key === 'ArrowDown' && index + 1 < buttons.length) buttons[index + 1].focus();
      else if (e.key === 'ArrowUp' && index > 0) buttons[index - 1].focus();
      else if (e.key === 'ArrowRight') {
        const dest = sectionTarget(railBtn);
        if (dest) {
          dest.focus();
          if (typeof dest.scrollIntoView === 'function') {
            dest.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          }
        }
      }
      return;
    }
    if (e.key !== 'ArrowLeft') return;
    const card = farLeftCard(el);
    if (!card) return;
    const buttons = railButtons();
    if (buttons.length === 0) return;
    const next = nearestButton(card, buttons);
    e.preventDefault();
    e.heymingGridNav = true;
    next.focus();
  };
  window.addEventListener('keydown', onKey, true);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    void init();
  });
} else {
  void init();
}

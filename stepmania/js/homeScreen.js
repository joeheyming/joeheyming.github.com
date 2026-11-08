// Idle home overlay shown when no song is loaded.

import { blockReasonForSong, getFavorites, getRecentSongs } from './zeniusLibraryStorage.js';
import { loadPopularSongs } from './popularSongs.js';

/**
 * @param {string} zeniusUrl
 * @returns {string}
 */
export function zeniusPlayHref(zeniusUrl) {
  const qs = new URLSearchParams();
  qs.set('zenius', zeniusUrl);
  if (typeof window === 'undefined' || !window.location) {
    return `?${qs.toString()}`;
  }
  return `${window.location.pathname}?${qs.toString()}`;
}

/**
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * @param {HTMLElement} mount
 * @param {{ zeniusUrl: string, title: string }[]} entries
 * @param {string} emptyText
 */
function renderLinkList(mount, entries, emptyText, max = 8, playSurface = '') {
  if (entries.length === 0) {
    mount.innerHTML = `<p class="sm-home-empty">${escapeHtml(emptyText)}</p>`;
    return;
  }
  const items = entries
    .slice(0, max)
    .map((entry) => {
      const title = entry.title && entry.title.trim() ? entry.title.trim() : 'Unknown song';
      const blocked = blockReasonForSong(entry);
      if (blocked) {
        return `<span class="sm-home-chip is-unplayable" title="${escapeHtml(
          `${title}: ${blocked}`
        )}">${escapeHtml(title)}<span class="sm-sr-only"> (${escapeHtml(blocked)})</span></span>`;
      }
      const href = zeniusPlayHref(entry.zeniusUrl);
      const tracked = playSurface
        ? ` data-play-link="${escapeHtml(playSurface)}" data-play-name="${escapeHtml(title)}"`
        : '';
      return `<a class="sm-home-chip"${tracked} href="${escapeHtml(href)}">${escapeHtml(
        title
      )}</a>`;
    })
    .join('');
  mount.innerHTML = items;
}

const POPULAR_PREVIEW = 5;
const POPULAR_MORE = 20;

let popularToken = 0;
let popularExpanded = false;
let popularFull = false;
/** @type {{ zeniusUrl: string, title: string, simfileId?: string }[]} */
let popularEntries = [];

function popularHasMore() {
  if (popularEntries.length < POPULAR_PREVIEW) return false;
  if (popularFull) return popularEntries.length > POPULAR_PREVIEW;
  return true;
}

function paintPopular() {
  const section = document.getElementById('sm-home-popular');
  const mount = document.getElementById('sm-home-popular-chips');
  if (!section || !mount) return;
  if (!popularEntries.length) {
    section.hidden = true;
    mount.replaceChildren();
    return;
  }
  const shown = popularExpanded ? popularEntries : popularEntries.slice(0, POPULAR_PREVIEW);
  renderLinkList(mount, shown, '', shown.length, 'sm-home-popular');
  section.hidden = false;
  const more = document.getElementById('sm-home-popular-more');
  const hint = document.getElementById('sm-home-popular-hint');
  const extra = popularHasMore();
  if (more) {
    more.classList.toggle('is-static', !extra);
    more.setAttribute('aria-expanded', popularExpanded && extra ? 'true' : 'false');
  }
  if (hint) {
    hint.hidden = !extra;
    hint.textContent = popularExpanded ? 'Show less' : 'Show more';
  }
}

function refreshPopular() {
  const section = document.getElementById('sm-home-popular');
  const mount = document.getElementById('sm-home-popular-chips');
  if (!section || !mount) return Promise.resolve();
  const token = ++popularToken;
  const limit = popularExpanded ? POPULAR_MORE : POPULAR_PREVIEW;
  return loadPopularSongs(limit)
    .then((entries) => {
      if (token !== popularToken) return;
      popularEntries = entries;
      if (limit === POPULAR_MORE) popularFull = true;
      if (popularFull && popularEntries.length <= POPULAR_PREVIEW) popularExpanded = false;
      paintPopular();
    })
    .catch(() => {
      if (token !== popularToken) return;
      section.hidden = true;
    });
}

/**
 * The "Played a lot" heading opens the rest of that list, and folds it again.
 * @returns {Promise<void>}
 */
export function togglePopularList() {
  if (popularExpanded) {
    popularExpanded = false;
    paintPopular();
    return Promise.resolve();
  }
  if (popularEntries.length < POPULAR_PREVIEW) return Promise.resolve();
  popularExpanded = true;
  return refreshPopular();
}

export function refreshHomeLists() {
  const recentEl = document.getElementById('sm-home-recent');
  const savedEl = document.getElementById('sm-home-saved');
  if (recentEl) {
    renderLinkList(recentEl, getRecentSongs(), 'Songs you play will show up here.');
  }
  if (savedEl) {
    renderLinkList(savedEl, getFavorites(), 'Heart a chart in the library to save it.');
  }
  return refreshPopular();
}

/**
 * True while the song picker is the surface that should receive arrows.
 * A chart, the library modal, and the keybinding sheet take over from it.
 * @returns {boolean}
 */
export function homeMenuOwnsArrows() {
  if (typeof document === 'undefined') return false;
  const home = document.getElementById('sm-home');
  if (!home || home.hidden) return false;
  if (document.querySelector('zenius-browser.modal-open')) return false;
  const sheet = document.querySelector('sm-settings-sheet');
  if (sheet && !sheet.hidden) return false;
  return true;
}

/**
 * These already move focus, or edit a value, on their own.
 * @param {Element|null} el
 * @returns {boolean}
 */
function controlKeepsArrow(el) {
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  return (
    tag === 'BUTTON' ||
    tag === 'A' ||
    tag === 'INPUT' ||
    tag === 'SELECT' ||
    tag === 'TEXTAREA' ||
    tag === 'SUMMARY' ||
    tag === 'AUDIO' ||
    tag === 'VIDEO' ||
    !!el.isContentEditable
  );
}

let homeArrowsBound = false;
let homeActionsBound = false;

function onHomeArrow(event) {
  const focus = window.heymingRemote;
  const isPlain =
    focus && typeof focus.plainArrow === 'function'
      ? focus.plainArrow(event)
      : /^arrow/i.test(event.key || '') &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey;
  if (!homeMenuOwnsArrows() || !isPlain || event.defaultPrevented) return;
  const el = focus && typeof focus.eventTarget === 'function' ? focus.eventTarget(event) : null;
  if (controlKeepsArrow(el)) return;
  event.preventDefault();
  event.stopPropagation();
  const tag = el && el.tagName;
  if (!el || tag === 'BODY' || tag === 'HTML') {
    const browse = document.getElementById('sm-home-browse');
    if (browse) browse.focus();
    return;
  }
  const before = document.activeElement;
  if (focus && typeof focus.moveFocus === 'function') {
    focus.moveFocus(event);
  }
  if (document.activeElement === before) {
    const browse = document.getElementById('sm-home-browse');
    if (browse) browse.focus();
  }
}

function bindHomeArrows() {
  if (homeArrowsBound) return;
  homeArrowsBound = true;
  document.addEventListener('keydown', onHomeArrow, true);
}

function focusHomeBrowse() {
  if (!homeMenuOwnsArrows()) return;
  const browse = document.getElementById('sm-home-browse');
  if (browse) browse.focus();
}

/**
 * @param {string} message
 */
export function showHomeNotice(message) {
  const el = document.getElementById('sm-boot-error');
  if (!el) return;
  el.hidden = false;
  el.textContent = message;
  showHomeScreen();
}

/**
 * Plain left-clicks on a recent or saved song stay on this page.
 * Modified clicks keep the link's normal navigation.
 * @param {MouseEvent} event
 * @param {(zeniusUrl: string) => void} onPlayZenius
 */
function onHomeSongClick(event, onPlayZenius) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return;
  }
  const raw = event.target;
  const target = raw instanceof Element ? raw : raw instanceof Node ? raw.parentElement : null;
  const link = target && target.closest('a.sm-home-chip');
  if (!link) return;
  const href = link.getAttribute('href') || '';
  const query = href.includes('?') ? href.slice(href.indexOf('?') + 1) : '';
  const zenius = new URLSearchParams(query).get('zenius');
  if (!zenius) return;
  event.preventDefault();
  onPlayZenius(zenius);
}

export function bindHomeScreen(handlers = {}) {
  bindHomeArrows();
  focusHomeBrowse();
  if (homeActionsBound) return;
  homeActionsBound = true;

  const popularMore = document.getElementById('sm-home-popular-more');
  if (popularMore) {
    popularMore.addEventListener('click', () => {
      void togglePopularList();
    });
  }

  const browse = document.getElementById('sm-home-browse');
  if (browse) {
    browse.addEventListener('click', () => {
      if (handlers.onBrowse) {
        handlers.onBrowse();
        return;
      }
      const browser = document.querySelector('zenius-browser');
      if (browser && typeof browser.showBrowser === 'function') {
        browser.showBrowser();
      }
    });
  }

  const openPack = document.getElementById('sm-home-open-pack');
  const packInput = document.getElementById('sm-home-pack-input');
  if (openPack && packInput) {
    openPack.addEventListener('click', () => packInput.click());
    packInput.addEventListener('change', () => {
      const file = packInput.files && packInput.files[0];
      packInput.value = '';
      if (file && handlers.onOpenFile) handlers.onOpenFile(file);
    });
  }

  const dropTarget = document.getElementById('sm-home');
  if (dropTarget && handlers.onOpenFile) {
    dropTarget.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropTarget.classList.add('is-drop');
    });
    dropTarget.addEventListener('dragleave', () => dropTarget.classList.remove('is-drop'));
    dropTarget.addEventListener('drop', (e) => {
      e.preventDefault();
      dropTarget.classList.remove('is-drop');
      const file = e.dataTransfer?.files?.[0];
      if (file) handlers.onOpenFile(file);
    });
  }

  if (dropTarget && handlers.onPlayZenius) {
    dropTarget.addEventListener('click', (event) => {
      onHomeSongClick(event, handlers.onPlayZenius);
    });
  }
}

export function showHomeScreen() {
  const home = document.getElementById('sm-home');
  const gameArea = document.getElementById('sm-micro');
  if (gameArea) {
    gameArea.style.backgroundImage = '';
    gameArea.classList.add('is-home');
  }
  refreshHomeLists();
  if (home) {
    home.hidden = false;
    focusHomeBrowse();
  }
}

export function hideHomeScreen() {
  const home = document.getElementById('sm-home');
  const gameArea = document.getElementById('sm-micro');
  if (home) {
    home.hidden = true;
  }
  if (gameArea) {
    gameArea.classList.remove('is-home');
  }
}

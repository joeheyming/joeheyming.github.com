// Idle home overlay shown when no song is loaded.

import { getFavorites, getRecentSongs } from './zeniusLibraryStorage.js';

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
function renderLinkList(mount, entries, emptyText) {
  if (entries.length === 0) {
    mount.innerHTML = `<p class="sm-home-empty">${escapeHtml(emptyText)}</p>`;
    return;
  }
  const items = entries
    .slice(0, 8)
    .map((entry) => {
      const href = zeniusPlayHref(entry.zeniusUrl);
      const title = entry.title && entry.title.trim() ? entry.title.trim() : 'Unknown song';
      return `<a class="sm-home-chip" href="${escapeHtml(href)}">${escapeHtml(title)}</a>`;
    })
    .join('');
  mount.innerHTML = items;
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

export function bindHomeScreen(handlers = {}) {
  bindHomeArrows();
  focusHomeBrowse();
  const browse = document.getElementById('sm-home-browse');
  if (browse) {
    browse.addEventListener('click', () => {
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

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

export function bindHomeScreen(handlers = {}) {
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

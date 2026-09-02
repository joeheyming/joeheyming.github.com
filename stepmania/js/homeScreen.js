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

export function bindHomeScreen() {
  const browse = document.getElementById('sm-home-browse');
  if (browse) {
    browse.addEventListener('click', () => {
      if (typeof window.trackEvent === 'function') {
        window.trackEvent('song_browser_open', 'StepMania', 'Home');
      }
      const browser = document.querySelector('zenius-browser');
      if (browser && typeof browser.showBrowser === 'function') {
        browser.showBrowser();
      }
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

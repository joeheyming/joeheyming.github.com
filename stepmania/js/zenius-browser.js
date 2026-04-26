// Zenius Browser Web Component - ES Module
import { adoptSharedStyles } from './sharedStyles.js';
import { createComponentProxy } from './componentProxy.js';
import {
  getRecentSongs,
  getFavorites,
  isFavoriteSimfileId,
  toggleFavorite
} from './zeniusLibraryStorage.js';

const ZENIUS_V52 = 'https://zenius-i-vanisher.com/v5.2/';

/**
 * Links under the "Menu" heading on the simfiles home page (simfiles.php).
 * @param {Document} doc
 * @returns {Array<{ label: string, href: string }>}
 */
function extractSimfilesMenuLinks(doc) {
  const headings = doc.querySelectorAll('h2');
  /** @type {Element|null} */
  let menuH = null;
  for (const h of headings) {
    const t = h.textContent.replace(/\s+/g, ' ').trim();
    if (t.match(/^Menu\b/i)) {
      menuH = h;
      break;
    }
  }
  if (!menuH) {
    return [];
  }

  const out = [];
  const seen = new Set();
  const FLAG_FOLLOW = Node.DOCUMENT_POSITION_FOLLOWING;

  const tryAddAnchor = (a) => {
    if (!(a instanceof HTMLAnchorElement)) {
      return;
    }
    const href = a.getAttribute('href');
    if (!href || href.startsWith('#') || href.toLowerCase().startsWith('javascript:')) {
      return;
    }
    const label = a.textContent.replace(/\s+/g, ' ').trim();
    if (!label) {
      return;
    }
    let abs;
    try {
      abs = new URL(href, ZENIUS_V52);
    } catch {
      return;
    }
    if (!abs.hostname.includes('zenius-i-vanisher.com')) {
      return;
    }
    if (seen.has(abs.href)) {
      return;
    }
    seen.add(abs.href);
    out.push({ label, href: abs.href });
  };

  let el = menuH.nextElementSibling;
  while (el) {
    if (el.tagName === 'H2' || el.tagName === 'H1') {
      break;
    }
    const anchors =
      el.tagName === 'A' && el.getAttribute('href') ? [el] : el.querySelectorAll('a[href]');
    for (const a of anchors) {
      tryAddAnchor(/** @type {Element} */ (a));
    }
    el = el.nextElementSibling;
  }

  // Table layout: links often sit in the same cell as the “Menu” heading
  if (out.length === 0 && menuH.parentElement) {
    for (const a of menuH.parentElement.querySelectorAll('a[href]')) {
      if (menuH.compareDocumentPosition(a) & FLAG_FOLLOW) {
        tryAddAnchor(/** @type {Element} */ (a));
      }
    }
  }

  return out;
}

/** @param {Document} doc */
function extractSimfilesCategoryLinksFromPage(doc) {
  const out = [];
  const seen = new Set();
  for (const a of doc.querySelectorAll('a[href*="simfiles.php?category="]')) {
    if (!(a instanceof HTMLAnchorElement)) {
      continue;
    }
    const href = a.getAttribute('href');
    if (!href) {
      continue;
    }
    let abs;
    try {
      abs = new URL(href, ZENIUS_V52);
    } catch {
      continue;
    }
    if (!abs.hostname.includes('zenius-i-vanisher.com')) {
      continue;
    }
    const cat = abs.searchParams.get('category') || '';
    if (!cat || cat === 'simfiles' || cat === 'help') {
      continue;
    }
    if (seen.has(abs.href)) {
      continue;
    }
    const label = a.textContent.replace(/\s+/g, ' ').trim() || cat;
    seen.add(abs.href);
    out.push({ label, href: abs.href });
  }
  return out;
}

/**
 * @param {Array<{ label: string, href: string }>} menuFirst
 * @param {Array<{ label: string, href: string }>} fromAnchors
 * @returns {Array<{ label: string, href: string }>}
 */
function mergeMenuAndCategoryLinkLabels(menuFirst, fromAnchors) {
  const byHref = new Map();
  for (const x of fromAnchors) {
    byHref.set(x.href, { label: x.label, href: x.href });
  }
  for (const x of menuFirst) {
    const prev = byHref.get(x.href);
    if (!prev || (x.label && x.label.length > (prev.label || '').length)) {
      byHref.set(x.href, { label: x.label, href: x.href });
    }
  }
  return Array.from(byHref.values());
}

/** @param {string} label */
function isSpotlightListLabel(label) {
  const t = label.replace(/\s+/g, ' ').toLowerCase();
  if (t.length < 6) {
    return false;
  }
  if (t === 'help' || /^\s*help(\s+|$)/.test(t)) {
    return false;
  }
  if (
    (t.includes('view simfile') && !t.includes('latest') && !t.includes('top')) ||
    t === 'view simfiles'
  ) {
    return false;
  }
  const hasLatest = t.includes('latest');
  const hasTop = /\btop\b/.test(t);
  const hasOfficial = t.includes('official');
  const hasUser = /\buser\b/.test(t);
  return (hasLatest || hasTop) && (hasOfficial || hasUser);
}

/**
 * @param {string} label
 * @returns {number}
 */
function spotlightRankForSort(label) {
  const t = label.toLowerCase();
  if (t.includes('latest') && t.includes('official')) {
    return 0;
  }
  if (t.includes('latest') && t.includes('user')) {
    return 1;
  }
  if (t.includes('top') && t.includes('official')) {
    return 2;
  }
  if (t.includes('top') && t.includes('user')) {
    return 3;
  }
  return 10;
}

/**
 * @param {string} href
 * @returns {number}
 */
function spotlightRankFromHref(href) {
  const u = href.toLowerCase();
  const m = u.match(/[?&]category=([^&]+)/);
  const c = m ? m[1] : '';
  if (c.includes('latest') && c.includes('official')) {
    return 0;
  }
  if (c.includes('latest') && c.includes('user')) {
    return 1;
  }
  if (c.includes('top') && c.includes('official')) {
    return 2;
  }
  if (c.includes('top') && c.includes('user')) {
    return 3;
  }
  return 10;
}

/**
 * @param {Array<{ label: string, href: string }>} links
 */
function selectSpotlightSourceLinks(links) {
  const picked = links.filter((l) => isSpotlightListLabel(l.label));
  picked.sort((a, b) => {
    const d = spotlightRankForSort(a.label) - spotlightRankForSort(b.label);
    if (d !== 0) {
      return d;
    }
    return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
  });
  const byRank = new Map();
  for (const p of picked) {
    const r = spotlightRankForSort(p.label);
    if (r < 4 && r >= 0 && !byRank.has(r)) {
      byRank.set(r, p);
    }
  }
  let inOrder = [0, 1, 2, 3].map((r) => byRank.get(r)).filter(Boolean);
  if (inOrder.length < 3) {
    const byH = new Map();
    for (const p of links) {
      const r = spotlightRankFromHref(p.href);
      if (r < 4 && r >= 0 && !byH.has(r)) {
        byH.set(r, p);
      }
    }
    inOrder = [0, 1, 2, 3].map((r) => byH.get(r)).filter(Boolean);
  }
  return inOrder;
}

const SPOTLIGHT_TOP_N = 10;

class ZeniusBrowserElement extends HTMLElement {
  /** @type {ZeniusBrowserElement|null} */
  static _instance = null;

  /** @type {Map<string, {hasVideo: boolean, difficulties: Array}>} */
  static simfileMetadataCache = new Map();

  /**
   * Get the singleton instance of the zenius browser
   * @returns {ZeniusBrowserElement|null}
   */
  static get() {
    if (!ZeniusBrowserElement._instance) {
      ZeniusBrowserElement._instance = document.querySelector('zenius-browser');
    }
    return ZeniusBrowserElement._instance;
  }

  /**
   * Update metadata cache for a simfile (called when a song is loaded)
   * @param {string} simfileId - The simfile ID
   * @param {Object} metadata - Metadata object with hasVideo, difficulties, etc.
   */
  static updateSimfileMetadata(simfileId, metadata) {
    ZeniusBrowserElement.simfileMetadataCache.set(simfileId, metadata);
  }

  /**
   * Get cached metadata for a simfile
   * @param {string} simfileId - The simfile ID
   * @returns {Object|null}
   */
  static getSimfileMetadata(simfileId) {
    return ZeniusBrowserElement.simfileMetadataCache.get(simfileId) || null;
  }

  /**
   * Remember a category so the browser can navigate to it when reopened
   * @param {string} categoryId - The category ID
   * @param {string} categoryName - The category name
   */
  static rememberCategory(categoryId, categoryName) {
    const instance = ZeniusBrowserElement.get();
    if (instance && categoryId) {
      instance.lastBrowsedCategoryId = categoryId;
      instance.lastBrowsedCategoryName = categoryName || 'Category';
    }
  }

  constructor() {
    super();
    this.currentPath = '';
    this.breadcrumbs = [];
    this.currentCategoryName = '';
    this.cache = new Map();
    this.lastBrowsedCategoryId = null;
    this.lastBrowsedCategoryName = null;
    /** @type {AbortController|null} */
    this._searchAbortController = null;
    this._searchDebounceTimer = null;
    this._localFilterDebounceTimer = null;
    /** @type {HTMLElement|null} */
    this._previouslyFocused = null;
    this._favoritesViewActive = false;
    this._onModalKeydownBound = (e) => this.handleModalKeydown(e);
    this._onGridKeydownBound = (e) => this.handleGridKeydown(e);
    this._lastSimfileListForSort = [];
    this._lastListPath = '';
    this._searchReqId = 0;
    /** @type {AbortController|null} */
    this._spotlightAbort = null;
    /** @type {Array<{ label: string, href: string }>|null} */
    this._lastSpotlightSourceLinks = null;
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
    this.init();
    adoptSharedStyles(this.shadowRoot);
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        /* Critical styles to prevent FOUC - modal hidden by default */
        .modal { opacity: 0; visibility: hidden; }
      </style>
      <div class="zenius-browser-container">
        <button class="zenius-browser-btn" id="open-zenius-browser">
          <span class="icon-only">🎵</span>
          <span class="text-label">Songs</span>
        </button>
      </div>
      
      <div class="modal" id="zenius-browser-modal">
        <div class="modal-content">
          <div class="modal-header">
            <h2 class="modal-title">Song Library Browser</h2>
          </div>
          
          <div class="modal-body">
            <div class="search-container">
              <div class="search-tabs">
                <button class="search-tab active" id="zenius-search-tab" data-mode="zenius">Search</button>
                <button class="search-tab" id="local-search-tab" data-mode="local">Category</button>
              </div>
              <div class="search-fields hidden" id="local-search-fields">
                <div class="breadcrumb" id="breadcrumb">
                  <span class="breadcrumb-item" data-path="">🏠 Home</span>
                </div>
                <p class="category-filter-hint" id="category-filter-hint">
                  Filter applies only to <strong>pages you have already opened</strong> this session. Use Search for the full site index.
                </p>
                <input 
                  type="text" 
                  class="search-input" 
                  id="search-input" 
                  placeholder="Filter loaded songs and folders in cache…"
                >
              </div>
              <div class="search-fields" id="zenius-search-fields">
                <input 
                  type="text" 
                  class="search-input" 
                  id="zenius-song-title" 
                  placeholder="Song title..."
                >
                <input 
                  type="text" 
                  class="search-input" 
                  id="zenius-song-artist" 
                  placeholder="Artist (optional)..."
                >
                <button class="search-btn" id="zenius-search-btn">🔍 Search</button>
              </div>
            </div>
            
            <div class="list-toolbar hidden" id="list-toolbar" aria-label="List options">
              <label class="list-toolbar-label" for="zenius-sort-select">Sort</label>
              <select class="zenius-sort-select" id="zenius-sort-select" title="Sort current list">
                <option value="name-asc">A–Z</option>
                <option value="name-desc">Z–A</option>
                <option value="video-first">Video first</option>
              </select>
            </div>
            
            <div class="stats" id="stats">
              <span id="item-count">0 items</span>
              <span id="current-path">Home</span>
            </div>
            
            <div class="content-grid" id="content-grid">
              <!-- Content will be populated here -->
            </div>
            
            <div class="zenius-spotlight" id="zenius-spotlight" hidden>
              <p class="zenius-spotlight-hint" id="zenius-spotlight-hint" hidden>Loading lists…</p>
              <div id="zenius-spotlight-sections" class="zenius-spotlight-sections"></div>
            </div>
            
            <div class="zenius-secondary-row" id="zenius-secondary-row">
              <div class="zenius-recent-block" id="zenius-recent-block">
                <span class="zenius-recent-label">Recent</span>
                <div class="zenius-recent-chips" id="zenius-recent-chips" role="list"></div>
              </div>
              <button type="button" class="zenius-saved-btn" id="zenius-saved-btn" title="Songs you starred">
                Saved
              </button>
            </div>
            
            <div class="loading-indicator" id="loading-indicator">
              <div class="spinner"></div>
              <p class="loading-text" id="loading-text">Loading content...</p>
              <div class="loading-progress">
                <div class="loading-progress-bar" id="loading-progress-bar"></div>
              </div>
            </div>
          </div>
          
          <div class="modal-footer">
            <div class="action-buttons">
              <button class="close-btn" id="close-zenius-browser">Close</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  init() {
    this.bindEvents();
    this.renderRecentChips();
    this.loadInitialContent();
  }

  bindEvents() {
    // Open browser
    this.shadowRoot.getElementById('open-zenius-browser').addEventListener('click', () => {
      // Track analytics event
      if (typeof window.trackEvent === 'function') {
        window.trackEvent('song_browser_open', 'StepMania', 'Song Browser Open');
      }
      this.showBrowser();
    });

    // Close browser
    this.shadowRoot.getElementById('close-zenius-browser').addEventListener('click', () => {
      this.hideBrowser();
    });

    // Close modal when clicking outside
    this.shadowRoot.getElementById('zenius-browser-modal').addEventListener('click', (e) => {
      if (e.target.id === 'zenius-browser-modal') {
        this.hideBrowser();
      }
    });

    // Search functionality - local search (cached pages only) — debounced
    const searchInput = this.shadowRoot.getElementById('search-input');
    searchInput.addEventListener('input', (e) => {
      if (this._localFilterDebounceTimer) {
        clearTimeout(this._localFilterDebounceTimer);
      }
      const q = e.target.value;
      this._localFilterDebounceTimer = setTimeout(() => {
        this._localFilterDebounceTimer = null;
        this.handleSearch(q);
      }, 300);
    });
    // Stop keyboard events from bubbling to prevent triggering game hotkeys (like 'f' for fullscreen)
    searchInput.addEventListener('keydown', (e) => e.stopPropagation());

    // Search tabs
    this.shadowRoot.querySelectorAll('.search-tab').forEach((tab) => {
      tab.addEventListener('click', (e) => {
        const mode = e.target.dataset.mode;
        this.setSearchMode(mode);
      });
    });

    // Zenius search button
    this.shadowRoot.getElementById('zenius-search-btn').addEventListener('click', () => {
      if (this._searchDebounceTimer) {
        clearTimeout(this._searchDebounceTimer);
        this._searchDebounceTimer = null;
      }
      this.runZeniusSearch();
    });

    // Zenius search inputs - stop propagation and handle Enter
    const zeniusTitleInput = this.shadowRoot.getElementById('zenius-song-title');
    const zeniusArtistInput = this.shadowRoot.getElementById('zenius-song-artist');

    const debounceZeniusSearch = () => {
      if (this._searchDebounceTimer) {
        clearTimeout(this._searchDebounceTimer);
      }
      this._searchDebounceTimer = setTimeout(() => {
        this._searchDebounceTimer = null;
        const t = this.shadowRoot.getElementById('zenius-song-title').value.trim();
        const a = this.shadowRoot.getElementById('zenius-song-artist').value.trim();
        if (!t && !a) {
          return;
        }
        this.runZeniusSearch();
      }, 450);
    };

    zeniusTitleInput.addEventListener('input', () => debounceZeniusSearch());
    zeniusArtistInput.addEventListener('input', () => debounceZeniusSearch());

    zeniusTitleInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        if (this._searchDebounceTimer) {
          clearTimeout(this._searchDebounceTimer);
          this._searchDebounceTimer = null;
        }
        this.runZeniusSearch();
      }
    });
    zeniusArtistInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        if (this._searchDebounceTimer) {
          clearTimeout(this._searchDebounceTimer);
          this._searchDebounceTimer = null;
        }
        this.runZeniusSearch();
      }
    });

    this.shadowRoot.getElementById('zenius-sort-select').addEventListener('change', () => {
      this.reapplyCurrentListSort();
    });

    this.shadowRoot.getElementById('zenius-saved-btn').addEventListener('click', () => {
      this.displayFavoritesList();
    });

    const modal = this.shadowRoot.getElementById('zenius-browser-modal');
    modal.addEventListener('keydown', this._onModalKeydownBound);

    this.shadowRoot
      .getElementById('content-grid')
      .addEventListener('keydown', this._onGridKeydownBound);

    // Breadcrumb navigation
    this.shadowRoot.getElementById('breadcrumb').addEventListener('click', (e) => {
      if (e.target.classList.contains('breadcrumb-item')) {
        const path = e.target.dataset.path || '';
        this.navigateToPath(path);
      }
    });
  }

  showBrowser() {
    this._previouslyFocused = /** @type {HTMLElement|null} */ (document.activeElement);
    this.classList.add('modal-open');
    this.shadowRoot.getElementById('zenius-browser-modal').classList.add('show');
    this.renderRecentChips();

    // If we have a remembered category and we're at home, load it but keep Search tab active
    if (this.lastBrowsedCategoryId && this.currentPath === '') {
      this.currentCategoryName = this.lastBrowsedCategoryName || 'Category';
      void this.navigateToPath(`categoryid=${this.lastBrowsedCategoryId}`, false);
    }
    this.setSearchMode('zenius');
    if (this._lastSpotlightSourceLinks && this._lastSpotlightSourceLinks.length > 0) {
      void this.startSimfileSpotlight(this._lastSpotlightSourceLinks);
    }

    requestAnimationFrame(() => {
      this.moveFocusIntoModal();
    });
  }

  hideBrowser() {
    if (this._spotlightAbort) {
      this._spotlightAbort.abort();
      this._spotlightAbort = null;
    }
    if (this._searchAbortController) {
      this._searchAbortController.abort();
      this._searchAbortController = null;
    }
    this.classList.remove('modal-open');
    this.shadowRoot.getElementById('zenius-browser-modal').classList.remove('show');
    this.hideLoading();
    if (this._previouslyFocused && typeof this._previouslyFocused.focus === 'function') {
      this._previouslyFocused.focus();
    }
    this._previouslyFocused = null;
  }

  async loadInitialContent() {
    // Load home content without switching tabs (keep Search as default)
    await this.navigateToPath('', false);
  }

  async navigateToPath(path, switchToCategory = true) {
    this._favoritesViewActive = false;
    this.currentPath = path;
    // When navigating to categories/home, ensure Category tab is active to show breadcrumbs
    if (switchToCategory) {
      this.setSearchMode('local');
    }
    this.updateBreadcrumbs();
    this.updateStats();
    await this.loadContent(path);
  }

  updateBreadcrumbs() {
    const breadcrumbEl = this.shadowRoot.getElementById('breadcrumb');

    let html = '<span class="breadcrumb-item" data-path="">🏠 Home</span>';

    if (this.currentPath.startsWith('categoryid=')) {
      html += `<span class="breadcrumb-separator">/</span><span class="breadcrumb-item" data-path="${
        this.currentPath
      }">${this.currentCategoryName || 'Category'}</span>`;
    }

    breadcrumbEl.innerHTML = html;
  }

  updateStats() {
    const itemCountEl = this.shadowRoot.getElementById('item-count');
    const currentPathEl = this.shadowRoot.getElementById('current-path');

    const currentContent = this.cache.get(this.getCurrentUrl());
    const count = currentContent ? currentContent.items.length : 0;

    itemCountEl.textContent = `${count} items`;

    // Show link to Zenius page when viewing a category
    if (this.currentPath.startsWith('categoryid=')) {
      const zeniusUrl = this.getCurrentUrl();
      const linkText = this.currentCategoryName || 'View on Zenius';
      // Create link element safely to avoid XSS from scraped category names
      const link = document.createElement('a');
      link.href = zeniusUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.className = 'zenius-link';
      link.title = 'Open on Zenius-I-Vanisher';
      link.textContent = `🔗 ${linkText}`;
      currentPathEl.innerHTML = '';
      currentPathEl.appendChild(link);
    } else {
      currentPathEl.textContent = this.currentPath || 'Home';
    }
  }

  getCurrentUrl() {
    if (this.currentPath === '') {
      return 'https://zenius-i-vanisher.com/v5.2/simfiles.php?category=simfiles';
    } else if (this.currentPath.startsWith('categoryid=')) {
      const categoryId = this.currentPath.replace('categoryid=', '');
      return `https://zenius-i-vanisher.com/v5.2/viewsimfilecategory.php?categoryid=${categoryId}`;
    } else {
      return `https://zenius-i-vanisher.com/v5.2/simfiles.php?category=${encodeURIComponent(
        this.currentPath
      )}`;
    }
  }

  async loadContent(path) {
    this.showLoading('Loading content...');

    try {
      let url;
      if (path === '') {
        url = 'https://zenius-i-vanisher.com/v5.2/simfiles.php?category=simfiles';
      } else if (path.startsWith('categoryid=')) {
        const categoryId = path.replace('categoryid=', '');
        url = `https://zenius-i-vanisher.com/v5.2/viewsimfilecategory.php?categoryid=${categoryId}`;
      } else {
        url = `https://zenius-i-vanisher.com/v5.2/simfiles.php?category=${encodeURIComponent(
          path
        )}`;
      }

      const content = await this.fetchZeniusContent(url);
      this.displayContent(content, path);
    } catch (error) {
      console.error('Error loading content:', error);
      this.showError(`Failed to load content: ${error.message}`, () => {
        this.loadContent(path);
      });
    } finally {
      this.hideLoading();
    }
  }

  async fetchZeniusContent(url) {
    if (this.cache.has(url)) {
      return this.cache.get(url);
    }

    try {
      // Use the global proxy service
      const html = await window.proxyService.fetchWithProxy(url, { skipDirect: true });
      const content = this.parseZeniusContent(html);
      this.cache.set(url, content);
      return content;
    } catch (error) {
      console.error('Error fetching Zenius content:', error);
      throw error;
    }
  }

  /**
   * @param {Document} doc
   * @param {{ type: string, items: Array<Record<string, unknown>> }} content
   */
  appendSimfileTableItemsToContent(doc, content) {
    const simfileLinks = doc.querySelectorAll('a[href*="viewsimfile.php"]');
    if (simfileLinks.length === 0) {
      return;
    }
    content.type = 'simfiles';

    const difficultyNames = ['Beginner', 'Basic', 'Difficult', 'Expert', 'Challenge'];
    const difficultyShort = ['B', 'L', 'S', 'H', 'C'];

    simfileLinks.forEach((link) => {
      const href = link.getAttribute('href');
      const text = link.textContent.trim();
      if (href && text && !text.includes('Download') && !text.includes('MB')) {
        const urlParams = new URLSearchParams(href.split('?')[1] || '');
        const simfileId = urlParams.get('simfileid');

        if (simfileId) {
          const row = link.closest('tr');
          let hasVideo = false;
          let difficulties = [];

          if (row) {
            const rowHtml = row.innerHTML;
            hasVideo =
              rowHtml.includes('Vid Exist') ||
              rowHtml.includes('[V]') ||
              rowHtml.toLowerCase().includes('.avi');

            const cells = row.querySelectorAll('td');
            let diffIndex = 0;

            cells.forEach((cell) => {
              const cellText = cell.textContent.trim();
              const numMatch = cellText.match(/^(\d{1,2})$/);
              if (numMatch) {
                const rating = parseInt(numMatch[1]);
                if (rating >= 1 && rating <= 20) {
                  let diffName = difficultyNames[diffIndex % 5] || 'Unknown';
                  let diffShort = difficultyShort[diffIndex % 5] || '?';

                  const title = cell.getAttribute('title') || '';
                  for (let i = 0; i < difficultyNames.length; i++) {
                    if (title.toLowerCase().includes(difficultyNames[i].toLowerCase())) {
                      diffName = difficultyNames[i];
                      diffShort = difficultyShort[i];
                      break;
                    }
                  }

                  const img = cell.querySelector('img');
                  if (img) {
                    const src = img.getAttribute('src') || '';
                    if (src.includes('beginner')) {
                      diffName = 'Beginner';
                      diffShort = 'B';
                    } else if (src.includes('light') || src.includes('basic')) {
                      diffName = 'Basic';
                      diffShort = 'L';
                    } else if (src.includes('standard') || src.includes('difficult')) {
                      diffName = 'Difficult';
                      diffShort = 'S';
                    } else if (src.includes('heavy') || src.includes('expert')) {
                      diffName = 'Expert';
                      diffShort = 'H';
                    } else if (src.includes('challenge') || src.includes('oni')) {
                      diffName = 'Challenge';
                      diffShort = 'C';
                    }
                  }

                  difficulties.push({
                    rating: rating,
                    name: diffName,
                    short: diffShort
                  });
                  diffIndex++;
                }
              }
            });
          }

          content.items.push({
            type: 'simfile',
            name: text,
            url: href,
            icon: hasVideo ? '🎬' : '🎵',
            simfileId: simfileId,
            hasVideo: hasVideo,
            difficulties: difficulties
          });
        }
      }
    });
  }

  parseZeniusContent(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    const content = {
      type: 'unknown',
      items: [],
      /** @type {Array<{ label: string, href: string }>|undefined} */
      menuLinks: undefined,
      /** @type {Array<{ label: string, href: string }>|undefined} */
      spotlightSourceLinks: undefined
    };

    if (this.currentPath === '') {
      content.menuLinks = extractSimfilesMenuLinks(doc);
      const merged = mergeMenuAndCategoryLinkLabels(
        content.menuLinks,
        extractSimfilesCategoryLinksFromPage(doc)
      );
      content.spotlightSourceLinks = selectSpotlightSourceLinks(merged);
      const options = doc.querySelectorAll('option');
      options.forEach((option) => {
        const value = option.getAttribute('value');
        const text = option.textContent.trim();

        if (
          value &&
          text &&
          text.length > 0 &&
          value !== 'simfiles' &&
          text !== 'Select Simfile Category'
        ) {
          content.items.push({
            type: 'directory',
            name: text,
            url: `viewsimfilecategory.php?categoryid=${value}`,
            icon: '📁',
            categoryId: value
          });
        }
      });

      if (content.items.length > 0) {
        content.type = 'directories';
      }
    } else {
      this.appendSimfileTableItemsToContent(doc, content);
    }

    return content;
  }

  /**
   * @param {string} listUrl
   * @param {number} limit
   * @param {AbortSignal} [signal]
   * @returns {Promise<Array<Record<string, unknown>>>}
   */
  async fetchTopSimfilesFromListUrl(listUrl, limit, signal) {
    const html = await window.proxyService.fetchWithProxy(listUrl, { skipDirect: true, signal });
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const content = { type: 'unknown', items: [] };
    this.appendSimfileTableItemsToContent(doc, content);
    return content.items.slice(0, limit);
  }

  /**
   * Fetches the four live lists in parallel and renders up to 10 simfiles per section.
   * @param {Array<{ label: string, href: string }>} sourceLinks
   */
  async startSimfileSpotlight(sourceLinks) {
    const wrap = this.shadowRoot.getElementById('zenius-spotlight');
    const sections = this.shadowRoot.getElementById('zenius-spotlight-sections');
    const hint = this.shadowRoot.getElementById('zenius-spotlight-hint');
    if (!wrap || !sections) {
      return;
    }
    this._spotlightAbort?.abort();
    this._spotlightAbort = new AbortController();
    const { signal } = this._spotlightAbort;

    const toLoad = sourceLinks;
    if (!toLoad || toLoad.length === 0) {
      wrap.hidden = true;
      return;
    }

    wrap.hidden = false;
    sections.innerHTML = '';
    if (hint) {
      hint.hidden = false;
      hint.textContent = 'Loading latest & top lists…';
    }
    try {
      const results = await Promise.all(
        toLoad.map(async ({ href, label }) => {
          const items = await this.fetchTopSimfilesFromListUrl(href, SPOTLIGHT_TOP_N, signal);
          return { href, label, items };
        })
      );
      if (signal.aborted) {
        return;
      }
      if (hint) {
        hint.hidden = true;
      }
      for (const { href, label, items } of results) {
        const sec = document.createElement('section');
        sec.className = 'zenius-spotlight-section';
        const h = document.createElement('h3');
        h.className = 'zenius-spotlight-title';
        const link = document.createElement('a');
        link.href = href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.className = 'zenius-spotlight-title-link';
        link.textContent = label;
        h.appendChild(link);
        sec.appendChild(h);
        if (items.length === 0) {
          const p = document.createElement('p');
          p.className = 'zenius-spotlight-empty';
          p.textContent = 'No rows parsed for this list.';
          sec.appendChild(p);
        } else {
          const grid = document.createElement('div');
          grid.className = 'zenius-spotlight-grid';
          for (const item of items) {
            if (item && item.type === 'simfile') {
              grid.appendChild(
                this.createContentItem(/** @type {Record<string, unknown>} */ (item), 'spotlight')
              );
            }
          }
          sec.appendChild(grid);
        }
        sections.appendChild(sec);
        if (typeof window.trackEvent === 'function') {
          window.trackEvent('zenius_spotlight_list', 'StepMania', label);
        }
      }
    } catch (e) {
      if (e && /** @type {Error} */ (e).name === 'AbortError') {
        return;
      }
      console.error('Simfile spotlight load failed', e);
      if (hint) {
        hint.hidden = false;
        hint.textContent = 'Some Zenius lists could not load. Try again later.';
      }
    }
  }

  displayContent(content, path) {
    if (
      path === '' &&
      content &&
      content.spotlightSourceLinks &&
      content.spotlightSourceLinks.length > 0
    ) {
      this._lastSpotlightSourceLinks = content.spotlightSourceLinks;
      void this.startSimfileSpotlight(this._lastSpotlightSourceLinks);
    } else if (path === '') {
      const s = this.shadowRoot.getElementById('zenius-spotlight');
      if (s) {
        s.hidden = true;
      }
    }

    const gridEl = this.shadowRoot.getElementById('content-grid');
    gridEl.innerHTML = '';

    // Defensive check for missing or empty content
    const items = content?.items || [];
    if (items.length === 0) {
      this.shadowRoot.getElementById('list-toolbar').classList.add('hidden');
      gridEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📂</div>
          <h3>No content found</h3>
          <p>This directory appears to be empty or the content couldn't be parsed.</p>
        </div>
      `;
      this.updateStats();
      return;
    }

    const onlySimfiles = items.every((i) => i.type === 'simfile');
    const onlyDirs = items.every((i) => i.type === 'directory');
    if (onlySimfiles) {
      this._lastSimfileListForSort = items.map((i) => ({ ...i }));
      this._lastListPath = path;
      this.shadowRoot.getElementById('list-toolbar').classList.remove('hidden');
      const sorted = this.applySortToSimfiles(this._lastSimfileListForSort);
      sorted.forEach((item) => {
        gridEl.appendChild(this.createContentItem(item, path));
      });
    } else {
      this._lastSimfileListForSort = [];
      this._lastListPath = path;
      this.shadowRoot.getElementById('list-toolbar').classList.add('hidden');
      const sortedItems = [...items].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      );
      sortedItems.forEach((item) => {
        gridEl.appendChild(this.createContentItem(item, path));
      });
    }

    if (!onlyDirs) {
      this.initGridRovingTabIndex();
    }
    this.updateStats();
  }

  createContentItem(item, currentPath) {
    if (item.type === 'simfile') {
      const fullZeniusUrl = item.url.startsWith('http')
        ? item.url
        : `https://zenius-i-vanisher.com/v5.2/${item.url}`;
      const qs = new URLSearchParams();
      qs.set('zenius', fullZeniusUrl);
      const gameUrl = `${window.location.origin}${window.location.pathname}?${qs.toString()}`;

      const card = document.createElement('div');
      card.className = 'content-item simfile-card';

      // Check cached metadata for this simfile (set when song was loaded)
      const cachedMeta = ZeniusBrowserElement.getSimfileMetadata(item.simfileId);

      // Use cached data if available, otherwise use what we parsed from the category page
      const hasVideo = cachedMeta?.hasVideo || item.hasVideo;
      const difficulties =
        cachedMeta?.difficulties && cachedMeta.difficulties.length > 0
          ? cachedMeta.difficulties
          : item.difficulties;
      const icon = hasVideo ? '🎬' : '🎵';

      // Build badges for video and difficulties
      let badges = '';
      if (hasVideo) {
        badges += '<span class="badge badge-video" title="Has Video">🎬 Video</span>';
      }
      if (difficulties && difficulties.length > 0) {
        const diffBadges = difficulties
          .map((d) => {
            const shortCode = d.short ? d.short.toLowerCase() : 'u';
            const tooltip = d.name ? `${d.name} (${d.rating})` : `Level ${d.rating}`;
            return `<span class="badge badge-diff badge-diff-${shortCode}" title="${tooltip}">${d.rating}</span>`;
          })
          .join('');
        badges += diffBadges;
      }

      // Build subtitle with artist and category (for search results)
      let subtitle = '';
      if (item.artist || item.category) {
        const parts = [];
        if (item.artist) parts.push(`🎤 ${item.artist}`);
        if (item.category) parts.push(`📁 ${item.category}`);
        subtitle = `<p class="simfile-subtitle">${parts.join(' • ')}</p>`;
      }

      const mainLink = document.createElement('a');
      mainLink.href = gameUrl;
      mainLink.className = 'content-item-body';
      mainLink.innerHTML = `
        <div class="content-icon">${icon}</div>
        <div class="content-info">
          <h3>${item.name}</h3>
          ${subtitle}
          <div class="simfile-badges">${badges}</div>
        </div>
      `;

      const showZeniusLink = currentPath !== 'spotlight';
      let ext = null;
      if (showZeniusLink) {
        const extEl = document.createElement('a');
        extEl.href = fullZeniusUrl;
        extEl.target = '_blank';
        extEl.rel = 'noopener noreferrer';
        extEl.className = 'simfile-external-link';
        extEl.title = 'View on Zenius-I-Vanisher';
        extEl.textContent = '🔗';
        extEl.addEventListener('click', (e) => e.stopPropagation());
        ext = extEl;
      }

      mainLink.addEventListener('click', () => {
        if (typeof window.trackEvent === 'function') {
          window.trackEvent('song_browser_song_select', 'StepMania', item.name);
        }
        if (this.currentPath.startsWith('categoryid=')) {
          this.lastBrowsedCategoryId = this.currentPath.replace('categoryid=', '');
          this.lastBrowsedCategoryName = this.currentCategoryName;
        } else if (item.categoryId) {
          this.lastBrowsedCategoryId = item.categoryId;
          this.lastBrowsedCategoryName = item.category || 'Category';
        }
      });

      const favorited = isFavoriteSimfileId(item.simfileId);
      const favBtn = document.createElement('button');
      favBtn.type = 'button';
      favBtn.className = 'fav-btn';
      favBtn.setAttribute('aria-label', favorited ? 'Remove from saved' : 'Save song');
      favBtn.setAttribute('aria-pressed', favorited ? 'true' : 'false');
      favBtn.textContent = favorited ? '★' : '☆';
      favBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const nowOn = toggleFavorite({
          simfileId: item.simfileId,
          zeniusUrl: fullZeniusUrl,
          title: item.name
        });
        favBtn.setAttribute('aria-pressed', nowOn ? 'true' : 'false');
        favBtn.setAttribute('aria-label', nowOn ? 'Remove from saved' : 'Save song');
        favBtn.textContent = nowOn ? '★' : '☆';
        this.updateSavedButtonLabel();
      });
      card.appendChild(mainLink);
      if (ext) {
        card.appendChild(ext);
      }
      card.appendChild(favBtn);

      return card;
    } else {
      const itemEl = document.createElement('div');
      itemEl.className = 'content-item';

      itemEl.innerHTML = `
        <div class="content-icon">${item.icon}</div>
        <div class="content-info">
          <h3>${item.name}</h3>
          <p>Collection</p>
        </div>
      `;

      itemEl.addEventListener('click', () => {
        if (item.type === 'directory') {
          if (typeof window.trackEvent === 'function') {
            window.trackEvent('song_browser_category_click', 'StepMania', item.name);
          }

          itemEl.classList.add('loading');
          itemEl.innerHTML = `
            <div class="content-icon">⏳</div>
            <div class="content-info">
              <h3>${item.name}</h3>
              <p>Loading...</p>
            </div>
          `;

          if (item.categoryId) {
            this.currentCategoryName = item.name;
            this.navigateToPath(`categoryid=${item.categoryId}`);
          }
        }
      });

      return itemEl;
    }
  }

  handleSearch(query) {
    if (!query.trim()) {
      this.loadContent(this.currentPath);
      return;
    }

    // When in category or Zenius simfiles menu list, only search within the current list
    const inCategoryView = this.currentPath.startsWith('categoryid=');
    const currentUrl = this.getCurrentUrl();

    const searchResults = [];

    if (inCategoryView) {
      // Only search within current category
      const currentContent = this.cache.get(currentUrl);
      const items = currentContent?.items || [];
      items.forEach((item) => {
        const matchesSearch = item.name.toLowerCase().includes(query.toLowerCase());
        if (item.type === 'simfile' && matchesSearch) {
          searchResults.push({ ...item, sourceUrl: currentUrl });
        }
      });
    } else {
      // Search all cached content
      this.cache.forEach((content, url) => {
        const items = content?.items || [];
        items.forEach((item) => {
          if (item.name.toLowerCase().includes(query.toLowerCase())) {
            searchResults.push({ ...item, sourceUrl: url });
          }
        });
      });
    }

    this.displaySearchResults(searchResults, this.currentPath);
  }

  /**
   * @param {boolean} visible
   */
  setZeniusSpotlightUiVisible(visible) {
    const el = this.shadowRoot.getElementById('zenius-spotlight');
    if (el) {
      el.hidden = !visible;
    }
  }

  setSearchMode(mode) {
    const localTab = this.shadowRoot.getElementById('local-search-tab');
    const zeniusTab = this.shadowRoot.getElementById('zenius-search-tab');
    const localFields = this.shadowRoot.getElementById('local-search-fields');
    const zeniusFields = this.shadowRoot.getElementById('zenius-search-fields');

    if (mode === 'zenius') {
      localTab.classList.remove('active');
      zeniusTab.classList.add('active');
      localFields.classList.add('hidden');
      zeniusFields.classList.remove('hidden');
    } else {
      zeniusTab.classList.remove('active');
      localTab.classList.add('active');
      zeniusFields.classList.add('hidden');
      localFields.classList.remove('hidden');
    }

    if (mode === 'local' && this._favoritesViewActive) {
      this._favoritesViewActive = false;
      void this.loadContent(this.currentPath);
    }
  }

  async runZeniusSearch() {
    const songTitle = this.shadowRoot.getElementById('zenius-song-title').value.trim();
    const songArtist = this.shadowRoot.getElementById('zenius-song-artist').value.trim();

    if (!songTitle && !songArtist) {
      this.showError('Please enter a song title or artist to search.');
      return;
    }

    if (this._searchAbortController) {
      this._searchAbortController.abort();
    }
    this._searchAbortController = new AbortController();
    const { signal } = this._searchAbortController;

    this._searchReqId += 1;
    const reqId = this._searchReqId;
    this._favoritesViewActive = false;
    this.setZeniusSpotlightUiVisible(false);
    this.showLoading('Searching…');

    try {
      const params = new URLSearchParams();
      params.set('songtitle', songTitle);
      params.set('songartist', songArtist);
      const url = `https://zenius-i-vanisher.com/v5.2/simfiles_search_ajax.php?${params.toString()}`;

      const html = await window.proxyService.fetchWithProxy(url, { skipDirect: true, signal });

      if (reqId !== this._searchReqId) {
        return;
      }

      const results = this.parseZeniusSearchResults(html);

      if (results.length === 0) {
        this.showSearchEmpty(
          `No results for “${
            songTitle || songArtist
          }”. Try other spellings or use the Category tab.`
        );
        this.shadowRoot.getElementById('item-count').textContent = '0 results';
        this.shadowRoot.getElementById('current-path').textContent = 'Search (no matches)';
      } else {
        this.displaySearchResults(results);
        this.shadowRoot.getElementById('item-count').textContent = `${results.length} results`;
        this.shadowRoot.getElementById('current-path').textContent = `Search: “${
          songTitle || songArtist
        }”`;
      }

      if (typeof window.trackEvent === 'function') {
        window.trackEvent('zenius_search', 'StepMania', `${songTitle} | ${songArtist}`);
      }
    } catch (error) {
      if (error && error.name === 'AbortError') {
        return;
      }
      console.error('Zenius search failed:', error);
      this.setZeniusSpotlightUiVisible(false);
      this.showError(
        `Search failed: ${
          error.message || 'Network error'
        }. The Zenius search may be unavailable through proxies. Try again shortly.`,
        () => {
          this.runZeniusSearch();
        }
      );
    } finally {
      if (reqId === this._searchReqId) {
        this.hideLoading();
      }
    }
  }

  parseZeniusSearchResults(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const results = [];

    // Zenius AJAX search results are in tables
    // Columns: Name (0), SP difficulties (1), DP difficulties (2), Category (3)
    // The link title attribute contains "Song Name / Artist"
    const simfileLinks = doc.querySelectorAll('a[href*="viewsimfile.php"]');

    simfileLinks.forEach((link) => {
      const href = link.getAttribute('href');
      const text = link.textContent.trim();
      const title = link.getAttribute('title') || '';

      // Skip download links and file size text
      if (href && text && !text.includes('Download') && !text.includes('MB') && text.length > 0) {
        const urlParams = new URLSearchParams(href.split('?')[1] || '');
        const simfileId = urlParams.get('simfileid');

        if (simfileId) {
          // Extract artist from title attribute (format: "Song Name / Artist")
          let artist = '';
          if (title && title.includes(' / ')) {
            const parts = title.split(' / ');
            if (parts.length >= 2) {
              artist = parts.slice(1).join(' / '); // Handle artists with " / " in name
            }
          }

          // Get data from the parent row
          const row = link.closest('tr');
          let category = '';
          let spDifficulties = '';
          let dpDifficulties = '';

          let categoryId = '';

          if (row) {
            const cells = row.querySelectorAll('td');
            // Columns: Name (0), SP (1), DP (2), Category (3)
            if (cells.length >= 2) {
              spDifficulties = cells[1]?.textContent?.trim() || '';
            }
            if (cells.length >= 3) {
              dpDifficulties = cells[2]?.textContent?.trim() || '';
            }
            if (cells.length >= 4) {
              const categoryLink = cells[3]?.querySelector('a[href*="viewsimfilecategory"]');
              if (categoryLink) {
                category = categoryLink.textContent.trim();
                // Extract category ID from the href
                const categoryHref = categoryLink.getAttribute('href') || '';
                const categoryParams = new URLSearchParams(categoryHref.split('?')[1] || '');
                categoryId = categoryParams.get('categoryid') || '';
              }
            }
          }

          results.push({
            type: 'simfile',
            name: text,
            artist: artist,
            category: category,
            categoryId: categoryId,
            spDifficulties: spDifficulties,
            dpDifficulties: dpDifficulties,
            url: href,
            icon: '🎵',
            simfileId: simfileId,
            hasVideo: false,
            difficulties: []
          });
        }
      }
    });

    return results;
  }

  /**
   * @param {unknown[]} results
   * @param {string} [itemPath] - `currentPath` when filtering a category, else `''` for site search
   */
  displaySearchResults(results, itemPath = '') {
    this._favoritesViewActive = false;
    this._lastSimfileListForSort = results.map((r) => ({ ...r }));
    this._lastListPath = itemPath && itemPath.length > 0 ? itemPath : 'search';
    const gridEl = this.shadowRoot.getElementById('content-grid');
    gridEl.innerHTML = '';

    if (results.length === 0) {
      this.setZeniusSpotlightUiVisible(false);
      this.shadowRoot.getElementById('list-toolbar').classList.add('hidden');
      gridEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🔍</div>
          <h3>No results found</h3>
          <p>Try adjusting your search terms.</p>
        </div>
      `;
      this.initGridRovingTabIndex();
      requestAnimationFrame(() => {
        gridEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      });
      return;
    }

    this.shadowRoot.getElementById('list-toolbar').classList.remove('hidden');
    const sortedResults = this.applySortToSimfiles(this._lastSimfileListForSort);
    sortedResults.forEach((item) => {
      const itemEl = this.createContentItem(item, itemPath);
      gridEl.appendChild(itemEl);
    });
    this.initGridRovingTabIndex();
    this.setZeniusSpotlightUiVisible(false);
    requestAnimationFrame(() => {
      gridEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }

  showLoading(text) {
    const loadingEl = this.shadowRoot.getElementById('loading-indicator');
    const textEl = this.shadowRoot.getElementById('loading-text');
    const progressBar = this.shadowRoot.getElementById('loading-progress-bar');

    textEl.textContent = text;
    loadingEl.classList.add('show');
    progressBar.style.width = '0%';
  }

  hideLoading() {
    this.shadowRoot.getElementById('loading-indicator').classList.remove('show');
  }

  showError(message, retryCallback = null) {
    const gridEl = this.shadowRoot.getElementById('content-grid');

    let errorHtml = `
      <div class="error-message">
        <strong>Error:</strong> ${message}
    `;

    if (retryCallback) {
      errorHtml += `
        <div style="margin-top: 1rem;">
          <button class="retry-btn" id="retry-btn">
            🔄 Retry
          </button>
        </div>
      `;
    }

    errorHtml += `</div>`;

    gridEl.innerHTML = errorHtml;

    if (retryCallback) {
      const retryBtn = gridEl.querySelector('#retry-btn');
      if (retryBtn) {
        retryBtn.addEventListener('click', retryCallback);
      }
    }
  }

  showSearchEmpty(message) {
    this.setZeniusSpotlightUiVisible(false);
    this._lastSimfileListForSort = [];
    this.shadowRoot.getElementById('list-toolbar').classList.add('hidden');
    const gridEl = this.shadowRoot.getElementById('content-grid');
    gridEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🔍</div>
        <h3>No results</h3>
        <p class="search-empty-msg"></p>
      </div>
    `;
    const p = gridEl.querySelector('.search-empty-msg');
    if (p) p.textContent = message;
    this.initGridRovingTabIndex();
    requestAnimationFrame(() => {
      gridEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }

  displayFavoritesList() {
    this._favoritesViewActive = true;
    this.setZeniusSpotlightUiVisible(false);
    this.setSearchMode('zenius');
    const favs = getFavorites();
    this._lastSimfileListForSort = favs.map((f) => ({
      type: 'simfile',
      name: f.title,
      url: f.zeniusUrl,
      icon: '🎵',
      simfileId: f.simfileId,
      hasVideo: false,
      difficulties: []
    }));
    this._lastListPath = 'favorites';
    this.shadowRoot.getElementById('item-count').textContent = `${favs.length} items`;
    this.shadowRoot.getElementById('current-path').textContent = 'Saved';
    this.shadowRoot.getElementById('content-grid').innerHTML = '';
    this.shadowRoot.getElementById('breadcrumb').innerHTML =
      '<span class="breadcrumb-item" data-path="">🏠 Home</span>';

    if (favs.length === 0) {
      this.shadowRoot.getElementById('list-toolbar').classList.add('hidden');
      this.shadowRoot.getElementById('content-grid').innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">⭐</div>
          <h3>No saved songs</h3>
          <p>Click the star on a song to add it to Saved. It stays on this device only.</p>
        </div>
      `;
      this.initGridRovingTabIndex();
      return;
    }

    this.shadowRoot.getElementById('list-toolbar').classList.remove('hidden');
    const gridEl = this.shadowRoot.getElementById('content-grid');
    this.applySortToSimfiles(this._lastSimfileListForSort).forEach((item) => {
      gridEl.appendChild(this.createContentItem(item, ''));
    });
    this.initGridRovingTabIndex();
  }

  reapplyCurrentListSort() {
    if (!this._lastSimfileListForSort.length) {
      return;
    }
    let itemPath = this._lastListPath;
    if (this._favoritesViewActive) {
      itemPath = '';
    } else if (this._lastListPath === 'search' || this._lastListPath === 'favorites') {
      itemPath = '';
    }
    const gridEl = this.shadowRoot.getElementById('content-grid');
    const sorted = this.applySortToSimfiles(this._lastSimfileListForSort.map((i) => ({ ...i })));
    gridEl.innerHTML = '';
    sorted.forEach((item) => {
      gridEl.appendChild(this.createContentItem(item, itemPath));
    });
    this.initGridRovingTabIndex();
  }

  getSortMode() {
    const el = this.shadowRoot.getElementById('zenius-sort-select');
    return el ? el.value : 'name-asc';
  }

  /**
   * @param {Array<Record<string, unknown> & { name: string }>} items
   */
  applySortToSimfiles(items) {
    const mode = this.getSortMode();
    const out = items.map((i) => ({ ...i }));
    if (mode === 'name-asc') {
      out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    } else if (mode === 'name-desc') {
      out.sort((a, b) => b.name.localeCompare(a.name, undefined, { sensitivity: 'base' }));
    } else if (mode === 'video-first') {
      out.sort((a, b) => {
        const va = this.simfileHasVideoFromItem(a) ? 1 : 0;
        const vb = this.simfileHasVideoFromItem(b) ? 1 : 0;
        if (vb !== va) return vb - va;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      });
    }
    return out;
  }

  /**
   * @param {Record<string, unknown>} item
   */
  simfileHasVideoFromItem(item) {
    const id = /** @type {string|undefined} */ (item.simfileId);
    if (id) {
      const meta = ZeniusBrowserElement.getSimfileMetadata(id);
      if (meta && meta.hasVideo) return true;
    }
    return !!item.hasVideo;
  }

  initGridRovingTabIndex() {
    const grid = this.shadowRoot.getElementById('content-grid');
    const items = /** @type {HTMLElement[]} */ (Array.from(grid.querySelectorAll('.content-item')));
    items.forEach((el, i) => {
      el.setAttribute('tabindex', i === 0 ? '0' : '-1');
    });
  }

  /**
   * @param {KeyboardEvent} e
   */
  handleGridKeydown(e) {
    const t = e.target;
    if (!(t instanceof HTMLElement) || !t.classList.contains('content-item')) {
      return;
    }
    const navKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter'];
    if (!navKeys.includes(e.key)) {
      return;
    }
    const grid = this.shadowRoot.getElementById('content-grid');
    const items = /** @type {HTMLElement[]} */ (Array.from(grid.querySelectorAll('.content-item')));
    if (items.length === 0) {
      return;
    }
    const i = items.indexOf(t);
    if (i < 0) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Enter') {
      const play = t.querySelector('a.content-item-body');
      if (play) {
        play.click();
      } else {
        t.click();
      }
      return;
    }
    let next = i;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      next = Math.min(i + 1, items.length - 1);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      next = Math.max(i - 1, 0);
    } else if (e.key === 'Home') {
      next = 0;
    } else if (e.key === 'End') {
      next = items.length - 1;
    }
    items.forEach((el, j) => el.setAttribute('tabindex', j === next ? '0' : '-1'));
    items[next].focus();
  }

  /**
   * @param {KeyboardEvent} e
   */
  handleModalKeydown(e) {
    const modal = this.shadowRoot.getElementById('zenius-browser-modal');
    if (!modal.classList.contains('show')) {
      return;
    }
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      this.hideBrowser();
      return;
    }
    if (e.key !== 'Tab') {
      return;
    }
    const focusables = this.getModalFocusableElements();
    if (focusables.length === 0) {
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = this.shadowRoot.activeElement;
    if (e.shiftKey) {
      if (active === first) {
        e.preventDefault();
        last.focus();
      }
    } else if (active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  getModalFocusableElements() {
    const modal = this.shadowRoot.getElementById('zenius-browser-modal');
    const sel =
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    return Array.from(modal.querySelectorAll(sel)).filter(
      (el) =>
        el instanceof HTMLElement &&
        el.offsetWidth > 0 &&
        el.offsetHeight > 0 &&
        getComputedStyle(el).visibility !== 'hidden'
    );
  }

  moveFocusIntoModal() {
    const t = this.shadowRoot.getElementById('close-zenius-browser');
    if (t) {
      t.focus();
    }
  }

  renderRecentChips() {
    const wrap = this.shadowRoot.getElementById('zenius-recent-chips');
    const block = this.shadowRoot.getElementById('zenius-recent-block');
    if (!wrap || !block) {
      return;
    }
    const recent = getRecentSongs();
    wrap.innerHTML = '';
    if (recent.length === 0) {
      block.classList.add('empty');
    } else {
      block.classList.remove('empty');
      for (const r of recent) {
        const a = document.createElement('a');
        a.className = 'zenius-recent-chip';
        const qs = new URLSearchParams();
        qs.set('zenius', r.zeniusUrl);
        a.href = `${window.location.origin}${window.location.pathname}?${qs.toString()}`;
        a.textContent = r.title;
        a.setAttribute('role', 'listitem');
        a.title = r.title;
        a.addEventListener('click', (ev) => {
          ev.stopPropagation();
        });
        wrap.appendChild(a);
      }
    }
    this.updateSavedButtonLabel();
  }

  updateSavedButtonLabel() {
    const n = getFavorites().length;
    const btn = this.shadowRoot.getElementById('zenius-saved-btn');
    if (btn) {
      btn.textContent = n > 0 ? `Saved (${n})` : 'Saved';
    }
  }
}

// Register the web component
customElements.define('zenius-browser', ZeniusBrowserElement);

// Create proxy for singleton access
export const ZeniusBrowser = createComponentProxy(ZeniusBrowserElement);

export default ZeniusBrowser;

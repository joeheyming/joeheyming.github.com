// Zenius Browser Web Component - ES Module
import { adoptSharedStyles } from './sharedStyles.js';
import { createComponentProxy } from './componentProxy.js';
import { parseZeniusHtmlContent, parseZeniusSearchResults } from './zeniusParsers.js';
import {
  ZENIUS_BROWSER_SHADOW_HTML,
  createZeniusContentCard,
  displayZeniusGridContent,
  runZeniusSpotlight,
  displayZeniusSearchResultsGrid,
  showZeniusLoadingOverlay,
  hideZeniusLoadingOverlay,
  showZeniusGridError,
  showZeniusSearchEmptyState,
  displayZeniusFavoritesGrid,
  renderZeniusRecentChips,
  updateZeniusSavedButtonLabel,
  updateZeniusBrowserLayout
} from './zeniusRender.js';

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
    /** @type {'zenius'|'local'} */
    this._searchMode = 'zenius';
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
    this.init();
    adoptSharedStyles(this.shadowRoot);
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
      // Changing the host to a fixed full-screen element also hides this
      // button. Do that after click dispatch so the browser can finish the
      // button's activation/focus work against a stable event target.
      setTimeout(() => {
        void this.showBrowser();
      }, 0);
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
      if (typeof window.trackEvent === 'function') {
        window.trackEvent('zenius_saved_click', 'StepMania', 'Saved');
      }
      this.displayFavoritesList();
    });

    this.shadowRoot
      .getElementById('zenius-browse-categories-btn')
      ?.addEventListener('click', () => {
        if (typeof window.trackEvent === 'function') {
          const content = this.cache.get(this.getCurrentUrl());
          const count = content?.items?.length ?? 0;
          window.trackEvent(
            'zenius_browse_categories_click',
            'StepMania',
            'Browse all collections',
            count > 0 ? count : undefined
          );
        }
        this.setSearchMode('local');
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
    updateZeniusBrowserLayout(this);

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
      const content = parseZeniusHtmlContent(html, this.currentPath);
      this.cache.set(url, content);
      return content;
    } catch (error) {
      console.error('Error fetching Zenius content:', error);
      throw error;
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

    this._searchMode = mode === 'local' ? 'local' : 'zenius';

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
    } else if (
      this.currentPath === '' &&
      !this._favoritesViewActive &&
      this._lastListPath !== 'search'
    ) {
      const content = this.cache.get(this.getCurrentUrl());
      if (content) {
        this.displayContent(content, this.currentPath);
      }
    }

    updateZeniusBrowserLayout(this);
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

      const results = parseZeniusSearchResults(html);

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
        // GA4-standard `view_search_results` fires in parallel with our
        // custom event so GA4's built-in site-search reports pick it up.
        // Label = search term (clipped to ~40 chars to fit GA's label cap),
        // value = number of results returned.
        const term = `${songTitle} ${songArtist}`.trim().slice(0, 40);
        window.trackEvent('view_search_results', 'zenius_browser', term, results.length);
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

  render() {
    this.shadowRoot.innerHTML = ZENIUS_BROWSER_SHADOW_HTML;
  }

  async startSimfileSpotlight(sourceLinks) {
    await runZeniusSpotlight(this, sourceLinks);
  }

  displayContent(content, path) {
    displayZeniusGridContent(this, content, path);
  }

  createContentItem(item, currentPath) {
    return createZeniusContentCard(this, item, currentPath);
  }

  displaySearchResults(results, itemPath = '') {
    displayZeniusSearchResultsGrid(this, results, itemPath);
  }

  showLoading(text) {
    showZeniusLoadingOverlay(this, text);
  }

  hideLoading() {
    hideZeniusLoadingOverlay(this);
  }

  showError(message, retryCallback = null) {
    showZeniusGridError(this, message, retryCallback);
  }

  showSearchEmpty(message) {
    showZeniusSearchEmptyState(this, message);
  }

  displayFavoritesList() {
    displayZeniusFavoritesGrid(this);
  }

  renderRecentChips() {
    renderZeniusRecentChips(this);
  }

  updateSavedButtonLabel() {
    updateZeniusSavedButtonLabel(this);
  }
}

// Register the web component
customElements.define('zenius-browser', ZeniusBrowserElement);

// Create proxy for singleton access
export const ZeniusBrowser = createComponentProxy(ZeniusBrowserElement);

export default ZeniusBrowser;

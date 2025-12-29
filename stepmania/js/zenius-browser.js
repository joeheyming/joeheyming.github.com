// Zenius Browser Web Component - ES Module
import { adoptSharedStyles } from './sharedStyles.js';
import { createComponentProxy } from './componentProxy.js';

class ZeniusBrowserElement extends HTMLElement {
  /** @type {ZeniusBrowserElement|null} */
  static _instance = null;

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

  constructor() {
    super();
    this.currentPath = '';
    this.breadcrumbs = [];
    this.currentCategoryName = '';
    this.cache = new Map();
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
        <button class="zenius-browser-btn" id="open-zenius-browser">Songs</button>
      </div>
      
      <div class="modal" id="zenius-browser-modal">
        <div class="modal-content">
          <div class="modal-header">
            <h2 class="modal-title">Song Library Browser</h2>
            <div class="breadcrumb" id="breadcrumb">
              <span class="breadcrumb-item" data-path="">🏠 Home</span>
            </div>
          </div>
          
          <div class="modal-body">
            <div class="search-container">
              <input 
                type="text" 
                class="search-input" 
                id="search-input" 
                placeholder="Search for simfile collections, users, or categories..."
              >
            </div>
            
            <div class="stats" id="stats">
              <span id="item-count">0 items</span>
              <span id="current-path">Home</span>
            </div>
            
            <div class="content-grid" id="content-grid">
              <!-- Content will be populated here -->
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

    // Search functionality
    this.shadowRoot.getElementById('search-input').addEventListener('input', (e) => {
      this.handleSearch(e.target.value);
    });

    // Breadcrumb navigation
    this.shadowRoot.getElementById('breadcrumb').addEventListener('click', (e) => {
      if (e.target.classList.contains('breadcrumb-item')) {
        const path = e.target.dataset.path || '';
        this.navigateToPath(path);
      }
    });
  }

  showBrowser() {
    this.classList.add('modal-open');
    this.shadowRoot.getElementById('zenius-browser-modal').classList.add('show');
  }

  hideBrowser() {
    this.classList.remove('modal-open');
    this.shadowRoot.getElementById('zenius-browser-modal').classList.remove('show');
  }

  async loadInitialContent() {
    await this.navigateToPath('');
  }

  async navigateToPath(path) {
    this.currentPath = path;
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
    currentPathEl.textContent = this.currentPath || 'Home';
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
      const html = await window.proxyService.fetchWithProxy(url);
      const content = this.parseZeniusContent(html);
      this.cache.set(url, content);
      return content;
    } catch (error) {
      console.error('Error fetching Zenius content:', error);
      throw error;
    }
  }

  parseZeniusContent(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    const content = {
      type: 'unknown',
      items: []
    };

    if (this.currentPath === '') {
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
    } else if (this.currentPath.startsWith('categoryid=')) {
      const simfileLinks = doc.querySelectorAll('a[href*="viewsimfile.php"]');
      if (simfileLinks.length > 0) {
        content.type = 'simfiles';
        simfileLinks.forEach((link) => {
          const href = link.getAttribute('href');
          const text = link.textContent.trim();
          if (href && text && !text.includes('Download') && !text.includes('MB')) {
            const urlParams = new URLSearchParams(href.split('?')[1] || '');
            const simfileId = urlParams.get('simfileid');

            if (simfileId) {
              content.items.push({
                type: 'simfile',
                name: text,
                url: href,
                icon: '🎵',
                simfileId: simfileId
              });
            }
          }
        });
      }
    }

    return content;
  }

  displayContent(content, path) {
    const gridEl = this.shadowRoot.getElementById('content-grid');
    gridEl.innerHTML = '';

    if (content.items.length === 0) {
      gridEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📂</div>
          <h3>No content found</h3>
          <p>This directory appears to be empty or the content couldn't be parsed.</p>
        </div>
      `;
      return;
    }

    content.items.forEach((item) => {
      const itemEl = this.createContentItem(item, path);
      gridEl.appendChild(itemEl);
    });

    this.updateStats();
  }

  createContentItem(item, currentPath) {
    if (item.type === 'simfile') {
      const linkEl = document.createElement('a');
      const fullZeniusUrl = item.url.startsWith('http')
        ? item.url
        : `https://zenius-i-vanisher.com/v5.2/${item.url}`;
      linkEl.href = `${window.location.origin}${window.location.pathname}?zenius=${fullZeniusUrl}`;
      linkEl.className = 'content-item';

      linkEl.innerHTML = `
        <div class="content-icon">${item.icon}</div>
        <div class="content-info">
          <h3>${item.name}</h3>
          <p>Simfile</p>
        </div>
      `;

      linkEl.addEventListener('click', () => {
        if (typeof window.trackEvent === 'function') {
          window.trackEvent('song_browser_song_select', 'StepMania', item.name);
        }
      });

      return linkEl;
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

    const searchResults = [];
    this.cache.forEach((content, url) => {
      content.items.forEach((item) => {
        if (item.name.toLowerCase().includes(query.toLowerCase())) {
          searchResults.push({ ...item, sourceUrl: url });
        }
      });
    });

    this.displaySearchResults(searchResults);
  }

  displaySearchResults(results) {
    const gridEl = this.shadowRoot.getElementById('content-grid');
    gridEl.innerHTML = '';

    if (results.length === 0) {
      gridEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🔍</div>
          <h3>No results found</h3>
          <p>Try adjusting your search terms.</p>
        </div>
      `;
      return;
    }

    results.forEach((item) => {
      const itemEl = this.createContentItem(item, '');
      gridEl.appendChild(itemEl);
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
}

// Register the web component
customElements.define('zenius-browser', ZeniusBrowserElement);

// Create proxy for singleton access
export const ZeniusBrowser = createComponentProxy(ZeniusBrowserElement);

export default ZeniusBrowser;

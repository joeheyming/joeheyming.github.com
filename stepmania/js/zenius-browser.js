// Zenius Browser Web Component - ES Module
import { adoptSharedStyles } from './sharedStyles.js';
import { createComponentProxy } from './componentProxy.js';

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
                <input 
                  type="text" 
                  class="search-input" 
                  id="search-input" 
                  placeholder="Search cached categories and songs..."
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

    // Search functionality - local search
    const searchInput = this.shadowRoot.getElementById('search-input');
    searchInput.addEventListener('input', (e) => {
      this.handleSearch(e.target.value);
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
      this.searchZenius();
    });

    // Zenius search inputs - stop propagation and handle Enter
    const zeniusTitleInput = this.shadowRoot.getElementById('zenius-song-title');
    const zeniusArtistInput = this.shadowRoot.getElementById('zenius-song-artist');

    zeniusTitleInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') this.searchZenius();
    });
    zeniusArtistInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') this.searchZenius();
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

    // If we have a remembered category and we're at home, navigate to it
    if (this.lastBrowsedCategoryId && this.currentPath === '') {
      this.currentCategoryName = this.lastBrowsedCategoryName || 'Category';
      this.navigateToPath(`categoryid=${this.lastBrowsedCategoryId}`);
    }
  }

  hideBrowser() {
    this.classList.remove('modal-open');
    this.shadowRoot.getElementById('zenius-browser-modal').classList.remove('show');
  }

  async loadInitialContent() {
    // Load home content without switching tabs (keep Search as default)
    await this.navigateToPath('', false);
  }

  async navigateToPath(path, switchToCategory = true) {
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

        // Try to detect difficulty column headers from the table
        const difficultyNames = ['Beginner', 'Basic', 'Difficult', 'Expert', 'Challenge'];
        const difficultyShort = ['B', 'L', 'S', 'H', 'C'];

        simfileLinks.forEach((link) => {
          const href = link.getAttribute('href');
          const text = link.textContent.trim();
          if (href && text && !text.includes('Download') && !text.includes('MB')) {
            const urlParams = new URLSearchParams(href.split('?')[1] || '');
            const simfileId = urlParams.get('simfileid');

            if (simfileId) {
              // Try to get additional info from the parent row
              const row = link.closest('tr');
              let hasVideo = false;
              let difficulties = [];

              if (row) {
                const rowHtml = row.innerHTML;
                // Check for video indicators:
                // 1. [V] span with title="Vid Exist" (Zenius uses this)
                // 2. .avi file mentioned in row
                hasVideo =
                  rowHtml.includes('Vid Exist') ||
                  rowHtml.includes('[V]') ||
                  rowHtml.toLowerCase().includes('.avi');

                // Extract numeric difficulty ratings from table cells
                const cells = row.querySelectorAll('td');
                let diffIndex = 0;

                cells.forEach((cell) => {
                  const cellText = cell.textContent.trim();
                  // Check if cell contains a difficulty number (1-20)
                  const numMatch = cellText.match(/^(\d{1,2})$/);
                  if (numMatch) {
                    const rating = parseInt(numMatch[1]);
                    if (rating >= 1 && rating <= 20) {
                      // Try to determine difficulty type from cell class, title, or position
                      let diffName = difficultyNames[diffIndex % 5] || 'Unknown';
                      let diffShort = difficultyShort[diffIndex % 5] || '?';

                      // Check cell title attribute for difficulty name
                      const title = cell.getAttribute('title') || '';
                      for (let i = 0; i < difficultyNames.length; i++) {
                        if (title.toLowerCase().includes(difficultyNames[i].toLowerCase())) {
                          diffName = difficultyNames[i];
                          diffShort = difficultyShort[i];
                          break;
                        }
                      }

                      // Check for difficulty icon images
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
    }

    return content;
  }

  displayContent(content, path) {
    const gridEl = this.shadowRoot.getElementById('content-grid');
    gridEl.innerHTML = '';

    // Defensive check for missing or empty content
    const items = content?.items || [];
    if (items.length === 0) {
      gridEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📂</div>
          <h3>No content found</h3>
          <p>This directory appears to be empty or the content couldn't be parsed.</p>
        </div>
      `;
      return;
    }

    // Sort items alphabetically by name
    const sortedItems = [...items].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    );

    sortedItems.forEach((item) => {
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

      linkEl.innerHTML = `
        <div class="content-icon">${icon}</div>
        <div class="content-info">
          <h3>${item.name}</h3>
          ${subtitle}
          <div class="simfile-badges">${badges}</div>
        </div>
        <a href="${fullZeniusUrl}" target="_blank" rel="noopener noreferrer" class="simfile-external-link" title="View on Zenius-I-Vanisher" onclick="event.stopPropagation();">🔗</a>
      `;

      linkEl.addEventListener('click', () => {
        if (typeof window.trackEvent === 'function') {
          window.trackEvent('song_browser_song_select', 'StepMania', item.name);
        }
        // Remember the current category so we can preselect it when reopening
        if (this.currentPath.startsWith('categoryid=')) {
          // From category browse view
          this.lastBrowsedCategoryId = this.currentPath.replace('categoryid=', '');
          this.lastBrowsedCategoryName = this.currentCategoryName;
        } else if (item.categoryId) {
          // From search results - use the category info from the item
          this.lastBrowsedCategoryId = item.categoryId;
          this.lastBrowsedCategoryName = item.category || 'Category';
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

    // When in category view, only search within the current category's simfiles
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

    this.displaySearchResults(searchResults);
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
  }

  async searchZenius() {
    const songTitle = this.shadowRoot.getElementById('zenius-song-title').value.trim();
    const songArtist = this.shadowRoot.getElementById('zenius-song-artist').value.trim();

    if (!songTitle && !songArtist) {
      this.showError('Please enter a song title or artist to search.');
      return;
    }

    this.showLoading('Searching Zenius-I-Vanisher...');

    try {
      // Build form data for POST request (Zenius AJAX endpoint)
      const formData = new URLSearchParams();
      formData.append('songtitle', songTitle);
      formData.append('songartist', songArtist);

      const url = 'https://zenius-i-vanisher.com/v5.2/simfiles_search_ajax.php';

      // Use proxy POST
      const html = await window.proxyService.postWithProxy(url, formData.toString());

      // Parse search results
      const results = this.parseZeniusSearchResults(html);

      if (results.length === 0) {
        this.showError(
          `No results found for "${songTitle || songArtist}". Try different search terms.`
        );
      } else {
        this.displaySearchResults(results);
        this.shadowRoot.getElementById('item-count').textContent = `${results.length} results`;
        this.shadowRoot.getElementById('current-path').textContent = `Search: "${
          songTitle || songArtist
        }"`;
      }

      // Track analytics
      if (typeof window.trackEvent === 'function') {
        window.trackEvent('zenius_search', 'StepMania', `${songTitle} | ${songArtist}`);
      }
    } catch (error) {
      console.error('Zenius search failed:', error);
      this.showError(
        `Search failed: ${error.message}. The Zenius search may not be available through proxies.`,
        () => {
          this.searchZenius();
        }
      );
    } finally {
      this.hideLoading();
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

    // Sort results alphabetically by name
    const sortedResults = [...results].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    );

    sortedResults.forEach((item) => {
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

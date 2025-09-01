// Zenius Browser Web Component
class ZeniusBrowserElement extends HTMLElement {
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
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          width: 100%;
        }
        
        .zenius-browser-container {
          display: flex;
          justify-content: space-between;
          margin-bottom: 1rem;
          width: 100%;
        }
        
        .zenius-browser-btn {
          background: linear-gradient(to right, #3b82f6, #1d4ed8);
          color: white;
          font-weight: bold;
          padding: 0.5rem 1.5rem;
          border-radius: 0.75rem;
          transition: all 0.2s;
          transform: scale(1);
          border: none;
          cursor: pointer;
          font-size: 14px;
        }
        
        .zenius-browser-btn:hover {
          background: linear-gradient(to right, #2563eb, #1e40af);
          transform: scale(1.05);
        }
        
        .modal {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.8);
          backdrop-filter: blur(8px);
          z-index: 50;
          display: flex;
          align-items: center;
          justify-content: center;
          opacity: 0;
          visibility: hidden;
          transition: all 0.3s ease;
        }
        
        .modal.show {
          opacity: 1;
          visibility: visible;
        }
        
        .modal-content {
          background: linear-gradient(to bottom right, rgba(30, 58, 138, 0.9), rgba(88, 28, 135, 0.9));
          backdrop-filter: blur(8px);
          border-radius: 1.5rem;
          max-width: 90rem;
          max-height: 90vh;
          display: flex;
          flex-direction: column;
          border: 1px solid rgba(59, 130, 246, 0.3);
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
        }
        
        .modal-header {
          padding: 2rem 2rem 1rem;
        }
        
        .modal-title {
          font-size: 2.25rem;
          font-weight: bold;
          background: linear-gradient(to right, #00f5ff, #3b82f6);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          margin-bottom: 1rem;
          text-align: center;
        }
        
        .breadcrumb {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-bottom: 1rem;
          flex-wrap: wrap;
        }
        
        .breadcrumb-item {
          color: #93c5fd;
          cursor: pointer;
          padding: 0.25rem 0.5rem;
          border-radius: 0.375rem;
          transition: all 0.2s;
        }
        
        .breadcrumb-item:hover {
          background: rgba(59, 130, 246, 0.2);
          color: white;
        }
        
        .breadcrumb-separator {
          color: #6b7280;
        }
        
        .modal-body {
          flex: 1;
          overflow-y: auto;
          padding: 0 2rem 1rem;
        }
        
        .content-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
          gap: 0.75rem;
        }
        
        .content-item {
          background: rgba(0, 0, 0, 0.3);
          backdrop-filter: blur(4px);
          border-radius: 0.75rem;
          padding: 0.75rem;
          border: 1px solid rgba(59, 130, 246, 0.3);
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }
        
        .content-item:hover {
          background: rgba(0, 0, 0, 0.5);
          border-color: rgba(59, 130, 246, 0.6);
          transform: scale(1.02);
        }
        
        .content-icon {
          font-size: 1.5rem;
          width: 2rem;
          text-align: center;
        }
        
        .content-info h3 {
          font-size: 1rem;
          font-weight: bold;
          color: white;
          margin-bottom: 0.25rem;
          line-height: 1.2;
        }
        
        .content-info p {
          color: #d1d5db;
          font-size: 0.75rem;
        }
        
        .modal-footer {
          padding: 2rem 2rem 1rem;
          border-top: 1px solid rgba(59, 130, 246, 0.3);
          background: linear-gradient(to top, rgba(30, 58, 138, 0.5), transparent);
        }
        
        .action-buttons {
          display: flex;
          justify-content: center;
          gap: 1rem;
        }
        
        .close-btn {
          background: linear-gradient(to right, #6b7280, #4b5563);
          color: white;
          font-weight: bold;
          padding: 0.75rem 2rem;
          border-radius: 0.75rem;
          transition: all 0.2s;
          transform: scale(1);
          border: none;
          cursor: pointer;
        }
        
        .close-btn:hover {
          background: linear-gradient(to right, #4b5563, #374151);
          transform: scale(1.05);
        }
        
        .loading-indicator {
          display: none;
          text-align: center;
          margin-top: 1.5rem;
        }
        
        .loading-indicator.show {
          display: block;
        }
        
        .spinner {
          display: inline-block;
          width: 2rem;
          height: 2rem;
          border: 4px solid #3b82f6;
          border-top: 4px solid transparent;
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }
        
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        
        .loading-text {
          color: white;
          margin-top: 0.5rem;
        }
        
        .search-container {
          margin-bottom: 1rem;
        }
        
        .search-input {
          width: 100%;
          padding: 0.75rem;
          border-radius: 0.5rem;
          border: 1px solid rgba(59, 130, 246, 0.3);
          background: rgba(0, 0, 0, 0.3);
          color: white;
          font-size: 1rem;
        }
        
        .search-input::placeholder {
          color: #9ca3af;
        }
        
        .search-input:focus {
          outline: none;
          border-color: rgba(59, 130, 246, 0.6);
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
        }
        
        .error-message {
          background: rgba(239, 68, 68, 0.2);
          border: 1px solid rgba(239, 68, 68, 0.3);
          color: #fca5a5;
          padding: 1rem;
          border-radius: 0.5rem;
          margin-bottom: 1rem;
        }
        
        .retry-btn {
          background: linear-gradient(to right, #3b82f6, #1d4ed8);
          color: white;
          font-weight: bold;
          padding: 0.5rem 1rem;
          border-radius: 0.5rem;
          border: none;
          cursor: pointer;
          transition: all 0.2s;
          font-size: 0.875rem;
        }
        
        .retry-btn:hover {
          background: linear-gradient(to right, #2563eb, #1e40af);
          transform: scale(1.05);
        }
        
        .empty-state {
          text-align: center;
          color: #9ca3af;
          padding: 3rem;
        }
        
        .empty-state-icon {
          font-size: 4rem;
          margin-bottom: 1rem;
        }
        
        .stats {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 1rem;
          color: #93c5fd;
          font-size: 0.875rem;
        }
      </style>
      
      <div class="zenius-browser-container">
        <button class="zenius-browser-btn" id="open-zenius-browser">🎵 Song Library</button>
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
    this.shadowRoot.getElementById('zenius-browser-modal').classList.add('show');
  }

  hideBrowser() {
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
    const statsEl = this.shadowRoot.getElementById('stats');
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
        // Load main simfiles page
        url = 'https://zenius-i-vanisher.com/v5.2/simfiles.php?category=simfiles';
      } else if (path.startsWith('categoryid=')) {
        // Load category page
        const categoryId = path.replace('categoryid=', '');
        url = `https://zenius-i-vanisher.com/v5.2/viewsimfilecategory.php?categoryid=${categoryId}`;
      } else {
        // Load specific path
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
    // Check cache first
    if (this.cache.has(url)) {
      return this.cache.get(url);
    }

    try {
      // Use the global proxy service
      const html = await window.proxyService.fetchWithProxy(url);
      const content = this.parseZeniusContent(html);

      // Cache the result
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

    // For the main simfiles page, look for option elements that map to categories
    if (this.currentPath === '') {
      // This is the main page - parse the option elements
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
      // This is a category page - look for simfile links
      const simfileLinks = doc.querySelectorAll('a[href*="viewsimfile.php"]');
      if (simfileLinks.length > 0) {
        content.type = 'simfiles';
        simfileLinks.forEach((link) => {
          const href = link.getAttribute('href');
          const text = link.textContent.trim();
          if (href && text && !text.includes('Download') && !text.includes('MB')) {
            // Extract simfileid from URL
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
      // Create a link for simfile items - anchor as outer element
      const linkEl = document.createElement('a');
      const fullZeniusUrl = item.url.startsWith('http')
        ? item.url
        : `https://zenius-i-vanisher.com/v5.2/${item.url}`;
      linkEl.href = `${window.location.origin}${window.location.pathname}?zenius=${fullZeniusUrl}`;
      linkEl.className = 'content-item content-item-link';
      linkEl.style.textDecoration = 'none';
      linkEl.style.color = 'inherit';

      linkEl.innerHTML = `
        <div class="content-icon">${item.icon}</div>
        <div class="content-info">
          <h3>${item.name}</h3>
          <p>Simfile</p>
        </div>
      `;

      return linkEl;
    } else {
      // Regular div for directory items
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
          // Navigate to category page
          if (item.categoryId) {
            this.currentCategoryName = item.name;
            this.navigateToPath(`categoryid=${item.categoryId}`);
          }
        }
      });

      return itemEl;
    }
  }

  async loadSimfile(simfileUrl, songName, simfileId) {
    try {
      this.showLoading(`Loading ${songName}...`);

      // Handle the new ?zenius= URL format
      let actualSimfileUrl = simfileUrl;
      if (simfileUrl.startsWith('?zenius=')) {
        actualSimfileUrl = decodeURIComponent(simfileUrl.substring(8)); // Remove '?zenius=' prefix
      }

      // Construct the full URL for the simfile page
      const fullUrl = actualSimfileUrl.startsWith('http')
        ? actualSimfileUrl
        : `https://zenius-i-vanisher.com/v5.2/${actualSimfileUrl}`;

      // Fetch the simfile page content
      const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(fullUrl)}`;
      const response = await fetch(proxyUrl);

      if (!response.ok) {
        throw new Error(`Failed to fetch simfile page: ${response.status}`);
      }

      const simfilePageHtml = await response.text();

      // Parse the simfile page to extract download links
      const parser = new DOMParser();
      const doc = parser.parseFromString(simfilePageHtml, 'text/html');

      // Look for simfile download links
      const simfileLinks = doc.querySelectorAll('a[href*=".sm"], a[href*=".dwi"], a[href*=".ssc"]');
      let simfileDownloadUrl = null;

      for (const link of simfileLinks) {
        const href = link.getAttribute('href');
        if (href && (href.includes('.sm') || href.includes('.dwi') || href.includes('.ssc'))) {
          simfileDownloadUrl = href.startsWith('http')
            ? href
            : `https://zenius-i-vanisher.com/v5.2/${href}`;
          break;
        }
      }

      if (!simfileDownloadUrl) {
        throw new Error('No simfile download link found');
      }

      // Fetch the actual simfile content
      const simfileProxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(
        simfileDownloadUrl
      )}`;
      const simfileResponse = await fetch(simfileProxyUrl);

      if (!simfileResponse.ok) {
        throw new Error(`Failed to fetch simfile: ${simfileResponse.status}`);
      }

      const simfileContent = await simfileResponse.text();

      // Parse the simfile to extract metadata
      const metadata = this.parseSimfileMetadata(simfileContent);

      // Create a song object that can be loaded into the game
      const songData = {
        title: metadata.title || songName,
        artist: metadata.artist || 'Unknown',
        bpm: metadata.bpm || 120,
        url: this.constructAudioUrl(simfileDownloadUrl),
        simfile: simfileProxyUrl,
        background: this.constructBackgroundUrl(simfileDownloadUrl)
      };

      // Add to the global songs object
      const songKey = `zenius_${songName.replace(/[^a-zA-Z0-9]/g, '_')}`;
      window.songs[songKey] = songData;

      // Close the browser and load the song
      this.hideBrowser();

      // Trigger song loading through the song picker
      if (window.songPicker) {
        window.songPicker.selectSong(songKey, songData);
        window.songPicker.startSelectedSong(true, true);
      }
    } catch (error) {
      console.error('Error loading simfile:', error);
      this.showError(`Failed to load simfile: ${error.message}`, () => {
        this.loadSimfile(simfileUrl, songName, simfileId);
      });
    } finally {
      this.hideLoading();
    }
  }

  parseSimfileMetadata(content) {
    const metadata = {};

    // Extract title
    const titleMatch = content.match(/#TITLE:([^;]+);/);
    if (titleMatch) {
      metadata.title = titleMatch[1].trim();
    }

    // Extract artist
    const artistMatch = content.match(/#ARTIST:([^;]+);/);
    if (artistMatch) {
      metadata.artist = artistMatch[1].trim();
    }

    // Extract BPM
    const bpmMatch = content.match(/#BPMS:([^;]+);/);
    if (bpmMatch) {
      const bpmData = bpmMatch[1];
      const firstBpm = bpmData.match(/(\d+(?:\.\d+)?)/);
      if (firstBpm) {
        metadata.bpm = parseFloat(firstBpm[1]);
      }
    }

    return metadata;
  }

  constructAudioUrl(simfileUrl) {
    // Convert .sm to .ogg
    return simfileUrl.replace(/\.sm$/, '.ogg');
  }

  constructBackgroundUrl(simfileUrl) {
    // Convert .sm to .png
    return simfileUrl.replace(/\.sm$/, '.png');
  }

  handleSearch(query) {
    if (!query.trim()) {
      // If search is empty, show current content
      this.loadContent(this.currentPath);
      return;
    }

    // Simple client-side search through cached content
    const searchResults = [];

    this.cache.forEach((content, url) => {
      content.items.forEach((item) => {
        if (item.name.toLowerCase().includes(query.toLowerCase())) {
          searchResults.push({
            ...item,
            sourceUrl: url
          });
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

    textEl.textContent = text;
    loadingEl.classList.add('show');
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

    // Add retry button event listener if callback provided
    if (retryCallback) {
      const retryBtn = gridEl.querySelector('#retry-btn');
      if (retryBtn) {
        retryBtn.addEventListener('click', retryCallback);
      }
    }
  }

  decodeUrlComponent(str) {
    try {
      return decodeURIComponent(str);
    } catch {
      return str;
    }
  }
}

// Register the web component
customElements.define('zenius-browser', ZeniusBrowserElement);

// Make globally accessible
window.ZeniusBrowser = ZeniusBrowserElement;

// ROM Browser Web Component for Sega Genesis Emulator
class RomBrowserElement extends HTMLElement {
  constructor() {
    super();
    this.allRoms = [];
    this.filteredRoms = [];
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
    this.init();
  }

  render() {
    /* All chrome reads from /brand.css through the host page; the
     * Sega-identity Genesis-red lives in sega/index.html as
     * `--accent-bright` (and `-soft` / `-ring` siblings). CSS custom
     * properties inherit through shadow DOM, so this whole component
     * is theme-swappable: brand.css drives chrome, sega/index.html
     * drives identity, and zero color hexes are frozen in this file. */
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          width: 100%;
        }
        
        .rom-browser-container {
          display: flex;
          justify-content: space-between;
          width: 100%;
        }
        
        /* Launch button — Sega-identity red routed via sega/index.html. */
        .rom-browser-btn {
          background: var(--accent-bright);
          color: var(--text-on-accent);
          font-weight: bold;
          padding: 14px 20px;
          border-radius: 8px;
          transition: filter 0.2s, transform 0.2s;
          border: none;
          cursor: pointer;
          font-size: 15px;
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          line-height: 1.2;
          margin: 0;
          white-space: nowrap;
          box-shadow: var(--shadow-card);
        }
        
        .rom-browser-btn:hover {
          filter: brightness(0.88);
          transform: scale(1.05);
        }
        
        .modal {
          position: fixed;
          inset: 0;
          background: var(--scrim-strong);
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
          background: var(--surface-1);
          color: var(--text-1);
          border-radius: 1.5rem;
          width: min(90vw, 90rem);
          max-height: 90vh;
          display: flex;
          flex-direction: column;
          border: 1px solid var(--hairline-strong);
          box-shadow: var(--shadow-modal);
        }
        
        .modal-header {
          padding: 2rem 2rem 1rem;
        }
        
        .modal-title {
          font-size: 2rem;
          font-weight: bold;
          color: var(--accent-bright);
          margin-bottom: 0.5rem;
          text-align: center;
        }
        
        .modal-subtitle {
          color: var(--text-2);
          text-align: center;
          font-size: 1rem;
        }
        
        .modal-body {
          flex: 1;
          overflow: hidden;
          padding: 0 2rem;
        }
        
        .modal-footer {
          padding: 1rem 2rem 2rem;
          display: flex;
          justify-content: center;
        }
        
        .close-btn {
          background: var(--surface-2);
          color: var(--text-1);
          font-weight: bold;
          padding: 0.75rem 2rem;
          border-radius: 0.75rem;
          border: 1px solid var(--hairline-strong);
          cursor: pointer;
          transition: background-color 0.2s, transform 0.2s;
        }
        
        .close-btn:hover {
          background: var(--accent-primary-soft);
          transform: scale(1.05);
        }
        
        .content-area {
          height: 60vh;
          overflow-y: auto;
          border: 1px solid var(--hairline);
          border-radius: 0.75rem;
          background: var(--surface-2);
        }
        
        .loading {
          display: flex;
          justify-content: center;
          align-items: center;
          height: 200px;
          color: var(--text-2);
          font-size: 1.25rem;
        }
        
        .error {
          display: flex;
          justify-content: center;
          align-items: center;
          height: 200px;
          color: var(--danger);
          font-size: 1.25rem;
          text-align: center;
          padding: 1rem;
        }
        
        .rom-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 1rem;
          padding: 1rem;
        }
        
        .rom-card {
          background: var(--surface-1);
          border: 1px solid var(--hairline);
          border-radius: 0.75rem;
          padding: 1rem;
          cursor: pointer;
          transition: all 0.2s;
        }
        
        .rom-card:hover {
          background: var(--accent-bright-soft);
          border-color: var(--accent-bright);
          transform: translateY(-2px);
          box-shadow: var(--shadow-card);
        }
        
        .rom-title {
          font-weight: bold;
          color: var(--accent-gold);
          margin-bottom: 0.5rem;
          font-size: 1.1rem;
        }
        
        .rom-info {
          color: var(--text-1);
          font-size: 0.875rem;
          line-height: 1.4;
        }
        
        .rom-size {
          color: var(--text-3);
          font-size: 0.75rem;
          margin-top: 0.25rem;
        }
        
        .search-container {
          margin-bottom: 1rem;
          position: relative;
        }
        
        .search-input {
          width: 100%;
          padding: 0.75rem 1rem;
          border: 1px solid var(--hairline-strong);
          border-radius: 0.75rem;
          background: var(--surface-1);
          color: var(--text-1);
          font-size: 1rem;
          box-sizing: border-box;
        }
        
        .search-input::placeholder {
          color: var(--text-3);
        }
        
        .search-input:focus {
          outline: none;
          border-color: var(--accent-bright);
          box-shadow: 0 0 0 2px var(--accent-bright-ring);
        }
      </style>
      
      <div class="rom-browser-container">
        <button class="rom-browser-btn" id="openBrowserBtn">
          <span>🗂️</span>
          <span>Browse ROM Collection</span>
        </button>
      </div>
      
      <div class="modal" id="browserModal">
        <div class="modal-content">
          <div class="modal-header">
            <h2 class="modal-title">Sega Genesis ROM Browser</h2>
            <p class="modal-subtitle">Browse and load Genesis ROMs from Internet Archive</p>
          </div>
          
          <div class="modal-body">
            <div class="search-container">
              <input type="text" class="search-input" id="searchInput" placeholder="Search ROMs...">
            </div>
            
            <div class="content-area" id="contentArea">
              <div class="loading">Loading ROM collection...</div>
            </div>
          </div>
          
          <div class="modal-footer">
            <button class="close-btn" id="closeBrowserBtn">Close</button>
          </div>
        </div>
      </div>
    `;
  }

  init() {
    const openBtn = this.shadowRoot.getElementById('openBrowserBtn');
    const closeBtn = this.shadowRoot.getElementById('closeBrowserBtn');
    const modal = this.shadowRoot.getElementById('browserModal');
    const searchInput = this.shadowRoot.getElementById('searchInput');

    openBtn.addEventListener('click', () => {
      this.openBrowser();
    });

    closeBtn.addEventListener('click', () => {
      this.closeBrowser();
    });

    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        this.closeBrowser();
      }
    });

    searchInput.addEventListener('input', (e) => {
      this.handleSearch(e.target.value);
    });
  }

  async openBrowser() {
    const modal = this.shadowRoot.getElementById('browserModal');
    modal.classList.add('show');

    // Clear search input and reset filtered ROMs
    const searchInput = this.shadowRoot.getElementById('searchInput');
    searchInput.value = '';

    if (this.allRoms.length === 0) {
      await this.loadAllRoms();
    } else {
      this.filteredRoms = [...this.allRoms];
      this.renderRoms(this.filteredRoms);
    }
  }

  closeBrowser() {
    const modal = this.shadowRoot.getElementById('browserModal');
    modal.classList.remove('show');
  }

  async loadAllRoms() {
    const contentArea = this.shadowRoot.getElementById('contentArea');
    contentArea.innerHTML = '<div class="loading">Loading ROM collection...</div>';

    try {
      if (!window.segaArchiveRoms) {
        throw new Error('Sega Archive ROMs not available');
      }

      this.allRoms = await window.segaArchiveRoms.getAllRoms();
      this.filteredRoms = [...this.allRoms];

      if (this.allRoms.length === 0) {
        contentArea.innerHTML =
          '<div class="error">No ROMs found. Please check your connection and try again.</div>';
        return;
      }

      this.renderRoms(this.filteredRoms);
    } catch (error) {
      console.error('Error loading ROMs:', error);
      contentArea.innerHTML =
        '<div class="error">Failed to load ROMs from Internet Archive. Please try again.</div>';
    }
  }

  renderRoms(roms) {
    const contentArea = this.shadowRoot.getElementById('contentArea');

    const romGrid = document.createElement('div');
    romGrid.className = 'rom-grid';

    roms.forEach((rom) => {
      const romCard = document.createElement('div');
      romCard.className = 'rom-card';
      romCard.innerHTML = `
        <div class="rom-title">${rom.title}</div>
        <div class="rom-info">${rom.description}</div>
        <div class="rom-size">${rom.size}</div>
      `;

      romCard.addEventListener('click', () => {
        this.loadRom(rom);
      });

      romGrid.appendChild(romCard);
    });

    contentArea.innerHTML = '';
    contentArea.appendChild(romGrid);
  }

  async loadRom(rom) {
    const contentArea = this.shadowRoot.getElementById('contentArea');
    const originalContent = contentArea.innerHTML;

    try {
      console.log('Loading ROM:', rom.title);
      contentArea.innerHTML = `<div class="loading">Loading ${rom.title}...</div>`;

      if (!window.proxyService) {
        throw new Error('Proxy service not available.');
      }

      // Download the ROM zip via segaArchiveRoms (returns raw Uint8Array)
      const romData = await window.segaArchiveRoms.loadRom(rom);
      console.log(`✅ Downloaded ROM: ${romData.byteLength} bytes`);

      // Wrap in a File so EmulatorJS sees a .zip filename and extracts it
      // properly. A plain blob URL loses the filename (becomes a UUID),
      // so the genesis_plus_gx core can't detect the ZIP and silently hangs.
      const romFile = new File([romData], `${rom.title}.zip`, { type: 'application/zip' });

      // Close the browser modal before launching
      this.closeBrowser();

      // Hand off to the page's launchEmulator function
      if (typeof window.launchEmulator === 'function') {
        window.launchEmulator(romFile, rom.title + '.zip');
      } else {
        console.error('launchEmulator not available on window');
        alert('Emulator not ready. Please reload the page and try again.');
      }
    } catch (error) {
      console.error('Error loading ROM:', error);
      alert('Failed to load ROM: ' + error.message);

      // Restore previous grid content
      if (contentArea) {
        contentArea.innerHTML = originalContent;
      }
    }
  }

  // Returns a score > 0 if query fuzzy-matches text, 0 if no match.
  // Higher score = better match. Bonuses for:
  //   - substring match (best)
  //   - consecutive matching characters
  //   - matching at word boundaries (space / bracket / comma)
  fuzzyScore(text, query) {
    const t = text.toLowerCase();
    const q = query.toLowerCase();

    // Exact substring: highest priority
    if (t.includes(q)) return 1000 + (1000 - t.indexOf(q));

    // Fuzzy: all query chars must appear in order
    let ti = 0;
    let qi = 0;
    let score = 0;
    let consecutive = 0;

    while (ti < t.length && qi < q.length) {
      if (t[ti] === q[qi]) {
        consecutive++;
        // Bonus for consecutive run
        score += 10 + consecutive * 5;
        // Bonus for word-boundary start (space, (, [, ,)
        if (ti === 0 || /[\s([,+]/.test(t[ti - 1])) score += 20;
        qi++;
      } else {
        consecutive = 0;
      }
      ti++;
    }

    return qi === q.length ? score : 0;
  }

  handleSearch(query) {
    if (!query.trim()) {
      this.filteredRoms = [...this.allRoms];
      this.renderRoms(this.filteredRoms);
      return;
    }

    const scored = this.allRoms
      .map((rom) => ({
        rom,
        score: Math.max(this.fuzzyScore(rom.title, query), this.fuzzyScore(rom.name, query))
      }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score);

    this.filteredRoms = scored.map(({ rom }) => rom);
    this.renderRoms(this.filteredRoms);
  }
}

// Register the custom element
customElements.define('rom-browser', RomBrowserElement);

// Make it globally accessible
window.RomBrowserElement = RomBrowserElement;

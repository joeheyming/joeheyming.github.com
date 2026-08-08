// <rom-browser> web component for the unified emulator shell.
//
// Reads the active console either from a `console="nes"` attribute or
// from `window.getEmulatorConsole()` (resolved off `?console=`). When
// the console has no Internet Archive collection wired up (e.g. Game
// Boy at the moment) the element hides itself entirely so the boot
// card just shows the local-file picker.
//
// Lean-back (TV): cards are focusable with roving tabindex, search is
// demoted behind a toggle, Escape/Backspace closes the modal.
class RomBrowserElement extends HTMLElement {
  constructor() {
    super();
    this.allRoms = [];
    this.filteredRoms = [];
    this._romRoving = null;
    this._onModalKey = null;
    this.attachShadow({ mode: 'open' });
  }

  get consoleId() {
    return this.getAttribute('console') || window.getEmulatorConsoleId?.() || null;
  }

  get consoleConfig() {
    const id = this.consoleId;
    if (!id) return null;
    return (window.EMULATOR_CONSOLES || {})[id] || null;
  }

  get iaClient() {
    if (this._ia) return this._ia;
    const cfg = this.consoleConfig;
    if (!cfg || !cfg.iaBaseUrl || !window.InternetArchiveRoms) return null;
    this._ia = new window.InternetArchiveRoms({
      baseUrl: cfg.iaBaseUrl,
      descriptionPrefix: cfg.iaDescriptionPrefix,
      fileExtensions: cfg.iaFileExtensions,
      excludeNames: cfg.iaExcludeNames
    });
    return this._ia;
  }

  get isTv() {
    return document.documentElement.dataset.mode === 'tv';
  }

  connectedCallback() {
    this.render();
    this.init();
  }

  disconnectedCallback() {
    this.teardownModalKeys();
    if (this._romRoving) {
      this._romRoving.dispose();
      this._romRoving = null;
    }
  }

  render() {
    const cfg = this.consoleConfig;
    // Hide the component entirely if we don't have an IA collection to
    // browse. Boot card falls back to the local-file picker which is
    // always there.
    if (!cfg || !cfg.iaBaseUrl) {
      this.shadowRoot.innerHTML = '<style>:host{display:none}</style>';
      return;
    }

    const tv = this.isTv;

    // All chrome reads from /brand.css through the host page; identity
    // colors (`--accent-bright`, `--accent-gold`) are set on `:root` by
    // launch.js based on the active console. CSS custom properties
    // inherit through shadow DOM, so this whole component re-tints
    // automatically when the console changes.
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; width: 100%; }
        .rom-browser-container { display: flex; justify-content: space-between; width: 100%; }
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
        .rom-browser-btn:hover { filter: brightness(0.88); transform: scale(1.05); }
        .rom-browser-btn:focus-visible {
          outline: 4px solid var(--accent-bright);
          outline-offset: 3px;
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
        .modal.show { opacity: 1; visibility: visible; }
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
        .modal-header { padding: 2rem 2rem 1rem; }
        .modal-title {
          font-size: 2rem;
          font-weight: bold;
          color: var(--accent-bright);
          margin-bottom: 0.5rem;
          text-align: center;
        }
        .modal-subtitle { color: var(--text-2); text-align: center; font-size: 1rem; }
        .modal-body { flex: 1; overflow: hidden; padding: 0 2rem; display: flex; flex-direction: column; gap: 0.75rem; }
        .modal-footer { padding: 1rem 2rem 2rem; display: flex; justify-content: center; gap: 0.75rem; }
        .close-btn, .search-toggle {
          background: var(--surface-2);
          color: var(--text-1);
          font-weight: bold;
          padding: 0.75rem 2rem;
          border-radius: 0.75rem;
          border: 1px solid var(--hairline-strong);
          cursor: pointer;
          transition: background-color 0.2s, transform 0.2s;
        }
        .close-btn:hover, .search-toggle:hover { background: var(--accent-primary-soft); transform: scale(1.05); }
        .close-btn:focus-visible, .search-toggle:focus-visible {
          outline: 4px solid var(--accent-bright);
          outline-offset: 3px;
        }
        .content-area {
          height: 60vh;
          overflow-y: auto;
          border: 1px solid var(--hairline);
          border-radius: 0.75rem;
          background: var(--surface-2);
          flex: 1;
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
          grid-template-columns: repeat(auto-fill, minmax(${tv ? '220px' : '300px'}, 1fr));
          gap: ${tv ? '1.25rem' : '1rem'};
          padding: 1rem;
        }
        .rom-card {
          background: var(--surface-1);
          border: 1px solid var(--hairline);
          border-radius: 0.75rem;
          padding: ${tv ? '1.25rem' : '1rem'};
          cursor: pointer;
          transition: all 0.2s;
        }
        .rom-card:hover {
          background: var(--accent-bright-soft);
          border-color: var(--accent-bright);
          transform: translateY(-2px);
          box-shadow: var(--shadow-card);
        }
        .rom-card:focus-visible {
          outline: 4px solid var(--accent-bright);
          outline-offset: 3px;
          background: var(--accent-bright-soft);
          border-color: var(--accent-bright);
        }
        .rom-title {
          font-weight: bold;
          color: var(--accent-gold);
          margin-bottom: 0.5rem;
          font-size: ${tv ? '1.25rem' : '1.1rem'};
        }
        .rom-info { color: var(--text-1); font-size: 0.875rem; line-height: 1.4; }
        .rom-size { color: var(--text-3); font-size: 0.75rem; margin-top: 0.25rem; }
        .search-container { margin-bottom: 0; position: relative; }
        .search-container[hidden] { display: none !important; }
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
        .search-input::placeholder { color: var(--text-3); }
        .search-input:focus {
          outline: none;
          border-color: var(--accent-bright);
          box-shadow: 0 0 0 2px var(--accent-bright-ring);
        }
      </style>

      <div class="rom-browser-container">
        <button class="rom-browser-btn" id="openBrowserBtn" type="button">
          <span>🗂️</span>
          <span>Browse ${cfg.title} ROM Collection</span>
        </button>
      </div>

      <div class="modal" id="browserModal" role="dialog" aria-modal="true" aria-labelledby="romBrowserTitle">
        <div class="modal-content">
          <div class="modal-header">
            <h2 class="modal-title" id="romBrowserTitle">${cfg.title} ROM Browser</h2>
            <p class="modal-subtitle">Browse and load ${cfg.title} ROMs from Internet Archive</p>
          </div>
          <div class="modal-body">
            <div class="search-container" id="searchContainer" ${tv ? 'hidden' : ''}>
              <input type="text" class="search-input" id="searchInput" placeholder="Search ROMs...">
            </div>
            <div class="content-area" id="contentArea">
              <div class="loading">Loading ROM collection...</div>
            </div>
          </div>
          <div class="modal-footer">
            ${
              tv
                ? '<button class="search-toggle" id="searchToggleBtn" type="button">Search</button>'
                : ''
            }
            <button class="close-btn" id="closeBrowserBtn" type="button">Close</button>
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
    if (!openBtn || !closeBtn || !modal || !searchInput) return;

    openBtn.addEventListener('click', () => this.openBrowser());
    closeBtn.addEventListener('click', () => this.closeBrowser());
    modal.addEventListener('click', (e) => {
      if (e.target === modal) this.closeBrowser();
    });

    const searchToggle = this.shadowRoot.getElementById('searchToggleBtn');
    if (searchToggle) {
      searchToggle.addEventListener('click', () => {
        const box = this.shadowRoot.getElementById('searchContainer');
        if (!box) return;
        const show = box.hasAttribute('hidden');
        if (show) {
          box.removeAttribute('hidden');
          searchInput.focus();
        } else {
          box.setAttribute('hidden', '');
          searchInput.value = '';
          this.handleSearch('');
        }
      });
    }

    // Debounce the ROM search — full fuzzy-score + grid re-render on every
    // keystroke was the dominant INP cost on this page (hundreds of cards
    // rebuilt via innerHTML inside the keypress handler). 120ms is short
    // enough to feel live while still batching a fast typist's 3-5 char
    // burst into a single render.
    searchInput.addEventListener('input', (e) => {
      const value = e.target.value;
      if (this._searchDebounce) clearTimeout(this._searchDebounce);
      this._searchDebounce = setTimeout(() => {
        this._searchDebounce = null;
        this.handleSearch(value);
      }, 120);
    });
  }

  setupModalKeys() {
    this.teardownModalKeys();
    this._onModalKey = (e) => {
      if (e.key === 'Escape' || e.key === 'Backspace') {
        // Don't steal Backspace while typing in search.
        if (e.key === 'Backspace') {
          const t = e.target;
          if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
        }
        e.preventDefault();
        this.closeBrowser();
      }
    };
    document.addEventListener('keydown', this._onModalKey, true);
  }

  teardownModalKeys() {
    if (this._onModalKey) {
      document.removeEventListener('keydown', this._onModalKey, true);
      this._onModalKey = null;
    }
  }

  async openBrowser() {
    const modal = this.shadowRoot.getElementById('browserModal');
    modal.classList.add('show');
    this.setupModalKeys();

    const searchInput = this.shadowRoot.getElementById('searchInput');
    searchInput.value = '';
    if (this.isTv) {
      const box = this.shadowRoot.getElementById('searchContainer');
      if (box) box.setAttribute('hidden', '');
    }

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
    this.teardownModalKeys();
    if (this._romRoving) {
      this._romRoving.dispose();
      this._romRoving = null;
    }
    const openBtn = this.shadowRoot.getElementById('openBrowserBtn');
    if (openBtn) openBtn.focus({ preventScroll: false });
  }

  async loadAllRoms() {
    const contentArea = this.shadowRoot.getElementById('contentArea');
    contentArea.innerHTML = '<div class="loading">Loading ROM collection...</div>';

    try {
      const ia = this.iaClient;
      if (!ia) {
        throw new Error('ROM browser is not configured for this console.');
      }

      this.allRoms = await ia.getAllRoms();
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
    if (this._romRoving) {
      this._romRoving.dispose();
      this._romRoving = null;
    }

    const romGrid = document.createElement('div');
    romGrid.className = 'rom-grid';

    roms.forEach((rom) => {
      const romCard = document.createElement('div');
      romCard.className = 'rom-card';
      romCard.setAttribute('role', 'button');
      romCard.tabIndex = 0;
      romCard.innerHTML = `
        <div class="rom-title">${rom.title}</div>
        <div class="rom-info">${rom.description}</div>
        <div class="rom-size">${rom.size}</div>
      `;
      romCard.addEventListener('click', () => this.loadRom(rom));
      romCard.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.loadRom(rom);
        }
      });
      romGrid.appendChild(romCard);
    });

    contentArea.innerHTML = '';
    contentArea.appendChild(romGrid);

    const lb = window.emulatorLeanback;
    if (lb && typeof lb.applyRovingTabindex === 'function') {
      this._romRoving = lb.applyRovingTabindex(romGrid, { selector: '.rom-card' });
      if (this.isTv) this._romRoving.focusFirst();
    } else if (this.isTv) {
      const first = romGrid.querySelector('.rom-card');
      if (first) first.focus({ preventScroll: false });
    }
  }

  async loadRom(rom) {
    const contentArea = this.shadowRoot.getElementById('contentArea');
    const originalContent = contentArea ? contentArea.innerHTML : '';

    try {
      if (contentArea) {
        contentArea.innerHTML = `<div class="loading">Loading ${rom.title}...</div>`;
      }

      const ia = this.iaClient;
      if (!ia) {
        throw new Error('ROM source unavailable.');
      }

      const romData = await ia.loadRom(rom);

      // Wrap in a File so EmulatorJS sees a real filename — libretro cores
      // (FCEUmm, genesis_plus_gx, gambatte) detect format from the suffix.
      // Preserve the source extension: zip-based collections (NES / Sega)
      // pass through as .zip and the core unzips, raw .gb / .gbc from the
      // GameBoyColor item are handed to gambatte directly. Faking .zip on
      // raw ROM bytes used to silently hang the core.
      const ext = rom.fileExtension || '.zip';
      const mimeType = ext === '.zip' ? 'application/zip' : 'application/octet-stream';
      const filename = `${rom.title}${ext}`;
      const romFile = new File([romData], filename, { type: mimeType });

      this.closeBrowser();

      if (typeof window.launchEmulator === 'function') {
        window.launchEmulator(romFile, filename);
      } else {
        console.error('launchEmulator not available on window');
        alert('Emulator not ready. Please reload the page and try again.');
      }
    } catch (error) {
      console.error('Error loading ROM:', error);
      alert('Failed to load ROM: ' + error.message);
      if (contentArea) contentArea.innerHTML = originalContent;
    }
  }

  // Fuzzy match score (higher = better, 0 = no match). Borrowed from
  // the sega rom browser since it already scored exact substring hits
  // ahead of in-order character matches and was the better UX of the two.
  fuzzyScore(text, query) {
    const t = text.toLowerCase();
    const q = query.toLowerCase();

    if (t.includes(q)) return 1000 + (1000 - t.indexOf(q));

    let ti = 0;
    let qi = 0;
    let score = 0;
    let consecutive = 0;

    while (ti < t.length && qi < q.length) {
      if (t[ti] === q[qi]) {
        consecutive++;
        score += 10 + consecutive * 5;
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

customElements.define('rom-browser', RomBrowserElement);
window.RomBrowserElement = RomBrowserElement;

// <rom-browser> web component for the unified emulator shell.
//
// Reads the active console either from a `console="nes"` attribute or
// from `window.getEmulatorConsole()` (resolved off `?console=`). When
// the console has no Internet Archive collection wired up (e.g. Game
// Boy at the moment) the element hides itself entirely so the boot
// card just shows the local-file picker. Same for PS1 (local disc only).
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
      excludeNames: cfg.iaExcludeNames,
      binaryTimeout: cfg.iaBinaryTimeout,
      maxRetries: cfg.iaMaxRetries,
      preferMetadata: cfg.iaPreferMetadata !== false
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
          /* Headings use brand text tokens — console accents (PS1 navy /
           * SNES deep purple) fail AA on dark surfaces. */
          color: var(--text-1);
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
        .error {
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          gap: 0.75rem;
          min-height: 200px;
          color: var(--danger);
          font-size: 1.1rem;
          text-align: center;
          padding: 1rem;
        }
        .error-detail {
          color: var(--text-2);
          font-size: 0.9rem;
          max-width: 36rem;
          line-height: 1.4;
        }
        .error-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
          justify-content: center;
        }
        .error-actions button,
        .error-actions a {
          appearance: none;
          border: 1px solid var(--hairline);
          background: var(--surface-1);
          color: var(--text-1);
          border-radius: 0.5rem;
          padding: 0.5rem 0.9rem;
          font: inherit;
          cursor: pointer;
          text-decoration: none;
        }
        .error-actions button.primary,
        .error-actions a.primary {
          border-color: var(--accent-bright);
          background: var(--accent-bright-soft);
        }
        .loading {
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          gap: 0.5rem;
          height: 200px;
          color: var(--text-2);
          font-size: 1.25rem;
          text-align: center;
          padding: 1rem;
        }
        .loading-hint {
          font-size: 0.9rem;
          opacity: 0.85;
          max-width: 28rem;
        }
        .external-download {
          display: flex;
          flex-direction: column;
          align-items: stretch;
          gap: 0.85rem;
          max-width: 32rem;
          margin: 1.5rem auto;
          padding: 1.25rem 1.5rem;
          text-align: left;
          color: var(--text-1);
          background: var(--surface-1);
          border: 1px solid var(--hairline);
          border-radius: 0.75rem;
        }
        .external-download h3 {
          margin: 0;
          font-size: 1.15rem;
          line-height: 1.3;
        }
        .external-download p {
          margin: 0;
          color: var(--text-2);
          font-size: 0.95rem;
          line-height: 1.45;
        }
        .external-download .size-line {
          font-variant-numeric: tabular-nums;
          color: var(--text-1);
          font-weight: 600;
        }
        .external-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 0.6rem;
          margin-top: 0.25rem;
        }
        .external-actions button,
        .external-actions a.buttonish {
          appearance: none;
          border: 1px solid var(--hairline);
          background: var(--surface-0);
          color: var(--text-1);
          border-radius: 0.5rem;
          padding: 0.65rem 0.9rem;
          font-size: 0.95rem;
          cursor: pointer;
          text-decoration: none;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .external-actions button.primary,
        .external-actions a.buttonish.primary {
          border-color: var(--accent-bright);
          background: var(--accent-bright);
          color: var(--text-on-accent);
          font-weight: 600;
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
          color: var(--text-1);
          margin-bottom: 0.5rem;
          font-size: ${tv ? '1.25rem' : '1.1rem'};
        }
        .rom-info { color: var(--text-2); font-size: 0.875rem; line-height: 1.4; }
        .rom-size { color: var(--text-3); font-size: 0.75rem; margin-top: 0.25rem; }
        .rom-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
          margin-top: 0.8rem;
        }
        .rom-actions button,
        .rom-actions a {
          appearance: none;
          border: 1px solid var(--hairline);
          border-radius: 0.5rem;
          padding: 0.5rem 0.75rem;
          background: var(--surface-0);
          color: var(--text-1);
          font: inherit;
          font-size: 0.85rem;
          font-weight: 600;
          line-height: 1.2;
          text-decoration: none;
          cursor: pointer;
        }
        .rom-actions button {
          border-color: var(--accent-bright);
          background: var(--accent-bright);
          color: var(--text-on-accent);
        }
        .rom-actions button:focus-visible,
        .rom-actions a:focus-visible {
          outline: 3px solid var(--accent-bright);
          outline-offset: 2px;
        }
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
          <span>${
            cfg.iaExternalDownload
              ? `Browse ${cfg.title} Disc Catalog`
              : `Browse ${cfg.title} ROM Collection`
          }</span>
        </button>
      </div>

      <div class="modal" id="browserModal" role="dialog" aria-modal="true" aria-labelledby="romBrowserTitle">
        <div class="modal-content">
          <div class="modal-header">
            <h2 class="modal-title" id="romBrowserTitle">${cfg.title} ${
      cfg.iaExternalDownload ? 'Disc Catalog' : 'ROM Browser'
    }</h2>
            <p class="modal-subtitle">${
              cfg.iaExternalDownload
                ? `Search Internet Archive, download the disc, then load it locally`
                : `Browse and load ${cfg.title} ROMs from Internet Archive`
            }</p>
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
    contentArea.innerHTML =
      '<div class="loading">Loading ROM collection…' +
      '<div class="loading-hint">Fetching via CORS proxies — retries automatically if one is flaky.</div></div>';

    try {
      const ia = this.iaClient;
      if (!ia) {
        throw new Error('ROM browser is not configured for this console.');
      }

      this.allRoms = await ia.getAllRoms();
      this.filteredRoms = [...this.allRoms];

      if (this.allRoms.length === 0) {
        contentArea.innerHTML =
          '<div class="error">No ROMs found. Please check your connection and try again.' +
          '<div class="error-actions"><button type="button" class="primary" data-action="retry-list">Retry</button></div></div>';
        contentArea.querySelector('[data-action="retry-list"]')?.addEventListener('click', () => {
          ia.clearListCache();
          this.allRoms = [];
          this.loadAllRoms();
        });
        return;
      }

      this.renderRoms(this.filteredRoms);
    } catch (error) {
      console.error('Error loading ROMs:', error);
      const detail = (error && error.message) || 'Unknown error';
      contentArea.innerHTML =
        '<div class="error">Failed to load ROMs from Internet Archive.' +
        `<div class="error-detail">${this._escapeHtml(
          detail
        )} Proxies can be flaky — retry often works.</div>` +
        '<div class="error-actions"><button type="button" class="primary" data-action="retry-list">Retry</button></div></div>';
      contentArea.querySelector('[data-action="retry-list"]')?.addEventListener('click', () => {
        if (this.iaClient) this.iaClient.clearListCache();
        this.allRoms = [];
        this.loadAllRoms();
      });
    }
  }

  _escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  renderRoms(roms) {
    const contentArea = this.shadowRoot.getElementById('contentArea');
    if (this._romRoving) {
      this._romRoving.dispose();
      this._romRoving = null;
    }

    const romGrid = document.createElement('div');
    romGrid.className = 'rom-grid';
    const cfg = this.consoleConfig;
    const allowExternalDownload = !!(cfg && cfg.iaAllowExternalDownload);

    roms.forEach((rom) => {
      const romCard = document.createElement('div');
      romCard.className = 'rom-card';
      const title = this._escapeHtml(rom.title);
      const description = this._escapeHtml(rom.description);
      const size = this._escapeHtml(rom.size);

      if (!allowExternalDownload) {
        romCard.setAttribute('role', 'button');
        romCard.tabIndex = 0;
      }
      romCard.innerHTML = `
        <div class="rom-title">${title}</div>
        <div class="rom-info">${description}</div>
        <div class="rom-size">${size}</div>
        ${
          allowExternalDownload
            ? `<div class="rom-actions">
                <button type="button" data-action="play-rom">Play in browser</button>
                <a href="${this._escapeHtml(
                  rom.downloadUrl || '#'
                )}" target="_blank" rel="noopener noreferrer">Download instead</a>
              </div>`
            : ''
        }
      `;
      if (allowExternalDownload) {
        romCard
          .querySelector('[data-action="play-rom"]')
          ?.addEventListener('click', () => this.loadRom(rom));
      } else {
        romCard.addEventListener('click', () => this.loadRom(rom));
        romCard.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            this.loadRom(rom);
          }
        });
      }
      romGrid.appendChild(romCard);
    });

    contentArea.innerHTML = '';
    contentArea.appendChild(romGrid);

    const lb = window.emulatorLeanback;
    if (lb && typeof lb.applyRovingTabindex === 'function') {
      this._romRoving = lb.applyRovingTabindex(romGrid, {
        selector: allowExternalDownload ? '[data-action="play-rom"]' : '.rom-card'
      });
      if (this.isTv) this._romRoving.focusFirst();
    } else if (this.isTv) {
      const first = romGrid.querySelector(
        allowExternalDownload ? '[data-action="play-rom"]' : '.rom-card'
      );
      if (first) first.focus({ preventScroll: false });
    }
  }

  async loadRom(rom) {
    const contentArea = this.shadowRoot.getElementById('contentArea');
    const restoreList = () => {
      if (contentArea) this.renderRoms(this.filteredRoms.length ? this.filteredRoms : this.allRoms);
    };

    const cfg = this.consoleConfig;
    if (cfg && cfg.iaExternalDownload) {
      this.showExternalDownload(rom, restoreList);
      return;
    }

    try {
      if (contentArea) {
        contentArea.innerHTML =
          `<div class="loading">Loading ${this._escapeHtml(rom.title)}…` +
          '<div class="loading-hint">Large zips can take a minute while proxies rotate.</div></div>';
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
      const detail = (error && error.message) || 'Unknown error';
      const canDownload = !!(cfg && cfg.iaAllowExternalDownload && rom.downloadUrl);
      const downloadAction = canDownload
        ? `<a class="primary" href="${this._escapeHtml(
            rom.downloadUrl
          )}" target="_blank" rel="noopener noreferrer">Download instead</a>` +
          '<button type="button" data-action="load-local">Load saved ROM</button>'
        : '';
      if (contentArea) {
        contentArea.innerHTML =
          `<div class="error">Failed to load ${this._escapeHtml(rom.title)}.` +
          `<div class="error-detail">${this._escapeHtml(detail)}</div>` +
          '<div class="error-actions">' +
          '<button type="button" class="primary" data-action="retry-rom">Retry download</button>' +
          downloadAction +
          '<button type="button" data-action="back-list">Back to list</button>' +
          '</div></div>';
        contentArea.querySelector('[data-action="retry-rom"]')?.addEventListener('click', () => {
          this.loadRom(rom);
        });
        contentArea
          .querySelector('[data-action="back-list"]')
          ?.addEventListener('click', restoreList);
        contentArea.querySelector('[data-action="load-local"]')?.addEventListener('click', () => {
          this.closeBrowser();
          document.getElementById('romFileInput')?.click();
        });
      } else {
        alert('Failed to load ROM: ' + detail);
      }
    }
  }

  /** Hand the user the Archive URL, then offer the local file picker. */
  showExternalDownload(rom, restoreList) {
    const contentArea = this.shadowRoot.getElementById('contentArea');
    if (!contentArea) return;

    const cfg = this.consoleConfig;
    const isDisc = !!(cfg && cfg.iaExternalDownload);
    const sizeLabel =
      rom.size && rom.size !== 'Unknown'
        ? rom.size
        : isDisc
        ? 'often 100–500+ MB'
        : 'size unavailable';
    const href = rom.downloadUrl || '#';
    const explanation = isDisc
      ? 'PlayStation discs are too large to download through this page’s proxies ' +
        '(browser CORS limits). Download from Internet Archive in a new tab, then ' +
        'load the saved <code>.chd</code> file here.'
      : 'Download this ROM directly from Internet Archive, then load the saved file here.';

    contentArea.innerHTML = `
      <div class="external-download">
        <h3>${this._escapeHtml(rom.title)}</h3>
        <p class="size-line">${isDisc ? 'Disc image' : 'ROM'} size: ${this._escapeHtml(
      sizeLabel
    )}</p>
        <p>${explanation}</p>
        <div class="external-actions">
          <a class="buttonish primary" data-action="open-ia" href="${this._escapeHtml(
            href
          )}" target="_blank" rel="noopener noreferrer">Download from Internet Archive</a>
          <button type="button" class="primary" data-action="load-local">I have the file — load it</button>
          <button type="button" data-action="back-list">Back to list</button>
        </div>
      </div>
    `;

    contentArea.querySelector('[data-action="back-list"]')?.addEventListener('click', restoreList);
    contentArea.querySelector('[data-action="load-local"]')?.addEventListener('click', () => {
      this.closeBrowser();
      const input = document.getElementById('romFileInput');
      if (input) input.click();
    });
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

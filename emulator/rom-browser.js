// <rom-browser> web component for the unified emulator shell.
//
// Reads the active console either from a `console="nes"` attribute or
// from `window.getEmulatorConsole()` (resolved off `?console=`). When
// a console has no Internet Archive collection wired up, the element
// hides itself so the boot card just shows the local-file picker.
//
// Picking a result plays it in the page and writes `?rom=<name>` so the
// browser Back button returns to this list. Disc collections marked
// iaExternalDownload without iaAllowInBrowser (Sega CD, Saturn) open the
// download handoff instead — those images are too large to stream.
//
// Lean-back (TV): cards are focusable with roving tabindex, and search is
// demoted behind a toggle. The list is inline on the boot card.
//
// GBA's Archive item is ~3,500 zips. Painting every card at once stalls
// the tab, so the list opens a window and grows when asked.
const ROM_PAGE_SIZE = 48;

// Apostrophes are removed; other punctuation becomes a space so
// "zelda links" and "zeldas awakening" both meet "Link's Awakening".
const normalizeSearchText = (value) =>
  String(value ?? '')
    .toLowerCase()
    .replace(/['’ʼ`´]/g, '')
    .replace(/[:\-_.,!?&/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

class RomBrowserElement extends HTMLElement {
  constructor() {
    super();
    this.allRoms = [];
    this.filteredRoms = [];
    this._romRoving = null;
    this._onModalKey = null;
    this._romLoadController = null;
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
    const acquire = window.emulatorRomAcquire;
    if (!cfg || !acquire || typeof acquire.createIaClient !== 'function') return null;
    this._ia = acquire.createIaClient(cfg);
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
    if (this._onTitleScroll) window.removeEventListener('scroll', this._onTitleScroll, true);
    if (this._romLoadController) this._romLoadController.abort();
    this.closeBrowser();
  }

  render() {
    const cfg = this.consoleConfig;
    // Hide the component entirely if we don't have an IA collection to
    // browse. Boot card falls back to the local-file picker which is
    // always there.
    if (!cfg || !cfg.iaBaseUrl) {
      this.hidden = true;
      this.shadowRoot.innerHTML = '';
      return;
    }
    this.hidden = false;

    const tv = this.isTv;
    const isDisc = !!cfg.iaExternalDownload;
    const downloadOnly = isDisc && !cfg.iaAllowInBrowser;

    // All chrome reads from /brand.css through the host page; identity
    // colors (`--accent-bright`, `--accent-gold`) are set on `:root` by
    // launch.js based on the active console. CSS custom properties
    // inherit through shadow DOM, so this whole component re-tints
    // automatically when the console changes.
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; width: 100%; }
        .library-pin {
          position: sticky;
          top: 0;
          z-index: 2;
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px 12px;
          background: var(--card-bg);
          padding-bottom: 8px;
        }
        .library-head {
          flex: 1 1 140px;
          min-width: 0;
          margin: 0;
        }
        .library-title {
          /* Headings use brand text tokens — console accents (PS1 navy /
           * SNES deep purple) fail AA on dark surfaces. */
          font-size: 0.95rem;
          font-weight: 700;
          color: var(--text-1);
          margin: 0;
        }
        .library-sub {
          margin: 0;
          color: var(--text-2);
          font-size: 0.8rem;
          line-height: 1.3;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .library-tools {
          display: flex;
          gap: 0.5rem;
          align-items: center;
          flex: 1 1 180px;
          margin: 0;
        }
        .library-tools .search-container { flex: 1; margin: 0; }
        .search-toggle {
          background: var(--surface-2);
          color: var(--text-1);
          font-weight: bold;
          padding: 0.75rem 2rem;
          border-radius: 0.75rem;
          border: 1px solid var(--hairline-strong);
          cursor: pointer;
          transition: background-color 0.2s, transform 0.2s;
        }
        .search-toggle:hover { background: var(--accent-primary-soft); transform: scale(1.05); }
        .search-toggle:focus-visible {
          outline: 4px solid var(--accent-bright);
          outline-offset: 3px;
        }
        .content-area { min-height: 8rem; }
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
          grid-template-columns: repeat(auto-fill, minmax(${tv ? '200px' : '168px'}, 1fr));
          gap: ${tv ? '14px' : '12px'};
          padding: 2px 0 12px;
          align-items: stretch;
        }
        .rom-card {
          appearance: none;
          display: flex;
          flex-direction: column;
          width: 100%;
          min-width: 0;
          height: 100%;
          margin: 0;
          box-sizing: border-box;
          background: var(--surface-2);
          border: 1px solid var(--hairline-strong);
          border-radius: 12px;
          padding: ${tv ? '12px' : '10px'};
          box-shadow: var(--shadow-card);
          color: inherit;
          font: inherit;
          text-align: left;
          cursor: pointer;
          transition: border-color 0.2s, transform 0.2s, background-color 0.2s;
        }
        .rom-card:hover {
          background: var(--accent-bright-soft);
          border-color: var(--accent-bright);
          transform: translateY(-2px);
        }
        .rom-card:focus-visible {
          outline: 4px solid var(--accent-bright);
          outline-offset: 3px;
          background: var(--accent-bright-soft);
          border-color: var(--accent-bright);
        }
        .rom-art-frame {
          display: grid;
          place-items: center;
          aspect-ratio: 4 / 3;
          margin: 0 0 8px;
          border-radius: 8px;
          overflow: hidden;
          background:
            linear-gradient(160deg, var(--accent-bright-soft), var(--surface-0));
        }
        .rom-art {
          display: block;
          width: 100%;
          height: 100%;
          object-fit: contain;
          background: transparent;
        }
        /* Stay out of the layout until the image actually loads. Eager
           fetch still runs: loading=lazy plus display:none never starts.
           The frame keeps the grid aligned while the file is in flight. */
        .rom-art[hidden] { display: none !important; }
        .rom-title {
          font-weight: 700;
          color: var(--text-1);
          margin-bottom: 2px;
          font-size: ${tv ? '1.15rem' : '0.95rem'};
          line-height: 1.25;
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
          overflow: hidden;
        }
        .rom-variant {
          color: var(--text-2);
          font-size: ${tv ? '0.95rem' : '0.75rem'};
          font-weight: 600;
          line-height: 1.3;
          margin-bottom: 4px;
        }
        .rom-title-pop {
          position: fixed;
          z-index: 40;
          max-width: min(22rem, calc(100vw - 16px));
          margin: 0;
          padding: 8px 10px;
          border-radius: 8px;
          border: 1px solid var(--accent-bright);
          background: var(--surface-0);
          color: var(--text-1);
          box-shadow: var(--shadow-card);
          font-size: 0.95rem;
          font-weight: 700;
          line-height: 1.35;
          pointer-events: none;
          overflow-wrap: anywhere;
        }
        .rom-title-pop[hidden] { display: none !important; }
        .rom-info {
          color: var(--text-2);
          font-size: 0.75rem;
          line-height: 1.35;
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
          overflow: hidden;
        }
        .rom-size {
          color: var(--text-3);
          font-size: 0.7rem;
          margin-top: 4px;
        }
        .play-count {
          color: var(--text-3);
          font-size: 0.7rem;
          font-weight: 600;
          margin-top: 4px;
          font-variant-numeric: tabular-nums;
        }
        ${
          tv
            ? ''
            : `@media (max-width: 480px) {
          .rom-grid {
            grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
            gap: 8px;
          }
          .rom-card {
            padding: 6px;
            border-radius: 10px;
          }
          .rom-art-frame {
            margin-bottom: 6px;
            border-radius: 6px;
          }
          .rom-title {
            font-size: 0.75rem;
            margin-bottom: 0;
          }
          .rom-info,
          .rom-size {
            display: none;
          }
        }`
        }
        .rom-more {
          display: block;
          margin: 16px auto 8px;
          padding: 10px 16px;
          border-radius: 4px;
          border: 1px solid var(--hairline, #444);
          background: transparent;
          color: inherit;
          font: inherit;
          cursor: pointer;
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
        .visually-hidden {
          position: absolute;
          width: 1px;
          height: 1px;
          padding: 0;
          margin: -1px;
          overflow: hidden;
          clip: rect(0, 0, 0, 0);
          white-space: nowrap;
          border: 0;
        }
      </style>

      <div class="library">
        <div class="library-pin">
        <div class="library-head">
          <h2 class="library-title" id="romBrowserTitle">${cfg.title} collection</h2>
          <p class="library-sub">${
            downloadOnly
              ? 'Download a disc, then load the saved file.'
              : 'Pick a game, or load a file you already have.'
          }</p>
        </div>
        <div class="library-tools">
          <div class="search-container" id="searchContainer" ${tv ? 'hidden' : ''}>
            <input type="text" class="search-input" id="searchInput" placeholder="Search games..." aria-label="Search games">
          </div>
          ${
            tv
              ? '<button class="search-toggle" id="searchToggleBtn" type="button" aria-expanded="false" aria-controls="searchContainer">Search</button>'
              : ''
          }
        </div>
        </div>
        <p id="searchStatus" class="visually-hidden" role="status" aria-live="polite"></p>
        <div class="content-area" id="contentArea">
          <div class="loading">Loading ROM collection...</div>
        </div>
      </div>
    `;
    this._ensureTitlePop();
  }

  /**
   * Region and revision sit at the end of a No-Intro name. Pull them out
   * so the card can show them under the clamped title.
   * @param {string} title
   * @returns {{ name: string, variant: string }}
   */
  _titleParts(title) {
    const text = String(title || '').trim();
    const groups = [];
    let rest = text;
    let match = rest.match(/^(.*)\s*(\([^)]*\))\s*$/);
    while (match) {
      groups.unshift(match[2]);
      rest = match[1].trim();
      match = rest.match(/^(.*)\s*(\([^)]*\))\s*$/);
    }
    if (!rest || groups.length === 0) return { name: text, variant: '' };
    return { name: rest, variant: groups.join(' ') };
  }

  _titleClipped(el) {
    if (!el) return false;
    return el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1;
  }

  _hideTitlePop() {
    if (!this._titlePop) return;
    this._titlePop.hidden = true;
    this._titlePopCard = null;
  }

  _placeTitlePop(card) {
    const pop = this._titlePop;
    if (!pop || pop.hidden || !card) return;
    const rect = card.getBoundingClientRect();
    const margin = 8;
    pop.style.maxWidth = Math.min(352, window.innerWidth - margin * 2) + 'px';
    pop.style.left = '0px';
    pop.style.top = '0px';
    const popRect = pop.getBoundingClientRect();
    let left = rect.left;
    if (left + popRect.width > window.innerWidth - margin) {
      left = window.innerWidth - margin - popRect.width;
    }
    left = Math.max(margin, left);
    let top = rect.bottom + 6;
    if (top + popRect.height > window.innerHeight - margin) {
      top = rect.top - popRect.height - 6;
    }
    if (top < margin) top = margin;
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  }

  _showTitlePop(card) {
    const pop = this._titlePop;
    const full = card && card.dataset.fullTitle;
    const titleEl = card && card.querySelector('.rom-title');
    const needsPop =
      !!card && (this._titleClipped(titleEl) || !!card.querySelector('.rom-variant'));
    if (!pop || !full || !needsPop) {
      if (this._titlePopCard === card) this._hideTitlePop();
      return;
    }
    pop.textContent = full;
    pop.hidden = false;
    this._titlePopCard = card;
    this._placeTitlePop(card);
  }

  _ensureTitlePop() {
    let pop = this.shadowRoot.querySelector('.rom-title-pop');
    if (!pop) {
      pop = document.createElement('div');
      pop.className = 'rom-title-pop';
      pop.hidden = true;
      pop.setAttribute('role', 'tooltip');
      this.shadowRoot.appendChild(pop);
    }
    this._titlePop = pop;
    if (this._titlePopBound) return;
    this._titlePopBound = true;

    const cardFrom = (event) => {
      const target = event.target;
      if (!target || typeof target.closest !== 'function') return null;
      return target.closest('.rom-card');
    };

    this.shadowRoot.addEventListener('pointerover', (event) => {
      const card = cardFrom(event);
      if (!card || card === this._titlePopCard) return;
      this._showTitlePop(card);
    });
    this.shadowRoot.addEventListener('pointerout', (event) => {
      const card = cardFrom(event);
      if (!card || this._titlePopCard !== card) return;
      const next = event.relatedTarget;
      if (next && typeof next.closest === 'function' && next.closest('.rom-card') === card) return;
      if (this.shadowRoot.activeElement === card) return;
      this._hideTitlePop();
    });
    this.shadowRoot.addEventListener('focusin', (event) => {
      const card = cardFrom(event);
      if (card) this._showTitlePop(card);
    });
    this.shadowRoot.addEventListener('focusout', (event) => {
      const card = cardFrom(event);
      if (card && this._titlePopCard === card) this._hideTitlePop();
    });
    this._onTitleScroll = () => this._hideTitlePop();
    window.addEventListener('scroll', this._onTitleScroll, true);
  }

  init() {
    const searchInput = this.shadowRoot.getElementById('searchInput');
    if (!searchInput) return;

    const searchToggle = this.shadowRoot.getElementById('searchToggleBtn');
    if (searchToggle) {
      searchToggle.addEventListener('click', () => {
        const box = this.shadowRoot.getElementById('searchContainer');
        if (!box) return;
        const show = box.hasAttribute('hidden');
        if (show) box.removeAttribute('hidden');
        else box.setAttribute('hidden', '');
        searchToggle.setAttribute('aria-expanded', show ? 'true' : 'false');
        if (show) {
          searchInput.focus();
        } else {
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

    if (this.iaClient) this.openBrowser();
  }

  /**
   * Load the collection and paint the cards. A second call joins the
   * request already in flight.
   */
  openBrowser() {
    if (this.allRoms.length > 0) {
      this.filteredRoms = [...this.allRoms];
      this.renderRoms(this.filteredRoms);
      return Promise.resolve();
    }
    if (!this._openPromise) {
      this._openPromise = this.loadAllRoms().finally(() => {
        this._openPromise = null;
      });
    }
    return this._openPromise;
  }

  /** Drop TV focus tracking. The list stays on the page. */
  closeBrowser() {
    if (this._romRoving) {
      this._romRoving.dispose();
      this._romRoving = null;
    }
  }

  _usesGamesSheet() {
    const sheet = window.emulatorGamesSheet;
    return !!(sheet && typeof sheet.isConfigured === 'function' && sheet.isConfigured());
  }

  _bustListCache() {
    const sheet = window.emulatorGamesSheet;
    if (this._usesGamesSheet() && sheet && typeof sheet.clearCache === 'function') {
      sheet.clearCache(this.consoleId);
    }
    if (this.iaClient) this.iaClient.clearListCache();
  }

  async loadAllRoms() {
    const contentArea = this.shadowRoot.getElementById('contentArea');
    contentArea.innerHTML =
      '<div class="loading">Loading ROM collection…' +
      '<div class="loading-hint">This can take a minute on slow connections.</div></div>';

    try {
      const fromSheet = this._usesGamesSheet();
      const ia = this.iaClient;
      if (!fromSheet && !ia) {
        throw new Error('ROM browser is not configured for this console.');
      }

      const systems = this.consoleConfig && this.consoleConfig.iaThumbnailSystems;
      const acquire = window.emulatorRomAcquire;
      // The sheet already stores box-art URLs, so skip the libretro name
      // index. The live Archive listing still needs it for fuzzy matches.
      const preloadIndexes = () =>
        acquire && typeof acquire.preloadThumbnailIndexes === 'function'
          ? acquire.preloadThumbnailIndexes(systems)
          : Promise.resolve();
      let indexPromise = fromSheet ? Promise.resolve() : preloadIndexes();
      const sheet = window.emulatorGamesSheet;
      if (fromSheet) {
        try {
          this.allRoms = await sheet.loadConsoleGames(this.consoleId, {
            descriptionPrefix: this.consoleConfig && this.consoleConfig.iaDescriptionPrefix
          });
        } catch (err) {
          if (!ia) throw err;
          console.warn('Games sheet unavailable; listing Internet Archive instead.', err);
          indexPromise = preloadIndexes();
          this.allRoms = await ia.fetchRomList();
        }
      } else {
        this.allRoms = await ia.fetchRomList();
      }
      await indexPromise;
      this.filteredRoms = [...this.allRoms];

      if (this.allRoms.length === 0) {
        contentArea.innerHTML =
          '<div class="error">No ROMs found. Check your connection and try again.' +
          '<div class="error-actions"><button type="button" class="primary" data-action="retry-list">Retry</button></div></div>';
        contentArea.querySelector('[data-action="retry-list"]')?.addEventListener('click', () => {
          this._bustListCache();
          this.allRoms = [];
          this.loadAllRoms();
        });
        return;
      }

      this.renderRoms(this.filteredRoms);
    } catch (error) {
      console.error('Error loading ROMs:', error);
      contentArea.innerHTML =
        '<div class="error">Could not load the game list.' +
        '<div class="error-detail">Try again in a moment.</div>' +
        '<div class="error-actions"><button type="button" class="primary" data-action="retry-list">Retry</button></div></div>';
      contentArea.querySelector('[data-action="retry-list"]')?.addEventListener('click', () => {
        this._bustListCache();
        this.allRoms = [];
        this.loadAllRoms();
      });
    }
  }

  /**
   * Hidden box-art image for this ROM. Stays out of the card until it loads.
   * A 404 advances to the next playlist, then the image is removed.
   * @param {{ name?: string }} rom
   * @returns {HTMLImageElement|null}
   */
  _romArt(rom) {
    const acquire = window.emulatorRomAcquire;
    const systems = this.consoleConfig && this.consoleConfig.iaThumbnailSystems;
    const resolve =
      acquire &&
      (typeof acquire.thumbnailUrlsResolved === 'function'
        ? acquire.thumbnailUrlsResolved
        : acquire.thumbnailUrls);
    const fallback = resolve ? resolve(systems, rom && rom.name) : [];
    const direct = rom && typeof rom.thumbnailUrl === 'string' ? rom.thumbnailUrl : '';
    const urls = direct ? [direct].concat(fallback.filter((url) => url !== direct)) : fallback;
    if (!urls.length) return null;

    const img = document.createElement('img');
    img.className = 'rom-art';
    img.alt = '';
    img.hidden = true;
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    let index = 0;
    img.addEventListener('load', () => {
      img.hidden = false;
    });
    img.addEventListener('error', () => {
      index += 1;
      if (index >= urls.length) {
        img.remove();
        return;
      }
      img.hidden = true;
      img.src = urls[index];
    });
    img.src = urls[0];
    return img;
  }

  _escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  _deepActive() {
    let active = document.activeElement;
    let guard = 0;
    while (active && active.shadowRoot && active.shadowRoot.activeElement && guard < 8) {
      active = active.shadowRoot.activeElement;
      guard += 1;
    }
    return active || null;
  }

  // The first paint is the one chance to place focus. A later repaint
  // must not pull it back. Typing in the search field is left alone.
  // On TV, a control this repaint removed still needs a card under the
  // remote, so focus moves to the first card.
  _focusGameList(card) {
    if (!card || this._listFocused) return;
    this._listFocused = true;
    const active = this._deepActive();
    if (active === this.shadowRoot.getElementById('searchInput')) return;
    const placeholder =
      !active ||
      active === document.body ||
      active === document.documentElement ||
      active.id === 'loadRomBtn' ||
      (active.classList && active.classList.contains('heyming-nav-toggle'));
    const remote = window.heymingRemote;
    if (remote && typeof remote.focusIfIdle === 'function') {
      remote.focusIfIdle(card, placeholder, true);
      return;
    }
    if (!placeholder) return;
    try {
      card.focus({ preventScroll: true, focusVisible: true });
    } catch (err) {
      card.focus();
    }
  }

  renderRoms(roms) {
    this._romWindow = roms;
    this._romShown = ROM_PAGE_SIZE;
    this._paintRomWindow();
  }

  _paintRomWindow() {
    this._hideTitlePop();
    const prior = this._deepActive();
    const roms = this._romWindow || [];
    const shown = roms.slice(0, this._romShown);
    const contentArea = this.shadowRoot.getElementById('contentArea');
    if (!contentArea) return;
    const focusWasInList = !!(prior && contentArea.contains(prior));
    if (this._romRoving) {
      this._romRoving.dispose();
      this._romRoving = null;
    }

    const romGrid = document.createElement('div');
    romGrid.className = 'rom-grid';

    shown.forEach((rom) => {
      const romCard = document.createElement('button');
      romCard.type = 'button';
      romCard.className = 'rom-card';
      const fullTitle = String(rom.title || '');
      const parts = this._titleParts(fullTitle);
      const title = this._escapeHtml(parts.name);
      const variant = this._escapeHtml(parts.variant);
      const description = this._escapeHtml(rom.description);
      const size = this._escapeHtml(rom.size);
      romCard.dataset.fullTitle = fullTitle;
      if (fullTitle) romCard.setAttribute('aria-label', fullTitle);

      const sameAsTitle =
        rom.description === rom.title ||
        (rom.title && String(rom.description || '').endsWith(`: ${rom.title}`));
      romCard.innerHTML = `
        <div class="rom-title">${title}</div>
        ${variant ? `<div class="rom-variant">${variant}</div>` : ''}
        ${sameAsTitle ? '' : `<div class="rom-info">${description}</div>`}
        <div class="rom-size">${size}</div>
      `;
      const frame = document.createElement('div');
      frame.className = 'rom-art-frame';
      const art = this._romArt(rom);
      if (art) frame.appendChild(art);
      romCard.prepend(frame);
      romCard.addEventListener('click', () => this.loadRom(rom));
      romGrid.appendChild(romCard);
    });

    contentArea.innerHTML = '';
    contentArea.appendChild(romGrid);

    if (shown.length < roms.length) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'rom-more';
      more.dataset.action = 'show-more';
      more.textContent = `Show more (${shown.length} of ${roms.length})`;
      more.addEventListener('click', () => {
        this._romShown += ROM_PAGE_SIZE;
        this._paintRomWindow();
      });
      contentArea.appendChild(more);
    }

    const lb = window.emulatorLeanback;
    const firstCard = romGrid.querySelector('.rom-card');
    const lostListFocus = focusWasInList && !prior.isConnected;
    if (lb && typeof lb.applyRovingTabindex === 'function') {
      this._romRoving = lb.applyRovingTabindex(romGrid, {
        selector: '.rom-card'
      });
      if (this.isTv && lostListFocus) this._romRoving.focusFirst();
      else if (!this.isTv) this._focusGameList(firstCard);
    } else if (this.isTv) {
      if (lostListFocus && firstCard) firstCard.focus({ preventScroll: false });
    } else {
      this._focusGameList(firstCard);
    }

    if (window.heymingCounts && typeof window.heymingCounts.paintShadow === 'function') {
      window.heymingCounts.paintShadow(this.shadowRoot);
    }

    if (firstCard && !this._romListReady) {
      this._romListReady = true;
      this.dispatchEvent(new CustomEvent('rom-list-ready', { bubbles: true }));
    }
  }

  async loadRom(rom) {
    this._hideTitlePop();
    if (typeof window.emulatorPushRomQuery === 'function') window.emulatorPushRomQuery(rom);
    const contentArea = this.shadowRoot.getElementById('contentArea');
    const restoreList = () => {
      if (typeof window.emulatorClearRomQuery === 'function') window.emulatorClearRomQuery();
      this.renderRoms(this.filteredRoms.length ? this.filteredRoms : this.allRoms);
    };

    const cfg = this.consoleConfig;
    if (cfg && typeof window.trackEmulatorGame === 'function') {
      window.trackEmulatorGame(cfg.id, rom.title || rom.name);
    }
    // Recording the play loads a script. The click must not wait on it.
    if (cfg) {
      const analytics = window.heymingAnalytics;
      const ready =
        analytics && typeof analytics.enable === 'function'
          ? analytics.enable('play-counts')
          : undefined;
      Promise.resolve(ready).then(() => {
        const counts = window.heymingCounts;
        if (counts && typeof counts.recordEmulatorPlay === 'function') {
          counts.recordEmulatorPlay(cfg.id, rom.title || rom.name);
        }
      });
    }
    if (cfg && cfg.iaExternalDownload && !cfg.iaAllowInBrowser) {
      this.showExternalDownload(rom, restoreList);
      return;
    }

    if (this._romLoadController) this._romLoadController.abort();
    const controller = new AbortController();
    this._romLoadController = controller;

    try {
      if (contentArea) {
        contentArea.innerHTML =
          `<div class="loading">Loading ${this._escapeHtml(rom.title)}…` +
          '<div class="loading-hint">Large games can take a minute.</div>' +
          '<div class="error-actions"><button type="button" data-action="cancel-rom">Cancel — back to game list</button></div></div>';
        contentArea.querySelector('[data-action="cancel-rom"]')?.addEventListener('click', () => {
          controller.abort();
          restoreList();
        });
      }

      const ia = this.iaClient;
      if (!ia) {
        throw new Error('ROM source unavailable.');
      }

      const romData = await ia.loadRom(rom, { signal: controller.signal });
      if (controller.signal.aborted) return;

      // Wrap in a File so EmulatorJS sees a real filename — libretro cores
      // detect format from the suffix. Shared helper keeps deep-link and
      // browser paths identical.
      const acquire = window.emulatorRomAcquire;
      const romFile =
        acquire && typeof acquire.fileFromRomBytes === 'function'
          ? acquire.fileFromRomBytes(romData, rom)
          : new File([romData], `${rom.title}${rom.fileExtension || '.zip'}`, {
              type:
                (rom.fileExtension || '.zip') === '.zip'
                  ? 'application/zip'
                  : 'application/octet-stream'
            });

      this.closeBrowser();

      if (typeof window.launchEmulator === 'function') {
        window.launchEmulator(romFile, romFile.name, { tracked: true });
      } else {
        console.error('launchEmulator not available on window');
        alert('Emulator not ready. Please reload the page and try again.');
      }
    } catch (error) {
      if (controller.signal.aborted || (error && error.name === 'AbortError')) return;
      console.error('Error loading ROM:', error);
      const canDownload = !!(cfg && cfg.iaBaseUrl && rom.downloadUrl);
      const downloadAction = canDownload
        ? `<a class="primary" href="${this._escapeHtml(
            rom.downloadUrl
          )}" target="_blank" rel="noopener noreferrer">Download instead</a>` +
          '<button type="button" data-action="load-local">Load saved ROM</button>'
        : '';
      if (contentArea) {
        contentArea.innerHTML =
          `<div class="error">Could not load ${this._escapeHtml(rom.title)}.` +
          '<div class="error-detail">Try again, or download the file and load it from your device.</div>' +
          '<div class="error-actions">' +
          '<button type="button" class="primary" data-action="retry-rom">Try again</button>' +
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
        alert('Could not load this game. Try again or load a saved file.');
      }
    } finally {
      if (this._romLoadController === controller) this._romLoadController = null;
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
      ? `${this._escapeHtml(
          cfg.title
        )} discs are too large to load in the page. Download from Internet Archive in a new tab, then load the saved file here. Chromebooks with little disk space may not have room.`
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
    const t = normalizeSearchText(text);
    const q = normalizeSearchText(query);
    if (!q) return 0;

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

  _announceSearchCount(count) {
    const status = this.shadowRoot && this.shadowRoot.getElementById('searchStatus');
    if (!status || !this.allRoms.length) return;
    status.textContent = count === 1 ? '1 result' : `${count} results`;
  }

  handleSearch(query) {
    if (!normalizeSearchText(query)) {
      this.filteredRoms = [...this.allRoms];
    } else {
      const scored = this.allRoms
        .map((rom) => ({
          rom,
          score: Math.max(this.fuzzyScore(rom.title, query), this.fuzzyScore(rom.name, query))
        }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score);

      this.filteredRoms = scored.map(({ rom }) => rom);
    }
    this.renderRoms(this.filteredRoms);
    this._announceSearchCount(this.filteredRoms.length);
  }
}

customElements.define('rom-browser', RomBrowserElement);
window.RomBrowserElement = RomBrowserElement;

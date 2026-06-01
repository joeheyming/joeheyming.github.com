// <piano-hero-song-browser> — modal song picker.
//
// Three tabs:
//   1. Curated  — quick-pick buttons fed from curated-songs.json
//   2. Internet Archive — search box that hits archive.org's
//      advancedsearch.php (CORS-friendly) for items containing MIDI files,
//      then resolves the actual .mid filename via /metadata/{id}
//   3. Open file — drag/drop hint + a "Choose file" button
//
// Recent picks are persisted to localStorage so the browser remembers
// what the user last loaded. Search is debounced and cancellable via
// AbortController so rapid typing doesn't pile up requests.
//
// Modeled on stepmania/js/zenius-browser.js.

import midiManager from './midi-manager.js';

const RECENT_KEY = 'piano-hero.recent.v1';
const RECENT_LIMIT = 8;
const SEARCH_DEBOUNCE_MS = 300;

const IA_SEARCH_URL = (q) =>
  `https://archive.org/advancedsearch.php?q=${encodeURIComponent(
    q + ' AND format:MIDI'
  )}&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=description&output=json&rows=24`;

const IA_METADATA_URL = (id) => `https://archive.org/metadata/${encodeURIComponent(id)}`;
const IA_DOWNLOAD_URL = (id, file) =>
  `https://archive.org/download/${encodeURIComponent(id)}/${file
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;

// ---------- Recent-songs persistence ------------------------------------

function loadRecent() {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((r) => r && typeof r.label === 'string');
  } catch (_) {
    return [];
  }
}

function saveRecent(entry) {
  try {
    const list = loadRecent().filter((r) => r.key !== entry.key);
    list.unshift(entry);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_LIMIT)));
  } catch (_) {
    /* localStorage may be disabled — silent no-op */
  }
}

// ---------- The web component -------------------------------------------

class SongBrowserElement extends HTMLElement {
  /** @type {SongBrowserElement | null} */
  static _instance = null;

  static get() {
    if (!SongBrowserElement._instance) {
      SongBrowserElement._instance = document.querySelector('piano-hero-song-browser');
    }
    return SongBrowserElement._instance;
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    /** @type {AbortController | null} */
    this._searchAbort = null;
    this._searchDebounce = null;
    this._curated = null;
    /** Set by the engine via `setOnError`. */
    this._onError = null;
    /** Save handler bound for outside-click close. */
    this._onBackdropClick = (ev) => {
      if (ev.target === this._backdrop) this.close();
    };
    /** Esc-to-close handler. */
    this._onKeyDown = (ev) => {
      if (ev.key === 'Escape' && !this.hidden) this.close();
    };
  }

  connectedCallback() {
    this.render();
    this.bindEvents();
    this.hidden = true;
    this._loadCurated();
    this._renderRecent();
  }

  disconnectedCallback() {
    if (this._searchAbort) this._searchAbort.abort();
    document.removeEventListener('keydown', this._onKeyDown);
  }

  setOnError(fn) {
    this._onError = fn;
  }

  open() {
    this.hidden = false;
    document.addEventListener('keydown', this._onKeyDown);
    requestAnimationFrame(() => {
      const search = this.shadowRoot.getElementById('search-input');
      if (search) search.focus();
    });
  }

  close() {
    this.hidden = true;
    document.removeEventListener('keydown', this._onKeyDown);
  }

  // ---------- Rendering ------------------------------------------------

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        :host([hidden]) { display: none; }
        .backdrop {
          position: fixed; inset: 0;
          background: rgba(15, 23, 42, 0.8);
          backdrop-filter: blur(4px);
          -webkit-backdrop-filter: blur(4px);
          z-index: 999995;
          display: flex; align-items: center; justify-content: center;
          padding: 24px;
        }
        .modal {
          width: min(720px, 100%);
          max-height: calc(100vh - 48px);
          background: #0f172a;
          color: #e2e8f0;
          border-radius: 14px;
          border: 1px solid #1e293b;
          box-shadow: 0 30px 60px -10px rgba(0,0,0,0.6);
          display: flex; flex-direction: column;
          overflow: hidden;
          font-family: system-ui, -apple-system, "Inter", sans-serif;
        }
        header {
          display: flex; align-items: center; gap: 12px;
          padding: 14px 18px;
          border-bottom: 1px solid #1e293b;
        }
        header h2 {
          margin: 0; font-size: 16px; font-weight: 700;
          flex: 1;
        }
        button.close {
          background: transparent; color: #94a3b8;
          border: 1px solid #334155; border-radius: 8px;
          padding: 4px 10px; cursor: pointer;
          font-size: 13px;
        }
        button.close:hover { color: #e2e8f0; border-color: #475569; }

        .tabs {
          display: flex; gap: 4px; padding: 0 16px;
          border-bottom: 1px solid #1e293b;
        }
        .tab {
          background: transparent; color: #94a3b8;
          border: none; padding: 10px 14px;
          font-size: 13px; font-weight: 600;
          cursor: pointer;
          border-bottom: 2px solid transparent;
          transition: color 120ms ease, border-color 120ms ease;
        }
        .tab:hover { color: #cbd5e1; }
        .tab[aria-selected="true"] {
          color: #e2e8f0;
          border-bottom-color: #6366f1;
        }

        .panel {
          padding: 16px 18px;
          overflow-y: auto;
          flex: 1;
        }
        .panel[hidden] { display: none; }

        .grid {
          display: grid; gap: 10px;
          grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        }
        .card {
          background: #1e293b;
          border: 1px solid #334155;
          border-radius: 10px;
          padding: 12px 14px;
          text-align: left;
          color: #e2e8f0;
          cursor: pointer;
          font: inherit;
          transition: transform 120ms ease, border-color 120ms ease;
        }
        .card:hover, .card:focus-visible {
          border-color: #6366f1; transform: translateY(-1px);
          outline: none;
        }
        .card .title { font-weight: 700; font-size: 14px; margin-bottom: 2px; }
        .card .meta  { font-size: 12px; color: #94a3b8; }
        .card .blurb { font-size: 12px; color: #cbd5e1; margin-top: 6px; line-height: 1.4; }

        .search-row { display: flex; gap: 8px; margin-bottom: 14px; }
        .search-row input {
          flex: 1; background: #1e293b; color: #e2e8f0;
          border: 1px solid #334155; border-radius: 8px;
          padding: 8px 12px; font: inherit;
        }
        .search-row input:focus {
          outline: none; border-color: #6366f1;
        }
        .status { font-size: 13px; color: #94a3b8; padding: 8px 0; }
        .status.error { color: #f87171; }

        .recent-section { margin-top: 18px; }
        .section-label {
          font-size: 11px; font-weight: 700; text-transform: uppercase;
          letter-spacing: 0.08em; color: #94a3b8; margin: 0 0 8px;
        }
        .chips { display: flex; flex-wrap: wrap; gap: 6px; }
        .chip {
          background: #1e293b; color: #cbd5e1;
          border: 1px solid #334155; border-radius: 999px;
          padding: 4px 12px; font-size: 12px; cursor: pointer;
        }
        .chip:hover { border-color: #6366f1; color: #e2e8f0; }

        .open-pane {
          display: flex; flex-direction: column; align-items: center; gap: 14px;
          padding: 24px 12px;
        }
        .open-pane .icon { font-size: 48px; line-height: 1; }
        .open-pane .copy { color: #cbd5e1; text-align: center; max-width: 360px; line-height: 1.5; }
        .open-pane button {
          background: #6366f1; color: white; border: none;
          padding: 10px 20px; border-radius: 8px; cursor: pointer;
          font: inherit; font-weight: 600;
        }
        .open-pane button:hover { background: #4f46e5; }
      </style>
      <div class="backdrop" part="backdrop">
        <div class="modal" role="dialog" aria-modal="true" aria-label="Pick a song">
          <header>
            <h2>Pick a song</h2>
            <button class="close" type="button" aria-label="Close">Close</button>
          </header>
          <nav class="tabs" role="tablist">
            <button class="tab" data-tab="curated" role="tab" aria-selected="true">Curated</button>
            <button class="tab" data-tab="ia" role="tab" aria-selected="false">Internet Archive</button>
            <button class="tab" data-tab="file" role="tab" aria-selected="false">Open file</button>
          </nav>
          <section class="panel" id="panel-curated" role="tabpanel">
            <div id="recent-section" class="recent-section" hidden>
              <p class="section-label">Recent</p>
              <div id="recent-chips" class="chips"></div>
            </div>
            <p class="section-label">Curated</p>
            <div id="curated-grid" class="grid"></div>
            <p id="curated-status" class="status" hidden></p>
          </section>
          <section class="panel" id="panel-ia" role="tabpanel" hidden>
            <div class="search-row">
              <input
                id="search-input" type="search"
                placeholder="Search Internet Archive (e.g. Bach, Chopin, Joplin)"
                autocomplete="off" />
            </div>
            <p id="search-status" class="status" hidden></p>
            <div id="search-grid" class="grid"></div>
          </section>
          <section class="panel" id="panel-file" role="tabpanel" hidden>
            <div class="open-pane">
              <div class="icon" aria-hidden="true">🎼</div>
              <div class="copy">
                Drop a <strong>.mid</strong> or <strong>.midi</strong> file anywhere on the page,
                or pick one from your computer.
              </div>
              <button id="pick-file" type="button">Choose file…</button>
            </div>
          </section>
        </div>
      </div>
    `;

    this._backdrop = this.shadowRoot.querySelector('.backdrop');
  }

  bindEvents() {
    const root = this.shadowRoot;
    root.querySelector('.close').addEventListener('click', () => this.close());
    this._backdrop.addEventListener('click', this._onBackdropClick);

    for (const tab of root.querySelectorAll('.tab')) {
      tab.addEventListener('click', () => this._activateTab(tab.dataset.tab));
    }

    const searchInput = root.getElementById('search-input');
    searchInput.addEventListener('input', () => {
      const q = searchInput.value.trim();
      clearTimeout(this._searchDebounce);
      if (this._searchAbort) {
        this._searchAbort.abort();
        this._searchAbort = null;
      }
      if (!q) {
        this._renderSearchResults([], '');
        return;
      }
      this._setStatus('search-status', 'Searching…');
      this._searchDebounce = setTimeout(() => this._runSearch(q), SEARCH_DEBOUNCE_MS);
    });
    searchInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        clearTimeout(this._searchDebounce);
        const q = searchInput.value.trim();
        if (this._searchAbort) this._searchAbort.abort();
        if (q) this._runSearch(q);
      }
    });

    root.getElementById('pick-file').addEventListener('click', () => {
      const input = document.getElementById('file-picker-input');
      if (input) input.click();
      this.close();
    });
  }

  _activateTab(name) {
    const root = this.shadowRoot;
    for (const tab of root.querySelectorAll('.tab')) {
      const sel = tab.dataset.tab === name;
      tab.setAttribute('aria-selected', String(sel));
    }
    root.getElementById('panel-curated').hidden = name !== 'curated';
    root.getElementById('panel-ia').hidden = name !== 'ia';
    root.getElementById('panel-file').hidden = name !== 'file';
    if (name === 'ia') {
      requestAnimationFrame(() => root.getElementById('search-input').focus());
    }
  }

  // ---------- Curated tab ---------------------------------------------

  async _loadCurated() {
    const grid = this.shadowRoot.getElementById('curated-grid');
    const status = this.shadowRoot.getElementById('curated-status');
    try {
      const resp = await fetch('curated-songs.json');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      this._curated = await resp.json();
      grid.innerHTML = '';
      for (const song of this._curated) {
        const card = document.createElement('button');
        card.className = 'card';
        card.type = 'button';
        card.innerHTML = `
          <div class="title"></div>
          <div class="meta"></div>
          <div class="blurb"></div>
        `;
        card.querySelector('.title').textContent = song.name;
        card.querySelector('.meta').textContent = song.composer || '';
        card.querySelector('.blurb').textContent = song.blurb || '';
        card.addEventListener('click', () => this._loadCuratedSong(song));
        grid.appendChild(card);
      }
      status.hidden = true;
    } catch (err) {
      status.hidden = false;
      status.classList.add('error');
      status.textContent = `Failed to load curated list: ${err.message}`;
    }
  }

  async _loadCuratedSong(song) {
    const url = IA_DOWNLOAD_URL(song.archiveItem, song.archiveFile);
    const label = `${song.name}${song.composer ? ` — ${song.composer}` : ''}`;
    this.close();
    try {
      await midiManager.loadFromUrl(url, label);
      saveRecent({ key: `url:${url}`, label, source: 'curated', curatedId: song.id });
      this._renderRecent();
    } catch (err) {
      if (this._onError) this._onError(`${label}: ${err.message}`);
    }
  }

  // ---------- Internet Archive tab ------------------------------------

  async _runSearch(query) {
    if (this._searchAbort) this._searchAbort.abort();
    this._searchAbort = new AbortController();
    const { signal } = this._searchAbort;
    try {
      const resp = await fetch(IA_SEARCH_URL(query), { signal });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const docs = (data && data.response && data.response.docs) || [];
      this._renderSearchResults(docs, query);
    } catch (err) {
      if (err.name === 'AbortError') return;
      this._setStatus('search-status', `Search failed: ${err.message}`, true);
    } finally {
      if (this._searchAbort && this._searchAbort.signal === signal) {
        this._searchAbort = null;
      }
    }
  }

  _renderSearchResults(docs, query) {
    const grid = this.shadowRoot.getElementById('search-grid');
    grid.innerHTML = '';
    if (!query) {
      this._setStatus('search-status', '');
      return;
    }
    if (docs.length === 0) {
      this._setStatus('search-status', `No matches for "${query}".`);
      return;
    }
    this._setStatus('search-status', `${docs.length} match${docs.length === 1 ? '' : 'es'}.`);
    for (const doc of docs) {
      const card = document.createElement('button');
      card.className = 'card';
      card.type = 'button';
      card.innerHTML = `
        <div class="title"></div>
        <div class="meta"></div>
      `;
      card.querySelector('.title').textContent = doc.title || doc.identifier;
      card.querySelector('.meta').textContent = Array.isArray(doc.creator)
        ? doc.creator.join(', ')
        : doc.creator || doc.identifier;
      card.addEventListener('click', () => this._loadIAItem(doc));
      grid.appendChild(card);
    }
  }

  async _loadIAItem(doc) {
    const id = doc.identifier;
    const label = doc.title || id;
    try {
      this._setStatus('search-status', `Resolving ${label}…`);
      const meta = await fetch(IA_METADATA_URL(id)).then((r) => r.json());
      const files = (meta && meta.files) || [];
      const midiFile = files.find((f) => /\.midi?$/i.test(f.name));
      if (!midiFile) {
        this._setStatus('search-status', `${label} has no MIDI files.`, true);
        return;
      }
      const url = IA_DOWNLOAD_URL(id, midiFile.name);
      this.close();
      await midiManager.loadFromUrl(url, label);
      saveRecent({ key: `url:${url}`, label, source: 'ia', archiveItem: id });
      this._renderRecent();
    } catch (err) {
      if (this._onError) this._onError(`${label}: ${err.message}`);
      else this._setStatus('search-status', `Failed: ${err.message}`, true);
    }
  }

  _setStatus(id, text, isError = false) {
    const el = this.shadowRoot.getElementById(id);
    if (!el) return;
    el.hidden = !text;
    el.textContent = text;
    el.classList.toggle('error', isError);
  }

  // ---------- Recent chips --------------------------------------------

  _renderRecent() {
    const wrap = this.shadowRoot.getElementById('recent-section');
    const chips = this.shadowRoot.getElementById('recent-chips');
    const recent = loadRecent();
    if (recent.length === 0) {
      wrap.hidden = true;
      return;
    }
    wrap.hidden = false;
    chips.innerHTML = '';
    for (const entry of recent) {
      const chip = document.createElement('button');
      chip.className = 'chip';
      chip.type = 'button';
      chip.textContent = entry.label;
      chip.title = entry.label;
      chip.addEventListener('click', () => this._reloadRecent(entry));
      chips.appendChild(chip);
    }
  }

  async _reloadRecent(entry) {
    if (entry.source === 'curated' && this._curated) {
      const song = this._curated.find((s) => s.id === entry.curatedId);
      if (song) {
        this._loadCuratedSong(song);
        return;
      }
    }
    if (entry.key && entry.key.startsWith('url:')) {
      const url = entry.key.slice('url:'.length);
      this.close();
      try {
        await midiManager.loadFromUrl(url, entry.label);
        saveRecent(entry);
        this._renderRecent();
      } catch (err) {
        if (this._onError) this._onError(`${entry.label}: ${err.message}`);
      }
    }
  }
}

customElements.define('piano-hero-song-browser', SongBrowserElement);

export { SongBrowserElement };

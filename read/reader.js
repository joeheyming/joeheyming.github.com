const MIN_FONT = 14;
const MAX_FONT = 28;
const DEFAULT_FONT = 18;

const THEMES = {
  dark:  { bg: '#0f172a', text: '#e2e8f0', accent: '#7c3aed' },
  sepia: { bg: '#f5f0e8', text: '#3d2b1f', accent: '#8b5a2b' },
  light: { bg: '#ffffff', text: '#1a1a1a', accent: '#4f46e5' },
};

export class Reader {
  constructor(containerEl, controlsEl) {
    this.container = containerEl;
    this.controls = controlsEl;
    this.theme = 'dark';
    this.fontSize = DEFAULT_FONT;
    this.fontFamily = 'serif';
    this.currentBookId = null;
    this._hideControlsTimer = null;
    this._saveTimer = null;

    /** @type {HTMLElement|null} */
    this._wrapper = null;

    /** @type {{ id: string, text: string, level: number }[]} */
    this._toc = [];

    this._pageHeight = 0;
    this._totalPages = 0;
    this._currentPage = 0;
    this._savedFraction = 0;

    /** @type {((bookId: string, position: number) => void)|null} */
    this.onScrollSave = null;

    /** @type {((page: number, total: number) => void)|null} */
    this.onPageChange = null;

    this._applyTheme();
    this._applyFont();
    this._setupControlsAutoHide();
    this._setupResizeObserver();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Load a book. savedPosition is a fraction 0–1 (legacy large pixel values → page 0).
   */
  async loadBook(book, savedPosition = 0) {
    this.currentBookId = String(book.id);
    this._savedFraction = (savedPosition > 0 && savedPosition <= 1) ? savedPosition : 0;
    this._wrapper = null;
    this._toc = [];
    this._totalPages = 0;
    this._currentPage = 0;
    this.container.innerHTML = '';
    this._showLoading();

    try {
      const { text, isHtml } = await this._fetchBookText(book);
      this._renderContent(text, isHtml);
      // Two rAF so layout settles before we measure heights
      requestAnimationFrame(() => requestAnimationFrame(() => this._paginate()));
    } catch (err) {
      this._showError(err.message);
    }
  }

  nextPage() {
    this.goToPage(this._currentPage + 1);
  }

  prevPage() {
    this.goToPage(this._currentPage - 1);
  }

  goToPage(n) {
    if (!this._pageHeight || !this._totalPages) return;
    const page = Math.max(0, Math.min(n, this._totalPages - 1));
    this._currentPage = page;
    this._wrapper.style.transform = `translateY(-${page * this._stepHeight}px)`;
    this._emitPageChange();
    this._scheduleSave();
  }

  scrollToHeading(id) {
    const el = this._wrapper?.querySelector(`#${CSS.escape(id)}`);
    if (!el || !this._stepHeight) return;
    const page = Math.floor(el.offsetTop / this._stepHeight);
    this.goToPage(page);
  }

  setupPageZones(prevEl, nextEl) {
    const flash = (el) => {
      el.classList.add('tapped');
      setTimeout(() => el.classList.remove('tapped'), 150);
    };
    prevEl.addEventListener('click', (e) => { e.stopPropagation(); flash(prevEl); this.prevPage(); });
    nextEl.addEventListener('click', (e) => { e.stopPropagation(); flash(nextEl); this.nextPage(); });
    prevEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.prevPage(); } });
    nextEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.nextPage(); } });
  }

  setTheme(theme) {
    this.theme = theme;
    this._applyTheme();
  }

  setFontSize(delta) {
    this._savedFraction = this.readingProgress;
    this.fontSize = Math.min(MAX_FONT, Math.max(MIN_FONT, this.fontSize + delta));
    this._applyFont();
  }

  setFontFamily(family) {
    this._savedFraction = this.readingProgress;
    this.fontFamily = family;
    this._applyFont();
  }

  /** @returns {{ id: string, text: string, level: number }[]} */
  get toc() { return this._toc; }

  get currentPage() { return this._currentPage; }
  get totalPages() { return this._totalPages; }

  get readingProgress() {
    if (!this._totalPages || this._totalPages <= 1) return 0;
    return this._currentPage / (this._totalPages - 1);
  }

  // ---------------------------------------------------------------------------
  // Fetch + render
  // ---------------------------------------------------------------------------

  async _fetchBookText(book) {
    const formats = book.formats || {};
    const htmlUrl =
      formats['text/html'] ||
      formats['text/html; charset=utf-8'] ||
      formats['text/html; charset=UTF-8'];
    const textUrl =
      formats['text/plain; charset=utf-8'] ||
      formats['text/plain; charset=UTF-8'] ||
      formats['text/plain'] ||
      formats['text/plain; charset=us-ascii'];

    const url = htmlUrl || textUrl;
    if (!url) throw new Error('No readable text format available for this book.');
    const isHtml = Boolean(htmlUrl);

    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(12000) });
      if (resp.ok) return { text: await resp.text(), isHtml };
    } catch {
      // CORS or timeout — fall through to proxy
    }

    const text = await window.proxyService.fetchWithProxy(url, { skipDirect: true });
    return { text: text || '', isHtml };
  }

  _renderContent(text, isHtml) {
    this.container.innerHTML = '';

    // Wrapper receives the transform; it is absolutely positioned so the
    // container can clip it with overflow:hidden.
    const wrapper = document.createElement('div');
    wrapper.className = 'reader-page-wrapper';

    const article = document.createElement('article');
    article.className = 'reader-prose';

    if (isHtml) {
      const cleaned = this._cleanHtml(text);
      article.innerHTML = cleaned;
      article.querySelectorAll('[style]').forEach((el) => el.removeAttribute('style'));
      article.querySelectorAll('[color]').forEach((el) => el.removeAttribute('color'));
      article.querySelectorAll('[face]').forEach((el) => el.removeAttribute('face'));
      article.querySelectorAll('style, link, script, iframe').forEach((el) => el.remove());
    } else {
      for (const raw of text.split(/\n{2,}/)) {
        const trimmed = raw.trim();
        if (!trimmed) continue;
        const p = document.createElement('p');
        p.textContent = trimmed.replace(/\n/g, ' ');
        article.appendChild(p);
      }
    }

    // Bottom spacer so final page's last line clears the always-visible nav bar
    const spacer = document.createElement('div');
    spacer.className = 'reader-end-spacer';
    spacer.setAttribute('aria-hidden', 'true');
    article.appendChild(spacer);

    wrapper.appendChild(article);
    this.container.appendChild(wrapper);
    this._wrapper = wrapper;

    this._buildToc(article);
  }

  _buildToc(article) {
    const headings = Array.from(article.querySelectorAll('h1, h2, h3, h4'));
    headings.forEach((h, i) => { if (!h.id) h.id = `toc-${i}`; });
    this._toc = headings.map((h) => ({
      id: h.id,
      text: h.textContent.trim(),
      level: parseInt(h.tagName[1], 10),
    }));
  }

  _cleanHtml(raw) {
    const doc = new DOMParser().parseFromString(raw, 'text/html');
    for (const sel of [
      '#pg-header', '#pg-footer', '.pg-boilerplate',
      '#header', '#footer', 'nav', '.navigation', '#toc', '.toc',
    ]) {
      try { doc.querySelectorAll(sel).forEach((el) => el.remove()); } catch { /* :has() fallback */ }
    }
    try { doc.querySelectorAll('pre:has(a)').forEach((el) => el.remove()); } catch {}
    doc.querySelectorAll('script, style, link, meta, noscript').forEach((el) => el.remove());
    return doc.body ? doc.body.innerHTML : doc.documentElement.innerHTML;
  }

  // ---------------------------------------------------------------------------
  // Pagination engine
  // ---------------------------------------------------------------------------

  _paginate() {
    if (!this._wrapper) return;
    const pageH = this.container.clientHeight;
    if (pageH <= 0) return;
    const totalH = this._wrapper.offsetHeight;
    // Keep ~2 lines of the previous page visible at the top of each new page
    const overlap = Math.round(this.fontSize * 1.8 * 3);
    this._pageHeight = pageH;
    this._stepHeight = Math.max(pageH - overlap, pageH * 0.7); // never step less than 70%
    this._totalPages = Math.max(1, Math.ceil((totalH - overlap) / this._stepHeight));
    const targetPage = Math.min(
      Math.round(this._savedFraction * (this._totalPages - 1)),
      this._totalPages - 1,
    );
    this.goToPage(targetPage);
  }

  _repaginate() {
    // Save current fractional position, then re-measure after the style recalc settles
    this._savedFraction = this.readingProgress;
    requestAnimationFrame(() => requestAnimationFrame(() => this._paginate()));
  }

  _setupResizeObserver() {
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (this._wrapper) this._repaginate();
    });
    ro.observe(this.container);
  }

  // ---------------------------------------------------------------------------
  // Controls auto-hide (tap top quarter to toggle settings toolbar)
  // ---------------------------------------------------------------------------

  _setupControlsAutoHide() {
    this.container.addEventListener('click', (e) => {
      const rect = this.container.getBoundingClientRect();
      const relY = (e.clientY - rect.top) / rect.height;
      if (relY < 0.25) {
        if (this.controls.classList.contains('controls-hidden')) {
          this._showControls();
        } else {
          this._hideControls();
        }
      }
    });
  }

  _showControls() {
    this.controls.classList.remove('controls-hidden');
    clearTimeout(this._hideControlsTimer);
    this._hideControlsTimer = setTimeout(() => this._hideControls(), 4000);
  }

  _hideControls() {
    clearTimeout(this._hideControlsTimer);
    this.controls.classList.add('controls-hidden');
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  _emitPageChange() {
    this.onPageChange?.(this._currentPage, this._totalPages);
  }

  _scheduleSave() {
    if (!this.currentBookId) return;
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this.onScrollSave?.(this.currentBookId, this.readingProgress);
    }, 600);
  }

  _applyTheme() {
    const t = THEMES[this.theme] || THEMES.dark;
    this.container.style.setProperty('--reader-bg', t.bg);
    this.container.style.setProperty('--reader-text', t.text);
    this.container.style.setProperty('--reader-accent', t.accent);
    this.container.setAttribute('data-theme', this.theme);
    document.documentElement.setAttribute('data-reader-theme', this.theme);
  }

  _applyFont() {
    this.container.style.setProperty('--reader-font-size', `${this.fontSize}px`);
    this.container.style.setProperty(
      '--reader-font-family',
      this.fontFamily === 'sans'
        ? '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
        : 'Georgia, "Times New Roman", serif',
    );
    // Re-paginate after font change since content height changes
    if (this._wrapper) this._repaginate();
  }

  _showLoading() {
    this.container.innerHTML = `
      <div class="reader-status">
        <div class="reader-spinner"></div>
        <p>Loading book…</p>
      </div>
    `;
  }

  _showError(msg) {
    this.container.innerHTML = `
      <div class="reader-status reader-error">
        <p>⚠️ ${msg}</p>
        <p class="reader-error-hint">Try a different book or check your connection.</p>
      </div>
    `;
  }
}

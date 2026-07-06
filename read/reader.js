const MIN_FONT = 14;
const MAX_FONT = 28;
const DEFAULT_FONT = 18;

const THEMES = {
  // Dark accent matches --read-night-accent-soft (indigo-300); the previous
  // #7c3aed violet had poor contrast against the slate-900 bg and looked
  // "hot" against blue-toned text.
  dark: { bg: '#0f172a', text: '#e2e8f0', accent: '#a5b4fc' },
  sepia: { bg: '#f5f0e8', text: '#3d2b1f', accent: '#8b5a2b' },
  light: { bg: '#ffffff', text: '#1a1a1a', accent: '#4f46e5' }
};

export class Reader {
  constructor(containerEl, controlsEl) {
    this.container = containerEl;
    this.controls = controlsEl;
    this.theme = 'sepia';
    this.fontSize = DEFAULT_FONT;
    this.fontFamily = 'serif';
    this.currentBookId = null;
    this._hideControlsTimer = null;
    this._saveTimer = null;
    this._lastSavedFraction = -1;
    this._pendingFraction = -1;
    this._intervalTimer = null;

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
    this._setupScrollTracking();
    this._setupUnloadSave();
    this._setupIntervalSave();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Load a book. savedPosition is a fraction 0–1 (legacy large pixel values → page 0).
   */
  async loadBook(book, savedPosition = 0) {
    this.currentBookId = String(book.id);
    this._savedFraction = savedPosition > 0 && savedPosition <= 1 ? savedPosition : 0;
    // Treat the caller-supplied position as "already persisted" so we
    // don't overwrite it with 0 before the container has a chance to
    // scroll to it. The next real scroll will bump this.
    this._lastSavedFraction = this._savedFraction;
    this._pendingFraction = -1;
    this._wrapper = null;
    this._toc = [];
    this._totalPages = 0;
    this._currentPage = 0;
    this.container.innerHTML = '';
    this._showLoading();

    try {
      const { text, isHtml, baseUrl } = await this._fetchBookText(book);
      this._renderContent(text, isHtml, baseUrl);
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
    if (!this._stepHeight || !this._totalPages) return;
    const page = Math.max(0, Math.min(n, this._totalPages - 1));
    const scrollable = this.container.scrollHeight - this.container.clientHeight;
    const target = Math.min(page * this._stepHeight, Math.max(0, scrollable));
    this.container.scrollTo({ top: target, behavior: 'smooth' });
    // _currentPage is updated by the scroll listener.
  }

  scrollToHeading(id) {
    const el = this._wrapper?.querySelector(`#${CSS.escape(id)}`);
    if (!el || !this._stepHeight) return;
    const containerRect = this.container.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const raw = this.container.scrollTop + (elRect.top - containerRect.top);
    // Snap down to the nearest page-step boundary so the heading sits at
    // the top of a "page" (matches chevron page-turn semantics). Jump
    // instantly — the user picked a chapter, they don't want to watch
    // the reader scroll through hundreds of pages of intervening prose.
    const page = Math.max(0, Math.floor(raw / this._stepHeight));
    const scrollable = Math.max(0, this.container.scrollHeight - this.container.clientHeight);
    this.container.scrollTop = Math.min(page * this._stepHeight, scrollable);
  }

  setupPageZones(prevEl, nextEl) {
    const flash = (el) => {
      el.classList.add('tapped');
      setTimeout(() => el.classList.remove('tapped'), 150);
    };
    prevEl.addEventListener('click', (e) => {
      e.stopPropagation();
      flash(prevEl);
      this.prevPage();
    });
    nextEl.addEventListener('click', (e) => {
      e.stopPropagation();
      flash(nextEl);
      this.nextPage();
    });
    prevEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.prevPage();
      }
    });
    nextEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.nextPage();
      }
    });
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
  get toc() {
    return this._toc;
  }

  get currentPage() {
    return this._currentPage;
  }
  get totalPages() {
    return this._totalPages;
  }

  get readingProgress() {
    // Scroll-fraction based so the position survives font-size / theme /
    // resize changes even between page boundaries.
    const scrollable = this.container.scrollHeight - this.container.clientHeight;
    if (scrollable <= 0) return 0;
    return Math.max(0, Math.min(1, this.container.scrollTop / scrollable));
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

    // Base URL for resolving relative `<img src="images/…">` paths in the
    // fetched HTML. Gutendex hands us `/ebooks/<id>.html.images`, which
    // 302s to the canonical `/cache/epub/<id>/pg<id>-images.html` where
    // images live in an `images/` sibling directory. But PG doesn't send
    // CORS headers, so we usually fall through to the proxy — and the
    // proxy path can't report the post-redirect URL. Constructing the
    // canonical cache URL directly from the numeric PG id sidesteps all
    // of that and always resolves images to the right asset.
    const pgId = /^\d+$/.test(String(book.id)) ? String(book.id) : null;
    const baseUrl = pgId
      ? `https://www.gutenberg.org/cache/epub/${pgId}/pg${pgId}-images.html`
      : url;

    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(12000) });
      if (resp.ok) return { text: await resp.text(), isHtml, baseUrl };
    } catch {
      // CORS or timeout — fall through to proxy
    }

    const text = await window.proxyService.fetchWithProxy(url, { skipDirect: true });
    return { text: text || '', isHtml, baseUrl };
  }

  _renderContent(text, isHtml, baseUrl = '') {
    this.container.innerHTML = '';

    // Wrapper holds the article inside the native-scrolling container.
    // No transform anymore — page-turn chevrons drive the container's
    // scrollTop instead.
    const wrapper = document.createElement('div');
    wrapper.className = 'reader-page-wrapper';

    const article = document.createElement('article');
    article.className = 'reader-prose';

    if (isHtml) {
      const cleaned = this._cleanHtml(text);
      article.innerHTML = cleaned;
      if (baseUrl) this._resolveRelativeUrls(article, baseUrl);
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
    headings.forEach((h, i) => {
      if (!h.id) h.id = `toc-${i}`;
    });
    this._toc = headings.map((h) => ({
      id: h.id,
      text: h.textContent.trim(),
      level: parseInt(h.tagName[1], 10)
    }));
  }

  /**
   * Resolve `src` / `srcset` attributes on `<img>` and `<source>` against
   * the fetched book's URL. Project Gutenberg's HTML uses relative paths
   * like `images/cover.jpg`, which would otherwise resolve against the
   * reader's own origin and 404. Absolute URLs and data: URIs pass
   * through untouched (URL constructor handles both).
   */
  _resolveRelativeUrls(root, baseUrl) {
    root.querySelectorAll('img[src]').forEach((img) => {
      const src = img.getAttribute('src');
      if (!src) return;
      try {
        img.setAttribute('src', new URL(src, baseUrl).href);
      } catch {
        /* Malformed URL — leave the original attribute alone. */
      }
      // Book-scale content can carry many illustrations; defer offscreen
      // images so the initial pagination measurement isn't blocked.
      if (!img.hasAttribute('loading')) img.setAttribute('loading', 'lazy');
    });
    root.querySelectorAll('img[srcset], source[srcset]').forEach((el) => {
      const srcset = el.getAttribute('srcset');
      if (!srcset) return;
      const rewritten = srcset
        .split(',')
        .map((entry) => {
          const trimmed = entry.trim();
          if (!trimmed) return '';
          const [candidate, ...descriptors] = trimmed.split(/\s+/);
          try {
            return [new URL(candidate, baseUrl).href, ...descriptors].join(' ');
          } catch {
            return trimmed;
          }
        })
        .filter(Boolean)
        .join(', ');
      el.setAttribute('srcset', rewritten);
    });
  }

  _cleanHtml(raw) {
    const doc = new DOMParser().parseFromString(raw, 'text/html');
    for (const sel of [
      '#pg-header',
      '#pg-footer',
      '.pg-boilerplate',
      '#header',
      '#footer',
      'nav',
      '.navigation',
      '#toc',
      '.toc'
    ]) {
      try {
        doc.querySelectorAll(sel).forEach((el) => el.remove());
      } catch {
        /* :has() fallback */
      }
    }
    try {
      doc.querySelectorAll('pre:has(a)').forEach((el) => el.remove());
    } catch {}
    doc.querySelectorAll('script, style, link, meta, noscript').forEach((el) => el.remove());
    return doc.body ? doc.body.innerHTML : doc.documentElement.innerHTML;
  }

  // ---------------------------------------------------------------------------
  // Pagination engine
  // ---------------------------------------------------------------------------

  _paginate() {
    if (!this._wrapper) return;
    const containerH = this.container.clientHeight;
    if (containerH <= 0) return;
    const wrapperH = this._wrapper.offsetHeight;
    // Keep ~2 lines of the previous page visible at the top of each new page
    const overlap = Math.round(this.fontSize * 1.8 * 3);
    this._pageHeight = containerH;
    this._stepHeight = Math.max(containerH - overlap, containerH * 0.7);
    const scrollable = Math.max(0, wrapperH - containerH);
    this._totalPages = scrollable <= 0 ? 1 : Math.ceil(scrollable / this._stepHeight) + 1;

    // Restore saved fractional scroll position. We set scrollTop directly
    // (no smooth behavior) so the initial jump is instant.
    const target = Math.round(this._savedFraction * scrollable);
    this.container.scrollTop = target;
    this._updatePageFromScroll(true);
  }

  _repaginate() {
    // Only re-capture the live scroll fraction once the initial paginate
    // has actually placed us at the restored position. Otherwise a
    // ResizeObserver fire between _renderContent (which sets _wrapper)
    // and the first _paginate — e.g. when the overflow-auto scrollbar
    // materialises as content is inserted — would overwrite the
    // caller-supplied _savedFraction with 0 (scrollTop is still 0) and
    // silently drop us at the top of the book on refresh.
    if (this._totalPages > 0) {
      this._savedFraction = this.readingProgress;
    }
    requestAnimationFrame(() => requestAnimationFrame(() => this._paginate()));
  }

  _setupResizeObserver() {
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (this._wrapper) this._repaginate();
    });
    ro.observe(this.container);
  }

  _setupScrollTracking() {
    let scheduled = false;
    this.container.addEventListener(
      'scroll',
      () => {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => {
          scheduled = false;
          this._updatePageFromScroll();
        });
      },
      { passive: true }
    );
  }

  /**
   * Recompute currentPage from live scroll position. Emits change events
   * and schedules the save whenever the derived page number moves or,
   * when `forceEmit` is set, unconditionally (used after re-pagination
   * to keep the progress bar in sync even if the page index is the same).
   */
  _updatePageFromScroll(forceEmit = false) {
    if (!this._stepHeight || !this._totalPages) {
      if (forceEmit) this._emitPageChange();
      return;
    }
    const page = Math.max(
      0,
      Math.min(Math.round(this.container.scrollTop / this._stepHeight), this._totalPages - 1)
    );
    const moved = page !== this._currentPage;
    this._currentPage = page;
    if (moved || forceEmit) this._emitPageChange();
    // Persist on every real scroll frame so pausing at any position (not
    // just a page boundary) survives refresh. `forceEmit` is only true
    // during initial paginate, when we're echoing the just-restored
    // position back out — no user activity to save yet.
    if (!forceEmit) this._recordPending();
  }

  /**
   * Note that the current scroll fraction should be persisted, and
   * schedule a short-debounced flush. Called on every rAF-throttled
   * scroll frame — the debounce collapses those bursts into one write
   * per idle window (~150ms) so localStorage isn't hammered while the
   * user is actively scrolling.
   */
  _recordPending() {
    this._pendingFraction = this.readingProgress;
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this._flushSave();
    }, 150);
  }

  /**
   * Write the pending fraction to storage, but only if it changed since
   * the last write. Fires from the debounce, the interval, and the
   * unload/visibility handlers.
   */
  _flushSave() {
    if (!this.currentBookId || !this.onScrollSave) return;
    const frac = this._pendingFraction >= 0 ? this._pendingFraction : this.readingProgress;
    if (frac === this._lastSavedFraction) return;
    this._lastSavedFraction = frac;
    this._pendingFraction = -1;
    this.onScrollSave(this.currentBookId, frac);
  }

  _setupUnloadSave() {
    const flush = () => {
      if (this._saveTimer) {
        clearTimeout(this._saveTimer);
        this._saveTimer = null;
      }
      // Ignore the "unchanged since last save" guard on unload — some
      // browsers race the debounce timer and never let it fire, so the
      // last-saved fraction here may lag reality by ~150ms.
      if (this.currentBookId && this.onScrollSave) {
        const frac = this.readingProgress;
        this._lastSavedFraction = frac;
        this._pendingFraction = -1;
        this.onScrollSave(this.currentBookId, frac);
      }
    };
    // Three overlapping "you're leaving" signals — different browsers
    // deliver different ones reliably:
    //   • pagehide     — modern spec, fires on nav-away & BFCache stash
    //   • beforeunload — legacy, fires on refresh / tab-close on Chrome
    //   • visibilitychange:hidden — mobile background / iOS home-button
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
  }

  /**
   * Belt-and-suspenders periodic save. Even if the debounce timer and
   * every unload signal fail, this catches the position after the user
   * has been on the page for ~2 seconds.
   */
  _setupIntervalSave() {
    this._intervalTimer = setInterval(() => this._flushSave(), 2000);
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

  _applyTheme() {
    const t = THEMES[this.theme] || THEMES.dark;
    // Set on <html> so every element inside #reader-view inherits — not
    // just #reader-container. The page-turn chevrons are siblings of the
    // container, so a container-scoped var would leave them invisible on
    // sepia and light themes (they'd fall back to the near-white dark
    // default).
    const html = document.documentElement;
    html.style.setProperty('--reader-bg', t.bg);
    html.style.setProperty('--reader-text', t.text);
    html.style.setProperty('--reader-accent', t.accent);
    html.setAttribute('data-reader-theme', this.theme);
  }

  _applyFont() {
    const html = document.documentElement;
    html.style.setProperty('--reader-font-size', `${this.fontSize}px`);
    html.style.setProperty(
      '--reader-font-family',
      this.fontFamily === 'sans'
        ? '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
        : 'Georgia, "Times New Roman", serif'
    );
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

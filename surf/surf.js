/**
 * Heyming OS - Surf
 * Minimal web browser and HTML viewer inspired by suckless surf
 */

function debug(...args) {
  if (window.parent?.HeymingOS?.Config?.DEBUG) {
    console.log('[Surf]', ...args);
  }
}

function postOsIframeMessage(message) {
  window.parent.postMessage({ type: 'iframe-message', message }, '*');
}

class Surf {
  constructor() {
    this.frame = document.getElementById('html-frame');
    this.landing = document.getElementById('landing');
    this.errorView = document.getElementById('error-view');
    this.errorMessage = document.getElementById('error-message');
    this.errorDetail = document.getElementById('error-detail');
    this.sourceView = document.getElementById('source-view');
    this.sourceCode = document.getElementById('source-code');
    this.fileInfo = document.getElementById('file-info');
    this.addressForm = document.getElementById('address-form');
    this.addressInput = document.getElementById('address-input');
    this.fileInput = document.getElementById('file-input');
    this.btnBack = document.getElementById('btn-back');
    this.btnForward = document.getElementById('btn-forward');
    this.btnReload = document.getElementById('btn-reload');
    this.btnHome = document.getElementById('btn-home');
    this.btnOpen = document.getElementById('btn-open');
    this.btnSource = document.getElementById('btn-source');
    this.btnNewTab = document.getElementById('btn-new-tab');
    this.btnScripts = document.getElementById('btn-scripts');
    this.btnOpenExternal = document.getElementById('btn-open-external');
    this.btnRunScripts = document.getElementById('btn-run-scripts');

    this.history = new window.SurfNavigation.NavigationHistory();
    this.currentDocument = null;
    this.rawHtml = '';
    this.showingSource = false;
    // Off by default: in an opaque-origin frame a page's scripts throw on
    // cookies, storage, and their own network calls, so they routinely
    // blank out a page that renders fine without them.
    this.allowScripts = false;
    this.isInOS = window.parent !== window;
    this._blobUrl = null;
    this._requestController = null;

    this.init();
  }

  init() {
    this.addressForm.addEventListener('submit', (event) => {
      event.preventDefault();
      this.loadAddress(this.addressInput.value);
    });
    this.btnBack.addEventListener('click', () => this.goBack());
    this.btnForward.addEventListener('click', () => this.goForward());
    this.btnReload.addEventListener('click', () => this.reload());
    this.btnHome.addEventListener('click', () => this.goHome());
    this.btnOpen.addEventListener('click', () => this.openFileDialog());
    document.getElementById('landing-open').addEventListener('click', () => this.openFileDialog());
    this.fileInput.addEventListener('change', () => {
      const [file] = this.fileInput.files;
      if (file) this.loadLocalFile(file);
      this.fileInput.value = '';
    });
    this.btnSource.addEventListener('click', () => this.toggleSource());
    this.btnNewTab.addEventListener('click', () => this.openInNewTab());
    this.btnScripts.addEventListener('click', () => this.toggleScripts());
    this.btnRunScripts.addEventListener('click', () => this.toggleScripts());
    this.btnOpenExternal.addEventListener('click', () => {
      if (this.currentDocument?.url) {
        window.open(this.currentDocument.url, '_blank', 'noopener');
      }
    });

    document.addEventListener('keydown', (e) => {
      const editing = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        this.addressInput.select();
      } else if (!editing && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'u') {
        e.preventDefault();
        this.toggleSource();
      } else if (!editing && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        this.openFileDialog();
      } else if (!editing && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        this.reload();
      } else if (!editing && e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        this.goBack();
      } else if (!editing && e.altKey && e.key === 'ArrowRight') {
        e.preventDefault();
        this.goForward();
      }
    });

    window.addEventListener('message', (e) => {
      if (e.data?.type === 'openFile') {
        const { path, content, fileName } = e.data;
        debug('Received file:', fileName);
        this.loadHtml(content, fileName, path);
      } else if (
        e.source === this.frame.contentWindow &&
        e.data?.type === 'surf-navigate' &&
        typeof e.data.url === 'string'
      ) {
        this.loadAddress(e.data.url);
      }
    });

    document.addEventListener('dragover', (event) => {
      if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
    });
    document.addEventListener('drop', (event) => {
      const [file] = event.dataTransfer?.files || [];
      if (!file) return;
      event.preventDefault();
      if (file.type === 'text/html' || /\.html?$/i.test(file.name)) {
        this.loadLocalFile(file);
      } else {
        this.showError('Choose an HTML or HTM file.');
      }
    });

    setTimeout(() => {
      if (!this.currentDocument && this.isInOS) {
        postOsIframeMessage({ type: 'requestPendingFile', app: 'surf' });
      }
    }, 200);
  }

  openFileDialog() {
    if (this.isInOS) {
      postOsIframeMessage({
        type: 'openFileDialog',
        fileTypes: ['text/html'],
        title: 'Open HTML File'
      });
    } else {
      this.fileInput.click();
    }
  }

  async loadLocalFile(file) {
    try {
      const html = await file.text();
      this.loadHtml(html, file.name, file.name);
    } catch {
      this.showError('Surf could not read that file.');
    }
  }

  _toText(content) {
    if (typeof content === 'string') return content;
    if (content instanceof ArrayBuffer || ArrayBuffer.isView(content)) {
      return new TextDecoder().decode(content);
    }
    return String(content);
  }

  loadHtml(content, fileName, path) {
    const entry = {
      kind: 'file',
      html: this._toText(content),
      label: fileName || path || 'Untitled',
      path: path || ''
    };
    this.history.push(entry);
    this.renderEntry(entry);
    debug('Rendered', fileName, `(${entry.html.length} chars)`);
  }

  async loadAddress(value, options = {}) {
    let url;
    try {
      url = window.SurfNavigation.normalizeAddress(value, window.location.href);
    } catch (error) {
      this.showError(error.message);
      return;
    }

    if (this._requestController) this._requestController.abort();
    const controller = new AbortController();
    this._requestController = controller;
    const addsHistory = options.history !== false;
    if (addsHistory) this.history.push({ kind: 'url', url, html: '' });
    this.setLoading(url);

    try {
      // Only pages on this origin can be fetched directly; everything else
      // goes straight to the proxy chain rather than spending the direct
      // attempt's budget on a CORS refusal that will never succeed.
      const html = await window.proxyService.fetchWithProxy(url, {
        signal: controller.signal,
        skipDirect: !window.SurfNavigation.isSameOrigin(url, window.location.href)
      });
      if (controller.signal.aborted) return;
      const entry = { kind: 'url', url, html };
      if (this.history.current?.kind === 'url' && this.history.current.url === url) {
        this.history.replace(entry);
      }
      this.renderEntry(entry);
    } catch (error) {
      if (controller.signal.aborted) return;
      this.currentDocument = { kind: 'url', url };
      this.addressInput.value = url;
      this.showError(
        `Surf reaches other sites through public web proxies, and none of them could return ${
          new URL(url).hostname
        }. The site may block proxies, or the proxies may be rate limited right now.`,
        error.message
      );
      debug('Navigation failed:', error);
    } finally {
      if (this._requestController === controller) this._requestController = null;
    }
  }

  renderEntry(entry) {
    if (this._requestController) {
      this._requestController.abort();
      this._requestController = null;
    }
    this.currentDocument = entry;
    this.rawHtml = entry.html || '';
    this.showingSource = false;

    this.hideViews();
    this.frame.classList.remove('hidden');
    this.btnSource.classList.remove('active');
    this.btnSource.disabled = !this.rawHtml;
    this.btnNewTab.disabled = false;
    this.btnReload.disabled = false;
    this.btnOpenExternal.classList.add('hidden');

    if (entry.kind === 'url') {
      const hostname = new URL(entry.url).hostname;
      this.addressInput.value = entry.url;
      this.fileInfo.textContent = hostname;
      document.title = `${hostname} — Surf`;

      const page = this.composeRemotePage(entry);
      if (page.isAppShell) {
        this.showAppShellNotice(hostname);
        return;
      }
      this.frame.srcdoc = page.html;
    } else {
      this.frame.srcdoc = this.rawHtml;
      this.addressInput.value = entry.path || entry.label;
      this.fileInfo.textContent = entry.label;
      document.title = `${entry.label} — Surf`;
    }
    this.updateControls();
  }

  /**
   * Turn fetched markup into something the preview frame can actually
   * render, and report whether anything survived. A page whose content
   * only exists after its scripts run has nothing left to show.
   */
  composeRemotePage(entry) {
    const nav = window.SurfNavigation;
    const doc = new DOMParser().parseFromString(entry.html, 'text/html');
    nav.sanitizeDocument(doc, { allowScripts: this.allowScripts });
    const text = nav.extractVisibleText(doc);
    return {
      html: nav.decorateHtml(doc.documentElement.outerHTML, entry.url),
      isAppShell: !this.allowScripts && text.length < nav.MIN_RENDERABLE_TEXT
    };
  }

  showAppShellNotice(hostname) {
    this.showError(
      `${hostname} builds its page with JavaScript, and Surf renders pages in a sandbox where ` +
        'a site\u2019s own scripts cannot reach cookies or storage. There is no content to show ' +
        'without them.'
    );
    this.btnRunScripts.classList.remove('hidden');
  }

  toggleScripts() {
    this.allowScripts = !this.allowScripts;
    this.btnScripts.classList.toggle('active', this.allowScripts);
    this.btnScripts.title = this.allowScripts
      ? 'Page scripts are running (usually breaks in the sandbox)'
      : 'Page scripts are stripped';
    const entry = this.history.current || this.currentDocument;
    if (entry?.kind === 'url' && entry.html) this.renderEntry(entry);
  }

  hideViews() {
    this.landing.classList.remove('active');
    this.errorView.classList.add('hidden');
    this.sourceView.classList.add('hidden');
    this.frame.classList.add('hidden');
  }

  setLoading(url) {
    this.hideViews();
    this.frame.srcdoc = '';
    this.currentDocument = { kind: 'url', url };
    this.addressInput.value = url;
    this.fileInfo.textContent = 'Loading…';
    this.addressForm.classList.add('loading');
    this.btnReload.disabled = true;
    this.btnSource.disabled = true;
    this.btnNewTab.disabled = true;
    this.btnBack.disabled = !this.history.canGoBack;
    this.btnForward.disabled = !this.history.canGoForward;
  }

  showError(message, detail) {
    this.hideViews();
    this.errorMessage.textContent = message;
    this.errorDetail.textContent = detail || '';
    this.errorDetail.classList.toggle('hidden', !detail);
    this.errorView.classList.remove('hidden');
    this.addressForm.classList.remove('loading');
    this.btnRunScripts.classList.add('hidden');
    this.fileInfo.textContent = 'Load failed';
    this.btnOpenExternal.classList.toggle('hidden', this.currentDocument?.kind !== 'url');
    this.updateControls();
  }

  updateControls() {
    this.addressForm.classList.remove('loading');
    this.btnBack.disabled = !this.history.canGoBack;
    this.btnForward.disabled = !this.history.canGoForward;
    this.btnReload.disabled = !this.currentDocument || this.currentDocument.kind === 'home';
  }

  async showHistoryEntry(entry) {
    if (!entry) return;
    if (entry.kind === 'home') {
      this.renderHome();
      return;
    }
    if (entry.kind === 'url' && !entry.html) {
      await this.loadAddress(entry.url, { history: false });
      return;
    }
    this.renderEntry(entry);
  }

  goBack() {
    this.showHistoryEntry(this.history.back());
  }

  goForward() {
    this.showHistoryEntry(this.history.forward());
  }

  reload() {
    const entry = this.currentDocument || this.history.current;
    if (!entry) return;
    if (entry.kind === 'url') {
      this.loadAddress(entry.url, { history: false });
    } else if (entry.kind === 'file') {
      this.renderEntry(entry);
    }
  }

  goHome() {
    this.history.push({ kind: 'home' });
    this.renderHome();
  }

  renderHome() {
    if (this._requestController) this._requestController.abort();
    this.currentDocument = { kind: 'home' };
    this.rawHtml = '';
    this.showingSource = false;
    this.frame.srcdoc = '';
    this.addressInput.value = '';
    this.fileInfo.textContent = 'Ready';
    this.hideViews();
    this.landing.classList.add('active');
    this.btnSource.disabled = true;
    this.btnSource.classList.remove('active');
    this.btnNewTab.disabled = true;
    this.btnReload.disabled = true;
    document.title = 'Surf — Minimal Web Browser and HTML Viewer 🌊';
    this.updateControls();
  }

  toggleSource() {
    if (!this.currentDocument || !this.rawHtml) return;

    this.showingSource = !this.showingSource;
    this.btnSource.classList.toggle('active', this.showingSource);

    if (this.showingSource) {
      this.frame.classList.add('hidden');
      this.sourceView.classList.remove('hidden');
      this.sourceCode.textContent = this.rawHtml;
    } else {
      this.sourceView.classList.add('hidden');
      this.frame.classList.remove('hidden');
    }
  }

  openInNewTab() {
    if (this.currentDocument?.kind === 'url') {
      window.open(this.currentDocument.url, '_blank', 'noopener');
      return;
    }
    if (!this.rawHtml) return;

    if (this._blobUrl) {
      URL.revokeObjectURL(this._blobUrl);
    }
    const blob = new Blob([this.rawHtml], { type: 'text/html' });
    this._blobUrl = URL.createObjectURL(blob);
    window.open(this._blobUrl, '_blank');
  }
}

new Surf();

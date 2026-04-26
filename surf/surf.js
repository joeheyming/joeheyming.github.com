/**
 * Heyming OS - Surf
 * Minimal HTML viewer inspired by suckless surf
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
    this.sourceView = document.getElementById('source-view');
    this.sourceCode = document.getElementById('source-code');
    this.fileInfo = document.getElementById('file-info');
    this.btnOpen = document.getElementById('btn-open');
    this.btnSource = document.getElementById('btn-source');
    this.btnNewTab = document.getElementById('btn-new-tab');

    this.currentFile = null;
    this.rawHtml = '';
    this.showingSource = false;
    this.isInOS = window.parent !== window;
    this._blobUrl = null;

    this.init();
  }

  init() {
    this.btnOpen.addEventListener('click', () => this.openFileDialog());
    this.btnSource.addEventListener('click', () => this.toggleSource());
    this.btnNewTab.addEventListener('click', () => this.openInNewTab());

    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'u') {
        e.preventDefault();
        this.toggleSource();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
        e.preventDefault();
        this.openFileDialog();
      }
    });

    window.addEventListener('message', (e) => {
      if (e.data?.type === 'openFile') {
        const { path, content, fileName } = e.data;
        debug('Received file:', fileName);
        this.loadHtml(content, fileName, path);
      }
    });

    setTimeout(() => {
      if (!this.currentFile && this.isInOS) {
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
    this.rawHtml = this._toText(content);
    this.currentFile = { path, fileName };
    this.showingSource = false;

    this.landing.classList.remove('active');
    this.sourceView.classList.add('hidden');
    this.frame.classList.remove('hidden');
    this.btnSource.classList.remove('active');
    this.btnNewTab.disabled = false;

    this.frame.srcdoc = this.rawHtml;

    this.fileInfo.textContent = fileName || path || 'Untitled';
    debug('Rendered', fileName, `(${this.rawHtml.length} chars)`);
  }

  toggleSource() {
    if (!this.currentFile) return;

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

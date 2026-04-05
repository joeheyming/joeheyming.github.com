/**
 * Heyming OS - Quick Look Preview
 * Spacebar preview functionality for files
 */

export class QuickLookPreview {
  constructor(container, options = {}) {
    this.container = container;
    this.overlay = null;
    /** @type {Element | null} */
    this._priorFocus = null;
    this.onOpenFile = options.onOpenFile || (() => {});
  }

  /**
   * Show Quick Look preview for a file
   * @param {Object} item - File item { path, content, mimeType }
   * @param {string} fileName - Display name
   */
  show(item, fileName) {
    // Close existing if open
    if (this.overlay) {
      this.close();
    }

    const mimeType = item.mimeType || 'application/octet-stream';
    const content = item.content || '';

    this._priorFocus = document.activeElement;

    // Create overlay (using DOM methods to prevent XSS)
    this.overlay = document.createElement('div');
    this.overlay.className = 'quick-look-overlay';

    const container = document.createElement('div');
    container.className = 'quick-look-container';
    container.setAttribute('role', 'dialog');
    container.setAttribute('aria-modal', 'true');
    container.setAttribute('aria-labelledby', 'quick-look-title');

    // Header
    const header = document.createElement('div');
    header.className = 'quick-look-header';
    const titleSpan = document.createElement('span');
    titleSpan.id = 'quick-look-title';
    titleSpan.className = 'quick-look-title';
    titleSpan.textContent = fileName; // Safe - no innerHTML
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'quick-look-close';
    closeBtn.setAttribute('aria-label', 'Close Quick Look');
    closeBtn.textContent = '✕';
    header.appendChild(titleSpan);
    header.appendChild(closeBtn);

    // Content
    const contentEl = document.createElement('div');
    contentEl.className = 'quick-look-content';
    contentEl.setAttribute('role', 'region');
    contentEl.setAttribute('aria-label', 'Preview');

    // Footer
    const footer = document.createElement('div');
    footer.className = 'quick-look-footer';
    const infoSpan = document.createElement('span');
    infoSpan.className = 'quick-look-info';
    infoSpan.textContent = mimeType; // Safe - no innerHTML
    const hint = document.createElement('span');
    hint.className = 'quick-look-hint';
    hint.appendChild(document.createTextNode('Press '));
    const kbdEsc = document.createElement('kbd');
    kbdEsc.className = 'launcher-kbd';
    kbdEsc.textContent = 'Esc';
    hint.appendChild(kbdEsc);
    hint.appendChild(document.createTextNode(' to close'));
    const footerLeft = document.createElement('div');
    footerLeft.className = 'quick-look-footer-left';
    footerLeft.appendChild(infoSpan);
    footerLeft.appendChild(hint);
    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'quick-look-open';
    openBtn.textContent = 'Open with App';
    footer.appendChild(footerLeft);
    footer.appendChild(openBtn);

    container.appendChild(header);
    container.appendChild(contentEl);
    container.appendChild(footer);
    this.overlay.appendChild(container);

    // Render content based on MIME type
    this._renderContent(contentEl, mimeType, content, fileName);

    // Event handlers
    closeBtn.onclick = () => this.close();
    openBtn.onclick = () => {
      this.close();
      this.onOpenFile(item);
    };
    this.overlay.onclick = (e) => {
      if (e.target === this.overlay) {
        this.close();
      }
    };

    this.container.appendChild(this.overlay);

    // Animate in + move focus into dialog (restore on close)
    requestAnimationFrame(() => {
      this.overlay.classList.add('show');
      closeBtn.focus();
    });
  }

  /**
   * Close Quick Look preview
   */
  close() {
    if (!this.overlay) return;

    const prior = this._priorFocus;
    this._priorFocus = null;
    const overlay = this.overlay;
    this.overlay = null;

    overlay.classList.remove('show');
    overlay.remove();

    if (prior && typeof prior.focus === 'function' && document.documentElement.contains(prior)) {
      try {
        prior.focus();
      } catch {
        /* detached or non-focusable */
      }
    }
  }

  /**
   * Check if Quick Look is open
   * @returns {boolean}
   */
  isOpen() {
    return this.overlay !== null;
  }

  // ========== Private Methods ==========

  _renderContent(contentEl, mimeType, content, fileName) {
    if (mimeType.startsWith('image/')) {
      const img = document.createElement('img');
      img.src = content.startsWith('data:') || content.startsWith('http') ? content : content;
      img.alt = fileName;
      contentEl.appendChild(img);
    } else if (mimeType.startsWith('video/')) {
      const video = document.createElement('video');
      video.src = content;
      video.controls = true;
      video.autoplay = true;
      video.muted = true;
      contentEl.appendChild(video);
    } else if (mimeType.startsWith('audio/')) {
      const audio = document.createElement('audio');
      audio.src = content;
      audio.controls = true;
      audio.autoplay = true;
      contentEl.appendChild(audio);
      contentEl.classList.add('audio-preview');
    } else if (this._isTextMimeType(mimeType)) {
      const pre = document.createElement('pre');
      const textContent = typeof content === 'string' ? content : String(content);
      pre.textContent = textContent.slice(0, 5000);
      if (textContent.length > 5000) {
        pre.textContent += '\n\n... (truncated)';
      }
      contentEl.appendChild(pre);
      contentEl.classList.add('text-preview');
    } else {
      this._renderNoPreview(contentEl, mimeType);
    }
  }

  _isTextMimeType(mimeType) {
    return (
      mimeType.startsWith('text/') ||
      mimeType === 'application/json' ||
      mimeType === 'application/javascript' ||
      mimeType === 'application/xml'
    );
  }

  _renderNoPreview(contentEl, mimeType) {
    const noPreview = document.createElement('div');
    noPreview.className = 'no-preview';

    const icon = document.createElement('span');
    icon.className = 'icon';
    icon.textContent = '📄';

    const p1 = document.createElement('p');
    p1.textContent = 'No preview available';

    const p2 = document.createElement('p');
    p2.className = 'mime';
    p2.textContent = mimeType; // Safe - no innerHTML

    noPreview.appendChild(icon);
    noPreview.appendChild(p1);
    noPreview.appendChild(p2);
    contentEl.appendChild(noPreview);
  }
}

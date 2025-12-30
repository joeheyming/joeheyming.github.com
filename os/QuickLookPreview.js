/**
 * Heyming OS - Quick Look Preview
 * Spacebar preview functionality for files
 */

export class QuickLookPreview {
  constructor(container, options = {}) {
    this.container = container;
    this.overlay = null;
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

    // Create overlay (using DOM methods to prevent XSS)
    this.overlay = document.createElement('div');
    this.overlay.className = 'quick-look-overlay';

    const container = document.createElement('div');
    container.className = 'quick-look-container';

    // Header
    const header = document.createElement('div');
    header.className = 'quick-look-header';
    const titleSpan = document.createElement('span');
    titleSpan.className = 'quick-look-title';
    titleSpan.textContent = fileName; // Safe - no innerHTML
    const closeBtn = document.createElement('button');
    closeBtn.className = 'quick-look-close';
    closeBtn.textContent = '✕';
    header.appendChild(titleSpan);
    header.appendChild(closeBtn);

    // Content
    const contentEl = document.createElement('div');
    contentEl.className = 'quick-look-content';

    // Footer
    const footer = document.createElement('div');
    footer.className = 'quick-look-footer';
    const infoSpan = document.createElement('span');
    infoSpan.className = 'quick-look-info';
    infoSpan.textContent = mimeType; // Safe - no innerHTML
    const openBtn = document.createElement('button');
    openBtn.className = 'quick-look-open';
    openBtn.textContent = 'Open with App';
    footer.appendChild(infoSpan);
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

    // Animate in
    requestAnimationFrame(() => {
      this.overlay.classList.add('show');
    });
  }

  /**
   * Close Quick Look preview
   */
  close() {
    if (!this.overlay) return;

    this.overlay.classList.remove('show');
    const overlay = this.overlay;
    this.overlay = null;

    setTimeout(() => {
      overlay.remove();
    }, 200);
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

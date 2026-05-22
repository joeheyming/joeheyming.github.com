/**
 * Heyming OS Image Viewer
 * Views image files with zoom, pan, and rotate
 */

// Debug logging helper
function debug(...args) {
  if (window.parent?.HeymingOS?.Config?.DEBUG) {
    console.log('[ImageViewer]', ...args);
  }
}

/** Heyming OS expects `{ type: 'iframe-message', message }` (see os/IframeMessageBridge.js). */
function postOsIframeMessage(message) {
  window.parent.postMessage({ type: 'iframe-message', message }, '*');
}

class ImageViewer {
  constructor() {
    // Elements
    this.image = document.getElementById('image');
    this.imageContainer = document.getElementById('image-container');
    this.imageWrapper = document.getElementById('image-wrapper');
    this.dropZone = document.getElementById('drop-zone');
    this.fileInput = document.getElementById('file-input');

    // Toolbar
    this.btnOpen = document.getElementById('btn-open');
    this.btnZoomIn = document.getElementById('btn-zoom-in');
    this.btnZoomOut = document.getElementById('btn-zoom-out');
    this.btnFit = document.getElementById('btn-fit');
    this.btnActual = document.getElementById('btn-actual');
    this.btnRotateLeft = document.getElementById('btn-rotate-left');
    this.btnRotateRight = document.getElementById('btn-rotate-right');
    this.btnFullscreen = document.getElementById('btn-fullscreen');
    this.zoomLevel = document.getElementById('zoom-level');
    this.imageInfo = document.getElementById('image-info');

    // State
    this.currentFile = null;
    this.zoom = 1;
    this.rotation = 0;
    this.panX = 0;
    this.panY = 0;
    this.isDragging = false;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.lastPanX = 0;
    this.lastPanY = 0;
    this.fitMode = true;
    this.naturalWidth = 0;
    this.naturalHeight = 0;
    this.isInOS = window.parent !== window;
    /** @type {string|null} blob: URL from virtual FS binary payload */
    this._imageBlobUrl = null;

    this.init();
  }

  _revokeImageBlobUrl() {
    if (this._imageBlobUrl) {
      URL.revokeObjectURL(this._imageBlobUrl);
      this._imageBlobUrl = null;
    }
  }

  mimeFromFileName(fileName) {
    const ext = fileName?.split('.').pop()?.toLowerCase();
    const map = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      svg: 'image/svg+xml',
      bmp: 'image/bmp',
      ico: 'image/x-icon'
    };
    return map[ext || ''] || 'application/octet-stream';
  }

  init() {
    this.setupToolbar();
    this.setupDropZone();
    this.setupPanZoom();
    this.setupKeyboardShortcuts();
    this.setupMessageListener();

    // Request pending file from OS
    setTimeout(() => {
      if (!this.currentFile && this.isInOS) {
        postOsIframeMessage({ type: 'requestPendingFile', app: 'image-viewer' });
      }
    }, 200);
  }

  setupToolbar() {
    this.btnOpen.addEventListener('click', () => this.openFileDialog());
    this.fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        this.loadImageFile(e.target.files[0]);
      }
    });

    this.btnZoomIn.addEventListener('click', () => this.zoomIn());
    this.btnZoomOut.addEventListener('click', () => this.zoomOut());
    this.btnFit.addEventListener('click', () => this.fitToWindow());
    this.btnActual.addEventListener('click', () => this.actualSize());
    this.btnRotateLeft.addEventListener('click', () => this.rotate(-90));
    this.btnRotateRight.addEventListener('click', () => this.rotate(90));
    this.btnFullscreen.addEventListener('click', () => this.toggleFullscreen());
  }

  setupDropZone() {
    const zones = [this.dropZone, this.imageWrapper];

    zones.forEach((zone) => {
      ['dragenter', 'dragover', 'dragleave', 'drop'].forEach((eventName) => {
        zone.addEventListener(eventName, (e) => {
          e.preventDefault();
          e.stopPropagation();
        });
      });

      ['dragenter', 'dragover'].forEach((eventName) => {
        zone.addEventListener(eventName, () => {
          this.dropZone.classList.add('drag-over');
        });
      });

      ['dragleave', 'drop'].forEach((eventName) => {
        zone.addEventListener(eventName, () => {
          this.dropZone.classList.remove('drag-over');
        });
      });

      zone.addEventListener('drop', (e) => this.handleDrop(e));
    });
  }

  setupPanZoom() {
    // Mouse wheel zoom
    this.imageWrapper.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      this.zoomBy(delta, e.clientX, e.clientY);
    });

    // Pan with mouse drag
    this.imageWrapper.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return; // Left click only
      this.startDrag(e.clientX, e.clientY);
    });

    document.addEventListener('mousemove', (e) => {
      if (this.isDragging) {
        this.drag(e.clientX, e.clientY);
      }
    });

    document.addEventListener('mouseup', () => {
      this.endDrag();
    });

    // Touch support
    this.imageWrapper.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        const touch = e.touches[0];
        this.startDrag(touch.clientX, touch.clientY);
      }
    });

    this.imageWrapper.addEventListener('touchmove', (e) => {
      if (this.isDragging && e.touches.length === 1) {
        e.preventDefault();
        const touch = e.touches[0];
        this.drag(touch.clientX, touch.clientY);
      }
    });

    this.imageWrapper.addEventListener('touchend', () => {
      this.endDrag();
    });

    // Double-click to toggle fit/actual
    this.imageWrapper.addEventListener('dblclick', () => {
      if (this.fitMode) {
        this.actualSize();
      } else {
        this.fitToWindow();
      }
    });
  }

  setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;

      switch (e.key) {
        case '+':
        case '=':
          e.preventDefault();
          this.zoomIn();
          break;
        case '-':
          e.preventDefault();
          this.zoomOut();
          break;
        case '0':
          e.preventDefault();
          this.fitToWindow();
          break;
        case '1':
          e.preventDefault();
          this.actualSize();
          break;
        case 'f':
          e.preventDefault();
          this.fitToWindow();
          break;
        case 'l':
          this.rotate(-90);
          break;
        case 'r':
          this.rotate(90);
          break;
        case 'Enter':
          e.preventDefault();
          this.toggleFullscreen();
          break;
        case 'o':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            this.openFileDialog();
          }
          break;
      }
    });
  }

  setupMessageListener() {
    window.addEventListener('message', (e) => {
      if (e.data?.type === 'openFile') {
        const { path, content, fileName } = e.data;
        debug('Image Viewer received file:', fileName);
        this.loadImage(content, fileName, path);
      }
    });
  }

  // ========== Controls ==========

  openFileDialog() {
    if (this.isInOS) {
      postOsIframeMessage({
        type: 'openFileDialog',
        fileTypes: ['image/*'],
        title: 'Open Image'
      });
    } else {
      this.fileInput.click();
    }
  }

  zoomIn() {
    this.zoomBy(0.25);
  }

  zoomOut() {
    this.zoomBy(-0.25);
  }

  zoomBy(delta, centerX, centerY) {
    if (!this.currentFile) return;

    const oldZoom = this.zoom;
    this.zoom = Math.max(0.1, Math.min(10, this.zoom + delta));
    this.fitMode = false;

    // Zoom toward cursor position if provided
    if (centerX !== undefined && centerY !== undefined) {
      const rect = this.imageWrapper.getBoundingClientRect();
      const x = centerX - rect.left - rect.width / 2;
      const y = centerY - rect.top - rect.height / 2;

      const scale = this.zoom / oldZoom;
      this.panX = x - (x - this.panX) * scale;
      this.panY = y - (y - this.panY) * scale;
    }

    this.updateTransform();
    this.updateZoomDisplay();
    this.updateButtonStates();
  }

  fitToWindow() {
    if (!this.currentFile) return;

    const wrapperRect = this.imageWrapper.getBoundingClientRect();
    const imgWidth = this.rotation % 180 === 0 ? this.naturalWidth : this.naturalHeight;
    const imgHeight = this.rotation % 180 === 0 ? this.naturalHeight : this.naturalWidth;

    const scaleX = wrapperRect.width / imgWidth;
    const scaleY = wrapperRect.height / imgHeight;
    this.zoom = Math.min(scaleX, scaleY, 1) * 0.95; // 95% to add some padding

    this.panX = 0;
    this.panY = 0;
    this.fitMode = true;

    this.imageContainer.classList.add('animating');
    this.updateTransform();
    this.updateZoomDisplay();
    this.updateButtonStates();

    setTimeout(() => this.imageContainer.classList.remove('animating'), 200);
  }

  actualSize() {
    if (!this.currentFile) return;

    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.fitMode = false;

    this.imageContainer.classList.add('animating');
    this.updateTransform();
    this.updateZoomDisplay();
    this.updateButtonStates();

    setTimeout(() => this.imageContainer.classList.remove('animating'), 200);
  }

  rotate(degrees) {
    if (!this.currentFile) return;

    this.rotation = (this.rotation + degrees + 360) % 360;
    this.imageContainer.classList.add('animating');
    this.updateTransform();

    setTimeout(() => {
      this.imageContainer.classList.remove('animating');
      if (this.fitMode) {
        this.fitToWindow();
      }
    }, 200);
  }

  toggleFullscreen() {
    if (!this.currentFile) return;

    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      this.imageWrapper.requestFullscreen().catch(console.error);
    }
  }

  // ========== Pan ==========

  startDrag(x, y) {
    if (!this.currentFile || this.fitMode) return;

    this.isDragging = true;
    this.dragStartX = x;
    this.dragStartY = y;
    this.lastPanX = this.panX;
    this.lastPanY = this.panY;
    this.imageWrapper.classList.add('dragging');
  }

  drag(x, y) {
    if (!this.isDragging) return;

    this.panX = this.lastPanX + (x - this.dragStartX);
    this.panY = this.lastPanY + (y - this.dragStartY);
    this.updateTransform();
  }

  endDrag() {
    this.isDragging = false;
    this.imageWrapper.classList.remove('dragging');
  }

  // ========== Transform ==========

  updateTransform() {
    const transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom}) rotate(${this.rotation}deg)`;
    this.imageContainer.style.transform = transform;

    // Update cursor based on zoom
    if (this.fitMode || this.zoom <= 1) {
      this.imageWrapper.classList.add('zoom-fit');
    } else {
      this.imageWrapper.classList.remove('zoom-fit');
    }
  }

  updateZoomDisplay() {
    this.zoomLevel.textContent = Math.round(this.zoom * 100) + '%';
  }

  updateButtonStates() {
    this.btnFit.classList.toggle('active', this.fitMode);
    this.btnActual.classList.toggle('active', !this.fitMode && this.zoom === 1);
  }

  enableControls(enabled) {
    this.btnZoomIn.disabled = !enabled;
    this.btnZoomOut.disabled = !enabled;
    this.btnFit.disabled = !enabled;
    this.btnActual.disabled = !enabled;
    this.btnRotateLeft.disabled = !enabled;
    this.btnRotateRight.disabled = !enabled;
    this.btnFullscreen.disabled = !enabled;
  }

  // ========== File Loading ==========

  handleDrop(e) {
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      if (file.type.startsWith('image/')) {
        this.loadImageFile(file);
      }
    }
  }

  loadImageFile(file) {
    const url = URL.createObjectURL(file);
    this.loadImage(url, file.name);
  }

  loadImage(content, fileName, path) {
    this.currentFile = { path, fileName };

    this.dropZone.classList.remove('active');
    this.imageWrapper.classList.remove('hidden');
    this.imageWrapper.classList.add('loading');

    this._revokeImageBlobUrl();

    // Check for transparency (PNG, GIF, WebP, SVG)
    const hasTransparency = /\.(png|gif|webp|svg)$/i.test(fileName);
    this.imageWrapper.classList.toggle('show-transparency', hasTransparency);

    // Determine image source
    let imageSrc;
    if (content instanceof ArrayBuffer || ArrayBuffer.isView(content)) {
      const mime = this.mimeFromFileName(fileName);
      const blob = new Blob([content], { type: mime });
      imageSrc = URL.createObjectURL(blob);
      this._imageBlobUrl = imageSrc;
    } else if (typeof content === 'string') {
      imageSrc = content;
      if (
        content.startsWith('data:') ||
        content.startsWith('blob:') ||
        content.startsWith('http')
      ) {
        // Already a valid URL - use as-is
        imageSrc = content;
      } else if (fileName?.endsWith('.svg') && content.trim().startsWith('<')) {
        // SVG text content - encode as data URL
        imageSrc = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(content);
      } else {
        // Assume raw image data - shouldn't happen often but handle gracefully
        imageSrc = content;
      }
    } else {
      imageSrc = content;
    }

    this.image.onload = () => {
      // Get dimensions - fallback for SVGs that may not report natural dimensions
      this.naturalWidth = this.image.naturalWidth || this.image.width || 300;
      this.naturalHeight = this.image.naturalHeight || this.image.height || 150;

      // For SVGs, also try getBoundingClientRect if dimensions are still 0
      if (this.naturalWidth === 0 || this.naturalHeight === 0) {
        const rect = this.image.getBoundingClientRect();
        this.naturalWidth = rect.width || 300;
        this.naturalHeight = rect.height || 150;
      }

      // Ensure image element has dimensions (needed for some SVGs)
      if (!this.image.style.width) {
        this.image.style.width = this.naturalWidth + 'px';
        this.image.style.height = this.naturalHeight + 'px';
      }

      this.imageWrapper.classList.remove('loading');
      this.enableControls(true);
      this.image.alt = fileName ? `${fileName} preview` : 'Loaded image preview';
      this.image.removeAttribute('role');

      // Reset transform
      this.rotation = 0;
      this.panX = 0;
      this.panY = 0;

      // Fit to window initially
      this.fitToWindow();

      // Update info
      this.imageInfo.textContent = `${fileName} • ${this.naturalWidth}×${this.naturalHeight}`;
    };

    this.image.onerror = () => {
      this.imageWrapper.classList.remove('loading');
      this.imageInfo.textContent = '⚠️ Failed to load image';
      setTimeout(() => this.reset(), 3000);
    };

    this.image.src = imageSrc;
  }

  reset() {
    this._revokeImageBlobUrl();
    this.image.src = '';
    this.image.alt = '';
    this.image.setAttribute('role', 'presentation');
    this.image.style.width = '';
    this.image.style.height = '';
    this.imageWrapper.classList.add('hidden');
    this.dropZone.classList.add('active');
    this.currentFile = null;
    this.zoom = 1;
    this.rotation = 0;
    this.panX = 0;
    this.panY = 0;
    this.fitMode = true;
    this.enableControls(false);
    this.zoomLevel.textContent = '100%';
    this.imageInfo.textContent = 'No image';
    this.updateTransform();
  }
}

// Initialize viewer
new ImageViewer();

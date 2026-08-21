/**
 * Heyming OS 3D Viewer
 * Loads GLB/GLTF models with <model-viewer>, supports drag-and-drop,
 * file dialog, demo models, and OS file routing.
 */

function debug(...args) {
  if (window.parent?.HeymingOS?.Config?.DEBUG) {
    console.log('[ModelViewer]', ...args);
  }
}

/** Heyming OS expects `{ type: 'iframe-message', message }` (see os/IframeMessageBridge.js). */
function postOsIframeMessage(message) {
  window.parent.postMessage({ type: 'iframe-message', message }, '*');
}

/**
 * Public demo models. The first group is hosted by modelviewer.dev (CORS-enabled mirror
 * of Khronos samples) and arrives as glb. The second group lives in three.js's example
 * assets and exercises the on-the-fly STL/OBJ/PLY/FBX/3MF -> glb converter.
 */
const DEMO_MODELS = [
  {
    label: '🚀 Astronaut (glb)',
    url: 'https://modelviewer.dev/shared-assets/models/Astronaut.glb'
  },
  {
    label: '🤖 Robot Expressive (glb)',
    url: 'https://modelviewer.dev/shared-assets/models/RobotExpressive.glb'
  },
  {
    label: '🦆 Duck (glb)',
    url: 'https://modelviewer.dev/shared-assets/models/glTF-Sample-Assets/Models/Duck/glTF-Binary/Duck.glb'
  },
  { label: '🐎 Horse (glb)', url: 'https://modelviewer.dev/shared-assets/models/Horse.glb' },
  {
    label: '🪖 Damaged Helmet (glb)',
    url: 'https://modelviewer.dev/shared-assets/models/glTF-Sample-Assets/Models/DamagedHelmet/glTF-Binary/DamagedHelmet.glb'
  },
  {
    label: '🏎️ Toy Car (glb)',
    url: 'https://modelviewer.dev/shared-assets/models/glTF-Sample-Assets/Models/ToyCar/glTF-Binary/ToyCar.glb'
  },
  {
    // Multi-file glTF: model-viewer fetches Duck.gltf and resolves the relative
    // Duck0.bin and DuckCM.png references against the same directory.
    label: '🦆 Duck (gltf, multi-file)',
    url: 'https://modelviewer.dev/shared-assets/models/glTF-Sample-Assets/Models/Duck/glTF/Duck.gltf'
  },
  {
    // Single self-contained .gltf — buffers and textures inline as data URIs.
    label: '📦 Box Textured (gltf-embed)',
    url: 'https://modelviewer.dev/shared-assets/models/glTF-Sample-Assets/Models/BoxTextured/glTF-Embedded/BoxTextured.gltf'
  },
  {
    label: '🖨️ Colored cube (stl)',
    url: 'https://threejs.org/examples/models/stl/binary/colored.stl'
  },
  {
    label: '🥁 Slotted disk (stl)',
    url: 'https://threejs.org/examples/models/stl/ascii/slotted_disk.stl'
  },
  {
    label: '🎭 Walt Head (obj)',
    url: 'https://threejs.org/examples/models/obj/walt/WaltHead.obj'
  },
  {
    label: '🐬 Dolphins (ply)',
    url: 'https://threejs.org/examples/models/ply/ascii/dolphins.ply'
  },
  {
    label: '💃 Samba Dancing (fbx)',
    url: 'https://threejs.org/examples/models/fbx/Samba%20Dancing.fbx'
  },
  {
    label: '🚚 Truck (3mf)',
    url: 'https://threejs.org/examples/models/3mf/truck.3mf'
  }
];

class ModelViewerApp {
  constructor() {
    this.modelEl = /** @type {any} */ (document.getElementById('model'));
    this.modelWrapper = document.getElementById('model-wrapper');
    this.dropZone = document.getElementById('drop-zone');
    this.fileInput = /** @type {HTMLInputElement} */ (document.getElementById('file-input'));
    this.loadingOverlay = document.getElementById('loading-overlay');

    this.btnOpen = document.getElementById('btn-open');
    this.btnDemo = document.getElementById('btn-demo');
    this.demoMenu = document.getElementById('demo-menu');
    this.btnReset = document.getElementById('btn-reset');
    this.btnRotate = document.getElementById('btn-rotate');
    this.btnShadow = document.getElementById('btn-shadow');
    this.btnFullscreen = document.getElementById('btn-fullscreen');
    this.envSelect = /** @type {HTMLSelectElement} */ (document.getElementById('env-select'));
    this.modelInfo = document.getElementById('model-info');

    this.currentFile = null;
    this.isInOS = window.parent !== window;
    /** @type {string|null} blob: URL we own and must revoke before swapping. */
    this._blobUrl = null;
    this.autoRotate = true;
    this.shadow = true;

    this.init();
  }

  init() {
    this.setupToolbar();
    this.setupDemoMenu();
    this.setupDropZone();
    this.setupKeyboardShortcuts();
    this.setupMessageListener();
    this.setupModelEvents();

    setTimeout(() => {
      if (!this.currentFile && this.isInOS) {
        postOsIframeMessage({ type: 'requestPendingFile', app: 'model-viewer' });
      }
    }, 200);
  }

  _revokeBlobUrl() {
    if (this._blobUrl) {
      URL.revokeObjectURL(this._blobUrl);
      this._blobUrl = null;
    }
  }

  setupToolbar() {
    this.btnOpen.addEventListener('click', () => this.openFileDialog());
    this.fileInput.addEventListener('change', (e) => {
      const target = /** @type {HTMLInputElement} */ (e.target);
      if (target.files && target.files.length > 0) {
        this.loadModelFile(target.files[0]);
      }
    });

    this.btnReset.addEventListener('click', () => this.resetCamera());
    this.btnRotate.addEventListener('click', () => this.toggleAutoRotate());
    this.btnShadow.addEventListener('click', () => this.toggleShadow());
    this.btnFullscreen.addEventListener('click', () => this.toggleFullscreen());
    this.envSelect.addEventListener('change', () => this.applyEnvironment());

    this.btnRotate.classList.toggle('active', this.autoRotate);
    this.btnShadow.classList.toggle('active', this.shadow);
  }

  setupDemoMenu() {
    DEMO_MODELS.forEach((demo) => {
      const btn = document.createElement('button');
      btn.textContent = demo.label;
      btn.addEventListener('click', () => {
        this.demoMenu.classList.remove('open');
        // Use the URL's basename (e.g. "Astronaut.glb", "Samba Dancing.fbx") so the
        // extension drives format detection in loadFromUrl.
        const basename = decodeURIComponent(demo.url.split('/').pop() || 'model.glb');
        this.loadFromUrl(demo.url, basename);
      });
      this.demoMenu.appendChild(btn);
    });

    this.btnDemo.addEventListener('click', (e) => {
      e.stopPropagation();
      this.demoMenu.classList.toggle('open');
    });

    document.addEventListener('click', (e) => {
      const target = /** @type {Node} */ (e.target);
      if (
        !this.demoMenu.contains(target) &&
        !this.btnDemo.contains(target)
      ) {
        this.demoMenu.classList.remove('open');
      }
    });
  }

  setupDropZone() {
    const zones = [this.dropZone, this.modelWrapper];
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
      zone.addEventListener('drop', (e) => this.handleDrop(/** @type {DragEvent} */ (e)));
    });
  }

  setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      const target = /** @type {HTMLElement} */ (e.target);
      if (target.tagName === 'INPUT' || target.tagName === 'SELECT') return;

      switch (e.key.toLowerCase()) {
        case 'r':
          e.preventDefault();
          this.resetCamera();
          break;
        case 'a':
          e.preventDefault();
          this.toggleAutoRotate();
          break;
        case 's':
          e.preventDefault();
          this.toggleShadow();
          break;
        case 'enter':
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
        debug('Received file from OS:', fileName);
        this.loadModelContent(content, fileName, path);
      }
    });
  }

  setupModelEvents() {
    this.modelEl.addEventListener('load', () => {
      window.heymingAchievements?.unlockForCurrentApp('first-action');
      this.loadingOverlay.classList.add('hidden');
      this.updateModelInfo();
    });
    this.modelEl.addEventListener('error', (event) => {
      const detail = /** @type {CustomEvent} */ (event).detail;
      const reason = detail?.sourceError?.message || detail?.type || 'load error';
      this.showError('Failed to load model: ' + reason);
      this.loadingOverlay.classList.add('hidden');
    });
    this.modelEl.addEventListener('progress', (event) => {
      const detail = /** @type {CustomEvent} */ (event).detail;
      const totalProgress = detail?.totalProgress ?? 0;
      if (totalProgress > 0 && totalProgress < 1) {
        const pct = Math.round(totalProgress * 100);
        const text = this.loadingOverlay.querySelector('.loading-text');
        if (text) text.textContent = `Loading model… ${pct}%`;
      }
    });
  }

  // ========== Controls ==========

  openFileDialog() {
    if (this.isInOS) {
      postOsIframeMessage({
        type: 'openFileDialog',
        fileTypes: ['model/gltf-binary', 'model/gltf+json', '.glb', '.gltf'],
        title: 'Open 3D Model'
      });
    } else {
      this.fileInput.click();
    }
  }

  resetCamera() {
    if (!this.currentFile) return;
    this.modelEl.cameraOrbit = 'auto auto auto';
    this.modelEl.fieldOfView = 'auto';
    if (typeof this.modelEl.resetTurntableRotation === 'function') {
      this.modelEl.resetTurntableRotation();
    }
    if (typeof this.modelEl.jumpCameraToGoal === 'function') {
      this.modelEl.jumpCameraToGoal();
    }
  }

  toggleAutoRotate() {
    if (!this.currentFile) return;
    this.autoRotate = !this.autoRotate;
    if (this.autoRotate) {
      this.modelEl.setAttribute('auto-rotate', '');
    } else {
      this.modelEl.removeAttribute('auto-rotate');
    }
    this.btnRotate.classList.toggle('active', this.autoRotate);
  }

  toggleShadow() {
    if (!this.currentFile) return;
    this.shadow = !this.shadow;
    this.modelEl.setAttribute('shadow-intensity', this.shadow ? '1' : '0');
    this.btnShadow.classList.toggle('active', this.shadow);
  }

  applyEnvironment() {
    if (!this.currentFile) return;
    const value = this.envSelect.value;
    if (value === '') {
      this.modelEl.removeAttribute('environment-image');
    } else {
      this.modelEl.setAttribute('environment-image', value);
    }
  }

  toggleFullscreen() {
    if (!this.currentFile) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      this.modelWrapper.requestFullscreen().catch((err) => {
        debug('Fullscreen error', err);
      });
    }
  }

  enableControls(enabled) {
    this.btnReset.disabled = !enabled;
    this.btnRotate.disabled = !enabled;
    this.btnShadow.disabled = !enabled;
    this.btnFullscreen.disabled = !enabled;
    this.envSelect.disabled = !enabled;
  }

  updateModelInfo() {
    if (!this.currentFile) return;
    const { fileName } = this.currentFile;
    let dims = '';
    const size = this.modelEl.getDimensions?.();
    if (size) {
      dims = ` • ${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)} m`;
    }
    this.modelInfo.textContent = `${fileName}${dims}`;
  }

  // ========== File Loading ==========

  handleDrop(e) {
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!this.isModelFile(file.name)) {
      this.showError('Unsupported file type — drop a .glb/.gltf/.stl/.obj/.ply/.fbx/.3mf');
      return;
    }
    this.loadModelFile(file);
  }

  isModelFile(name) {
    return /\.(glb|gltf|stl|obj|ply|fbx|3mf)$/i.test(name || '');
  }

  /** Files we can convert to glb on the fly via Three.js loaders + GLTFExporter. */
  needsConversion(name) {
    return /\.(stl|obj|ply|fbx|3mf)$/i.test(name || '');
  }

  async loadModelFile(file) {
    if (this.needsConversion(file.name)) {
      try {
        const buffer = await file.arrayBuffer();
        await this._loadConverted(buffer, file.name);
      } catch (err) {
        this._handleConvertError(err, file.name);
      }
      return;
    }
    const url = URL.createObjectURL(file);
    this._setBlobUrl(url);
    this._showViewer(file.name);
    this.modelEl.src = url;
  }

  async loadFromUrl(url, fileName) {
    const name = fileName || url.split('/').pop() || 'model.glb';
    if (this.needsConversion(name)) {
      this._showViewer(name);
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
        const buffer = await res.arrayBuffer();
        await this._loadConverted(buffer, name);
      } catch (err) {
        this._handleConvertError(err, name);
      }
      return;
    }
    this._revokeBlobUrl();
    this._showViewer(name);
    this.modelEl.src = url;
  }

  async loadModelContent(content, fileName, path) {
    if (this.needsConversion(fileName)) {
      this.currentFile = { path, fileName };
      this._showViewer(fileName);
      try {
        const buffer = await this._toArrayBuffer(content, fileName);
        await this._loadConverted(buffer, fileName);
      } catch (err) {
        this._handleConvertError(err, fileName);
      }
      return;
    }

    let src;
    if (content instanceof ArrayBuffer || ArrayBuffer.isView(content)) {
      const mime = this.mimeFromFileName(fileName);
      const blob = new Blob([content], { type: mime });
      src = URL.createObjectURL(blob);
      this._setBlobUrl(src);
    } else if (typeof content === 'string') {
      if (
        content.startsWith('data:') ||
        content.startsWith('blob:') ||
        content.startsWith('http')
      ) {
        this._revokeBlobUrl();
        src = content;
      } else if (/\.gltf$/i.test(fileName) && content.trim().startsWith('{')) {
        // Inline glTF JSON — encode as data URL. External buffers/textures referenced by
        // relative URLs will not resolve, but standalone JSON models still render.
        src = 'data:model/gltf+json;charset=utf-8,' + encodeURIComponent(content);
        this._revokeBlobUrl();
      } else {
        src = content;
        this._revokeBlobUrl();
      }
    } else {
      this.showError('Unsupported model payload from OS');
      return;
    }

    this.currentFile = { path, fileName };
    this._showViewer(fileName);
    this.modelEl.src = src;
  }

  /**
   * Convert a non-glTF buffer through `format-converter.js` (lazy import) and
   * point <model-viewer> at the resulting glb blob URL.
   * @param {ArrayBuffer} buffer
   * @param {string} fileName
   */
  async _loadConverted(buffer, fileName) {
    const text = this.loadingOverlay.querySelector('.loading-text');
    if (text) text.textContent = `Converting ${fileName}…`;
    const mod = await import('./format-converter.js');
    const blobUrl = await mod.convertToGlbBlobUrl(buffer, fileName);
    this._setBlobUrl(blobUrl);
    if (text) text.textContent = 'Loading model…';
    this.modelEl.src = blobUrl;
  }

  async _toArrayBuffer(content, fileName) {
    if (content instanceof ArrayBuffer) return content;
    if (ArrayBuffer.isView(content)) {
      return content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength);
    }
    if (typeof content === 'string') {
      if (
        content.startsWith('data:') ||
        content.startsWith('blob:') ||
        content.startsWith('http')
      ) {
        const res = await fetch(content);
        if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${fileName}`);
        return await res.arrayBuffer();
      }
      // Treat as raw text payload.
      return new TextEncoder().encode(content).buffer;
    }
    throw new Error('Unsupported content type for conversion');
  }

  _handleConvertError(err, fileName) {
    debug('Convert failed', fileName, err);
    this.showError(`Failed to convert ${fileName}: ${err?.message || err}`);
    this.loadingOverlay.classList.add('hidden');
  }

  mimeFromFileName(fileName) {
    if (/\.gltf$/i.test(fileName || '')) return 'model/gltf+json';
    return 'model/gltf-binary';
  }

  _setBlobUrl(url) {
    this._revokeBlobUrl();
    this._blobUrl = url;
  }

  _showViewer(fileName) {
    this.currentFile = { fileName };
    this.dropZone.classList.remove('active');
    this.modelWrapper.classList.remove('hidden');
    this.loadingOverlay.classList.remove('hidden');
    const text = this.loadingOverlay.querySelector('.loading-text');
    if (text) text.textContent = 'Loading model…';
    this.enableControls(true);
    this.modelInfo.textContent = fileName;
  }

  showError(msg) {
    let toast = document.querySelector('.error-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'error-toast';
      this.modelWrapper.appendChild(toast);
    }
    toast.textContent = msg;
    clearTimeout(this._errorTimer);
    this._errorTimer = window.setTimeout(() => {
      toast.remove();
    }, 4000);
  }
}

new ModelViewerApp();

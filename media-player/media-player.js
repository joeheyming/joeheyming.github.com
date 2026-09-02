/**
 * Heyming OS Media Player
 * Plays video and audio files from the filesystem or dropped from the OS.
 * MIDI / SMAF (.mmf) files are synthesized in-browser (not via <video>).
 */

import {
  fileLooksLikeSequence,
  listMidiChannels,
  midiChannelLabel,
  midiProgressFromTicks,
  midiTickFromProgress,
  prepareMidiBytes,
  sniffSequenceKind
} from './midi-sequence.js';
import {
  VIZ_MODE_LABELS,
  clampVizSize,
  drawVisualizer,
  nextVizMode,
  normalizeVizMode
} from './visualizer.js';

const MIDI_SEEK_MAX = 1000;
// v2: v1 could persist a 0x0 measurement taken while the panel was hidden,
// which restored as a minimum-size canvas.
const VIZ_PREFS_KEY = 'heyming.media-player.viz.v2';

// Debug logging helper
function debug(...args) {
  if (window.parent?.HeymingOS?.Config?.DEBUG) {
    console.debug('[MediaPlayer]', ...args);
  }
}

/**
 * Read a brand CSS custom property as a string color, with a fallback.
 * Canvas 2D `fillStyle` can't consume `var(...)` directly, so the
 * frequency-bar gradient resolves brand tokens at draw time. If the
 * brand ever flips, the next animation frame picks up the new value.
 */
function brandToken(name, fallback) {
  if (typeof document === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** Heyming OS expects `{ type: 'iframe-message', message }` (see os/IframeMessageBridge.js). */
function postOsIframeMessage(message) {
  window.parent.postMessage({ type: 'iframe-message', message }, '*');
}

class MediaPlayer {
  constructor() {
    // Media elements
    this.media = document.getElementById('media');
    this.dropZone = document.getElementById('drop-zone');
    this.mediaWrapper = document.getElementById('media-wrapper');
    this.mediaName = document.getElementById('media-name');
    this.fileInput = document.getElementById('file-input');

    // Audio visualization elements
    this.audioVisual = document.getElementById('audio-visual');
    this.audioTitle = document.getElementById('audio-title');
    this.audioArtist = document.getElementById('audio-artist');
    this.midiSeek = document.getElementById('midi-seek');
    this.midiChannelList = document.getElementById('midi-channel-list');
    this.vizCanvas = document.getElementById('viz-canvas');
    this.vizResize = document.getElementById('viz-resize');
    this.vizLabel = document.getElementById('viz-label');
    /** @type {CanvasRenderingContext2D|null} */
    this.vizCtx = null;
    this.vizMode = 'both';
    /** @type {AudioContext|null} */
    this.audioCtx = null;
    /** @type {AnalyserNode|null} */
    this.analyser = null;
    /** @type {Uint8Array|null} */
    this.dataArray = null;
    /** @type {Uint8Array|null} */
    this.timeArray = null;
    /** @type {number|null} */
    this._vizRafId = null;

    // YouTube elements
    this.youtubeContainer = document.getElementById('youtube-container');
    this.youtubePlayer = document.getElementById('youtube-player');

    // Toolbar elements
    this.btnOpen = document.getElementById('btn-open');
    this.btnClose = document.getElementById('btn-close');
    this.btnSkipBack = document.getElementById('btn-skip-back');
    this.btnPlayPause = document.getElementById('btn-play-pause');
    this.btnSkipForward = document.getElementById('btn-skip-forward');
    this.btnLoop = document.getElementById('btn-loop');
    this.btnPip = document.getElementById('btn-pip');
    this.btnFullscreen = document.getElementById('btn-fullscreen');
    this.playbackSpeed = document.getElementById('playback-speed');
    this.timeDisplay = document.getElementById('time-display');

    this.currentFile = null;
    this.isLooping = false;
    this.isInOS = window.parent !== window;
    this.isAudio = false;
    this.isYouTube = false;
    this.isMidi = false;
    this._isResetting = false;
    /** @type {string|null} */
    this._mediaBlobUrl = null;
    /** @type {ReturnType<typeof setTimeout>|null} */
    this._errorTimeout = null;
    /** @type {ReturnType<typeof setInterval>|null} */
    this._midiTimer = null;
    /** @type {InstanceType<typeof WebAudioTinySynth>|null} */
    this._midiSynth = null;
    this._midiDurationSec = 0;
    this._midiSeeking = false;
    this._analyserToDest = false;
    /** @type {Set<number>} */
    this._midiMuted = new Set();
    /** @type {number|null} */
    this._midiSolo = null;
    this._midiSendWrapped = false;
    this._midiOrigSend = null;
    /** @type {ReturnType<typeof setTimeout>|null} */
    this._vizLabelTimer = null;
    /** @type {{ width: number, height: number }|null} */
    this._vizSize = null;
    this._vizDragging = false;

    this.init();
  }

  _revokeMediaBlobUrl() {
    if (this._mediaBlobUrl) {
      URL.revokeObjectURL(this._mediaBlobUrl);
      this._mediaBlobUrl = null;
    }
  }

  mimeFromMediaFileName(fileName) {
    const ext = fileName?.split('.').pop()?.toLowerCase();
    const map = {
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      ogg: 'audio/ogg',
      m4a: 'audio/mp4',
      aac: 'audio/aac',
      flac: 'audio/flac',
      wma: 'audio/x-ms-wma',
      mid: 'audio/midi',
      midi: 'audio/midi',
      kar: 'audio/midi',
      rmi: 'audio/midi',
      mmf: 'application/vnd.smaf',
      webm: 'video/webm',
      mp4: 'video/mp4',
      ogv: 'video/ogg',
      mov: 'video/quicktime',
      mkv: 'video/x-matroska'
    };
    return map[ext || ''] || 'application/octet-stream';
  }

  init() {
    this.setupDropZone();
    this.setupMessageListener();
    this.setupMediaEvents();
    this.setupToolbar();
    this.setupMidiSeek();
    this.setupVisualizerUi();
    this.setupKeyboardShortcuts();

    // Request pending file from OS (in case message was missed)
    setTimeout(() => {
      if (!this.currentFile && window.parent !== window) {
        postOsIframeMessage({ type: 'requestPendingFile', app: 'media-player' });
      }
    }, 200);
  }

  setupToolbar() {
    // Open file
    this.btnOpen.addEventListener('click', () => this.openFileDialog());
    this.fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        this.loadMediaFile(e.target.files[0]);
      }
    });

    // Close media
    this.btnClose.addEventListener('click', () => this.reset());

    // Playback controls
    this.btnPlayPause.addEventListener('click', () => this.togglePlayPause());
    this.btnSkipBack.addEventListener('click', () => this.skip(-10));
    this.btnSkipForward.addEventListener('click', () => this.skip(10));

    // Loop
    this.btnLoop.addEventListener('click', () => this.toggleLoop());

    // Playback speed
    this.playbackSpeed.addEventListener('change', (e) => {
      if (this.isMidi) return;
      this.media.playbackRate = parseFloat(e.target.value);
    });

    // Picture-in-Picture (video only)
    this.btnPip.addEventListener('click', () => this.togglePip());

    // Fullscreen
    this.btnFullscreen.addEventListener('click', () => this.toggleFullscreen());
  }

  setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Don't capture if typing in an input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      // YouTube has its own keyboard controls
      if (this.isYouTube && e.key !== 'f' && e.key !== 'Escape') return;

      switch (e.key.toLowerCase()) {
        case ' ':
          e.preventDefault();
          this.togglePlayPause();
          break;
        case 'arrowleft':
          e.preventDefault();
          this.skip(-10);
          break;
        case 'arrowright':
          e.preventDefault();
          this.skip(10);
          break;
        case 'arrowup':
          e.preventDefault();
          this.adjustVolume(0.1);
          break;
        case 'arrowdown':
          e.preventDefault();
          this.adjustVolume(-0.1);
          break;
        case 'l':
          this.toggleLoop();
          break;
        case 'p':
          if (!this.isAudio) this.togglePip();
          break;
        case 'f':
          this.toggleFullscreen();
          break;
        case 'm':
          this.media.muted = !this.media.muted;
          this.syncMidiVolume();
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

  setupDropZone() {
    const zones = [this.dropZone, this.mediaWrapper];

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
          if (!this.mediaWrapper.classList.contains('hidden')) {
            this.mediaWrapper.style.opacity = '0.5';
          }
        });
      });

      ['dragleave', 'drop'].forEach((eventName) => {
        zone.addEventListener(eventName, () => {
          this.dropZone.classList.remove('drag-over');
          this.mediaWrapper.style.opacity = '1';
        });
      });

      zone.addEventListener('drop', (e) => this.handleDrop(e));
    });
  }

  setupMessageListener() {
    window.addEventListener('message', (e) => {
      if (e.data?.type === 'openFile') {
        const { path, content, fileName } = e.data;
        debug('Media Player received file:', fileName, 'content type:', typeof content);
        this.loadMedia(content, fileName, path);
      }
    });
  }

  setupMediaEvents() {
    this.media.addEventListener('error', () => {
      if (this._isResetting) return;

      const error = this.media.error;
      let errorMessage = 'Failed to load media';
      if (error) {
        console.error('Media error details:', {
          code: error.code,
          message: error.message,
          crossOriginIsolated: self.crossOriginIsolated,
          src: this.media.src?.substring(0, 100)
        });
        if (error.code === 4) {
          errorMessage = 'Media format not supported or blocked by browser policy';
        }
      }
      this.showError(errorMessage);
    });

    this.media.addEventListener('loadedmetadata', () => {
      this.mediaWrapper.classList.remove('loading');
      this.enableControls(true);
      this.updateTimeDisplay();
    });

    this.media.addEventListener('timeupdate', () => {
      this.updateTimeDisplay();
    });

    this.media.addEventListener('play', () => {
      window.heymingAchievements?.unlockForCurrentApp('first-action');
      this.btnPlayPause.textContent = '⏸️';
      this.btnPlayPause.title = 'Pause (Space)';
      this.mediaWrapper.classList.add('playing');
      if (this.isAudio) {
        this.initAudioContext(this.media);
        this.drawSpectrum();
      }
    });

    this.media.addEventListener('pause', () => {
      this.btnPlayPause.textContent = '▶️';
      this.btnPlayPause.title = 'Play (Space)';
      this.mediaWrapper.classList.remove('playing');
      if (this.isAudio) {
        this.stopSpectrum();
      }
    });

    this.media.addEventListener('ended', () => {
      if (!this.isLooping) {
        this.btnPlayPause.textContent = '▶️';
        this.mediaWrapper.classList.remove('playing');
        this.stopSpectrum();
      }
    });

    // Click media/audio-visual to play/pause
    this.media.addEventListener('click', () => this.togglePlayPause());
    this.audioVisual.addEventListener('click', (e) => {
      if (e.target.closest('#midi-seek-row, #midi-channels, .viz-panel')) return;
      this.togglePlayPause();
    });

    // Double-click to fullscreen (video only)
    this.media.addEventListener('dblclick', () => {
      if (!this.isAudio) this.toggleFullscreen();
    });
  }

  // ========== Controls ==========

  openFileDialog() {
    if (this.isInOS) {
      postOsIframeMessage({
        type: 'openFileDialog',
        fileTypes: [
          'video/*',
          'audio/*',
          'audio/midi',
          'application/vnd.smaf',
          'mid',
          'midi',
          'mmf',
          'application/x-youtube'
        ],
        title: 'Open Media'
      });
    } else {
      // Use native file picker in standalone mode
      this.fileInput.click();
    }
  }

  togglePlayPause() {
    if (this.isMidi) {
      this.toggleMidiPlayPause();
      return;
    }
    if (!this.media.src) return;

    if (this.media.paused) {
      this.media.play();
    } else {
      this.media.pause();
    }
  }

  skip(seconds) {
    if (this.isMidi) {
      this.skipMidi(seconds);
      return;
    }
    if (!this.media.src) return;
    this.media.currentTime = Math.max(
      0,
      Math.min(this.media.duration, this.media.currentTime + seconds)
    );
  }

  adjustVolume(delta) {
    this.media.volume = Math.max(0, Math.min(1, this.media.volume + delta));
    this.syncMidiVolume();
  }

  toggleLoop() {
    this.isLooping = !this.isLooping;
    this.media.loop = this.isLooping;
    if (this._midiSynth) this._midiSynth.setLoop(this.isLooping ? 1 : 0);
    this.btnLoop.classList.toggle('active', this.isLooping);
    this.btnLoop.title = this.isLooping ? 'Loop On (L)' : 'Loop Off (L)';
  }

  async togglePip() {
    if (!this.media.src || this.isAudio) return;

    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (document.pictureInPictureEnabled) {
        await this.media.requestPictureInPicture();
      }
    } catch (error) {
      console.error('PiP error:', error);
    }
  }

  toggleFullscreen() {
    if (!this.media.src && !this.isYouTube && !this.isMidi) return;

    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      this.mediaWrapper.requestFullscreen().catch(console.error);
    }
  }

  enableControls(enabled) {
    this.btnClose.disabled = !enabled;
    this.btnSkipBack.disabled = !enabled;
    this.btnPlayPause.disabled = !enabled;
    this.btnSkipForward.disabled = !enabled;
    this.btnLoop.disabled = !enabled;
    this.playbackSpeed.disabled = !enabled || this.isMidi;
    this.btnPip.disabled = !enabled || this.isAudio || this.isMidi;
    this.btnFullscreen.disabled = !enabled;
    if (this.midiSeek) this.midiSeek.disabled = !enabled || !this.isMidi;
  }

  setupMidiSeek() {
    if (!this.midiSeek) return;
    this.midiSeek.max = String(MIDI_SEEK_MAX);
    const endSeek = () => {
      this._midiSeeking = false;
    };
    this.midiSeek.addEventListener('pointerdown', () => {
      this._midiSeeking = true;
    });
    this.midiSeek.addEventListener('pointerup', endSeek);
    this.midiSeek.addEventListener('pointercancel', endSeek);
    this.midiSeek.addEventListener('change', endSeek);
    this.midiSeek.addEventListener('input', () => this.seekMidiFromSlider());
  }

  setupVisualizerUi() {
    this.loadVizPrefs();
    if (!this.vizResize) return;

    // A corner resize drag also ends in a click, so only cycle the mode when
    // the pointer stayed put and the box did not change size.
    let downAt = null;
    this.vizResize.addEventListener('pointerdown', (e) => {
      const rect = this.vizResize.getBoundingClientRect();
      downAt = { x: e.clientX, y: e.clientY, width: rect.width, height: rect.height };
      this._vizDragging = true;
    });
    this.vizResize.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!downAt) return;
      const rect = this.vizResize.getBoundingClientRect();
      const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 4;
      const resized =
        Math.abs(rect.width - downAt.width) > 1 || Math.abs(rect.height - downAt.height) > 1;
      downAt = null;
      if (moved || resized) return;
      this.cycleVizMode();
    });
    window.addEventListener('pointerup', () => {
      if (!this._vizDragging) return;
      this._vizDragging = false;
      this.captureVizSize();
      this.saveVizPrefs();
    });
  }

  /**
   * Remember the box size only while the user is dragging the resize corner.
   * The panel is `display: none` until a file loads, so an automatic observer
   * would measure 0x0 and pin the canvas to its minimum on the next visit.
   */
  captureVizSize() {
    if (!this.vizResize) return;
    const rect = this.vizResize.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    this._vizSize = clampVizSize(rect.width, rect.height);
  }

  cycleVizMode() {
    this.vizMode = nextVizMode(this.vizMode);
    this.saveVizPrefs();
    this.flashVizLabel();
  }

  flashVizLabel() {
    if (!this.vizLabel) return;
    this.vizLabel.textContent = VIZ_MODE_LABELS[this.vizMode] || this.vizMode;
    this.vizLabel.classList.add('visible');
    if (this._vizLabelTimer) clearTimeout(this._vizLabelTimer);
    this._vizLabelTimer = setTimeout(() => {
      this.vizLabel.classList.remove('visible');
      this._vizLabelTimer = null;
    }, 1200);
  }

  loadVizPrefs() {
    try {
      const raw = localStorage.getItem(VIZ_PREFS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      this.vizMode = normalizeVizMode(parsed?.mode);
      if (parsed?.width == null || parsed?.height == null) return;
      this._vizSize = clampVizSize(parsed.width, parsed.height);
      if (this.vizResize) {
        this.vizResize.style.width = `${this._vizSize.width}px`;
        this.vizResize.style.height = `${this._vizSize.height}px`;
      }
    } catch {
      /* ignore */
    }
  }

  saveVizPrefs() {
    try {
      localStorage.setItem(
        VIZ_PREFS_KEY,
        JSON.stringify({ mode: this.vizMode, ...(this._vizSize || {}) })
      );
    } catch {
      /* ignore */
    }
  }

  updateTimeDisplay() {
    const current = this.formatTime(this.media.currentTime);
    const duration = this.formatTime(this.media.duration);
    this.timeDisplay.textContent = `${current} / ${duration}`;
  }

  formatTime(seconds) {
    if (isNaN(seconds)) return '--:--';

    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);

    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  // ========== File Loading ==========

  detectMediaType(fileName, mimeType) {
    if (fileLooksLikeSequence(fileName, mimeType)) return true;
    if (mimeType) {
      return mimeType.startsWith('audio/');
    }
    // Fallback to extension check
    const ext = fileName.split('.').pop().toLowerCase();
    const audioExtensions = [
      'mp3',
      'wav',
      'ogg',
      'm4a',
      'aac',
      'flac',
      'wma',
      'mid',
      'midi',
      'kar',
      'mmf'
    ];
    return audioExtensions.includes(ext);
  }

  handleDrop(e) {
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      if (
        file.type.startsWith('video/') ||
        file.type.startsWith('audio/') ||
        fileLooksLikeSequence(file.name, file.type)
      ) {
        this.loadMediaFile(file);
      } else {
        this.showError('Please drop a video or audio file');
      }
    }
  }

  loadMediaFile(file) {
    this.currentFile = { fileName: file.name };
    if (fileLooksLikeSequence(file.name, file.type)) {
      file.arrayBuffer().then((buf) => this.playSequence(buf, file.name));
      return;
    }
    const url = URL.createObjectURL(file);
    this.isAudio = this.detectMediaType(file.name, file.type);
    this.playMedia(url, file.name);
  }

  loadMedia(content, fileName, path) {
    if (this._errorTimeout) {
      clearTimeout(this._errorTimeout);
      this._errorTimeout = null;
    }
    this.currentFile = { path, fileName };
    this._revokeMediaBlobUrl();

    debug('loadMedia called:', {
      fileName,
      path,
      contentType: typeof content,
      contentPreview: typeof content === 'string' ? content.substring(0, 100) : '[non-string]'
    });

    this.dropZone.classList.remove('active');
    this.mediaWrapper.classList.remove('hidden');
    this.mediaWrapper.classList.add('loading');
    this.mediaName.textContent = fileName || 'Loading...';

    if (content == null || content === '') {
      this.showError('No media content received');
      return;
    }

    // Virtual FS binary files (contentBytes → postMessage as ArrayBuffer)
    if (content instanceof ArrayBuffer || ArrayBuffer.isView(content)) {
      const bytes =
        content instanceof ArrayBuffer
          ? new Uint8Array(content)
          : new Uint8Array(content.buffer, content.byteOffset, content.byteLength);
      const mime = this.mimeFromMediaFileName(fileName);
      if (sniffSequenceKind(bytes) || fileLooksLikeSequence(fileName, mime)) {
        this.playSequence(bytes, fileName);
        return;
      }
      this.isAudio = this.detectMediaType(fileName, mime);
      const blob = new Blob([content], { type: mime });
      const url = URL.createObjectURL(blob);
      this._mediaBlobUrl = url;
      debug('Playing binary media from blob URL', mime);
      this.playMedia(url, fileName);
      return;
    }

    // Check if this is a YouTube link
    const youtubeId = this.extractYouTubeId(content);
    if (youtubeId) {
      debug('Playing YouTube video:', youtubeId);
      this.playYouTube(youtubeId, fileName);
      return;
    }

    if (fileLooksLikeSequence(fileName, this.mimeFromMediaFileName(fileName))) {
      this.contentToArrayBuffer(content).then((buf) => {
        if (!buf) {
          this.showError('Could not read MIDI/MMF data');
          return;
        }
        this.playSequence(buf, fileName);
      });
      return;
    }
    if (typeof content === 'string' && content.startsWith('data:')) {
      const mimeType = content.split(';')[0].replace('data:', '');
      this.isAudio = this.detectMediaType(fileName, mimeType);
    } else {
      this.isAudio = this.detectMediaType(fileName);
    }

    if (typeof content === 'string' && content.startsWith('data:')) {
      debug('Playing data URL media');
      this.playMedia(content, fileName);
    } else if (
      typeof content === 'string' &&
      (content.startsWith('blob:') ||
        content.startsWith('http') ||
        content.startsWith('/') ||
        content.startsWith('./') ||
        content.startsWith('../'))
    ) {
      // Double-check this isn't a YouTube URL that was missed
      if (content.includes('youtube.com') || content.includes('youtu.be')) {
        debug('Found YouTube URL in http check, re-parsing...');
        const videoId = this.extractYouTubeId(content);
        if (videoId) {
          this.playYouTube(videoId, fileName);
          return;
        }
      }
      // Absolute paths (`/os/assets/foo.mp3`) and relative paths are resolved against
      // the iframe's document URL by the underlying <audio>/<video> element. Use the
      // same-origin absolute-path form to point at static assets bundled in the repo.
      debug('Playing URL media');
      this.playMedia(content, fileName);
    } else if (content instanceof Blob) {
      if (fileLooksLikeSequence(fileName, content.type)) {
        content.arrayBuffer().then((buf) => this.playSequence(buf, fileName));
        return;
      }
      debug('Playing blob media');
      const url = URL.createObjectURL(content);
      this.playMedia(url, fileName);
    } else {
      console.error('Unsupported content type:', typeof content, content?.substring?.(0, 200));
      if (typeof content === 'string') {
        this.showError(
          `"${fileName}" is a text file, not playable media. ` +
            `Set its content to a media URL, data URL, or YouTube link.`
        );
      } else {
        this.showError('Unsupported media format');
      }
    }
  }

  playMedia(src, name) {
    this.stopMidiPlayback();
    this.dropZone.classList.remove('active');
    this.mediaWrapper.classList.remove('hidden');
    this.mediaWrapper.classList.add('loading');

    // Set up audio or video mode
    if (this.isAudio) {
      this.mediaWrapper.classList.add('audio-mode');
      this.audioVisual.classList.add('visible');
      this.audioTitle.textContent = this.extractTitle(name);
      this.audioArtist.textContent = 'Unknown Artist';
      this.btnPip.disabled = true;

      // Try to extract ID3 tags
      ID3Parser.extractTags(src).then((tags) => {
        if (tags.title) this.audioTitle.textContent = tags.title;
        if (tags.artist) this.audioArtist.textContent = tags.artist;
      });
    } else {
      this.mediaWrapper.classList.remove('audio-mode');
      this.audioVisual.classList.remove('visible');
    }

    this.media.src = src;
    this.mediaName.textContent = name || 'Media';

    // Reset playback speed selector
    this.playbackSpeed.value = '1';
    this.media.playbackRate = 1;

    // Auto-play when ready
    this.media.addEventListener(
      'canplay',
      () => {
        this.media.play().catch(() => {
          // Autoplay blocked, user needs to click
        });
      },
      { once: true }
    );
  }

  extractTitle(fileName) {
    // Remove extension and clean up
    let title = fileName.replace(/\.[^/.]+$/, '');
    // Remove common patterns like "01 - " or "Track 01 "
    title = title.replace(/^[\d\s\-_.]+/, '');
    return title || fileName;
  }

  extractYouTubeId(content) {
    if (typeof content !== 'string') return null;

    let url = content.trim();

    // Handle data URLs - extract the actual content
    if (url.startsWith('data:')) {
      try {
        // Try to decode the data URL
        const base64Match = url.match(/base64,(.+)/);
        if (base64Match) {
          url = atob(base64Match[1]).trim();
        } else {
          // Plain text data URL
          const dataMatch = url.match(/,(.+)/);
          if (dataMatch) {
            url = decodeURIComponent(dataMatch[1]).trim();
          }
        }
      } catch (e) {
        console.error('Failed to decode data URL:', e);
        return null;
      }
    }

    // Strip any surrounding quotes that might have been included
    url = url.replace(/^['"]|['"]$/g, '');

    debug('Checking for YouTube ID in:', url.substring(0, 60));

    // Match various YouTube URL formats
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
      /^([a-zA-Z0-9_-]{11})$/ // Just the video ID
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) {
        debug('Found YouTube ID:', match[1]);
        return match[1];
      }
    }

    return null;
  }

  playYouTube(videoId, name) {
    this.stopMidiPlayback();
    this.isYouTube = true;
    this.isAudio = false;

    this.dropZone.classList.remove('active');
    this.mediaWrapper.classList.remove('hidden');
    this.mediaWrapper.classList.add('youtube-mode');
    this.youtubeContainer.classList.add('visible');
    this.audioVisual.classList.remove('visible');

    // Set the YouTube embed URL with autoplay
    // The credentialless attribute on the iframe allows YouTube to work with COEP
    this.youtubePlayer.src = `https://www.youtube.com/embed/${videoId}?rel=0&showinfo=0&autoplay=1&mute=0`;

    // Update display
    const displayName = name ? this.extractTitle(name) : 'YouTube Video';
    this.mediaName.textContent = `▶️ ${displayName}`;

    // Enable some controls (fullscreen works, others don't for YouTube)
    this.btnFullscreen.disabled = false;
    this.btnClose.disabled = false;
    // Disable controls that don't work with YouTube iframe
    this.btnPlayPause.disabled = true;
    this.btnSkipBack.disabled = true;
    this.btnSkipForward.disabled = true;
    this.btnLoop.disabled = true;
    this.playbackSpeed.disabled = true;
    this.btnPip.disabled = true;
    this.timeDisplay.textContent = 'YouTube';
  }

  // ========== MIDI / SMAF ==========

  /**
   * @param {unknown} content
   * @returns {Promise<ArrayBuffer|null>}
   */
  async contentToArrayBuffer(content) {
    if (content instanceof ArrayBuffer) return content;
    if (ArrayBuffer.isView(content)) {
      return content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength);
    }
    if (typeof Blob !== 'undefined' && content instanceof Blob) {
      return content.arrayBuffer();
    }
    if (typeof content === 'string') {
      if (
        content.startsWith('data:') ||
        content.startsWith('blob:') ||
        content.startsWith('http') ||
        content.startsWith('/') ||
        content.startsWith('./') ||
        content.startsWith('../')
      ) {
        try {
          const res = await fetch(content);
          return await res.arrayBuffer();
        } catch (err) {
          console.error('Failed to fetch media bytes', err);
          return null;
        }
      }
    }
    return null;
  }

  /**
   * @param {ArrayBuffer|ArrayBufferView} buf
   * @param {string} name
   */
  playSequence(buf, name) {
    this.stopMidiClock();
    if (this._midiSynth) this._midiSynth.stopMIDI();
    this.dropZone.classList.remove('active');
    this.mediaWrapper.classList.remove('hidden', 'error', 'youtube-mode');
    this.mediaWrapper.classList.add('loading', 'audio-mode', 'midi-mode');
    this.youtubeContainer.classList.remove('visible');
    this.audioVisual.classList.add('visible');
    this.mediaName.textContent = name || 'MIDI';

    this._isResetting = true;
    this.media.removeAttribute('src');
    this.media.load();
    requestAnimationFrame(() => {
      this._isResetting = false;
    });

    let prepared;
    try {
      prepared = prepareMidiBytes(buf, { fileName: name });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not play this MIDI/MMF file';
      this.showError(msg);
      return;
    }

    this.isMidi = true;
    this.isAudio = true;
    this.isYouTube = false;
    this._midiDurationSec = prepared.durationSec || 0;
    this.audioTitle.textContent = prepared.title || this.extractTitle(name);
    this.audioArtist.textContent =
      prepared.artist || (prepared.kind === 'smaf' ? 'SMAF ringtone' : 'MIDI');
    this.resetMidiMixer();
    this.renderMidiChannels(prepared.midi);

    try {
      this.initMidiSynth();
    } catch (err) {
      this.showError('MIDI synthesizer is not available in this browser');
      return;
    }

    const midi = prepared.midi;
    const ab = midi.buffer.slice(midi.byteOffset, midi.byteOffset + midi.byteLength);
    this._midiSynth.loadMIDI(ab);
    this._midiSynth.setLoop(this.isLooping ? 1 : 0);
    this.syncMidiVolume();

    this.playbackSpeed.value = '1';
    if (this.midiSeek) this.midiSeek.value = '0';
    this.enableControls(true);
    this.mediaWrapper.classList.remove('loading');
    this.startMidiClock();
    this.toggleMidiPlayPause(true);
  }

  initMidiSynth() {
    this.ensureAnalyserGraph();
    if (typeof WebAudioTinySynth !== 'function') {
      throw new Error('WebAudioTinySynth missing');
    }
    if (!this._midiSynth) {
      this._midiSynth = new WebAudioTinySynth({ quality: 1, voices: 64, useReverb: 1 });
    }
    this.wrapMidiSend();
    this._midiSynth.setAudioContext(this.audioCtx, this.analyser);
    if (!this._analyserToDest && this.analyser && this.audioCtx) {
      this.analyser.connect(this.audioCtx.destination);
      this._analyserToDest = true;
    }
  }

  ensureAnalyserGraph() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!this.audioCtx) {
      this.audioCtx = new AC();
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
    if (!this.analyser) {
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
      this.timeArray = new Uint8Array(this.analyser.fftSize);
    }
  }

  syncMidiVolume() {
    if (!this._midiSynth) return;
    const lev = this.media.muted ? 0 : 0.5 * this.media.volume;
    this._midiSynth.setMasterVol(lev);
  }

  toggleMidiPlayPause(forcePlay) {
    if (!this._midiSynth) return;
    const st = this._midiSynth.getPlayStatus();
    const shouldPlay = forcePlay === true || !st.play;
    if (shouldPlay) {
      if (this.audioCtx?.state === 'suspended') this.audioCtx.resume();
      this._midiSynth.playMIDI();
      this.btnPlayPause.textContent = '⏸️';
      this.btnPlayPause.title = 'Pause (Space)';
      this.mediaWrapper.classList.add('playing');
      window.heymingAchievements?.unlockForCurrentApp('first-action');
      this.drawSpectrum();
    } else {
      this._midiSynth.stopMIDI();
      this.btnPlayPause.textContent = '▶️';
      this.btnPlayPause.title = 'Play (Space)';
      this.mediaWrapper.classList.remove('playing');
      this.stopSpectrum();
    }
  }

  skipMidi(seconds) {
    if (!this._midiSynth) return;
    const st = this._midiSynth.getPlayStatus();
    if (!st.maxTick) return;
    const dur = this._midiDurationSec || 0;
    const progress = midiProgressFromTicks(st.curTick, st.maxTick);
    const cur = progress * dur;
    const next = dur > 0 ? Math.max(0, Math.min(dur, cur + seconds)) : 0;
    const tick = midiTickFromProgress(st.maxTick, dur > 0 ? next / dur : 0);
    this._midiSynth.locateMIDI(tick);
    this.updateMidiClock();
  }

  seekMidiFromSlider() {
    if (!this._midiSynth || !this.midiSeek) return;
    const st = this._midiSynth.getPlayStatus();
    if (!st.maxTick) return;
    const progress = Number(this.midiSeek.value) / MIDI_SEEK_MAX;
    const tick = midiTickFromProgress(st.maxTick, progress);
    this._midiSynth.locateMIDI(tick);
    const dur = this._midiDurationSec || 0;
    const cur = progress * dur;
    this.timeDisplay.textContent = `${this.formatTime(cur)} / ${this.formatTime(dur)}`;
  }

  startMidiClock() {
    this.stopMidiClock();
    this.updateMidiClock();
    this._midiTimer = setInterval(() => this.updateMidiClock(), 100);
  }

  stopMidiClock() {
    if (this._midiTimer) {
      clearInterval(this._midiTimer);
      this._midiTimer = null;
    }
  }

  updateMidiClock() {
    if (!this.isMidi || !this._midiSynth) return;
    const st = this._midiSynth.getPlayStatus();
    const dur = this._midiDurationSec || 0;
    const progress = midiProgressFromTicks(st.curTick, st.maxTick);
    const cur = progress * dur;
    this.timeDisplay.textContent = `${this.formatTime(cur)} / ${this.formatTime(dur)}`;
    if (!this._midiSeeking && this.midiSeek) {
      this.midiSeek.value = String(Math.round(progress * MIDI_SEEK_MAX));
    }
    this.applyMutedChannelVolumes();
    if (!st.play && st.maxTick > 0 && st.curTick >= st.maxTick && !this.isLooping) {
      this.btnPlayPause.textContent = '▶️';
      this.btnPlayPause.title = 'Play (Space)';
      this.mediaWrapper.classList.remove('playing');
      this.stopSpectrum();
    }
  }

  stopMidiPlayback() {
    this.stopMidiClock();
    if (this._midiSynth) {
      this._midiSynth.stopMIDI();
      this._midiSynth.setLoop(0);
    }
    this.isMidi = false;
    this._midiDurationSec = 0;
    this._midiSeeking = false;
    this.resetMidiMixer();
    this.mediaWrapper.classList.remove('midi-mode');
    if (this.midiSeek) {
      this.midiSeek.value = '0';
      this.midiSeek.disabled = true;
    }
  }

  wrapMidiSend() {
    if (!this._midiSynth || this._midiSendWrapped) return;
    const orig = this._midiSynth.send.bind(this._midiSynth);
    this._midiOrigSend = orig;
    this._midiSynth.send = (msg, t) => {
      if (!msg || !msg.length) return orig(msg, t);
      const status = msg[0];
      if (status < 0x80 || status >= 0xf0) return orig(msg, t);
      const hi = status & 0xf0;
      const ch = status & 0x0f;
      if (!this.isMidiChannelMuted(ch)) return orig(msg, t);
      if (hi === 0x90) {
        orig([status, msg[1], 0], t);
        return;
      }
      if (hi === 0xb0 && (msg[1] === 7 || msg[1] === 11)) {
        orig([status, msg[1], 0], t);
        return;
      }
      orig(msg, t);
    };
    this._midiSendWrapped = true;
  }

  isMidiChannelMuted(ch) {
    if (this._midiSolo != null) return ch !== this._midiSolo;
    return this._midiMuted.has(ch);
  }

  applyMutedChannelVolumes() {
    if (!this._midiSynth) return;
    for (let ch = 0; ch < 16; ch++) {
      if (!this.isMidiChannelMuted(ch)) continue;
      if (typeof this._midiSynth.setChVol === 'function') {
        this._midiSynth.setChVol(ch, 0);
      }
    }
  }

  silenceMidiChannel(ch) {
    const send = this._midiOrigSend || this._midiSynth?.send?.bind(this._midiSynth);
    if (!send) return;
    send([0xb0 | ch, 123, 0]);
    send([0xb0 | ch, 120, 0]);
    send([0xb0 | ch, 7, 0]);
    if (typeof this._midiSynth.setChVol === 'function') this._midiSynth.setChVol(ch, 0);
  }

  resetMidiMixer() {
    this._midiMuted = new Set();
    this._midiSolo = null;
    if (this.midiChannelList) this.midiChannelList.replaceChildren();
  }

  renderMidiChannels(midiBytes) {
    if (!this.midiChannelList) return;
    this.midiChannelList.replaceChildren();
    const rows = listMidiChannels(midiBytes);
    for (const info of rows) {
      const row = document.createElement('div');
      row.className = 'midi-ch-row';
      row.dataset.channel = String(info.channel);

      const name = document.createElement('span');
      name.className = 'midi-ch-name';
      name.textContent = midiChannelLabel(info.channel, info.program);

      const muteBtn = document.createElement('button');
      muteBtn.type = 'button';
      muteBtn.textContent = 'Mute';
      muteBtn.setAttribute('aria-pressed', 'false');
      muteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleMidiMute(info.channel);
      });

      const soloBtn = document.createElement('button');
      soloBtn.type = 'button';
      soloBtn.textContent = 'Solo';
      soloBtn.setAttribute('aria-pressed', 'false');
      soloBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleMidiSolo(info.channel);
      });

      row.append(name, muteBtn, soloBtn);
      this.midiChannelList.appendChild(row);
    }
    this.syncMidiMixerButtons();
  }

  toggleMidiMute(ch) {
    if (this._midiMuted.has(ch)) this._midiMuted.delete(ch);
    else {
      this._midiMuted.add(ch);
      this.silenceMidiChannel(ch);
    }
    this.applyMutedChannelVolumes();
    this.syncMidiMixerButtons();
  }

  toggleMidiSolo(ch) {
    this._midiSolo = this._midiSolo === ch ? null : ch;
    for (let i = 0; i < 16; i++) {
      if (this.isMidiChannelMuted(i)) this.silenceMidiChannel(i);
    }
    this.applyMutedChannelVolumes();
    this.syncMidiMixerButtons();
  }

  syncMidiMixerButtons() {
    if (!this.midiChannelList) return;
    for (const row of this.midiChannelList.querySelectorAll('.midi-ch-row')) {
      const ch = Number(row.dataset.channel);
      const muted = this.isMidiChannelMuted(ch);
      row.classList.toggle('muted', muted);
      const [muteBtn, soloBtn] = row.querySelectorAll('button');
      if (muteBtn) {
        muteBtn.classList.toggle('active', this._midiMuted.has(ch));
        muteBtn.setAttribute('aria-pressed', this._midiMuted.has(ch) ? 'true' : 'false');
      }
      if (soloBtn) {
        soloBtn.classList.toggle('active', this._midiSolo === ch);
        soloBtn.setAttribute('aria-pressed', this._midiSolo === ch ? 'true' : 'false');
      }
    }
  }

  // ========== Audio Visualizer ==========

  initAudioContext(mediaElement) {
    this.ensureAnalyserGraph();
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
    if (mediaElement._heymingMediaSource) return;
    const source = this.audioCtx.createMediaElementSource(mediaElement);
    mediaElement._heymingMediaSource = source;
    source.connect(this.analyser);
    if (!this._analyserToDest) {
      this.analyser.connect(this.audioCtx.destination);
      this._analyserToDest = true;
    }
  }

  drawSpectrum() {
    this.stopSpectrum();
    if (!this.vizCanvas || !this.analyser || !this.dataArray) return;

    const canvas = this.vizCanvas;
    if (!this.vizCtx) {
      this.vizCtx = canvas.getContext('2d');
    }
    const ctx = this.vizCtx;

    const draw = () => {
      this._vizRafId = requestAnimationFrame(draw);

      const rect = canvas.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;
      // Back the canvas at device resolution so enlarging the panel sharpens
      // the trace instead of upscaling a 1x buffer, then draw in CSS pixels.
      const dpr = window.devicePixelRatio || 1;
      const bufferWidth = Math.max(1, Math.round(width * dpr));
      const bufferHeight = Math.max(1, Math.round(height * dpr));
      if (canvas.width !== bufferWidth || canvas.height !== bufferHeight) {
        canvas.width = bufferWidth;
        canvas.height = bufferHeight;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      this.analyser.getByteFrequencyData(this.dataArray);
      if (this.timeArray) this.analyser.getByteTimeDomainData(this.timeArray);
      drawVisualizer(ctx, {
        mode: this.vizMode,
        freq: this.dataArray,
        time: this.timeArray,
        width,
        height,
        barTop: brandToken('--accent-blue', '#1a73e8'),
        barBottom: brandToken('--accent-red', '#ea4335'),
        line: brandToken('--accent-green', '#34a853')
      });
    };

    draw();
  }

  stopSpectrum() {
    if (this._vizRafId !== null) {
      cancelAnimationFrame(this._vizRafId);
      this._vizRafId = null;
    }
    if (this.vizCanvas && this.vizCtx) {
      this.vizCtx.setTransform(1, 0, 0, 1, 0, 0);
      this.vizCtx.clearRect(0, 0, this.vizCanvas.width, this.vizCanvas.height);
    }
  }

  showError(message) {
    this.dropZone.classList.remove('active');
    this.mediaWrapper.classList.remove('hidden', 'loading');
    this.mediaWrapper.classList.add('error');

    let overlay = this.mediaWrapper.querySelector('.media-error-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'media-error-overlay';
      this.mediaWrapper.appendChild(overlay);
    }
    overlay.textContent = `⚠️ ${message}`;

    this.mediaName.textContent = `⚠️ ${message}`;
    if (this._errorTimeout) clearTimeout(this._errorTimeout);
    this._errorTimeout = setTimeout(() => {
      this._errorTimeout = null;
      this.mediaWrapper.classList.remove('error');
      this.reset();
    }, 4000);
  }

  reset() {
    this._revokeMediaBlobUrl();
    this.stopSpectrum();
    this.stopMidiPlayback();
    this.media.pause();

    this._isResetting = true;
    this.media.removeAttribute('src');
    this.media.load();
    requestAnimationFrame(() => {
      this._isResetting = false;
    });

    this.mediaWrapper.classList.add('hidden');
    this.mediaWrapper.classList.remove(
      'audio-mode',
      'playing',
      'youtube-mode',
      'midi-mode',
      'loading',
      'error'
    );
    this.audioVisual.classList.remove('visible');
    this.youtubeContainer.classList.remove('visible');
    this.youtubePlayer.removeAttribute('src');
    const errorOverlay = this.mediaWrapper.querySelector('.media-error-overlay');
    if (errorOverlay) errorOverlay.remove();
    const coepOverlay = this.mediaWrapper.querySelector('.youtube-coep-error');
    if (coepOverlay) coepOverlay.remove();
    this.dropZone.classList.add('active');
    this.currentFile = null;
    this.isAudio = false;
    this.isYouTube = false;
    this.enableControls(false);
    this.timeDisplay.textContent = '--:-- / --:--';
    this.btnPlayPause.textContent = '▶️';
    this.isLooping = false;
    this.btnLoop.classList.remove('active');
    this.media.loop = false;
  }
}

// Initialize player
new MediaPlayer();

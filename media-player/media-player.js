/**
 * Heyming OS Media Player
 * Plays video and audio files from the filesystem or dropped from the OS
 */

// Debug logging helper
function debug(...args) {
  if (window.parent?.HeymingOS?.Config?.DEBUG) {
    console.debug('[MediaPlayer]', ...args);
  }
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
    this.vizCanvas = document.getElementById('viz-canvas');
    /** @type {CanvasRenderingContext2D|null} */
    this.vizCtx = null;
    /** @type {AudioContext|null} */
    this.audioCtx = null;
    /** @type {AnalyserNode|null} */
    this.analyser = null;
    /** @type {Uint8Array|null} */
    this.dataArray = null;
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
    this._isResetting = false;
    /** @type {string|null} */
    this._mediaBlobUrl = null;
    /** @type {ReturnType<typeof setTimeout>|null} */
    this._errorTimeout = null;

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
      // Don't toggle if clicking on the seek bar
      if (e.target !== this.audioSeek) {
        this.togglePlayPause();
      }
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
        fileTypes: ['video/*', 'audio/*', 'application/x-youtube'],
        title: 'Open Media'
      });
    } else {
      // Use native file picker in standalone mode
      this.fileInput.click();
    }
  }

  togglePlayPause() {
    if (!this.media.src) return;

    if (this.media.paused) {
      this.media.play();
    } else {
      this.media.pause();
    }
  }

  skip(seconds) {
    if (!this.media.src) return;
    this.media.currentTime = Math.max(
      0,
      Math.min(this.media.duration, this.media.currentTime + seconds)
    );
  }

  adjustVolume(delta) {
    this.media.volume = Math.max(0, Math.min(1, this.media.volume + delta));
  }

  toggleLoop() {
    this.isLooping = !this.isLooping;
    this.media.loop = this.isLooping;
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
    if (!this.media.src && !this.isYouTube) return;

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
    this.playbackSpeed.disabled = !enabled;
    this.btnPip.disabled = !enabled || this.isAudio;
    this.btnFullscreen.disabled = !enabled;
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
    if (mimeType) {
      return mimeType.startsWith('audio/');
    }
    // Fallback to extension check
    const ext = fileName.split('.').pop().toLowerCase();
    const audioExtensions = ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'wma'];
    return audioExtensions.includes(ext);
  }

  handleDrop(e) {
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      if (file.type.startsWith('video/') || file.type.startsWith('audio/')) {
        this.loadMediaFile(file);
      } else {
        this.showError('Please drop a video or audio file');
      }
    }
  }

  loadMediaFile(file) {
    const url = URL.createObjectURL(file);
    this.currentFile = { fileName: file.name };
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
      const mime = this.mimeFromMediaFileName(fileName);
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

    // Detect if audio based on content type or filename
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

  // ========== Audio Visualizer ==========

  initAudioContext(mediaElement) {
    if (this.audioCtx) {
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }
      return;
    }
    this.audioCtx = new AudioContext();
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 256;
    this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    const source = this.audioCtx.createMediaElementSource(mediaElement);
    source.connect(this.analyser);
    this.analyser.connect(this.audioCtx.destination);
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
      if (canvas.width !== rect.width || canvas.height !== rect.height) {
        canvas.width = rect.width;
        canvas.height = rect.height;
      }

      const width = canvas.width;
      const height = canvas.height;

      this.analyser.getByteFrequencyData(this.dataArray);
      ctx.clearRect(0, 0, width, height);

      const gradient = ctx.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, '#06b6d4');
      gradient.addColorStop(1, '#8b5cf6');
      ctx.fillStyle = gradient;

      const bufferLength = this.dataArray.length;
      const barWidth = (width / bufferLength) * 2.5;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const barHeight = (this.dataArray[i] / 255) * height;
        ctx.fillRect(x, height - barHeight, barWidth - 1, barHeight);
        x += barWidth;
        if (x > width) break;
      }
    };

    draw();
  }

  stopSpectrum() {
    if (this._vizRafId !== null) {
      cancelAnimationFrame(this._vizRafId);
      this._vizRafId = null;
    }
    if (this.vizCanvas && this.vizCtx) {
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
    this.media.pause();

    this._isResetting = true;
    this.media.removeAttribute('src');
    this.media.load();
    requestAnimationFrame(() => {
      this._isResetting = false;
    });

    this.mediaWrapper.classList.add('hidden');
    this.mediaWrapper.classList.remove('audio-mode', 'playing', 'youtube-mode', 'loading', 'error');
    this.audioVisual.classList.remove('visible');
    this.youtubeContainer.classList.remove('visible');
    this.youtubePlayer.src = '';
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

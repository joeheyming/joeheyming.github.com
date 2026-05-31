// VideoManager - Singleton for managing background video playback
// Centralizes video state, handles loading races, and syncs with audio

import { videoConverter } from './videoConverter.js';
import { songManager } from './songManager.js';
import { audioManager } from './audioManager.js';
import { logVideoError, logVideoLoad } from './videoLoadLogging.js';
import { videoContextStatusMessage } from './videoContextCopy.js';

class VideoManager {
  constructor() {
    if (VideoManager.instance) {
      return VideoManager.instance;
    }
    VideoManager.instance = this;

    /** @type {HTMLVideoElement|null} */
    this.videoElement = null;
    /** @type {HTMLElement|null} */
    this.gameArea = null;

    /** Currently playing/loaded video URL */
    this.currentVideoUrl = null;
    /** URL currently being loaded (to prevent race conditions) */
    this.loadingUrl = null;
    /** Status container element for conversion progress */
    this.statusElement = null;
    /** Status text element (span inside container) */
    this.statusTextElement = null;

    /** Audio time when video playback was triggered (for calculating video offset) */
    this.videoStartAudioTime = 0;

    /** Interval ID for periodic sync */
    this._syncIntervalId = null;

    /** Unsubscribe functions for audio events */
    this._audioUnsubscribers = [];
  }

  /**
   * Initialize the video manager (gets DOM elements internally)
   */
  init() {
    this.videoElement = document.getElementById('background-video');
    this.gameArea = document.getElementById('sm-micro');
    this.statusElement = document.getElementById('video-conversion-status');
    this.statusTextElement = document.getElementById('video-status-text');

    if (!this.videoElement || !this.gameArea) {
      console.warn('VideoManager: Required elements not found');
      return;
    }

    // Subscribe to audio events via AudioManager
    this._subscribeToAudio();
  }

  /**
   * Subscribe to AudioManager events for video sync
   */
  _subscribeToAudio() {
    // Clean up any existing subscriptions
    this._unsubscribeFromAudio();

    // Subscribe to audio events
    this._audioUnsubscribers.push(
      audioManager.onPlay(() => this._onAudioPlay()),
      audioManager.onPause(() => this._onAudioPause()),
      audioManager.onSeeked(() => this._onAudioSeeked())
    );
  }

  /**
   * Unsubscribe from AudioManager events
   */
  _unsubscribeFromAudio() {
    this._audioUnsubscribers.forEach((unsub) => unsub());
    this._audioUnsubscribers = [];
  }

  /**
   * Handle audio play event - sync and play video
   */
  _onAudioPlay() {
    if (this.videoElement && this.currentVideoUrl) {
      this._syncVideoToAudio();
      this.videoElement.play().catch(() => {});
      this._startPeriodicSync();
    }
  }

  /**
   * Handle audio pause event - pause video
   */
  _onAudioPause() {
    if (this.videoElement && this.currentVideoUrl) {
      this.videoElement.pause();
      this._syncVideoToAudio();
      this._stopPeriodicSync();
    }
  }

  /**
   * Handle audio seek event - sync video time
   */
  _onAudioSeeked() {
    this._syncVideoToAudio();
  }

  /**
   * Sync video time to audio time (audio is source of truth)
   * Video time = audio time - video start time (when video was triggered)
   */
  _syncVideoToAudio() {
    if (!this.videoElement || !this.currentVideoUrl) return;

    // Calculate what video time should be based on when video was triggered
    const audioTime = audioManager.currentTime;
    const expectedVideoTime = Math.max(0, audioTime - this.videoStartAudioTime);
    const actualVideoTime = this.videoElement.currentTime;
    const timeDiff = Math.abs(actualVideoTime - expectedVideoTime);

    // Sync if drift exceeds threshold (150ms for smoother sync)
    if (timeDiff > 0.15) {
      this.videoElement.currentTime = expectedVideoTime;
    }
  }

  /**
   * Start periodic sync to keep video in step with audio
   */
  _startPeriodicSync() {
    this._stopPeriodicSync();
    // Sync every 500ms to catch drift
    this._syncIntervalId = setInterval(() => {
      if (!audioManager.paused && this.currentVideoUrl) {
        this._syncVideoToAudio();
      }
    }, 500);
  }

  /**
   * Stop periodic sync
   */
  _stopPeriodicSync() {
    if (this._syncIntervalId) {
      clearInterval(this._syncIntervalId);
      this._syncIntervalId = null;
    }
  }

  /**
   * Show status message (for video conversion progress)
   * @param {string} message - Status message
   * @param {string} type - Status type: 'loading', 'ready', 'failed'
   */
  showStatus(message, type = 'loading') {
    if (!this.statusElement) return;

    // Update text in the text element (span) if available, otherwise the container
    if (this.statusTextElement) {
      this.statusTextElement.textContent = message;
    } else {
      this.statusElement.textContent = message;
    }

    // Show the container
    this.statusElement.classList.remove('hidden');

    // Set color based on type — semantic brand tokens so a theme swap re-tints
    // these without touching this module.
    if (type === 'ready') {
      this.statusElement.style.color = 'var(--success)';
    } else if (type === 'failed') {
      this.statusElement.style.color = 'var(--danger)';
    } else {
      this.statusElement.style.color = 'var(--accent-primary)';
    }
  }

  /**
   * Hide status message
   */
  hideStatus() {
    if (!this.statusElement) return;
    this.statusElement.classList.add('hidden');
  }

  /**
   * Fall back to static background image
   */
  _fallbackToBackground() {
    const currentSongData = songManager.getCurrentSongData();
    if (currentSongData && currentSongData.background && this.gameArea) {
      this.gameArea.style.backgroundImage = `linear-gradient(rgba(0, 0, 0, 0.7), rgba(0, 0, 0, 0.7)), url(${currentSongData.background})`;
    }
  }

  /**
   * Play a video URL (handles AVI conversion if needed)
   * @param {string} videoUrl - URL of the video to play
   * @param {boolean} [isAvi=false] - Whether this is an AVI file needing conversion
   * @returns {Promise<boolean>} - Whether video started successfully
   */
  async play(videoUrl, isAvi = false) {
    if (!this.videoElement || !this.gameArea) {
      logVideoLoad('play.aborted', { reason: 'VideoManager not initialized' });
      console.warn('VideoManager not initialized');
      return false;
    }

    const isAviPath = isAvi || videoConverter.isAviFile(videoUrl);
    logVideoLoad('play.start', {
      videoUrl,
      isAviParam: isAvi,
      isAviFile: videoConverter.isAviFile(videoUrl),
      isAviPath,
      needsConversion: videoConverter.needsConversion(videoUrl),
      sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
      crossOriginIsolated: typeof window !== 'undefined' && window.crossOriginIsolated === true,
      songKey: songManager.getCurrentSongKey?.() ?? null,
      difficultyIndex: songManager.getCurrentDifficulty?.() ?? null,
      loadingUrlBefore: this.loadingUrl
    });

    // Prevent duplicate loads of the same URL
    if (this.loadingUrl === videoUrl) {
      logVideoLoad('play.skipDuplicate', {
        videoUrl,
        note: 'Same URL already loading; early return (can race with preload or bg change)'
      });
      return true; // Already loading this URL
    }

    // Record when video was triggered (for sync calculation)
    // This is the audio time at which the video SHOULD have started
    this.videoStartAudioTime = audioManager.currentTime;

    // Set loading state
    this.loadingUrl = videoUrl;

    // Handle AVI conversion
    if (isAviPath) {
      if (!videoConverter.needsConversion(videoUrl)) {
        logVideoLoad('play.notSupported', {
          videoUrl,
          reason: 'AVI path but conversion unavailable',
          isSupported: videoConverter.isSupported()
        });
        this.showStatus(videoContextStatusMessage('ingameStatus'), 'failed');
        setTimeout(() => this.hideStatus(), 3000);
        this._fallbackToBackground();
        this.loadingUrl = null;
        return false;
      }

      this.showStatus('🎬 Converting video... 0%', 'loading');

      try {
        const convertedUrl = await videoConverter.getPlayableUrl(videoUrl, (progress) => {
          this.showStatus(`🎬 Converting video... ${progress}%`, 'loading');
        });

        // Check if we're still supposed to load this video
        if (this.loadingUrl !== videoUrl) {
          logVideoLoad('play.superseded', {
            requestedUrl: videoUrl,
            currentLoadingUrl: this.loadingUrl,
            note: 'Another play() or reset happened while converting'
          });
          return false; // Another video load was requested
        }

        if (convertedUrl === videoUrl) {
          logVideoLoad('play.conversionYieldedOriginal', {
            videoUrl,
            note: 'getPlayableUrl returned same URL; conversion failed or not needed'
          });
          this.showStatus('🎬 Video unavailable', 'failed');
          setTimeout(() => this.hideStatus(), 3000);
          this._fallbackToBackground();
          this.loadingUrl = null;
          return false;
        }

        logVideoLoad('play.conversionOk', { originalUrl: videoUrl, convertedUrlPrefix: 'blob:' });
        this.showStatus('🎬 Video ready!', 'ready');
        setTimeout(() => this.hideStatus(), 2000);
        videoUrl = convertedUrl;
      } catch (error) {
        logVideoError('play.conversionThrew', error, { videoUrl });
        this.showStatus('🎬 Video unavailable', 'failed');
        setTimeout(() => this.hideStatus(), 3000);
        this._fallbackToBackground();
        this.loadingUrl = null;
        return false;
      }
    }

    // Load and play the video
    return this._loadAndPlay(videoUrl);
  }

  /**
   * Internal method to load and play a video URL
   * @param {string} videoUrl - URL to load
   * @returns {Promise<boolean>}
   */
  _loadAndPlay(videoUrl) {
    return new Promise((resolve) => {
      const originalLoadingUrl = this.loadingUrl;
      const isBlob = typeof videoUrl === 'string' && videoUrl.startsWith('blob:');

      logVideoLoad('loadAndPlay.start', {
        videoUrl: isBlob ? 'blob:…' : videoUrl,
        isBlob,
        originalLoadingUrl
      });

      this.gameArea.style.backgroundImage = 'none';

      // Tag the element with current-song info so a global resource_error
      // (which only sees the failed URL) can be correlated back to a
      // specific simfile. The Zenius-uploaded preview videos occasionally
      // 404; without this tag we can't tell which song is broken.
      const songKey = songManager.getCurrentSongKey?.() || 'unknown';
      this.videoElement.dataset.errorContext = `song=${String(songKey).slice(0, 60)}`;

      // Pause any current playback
      this.videoElement.pause();
      this.videoElement.src = videoUrl;
      this.videoElement.style.opacity = '1';

      const onCanPlay = () => {
        cleanup();

        // Check if this is still the video we want
        if (this.loadingUrl !== originalLoadingUrl) {
          logVideoLoad('loadAndPlay.aborted', {
            reason: 'loadingUrl changed before canplay',
            expected: originalLoadingUrl,
            current: this.loadingUrl
          });
          resolve(false);
          return;
        }

        // Calculate where video should be based on when it was triggered
        // Video time = current audio time - audio time when video was triggered
        const audioTime = audioManager.currentTime;
        const expectedVideoTime = Math.max(0, audioTime - this.videoStartAudioTime);
        if (expectedVideoTime > 0) {
          this.videoElement.currentTime = expectedVideoTime;
        }

        // Only auto-play if audio is playing
        if (audioManager.paused) {
          logVideoLoad('loadAndPlay.bufferedWhileAudioPaused', {
            videoUrl: isBlob ? 'blob:…' : videoUrl,
            isBlob
          });
          this.currentVideoUrl = videoUrl;
          this.loadingUrl = null;
          resolve(true);
          return;
        }

        this.videoElement
          .play()
          .then(() => {
            logVideoLoad('loadAndPlay.playing', {
              videoUrl: isBlob ? 'blob:…' : videoUrl,
              isBlob
            });
            this.currentVideoUrl = videoUrl;
            this.loadingUrl = null;
            this._startPeriodicSync();
            resolve(true);
          })
          .catch((err) => {
            if (err.name !== 'AbortError') {
              logVideoError('loadAndPlay.playRejected', err, {
                videoUrl: isBlob ? 'blob:…' : videoUrl,
                isBlob
              });
            }
            this.videoElement.style.opacity = '0';
            this.currentVideoUrl = null;
            this.loadingUrl = null;
            this._fallbackToBackground();
            resolve(false);
          });
      };

      const onError = (e) => {
        cleanup();
        const v = this.videoElement;
        const me = v.error;
        const codeNames = {
          1: 'MEDIA_ERR_ABORTED',
          2: 'MEDIA_ERR_NETWORK',
          3: 'MEDIA_ERR_DECODE',
          4: 'MEDIA_ERR_SRC_NOT_SUPPORTED'
        };
        logVideoLoad('loadAndPlay.elementError', {
          eventType: e.type,
          networkState: v.networkState,
          readyState: v.readyState,
          src: (v.currentSrc || v.src || '').slice(0, 200),
          mediaErrorCode: me ? me.code : null,
          mediaErrorCodeName: me ? codeNames[me.code] || String(me.code) : null,
          mediaErrorMessage: me ? me.message : null
        });
        this.videoElement.style.opacity = '0';
        this.currentVideoUrl = null;
        this.loadingUrl = null;
        this._fallbackToBackground();
        resolve(false);
      };

      const cleanup = () => {
        this.videoElement.removeEventListener('canplaythrough', onCanPlay);
        this.videoElement.removeEventListener('error', onError);
      };

      this.videoElement.addEventListener('canplaythrough', onCanPlay, { once: true });
      this.videoElement.addEventListener('error', onError, { once: true });

      // Start loading
      this.videoElement.load();
    });
  }

  /**
   * Stop and hide the video
   *
   * NOTE: We `removeAttribute('src')` + `load()` rather than `src = ''`
   * because empty-string src resolves to the document URL, which the
   * browser tries to load as video, fails, and fires `error`. The
   * global resource-error listener in `/analytics.js` then reports a
   * fake "Failed to load VIDEO: joeheyming.github.io/stepmania" event
   * for every song stop. Until 2026-05-30 this single line accounted
   * for ~89% of all `error_occurred` events on the entire site.
   */
  stop() {
    this._stopPeriodicSync();
    if (this.videoElement) {
      this.videoElement.pause();
      this.videoElement.removeAttribute('src');
      this.videoElement.load();
      this.videoElement.style.opacity = '0';
      delete this.videoElement.dataset.errorContext;
    }
    this.currentVideoUrl = null;
    this.loadingUrl = null;
    this.videoStartAudioTime = 0;
  }

  /**
   * Pause the video
   */
  pause() {
    if (this.videoElement && this.currentVideoUrl) {
      this.videoElement.pause();
      this._stopPeriodicSync();
    }
  }

  /**
   * Resume the video
   */
  resume() {
    if (this.videoElement && this.currentVideoUrl) {
      this._syncVideoToAudio();
      this.videoElement.play().catch(() => {});
      this._startPeriodicSync();
    }
  }

  /**
   * Check if a video is currently playing or loading
   * @returns {boolean}
   */
  isActive() {
    return !!(this.currentVideoUrl || this.loadingUrl);
  }

  /**
   * Check if a specific URL is currently loaded
   * @param {string} url - URL to check
   * @returns {boolean}
   */
  isPlaying(url) {
    return this.currentVideoUrl === url;
  }

  /**
   * Reset all state (call when song ends or changes)
   */
  reset() {
    this.stop();
    this.hideStatus();
  }

  /**
   * Clean up resources
   */
  destroy() {
    this._unsubscribeFromAudio();
    this.reset();
    this.videoElement = null;
    this.gameArea = null;
    this.statusElement = null;
    this.statusTextElement = null;
  }
}

// Create and export singleton instance
const videoManager = new VideoManager();

// Make globally accessible for non-module scripts
window.videoManager = videoManager;

export { VideoManager, videoManager };

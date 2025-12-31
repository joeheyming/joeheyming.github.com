// VideoManager - Singleton for managing background video playback
// Centralizes video state, handles loading races, and syncs with audio

import { videoConverter } from './videoConverter.js';
import { songManager } from './songManager.js';
import { audioManager } from './audioManager.js';

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

    // Set color based on type
    if (type === 'ready') {
      this.statusElement.style.color = '#86efac'; // green
    } else if (type === 'failed') {
      this.statusElement.style.color = '#fca5a5'; // red
    } else {
      this.statusElement.style.color = '#93c5fd'; // blue (loading)
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
      console.warn('VideoManager not initialized');
      return false;
    }

    // Prevent duplicate loads of the same URL
    if (this.loadingUrl === videoUrl) {
      return true; // Already loading this URL
    }

    // Record when video was triggered (for sync calculation)
    // This is the audio time at which the video SHOULD have started
    this.videoStartAudioTime = audioManager.currentTime;

    // Set loading state
    this.loadingUrl = videoUrl;

    // Handle AVI conversion
    if (isAvi || videoConverter.isAviFile(videoUrl)) {
      if (!videoConverter.needsConversion(videoUrl)) {
        // Can't convert - SharedArrayBuffer not available
        this.showStatus('🎬 Video not supported', 'failed');
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
          return false; // Another video load was requested
        }

        if (convertedUrl === videoUrl) {
          // Conversion failed, returned original URL
          this.showStatus('🎬 Video unavailable', 'failed');
          setTimeout(() => this.hideStatus(), 3000);
          this._fallbackToBackground();
          this.loadingUrl = null;
          return false;
        }

        this.showStatus('🎬 Video ready!', 'ready');
        setTimeout(() => this.hideStatus(), 2000);
        videoUrl = convertedUrl;
      } catch (error) {
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

      this.gameArea.style.backgroundImage = 'none';

      // Pause any current playback
      this.videoElement.pause();
      this.videoElement.src = videoUrl;
      this.videoElement.style.opacity = '1';

      const onCanPlay = () => {
        cleanup();

        // Check if this is still the video we want
        if (this.loadingUrl !== originalLoadingUrl) {
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
          this.currentVideoUrl = videoUrl;
          this.loadingUrl = null;
          resolve(true);
          return;
        }

        this.videoElement
          .play()
          .then(() => {
            this.currentVideoUrl = videoUrl;
            this.loadingUrl = null;
            this._startPeriodicSync();
            resolve(true);
          })
          .catch((err) => {
            if (err.name !== 'AbortError') {
              console.error('Video play() failed:', err);
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
        console.error('Video element error:', e);
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
   */
  stop() {
    this._stopPeriodicSync();
    if (this.videoElement) {
      this.videoElement.pause();
      this.videoElement.src = '';
      this.videoElement.style.opacity = '0';
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

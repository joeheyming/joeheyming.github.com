// SongManager - Singleton for managing song loading and state
// Single source of truth for current song, parsed data cache, and audio loading

import { audioManager } from './audioManager.js';
import {
  extractSimfileId,
  fetchZeniusSimfile,
  parseZeniusSimfile,
  loadLocalSimfile,
  fetchZeniusAudioFromZip
} from './songLoader.js';

// Audio loading constants
const AUDIO_PROXY_TIMEOUT = 10000; // 10 seconds - fail fast if blocked
const AUDIO_PROXY_MAX_RETRIES = 1;
// Minimum bytes to consider audio valid - proxy errors often return small HTML error pages
const MIN_VALID_AUDIO_SIZE = 1000;

class SongManager {
  constructor() {
    if (SongManager.instance) {
      return SongManager.instance;
    }
    SongManager.instance = this;

    /** Current song info */
    this._currentSong = null; // { key: string, data: object }

    /** Current difficulty index */
    this._currentDifficulty = 0;

    /** Parsed song data cache (songKey -> parsedData) */
    this._parsedSongs = new Map();

    /** Loading state to prevent concurrent loads */
    this._isLoading = false;

    /** Event callbacks */
    this._callbacks = {
      songChanged: [],
      difficultyChanged: [],
      loadStart: [],
      loadProgress: [],
      loadComplete: [],
      loadError: []
    };
  }

  // ===========================================================================
  // GETTERS
  // ===========================================================================

  /**
   * Get current song info
   * @returns {{ key: string, data: object } | null}
   */
  getCurrentSong() {
    return this._currentSong;
  }

  /**
   * Get current song key
   * @returns {string | null}
   */
  getCurrentSongKey() {
    return this._currentSong?.key || null;
  }

  /**
   * Get current song data
   * @returns {object | null}
   */
  getCurrentSongData() {
    return this._currentSong?.data || null;
  }

  /**
   * Get current difficulty index
   * @returns {number}
   */
  getCurrentDifficulty() {
    return this._currentDifficulty;
  }

  /**
   * Get parsed data for a song
   * @param {string} songKey
   * @returns {object | null}
   */
  getParsedData(songKey) {
    return this._parsedSongs.get(songKey) || null;
  }

  /**
   * Get parsed data for current song
   * @returns {object | null}
   */
  getCurrentParsedData() {
    if (!this._currentSong) return null;
    return this._parsedSongs.get(this._currentSong.key) || null;
  }

  /**
   * Get current chart based on difficulty
   * @returns {object | null}
   */
  getCurrentChart() {
    const parsed = this.getCurrentParsedData();
    if (!parsed || !parsed.charts) return null;
    return parsed.charts[this._currentDifficulty] || parsed.charts[0] || null;
  }

  /**
   * Get all charts for current song
   * @returns {Array}
   */
  getCurrentCharts() {
    const parsed = this.getCurrentParsedData();
    return parsed?.charts || [];
  }

  /**
   * Check if currently loading
   * @returns {boolean}
   */
  isLoading() {
    return this._isLoading;
  }

  // ===========================================================================
  // SETTERS
  // ===========================================================================

  /**
   * Set current song
   * @param {string} key - Song key
   * @param {object} data - Song data (title, artist, url, background, video, etc.)
   */
  setCurrentSong(key, data) {
    const oldSong = this._currentSong;
    this._currentSong = { key, data };
    this._emitEvent('songChanged', { song: this._currentSong, previousSong: oldSong });
  }

  /**
   * Set current difficulty
   * @param {number} index - Difficulty index
   */
  setCurrentDifficulty(index) {
    const oldDifficulty = this._currentDifficulty;
    this._currentDifficulty = index ?? 0;
    if (oldDifficulty !== this._currentDifficulty) {
      this._emitEvent('difficultyChanged', {
        difficulty: this._currentDifficulty,
        previousDifficulty: oldDifficulty
      });
    }
  }

  /**
   * Cache parsed song data
   * @param {string} songKey
   * @param {object} parsedData
   */
  cacheParsedData(songKey, parsedData) {
    this._parsedSongs.set(songKey, parsedData);
  }

  // ===========================================================================
  // LOADING - ZENIUS
  // ===========================================================================

  /**
   * Load a song from Zenius-I-Vanisher URL
   * @param {string} zeniusUrl - Full Zenius URL
   * @param {Function} [onProgress] - Progress callback (message, percent)
   * @returns {Promise<{ songKey: string, songData: object, parsedData: object }>}
   */
  async loadFromZenius(zeniusUrl, onProgress = null) {
    if (this._isLoading) {
      throw new Error('Already loading a song');
    }

    this._isLoading = true;
    this._emitEvent('loadStart', { source: 'zenius', url: zeniusUrl });

    try {
      onProgress?.('Parsing song URL...', 5);

      const simfileId = extractSimfileId(zeniusUrl);
      if (!simfileId) {
        throw new Error('Could not extract simfile ID from URL');
      }

      onProgress?.('Fetching simfile data...', 15);
      const simfileData = await fetchZeniusSimfile(simfileId);

      onProgress?.('Parsing simfile charts...', 50);
      const { songKey, songData, parsedData } = parseZeniusSimfile(simfileData, simfileId);

      // Cache the parsed data
      this.cacheParsedData(songKey, parsedData);

      // Set as current song
      this.setCurrentSong(songKey, songData);

      onProgress?.('Song loaded', 70);

      this._emitEvent('loadComplete', { songKey, songData, parsedData });

      return { songKey, songData, parsedData, simfileData };
    } catch (error) {
      this._emitEvent('loadError', { error, source: 'zenius' });
      throw error;
    } finally {
      this._isLoading = false;
    }
  }

  // ===========================================================================
  // LOADING - LOCAL
  // ===========================================================================

  /**
   * Load a local simfile
   * @param {string} simfileUrl - URL to .sm file
   * @param {Function} [onProgress] - Progress callback
   * @returns {Promise<object>} Parsed data
   */
  async loadLocalSimfile(simfileUrl, onProgress = null) {
    onProgress?.('Fetching simfile...', 25);

    const parsedData = await loadLocalSimfile(simfileUrl);

    // Cache it if we have a current song
    if (this._currentSong) {
      this.cacheParsedData(this._currentSong.key, parsedData);
    }

    onProgress?.('Simfile loaded', 50);

    return parsedData;
  }

  // ===========================================================================
  // AUDIO LOADING
  // ===========================================================================

  /**
   * Load audio for the current song with proxy fallbacks
   * @param {Function} [onProgress] - Progress callback (message, percent)
   * @returns {Promise<boolean>} Whether audio loaded successfully
   */
  async loadAudio(onProgress = null) {
    if (!this._currentSong) {
      throw new Error('No current song set');
    }

    const audioUrl = this._currentSong.data.url;
    if (!audioUrl) {
      throw new Error('No audio URL in song data');
    }

    const mimeType = audioUrl.endsWith('.ogg') ? 'audio/ogg' : 'audio/mpeg';

    // Handle Zenius audio with proxy fallbacks
    if (audioUrl.includes('zenius-i-vanisher.com')) {
      return await this._loadZeniusAudio(audioUrl, mimeType, onProgress);
    }

    // Load non-proxied audio directly
    onProgress?.('Loading audio...', 50);
    try {
      await audioManager.loadUrl(audioUrl, mimeType);
      return true;
    } catch (error) {
      console.error('Audio failed to load:', error);
      throw new Error('Audio file could not be played');
    }
  }

  /**
   * Load audio from Zenius with proxy and ZIP fallbacks
   * @private
   */
  async _loadZeniusAudio(audioUrl, mimeType, onProgress) {
    let audioLoaded = false;

    // Try direct proxy download first
    try {
      onProgress?.('Downloading audio file...', 35);

      const audioData = await window.proxyService.fetchBinaryWithProxy(audioUrl, {
        skipDirect: true,
        deferProxies: ['https://corsproxy.io/'],
        headers: {
          Referer: 'https://zenius-i-vanisher.com/',
          Origin: 'https://zenius-i-vanisher.com'
        },
        timeout: AUDIO_PROXY_TIMEOUT,
        maxRetries: AUDIO_PROXY_MAX_RETRIES
      });

      // Check if we got actual audio data (not an error page)
      if (audioData && audioData.byteLength > MIN_VALID_AUDIO_SIZE) {
        await audioManager.loadArrayBuffer(audioData, mimeType);
        audioLoaded = true;
      }
    } catch (error) {
      // Direct download failed, will try ZIP fallback
    }

    // Fallback: Download ZIP and extract audio
    if (!audioLoaded && this._currentSong.key.startsWith('zenius_')) {
      const simfileId = this._currentSong.key.replace('zenius_', '');

      try {
        onProgress?.('Downloading song pack (fallback)...', 45);

        const zipResult = await fetchZeniusAudioFromZip(simfileId);
        if (zipResult) {
          await audioManager.loadBlob(zipResult.audioBlob, zipResult.audioType);
          audioLoaded = true;
        }
      } catch (zipError) {
        // ZIP fallback also failed
      }
    }

    if (!audioLoaded) {
      throw new Error('Could not download audio file. The file may have been removed.');
    }

    return true;
  }

  // ===========================================================================
  // BACKGROUND/VIDEO HELPERS
  // ===========================================================================

  /**
   * Prepare background changes, injecting Zenius video URL if available
   * @param {Array} bgChanges - Original bgChanges from simfile
   * @returns {Array} Modified bgChanges with video URL
   */
  prepareBgChanges(bgChanges = []) {
    const videoUrl = this._currentSong?.data?.video;
    if (!videoUrl) {
      return bgChanges;
    }

    // Check if there's already a video entry
    const existingVideoIndex = bgChanges.findIndex(
      (bg) =>
        bg.isVideo ||
        (bg.file &&
          (bg.file.toLowerCase().endsWith('.avi') ||
            bg.file.toLowerCase().endsWith('.mp4') ||
            bg.file.toLowerCase().endsWith('.webm')))
    );

    if (existingVideoIndex >= 0) {
      // Replace existing video with Zenius URL
      const existingBg = bgChanges[existingVideoIndex];
      bgChanges[existingVideoIndex] = {
        ...existingBg,
        file: videoUrl,
        isVideo: true
      };
    } else {
      // Add Zenius video at beat 0
      bgChanges = [
        {
          beat: 0,
          file: videoUrl,
          effect: '',
          x: 0,
          y: 0,
          isVideo: true,
          isNoBackground: false,
          triggered: false
        },
        ...bgChanges
      ];
    }

    return bgChanges;
  }

  // ===========================================================================
  // CACHE MANAGEMENT
  // ===========================================================================

  /**
   * Check if a song is cached
   * @param {string} songKey
   * @returns {boolean}
   */
  isCached(songKey) {
    return this._parsedSongs.has(songKey);
  }

  /**
   * Clear a specific song from cache
   * @param {string} songKey
   */
  clearFromCache(songKey) {
    this._parsedSongs.delete(songKey);
  }

  /**
   * Clear entire cache
   */
  clearCache() {
    this._parsedSongs.clear();
  }

  /**
   * Get cache size
   * @returns {number}
   */
  getCacheSize() {
    return this._parsedSongs.size;
  }

  // ===========================================================================
  // EVENT SUBSCRIPTION
  // ===========================================================================

  /**
   * Subscribe to song changed events
   * @param {Function} callback - Called with { song, previousSong }
   * @returns {Function} Unsubscribe function
   */
  onSongChanged(callback) {
    return this._subscribe('songChanged', callback);
  }

  /**
   * Subscribe to difficulty changed events
   * @param {Function} callback - Called with { difficulty, previousDifficulty }
   * @returns {Function} Unsubscribe function
   */
  onDifficultyChanged(callback) {
    return this._subscribe('difficultyChanged', callback);
  }

  /**
   * Subscribe to load start events
   * @param {Function} callback
   * @returns {Function} Unsubscribe function
   */
  onLoadStart(callback) {
    return this._subscribe('loadStart', callback);
  }

  /**
   * Subscribe to load complete events
   * @param {Function} callback
   * @returns {Function} Unsubscribe function
   */
  onLoadComplete(callback) {
    return this._subscribe('loadComplete', callback);
  }

  /**
   * Subscribe to load error events
   * @param {Function} callback
   * @returns {Function} Unsubscribe function
   */
  onLoadError(callback) {
    return this._subscribe('loadError', callback);
  }

  // ===========================================================================
  // INTERNAL HELPERS
  // ===========================================================================

  _subscribe(eventType, callback) {
    if (!this._callbacks[eventType]) {
      this._callbacks[eventType] = [];
    }
    this._callbacks[eventType].push(callback);

    return () => {
      const index = this._callbacks[eventType].indexOf(callback);
      if (index > -1) {
        this._callbacks[eventType].splice(index, 1);
      }
    };
  }

  _emitEvent(eventType, data) {
    const callbacks = this._callbacks[eventType] || [];
    callbacks.forEach((callback) => {
      try {
        callback(data);
      } catch (e) {
        console.error(`Error in SongManager ${eventType} callback:`, e);
      }
    });
  }
}

// Create and export singleton instance
const songManager = new SongManager();

// Make globally accessible
window.songManager = songManager;

export { SongManager, songManager };

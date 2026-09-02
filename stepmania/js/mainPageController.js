// Main Page Controller - ES Module
// Orchestrates page initialization, URL handling, song loading, and UI coordination

import gameState from './gameState.js';
import { resetGame } from './stepmania.js';
import {
  extractSimfileId,
  fetchZeniusSimfile,
  parseZeniusSimfile,
  fetchZeniusAudioFromZip,
  formatLoadError
} from './songLoader.js';
import { DifficultySelector } from './difficulty-selector.js';
import { ZeniusBrowser } from './zenius-browser.js';
import { getURLParams, updateURLParams, clearURLParams } from './urlUtils.js';
import { LoadingOverlay } from './loading-overlay.js';
import { videoConverter } from './videoConverter.js';
import { audioManager } from './audioManager.js';
import { songManager } from './songManager.js';
import {
  AUDIO_PROXY_TIMEOUT,
  AUDIO_PROXY_MAX_RETRIES,
  MIN_VALID_AUDIO_SIZE,
  binaryPayloadByteLength
} from './songProxyTransport.js';
import { recordRecentPlay } from './zeniusLibraryStorage.js';
import { bindHomeScreen, hideHomeScreen, showHomeScreen } from './homeScreen.js';
import { logVideoError, logVideoLoad } from './videoLoadLogging.js';

/**
 * Main Page Controller
 * Orchestrates page initialization, URL handling, song loading, and difficulty selection
 */
export class MainPageController {
  constructor() {
    /** @type {string|null} Last Zenius URL loaded (for retry purposes) */
    this.lastZeniusUrl = null;
    /** @type {number|null} Last difficulty selected */
    this.lastDifficulty = null;
    /** @type {string|null} Last song key */
    this.lastSongKey = null;
    /** @type {boolean} Flag to prevent onChange loops during programmatic updates */
    this.isUpdatingDifficulty = false;
    this.init();
  }

  async init() {
    this.bindEvents();
    bindHomeScreen();

    const hasURLParams = await this.initByURL();

    if (!hasURLParams) {
      this.enterHome();
    }
  }

  bindEvents() {
    // Set up main difficulty selector onChange callback
    DifficultySelector.setOnChange((index) => {
      this.onDifficultySelected(index);
    });

    // Show the difficulty selector initially (even if empty)
    DifficultySelector.show();

    // Listen for URL changes (back/forward buttons)
    window.addEventListener('popstate', () => {
      this.handleURLChange();
    });

    // Bind retry button event
    const retryBtn = document.getElementById('main-loading-retry-btn');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => {
        this.handleRetry();
      });
    }

    // Bind back to browser button event
    const backBtn = document.getElementById('main-loading-back-btn');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        this.handleBackToBrowser();
      });
    }

    // Bind restart button
    const restartBtn = document.getElementById('restart-btn');
    if (restartBtn) {
      restartBtn.addEventListener('click', () => {
        this.restartSong();
      });
    }

    const settingsBtn = document.getElementById('settings-btn');
    const settingsSheet = document.getElementById('settings-sheet');
    if (settingsBtn && settingsSheet) {
      settingsBtn.addEventListener('click', () => {
        settingsSheet.toggle();
      });
    }

    // Keyboard shortcut for restart (R key)
    document.addEventListener('keydown', (e) => {
      // Don't trigger if typing in an input field or rebinding keys
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
      }
      if (settingsSheet && !settingsSheet.hidden) {
        return;
      }
      // no meta or ctrl key
      if (e.ctrlKey || e.metaKey) {
        return;
      }
      if (e.key === 'r' || e.key === 'R') {
        if (!songManager.getCurrentSong()) {
          return;
        }
        e.preventDefault();
        this.restartSong();
      }
    });
  }

  async initByURL() {
    const { difficulty, zenius: zeniusUrl, autoplay } = getURLParams();

    if (autoplay) {
      gameState.setAutoplay(true);
    }

    if (zeniusUrl) {
      return await this.loadFromZeniusURL(zeniusUrl, difficulty);
    }

    return false;
  }

  async loadFromZeniusURL(zeniusUrl, difficulty) {
    // Prevent concurrent loads
    if (this._isLoadingFromZenius) {
      return false;
    }
    this._isLoadingFromZenius = true;

    this.lastZeniusUrl = zeniusUrl;
    this.lastDifficulty = difficulty;
    hideHomeScreen();

    try {
      LoadingOverlay.showLoading('from Song Library', 'Parsing song URL...', 5);

      const simfileId = extractSimfileId(zeniusUrl);
      if (!simfileId) {
        throw new Error('Could not extract simfile ID from song URL');
      }

      LoadingOverlay.updateProgress('Fetching simfile data...', 15);

      const simfileData = await fetchZeniusSimfile(simfileId, songManager.getProxyTransport());

      LoadingOverlay.updateProgress('Parsing simfile charts...', 50);

      const { songKey, songData, parsedData } = parseZeniusSimfile(simfileData, simfileId);

      songManager.cacheParsedData(songKey, parsedData);

      // Cache simfile metadata for the browser (video, difficulties)
      const difficultyMeta = parsedData.charts.map((chart) => ({
        rating: chart.rating || 0,
        name: chart.difficulty || 'Unknown',
        short: this.getDifficultyShortCode(chart.difficulty)
      }));
      ZeniusBrowser.updateSimfileMetadata(simfileId, {
        hasVideo: !!simfileData.aviUrl,
        difficulties: difficultyMeta
      });

      // Set the category in the browser so it can preselect when reopened
      if (simfileData.categoryId) {
        ZeniusBrowser.rememberCategory(simfileData.categoryId, simfileData.categoryName);
      }

      LoadingOverlay.updateProgress('Setting up song...', 70);

      this.setCurrentSong(songKey, songData);
      this.setCurrentDifficulty(difficulty || 0);

      // Note: setCurrentDifficulty already calls DifficultySelector.setCharts and selectDifficultyByIndex
      // Don't call them again here as it would reset the selection

      updateURLParams({ zenius: zeniusUrl, difficulty: difficulty || 0 });

      LoadingOverlay.updateProgress('Starting game...', 85);
      document.getElementById('sub-title').textContent = simfileData.title;
      await this.startSelectedSong(true, true);

      return true;
    } catch (error) {
      LoadingOverlay.hide();
      console.error('Error loading from Song Library URL:', error);
      LoadingOverlay.showError(
        'Could not load song',
        formatLoadError(error) || 'Network error — try again or return to the song browser'
      );
      showHomeScreen();
      return false;
    } finally {
      this._isLoadingFromZenius = false;
    }
  }

  enterHome() {
    this.lastZeniusUrl = null;
    this.lastSongKey = null;
    this.lastDifficulty = null;
    songManager.clearCurrentSong();
    DifficultySelector.setCharts([]);
    audioManager.reset();
    gameState.setSteps({ noteData: [] });
    gameState.setNoteData([]);
    const subTitle = document.getElementById('sub-title');
    if (subTitle) {
      subTitle.textContent = 'Dance to the Beat';
    }
    showHomeScreen();
  }

  setCurrentSong(songKey, songData) {
    songManager.setCurrentSong(songKey, songData);
  }

  setCurrentDifficulty(difficulty) {
    if (difficulty === null) {
      difficulty = 0;
    }

    songManager.setCurrentDifficulty(difficulty);

    const currentSong = songManager.getCurrentSong();
    const parsedData = songManager.getCurrentParsedData();
    if (currentSong && parsedData) {
      // Prevent the onChange callback from triggering startSelectedSong
      // during programmatic difficulty changes
      this.isUpdatingDifficulty = true;
      try {
        DifficultySelector.setCharts(parsedData.charts, currentSong.key);
        DifficultySelector.selectDifficultyByIndex(difficulty);
      } finally {
        this.isUpdatingDifficulty = false;
      }
    }
  }

  async onDifficultySelected(index) {
    if (this.isUpdatingDifficulty) {
      return;
    }

    songManager.setCurrentDifficulty(index);
    this.updateURLWithDifficulty(index);

    await this.startSelectedSong();

    // Reset the game and restart playback after loading the new difficulty
    this.restartSong();
  }

  updateURLWithDifficulty(difficulty) {
    updateURLParams({ difficulty });
    this.syncMainDifficultySelector(difficulty);
  }

  syncMainDifficultySelector(difficulty) {
    this.isUpdatingDifficulty = true;

    DifficultySelector.selectDifficultyByIndex(difficulty);

    this.syncReadyDifficultySelector(difficulty);

    this.isUpdatingDifficulty = false;
  }

  syncReadyDifficultySelector(difficulty) {
    const readyDifficultySelect = document.getElementById('ready-difficulty-select');
    if (readyDifficultySelect) {
      readyDifficultySelect.value = difficulty;
    }
  }

  async startSelectedSong(loadingAlreadyShown = false, useMainLoading = false) {
    const currentSong = songManager.getCurrentSong();
    if (!currentSong) {
      return;
    }

    // Prevent concurrent loads - if already loading, skip this call
    if (this._isLoadingSong) {
      return;
    }
    this._isLoadingSong = true;

    let currentDifficulty = songManager.getCurrentDifficulty();
    if (currentDifficulty === null) {
      currentDifficulty = 0;
      songManager.setCurrentDifficulty(0);
    }

    const parsedData = songManager.getCurrentParsedData();
    if (!parsedData) {
      console.error(`Parsed data not found for song key: ${currentSong.key}`);
      this._isLoadingSong = false;
      return;
    }

    let selectedChart = parsedData.charts[currentDifficulty];
    if (!selectedChart) {
      // Fall back to first available chart if requested difficulty doesn't exist
      if (parsedData.charts.length > 0) {
        console.warn(
          `Chart not found for difficulty ${currentDifficulty}, falling back to first chart`
        );
        selectedChart = parsedData.charts[0];
        songManager.setCurrentDifficulty(0);
      } else {
        console.error('No charts available in this simfile');
        LoadingOverlay.showError(
          'No Charts Available',
          'This simfile has no playable charts. Try a different song.'
        );
        this._isLoadingSong = false;
        return;
      }
    }

    try {
      if (!loadingAlreadyShown) {
        if (useMainLoading) {
          LoadingOverlay.showLoading(currentSong.data.title, 'Loading audio and charts...', 10);
        }
      }

      const startProgress = loadingAlreadyShown ? 50 : 30;
      await this.loadSongIntoGame(parsedData, selectedChart, startProgress, useMainLoading);

      if (useMainLoading) {
        LoadingOverlay.updateProgress('Starting game...', 90);
      }

      await new Promise((resolve) => setTimeout(resolve, 500));

      if (useMainLoading) {
        LoadingOverlay.updateProgress('Ready!', 100);
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    } catch (error) {
      if (useMainLoading) {
        LoadingOverlay.hide();
      }
      console.error('Error starting song:', error);
    } finally {
      this._isLoadingSong = false;
    }
  }

  async loadSongIntoGame(parsedData, chart, startProgress = 30, useMainLoading = false) {
    if (useMainLoading) {
      LoadingOverlay.updateProgress('Setting up game data...', startProgress);
    }

    // Update game state via gameState module
    gameState.setSong({
      bpm: parsedData.bpm,
      addToMusicPosition: parsedData.offset || -0.03,
      bpmChanges: parsedData.bpmChanges || []
    });

    gameState.setSteps({
      noteData: chart.noteData
    });

    // Set up background changes (injects Zenius video URL if available)
    const bgChanges = songManager.prepareBgChanges(parsedData.bgChanges || []);

    gameState.setBgChanges(bgChanges);
    gameState.setNoteData(chart.noteData);
    gameState.setBpm(parsedData.bpm);
    gameState.setBpmChanges(parsedData.bpmChanges || []);

    const audioProgress = startProgress + 20;
    if (useMainLoading) {
      LoadingOverlay.updateProgress('Loading audio file...', audioProgress);
    }

    const currentSongData = songManager.getCurrentSongData();
    const currentSongKey = songManager.getCurrentSongKey();
    let audioUrl = currentSongData.url;
    const mimeType = audioUrl.endsWith('.ogg') ? 'audio/ogg' : 'audio/mpeg';

    // Proxy audio files from zenius-i-vanisher.com to avoid 403/404 errors
    if (audioUrl.includes('zenius-i-vanisher.com')) {
      // AudioManager handles blob URL cleanup automatically in loadBlob()
      let audioLoaded = false;
      /** @type {unknown} */
      let lastAudioError = null;

      // Try direct proxy download first (with short timeout - many files are blocked)
      try {
        if (useMainLoading) {
          LoadingOverlay.updateProgress('Downloading audio file...', audioProgress + 5);
        }
        // No deferProxies: corsproxy.io is the most reliable proxy for
        // zenius binaries (see proxy.js default list). Deferring it pushed
        // the audio download through 3 less-reliable proxies first; on
        // mobile they all 400/403'd and the fetch never reached corsproxy
        // before retries gave up. Default order works.
        const audioData = await songManager.getProxyTransport().fetchBinary(audioUrl, {
          skipDirect: true,
          headers: {
            Referer: 'https://zenius-i-vanisher.com/',
            Origin: 'https://zenius-i-vanisher.com'
          },
          timeout: AUDIO_PROXY_TIMEOUT,
          maxRetries: AUDIO_PROXY_MAX_RETRIES
        });

        // Check if we got actual audio data (not an error page)
        if (audioData && binaryPayloadByteLength(audioData) > MIN_VALID_AUDIO_SIZE) {
          await audioManager.loadArrayBuffer(audioData, mimeType);
          audioLoaded = true;
        } else {
          lastAudioError = new Error('Audio download was empty or too small');
        }
      } catch (error) {
        lastAudioError = error;
      }

      // Fallback: Download ZIP and extract audio
      if (!audioLoaded && currentSongKey.startsWith('zenius_')) {
        const simfileId = currentSongKey.replace('zenius_', '');
        try {
          if (useMainLoading) {
            LoadingOverlay.updateProgress(
              'Downloading song pack (fallback)...',
              audioProgress + 10
            );
          }
          const zipResult = await fetchZeniusAudioFromZip(
            simfileId,
            songManager.getProxyTransport()
          );
          if (zipResult) {
            await audioManager.loadBlob(zipResult.audioBlob, zipResult.audioType);
            audioLoaded = true;
          } else if (!lastAudioError) {
            lastAudioError = new Error('Song pack ZIP had no audio file');
          }
        } catch (zipError) {
          lastAudioError = zipError;
        }
      }

      if (!audioLoaded) {
        LoadingOverlay.showError('Could not load audio', formatLoadError(lastAudioError));
        return;
      }
    } else {
      // Load non-proxied audio directly
      try {
        await audioManager.loadUrl(audioUrl, mimeType);
      } catch (error) {
        console.error('Audio failed to load:', error);
        LoadingOverlay.showError('Could not load audio', formatLoadError(error));
        throw error;
      }
    }

    if (currentSongKey.startsWith('zenius_') && this.lastZeniusUrl) {
      const simfileId = currentSongKey.replace('zenius_', '');
      recordRecentPlay({
        zeniusUrl: this.lastZeniusUrl,
        title: currentSongData.title,
        simfileId
      });
    }

    this.showReadyToPlayMessage();

    const visualProgress = startProgress + 40;
    if (useMainLoading) {
      LoadingOverlay.updateProgress('Setting up visuals...', visualProgress);
    }

    const gameArea = document.getElementById('sm-micro');
    const overlay = 'linear-gradient(rgba(0, 0, 0, 0.7), rgba(0, 0, 0, 0.7))';
    if (currentSongData.background) {
      gameArea.style.backgroundImage = `${overlay}, url(${currentSongData.background})`;
    } else {
      gameArea.style.backgroundImage = overlay;
    }

    const chartProgress = startProgress + 50;
    if (useMainLoading) {
      LoadingOverlay.updateProgress('Preparing note charts...', chartProgress);
    }

    // Reset the game for the new song
    resetGame();
  }

  handleURLChange() {
    void this.initByURL().then((hasURLParams) => {
      if (!hasURLParams) {
        this.enterHome();
      }
    });
  }

  async handleRetry() {
    // Track retry attempt
    if (typeof window.trackEvent === 'function') {
      window.trackEvent('loading_retry', 'StepMania', 'Manual Retry');
    }

    // Increment retry count for exponential backoff
    if (!this.retryCount) {
      this.retryCount = 0;
    }
    this.retryCount++;

    // Exponential backoff: wait before retrying (1s, 2s, 4s, etc.)
    const backoffDelay = Math.min(1000 * Math.pow(2, this.retryCount - 1), 8000);
    if (this.retryCount > 1) {
      LoadingOverlay.updateProgress(`Retrying in ${backoffDelay / 1000}s...`, 5);
      await new Promise((resolve) => setTimeout(resolve, backoffDelay));
    }

    if (this.lastZeniusUrl) {
      await this.loadFromZeniusURL(this.lastZeniusUrl, this.lastDifficulty);
    } else {
      LoadingOverlay.hide();
      this.enterHome();
      this.retryCount = 0;
    }
  }

  handleBackToBrowser() {
    LoadingOverlay.hide();
    clearURLParams();
    this.enterHome();
    ZeniusBrowser.showBrowser();
  }

  showReadyToPlayMessage() {
    const parsedData = songManager.getCurrentParsedData();
    const charts = parsedData?.charts || [];

    // Check if we have a video to pre-load
    const videoUrl = songManager.getCurrentSongData()?.video;
    const hasVideo = videoUrl && videoConverter?.isAviFile(videoUrl);

    LoadingOverlay.showReadyToPlay({
      onPlay: () => this.startPlaying(),
      onBrowse: () => {
        ZeniusBrowser.showBrowser();
      },
      onBack: () => {
        ZeniusBrowser.showBrowser();
      },
      onDifficultyChange: (selectedIndex) => {
        if (!this.isUpdatingDifficulty) {
          songManager.setCurrentDifficulty(selectedIndex);
          this.updateURLWithDifficulty(selectedIndex);
        }
      },
      charts,
      currentDifficulty: songManager.getCurrentDifficulty(),
      hasVideo: hasVideo
    });

    // Pre-load video conversion in background if we have an AVI
    if (hasVideo && videoConverter) {
      this.preloadVideo(videoUrl);
    }
  }

  /**
   * Pre-load and convert video in background
   * @param {string} videoUrl - URL of the video to convert
   */
  async preloadVideo(videoUrl) {
    // Prevent duplicate preload calls
    if (this._preloadingVideo === videoUrl || this._preloadedVideo === videoUrl) {
      logVideoLoad('preload.skip', {
        videoUrl,
        preloading: this._preloadingVideo === videoUrl,
        alreadyPreloaded: this._preloadedVideo === videoUrl
      });
      return;
    }

    if (!videoConverter.needsConversion(videoUrl)) {
      logVideoLoad('preload.unavailable', {
        videoUrl,
        needsConversion: false,
        isAvi: videoConverter.isAviFile(videoUrl),
        sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
        crossOriginIsolated:
          typeof globalThis !== 'undefined' ? globalThis.crossOriginIsolated : undefined,
        hint: 'FFmpeg needs SharedArrayBuffer; plain localhost is usually not cross-origin isolated. Open https://joeheyming.github.io/stepmania/ to match production; coi-serviceworker often cannot fix a bare static :8000 server.'
      });
      LoadingOverlay.updateVideoStatus('unavailable');
      return;
    }

    logVideoLoad('preload.start', {
      videoUrl,
      songKey: songManager.getCurrentSongKey?.() ?? null
    });

    this._preloadingVideo = videoUrl;
    LoadingOverlay.updateVideoStatus('loading', 0);

    try {
      const convertedUrl = await videoConverter.getPlayableUrl(videoUrl, (progress) => {
        LoadingOverlay.updateVideoStatus('loading', progress);
      });

      if (convertedUrl !== videoUrl) {
        logVideoLoad('preload.success', { videoUrl, hasBlob: convertedUrl.startsWith('blob:') });
        LoadingOverlay.updateVideoStatus('ready');
        this._preloadedVideo = videoUrl;
      } else {
        logVideoLoad('preload.failedSameUrl', {
          videoUrl,
          note: 'getPlayableUrl returned original; conversion may have failed silently'
        });
        LoadingOverlay.updateVideoStatus('failed');
      }
    } catch (error) {
      logVideoError('preload.error', error, { videoUrl });
      LoadingOverlay.updateVideoStatus('failed');
    } finally {
      this._preloadingVideo = null;
    }
  }

  startPlaying() {
    const difficultySelect = document.getElementById('ready-difficulty-select');

    if (difficultySelect) {
      const selectedIndex = parseInt(difficultySelect.value);
      if (!isNaN(selectedIndex)) {
        songManager.setCurrentDifficulty(selectedIndex);
      }
    }

    const currentSong = songManager.getCurrentSong();
    const parsedData = songManager.getCurrentParsedData();
    const currentDifficulty = songManager.getCurrentDifficulty();

    if (currentSong && parsedData) {
      const selectedChart = parsedData.charts[currentDifficulty];

      if (selectedChart) {
        gameState.setSteps({
          noteData: selectedChart.noteData
        });
        gameState.setNoteData(selectedChart.noteData);

        resetGame();
      }
    }

    LoadingOverlay.hide();

    if (currentSong) {
      const songTitle = currentSong.data?.title || 'Unknown Song';
      if (typeof window.trackEvent === 'function') {
        window.trackEvent('song_play', 'StepMania', songTitle);
      }
    }

    audioManager.play();
  }

  /**
   * Convert difficulty name to short code
   * @param {string} difficulty - Difficulty name (e.g., "Beginner", "Basic", etc.)
   * @returns {string} Short code (B, L, S, H, C)
   */
  getDifficultyShortCode(difficulty) {
    const diffMap = {
      beginner: 'B',
      basic: 'L',
      light: 'L',
      difficult: 'S',
      standard: 'S',
      another: 'S',
      expert: 'H',
      heavy: 'H',
      challenge: 'C',
      edit: 'E'
    };
    const lowerDiff = (difficulty || '').toLowerCase();
    return diffMap[lowerDiff] || 'U';
  }

  /**
   * Restart the current song from the beginning
   */
  restartSong() {
    if (!songManager.getCurrentSong()) {
      return;
    }
    resetGame();
    audioManager.seek(0);
    audioManager.play();
  }
}

// Initialize main page controller when DOM is ready
let mainPageController = null;

function initMainPageController() {
  if (!mainPageController) {
    mainPageController = new MainPageController();
  }
}

// Handle both cases: DOM already ready (dynamic import) or not yet ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initMainPageController);
} else {
  // DOM is already ready (we were dynamically imported)
  initMainPageController();
}

// Export both the class and instance getter
export function getMainPageController() {
  return mainPageController;
}
export default MainPageController;

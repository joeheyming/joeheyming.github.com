// Main Page Controller - ES Module
// Orchestrates page initialization, URL handling, song loading, and UI coordination

import { songs } from './songs.js';
import { steps } from './steps.js';
import gameState from './gameState.js';
import { resetGame } from './stepmania.js';
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
import { DifficultySelector } from './difficulty-selector.js';
import { ZeniusBrowser } from './zenius-browser.js';
import { getURLParams, updateURLParams, clearURLParams } from './urlUtils.js';
import { LoadingOverlay } from './loading-overlay.js';
import { videoConverter } from './videoConverter.js';
import { audioManager } from './audioManager.js';
import { songManager } from './songManager.js';

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

    // Check URL parameters first
    const hasURLParams = await this.initByURL();

    // Only load default song if no URL parameters were found
    if (!hasURLParams) {
      this.loadDefaultSong();
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

    // Keyboard shortcut for restart (R key)
    document.addEventListener('keydown', (e) => {
      // Don't trigger if typing in an input field
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
      }
      // no meta or ctrl key
      if (e.ctrlKey || e.metaKey) {
        return;
      }
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        this.restartSong();
      }
    });
  }

  async initByURL() {
    const { song, difficulty, zenius: zeniusUrl, autoplay } = getURLParams();

    // Set autoplay mode from URL param
    if (autoplay) {
      gameState.setAutoplay(true);
    }

    if (zeniusUrl) {
      return await this.loadFromZeniusURL(zeniusUrl, difficulty);
    }

    if (!song) {
      return false;
    }

    // Use the imported songs object
    const foundSong = Object.keys(songs).find((s) => {
      return songs[s].title === song;
    });

    if (foundSong) {
      const songData = songs[foundSong];

      this.lastSongKey = foundSong;
      this.lastDifficulty = difficulty;
      this.lastZeniusUrl = null;

      try {
        LoadingOverlay.showLoading(songData.title, 'Loading from URL...', 5);

        this.setCurrentSong(foundSong, songData);
        this.setCurrentDifficulty(difficulty);

        LoadingOverlay.updateProgress('Loading song list...', 15);

        if (songData.simfile) {
          LoadingOverlay.updateProgress('Fetching song charts...', 25);
          await this.loadSimfile(songData.simfile);
        }

        LoadingOverlay.updateProgress('Starting song...', 40);
        document.getElementById('sub-title').textContent = songData.title;
        await this.startSelectedSong(true, true);

        return true;
      } catch (error) {
        LoadingOverlay.hide();
        console.error('Error loading song from URL:', error);
        LoadingOverlay.showError(
          'Failed to load song',
          'Unable to load song data - try again or return to browser'
        );
        return false;
      }
    } else {
      console.error(`Song not found: ${song}`);
      return false;
    }
  }

  async loadFromZeniusURL(zeniusUrl, difficulty) {
    // Prevent concurrent loads
    if (this._isLoadingFromZenius) {
      return false;
    }
    this._isLoadingFromZenius = true;

    this.lastZeniusUrl = zeniusUrl;
    this.lastDifficulty = difficulty;

    try {
      LoadingOverlay.showLoading('from Song Library', 'Parsing song URL...', 5);

      const simfileId = extractSimfileId(zeniusUrl);
      if (!simfileId) {
        throw new Error('Could not extract simfile ID from song URL');
      }

      LoadingOverlay.updateProgress('Fetching simfile data...', 15);

      const simfileData = await fetchZeniusSimfile(simfileId);

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
        'Failed to load from Song Library',
        'Network error - try again or return to browser'
      );
      return false;
    } finally {
      this._isLoadingFromZenius = false;
    }
  }

  loadDefaultSong() {
    const defaultSong = 'Lost';
    const songData = songs[defaultSong];

    if (songData) {
      // Load audio via AudioManager (fire and forget for default song)
      audioManager.loadUrl(songData.url, 'audio/mpeg').catch(() => {});

      const gameArea = document.getElementById('sm-micro');
      gameArea.style.backgroundImage = `linear-gradient(rgba(0, 0, 0, 0.7), rgba(0, 0, 0, 0.7)), url(${songData.background})`;

      // Load the default steps for the Lost song
      if (steps && steps.noteData) {
        // Create a deep copy of the note data to avoid mutation issues
        const noteDataCopy = steps.noteData.map((note) => [note[0], note[1], { ...note[2] }]);

        gameState.setSong({
          bpm: songData.bpm || 120,
          addToMusicPosition: songData.offset || -0.03,
          bpmChanges: []
        });

        gameState.setSteps({ noteData: noteDataCopy });
        gameState.setNoteData(noteDataCopy);
        gameState.setBpm(songData.bpm || 120);
        gameState.setBpmChanges([]);
        gameState.setBgChanges([]);

        // Set current song info
        this.setCurrentSong(defaultSong, songData);

        // Create a parsed song entry for the default song
        const parsedData = {
          title: songData.title || 'Lost',
          artist: songData.artist || 'Unknown',
          bpm: songData.bpm || 120,
          offset: songData.offset || -0.03,
          charts: [
            {
              type: 'dance-single',
              description: '',
              difficulty: 'Medium',
              rating: 5,
              radarValues: '',
              noteData: noteDataCopy
            }
          ],
          bgChanges: [],
          bpmChanges: []
        };

        songManager.cacheParsedData(defaultSong, parsedData);

        // Update difficulty selector with the default chart
        DifficultySelector.setCharts(parsedData.charts);
      }
    }
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
        DifficultySelector.setCharts(parsedData.charts);
        DifficultySelector.selectDifficultyByIndex(difficulty);
      } finally {
        this.isUpdatingDifficulty = false;
      }
    }
  }

  async loadSimfile(simfileUrl) {
    const parsedData = await loadLocalSimfile(simfileUrl);
    const currentSongKey = songManager.getCurrentSongKey();

    songManager.cacheParsedData(currentSongKey, parsedData);

    DifficultySelector.setCharts(parsedData.charts);
    DifficultySelector.syncFromURL();
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
    const params = { difficulty };
    const currentSong = songManager.getCurrentSong();

    if (currentSong) {
      if (!currentSong.key.startsWith('zenius_')) {
        params.song = currentSong.data.title;
      }
      // For zenius songs, the zenius param is already in URL
    }

    updateURLParams(params);
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

      // Try direct proxy download first (with short timeout - many files are blocked)
      try {
        if (useMainLoading) {
          LoadingOverlay.updateProgress('Downloading audio file...', audioProgress + 5);
        }
        const audioData = await window.proxyService.fetchBinaryWithProxy(audioUrl, {
          headers: {
            Referer: 'https://zenius-i-vanisher.com/',
            Origin: 'https://zenius-i-vanisher.com'
          },
          timeout: AUDIO_PROXY_TIMEOUT,
          maxRetries: AUDIO_PROXY_MAX_RETRIES
        });

        // Check if we got actual audio data (not an error page)
        if (audioData && audioData.length > MIN_VALID_AUDIO_SIZE) {
          await audioManager.loadArrayBuffer(audioData, mimeType);
          audioLoaded = true;
        }
      } catch (error) {
        // Direct download failed, will try ZIP fallback
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
        LoadingOverlay.showError(
          'Audio Not Available',
          'Could not download the audio file for this song. The file may have been removed.'
        );
        return;
      }
    } else {
      // Load non-proxied audio directly
      try {
        await audioManager.loadUrl(audioUrl, mimeType);
      } catch (error) {
        console.error('Audio failed to load:', error);
        LoadingOverlay.showError(
          'Audio Load Failed',
          'The audio file could not be played. Try a different song.'
        );
        throw error;
      }
    }

    this.showReadyToPlayMessage();

    const visualProgress = startProgress + 40;
    if (useMainLoading) {
      LoadingOverlay.updateProgress('Setting up visuals...', visualProgress);
    }

    const gameArea = document.getElementById('sm-micro');
    gameArea.style.backgroundImage = `linear-gradient(rgba(0, 0, 0, 0.7), rgba(0, 0, 0, 0.7)), url(${currentSongData.background})`;

    const chartProgress = startProgress + 50;
    if (useMainLoading) {
      LoadingOverlay.updateProgress('Preparing note charts...', chartProgress);
    }

    // Reset the game for the new song
    resetGame();
  }

  handleURLChange() {
    this.initByURL();
  }

  async handleRetry() {
    if (this.lastZeniusUrl) {
      await this.loadFromZeniusURL(this.lastZeniusUrl, this.lastDifficulty);
    } else if (this.lastSongKey) {
      const songData = songs[this.lastSongKey];
      if (songData) {
        try {
          LoadingOverlay.showLoading(songData.title, 'Retrying...', 5);
          this.setCurrentSong(this.lastSongKey, songData);
          this.setCurrentDifficulty(this.lastDifficulty);

          LoadingOverlay.updateProgress('Loading song list...', 15);

          if (songData.simfile) {
            LoadingOverlay.updateProgress('Fetching song charts...', 25);
            await this.loadSimfile(songData.simfile);
          }

          LoadingOverlay.updateProgress('Starting song...', 40);
          document.getElementById('sub-title').textContent = songData.title;
          await this.startSelectedSong(true, true);
        } catch (error) {
          LoadingOverlay.hide();
          console.error('Error retrying song:', error);
          LoadingOverlay.showError(
            'Failed to retry song',
            'Retry failed - try again or return to browser'
          );
        }
      }
    } else {
      LoadingOverlay.hide();
      this.loadDefaultSong();
    }
  }

  handleBackToBrowser() {
    this.lastZeniusUrl = null;
    this.lastSongKey = null;
    this.lastDifficulty = null;

    LoadingOverlay.hide();

    clearURLParams();

    this.loadDefaultSong();
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
      return;
    }

    if (!videoConverter.needsConversion(videoUrl)) {
      LoadingOverlay.updateVideoStatus('unavailable');
      return;
    }

    this._preloadingVideo = videoUrl;
    LoadingOverlay.updateVideoStatus('loading', 0);

    try {
      const convertedUrl = await videoConverter.getPlayableUrl(videoUrl, (progress) => {
        LoadingOverlay.updateVideoStatus('loading', progress);
      });

      if (convertedUrl !== videoUrl) {
        LoadingOverlay.updateVideoStatus('ready');
        this._preloadedVideo = videoUrl;
      } else {
        LoadingOverlay.updateVideoStatus('failed');
      }
    } catch (error) {
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

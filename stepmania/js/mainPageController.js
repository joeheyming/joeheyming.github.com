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
  loadLocalSimfile
} from './songLoader.js';
import { DifficultySelector } from './difficulty-selector.js';
import { ZeniusBrowser } from './zenius-browser.js';
import { getURLParams, updateURLParams, clearURLParams } from './urlUtils.js';
import { LoadingOverlay } from './loading-overlay.js';

/**
 * Main Page Controller
 * Orchestrates page initialization, URL handling, song loading, and difficulty selection
 */
export class MainPageController {
  constructor() {
    /** @type {Object|null} */
    this.currentSong = null;
    /** @type {number|null} */
    this.currentDifficulty = null;
    /** @type {Object<string, Object>} */
    this.parsedSongs = {};
    /** @type {string|null} */
    this.lastZeniusUrl = null;
    /** @type {number|null} */
    this.lastDifficulty = null;
    /** @type {string|null} */
    this.lastSongKey = null;
    /** @type {boolean} */
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
  }

  async initByURL() {
    const { song, difficulty, zenius: zeniusUrl } = getURLParams();

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

      this.parsedSongs[songKey] = parsedData;
      gameState.setParsedSong(songKey, parsedData);

      LoadingOverlay.updateProgress('Setting up song...', 70);

      this.setCurrentSong(songKey, songData);
      this.setCurrentDifficulty(difficulty || 0);

      DifficultySelector.setCharts(parsedData.charts);
      DifficultySelector.syncFromURL();

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
    }
  }

  loadDefaultSong() {
    const defaultSong = 'Lost';
    const songData = songs[defaultSong];

    if (songData) {
      const audioEl = document.getElementById('audio_with_controls');
      audioEl.innerHTML = `<source src="${songData.url}" type="audio/mpeg" />`;
      audioEl.load();

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

        this.parsedSongs[defaultSong] = parsedData;
        gameState.setParsedSong(defaultSong, parsedData);

        // Update difficulty selector with the default chart
        DifficultySelector.setCharts(parsedData.charts);
      }
    }
  }

  setCurrentSong(songKey, songData) {
    this.currentSong = { key: songKey, data: songData };
    // Update gameState for cross-module access
    gameState.setCurrentSongKey(songKey);
    gameState.setCurrentSongData(songData);
  }

  setCurrentDifficulty(difficulty) {
    if (difficulty === null) {
      difficulty = 0;
    }

    this.currentDifficulty = difficulty;
    // Update gameState for cross-module access
    gameState.setCurrentDifficulty(difficulty);

    if (this.currentSong && this.parsedSongs[this.currentSong.key]) {
      DifficultySelector.setCharts(this.parsedSongs[this.currentSong.key].charts);
      DifficultySelector.selectDifficultyByIndex(difficulty);
    }
  }

  handleSimfileData(songKey, parsedData) {
    this.parsedSongs[songKey] = parsedData;
    gameState.setParsedSong(songKey, parsedData);

    DifficultySelector.setCharts(parsedData.charts);
    DifficultySelector.syncFromURL();
  }

  async loadSimfile(simfileUrl) {
    const parsedData = await loadLocalSimfile(simfileUrl);

    this.parsedSongs[this.currentSong.key] = parsedData;
    gameState.setParsedSong(this.currentSong.key, parsedData);

    DifficultySelector.setCharts(parsedData.charts);
    DifficultySelector.syncFromURL();
  }

  onDifficultySelected(index) {
    if (this.isUpdatingDifficulty) {
      return;
    }

    this.currentDifficulty = index;
    this.updateURLWithDifficulty(index);

    this.startSelectedSong();
  }

  updateURLWithDifficulty(difficulty) {
    const params = { difficulty };

    if (this.currentSong) {
      if (!this.currentSong.key.startsWith('zenius_')) {
        params.song = this.currentSong.data.title;
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
    if (!this.currentSong) {
      return;
    }

    if (this.currentDifficulty === null) {
      this.currentDifficulty = 0;
    }

    const parsedData = this.parsedSongs[this.currentSong.key];
    if (!parsedData) {
      console.error(`Parsed data not found for song key: ${this.currentSong.key}`);
      return;
    }

    const selectedChart = parsedData.charts[this.currentDifficulty];
    if (!selectedChart) {
      console.error(`Chart not found for difficulty: ${this.currentDifficulty}`);
      return;
    }

    try {
      if (!loadingAlreadyShown) {
        if (useMainLoading) {
          LoadingOverlay.showLoading(
            this.currentSong.data.title,
            'Loading audio and charts...',
            10
          );
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

    gameState.setBgChanges(parsedData.bgChanges || []);
    gameState.setNoteData(chart.noteData);
    gameState.setBpm(parsedData.bpm);
    gameState.setBpmChanges(parsedData.bpmChanges || []);

    const audioProgress = startProgress + 20;
    if (useMainLoading) {
      LoadingOverlay.updateProgress('Loading audio file...', audioProgress);
    }

    const audioEl = document.getElementById('audio_with_controls');
    audioEl.innerHTML = `<source src="${this.currentSong.data.url}" type="audio/mpeg" />`;
    audioEl.load();

    await new Promise((resolve) => {
      audioEl.addEventListener(
        'canplay',
        () => {
          this.showReadyToPlayMessage();
          resolve();
        },
        { once: true }
      );
    });

    const visualProgress = startProgress + 40;
    if (useMainLoading) {
      LoadingOverlay.updateProgress('Setting up visuals...', visualProgress);
    }

    const gameArea = document.getElementById('sm-micro');
    gameArea.style.backgroundImage = `linear-gradient(rgba(0, 0, 0, 0.7), rgba(0, 0, 0, 0.7)), url(${this.currentSong.data.background})`;

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
    const charts =
      this.currentSong && this.parsedSongs[this.currentSong.key]
        ? this.parsedSongs[this.currentSong.key].charts
        : [];

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
          this.currentDifficulty = selectedIndex;
          this.updateURLWithDifficulty(selectedIndex);
        }
      },
      charts,
      currentDifficulty: this.currentDifficulty
    });
  }

  startPlaying() {
    const difficultySelect = document.getElementById('ready-difficulty-select');

    if (difficultySelect) {
      const selectedIndex = parseInt(difficultySelect.value);
      if (!isNaN(selectedIndex)) {
        this.currentDifficulty = selectedIndex;
      }
    }

    if (this.currentSong && this.parsedSongs[this.currentSong.key]) {
      const parsedData = this.parsedSongs[this.currentSong.key];
      const selectedChart = parsedData.charts[this.currentDifficulty];

      if (selectedChart) {
        gameState.setSteps({
          noteData: selectedChart.noteData
        });
        gameState.setNoteData(selectedChart.noteData);

        resetGame();
      }
    }

    LoadingOverlay.hide();

    if (this.currentSong) {
      const songTitle = this.currentSong.data?.title || 'Unknown Song';
      if (typeof window.trackEvent === 'function') {
        window.trackEvent('song_play', 'StepMania', songTitle);
      }
    }

    const audioEl = document.getElementById('audio_with_controls');
    if (audioEl) {
      audioEl.play();
    }
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

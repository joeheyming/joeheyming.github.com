// Main Page Controller - ES Module
// Orchestrates page initialization, URL handling, song loading, and UI coordination

import gameState from './gameState.js';
import { resetGame } from './stepmania.js';
import {
  extractSimfileId,
  fetchZeniusSimfile,
  parseZeniusSimfile,
  fetchZeniusAudioFromZip,
  formatLoadError,
  isStructuralSongFailure
} from './songLoader.js';
import { rememberUnplayable } from './zeniusLibraryStorage.js';
import { DifficultySelector } from './difficulty-selector.js';
import { getURLParams, updateURLParams, clearURLParams } from './urlUtils.js';
import { LoadingOverlay } from './loading-overlay.js';
import { videoConverter } from './videoConverter.js';
import { audioManager } from './audioManager.js';
import { songManager } from './songManager.js';
import { inputManager } from './inputManager.js';
import {
  AUDIO_PROXY_TIMEOUT,
  AUDIO_PROXY_MAX_RETRIES,
  playableAudioMime
} from './songProxyTransport.js';
import { buildTimingData, filterUnjudgableNotes } from './timingData.js';
import { recordRecentPlay } from './zeniusLibraryStorage.js';
import { hideHomeScreen, showHomeNotice, showHomeScreen } from './homeScreen.js';
import { logVideoError, logVideoLoad } from './videoLoadLogging.js';
import { unpackZip, readZipFiles, packFromFilesPlayable, packFromSimfileText } from './packIo.js';
import { songFromPack, playTimingForChart, revokePackObjectUrls } from './songFromPack.js';
import { loadDraft } from './localPackStore.js';

/**
 * The catalog UI is not part of the play graph. Load it the first time
 * a song's metadata should be remembered, or the library should open.
 * @returns {Promise<typeof import('./zenius-browser.js').ZeniusBrowser>}
 */
function zeniusBrowser() {
  return import('./zenius-browser.js').then((mod) => mod.ZeniusBrowser);
}

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
    /** @type {string|null} Last IndexedDB draft id */
    this.lastLocalId = null;
    /** @type {boolean} Flag to prevent onChange loops during programmatic updates */
    this.isUpdatingDifficulty = false;
    /** @type {string|null} Avoid counting difficulty changes as fresh successful loads */
    this._trackedReadySongKey = null;
    /** @type {Promise<void>} */
    this.ready = this.init();
  }

  async init() {
    this.bindEvents();

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

    const overlay = document.getElementById('loading-overlay');
    if (overlay && typeof overlay.setCancelHandler === 'function') {
      overlay.setCancelHandler(() => this.handleBackToBrowser());
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
        if (inputManager.isColumnKey(e)) return;
        if (!songManager.getCurrentSong()) {
          return;
        }
        e.preventDefault();
        void window.yieldToMain().then(() => this.restartSong());
      }
    });
  }

  async initByURL() {
    const { difficulty, zenius: zeniusUrl, local: localId, autoplay } = getURLParams();

    if (autoplay) {
      gameState.setAutoplay(true);
    }

    if (localId) {
      return await this.loadFromLocalDraft(localId, difficulty);
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
    let simfileId = null;

    try {
      LoadingOverlay.showLoading('Song', 'Getting the chart');

      simfileId = extractSimfileId(zeniusUrl);
      if (!simfileId) {
        throw new Error('Could not extract simfile ID from song URL');
      }

      const simfileData = await fetchZeniusSimfile(simfileId, songManager.getProxyTransport());
      LoadingOverlay.setTitle(simfileData.title || 'Song');

      const { songKey, songData, parsedData } = parseZeniusSimfile(simfileData, simfileId);

      songManager.cacheParsedData(songKey, parsedData);

      // Cache simfile metadata for the browser (video, difficulties)
      const difficultyMeta = parsedData.charts.map((chart) => ({
        rating: chart.rating || 0,
        name: chart.difficulty || 'Unknown',
        short: this.getDifficultyShortCode(chart.difficulty)
      }));
      void zeniusBrowser().then((browser) => {
        browser.updateSimfileMetadata(simfileId, {
          hasVideo: !!simfileData.aviUrl,
          difficulties: difficultyMeta
        });
        if (simfileData.categoryId) {
          browser.rememberCategory(simfileData.categoryId, simfileData.categoryName);
        }
      });

      this.setCurrentSong(songKey, songData);
      this.setCurrentDifficulty(difficulty || 0);

      // Note: setCurrentDifficulty already calls DifficultySelector.setCharts and selectDifficultyByIndex
      // Don't call them again here as it would reset the selection

      updateURLParams({ zenius: zeniusUrl, difficulty: difficulty || 0 });

      LoadingOverlay.updateProgress('Getting the audio');
      document.getElementById('sub-title').textContent = simfileData.title;
      if (!document.documentElement.dataset.baseTitle) {
        document.documentElement.dataset.baseTitle = document.title;
      }
      document.title = simfileData.title + ' — ' + document.documentElement.dataset.baseTitle;
      return await this.startSelectedSong(true, true);
    } catch (error) {
      LoadingOverlay.hide();
      console.error('Error loading from Song Library URL:', error);
      this.trackZeniusSongLoad('failed', 'song-data', error, simfileId);
      const message =
        formatLoadError(error) || 'Network error — try again or return to the song browser';
      if (simfileId && isStructuralSongFailure(message)) {
        rememberUnplayable(simfileId, message);
      }
      this.presentLoadError('Download failed', message);
      showHomeScreen();
      return false;
    } finally {
      this._isLoadingFromZenius = false;
    }
  }

  /**
   * @param {File} file
   */
  async loadFromLocalFile(file) {
    hideHomeScreen();
    this.lastZeniusUrl = null;
    try {
      LoadingOverlay.showLoading(file.name, 'Getting the chart');
      const name = file.name.toLowerCase();
      let pack;
      if (name.endsWith('.sm') || name.endsWith('.ssc')) {
        const text = await file.text();
        pack = packFromSimfileText(file.name, text);
      } else {
        const files = await readZipFiles(await file.arrayBuffer());
        pack = packFromFilesPlayable(files);
      }
      await this.playLoadedPack(pack, `file_${file.name}`, { localId: null });
      return true;
    } catch (error) {
      LoadingOverlay.hide();
      console.error('Error loading local pack:', error);
      this.presentLoadError("Couldn't open that pack", formatLoadError(error) || String(error));
      showHomeScreen();
      return false;
    }
  }

  /**
   * @param {string} localId
   * @param {string|number|null} difficulty
   */
  async loadFromLocalDraft(localId, difficulty) {
    hideHomeScreen();
    this.lastZeniusUrl = null;
    this.lastLocalId = localId;
    try {
      LoadingOverlay.showLoading('Saved draft', 'Getting the chart');
      const draft = await loadDraft(localId);
      if (!draft?.zipBlob) {
        throw new Error('That editor draft was not found on this device.');
      }
      const pack = await unpackZip(draft.zipBlob);
      await this.playLoadedPack(pack, `local_${localId}`, { localId, difficulty });
      return true;
    } catch (error) {
      LoadingOverlay.hide();
      console.error('Error loading local draft:', error);
      this.presentLoadError("Couldn't open that pack", formatLoadError(error) || String(error));
      showHomeScreen();
      return false;
    }
  }

  /**
   * @param {import('./packIo.js').SongPack} pack
   * @param {string} songKey
   * @param {{ localId?: string|null, difficulty?: string|number|null }} [opts]
   */
  async playLoadedPack(pack, songKey, opts = {}) {
    revokePackObjectUrls();
    LoadingOverlay.updateProgress('Getting the chart');
    const { songData, parsedData } = songFromPack(pack, songKey);
    if (!parsedData.charts.length) {
      throw new Error('This pack has no dance-single charts to play.');
    }
    if (!songData.audioBlob && !songData.url) {
      throw new Error('This pack has no music file. Add an ogg/mp3 in the editor.');
    }
    songManager.cacheParsedData(songKey, parsedData);
    this.setCurrentSong(songKey, songData);
    this.setCurrentDifficulty(opts.difficulty || 0);
    this.lastLocalId = opts.localId || null;
    updateURLParams({
      zenius: null,
      local: opts.localId || null,
      difficulty: opts.difficulty || 0
    });
    const subTitle = document.getElementById('sub-title');
    if (subTitle) subTitle.textContent = parsedData.title;
    await this.startSelectedSong(true, true);
  }

  enterHome() {
    this.lastZeniusUrl = null;
    this.lastSongKey = null;
    this.lastDifficulty = null;
    this.lastLocalId = null;
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
      return false;
    }

    // Prevent concurrent loads - if already loading, skip this call
    if (this._isLoadingSong) {
      return false;
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
      return false;
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
        const message = 'This simfile has no playable charts. Try a different song.';
        this.trackZeniusSongLoad('failed', 'charts', new Error('No playable charts'));
        if (currentSong.key.startsWith('zenius_')) {
          rememberUnplayable(currentSong.key.replace('zenius_', ''), message);
        }
        this.presentLoadError("This chart can't be played here", message);
        this._isLoadingSong = false;
        return false;
      }
    }

    try {
      if (!loadingAlreadyShown) {
        if (useMainLoading) {
          LoadingOverlay.showLoading(currentSong.data.title, 'Getting the audio');
        }
      }

      const loaded = await this.loadSongIntoGame(parsedData, selectedChart, useMainLoading);
      if (!loaded) {
        return false;
      }
      return true;
    } catch (error) {
      if (useMainLoading) {
        LoadingOverlay.hide();
      }
      console.error('Error starting song:', error);
      return false;
    } finally {
      this._isLoadingSong = false;
    }
  }

  async loadSongIntoGame(parsedData, chart, useMainLoading = false) {
    const playTiming = playTimingForChart(parsedData, chart);
    const timing = playTiming.timing || buildTimingData({});
    const offset = Number.isFinite(playTiming.offset) ? playTiming.offset : -0.03;

    const noteData = filterUnjudgableNotes(timing, chart.noteData);

    gameState.setSong({
      bpm: parsedData.bpm,
      addToMusicPosition: offset + timing.beat0OffsetDelta,
      bpmChanges: playTiming.bpmChanges || parsedData.bpmChanges || [],
      timing
    });

    gameState.setSteps({ noteData });

    // Set up background changes (injects Zenius video URL if available)
    const bgChanges = songManager.prepareBgChanges(parsedData.bgChanges || []);

    gameState.setBgChanges(bgChanges);
    gameState.setNoteData(noteData);

    if (useMainLoading) {
      LoadingOverlay.updateProgress('Getting the audio');
    }

    const currentSongData = songManager.getCurrentSongData();
    const currentSongKey = songManager.getCurrentSongKey();
    let audioUrl = currentSongData.url || '';
    const mimeType =
      currentSongData.audioType ||
      (audioUrl.toLowerCase().includes('.ogg') ? 'audio/ogg' : 'audio/mpeg');
    const zeniusSong = currentSongKey.startsWith('zenius_');

    if (currentSongData.audioBlob) {
      try {
        try {
          await audioManager.loadBlob(currentSongData.audioBlob, mimeType);
        } catch (primaryError) {
          if (!currentSongData.alternateBlob) throw primaryError;
          await audioManager.loadBlob(
            currentSongData.alternateBlob,
            currentSongData.alternateType || mimeType
          );
        }
      } catch (error) {
        console.error('Audio failed to load:', error);
        this.trackZeniusSongLoad('failed', 'audio', error);
        this.presentLoadError('Download failed', formatLoadError(error));
        throw error;
      }
    } else if (zeniusSong) {
      // AudioManager handles blob URL cleanup automatically in loadBlob()
      let audioLoaded = false;
      /** @type {unknown} */
      let lastAudioError = null;

      // Pages with only a chart and a ZIP have no direct audio URL. Skip the
      // file fetch and use the pack fallback below.
      if (audioUrl) {
        try {
          // Default proxy order. Don't defer a host here — that used to
          // push the download through rate-limited proxies until retries
          // gave up.
          const audioData = await songManager.getProxyTransport().fetchBinary(audioUrl, {
            skipDirect: true,
            headers: {
              Referer: 'https://zenius-i-vanisher.com/',
              Origin: 'https://zenius-i-vanisher.com'
            },
            timeout: AUDIO_PROXY_TIMEOUT,
            maxRetries: AUDIO_PROXY_MAX_RETRIES
          });

          const sniffed = playableAudioMime(audioData);
          if (sniffed) {
            await audioManager.loadArrayBuffer(audioData, sniffed);
            audioLoaded = true;
          } else {
            lastAudioError = new Error('Audio download was empty or not an audio file');
          }
        } catch (error) {
          lastAudioError = error;
        }
      }

      const alternateUrl = currentSongData.alternateUrl || '';
      if (!audioLoaded && alternateUrl && alternateUrl !== audioUrl) {
        try {
          if (useMainLoading) {
            LoadingOverlay.updateProgress('Trying another download');
          }
          const alternateData = await songManager.getProxyTransport().fetchBinary(alternateUrl, {
            skipDirect: true,
            headers: {
              Referer: 'https://zenius-i-vanisher.com/',
              Origin: 'https://zenius-i-vanisher.com'
            },
            timeout: AUDIO_PROXY_TIMEOUT,
            maxRetries: AUDIO_PROXY_MAX_RETRIES
          });
          const sniffedAlternate = playableAudioMime(alternateData);
          if (sniffedAlternate) {
            await audioManager.loadArrayBuffer(alternateData, sniffedAlternate);
            audioLoaded = true;
          }
        } catch (error) {
          lastAudioError = error;
        }
      }

      // Fallback: Download ZIP and extract audio. This is the only audio
      // source when the Zenius page has a chart and a pack, with no file link.
      if (!audioLoaded) {
        const simfileId = currentSongKey.replace('zenius_', '');
        try {
          if (useMainLoading) {
            LoadingOverlay.updateProgress('Trying another download');
          }
          const zipResult = await fetchZeniusAudioFromZip(
            simfileId,
            songManager.getProxyTransport()
          );
          if (zipResult) {
            try {
              await audioManager.loadBlob(zipResult.audioBlob, zipResult.audioType);
              audioLoaded = true;
            } catch (primaryZipError) {
              if (!zipResult.alternateBlob) throw primaryZipError;
              await audioManager.loadBlob(zipResult.alternateBlob, zipResult.alternateType);
              audioLoaded = true;
            }
          } else if (!lastAudioError) {
            lastAudioError = new Error('Song pack ZIP had no audio file');
          }
        } catch (zipError) {
          lastAudioError = zipError;
        }
      }

      if (!audioLoaded) {
        this.trackZeniusSongLoad('failed', 'audio', lastAudioError);
        this.presentLoadError('Download failed', formatLoadError(lastAudioError));
        return false;
      }
    } else {
      // Load non-proxied audio directly
      try {
        await audioManager.loadUrl(audioUrl, mimeType);
      } catch (error) {
        console.error('Audio failed to load:', error);
        this.trackZeniusSongLoad('failed', 'audio', error);
        this.presentLoadError('Download failed', formatLoadError(error));
        throw error;
      }
    }

    this.trackZeniusSongLoad('ready', 'audio');

    if (currentSongKey.startsWith('zenius_') && this.lastZeniusUrl) {
      const simfileId = currentSongKey.replace('zenius_', '');
      recordRecentPlay({
        zeniusUrl: this.lastZeniusUrl,
        title: currentSongData.title,
        simfileId
      });
    }

    this.showReadyToPlayMessage();

    const gameArea = document.getElementById('sm-micro');
    const overlay = 'linear-gradient(rgba(0, 0, 0, 0.7), rgba(0, 0, 0, 0.7))';
    if (currentSongData.background) {
      gameArea.style.backgroundImage = `${overlay}, url(${currentSongData.background})`;
    } else {
      gameArea.style.backgroundImage = overlay;
    }

    resetGame();
    return true;
  }

  /**
   * Record one actionable remote-song outcome without exposing the full source URL.
   * @param {'ready'|'failed'} outcome
   * @param {string} stage
   * @param {unknown} [error]
   * @param {string|null} [songId]
   */
  trackZeniusSongLoad(outcome, stage, error = null, songId = null) {
    const songKey = songManager.getCurrentSongKey();
    const resolvedId =
      songId || (songKey?.startsWith('zenius_') ? songKey.replace('zenius_', '') : null);
    if (!resolvedId || typeof window.trackEvent !== 'function') {
      return;
    }
    if (outcome === 'ready') {
      if (this._trackedReadySongKey === `zenius_${resolvedId}`) {
        return;
      }
      this._trackedReadySongKey = `zenius_${resolvedId}`;
    }

    const rawMessage = error instanceof Error ? error.message : error == null ? '' : String(error);
    const errorMessage = rawMessage.trim().slice(0, 100);
    const label =
      outcome === 'ready'
        ? `ready: zenius_${resolvedId}`
        : `failed at ${stage}: zenius_${resolvedId}${errorMessage ? ` - ${errorMessage}` : ''}`;

    window.trackEvent('stepmania_song_load', 'StepMania', label.slice(0, 100), undefined, {
      outcome,
      load_stage: stage,
      song_id: `zenius_${resolvedId}`,
      ...(errorMessage ? { error_message: errorMessage } : {})
    });
  }

  handleURLChange() {
    void this.initByURL().then((hasURLParams) => {
      if (!hasURLParams) {
        this.enterHome();
      }
    });
  }

  async handleRetry() {
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

    if (this.lastLocalId) {
      await this.loadFromLocalDraft(this.lastLocalId, this.lastDifficulty);
    } else if (this.lastZeniusUrl) {
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
    void zeniusBrowser()
      .then((browser) => browser.showBrowser())
      .catch((error) => {
        const detail = error instanceof Error ? error.message : 'The song library did not load.';
        showHomeNotice(`${detail} Refresh the page and try again.`);
      });
  }

  /**
   * @param {string} fallbackTitle
   * @param {string} message
   */
  presentLoadError(fallbackTitle, message) {
    const text = message || 'Something went wrong. Try again or pick another song.';
    const structural =
      isStructuralSongFailure(text) || /no music file|not found on this device/i.test(text);
    LoadingOverlay.showError(structural ? "This chart can't be played here" : fallbackTitle, text, {
      allowRetry: !structural,
      onRetry: () => {
        void this.handleRetry();
      },
      onBack: () => this.handleBackToBrowser()
    });
  }

  showReadyToPlayMessage() {
    const parsedData = songManager.getCurrentParsedData();
    const song = songManager.getCurrentSongData() || {};
    const charts = parsedData?.charts || [];
    const videoUrl = song.video;
    const hasVideo = videoUrl && videoConverter?.isAviFile(videoUrl);
    const leave = () => this.handleBackToBrowser();

    LoadingOverlay.showReadyToPlay({
      songTitle: parsedData?.title || song.title || 'Song',
      artist: parsedData?.artist || song.artist || '',
      onPlay: () => this.startPlaying(),
      onBrowse: leave,
      onBack: leave,
      onDifficultyChange: (selectedIndex) => {
        if (!this.isUpdatingDifficulty) {
          songManager.setCurrentDifficulty(selectedIndex);
          this.updateURLWithDifficulty(selectedIndex);
        }
      },
      charts,
      currentDifficulty: songManager.getCurrentDifficulty() || 0,
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

  async startPlaying() {
    const difficultySelect = document.getElementById('ready-difficulty-select');

    if (difficultySelect) {
      const selectedIndex = parseInt(difficultySelect.value);
      if (!isNaN(selectedIndex)) {
        songManager.setCurrentDifficulty(selectedIndex);
      }
    }

    LoadingOverlay.hide();
    await window.yieldToMain();

    const currentSong = songManager.getCurrentSong();
    const parsedData = songManager.getCurrentParsedData();
    const currentDifficulty = songManager.getCurrentDifficulty();

    if (currentSong && parsedData) {
      const selectedChart = parsedData.charts[currentDifficulty];

      if (selectedChart) {
        // The difficulty picker can land on a different chart than the one
        // loaded, so re-drop the notes this song warps past.
        const timing = parsedData.timing || gameState.getTiming();
        const noteData = filterUnjudgableNotes(timing, selectedChart.noteData);

        gameState.setSteps({ noteData });
        gameState.setNoteData(noteData);

        resetGame();
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

/** @type {MainPageController | null} */
let mainPageController = null;

/** @type {Promise<MainPageController> | null} */
let controllerReady = null;

/**
 * Start the page controller once. The song menu binds itself; this only
 * runs after the play engine has been asked for.
 * @returns {Promise<MainPageController>}
 */
export function startMainPageController() {
  if (!controllerReady) {
    const controller = new MainPageController();
    mainPageController = controller;
    controllerReady = controller.ready.then(() => controller);
  }
  return controllerReady;
}

export function getMainPageController() {
  return mainPageController;
}
export default MainPageController;

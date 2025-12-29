// Game State Module - ES Module
// Single source of truth for StepMania game state

/** Default song configuration */
const DEFAULT_SONG = {
  BPM: 148,
  OFFSET: -0.03
};

/** Default scroll speed multiplier */
const DEFAULT_SCROLL_SPEED = 2;

/**
 * @typedef {Object} GameError
 * @property {Error} error - The error object
 * @property {string} context - Where the error occurred
 * @property {number} timestamp - When the error occurred
 * @property {boolean} recoverable - Whether the game can continue
 */

/**
 * GameState class - single source of truth for all game state
 * Exported as a singleton instance
 */
class GameState {
  constructor() {
    // Song configuration
    this.song = {
      bpm: DEFAULT_SONG.BPM,
      bpmChanges: [],
      addToMusicPosition: DEFAULT_SONG.OFFSET
    };

    // Steps/notes configuration
    this.steps = {
      noteData: []
    };

    // Background changes
    this.bgChanges = [];

    // Score tracking
    this.tapNoteScores = [0, 0, 0, 0, 0, 0];
    this.actualPoints = 0;
    this.mineHits = 0;

    // Scroll speed
    this.scrollSpeed = DEFAULT_SCROLL_SPEED;

    // Current song info (set by mainPageController)
    this.currentSongData = null;
    this.currentSongKey = null;
    this.currentDifficulty = null;

    // Parsed songs cache
    this.parsedSongs = {};

    // Error handling
    this.lastError = null;
    this._errorListeners = [];
  }

  // ==========================================================================
  // ERROR HANDLING
  // ==========================================================================

  /**
   * Report an error to the game state system
   * @param {Error|string} error - The error or error message
   * @param {string} context - Description of where the error occurred
   * @param {boolean} [recoverable=true] - Whether the game can continue
   */
  reportError(error, context, recoverable = true) {
    const errorObj = error instanceof Error ? error : new Error(error);
    this.lastError = {
      error: errorObj,
      context,
      timestamp: Date.now(),
      recoverable
    };

    console.error(`[StepMania:${context}]`, errorObj);

    // Notify all listeners
    this._errorListeners.forEach((listener) => {
      try {
        listener(this.lastError);
      } catch (e) {
        console.error('Error in error listener:', e);
      }
    });
  }

  /**
   * Subscribe to error events
   * @param {function(GameError):void} listener - Callback function
   * @returns {function():void} Unsubscribe function
   */
  onError(listener) {
    this._errorListeners.push(listener);
    return () => {
      const index = this._errorListeners.indexOf(listener);
      if (index > -1) this._errorListeners.splice(index, 1);
    };
  }

  /**
   * Get the last error that occurred
   * @returns {GameError|null}
   */
  getLastError() {
    return this.lastError;
  }

  /**
   * Clear the last error
   */
  clearError() {
    this.lastError = null;
  }

  // ==========================================================================
  // SONG STATE ACCESSORS
  // ==========================================================================

  /**
   * Get the current song configuration
   * @returns {Object}
   */
  getSong() {
    return this.song;
  }

  /**
   * Set the song configuration
   * @param {Object} song - Song data to merge
   */
  setSong(song) {
    this.song = {
      ...this.song,
      ...song,
      bpmChanges: song.bpmChanges || this.song.bpmChanges || []
    };
  }

  /**
   * Get current BPM
   * @returns {number}
   */
  getBpm() {
    return this.song.bpm;
  }

  /**
   * Set BPM
   * @param {number} bpm
   */
  setBpm(bpm) {
    this.song.bpm = bpm;
  }

  /**
   * Get BPM changes array
   * @returns {Array<{beat: number, bpm: number}>}
   */
  getBpmChanges() {
    return this.song.bpmChanges;
  }

  /**
   * Set BPM changes
   * @param {Array<{beat: number, bpm: number}>} bpmChanges
   */
  setBpmChanges(bpmChanges) {
    this.song.bpmChanges = bpmChanges || [];
  }

  /**
   * Get music offset
   * @returns {number}
   */
  getMusicOffset() {
    return this.song.addToMusicPosition;
  }

  /**
   * Set music offset
   * @param {number} offset
   */
  setMusicOffset(offset) {
    this.song.addToMusicPosition = offset;
  }

  // ==========================================================================
  // STEPS/NOTES ACCESSORS
  // ==========================================================================

  /**
   * Get the current steps configuration
   * @returns {Object}
   */
  getSteps() {
    return this.steps;
  }

  /**
   * Set the steps configuration
   * @param {Object} steps
   */
  setSteps(steps) {
    this.steps = steps;
  }

  /**
   * Get note data array
   * @returns {Array<Object>}
   */
  getNoteData() {
    return this.steps.noteData;
  }

  /**
   * Set note data
   * @param {Array<Object>} noteData
   */
  setNoteData(noteData) {
    this.steps.noteData = noteData;
  }

  // ==========================================================================
  // BACKGROUND CHANGES
  // ==========================================================================

  /**
   * Get background changes
   * @returns {Array<Object>}
   */
  getBgChanges() {
    return this.bgChanges;
  }

  /**
   * Set background changes
   * @param {Array<Object>} bgChanges
   */
  setBgChanges(bgChanges) {
    this.bgChanges = bgChanges || [];
  }

  /**
   * Reset background change triggered states
   */
  resetBgChanges() {
    this.bgChanges.forEach((bgChange) => {
      bgChange.triggered = false;
    });
  }

  // ==========================================================================
  // SCORE STATE
  // ==========================================================================

  /**
   * Get tap note scores array [perfect, great, good, bad, miss, mine]
   * @returns {number[]}
   */
  getTapNoteScores() {
    return this.tapNoteScores;
  }

  /**
   * Set tap note scores
   * @param {number[]} scores
   */
  setTapNoteScores(scores) {
    this.tapNoteScores = scores;
  }

  /**
   * Increment a specific score index
   * @param {number} index - Score index (0-5)
   */
  incrementScore(index) {
    if (index >= 0 && index < this.tapNoteScores.length) {
      this.tapNoteScores[index]++;
    }
  }

  /**
   * Get actual points
   * @returns {number}
   */
  getActualPoints() {
    return this.actualPoints;
  }

  /**
   * Set actual points
   * @param {number} points
   */
  setActualPoints(points) {
    this.actualPoints = points;
  }

  /**
   * Add to actual points
   * @param {number} points
   */
  addPoints(points) {
    this.actualPoints += points;
  }

  /**
   * Get mine hits count
   * @returns {number}
   */
  getMineHits() {
    return this.mineHits;
  }

  /**
   * Increment mine hits
   */
  incrementMineHits() {
    this.mineHits++;
  }

  // ==========================================================================
  // SCROLL SPEED
  // ==========================================================================

  /**
   * Get scroll speed
   * @returns {number}
   */
  getScrollSpeed() {
    return this.scrollSpeed;
  }

  /**
   * Set scroll speed
   * @param {number} speed
   */
  setScrollSpeed(speed) {
    this.scrollSpeed = speed;
  }

  // ==========================================================================
  // CURRENT SONG INFO
  // ==========================================================================

  /**
   * Get current song data
   * @returns {Object|null}
   */
  getCurrentSongData() {
    return this.currentSongData;
  }

  /**
   * Set current song data
   * @param {Object} data
   */
  setCurrentSongData(data) {
    this.currentSongData = data;
  }

  /**
   * Get current song key
   * @returns {string|null}
   */
  getCurrentSongKey() {
    return this.currentSongKey;
  }

  /**
   * Set current song key
   * @param {string} key
   */
  setCurrentSongKey(key) {
    this.currentSongKey = key;
  }

  /**
   * Get current difficulty index
   * @returns {number|null}
   */
  getCurrentDifficulty() {
    return this.currentDifficulty;
  }

  /**
   * Set current difficulty
   * @param {number} difficulty
   */
  setCurrentDifficulty(difficulty) {
    this.currentDifficulty = difficulty;
  }

  /**
   * Get all parsed songs
   * @returns {Object<string, Object>}
   */
  getParsedSongs() {
    return this.parsedSongs;
  }

  /**
   * Set a parsed song
   * @param {string} key - Song key
   * @param {Object} data - Parsed song data
   */
  setParsedSong(key, data) {
    this.parsedSongs[key] = data;
  }

  /**
   * Get a parsed song by key
   * @param {string} key
   * @returns {Object|undefined}
   */
  getParsedSong(key) {
    return this.parsedSongs[key];
  }

  // ==========================================================================
  // STATE MANAGEMENT
  // ==========================================================================

  /**
   * Reset all game state to defaults
   */
  resetState() {
    this.song = {
      bpm: DEFAULT_SONG.BPM,
      bpmChanges: [],
      addToMusicPosition: DEFAULT_SONG.OFFSET
    };
    this.steps = { noteData: [] };
    this.bgChanges = [];
    this.tapNoteScores = [0, 0, 0, 0, 0, 0];
    this.actualPoints = 0;
    this.mineHits = 0;
    this.lastError = null;
  }

  /**
   * Reset score state only (for restarting a song)
   */
  resetScores() {
    this.tapNoteScores = [0, 0, 0, 0, 0, 0];
    this.actualPoints = 0;
    this.mineHits = 0;
  }

  /**
   * Load song data from a parsed simfile
   * @param {Object} parsedData - Parsed simfile data
   * @param {Object} chart - Selected chart/difficulty
   */
  loadSongData(parsedData, chart) {
    this.song = {
      bpm: parsedData.bpm,
      bpmChanges: parsedData.bpmChanges || [],
      addToMusicPosition: parsedData.offset ? -parsedData.offset : DEFAULT_SONG.OFFSET
    };

    this.steps = {
      noteData: chart.noteData
    };

    this.bgChanges = parsedData.bgChanges || [];

    // Reset scores when loading new song
    this.resetScores();
  }

  /**
   * Get a snapshot of all game state (useful for debugging)
   * @returns {Object}
   */
  getStateSnapshot() {
    return {
      song: { ...this.song },
      steps: { noteData: this.steps.noteData.length },
      bgChanges: this.bgChanges.length,
      scores: [...this.tapNoteScores],
      points: this.actualPoints,
      mineHits: this.mineHits,
      scrollSpeed: this.scrollSpeed,
      currentSongKey: this.currentSongKey,
      currentDifficulty: this.currentDifficulty,
      lastError: this.lastError
    };
  }
}

// Export singleton instance
export default new GameState();

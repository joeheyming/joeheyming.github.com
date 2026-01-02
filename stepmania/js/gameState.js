// Game State Module - ES Module
// Manages gameplay state: scores, combos, health, active song config (BPM, notes)
// Note: Song metadata (what song is loaded) is managed by songManager

/** Default song configuration */
const DEFAULT_SONG = {
  BPM: 148,
  OFFSET: -0.03
};

/** Default scroll speed multiplier */
const DEFAULT_SCROLL_SPEED = 2;

// ============================================================================
// COMBO CONSTANTS
// ============================================================================

/** Combo thresholds for multiplier increases */
const COMBO_MULTIPLIER_THRESHOLDS = [10, 20, 30];

/** Maximum combo multiplier */
const MAX_MULTIPLIER = 4;

/** Base points per judgment (for score calculation) */
const JUDGMENT_BASE_POINTS = [
  100, // Perfect: 100 points
  80, // Great: 80 points
  50, // Good: 50 points
  25, // Bad: 25 points
  0, // Almost: 0 points
  0 // Miss: 0 points
];

/** Whether each judgment maintains combo */
const JUDGMENT_MAINTAINS_COMBO = [
  true, // Perfect: maintains
  true, // Great: maintains
  true, // Good: maintains
  false, // Bad: breaks
  false, // Almost: breaks
  false // Miss: breaks
];

// ============================================================================
// HEALTH CONSTANTS
// ============================================================================

/** Initial health percentage */
const INITIAL_HEALTH = 50;

/** Maximum health */
const MAX_HEALTH = 100;

/** Minimum health (game over when reached) */
const MIN_HEALTH = 0;

/**
 * Health change for each judgment (positive = gain, negative = lose)
 * Index: 0=perfect, 1=great, 2=good, 3=bad, 4=almost, 5=miss
 */
const JUDGMENT_HEALTH = [
  2.0, // Perfect: +2.0
  1.5, // Great: +1.5
  0.5, // Good: +0.5
  -2.5, // Bad: -2.5
  -6.0, // Almost: -6.0
  -10.0 // Miss: -10.0
];

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
    this.actualPoints = 0; // For percentage calculation
    this.mineHits = 0;

    // Combo and gamified score
    this.combo = 0;
    this.maxCombo = 0;
    this.score = 0; // Gamified score with combo multipliers

    // Scroll speed
    this.scrollSpeed = DEFAULT_SCROLL_SPEED;

    // Note: Song metadata (currentSongKey, currentDifficulty, parsedSongs)
    // is managed by songManager - import it directly when needed

    // Error handling
    this.lastError = null;
    this._errorListeners = [];

    // Health system
    this.health = INITIAL_HEALTH;
    this.failed = false;

    // Autoplay mode
    this.autoplay = false;
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
  // COMBO SYSTEM
  // ==========================================================================

  /**
   * Get current combo
   * @returns {number}
   */
  getCombo() {
    return this.combo;
  }

  /**
   * Get max combo achieved
   * @returns {number}
   */
  getMaxCombo() {
    return this.maxCombo;
  }

  /**
   * Get gamified score (with combo multipliers)
   * @returns {number}
   */
  getScore() {
    return this.score;
  }

  /**
   * Get current combo multiplier
   * @returns {number} Multiplier (1-4)
   */
  getComboMultiplier() {
    if (this.combo >= COMBO_MULTIPLIER_THRESHOLDS[2]) return MAX_MULTIPLIER;
    if (this.combo >= COMBO_MULTIPLIER_THRESHOLDS[1]) return 3;
    if (this.combo >= COMBO_MULTIPLIER_THRESHOLDS[0]) return 2;
    return 1;
  }

  /**
   * Apply a judgment - updates combo and score
   * @param {number} judgmentIndex - Judgment index (0=perfect, 5=miss)
   * @returns {{combo: number, multiplier: number, pointsEarned: number}}
   */
  applyJudgment(judgmentIndex) {
    const maintainsCombo = JUDGMENT_MAINTAINS_COMBO[judgmentIndex];
    const basePoints = JUDGMENT_BASE_POINTS[judgmentIndex];

    // Get multiplier before updating combo
    const multiplier = this.getComboMultiplier();

    // Update combo
    if (maintainsCombo) {
      this.combo++;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
    } else {
      this.combo = 0;
    }

    // Calculate and add score with multiplier
    const pointsEarned = basePoints * multiplier;
    this.score += pointsEarned;

    return {
      combo: this.combo,
      multiplier,
      pointsEarned
    };
  }

  /**
   * Break combo (e.g., for mine hits)
   */
  breakCombo() {
    this.combo = 0;
  }

  // ==========================================================================
  // HEALTH SYSTEM
  // ==========================================================================

  /**
   * Get current health
   * @returns {number} Health value (0-100)
   */
  getHealth() {
    return this.health;
  }

  /**
   * Apply health change based on judgment
   * @param {number} judgmentIndex - Judgment index (0=perfect, 5=miss)
   */
  applyHealthChange(judgmentIndex) {
    if (this.failed) return;

    const healthChange = JUDGMENT_HEALTH[judgmentIndex] || 0;
    this.health = Math.max(MIN_HEALTH, Math.min(MAX_HEALTH, this.health + healthChange));

    if (this.health <= MIN_HEALTH) {
      this.failed = true;
    }
  }

  /**
   * Apply direct health damage (e.g., for mine hits)
   * @param {number} damage - Amount of health to lose (positive number)
   */
  applyDamage(damage) {
    if (this.failed) return;

    this.health = Math.max(MIN_HEALTH, this.health - damage);

    if (this.health <= MIN_HEALTH) {
      this.failed = true;
    }
  }

  /**
   * Check if player has failed (health depleted)
   * @returns {boolean}
   */
  hasFailed() {
    return this.failed;
  }

  /**
   * Reset health to initial value
   */
  resetHealth() {
    this.health = INITIAL_HEALTH;
    this.failed = false;
  }

  // ==========================================================================
  // AUTOPLAY MODE
  // ==========================================================================

  /**
   * Check if autoplay is enabled
   * @returns {boolean}
   */
  isAutoplay() {
    return this.autoplay;
  }

  /**
   * Set autoplay mode
   * @param {boolean} enabled
   */
  setAutoplay(enabled) {
    this.autoplay = enabled;
  }

  /**
   * Toggle autoplay mode
   * @returns {boolean} New autoplay state
   */
  toggleAutoplay() {
    this.autoplay = !this.autoplay;
    return this.autoplay;
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
    this.health = INITIAL_HEALTH;
    this.failed = false;
    this.combo = 0;
    this.maxCombo = 0;
    this.score = 0;
    // Note: autoplay is NOT reset here - it persists across songs
  }

  /**
   * Reset score state only (for restarting a song)
   */
  resetScores() {
    this.tapNoteScores = [0, 0, 0, 0, 0, 0];
    this.actualPoints = 0;
    this.mineHits = 0;
    this.health = INITIAL_HEALTH;
    this.failed = false;
    this.combo = 0;
    this.maxCombo = 0;
    this.score = 0;

    // Reset note judgments so they can be hit again
    this.resetNoteJudgments();
  }

  /**
   * Reset note judgments (clear tapNoteScore from all notes)
   */
  resetNoteJudgments() {
    if (this.steps && this.steps.noteData) {
      this.steps.noteData.forEach((note) => {
        const noteProps = note[2];
        if (noteProps) {
          delete noteProps.tapNoteScore;
        }
      });
    }
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
   * Get a snapshot of gameplay state (useful for debugging)
   * Note: For song metadata, use songManager directly
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
      lastError: this.lastError,
      health: this.health,
      failed: this.failed,
      autoplay: this.autoplay,
      combo: this.combo,
      maxCombo: this.maxCombo,
      score: this.score
    };
  }
}

// Export singleton instance
export default new GameState();

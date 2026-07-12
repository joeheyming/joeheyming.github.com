// InputManager - Singleton for centralizing all input handling
// Manages keyboard, gamepad, and touch input with configurable key bindings

import { audioManager } from './audioManager.js';

/**
 * Column indices for the 4 arrow directions
 * @readonly
 * @enum {number}
 */
const COLUMNS = {
  LEFT: 0,
  DOWN: 1,
  UP: 2,
  RIGHT: 3
};

/**
 * Default key bindings (key codes to column mappings)
 * Supports both WASD and Arrow keys
 */
const DEFAULT_KEY_BINDINGS = {
  // Left column (0)
  65: COLUMNS.LEFT, // A
  37: COLUMNS.LEFT, // Left Arrow

  // Down column (1)
  83: COLUMNS.DOWN, // S
  40: COLUMNS.DOWN, // Down Arrow

  // Up column (2)
  87: COLUMNS.UP, // W
  38: COLUMNS.UP, // Up Arrow

  // Right column (3)
  68: COLUMNS.RIGHT, // D
  39: COLUMNS.RIGHT // Right Arrow
};

/**
 * Special action key bindings.
 *
 * The rate-mod controls reuse the SPEED_DOWN / SPEED_UP keys plus Shift
 * (handled in _onKeyDown). Pitch-preserve toggle lives on backslash, which
 * is right next to `[` `]` on a US QWERTY layout — kept close to the rate
 * keys on purpose.
 */
const ACTION_KEYS = {
  TOGGLE_PLAY: 32, // Space
  SPEED_DOWN: 219, // [
  SPEED_UP: 221, // ]
  TOGGLE_SCROLL_MODE: 192, // ` (backtick)
  TOGGLE_PITCH_PRESERVE: 220 // \ (backslash)
};

class InputManager {
  constructor() {
    if (InputManager.instance) {
      return InputManager.instance;
    }
    InputManager.instance = this;

    /** @type {Object<number, number>} Key code to column mapping */
    this.keyBindings = { ...DEFAULT_KEY_BINDINGS };

    /** @type {Object<number, boolean>} Currently held keys */
    this.heldKeys = {};

    /** @type {Set<number>} Columns currently held via pointer/touch on step buttons */
    this.touchHeldColumns = new Set();

    /** @type {boolean} Whether input is enabled */
    this.enabled = true;

    /** Event callbacks */
    this._callbacks = {
      step: [],
      release: [],
      togglePlay: [],
      speedChange: [],
      scrollModeChange: [],
      rateChange: [],
      togglePitchPreserve: []
    };

    /** Bound event handlers for cleanup */
    this._boundHandlers = {
      onKeyDown: this._onKeyDown.bind(this),
      onKeyUp: this._onKeyUp.bind(this),
      onStepButtonPress: this._onStepButtonPress.bind(this),
      onStepButtonRelease: this._onStepButtonRelease.bind(this)
    };

    this._initialized = false;
  }

  /**
   * Initialize input listeners
   */
  init() {
    if (this._initialized) return;

    document.addEventListener('keydown', this._boundHandlers.onKeyDown);
    document.addEventListener('keyup', this._boundHandlers.onKeyUp);
    document.addEventListener('stepButtonPress', this._boundHandlers.onStepButtonPress);
    document.addEventListener('stepButtonRelease', this._boundHandlers.onStepButtonRelease);

    this._initialized = true;
  }

  /**
   * Clean up input listeners
   */
  destroy() {
    document.removeEventListener('keydown', this._boundHandlers.onKeyDown);
    document.removeEventListener('keyup', this._boundHandlers.onKeyUp);
    document.removeEventListener('stepButtonPress', this._boundHandlers.onStepButtonPress);
    document.removeEventListener('stepButtonRelease', this._boundHandlers.onStepButtonRelease);

    this._initialized = false;
    this.heldKeys = {};
    this.touchHeldColumns.clear();
  }

  // ===========================================================================
  // KEY BINDING CONFIGURATION
  // ===========================================================================

  /**
   * Set custom key bindings
   * @param {Object<number, number>} bindings - Key code to column mapping
   */
  setKeyBindings(bindings) {
    this.keyBindings = { ...bindings };
  }

  /**
   * Reset to default key bindings
   */
  resetKeyBindings() {
    this.keyBindings = { ...DEFAULT_KEY_BINDINGS };
  }

  /**
   * Bind a key to a column
   * @param {number} keyCode - Key code
   * @param {number} column - Column index (0-3)
   */
  bindKey(keyCode, column) {
    if (column >= 0 && column <= 3) {
      this.keyBindings[keyCode] = column;
    }
  }

  /**
   * Unbind a key
   * @param {number} keyCode - Key code to unbind
   */
  unbindKey(keyCode) {
    delete this.keyBindings[keyCode];
  }

  /**
   * Get the current key bindings
   * @returns {Object<number, number>}
   */
  getKeyBindings() {
    return { ...this.keyBindings };
  }

  /**
   * Get keys bound to a specific column
   * @param {number} column - Column index
   * @returns {number[]} Array of key codes
   */
  getKeysForColumn(column) {
    return Object.entries(this.keyBindings)
      .filter(([, col]) => col === column)
      .map(([keyCode]) => parseInt(keyCode));
  }

  // ===========================================================================
  // INPUT STATE
  // ===========================================================================

  /**
   * Check if a column is currently held
   * @param {number} column - Column index
   * @returns {boolean}
   */
  isColumnHeld(column) {
    if (this.touchHeldColumns.has(column)) return true;
    const keys = this.getKeysForColumn(column);
    return keys.some((keyCode) => this.heldKeys[keyCode]);
  }

  /**
   * Enable input handling
   */
  enable() {
    this.enabled = true;
  }

  /**
   * Disable input handling
   */
  disable() {
    this.enabled = false;
    this.heldKeys = {};
    this.touchHeldColumns.clear();
  }

  /**
   * Reset held keys state
   */
  resetHeldKeys() {
    this.heldKeys = {};
    this.touchHeldColumns.clear();
  }

  // ===========================================================================
  // EVENT SUBSCRIPTION
  // ===========================================================================

  /**
   * Subscribe to step events (column pressed)
   * @param {Function} callback - Called with (column, source) where source is 'keyboard'|'touch'|'gamepad'
   * @returns {Function} Unsubscribe function
   */
  onStep(callback) {
    this._callbacks.step.push(callback);
    return () => {
      const index = this._callbacks.step.indexOf(callback);
      if (index > -1) this._callbacks.step.splice(index, 1);
    };
  }

  /**
   * Subscribe to release events (column released)
   * @param {Function} callback - Called with (column, source)
   * @returns {Function} Unsubscribe function
   */
  onRelease(callback) {
    this._callbacks.release.push(callback);
    return () => {
      const index = this._callbacks.release.indexOf(callback);
      if (index > -1) this._callbacks.release.splice(index, 1);
    };
  }

  /**
   * Subscribe to toggle play/pause events
   * @param {Function} callback
   * @returns {Function} Unsubscribe function
   */
  onTogglePlay(callback) {
    this._callbacks.togglePlay.push(callback);
    return () => {
      const index = this._callbacks.togglePlay.indexOf(callback);
      if (index > -1) this._callbacks.togglePlay.splice(index, 1);
    };
  }

  /**
   * Subscribe to speed change events
   * @param {Function} callback - Called with (direction) where direction is 1 (faster) or -1 (slower)
   * @returns {Function} Unsubscribe function
   */
  onSpeedChange(callback) {
    this._callbacks.speedChange.push(callback);
    return () => {
      const index = this._callbacks.speedChange.indexOf(callback);
      if (index > -1) this._callbacks.speedChange.splice(index, 1);
    };
  }

  /**
   * Subscribe to scroll mode toggle events
   * @param {Function} callback - Called when scroll mode should toggle
   * @returns {Function} Unsubscribe function
   */
  onScrollModeChange(callback) {
    this._callbacks.scrollModeChange.push(callback);
    return () => {
      const index = this._callbacks.scrollModeChange.indexOf(callback);
      if (index > -1) this._callbacks.scrollModeChange.splice(index, 1);
    };
  }

  /**
   * Subscribe to audio rate-change events (Shift+[ / Shift+]).
   * @param {Function} callback - Called with (direction) where direction
   *   is 1 (faster) or -1 (slower). Step size is left to the consumer.
   * @returns {Function} Unsubscribe function
   */
  onRateChange(callback) {
    this._callbacks.rateChange.push(callback);
    return () => {
      const index = this._callbacks.rateChange.indexOf(callback);
      if (index > -1) this._callbacks.rateChange.splice(index, 1);
    };
  }

  /**
   * Subscribe to pitch-preservation toggle events (backslash key).
   * @param {Function} callback
   * @returns {Function} Unsubscribe function
   */
  onTogglePitchPreserve(callback) {
    this._callbacks.togglePitchPreserve.push(callback);
    return () => {
      const index = this._callbacks.togglePitchPreserve.indexOf(callback);
      if (index > -1) this._callbacks.togglePitchPreserve.splice(index, 1);
    };
  }

  // ===========================================================================
  // INTERNAL EVENT HANDLERS
  // ===========================================================================

  /**
   * Check if event target is an input field
   * @param {Event} event
   * @returns {boolean}
   */
  _isInputField(event) {
    const target = event.target;
    return (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.contentEditable === 'true' ||
      target.isContentEditable ||
      target.nodeName === 'ZENIUS-BROWSER' ||
      target.nodeName === 'SMO-BROWSER'
    );
  }

  /**
   * Handle keydown events
   * @param {KeyboardEvent} event
   */
  _onKeyDown(event) {
    if (!this.enabled || this._isInputField(event)) return;

    const keyCode = event.which || event.keyCode;

    // Check for column binding
    const column = this.keyBindings[keyCode];
    if (column !== undefined) {
      if (!this.heldKeys[keyCode]) {
        this.heldKeys[keyCode] = true;
        this._emitStep(column, 'keyboard');
      }
      event.preventDefault();
      return;
    }

    // Check for action keys. Shift+[ / Shift+] reroute to rate change
    // before the bare keys fall through to scroll-speed change.
    if (keyCode === ACTION_KEYS.TOGGLE_PLAY) {
      this._emitTogglePlay();
      event.preventDefault();
    } else if (keyCode === ACTION_KEYS.SPEED_UP && event.shiftKey) {
      this._emitRateChange(1);
      event.preventDefault();
    } else if (keyCode === ACTION_KEYS.SPEED_DOWN && event.shiftKey) {
      this._emitRateChange(-1);
      event.preventDefault();
    } else if (keyCode === ACTION_KEYS.SPEED_UP) {
      this._emitSpeedChange(1);
      event.preventDefault();
    } else if (keyCode === ACTION_KEYS.SPEED_DOWN) {
      this._emitSpeedChange(-1);
      event.preventDefault();
    } else if (keyCode === ACTION_KEYS.TOGGLE_SCROLL_MODE) {
      this._emitScrollModeChange();
      event.preventDefault();
    } else if (keyCode === ACTION_KEYS.TOGGLE_PITCH_PRESERVE) {
      this._emitTogglePitchPreserve();
      event.preventDefault();
    }
  }

  /**
   * Handle keyup events
   * @param {KeyboardEvent} event
   */
  _onKeyUp(event) {
    if (!this.enabled || this._isInputField(event)) return;

    const keyCode = event.which || event.keyCode;

    // Check for column binding
    const column = this.keyBindings[keyCode];
    if (column !== undefined) {
      this.heldKeys[keyCode] = false;
      this._emitRelease(column, 'keyboard');
      event.preventDefault();
    }
  }

  /**
   * Parse the column index (0-3) out of a step-button id like `button2`
   * or `fs-button2` (fullscreen variant). Returns null when the id
   * doesn't match the expected shape.
   * @param {string} buttonId
   * @returns {number|null}
   */
  _columnFromButtonId(buttonId) {
    if (typeof buttonId !== 'string') return null;
    const match = buttonId.match(/button(\d+)$/);
    if (!match) return null;
    const column = parseInt(match[1], 10);
    if (isNaN(column) || column < 0 || column > 3) return null;
    return column;
  }

  /**
   * Handle step button press events (touch / mouse / pen).
   * Marks the column as held so long-note tracking in updateHolds()
   * treats a finger on the pad the same as a held key.
   * @param {CustomEvent} event
   */
  _onStepButtonPress(event) {
    if (!this.enabled) return;

    const column = this._columnFromButtonId(event.detail && event.detail.buttonId);
    if (column === null) return;

    if (this.touchHeldColumns.has(column)) return;
    this.touchHeldColumns.add(column);
    this._emitStep(column, 'touch');

    const stepButton = event.target;
    if (stepButton && stepButton.addPressedFeedback) {
      stepButton.addPressedFeedback();
    }
  }

  /**
   * Handle step button release events (pointerup / pointercancel).
   * Clears the held state and fires a release so an in-progress hold
   * can be judged as dropped instead of silently completing.
   * @param {CustomEvent} event
   */
  _onStepButtonRelease(event) {
    if (!this.enabled) return;

    const column = this._columnFromButtonId(event.detail && event.detail.buttonId);
    if (column === null) return;

    if (!this.touchHeldColumns.has(column)) return;
    this.touchHeldColumns.delete(column);
    this._emitRelease(column, 'touch');
  }

  /**
   * Called by GamepadManager when a button is pressed
   * @param {number} column - Column index
   */
  triggerStep(column) {
    if (!this.enabled) return;
    this._emitStep(column, 'gamepad');
  }

  /**
   * Called by GamepadManager when a button is released
   * @param {number} column - Column index
   */
  triggerRelease(column) {
    if (!this.enabled) return;
    this._emitRelease(column, 'gamepad');
  }

  // ===========================================================================
  // EMIT HELPERS
  // ===========================================================================

  _emitStep(column, source) {
    this._callbacks.step.forEach((callback) => {
      try {
        callback(column, source);
      } catch (e) {
        console.error('Error in step callback:', e);
      }
    });
  }

  _emitRelease(column, source) {
    this._callbacks.release.forEach((callback) => {
      try {
        callback(column, source);
      } catch (e) {
        console.error('Error in release callback:', e);
      }
    });
  }

  _emitTogglePlay() {
    // Default behavior: toggle audio
    if (this._callbacks.togglePlay.length === 0) {
      audioManager.toggle();
    } else {
      this._callbacks.togglePlay.forEach((callback) => {
        try {
          callback();
        } catch (e) {
          console.error('Error in togglePlay callback:', e);
        }
      });
    }
  }

  _emitSpeedChange(direction) {
    this._callbacks.speedChange.forEach((callback) => {
      try {
        callback(direction);
      } catch (e) {
        console.error('Error in speedChange callback:', e);
      }
    });
  }

  _emitScrollModeChange() {
    this._callbacks.scrollModeChange.forEach((callback) => {
      try {
        callback();
      } catch (e) {
        console.error('Error in scrollModeChange callback:', e);
      }
    });
  }

  _emitRateChange(direction) {
    this._callbacks.rateChange.forEach((callback) => {
      try {
        callback(direction);
      } catch (e) {
        console.error('Error in rateChange callback:', e);
      }
    });
  }

  _emitTogglePitchPreserve() {
    this._callbacks.togglePitchPreserve.forEach((callback) => {
      try {
        callback();
      } catch (e) {
        console.error('Error in togglePitchPreserve callback:', e);
      }
    });
  }
}

// Create and export singleton instance
const inputManager = new InputManager();

// Export column constants for convenience
export { COLUMNS };

// Make globally accessible for non-module scripts
window.inputManager = inputManager;

export { InputManager, inputManager };

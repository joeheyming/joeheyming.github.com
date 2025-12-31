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
 * Special action key bindings
 */
const ACTION_KEYS = {
  TOGGLE_PLAY: 32 // Space
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

    /** @type {boolean} Whether input is enabled */
    this.enabled = true;

    /** Event callbacks */
    this._callbacks = {
      step: [],
      release: [],
      togglePlay: []
    };

    /** Bound event handlers for cleanup */
    this._boundHandlers = {
      onKeyDown: this._onKeyDown.bind(this),
      onKeyUp: this._onKeyUp.bind(this),
      onStepButtonClick: this._onStepButtonClick.bind(this)
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
    document.addEventListener('stepButtonClick', this._boundHandlers.onStepButtonClick);

    this._initialized = true;
  }

  /**
   * Clean up input listeners
   */
  destroy() {
    document.removeEventListener('keydown', this._boundHandlers.onKeyDown);
    document.removeEventListener('keyup', this._boundHandlers.onKeyUp);
    document.removeEventListener('stepButtonClick', this._boundHandlers.onStepButtonClick);

    this._initialized = false;
    this.heldKeys = {};
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
  }

  /**
   * Reset held keys state
   */
  resetHeldKeys() {
    this.heldKeys = {};
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

    // Check for action keys
    if (keyCode === ACTION_KEYS.TOGGLE_PLAY) {
      this._emitTogglePlay();
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
   * Handle step button click events (touch)
   * @param {CustomEvent} event
   */
  _onStepButtonClick(event) {
    if (!this.enabled) return;

    const buttonId = event.detail.buttonId;
    const column = parseInt(buttonId.replace('button', ''));

    if (!isNaN(column) && column >= 0 && column <= 3) {
      this._emitStep(column, 'touch');

      // Provide visual feedback
      const stepButton = event.target;
      if (stepButton && stepButton.addPressedFeedback) {
        stepButton.addPressedFeedback();
      }
    }
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
}

// Create and export singleton instance
const inputManager = new InputManager();

// Export column constants for convenience
export { COLUMNS };

// Make globally accessible for non-module scripts
window.inputManager = inputManager;

export { InputManager, inputManager };

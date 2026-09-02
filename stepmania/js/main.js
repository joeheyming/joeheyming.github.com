// StepMania Main Entry Point - ES Module
// Loads all modules in the correct order.
// Boot splash (CSS + press animation + reveal) lives entirely in index.html.

// Kick off shared shadow CSS fetch before custom elements connect,
// so zenius-browser's modal is less likely to paint without position:fixed.
import { getSharedStyleSheet } from './sharedStyles.js';
void getSharedStyleSheet();

// Core game engine (no dependencies on other app modules)
import { startStepmania } from './stepmania.js';

// Page controller (depends on stepmania.js exports) — also pulls zenius-browser
import './mainPageController.js';

// Input handlers (depend on stepmania.js exports)
import './gamepad.js';

// UI handlers
import './fullscreen.js';

// Custom elements
import './step-button.js';
import './score-panel.js';
import './loading-overlay.js';
import './game-over-modal.js';
import './settings-sheet.js';

// Boot engine after custom elements and controller module are registered (DOM may still be loading).
startStepmania();

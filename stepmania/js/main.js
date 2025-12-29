// StepMania Main Entry Point - ES Module
// Loads all modules in the correct order

// Core game engine (no dependencies on other app modules)
import './stepmania.js';

// Page controller (depends on stepmania.js exports)
import './mainPageController.js';

// Input handlers (depend on stepmania.js exports)
import './gamepad.js';

// Custom elements
import './step-button.js';
import './score-panel.js';
import './loading-overlay.js';
import './game-over-modal.js';

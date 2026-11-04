// Play entry. Loaded with import() once a song, a pack, or a song URL
// needs the engine. Importing this file defines the play custom elements;
// ensurePlay() starts the loop and the page controller.

import { startStepmania } from './stepmania.js';
import { startMainPageController } from './mainPageController.js';
import './gamepad.js';
import './fullscreen.js';
import './step-button.js';
import './score-panel.js';
import './loading-overlay.js';
import './game-over-modal.js';
import './settings-sheet.js';

/** @type {Promise<import('./mainPageController.js').MainPageController> | null} */
let playReady = null;

/**
 * Start the canvas and the page controller. Later calls share one promise.
 * @returns {Promise<import('./mainPageController.js').MainPageController>}
 */
export function ensurePlay() {
  if (!playReady) {
    playReady = Promise.resolve().then(() => {
      startStepmania();
      return startMainPageController();
    });
  }
  return playReady;
}

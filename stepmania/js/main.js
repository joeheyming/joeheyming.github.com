// Song-menu boot. The play engine, song library, and JSZip stay unloaded
// until a click or a song URL needs them. The menu is already in the HTML.

import { bindHomeScreen, showHomeNotice, showHomeScreen } from './homeScreen.js';

/** @type {Promise<import('./mainPageController.js').MainPageController> | null} */
let playReady = null;

/**
 * Load the play engine once. A failed import is shown on the menu.
 * @returns {Promise<import('./mainPageController.js').MainPageController>}
 */
export function ensurePlay() {
  if (!playReady) {
    playReady = import('./play.js')
      .then((mod) => mod.ensurePlay())
      .catch((error) => {
        playReady = null;
        const detail = error instanceof Error ? error.message : 'The game did not load.';
        showHomeNotice(`${detail} Refresh the page and try again.`);
        throw error;
      });
  }
  return playReady;
}

function songRequested() {
  const params = new URLSearchParams(window.location.search);
  return params.has('zenius') || params.has('local');
}

function openLibrary() {
  void import('./zenius-browser.js')
    .then(({ ZeniusBrowser }) => ZeniusBrowser.showBrowser())
    .catch((error) => {
      const detail = error instanceof Error ? error.message : 'The song library did not load.';
      showHomeNotice(`${detail} Refresh the page and try again.`);
    });
}

bindHomeScreen({
  onBrowse: openLibrary,
  onOpenFile: (file) => {
    void ensurePlay()
      .then((controller) => controller.loadFromLocalFile(file))
      .catch(() => {});
  },
  onPlayZenius: (zeniusUrl) => {
    void ensurePlay()
      .then((controller) => controller.loadFromZeniusURL(zeniusUrl))
      .catch(() => {});
  }
});

showHomeScreen();

if (songRequested()) {
  // Parse the chart UI before the play engine. Loading both at once keeps the
  // difficulty dialog behind the engine's module graph.
  if (new URLSearchParams(window.location.search).has('zenius')) {
    void import('./zeniusEntry.js')
      .then((mod) => mod.primeZeniusChart())
      .catch(() => {})
      .then(() => ensurePlay())
      .catch(() => {});
  } else {
    void ensurePlay().catch(() => {});
  }
}

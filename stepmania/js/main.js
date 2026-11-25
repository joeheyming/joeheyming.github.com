// Song-menu boot. The play engine, song library, and JSZip stay unloaded
// until a click or a song URL needs them. The menu is already in the HTML.

import { bindHomeScreen, showHomeNotice, showHomeScreen, showHomeStatus } from './homeScreen.js';

// scheduler.yield() (yieldToMain) can resume before the browser paints, so a
// click that then evaluates the play engine keeps that work on its INP.
function afterPaint() {
  if (typeof window.afterNextPaint === 'function') return window.afterNextPaint();
  return new Promise((resolve) => setTimeout(resolve, 0));
}

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
  showHomeStatus('Opening the song library…');
  void afterPaint()
    .then(() => import('./zenius-browser.js'))
    .then(({ ZeniusBrowser }) => ZeniusBrowser.showBrowser())
    .catch((error) => {
      const detail = error instanceof Error ? error.message : 'The song library did not load.';
      showHomeNotice(`${detail} Refresh the page and try again.`);
    });
}

bindHomeScreen({
  onBrowse: openLibrary,
  onOpenFile: (file) => {
    showHomeStatus('Opening that pack…');
    void afterPaint()
      .then(() => ensurePlay())
      .then((controller) => controller.loadFromLocalFile(file))
      .catch(() => {});
  },
  onPlayZenius: (zeniusUrl) => {
    showHomeStatus('Loading the game…');
    void afterPaint()
      .then(() => ensurePlay())
      .then((controller) => controller.loadFromZeniusURL(zeniusUrl))
      .catch(() => {});
  }
});

showHomeScreen();

// proxy.js evaluates as one task. Wait until the menu has painted and the
// browser is idle so that task is not the first tap's input delay.
function warmProxyWhenIdle() {
  const start = () => {
    void import('./ensureProxy.js')
      .then((mod) => mod.ensureProxy())
      .catch(() => {});
  };
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(start, { timeout: 2500 });
  } else {
    setTimeout(start, 1500);
  }
}

warmProxyWhenIdle();

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

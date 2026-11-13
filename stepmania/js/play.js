// Play entry. Loaded with import() once a song, a pack, or a song URL
// needs the engine. The engine is about 480 KB of modules. Evaluating that
// in one import() is one long task, and a key pressed while it runs waits
// for the whole thing. PLAY_CHUNKS is dependency order, each group small
// enough to evaluate on its own, with a yield between groups.

/** @type {Promise<import('./mainPageController.js').MainPageController> | null} */
let playReady = null;

// Each group's files, plus the outside modules they import, stay under 40 KB.
// A dependency is always in an earlier group, or earlier in the same group.
export const PLAY_CHUNKS = [
  [
    'videoLoadLogging.js',
    'componentProxy.js',
    'videoContextCopy.js',
    'jszipLoader.js',
    'urlUtils.js',
    'sharedStyles.js',
    'judgmentPolicy.js',
    'sprite.js',
    'localPackStore.js',
    'msd.js',
    'songProxyTransport.js',
    'config.js',
    'gamepad-map.js',
    'songClock.js',
    'zeniusLibraryStorage.js'
  ],
  [
    'columnPressAdjudication.js',
    'step-button.js',
    'scoreboard.js',
    'difficulty-selector.js',
    'dwi.js'
  ],
  ['popularSongs.js', 'videoConverter.js', 'homeScreen.js'],
  ['score-panel.js', 'audioManager.js'],
  ['timingData.js', 'noteGrid.js', 'simfileWriter.js'],
  ['simfileParser.js', 'songFromPack.js', 'packIo.js'],
  ['gameState.js', 'timing.js'],
  ['songLoader.js', 'songManager.js'],
  ['videoManager.js', 'game-over-modal.js'],
  ['canvasManager.js', 'Actor.js', 'judgment.js', 'noteRenderer.js'],
  ['inputManager.js', 'fullscreen.js'],
  ['settings-sheet.js', 'gamepad.js'],
  ['loading-overlay.js', 'zeniusEntry.js'],
  ['stepmania.js'],
  ['mainPageController.js']
];

function yieldForInput() {
  if (typeof window !== 'undefined' && typeof window.yieldToMain === 'function') {
    return window.yieldToMain();
  }
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * @param {string} name file in this directory
 */
function loadModule(name) {
  return import('./' + name);
}

async function loadPlayChunks() {
  for (const chunk of PLAY_CHUNKS) {
    await Promise.all(chunk.map((name) => loadModule(name)));
    await yieldForInput();
  }
}

/**
 * Start the canvas and the page controller. Later calls share one promise.
 * @returns {Promise<import('./mainPageController.js').MainPageController>}
 */
export function ensurePlay() {
  if (!playReady) {
    playReady = loadPlayChunks()
      .then(async () => {
        const { startStepmania } = await loadModule('stepmania.js');
        const { startMainPageController } = await loadModule('mainPageController.js');
        startStepmania();
        await yieldForInput();
        return startMainPageController();
      })
      .catch((error) => {
        playReady = null;
        throw error;
      });
  }
  return playReady;
}

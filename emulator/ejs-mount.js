// EmulatorJS mount helper for the unified /emulator/ shell.
//
// Sets EJS_* globals, installs SOCD cleaning, and injects loader.js.
// Analytics, achievements, and play chrome stay in launch.js — call
// `emulatorEjsMount.mount(...)` after those side effects.
//
// Public surface: window.emulatorEjsMount
(function () {
  'use strict';

  /**
   * @param {object} opts
   * @param {object} opts.cfg — console registry entry
   * @param {File|string} opts.romSource
   * @param {string} [opts.romName]
   * @param {File|null} [opts.biosFile]
   * @param {() => void} [opts.onExit] — Exit Emulation toolbar callback
   */
  function mount(opts) {
    opts = opts || {};
    const cfg = opts.cfg;
    if (!cfg) {
      console.error('emulatorEjsMount.mount: no console cfg; bailing.');
      return;
    }

    const romSource = opts.romSource;
    const romName = opts.romName;

    window.EJS_player = '#game';
    window.EJS_core = cfg.ejsCore;
    window.EJS_gameUrl = romSource;
    window.EJS_gameName =
      romName || (romSource && typeof romSource === 'object' && romSource.name) || '';
    window.EJS_pathtodata = 'https://cdn.emulatorjs.org/latest/data/';
    window.EJS_startOnLoaded = true;
    // Threads need SharedArrayBuffer. When SAB exists we leave EJS_threads
    // alone so EmulatorJS keeps offering its own opt-in; without SAB, pin it
    // off so the loader picks the single-thread core instead of tripping over
    // a missing SharedArrayBuffer constructor.
    if (!window.crossOriginIsolated) {
      window.EJS_threads = false;
    }
    // EJS_color wants a string; pull from the computed accent so a
    // future identity tweak only has to touch consoles.js.
    window.EJS_color =
      getComputedStyle(document.documentElement).getPropertyValue('--accent-bright').trim() ||
      cfg.accentHex;
    window.EJS_defaultControls = 1;

    if (cfg.biosRequired && opts.biosFile) {
      // Same shape as EJS_gameUrl (File). EmulatorJS reads .name so the
      // canonical neogeo.zip filename is preserved for FBNeo.
      window.EJS_biosUrl = opts.biosFile;
    }

    if (typeof opts.onExit === 'function') {
      // Exit Emulation: by default EmulatorJS leaves the user staring at an
      // "EmulatorJS has exited" message because a WASM instance can't be
      // unloaded in place. Override the toolbar button to reload back to the
      // console lander.
      window.EJS_Buttons = Object.assign({}, window.EJS_Buttons, {
        exitEmulation: {
          callback: opts.onExit
        }
      });
    }

    // Arrow keys are the d-pad from here on, so opposing pairs have to be
    // cleaned before EmulatorJS binds its own key handler. Deferred to now
    // because the boot card and ROM browser navigate with the same keys.
    window.emulatorSocd?.install();

    const script = document.createElement('script');
    script.src = 'https://cdn.emulatorjs.org/latest/data/loader.js';
    document.body.appendChild(script);
  }

  window.emulatorEjsMount = {
    mount
  };
})();

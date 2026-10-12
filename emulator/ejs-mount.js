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
    // EmulatorJS defaults save states to "Download". That writes a file the
    // load button then has to re-import, and the import path does not restore
    // GBA (or other) games. Keep states in this browser, which is what the
    // page already tells players. A previous session may have stored
    // "download"; keepSavesInBrowser flips it back once the core is up.
    window.EJS_defaultOptions = Object.assign({}, window.EJS_defaultOptions, {
      'save-state-location': 'browser'
    });

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

    // DS only. Other cores use the mouse for light guns, and replaying a
    // finger as a click would fire those by accident.
    if (cfg.id === 'nds' || cfg.ejsCore === 'nds') {
      installNdsStylus();
    }

    const script = document.createElement('script');
    script.src = 'https://cdn.emulatorjs.org/latest/data/loader.js';
    script.onload = function () {
      attachBrowserSaves();
    };
    document.body.appendChild(script);
  }

  /**
   * Save State / Load State stay in IndexedDB. Import Save File writes the
   * battery file, then restarts so mGBA actually reads it — a refresh of the
   * SRAM while the game is already running does not.
   * @param {object} [emu]
   * @returns {boolean}
   */
  function keepSavesInBrowser(emu) {
    if (!emu || typeof emu.menuOptionChanged !== 'function') return false;
    try {
      emu.menuOptionChanged('save-state-location', 'browser');
    } catch (err) {
      console.warn('Could not keep save states in this browser', err);
    }
    const gm = emu.gameManager;
    if (gm && typeof gm.loadSaveFiles === 'function' && !gm._heymingImportRestarts) {
      const orig = gm.loadSaveFiles.bind(gm);
      gm.loadSaveFiles = function loadSaveFilesAndRestart() {
        orig();
        if (typeof gm.restart === 'function') gm.restart();
      };
      gm._heymingImportRestarts = true;
    }
    return true;
  }

  function attachBrowserSaves() {
    let tries = 0;
    const tryAttach = function () {
      const emu = window.EJS_emulator;
      if (!emu || typeof emu.on !== 'function') {
        tries += 1;
        if (tries > 200) return;
        window.setTimeout(tryAttach, 50);
        return;
      }
      if (emu.started) keepSavesInBrowser(emu);
      emu.on('start', function () {
        keepSavesInBrowser(emu);
      });
    };
    tryAttach();
  }

  /**
   * melonDS reads the stylus from RetroArch's mouse device. A trackpad
   * produces mouse events, so it already works. A Windows touchscreen
   * produces touch and pointer events, which RetroArch files on a separate
   * pointer device the core ignores. Replay a finger or pen as mouse
   * events on the canvas. `touch-action: none` keeps the browser from
   * taking the gesture as a page scroll before the core sees it.
   * @param {Document} [doc]
   * @returns {boolean}
   */
  function installNdsStylus(doc) {
    const root = doc || document;
    const game = root.getElementById('game');
    if (!game || game.dataset.ndsStylus === 'on') return false;
    game.dataset.ndsStylus = 'on';
    game.style.touchAction = 'none';

    const synthetic = new WeakSet();
    let activeId = null;

    function canvasEl() {
      return game.querySelector('canvas');
    }

    function arm(node) {
      if (!node || node.tagName !== 'CANVAS') return;
      if (node.style.touchAction !== 'none') node.style.touchAction = 'none';
      if (node.classList.contains('ejs-canvas-no-pointer')) {
        node.classList.remove('ejs-canvas-no-pointer');
      }
    }

    arm(canvasEl());
    const observer = new MutationObserver(function () {
      arm(canvasEl());
    });
    observer.observe(game, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style']
    });

    function onSurface(ev) {
      const canvas = canvasEl();
      if (!canvas) return false;
      return ev.target === canvas || ev.target === game;
    }

    function dispatch(type, ev, buttons) {
      const canvas = canvasEl();
      if (!canvas) return;
      const view = root.defaultView || window;
      const mouse = new view.MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: view,
        clientX: ev.clientX,
        clientY: ev.clientY,
        screenX: ev.screenX,
        screenY: ev.screenY,
        button: 0,
        buttons: buttons,
        movementX: ev.movementX || 0,
        movementY: ev.movementY || 0
      });
      synthetic.add(mouse);
      canvas.dispatchEvent(mouse);
    }

    function begin(ev) {
      if (ev.pointerType !== 'touch' && ev.pointerType !== 'pen') return;
      if (!onSurface(ev) || activeId !== null) return;
      activeId = ev.pointerId;
      if (ev.cancelable) ev.preventDefault();
      const cap = ev.target;
      if (cap && typeof cap.setPointerCapture === 'function') {
        try {
          cap.setPointerCapture(ev.pointerId);
        } catch (err) {
          // The hit target can refuse capture when the canvas was
          // pointer-events: none. Moves still arrive on #game.
        }
      }
      dispatch('mousemove', ev, 1);
      dispatch('mousedown', ev, 1);
    }

    function move(ev) {
      if (ev.pointerId !== activeId) return;
      if (ev.cancelable) ev.preventDefault();
      dispatch('mousemove', ev, 1);
    }

    function end(ev) {
      if (ev.pointerId !== activeId) return;
      activeId = null;
      if (ev.cancelable) ev.preventDefault();
      dispatch('mouseup', ev, 0);
    }

    // Chrome also synthesizes mouse events after a touch. RetroArch would
    // see both and double-tap the stylus. Drop the compatibility ones.
    function swallowCompatibility(ev) {
      if (synthetic.has(ev)) return;
      const fromTouch = ev.sourceCapabilities && ev.sourceCapabilities.firesTouchEvents;
      if (!fromTouch) return;
      ev.stopImmediatePropagation();
    }

    game.addEventListener('pointerdown', begin, { capture: true, passive: false });
    game.addEventListener('pointermove', move, { capture: true, passive: false });
    game.addEventListener('pointerup', end, { capture: true, passive: false });
    game.addEventListener('pointercancel', end, { capture: true, passive: false });
    game.addEventListener('mousedown', swallowCompatibility, true);
    game.addEventListener('mousemove', swallowCompatibility, true);
    game.addEventListener('mouseup', swallowCompatibility, true);
    return true;
  }

  window.emulatorEjsMount = {
    mount,
    keepSavesInBrowser,
    installNdsStylus
  };
})();

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
  // Chrome often leaves slot 0 empty and puts a DualShock 4 at index 1.
  // EmulatorJS then looks up its pad list by that index and misses the
  // controller. Repack connected pads into the lowest slots, and report the
  // new slot as `index`, before the loader starts polling.
  function packGamepadSlots(pads) {
    const list = pads ? Array.from(pads) : [];
    const connected = [];
    for (let i = 0; i < list.length; i++) {
      if (list[i]) connected.push(list[i]);
    }
    let alreadyPacked = true;
    for (let i = 0; i < connected.length; i++) {
      if (connected[i].index !== i) alreadyPacked = false;
    }
    if (alreadyPacked) return list;

    const packed = new Array(list.length).fill(null);
    for (let slot = 0; slot < connected.length; slot++) {
      const pad = connected[slot];
      packed[slot] = new Proxy(pad, {
        get(target, prop) {
          if (prop === 'index') return slot;
          const value = target[prop];
          return typeof value === 'function' ? value.bind(target) : value;
        }
      });
    }
    return packed;
  }

  function installCompactGamepadSlots() {
    if (installCompactGamepadSlots.installed) return;
    const nav = navigator;
    if (!nav || typeof nav.getGamepads !== 'function') return;
    const original = nav.getGamepads.bind(nav);
    function packedGetGamepads() {
      return packGamepadSlots(original());
    }
    try {
      nav.getGamepads = packedGetGamepads;
      installCompactGamepadSlots.installed = true;
    } catch (err) {
      console.warn('Could not compact gamepad slots', err);
    }
  }

  function mount(opts) {
    opts = opts || {};
    const cfg = opts.cfg;
    if (!cfg) {
      console.error('emulatorEjsMount.mount: no console cfg; bailing.');
      return;
    }

    installCompactGamepadSlots();

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
    // F5 / F9 are the keys this page documents. EmulatorJS binds quick
    // save to 1 and quick load to 2, and those slots live in the WASM
    // heap, so a refresh forgets them. Keep each slot in IndexedDB and
    // treat F5 / F9 as that quick save.
    // The current EmulatorJS script reads states with Module.EmulatorJSGetState.
    // Cores it still ships as "-legacy" (NES fceumm, when the core report
    // leaves WebGL2 off) do not export that function, so quick save returns
    // false. Those cores still report the bytes through save_state_info.
    patchLegacyGetState(emu);
    persistQuickStates(emu);
    installSaveHotkeys();
    return true;
  }

  /**
   * @param {object} emu
   * @returns {boolean}
   */
  function patchLegacyGetState(emu) {
    const gm = emu && emu.gameManager;
    const mod = gm && gm.Module;
    if (!gm || gm._heymingGetState || typeof gm.getState !== 'function') return false;
    if (!mod || typeof mod.EmulatorJSGetState === 'function' || typeof mod.cwrap !== 'function') {
      return false;
    }
    let info;
    try {
      info = mod.cwrap('save_state_info', 'string', []);
    } catch (err) {
      console.warn('Could not read legacy save states', err);
      return false;
    }
    const orig = gm.getState.bind(gm);
    gm.getState = function getStateLegacy() {
      if (typeof mod.EmulatorJSGetState === 'function') return orig();
      const state = String(info()).split('|');
      if (state[2] !== '1') throw new Error(state[0] || 'save state failed');
      const size = parseInt(state[0], 10);
      const dataStart = parseInt(state[1], 10);
      const heap = mod.HEAPU8;
      if (!heap || !Number.isFinite(size) || size <= 0 || !Number.isFinite(dataStart)) {
        throw new Error('save state failed');
      }
      // Copy. The heap view is invalid once the core writes again.
      return new Uint8Array(heap.subarray(dataStart, dataStart + size));
    };
    gm._heymingGetState = true;
    return true;
  }

  /**
   * EmulatorJS names a slot `1-quick.state` and writes it on the WASM
   * filesystem. The same string is the IndexedDB key, prefixed with the
   * core and the ROM name so two games do not share a slot.
   * @param {object} emu
   * @param {number|string} slot
   * @returns {string}
   */
  function slotFileName(slot) {
    if (!slot) slot = 1;
    return slot + '-quick.state';
  }

  /**
   * @param {object} emu
   * @returns {string}
   */
  function gameStateName(emu) {
    if (emu && typeof emu.getBaseFileName === 'function') {
      const name = emu.getBaseFileName();
      if (name) return name;
    }
    const cfg = emu && emu.config;
    if (cfg && typeof cfg.gameName === 'string' && cfg.gameName.trim()) return cfg.gameName.trim();
    return '';
  }

  /**
   * @param {object} emu
   * @param {number|string} slot
   * @returns {string}
   */
  function stateStorageKey(emu, slot) {
    const name = gameStateName(emu);
    if (!name) return '';
    const system = (emu.config && (emu.config.system || emu.config.core)) || '';
    return system + '/' + name + '/' + slotFileName(slot);
  }

  /**
   * @param {object} emu
   * @returns {number|string}
   */
  function currentSlot(emu) {
    const raw =
      emu && typeof emu.getSettingValue === 'function' && emu.getSettingValue('save-state-slot');
    return raw || 1;
  }

  /**
   * @param {object} emu
   * @returns {{ put: Function, get: Function } | null}
   */
  function statesStore(emu) {
    const states = emu && emu.storage && emu.storage.states;
    if (!states || typeof states.put !== 'function' || typeof states.get !== 'function')
      return null;
    return states;
  }

  /**
   * @param {object} gm
   * @param {number|string} slot
   * @returns {Uint8Array | string | null}
   */
  function readSlotFile(gm, slot) {
    if (!gm || !gm.FS || typeof gm.FS.readFile !== 'function') return null;
    const name = slotFileName(slot);
    const paths = ['/' + name, name];
    for (let i = 0; i < paths.length; i++) {
      try {
        return gm.FS.readFile(paths[i]);
      } catch (err) {
        /* the other path, or the slot was never written */
      }
    }
    return null;
  }

  /**
   * @param {object} emu
   * @param {string} message
   * @param {string} severity
   * @param {string} [suffix]
   */
  function toast(emu, message, severity, suffix) {
    const fe = emu && emu.frontend;
    if (!fe || typeof fe.displayMessage !== 'function') return;
    fe.displayMessage(message, undefined, suffix, severity);
  }

  /**
   * Copy quick-save slots into IndexedDB, and read them back when the
   * WASM file is gone (a reload).
   * @param {object} emu
   * @returns {boolean}
   */
  function persistQuickStates(emu) {
    const gm = emu && emu.gameManager;
    if (!gm || gm._heymingQuickPersisted) return false;
    if (typeof gm.quickSave !== 'function' || typeof gm.quickLoad !== 'function') return false;
    const origSave = gm.quickSave.bind(gm);
    const origLoad = gm.quickLoad.bind(gm);
    gm.quickSave = function quickSaveAndKeep(slot) {
      const ok = origSave(slot);
      if (!ok) return false;
      const store = statesStore(emu);
      const key = stateStorageKey(emu, slot || 1);
      const data = readSlotFile(gm, slot || 1);
      if (store && key && data) store.put(key, data);
      return true;
    };
    gm.quickLoad = function quickLoadFromBrowser(slot) {
      if (readSlotFile(gm, slot || 1)) {
        origLoad(slot);
        return Promise.resolve(true);
      }
      const store = statesStore(emu);
      const key = stateStorageKey(emu, slot || 1);
      if (!store || !key) return Promise.resolve(false);
      return store.get(key).then(function (data) {
        if (!data || !gm.FS || typeof gm.FS.writeFile !== 'function') return false;
        gm.FS.writeFile('/' + slotFileName(slot || 1), data);
        origLoad(slot);
        return true;
      });
    };
    gm._heymingQuickPersisted = true;
    return true;
  }

  /**
   * @returns {object | null}
   */
  function playingEmulator() {
    const emu = window.EJS_emulator;
    if (!emu || !emu.started || !emu.gameManager) return null;
    return emu;
  }

  /**
   * @returns {boolean}
   */
  function saveQuickState() {
    const emu = playingEmulator();
    if (!emu || typeof emu.gameManager.quickSave !== 'function') return false;
    persistQuickStates(emu);
    const slot = currentSlot(emu);
    let ok = false;
    try {
      ok = emu.gameManager.quickSave(slot) !== false;
    } catch (err) {
      console.warn('Could not save state', err);
      ok = false;
    }
    if (ok) toast(emu, 'SAVED STATE TO SLOT', 'success', ' ' + slot);
    else toast(emu, 'FAILED TO SAVE STATE', 'error');
    return ok;
  }

  /**
   * @returns {boolean}
   */
  function loadQuickState() {
    const emu = playingEmulator();
    if (!emu || typeof emu.gameManager.quickLoad !== 'function') return false;
    persistQuickStates(emu);
    const slot = currentSlot(emu);
    let pending;
    try {
      pending = emu.gameManager.quickLoad(slot);
    } catch (err) {
      console.warn('Could not load state', err);
      toast(emu, 'FAILED TO SAVE STATE', 'error');
      return false;
    }
    Promise.resolve(pending).then(function (ok) {
      if (ok) toast(emu, 'LOADED STATE FROM SLOT', 'success', ' ' + slot);
      else toast(emu, 'No save state in this browser yet', 'error');
    });
    return true;
  }

  /**
   * @param {KeyboardEvent} event
   * @returns {boolean} true when this handler claimed the key
   */
  function onSaveHotkey(event) {
    if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) {
      if (event.repeat && (event.key === 'F5' || event.code === 'F5')) event.preventDefault();
      return false;
    }
    const save = event.key === 'F5' || event.code === 'F5';
    const load = event.key === 'F9' || event.code === 'F9';
    if (!save && !load) return false;
    const target = event.target;
    const tag = target && target.tagName;
    if (
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      tag === 'SELECT' ||
      (target && target.isContentEditable)
    ) {
      return false;
    }
    const emu = window.EJS_emulator;
    if (!emu || !emu.started) return false;
    event.preventDefault();
    event.stopPropagation();
    if (event.type !== 'keydown') return true;
    if (save) saveQuickState();
    else loadQuickState();
    return true;
  }

  let saveHotkeysInstalled = false;

  function installSaveHotkeys() {
    if (saveHotkeysInstalled) return;
    saveHotkeysInstalled = true;
    window.addEventListener('keydown', onSaveHotkey, true);
    window.addEventListener('keyup', onSaveHotkey, true);
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
    packGamepadSlots,
    keepSavesInBrowser,
    patchLegacyGetState,
    persistQuickStates,
    saveQuickState,
    loadQuickState,
    onSaveHotkey,
    installNdsStylus
  };
})();

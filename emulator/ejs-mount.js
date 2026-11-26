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

  /**
   * EmulatorJS core URLs that should be served from this site.
   * The query string is a cache buster, so match the path, not the whole URL.
   * @param {string} url
   * @returns {string|null}
   */
  function flycastCoreUrl(url) {
    const path = String(url || '').split('?')[0];
    if (path.endsWith('/cores/reports/flycast.json')) {
      return '/emulator/dreamcast/flycast-report.json';
    }
    if (/\/cores\/flycast(?:-thread)?(?:-legacy)?-wasm\.data$/.test(path)) {
      return '/emulator/dreamcast/flycast-wasm.data';
    }
    return null;
  }

  function installFlycastCorePaths() {
    if (installFlycastCorePaths.installed) return;
    const origFetch = window.fetch ? window.fetch.bind(window) : null;
    if (origFetch) {
      window.fetch = function fetchFlycastCore(input, init) {
        const raw = typeof input === 'string' ? input : input && input.url;
        const next = flycastCoreUrl(raw);
        if (!next) return origFetch(input, init);
        if (typeof input === 'string' || input instanceof URL) return origFetch(next, init);
        return origFetch(new Request(next, input), init);
      };
    }
    if (typeof XMLHttpRequest === 'function') {
      const origOpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function openFlycastCore(method, url) {
        const next = flycastCoreUrl(url);
        const args = Array.prototype.slice.call(arguments);
        if (next) args[1] = next;
        return origOpen.apply(this, args);
      };
    }
    installFlycastCorePaths.installed = true;
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

  /** @type {{ console: string, file: string, title: string } | null} */
  let mountedGame = null;
  let pendingResume = false;

  /**
   * Phones and cheap laptops. deviceMemory is Chrome-only; core count covers
   * the rest. Smoothing is the cheap default to drop. It does not make N64
   * feel like NES.
   * @param {Navigator | { deviceMemory?: number, hardwareConcurrency?: number }} [nav]
   */
  function prefersLightVideo(nav) {
    const info = nav || {};
    const mem = Number(info.deviceMemory);
    const cores = Number(info.hardwareConcurrency);
    if (Number.isFinite(mem) && mem > 0 && mem <= 4) return true;
    if (Number.isFinite(cores) && cores > 0 && cores <= 4) return true;
    return false;
  }

  /**
   * @param {Record<string, string>} options
   * @param {Navigator | { deviceMemory?: number, hardwareConcurrency?: number }} [nav]
   */
  function applyVideoDefaults(options, nav) {
    const next = Object.assign({}, options);
    if (prefersLightVideo(nav)) next['video-smoothing'] = 'disabled';
    return next;
  }

  function mount(opts) {
    opts = opts || {};
    const cfg = opts.cfg;
    if (!cfg) {
      console.error('emulatorEjsMount.mount: no console cfg; bailing.');
      return;
    }
    pendingResume = !!opts.resume;
    const fileName =
      opts.romName ||
      (opts.romSource && typeof opts.romSource === 'object' && opts.romSource.name) ||
      '';
    mountedGame = {
      console: cfg.id || '',
      file: fileName,
      title: opts.title || fileName
    };

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
    } else if (cfg.requiresThreads) {
      // PPSSPP has no single-thread build, so the opt-in is not optional.
      window.EJS_threads = true;
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
    window.EJS_defaultOptions = applyVideoDefaults(
      Object.assign({}, window.EJS_defaultOptions, {
        'save-state-location': 'browser'
      }),
      navigator
    );
    // EmulatorJS has no PSP on-screen layout, so a touch falls through to a
    // SNES pad with no analog stick. Supply the PSP one, and show it when
    // this device actually has a touchscreen. A saved "disabled" still wins,
    // because loadSettings runs after these defaults.
    // Genesis, CD, 32X, and Saturn place A/X at right:145 inside a 130px
    // cluster, which clips that column. Supply a layout that fits.
    // Every other console uses EmulatorJS's own pad, which it only enables
    // when the user agent looks like a phone. An iPad (which reports itself
    // as a Mac), a phone on "desktop site", or an emulated phone view misses
    // that sniff and gets no buttons. Turn the pad on whenever the primary
    // pointer is a finger; touch laptops keep their mouse-first default.
    if (isPsp(cfg)) {
      window.EJS_VirtualGamepadSettings = pspTouchControls();
    } else if (isSixButtonSega(cfg)) {
      window.EJS_VirtualGamepadSettings = segaTouchControls(cfg.ejsCore);
    } else {
      delete window.EJS_VirtualGamepadSettings;
    }
    if (isPsp(cfg) ? deviceHasTouch() : primaryPointerIsTouch()) {
      window.EJS_defaultOptions['virtual-gamepad'] = 'enabled';
    } else {
      delete window.EJS_defaultOptions['virtual-gamepad'];
    }

    if (cfg.ejsCore === 'flycast') {
      // EmulatorJS asks the CDN for cores/flycast-wasm.data. That file is
      // not there; the vendored zip in this repo is the core.
      installFlycastCorePaths();
      window.EJS_retroarchOpts = [{ name: 'system_directory', value: '/', isString: true }];
    } else {
      delete window.EJS_retroarchOpts;
    }

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
    // The PSP on-screen pad listens for touch events. A Windows touchscreen
    // often sends only pointer events, so replay a finger or pen as touch.
    if (isPsp(cfg)) {
      installPspTouch();
      installPspDragAim();
    }

    const attachLoader = function () {
      const script = document.createElement('script');
      script.src = 'https://cdn.emulatorjs.org/latest/data/loader.js';
      script.onload = function () {
        attachBrowserSaves();
      };
      document.body.appendChild(script);
    };
    if (cfg.ejsCore === 'flycast') {
      // The WebGL2 shim has to patch getContext before EmulatorJS creates its
      // canvas. A failed shim still boots the loader; the core may not draw.
      import('/shared/lazy.js')
        .then((lazy) => lazy.loadScript('/emulator/dreamcast/webgl2-compat.js'))
        .catch((err) => console.warn('WebGL2 compat shim did not load:', err))
        .finally(attachLoader);
    } else {
      attachLoader();
    }
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
    if (ok) {
      toast(emu, 'SAVED STATE TO SLOT', 'success', ' ' + slot);
      rememberResume();
    } else toast(emu, 'FAILED TO SAVE STATE', 'error');
    return ok;
  }

  /**
   * A small JPEG of the game screen for the card and the home page.
   * A tainted canvas, or a core that has not drawn yet, yields nothing.
   * @returns {string}
   */
  function captureShot() {
    const canvas = document.querySelector('#game canvas') || document.querySelector('canvas');
    if (!canvas || !canvas.width || !canvas.height) return '';
    const width = 160;
    const height = Math.max(1, Math.min(120, Math.round((canvas.height * width) / canvas.width)));
    const copy = document.createElement('canvas');
    copy.width = width;
    copy.height = height;
    const ctx = copy.getContext('2d');
    if (!ctx) return '';
    try {
      ctx.drawImage(canvas, 0, 0, width, height);
      const url = copy.toDataURL('image/jpeg', 0.55);
      return url.startsWith('data:image/jpeg') ? url : '';
    } catch (err) {
      return '';
    }
  }

  function rememberResume() {
    const api = window.emulatorResumes;
    if (!api || typeof api.remember !== 'function' || !mountedGame || !mountedGame.file) return;
    api.remember(window.localStorage, {
      console: mountedGame.console,
      file: mountedGame.file,
      title: mountedGame.title,
      shot: captureShot()
    });
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
        keepTouchPadVisible(emu);
        if (!pendingResume) return;
        pendingResume = false;
        loadQuickState();
      });
    };
    tryAttach();
  }

  function isPsp(cfg) {
    return !!(cfg && (cfg.id === 'psp' || cfg.ejsCore === 'psp'));
  }

  function isSixButtonSega(cfg) {
    const core = cfg && cfg.ejsCore;
    return core === 'segaMD' || core === 'segaCD' || core === 'sega32x' || core === 'segaSaturn';
  }

  function deviceHasTouch() {
    const nav = typeof navigator === 'undefined' ? null : navigator;
    if (nav && Number(nav.maxTouchPoints) > 0) return true;
    return typeof window !== 'undefined' && 'ontouchstart' in window;
  }

  function primaryPointerIsTouch() {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(pointer: coarse)').matches;
  }

  /**
   * EmulatorJS builds the on-screen pad, then sets display:none. It turns
   * the pad back on when the game starts, but its resize handler also
   * measures a hidden pad by showing it and hiding it again 250ms later.
   * A resize while the core is still loading — the address bar, or turning
   * the phone landscape — schedules that hide, and the hide lands after
   * the game has shown the pad. For a couple of seconds after start, put
   * a pad back if this session asked for one. A saved "disabled" still wins.
   * @param {object} emu
   * @returns {boolean}
   */
  function keepTouchPadVisible(emu) {
    const fe = emu && emu.frontend;
    if (!fe || typeof fe.showVirtualGamepad !== 'function' || emu._heymingPadGuard) return false;
    const wanted = function () {
      if (typeof emu.getSettingValue !== 'function') return false;
      return emu.getSettingValue('virtual-gamepad') !== 'disabled';
    };
    if (!wanted()) return false;
    emu._heymingPadGuard = true;
    let ticks = 0;
    const timer = window.setInterval(function () {
      ticks += 1;
      if (ticks > 25 || !wanted()) {
        window.clearInterval(timer);
        return;
      }
      const pad = fe.virtualGamepad;
      if (pad && pad.style.display === 'none') fe.showVirtualGamepad();
    }, 100);
    return true;
  }

  /**
   * On-screen PSP pad. Indexes match EmulatorJS's own PSP control scheme:
   * 0 cross, 8 circle, 1 square, 9 triangle, 16–19 the analog stick.
   * @returns {object[]}
   */
  function pspTouchControls() {
    return [
      {
        type: 'button',
        text: '△',
        id: 'triangle',
        location: 'right',
        left: 40,
        top: 0,
        bold: true,
        input_value: 9
      },
      {
        type: 'button',
        text: '○',
        id: 'circle',
        location: 'right',
        left: 81,
        top: 40,
        bold: true,
        input_value: 8
      },
      {
        type: 'button',
        text: '×',
        id: 'cross',
        location: 'right',
        left: 40,
        top: 80,
        bold: true,
        input_value: 0
      },
      {
        type: 'button',
        text: '□',
        id: 'square',
        location: 'right',
        left: 0,
        top: 40,
        bold: true,
        input_value: 1
      },
      {
        type: 'zone',
        id: 'stick',
        location: 'left',
        left: '50%',
        top: '100%',
        joystickInput: true,
        inputValues: [16, 17, 18, 19]
      },
      {
        type: 'dpad',
        id: 'dpad',
        location: 'left',
        left: '50%',
        top: '0%',
        joystickInput: false,
        inputValues: [4, 5, 6, 7]
      },
      {
        type: 'button',
        text: 'L',
        id: 'l',
        location: 'left',
        left: 3,
        top: -90,
        bold: true,
        block: true,
        input_value: 10
      },
      {
        type: 'button',
        text: 'R',
        id: 'r',
        location: 'right',
        right: 3,
        top: -90,
        bold: true,
        block: true,
        input_value: 11
      },
      {
        type: 'button',
        text: 'Select',
        id: 'select',
        location: 'center',
        left: -5,
        fontSize: 15,
        block: true,
        input_value: 2
      },
      {
        type: 'button',
        text: 'Start',
        id: 'start',
        location: 'center',
        left: 60,
        fontSize: 15,
        block: true,
        input_value: 3
      }
    ];
  }

  /**
   * Six face buttons in EmulatorJS's 130×130 right cluster. The stock
   * layout puts A/X at right:145, past the left edge, and the player
   * clips them. These sit in two rows of three. emulator.css draws the
   * face buttons at 40px, so right + 40 stays inside the cluster.
   * Saturn's X/Y indexes differ from Genesis, and it has L/R instead of Mode.
   * @param {string} core
   * @returns {object[]}
   */
  function segaTouchControls(core) {
    const saturn = core === 'segaSaturn';
    const pad = [
      {
        type: 'button',
        text: 'X',
        id: 'x',
        location: 'right',
        right: 88,
        top: 0,
        bold: true,
        fontSize: 16,
        input_value: saturn ? 9 : 10
      },
      {
        type: 'button',
        text: 'Y',
        id: 'y',
        location: 'right',
        right: 45,
        top: 0,
        bold: true,
        fontSize: 16,
        input_value: saturn ? 10 : 9
      },
      {
        type: 'button',
        text: 'Z',
        id: 'z',
        location: 'right',
        right: 2,
        top: 0,
        bold: true,
        fontSize: 16,
        input_value: 11
      },
      {
        type: 'button',
        text: 'A',
        id: 'a',
        location: 'right',
        right: 88,
        top: 45,
        bold: true,
        fontSize: 16,
        input_value: 1
      },
      {
        type: 'button',
        text: 'B',
        id: 'b',
        location: 'right',
        right: 45,
        top: 45,
        bold: true,
        fontSize: 16,
        input_value: 0
      },
      {
        type: 'button',
        text: 'C',
        id: 'c',
        location: 'right',
        right: 2,
        top: 45,
        bold: true,
        fontSize: 16,
        input_value: 8
      },
      {
        type: 'dpad',
        id: 'dpad',
        location: 'left',
        left: '50%',
        right: '50%',
        joystickInput: false,
        inputValues: [4, 5, 6, 7]
      },
      {
        type: 'button',
        text: 'Start',
        id: 'start',
        location: 'center',
        left: saturn ? 30 : 60,
        fontSize: 15,
        block: true,
        input_value: 3
      },
      {
        type: 'button',
        text: 'Fast',
        id: 'speed_fast',
        location: 'center',
        left: -35,
        top: 50,
        fontSize: 15,
        block: true,
        input_value: 27
      },
      {
        type: 'button',
        text: 'Slow',
        id: 'speed_slow',
        location: 'center',
        left: 95,
        top: 50,
        fontSize: 15,
        block: true,
        input_value: 29
      }
    ];
    if (saturn) {
      pad.push(
        {
          type: 'button',
          text: 'L',
          id: 'l',
          location: 'left',
          left: 3,
          top: -90,
          bold: true,
          block: true,
          input_value: 12
        },
        {
          type: 'button',
          text: 'R',
          id: 'r',
          location: 'right',
          right: 3,
          top: -90,
          bold: true,
          block: true,
          input_value: 13
        }
      );
    } else {
      pad.push({
        type: 'button',
        text: 'Mode',
        id: 'mode',
        location: 'center',
        left: -5,
        fontSize: 15,
        block: true,
        input_value: 2
      });
    }
    return pad;
  }

  /**
   * Replay a finger or pen as the touch events the on-screen PSP pad listens
   * for. Chrome already emits both, so a real touch event suppresses this.
   * @param {Document} [doc]
   * @returns {boolean}
   */
  function installPspTouch(doc) {
    const root = doc || document;
    const game = root.getElementById('game');
    const view = root.defaultView || window;
    if (!game || game.dataset.pspTouch === 'on') return false;
    game.dataset.pspTouch = 'on';
    game.style.touchAction = 'none';

    const synthetic = new WeakSet();
    let nativeTouch = false;
    const active = new Set();

    // Desktop Firefox has no TouchEvent. The pad only reads targetTouches
    // and the event type, so a plain Event with those fields is enough.
    function touchPoint(ev) {
      const point = {
        identifier: ev.pointerId,
        target: ev.target,
        clientX: ev.clientX,
        clientY: ev.clientY,
        screenX: ev.screenX,
        screenY: ev.screenY,
        pageX: ev.pageX,
        pageY: ev.pageY
      };
      if (typeof view.Touch !== 'function') return point;
      try {
        return new view.Touch(point);
      } catch (err) {
        return point;
      }
    }

    function dispatchTouch(type, ev) {
      const ended = type === 'touchend' || type === 'touchcancel';
      const touches = ended ? [] : [touchPoint(ev)];
      const changed = [touchPoint(ev)];
      let te;
      if (typeof view.TouchEvent === 'function') {
        try {
          te = new view.TouchEvent(type, {
            bubbles: true,
            cancelable: true,
            touches: touches,
            targetTouches: touches,
            changedTouches: changed
          });
        } catch (err) {
          te = null;
        }
      }
      if (!te) {
        te = new view.Event(type, { bubbles: true, cancelable: true });
        te.touches = touches;
        te.targetTouches = touches;
        te.changedTouches = changed;
      }
      synthetic.add(te);
      ev.target.dispatchEvent(te);
    }

    function noteNative(ev) {
      if (synthetic.has(ev)) return;
      nativeTouch = ev.type !== 'touchend' && ev.type !== 'touchcancel';
    }

    function begin(ev) {
      if (nativeTouch) return;
      if (ev.pointerType !== 'touch' && ev.pointerType !== 'pen') return;
      active.add(ev.pointerId);
      if (ev.cancelable) ev.preventDefault();
      dispatchTouch('touchstart', ev);
    }

    function move(ev) {
      if (!active.has(ev.pointerId)) return;
      if (ev.cancelable) ev.preventDefault();
      dispatchTouch('touchmove', ev);
    }

    function end(ev) {
      if (!active.has(ev.pointerId)) return;
      active.delete(ev.pointerId);
      if (ev.cancelable) ev.preventDefault();
      dispatchTouch(ev.type === 'pointercancel' ? 'touchcancel' : 'touchend', ev);
    }

    game.addEventListener('touchstart', noteNative, true);
    game.addEventListener('touchmove', noteNative, true);
    game.addEventListener('touchend', noteNative, true);
    game.addEventListener('touchcancel', noteNative, true);
    game.addEventListener('pointerdown', begin, { capture: true, passive: false });
    game.addEventListener('pointermove', move, { capture: true, passive: false });
    game.addEventListener('pointerup', end, { capture: true, passive: false });
    game.addEventListener('pointercancel', end, { capture: true, passive: false });
    return true;
  }

  // Full stick deflection after this many pixels of drag.
  const PSP_DRAG_RADIUS = 90;
  // Less movement than this on release is a tap, not a drag.
  const PSP_TAP_SLOP = 12;
  const PSP_TAP_MS = 500;
  // Input indexes in EmulatorJS's PSP scheme: left stick right, left, down, up; Cross.
  const PSP_STICK = { right: 16, left: 17, down: 18, up: 19 };
  const PSP_CROSS = 0;
  const STICK_MAX = 0x7fff;

  /**
   * PPSSPP's libretro core reads only the joypad and sticks, never a
   * pointer, so a finger on the game screen goes nowhere. Games built around
   * dragging (Angry Birds' slingshot) read the stick instead. Turn a drag on
   * the screen into stick deflection from where the finger landed, and a
   * quick tap into Cross.
   * @param {Document} [doc]
   * @returns {boolean}
   */
  function installPspDragAim(doc) {
    const root = doc || document;
    const game = root.getElementById('game');
    const view = root.defaultView || window;
    if (!game || game.dataset.pspDrag === 'on') return false;
    game.dataset.pspDrag = 'on';
    game.style.touchAction = 'none';

    let activeId = null;
    let startX = 0;
    let startY = 0;
    let startedAt = 0;
    let travelled = 0;

    function manager() {
      const emu = view.EJS_emulator;
      return emu && emu.gameManager && typeof emu.gameManager.simulateInput === 'function'
        ? emu.gameManager
        : null;
    }

    function send(index, value) {
      const gm = manager();
      if (gm) gm.simulateInput(0, index, value);
    }

    // The game canvas, or the wrapper under it once EmulatorJS turns the
    // canvas pointer-events: none for its on-screen pad. Buttons, the pad,
    // and the menu bar are inside #game too and must keep their own taps.
    function onSurface(ev) {
      const target = ev.target;
      if (!target || !target.classList) return false;
      if (target === game || target.tagName === 'CANVAS') return true;
      return target.classList.contains('ejs_canvas_parent');
    }

    function aim(ev) {
      const dx = (ev.clientX - startX) / PSP_DRAG_RADIUS;
      const dy = (ev.clientY - startY) / PSP_DRAG_RADIUS;
      const x = Math.max(-1, Math.min(1, dx));
      const y = Math.max(-1, Math.min(1, dy));
      send(PSP_STICK.right, x > 0 ? Math.round(STICK_MAX * x) : 0);
      send(PSP_STICK.left, x < 0 ? Math.round(STICK_MAX * -x) : 0);
      send(PSP_STICK.down, y > 0 ? Math.round(STICK_MAX * y) : 0);
      send(PSP_STICK.up, y < 0 ? Math.round(STICK_MAX * -y) : 0);
      travelled = Math.max(travelled, Math.hypot(ev.clientX - startX, ev.clientY - startY));
    }

    function release() {
      send(PSP_STICK.right, 0);
      send(PSP_STICK.left, 0);
      send(PSP_STICK.down, 0);
      send(PSP_STICK.up, 0);
    }

    function begin(ev) {
      if (activeId !== null || !onSurface(ev)) return;
      if (ev.pointerType === 'mouse' && ev.button !== 0) return;
      activeId = ev.pointerId;
      startX = ev.clientX;
      startY = ev.clientY;
      startedAt = Date.now();
      travelled = 0;
      if (ev.cancelable) ev.preventDefault();
      const cap = ev.target;
      if (cap && typeof cap.setPointerCapture === 'function') {
        try {
          cap.setPointerCapture(ev.pointerId);
        } catch (err) {
          // Moves still arrive on #game when capture is refused.
        }
      }
    }

    function move(ev) {
      if (ev.pointerId !== activeId) return;
      if (ev.cancelable) ev.preventDefault();
      aim(ev);
    }

    function end(ev) {
      if (ev.pointerId !== activeId) return;
      activeId = null;
      if (ev.cancelable) ev.preventDefault();
      release();
      const quick = Date.now() - startedAt <= PSP_TAP_MS;
      if (ev.type === 'pointerup' && quick && travelled < PSP_TAP_SLOP) {
        send(PSP_CROSS, 1);
        view.setTimeout(() => send(PSP_CROSS, 0), 80);
      }
    }

    game.addEventListener('pointerdown', begin, { capture: true, passive: false });
    game.addEventListener('pointermove', move, { capture: true, passive: false });
    game.addEventListener('pointerup', end, { capture: true, passive: false });
    game.addEventListener('pointercancel', end, { capture: true, passive: false });
    return true;
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
    prefersLightVideo,
    applyVideoDefaults,
    flycastCoreUrl,
    packGamepadSlots,
    keepSavesInBrowser,
    keepTouchPadVisible,
    patchLegacyGetState,
    persistQuickStates,
    saveQuickState,
    loadQuickState,
    onSaveHotkey,
    installNdsStylus,
    installPspTouch,
    installPspDragAim,
    pspTouchControls
  };
})();

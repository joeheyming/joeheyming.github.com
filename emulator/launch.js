// Boot orchestrator for the unified /emulator/ shell.
//
// Reads `/emulator/<console>/` (or legacy `?console=`) and either:
//   - specializes the static boot card (brand, file-accept, controls
//     help, identity accent CSS variables) for that console, OR
//   - swaps the static boot card out for a console picker so the
//     visitor can choose between NES / Sega / Game Boy / ...
//
// Also defines `window.launchEmulator(romSource, romName, opts)` which the
// local-file picker and the ROM browser both call. Mounting (EJS_* globals,
// loader.js, SOCD) lives in emulator/ejs-mount.js; BIOS in emulator/bios.js;
// IA File helpers in emulator/rom-acquire.js. This file keeps chrome,
// analytics, achievements, and boot-card orchestration.
//
// Lean-back (TV / console): hides the file picker, supports `?rom=<name>`
// deep links, and wires D-pad focus via emulatorLeanback.applyRovingTabindex.
//
// Without cross-origin isolation there is no SharedArrayBuffer, so EmulatorJS
// boots its normal single-thread cores with EJS_threads pinned off. Missing
// WebAssembly itself is fatal.
(function () {
  'use strict';

  const SHELL_LOADED_AT = Date.now();
  let runtimeBlocked = false;
  /** True when we booted a core without cross-origin isolation (no threads). */
  let singleThreadMode = false;
  let pickerRoving = null;

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  function leanback() {
    return window.emulatorLeanback || null;
  }

  function isTv() {
    return !!(leanback() && leanback().isTv);
  }

  function bios() {
    return window.emulatorBios || null;
  }

  function romAcquire() {
    return window.emulatorRomAcquire || null;
  }

  function escapeHtml(s) {
    return String(s).replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  function hexToRgba(hex, alpha) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!m) return hex;
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 0xff}, ${(n >> 8) & 0xff}, ${n & 0xff}, ${alpha})`;
  }

  /** Mix hex toward white so console identity colors clear AA on dark surfaces. */
  function mixHexWithWhite(hex, amount) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!m) return hex;
    const n = parseInt(m[1], 16);
    const mix = (c) => Math.round(c + (255 - c) * amount);
    const r = mix((n >> 16) & 0xff);
    const g = mix((n >> 8) & 0xff);
    const b = mix(n & 0xff);
    return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
  }

  function isDarkTheme() {
    const explicit = document.documentElement.getAttribute('data-theme');
    if (explicit === 'dark') return true;
    if (explicit === 'light') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  const DEFAULT_DOCUMENT_TITLE = 'Retro Game Emulator — Play Console Games in Browser';

  /** Keep the tab title in sync with the active console (picker vs lander). */
  function setDocumentTitle(cfg) {
    if (!cfg) {
      document.title = DEFAULT_DOCUMENT_TITLE;
      return;
    }
    // App Name — Descriptive Phrase [emoji] (page-title-standards).
    document.title = `${cfg.title} Emulator — ${cfg.subtitle} ${cfg.emoji}`;
  }

  function applyConsoleIdentity(cfg) {
    // Identity tokens live on :root so brand.css cascades pick them up
    // and the rom-browser shadow DOM inherits them automatically. One
    // source of truth per console — no per-page CSS overrides.
    //
    // Dark mode: brand.css lifts --accent-primary for AA on dark cards;
    // console accents (PS1 navy, SNES deep purple) need the same treatment
    // or buttons/status text fail contrast.
    const root = document.documentElement;
    const dark = isDarkTheme();
    const bright = dark ? mixHexWithWhite(cfg.accentHex, 0.38) : cfg.accentHex;
    const goldBase = cfg.accentGoldHex || cfg.accentHex;
    const gold = dark ? mixHexWithWhite(goldBase, 0.5) : goldBase;
    root.style.setProperty('--accent-bright', bright);
    root.style.setProperty('--accent-bright-soft', hexToRgba(bright, dark ? 0.16 : 0.08));
    root.style.setProperty('--accent-bright-ring', hexToRgba(bright, dark ? 0.35 : 0.25));
    root.style.setProperty('--accent-gold', gold);
    root.setAttribute('data-emulator-console', cfg.id);
    setDocumentTitle(cfg);
  }

  let identityCfg = null;

  function watchThemeForIdentity() {
    if (watchThemeForIdentity._wired) return;
    watchThemeForIdentity._wired = true;
    const reapply = () => {
      if (identityCfg) applyConsoleIdentity(identityCfg);
    };
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', reapply);
    new MutationObserver(reapply).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    });
  }

  function hasGamepadApi() {
    return typeof navigator.getGamepads === 'function';
  }

  function gamepadBannerHtml() {
    const lb = leanback();
    const show = isTv() || (lb && lb.hasGamepad);
    if (!show) return '';
    const connected = lb && lb.hasGamepad;
    const msg = !hasGamepadApi()
      ? 'Use the D-pad to navigate'
      : connected
      ? 'Controller connected — use D-pad to pick a game'
      : 'Connect a controller, or use the remote D-pad to navigate';
    return `<p class="leanback-banner" id="leanbackBanner" data-connected="${
      connected ? '1' : '0'
    }">${escapeHtml(msg)}</p>`;
  }

  function refreshGamepadBanner() {
    const el = document.getElementById('leanbackBanner');
    const lb = leanback();
    if (!el || !lb) return;
    const connected = lb.hasGamepad;
    el.dataset.connected = connected ? '1' : '0';
    el.textContent = !hasGamepadApi()
      ? 'Use the D-pad to navigate'
      : connected
      ? 'Controller connected — use D-pad to pick a game'
      : 'Connect a controller, or use the remote D-pad to navigate';
  }

  function wasmSupported() {
    if (typeof WebAssembly !== 'object' || typeof WebAssembly.Module !== 'function') return false;
    try {
      // Empty valid WASM module: namespace presence alone is not proof that
      // this embedded engine permits compilation.
      new WebAssembly.Module(new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]));
      return true;
    } catch (_) {
      return false;
    }
  }

  /** @param {object|null} cfg */
  function canRunWithoutCoi(cfg) {
    // Picker page: nothing to emulate yet, always let it render.
    if (!cfg) return true;
    // EmulatorJS defaults EJS_threads to false. COI improves performance by
    // making threaded builds available; it is not required by the cores in
    // this registry. A browser without WebAssembly cannot run any of them.
    return wasmSupported();
  }

  function renderRuntimeUnavailable() {
    const bootCard = document.getElementById('boot-card');
    if (!bootCard) return;
    bootCard.innerHTML = `
      <h2>Emulator unavailable</h2>
      <p class="coi-fail-copy">
        This browser has no WebAssembly support, so no emulator core can run here.
      </p>
      <p class="picker-help">
        Desktop Chrome, Edge, Firefox, and Safari support every console here.
      </p>
    `;
  }

  /** Boot-card banner for single-thread mode; expectation-setting, not an error. */
  function singleThreadNoticeHtml() {
    if (!singleThreadMode) return '';
    return `<p class="leanback-banner" data-connected="0">
        Single-thread mode — this browser has no SharedArrayBuffer, so frame
        rates may dip. Save states still work.
      </p>`;
  }

  function wireTvFocus(bootCard) {
    const lb = leanback();
    if (!lb || !isTv()) return;

    if (pickerRoving) {
      pickerRoving.dispose();
      pickerRoving = null;
    }

    const grid = bootCard.querySelector('.picker-grid');
    if (grid) {
      // Include showcase tiles outside the console grid (e.g. Flash).
      const focusRoot = bootCard;
      pickerRoving = lb.applyRovingTabindex(focusRoot, {
        selector: '.picker-grid .picker-tile, .picker-extra .picker-tile'
      });
      pickerRoving.focusFirst();
      return;
    }

    // Console boot card: focus the IA browse button inside the shadow root.
    const romBrowser = bootCard.querySelector('rom-browser');
    const openBtn =
      romBrowser && romBrowser.shadowRoot && romBrowser.shadowRoot.getElementById('openBrowserBtn');
    if (openBtn) {
      openBtn.focus({ preventScroll: false });
    }
  }

  function renderEmuBreadcrumbs(cfg) {
    const nav = document.getElementById('emu-breadcrumbs');
    const header = document.getElementById('emu-header');
    if (!nav || typeof window.renderBreadcrumbs !== 'function') return;

    if (header) header.classList.remove('is-playing');

    // Lean-back / TV: D-pad focuses the picker; hide the trail so it
    // doesn't steal visual hierarchy (same idea as watch fullscreen).
    if (isTv()) {
      if (header) header.hidden = true;
      return;
    }
    if (header) header.hidden = false;

    if (!cfg) {
      window.renderBreadcrumbs(nav, [{ emoji: '🎮', label: 'Emulator' }]);
      return;
    }
    window.renderBreadcrumbs(nav, [
      { emoji: '🎮', label: 'Emulator', href: '/emulator/' },
      { emoji: cfg.emoji, label: cfg.title }
    ]);
  }

  function renderBootCard(cfg) {
    const brand = document.getElementById('brand');
    const bootCard = document.getElementById('boot-card');
    if (!brand || !bootCard) return;

    renderEmuBreadcrumbs(cfg);
    bootCard.classList.remove('boot-card-picker');

    brand.innerHTML = `
      <span class="brand-logo">${cfg.emoji}</span>
      <h1>
        ${cfg.title}
        <span class="sub">${cfg.subtitle}</span>
      </h1>
    `;

    const controlsRows = cfg.controls
      .map(
        (c) =>
          `<div class="key-row"><span>${escapeHtml(c.label)}</span><kbd>${escapeHtml(
            c.key
          )}</kbd></div>`
      )
      .join('');

    const tv = isTv();
    const biosPanelHtml =
      cfg.biosRequired && !tv
        ? `
        <div class="bios-panel" id="biosPanel">
          <p class="bios-status" id="biosStatus" data-ready="0"></p>
          <div class="bios-progress" id="biosProgress" hidden>
            <div class="bios-progress-track" aria-hidden="true">
              <div class="bios-progress-bar" id="biosProgressBar"></div>
            </div>
            <p class="bios-progress-label" id="biosProgressLabel"></p>
          </div>
          <div class="bios-actions">
            <button class="btn btn-secondary" id="loadBiosBtn" type="button">
              <span>🧬</span>
              <span>Load BIOS (${escapeHtml(cfg.biosFileName || 'bios.bin')})</span>
            </button>
            <button class="btn-text" id="clearBiosBtn" type="button" hidden>Clear BIOS</button>
          </div>
          <p class="bios-help">${escapeHtml(cfg.biosHelp || '')}</p>
        </div>`
        : '';

    const tvNoCollectionHtml =
      tv && !cfg.iaBaseUrl
        ? `<p class="picker-help">
            This console has no built-in collection yet. Open it on a desktop browser
            to load a local BIOS + ROM.
          </p>`
        : '';

    const howtoHtml =
      cfg.howto && cfg.howto.length
        ? `<details class="howto">
        <summary>How to play</summary>
        <ol>${cfg.howto.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ol>
      </details>`
        : '';

    const romHelpHtml = cfg.romHelp ? `<p class="rom-help">${escapeHtml(cfg.romHelp)}</p>` : '';

    const controlsSummary = tv ? 'Controls' : 'Keyboard Controls';
    const gamepadHint =
      tv || cfg.id === 'ps1' || cfg.id === 'n64' || cfg.id === 'segacd'
        ? hasGamepadApi()
          ? `<p class="controls-gamepad-hint">A gamepad works best if you have one plugged in.</p>`
          : `<p class="controls-gamepad-hint">Use the keyboard or on-screen controls; this browser does not support gamepads.</p>`
        : '';

    const isDisc = !!cfg.iaExternalDownload;
    const loadLabel = isDisc
      ? `Load Local Disc Image (${escapeHtml(cfg.fileExtsLabel)})`
      : `Load Local ROM File (${escapeHtml(cfg.fileExtsLabel)})`;

    const hasIa = !!cfg.iaBaseUrl;
    const filePickerHtml = tv
      ? ''
      : `
        ${hasIa ? '<div class="divider">OR</div>' : ''}
        <button class="btn btn-secondary" id="loadRomBtn" type="button">
          <span>📁</span>
          <span>${loadLabel}</span>
        </button>`;

    bootCard.innerHTML = `
      <h2>🕹️ Load a ${isDisc ? 'disc' : 'ROM'} to play</h2>
      ${gamepadBannerHtml()}
      ${singleThreadNoticeHtml()}
      ${cfg.audioNote ? `<p class="audio-note" role="status">${escapeHtml(cfg.audioNote)}</p>` : ''}
      ${biosPanelHtml}
      <div class="btn-stack">
        <rom-browser console="${cfg.id}"></rom-browser>
        ${filePickerHtml}
      </div>
      ${howtoHtml}
      ${romHelpHtml}
      ${tvNoCollectionHtml}
      <details class="controls-info">
        <summary>${controlsSummary}</summary>
        ${gamepadHint}
        <div class="controls-grid">${controlsRows}</div>
      </details>
    `;

    const romInput = document.getElementById('romFileInput');
    if (romInput) romInput.setAttribute('accept', cfg.fileAccept);

    const loadBtn = document.getElementById('loadRomBtn');
    if (loadBtn && romInput) {
      loadBtn.addEventListener('click', () => romInput.click());
    }

    bios()?.wireBiosControls(cfg);
    wireTvFocus(bootCard);
  }

  function sendEmuKey(code, key, keyCode) {
    const opts = {
      key,
      code,
      keyCode,
      which: keyCode,
      bubbles: true,
      cancelable: true
    };
    const targets = [window, document, document.getElementById('game')].filter(Boolean);
    const iframe = document.querySelector('#game iframe');
    if (iframe && iframe.contentWindow) targets.push(iframe.contentWindow);
    ['keydown', 'keyup'].forEach((type) => {
      targets.forEach((target) => {
        try {
          target.dispatchEvent(new KeyboardEvent(type, opts));
        } catch {
          /* cross-origin iframe */
        }
      });
    });
  }

  async function unlockGameAudio() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) {
      try {
        const ctx = new Ctx();
        if (ctx.state === 'suspended') await ctx.resume();
      } catch {
        /* ignore */
      }
    }
    document.querySelectorAll('audio, video').forEach((el) => {
      el.muted = false;
      const play = el.play && el.play();
      if (play && typeof play.catch === 'function') play.catch(() => {});
    });
    const btn = document.getElementById('emu-sound-btn');
    if (btn) btn.textContent = 'Sound on — click the game if still silent';
  }

  function returnToGameList() {
    const url = new URL(window.location.href);
    url.searchParams.delete('rom');
    url.hash = '';
    window.location.assign(`${url.pathname}${url.search}`);
  }

  function mountPlayChrome(cfg) {
    let bar = document.getElementById('emu-play-chrome');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'emu-play-chrome';
      document.body.appendChild(bar);
    }
    const bits = [
      '<button type="button" class="emu-chrome-btn" id="emu-game-list-btn">Back to game list</button>'
    ];
    if (cfg.audioUnlock || cfg.audioNote) {
      bits.push(
        '<button type="button" class="emu-chrome-btn" id="emu-sound-btn">Sound off — click to enable</button>'
      );
    }
    if (cfg.showSaveStates) {
      bits.push(
        '<button type="button" class="emu-chrome-btn" id="emu-save-btn">Save (F5)</button>'
      );
      bits.push(
        '<button type="button" class="emu-chrome-btn" id="emu-load-btn">Load (F9)</button>'
      );
      bits.push(
        '<span class="emu-chrome-note">Quick save — not the in-game memory card menu.</span>'
      );
    }
    bar.innerHTML = bits.join('');
    bar.hidden = bits.length === 0;

    document.getElementById('emu-game-list-btn')?.addEventListener('click', returnToGameList);
    document.getElementById('emu-sound-btn')?.addEventListener('click', unlockGameAudio);
    document
      .getElementById('emu-save-btn')
      ?.addEventListener('click', () => sendEmuKey('F5', 'F5', 116));
    document
      .getElementById('emu-load-btn')
      ?.addEventListener('click', () => sendEmuKey('F9', 'F9', 120));
    document.getElementById('game-container')?.addEventListener(
      'pointerdown',
      () => {
        if (cfg.audioUnlock || cfg.audioNote) unlockGameAudio();
      },
      { once: true }
    );
  }

  function renderPicker() {
    const brand = document.getElementById('brand');
    const bootCard = document.getElementById('boot-card');
    if (!brand || !bootCard) return;

    setDocumentTitle(null);
    renderEmuBreadcrumbs(null);
    bootCard.classList.add('boot-card-picker');

    brand.innerHTML = `
      <span class="brand-logo">🎮</span>
      <h1>
        Retro Game Emulator
        <span class="sub">NES · Sega · Game Gear · 32X · Sega CD · SNES · Game Boy · GBA · Neo Geo · N64 · PS1</span>
      </h1>
    `;

    const pathFor = window.emulatorConsolePath || ((id) => `/emulator/${encodeURIComponent(id)}/`);
    const tiles = Object.values(window.EMULATOR_CONSOLES || {})
      .map((cfg) => {
        return `
          <a class="picker-tile" href="${pathFor(cfg.id)}" data-console="${cfg.id}">
            <span class="picker-emoji">${cfg.emoji}</span>
            <span class="picker-title">${escapeHtml(cfg.title)}</span>
            <span class="picker-sub">${escapeHtml(cfg.subtitle)}</span>
          </a>
        `;
      })
      .join('');

    bootCard.innerHTML = `
      <h2>🕹️ Pick a console</h2>
      ${gamepadBannerHtml()}
      <div class="picker-grid">${tiles}</div>
      <div class="picker-extra">
        <h3 class="picker-extra-heading">Also try</h3>
        <a class="picker-tile picker-tile-flash" href="/flash/" data-extra="flash">
          <span class="picker-emoji">⚡</span>
          <span class="picker-title">Flash Player</span>
          <span class="picker-sub">Classic .swf games via Ruffle · Archive collection</span>
        </a>
      </div>
      <p class="picker-help">
        Free, browser-based emulators. No install, no ads. Bring your own ROM
        or browse the built-in public-domain collection. Flash games live on a
        separate Ruffle player.
      </p>
    `;

    wireTvFocus(bootCard);
  }

  /**
   * Deep link: /emulator/nes/?rom=<IA rom.name> (legacy: ?console=nes&rom=…)
   * @param {object} cfg
   * @param {string} romQuery
   */
  async function tryDeeplinkRom(cfg, romQuery) {
    const bootCard = document.getElementById('boot-card');
    const wanted = romQuery.trim();
    if (!wanted || !bootCard) return false;
    const controller = new AbortController();
    const acquire = romAcquire();

    bootCard.innerHTML = `
      <h2>Loading ROM</h2>
      <p class="picker-help">Loading ${escapeHtml(wanted)}…</p>
      <button type="button" class="btn btn-secondary" id="cancelDeeplinkBtn">
        Cancel — back to game list
      </button>
    `;
    document.getElementById('cancelDeeplinkBtn')?.addEventListener('click', () => {
      controller.abort();
      returnToGameList();
    });

    try {
      const ia = acquire && acquire.createIaClient(cfg);
      if (!ia) throw new Error('ROM browser is not configured for this console.');

      const roms = await ia.fetchRomList();
      if (controller.signal.aborted) return false;
      const rom = acquire.findRomByQuery(roms, wanted);
      if (!rom) throw new Error(`ROM not found: ${wanted}`);

      const romData = await ia.loadRom(rom, { signal: controller.signal });
      if (controller.signal.aborted) return false;
      const romFile = acquire.fileFromRomBytes(romData, rom);
      window.launchEmulator(romFile, romFile.name, { deeplink: true });
      return true;
    } catch (err) {
      if (controller.signal.aborted || (err && err.name === 'AbortError')) return false;
      console.error('Deep-link ROM load failed:', err);
      renderBootCard(cfg);
      const boot = document.getElementById('boot-card');
      if (boot) {
        const note = document.createElement('p');
        note.className = 'deeplink-error';
        note.textContent =
          'Could not load “' + wanted + '”. Pick a ROM from the collection instead.';
        boot.insertBefore(note, boot.firstChild.nextSibling);
      }
      return false;
    }
  }

  function markRuntimeUnavailable() {
    if (runtimeBlocked) return;
    runtimeBlocked = true;
    renderRuntimeUnavailable();
    if (window.trackEvent) {
      const ua = (navigator.userAgent || '').slice(0, 80);
      window.trackEvent('emulator_wasm_unavailable', 'Emulator', ua, 0);
    }
  }

  ready(() => {
    window.addEventListener('emulator-gamepad-change', refreshGamepadBanner);

    // Hub + ?console=nes → /emulator/nes/ (keeps rom=/tv=/hash).
    if (window.canonicalizeEmulatorConsoleUrl && window.canonicalizeEmulatorConsoleUrl()) {
      return;
    }

    const cfg = window.getEmulatorConsole && window.getEmulatorConsole();
    const params = new URLSearchParams(window.location.search);
    const romQuery = params.get('rom');
    let booted = false;

    const bootUi = () => {
      if (booted || runtimeBlocked) return;
      booted = true;
      if (cfg) {
        identityCfg = cfg;
        applyConsoleIdentity(cfg);
        watchThemeForIdentity();
        if (romQuery) {
          tryDeeplinkRom(cfg, romQuery);
        } else {
          renderBootCard(cfg);
        }
      } else {
        renderPicker();
      }
    };

    const lb = leanback();
    const settle =
      lb && lb.whenCoiSettled ? lb.whenCoiSettled() : Promise.resolve(!!window.crossOriginIsolated);

    // WebAssembly support and cross-origin isolation are independent. Check
    // the former even when the page is already isolated.
    if (cfg && !wasmSupported()) {
      markRuntimeUnavailable();
    } else if (window.crossOriginIsolated) {
      bootUi();
    } else {
      const bootCard = document.getElementById('boot-card');
      if (bootCard) {
        bootCard.innerHTML =
          '<h2>Starting…</h2><p class="picker-help">Preparing the emulator runtime.</p>';
      }
    }

    settle.then((ok) => {
      if (!ok && cfg) {
        if (!canRunWithoutCoi(cfg)) {
          markRuntimeUnavailable();
          return;
        }
        // Playable single-threaded: boot anyway and say so on the card.
        singleThreadMode = true;
        if (window.trackEvent) {
          window.trackEvent('emulator_single_thread', 'Emulator', cfg.id, 0);
        }
      }
      bootUi();
    });

    const romInput = document.getElementById('romFileInput');
    if (romInput) {
      romInput.addEventListener('change', function () {
        const file = this.files && this.files[0];
        if (!file) return;
        window.launchEmulator(file, file.name);
      });
    }
  });

  // Public entry point: handed a File (preferred — keeps the filename
  // intact for the libretro zip sniffer) or an object URL string.
  // Thin wrapper: BIOS gate + chrome/analytics/achievements, then
  // emulatorEjsMount.mount for EJS_* + loader + SOCD.
  //
  // opts.deeplink — prefix the GA label with `deeplink:` for deep-link loads.
  window.launchEmulator = async function launchEmulator(romSource, romName, opts) {
    opts = opts || {};
    const cfg = window.getEmulatorConsole && window.getEmulatorConsole();
    if (!cfg) {
      console.error('launchEmulator: no active console; bailing.');
      return;
    }

    if (!wasmSupported()) {
      markRuntimeUnavailable();
      return;
    }
    if (!window.crossOriginIsolated) {
      singleThreadMode = true;
    }

    const biosApi = bios();
    if (cfg.biosRequired) {
      const ok = biosApi ? await biosApi.ensureActiveBios(cfg) : false;
      if (!ok || !biosApi?.getActiveFile()) {
        renderBootCard(cfg);
        biosApi?.statusBiosError(`Load ${cfg.biosFileName || 'bios.bin'} before starting a game.`);
        return;
      }
    }

    const bootEl = document.getElementById('boot');
    const gameContainer = document.getElementById('game-container');
    const emuHeader = document.getElementById('emu-header');
    if (bootEl) bootEl.classList.add('hidden');
    if (gameContainer) gameContainer.classList.add('visible');
    if (emuHeader) emuHeader.classList.add('is-playing');

    if (window.trackEvent) {
      const gameName =
        romName || (romSource && typeof romSource === 'object' && romSource.name) || 'unknown';
      const raw = gameName.toString().slice(0, 80);
      const labelBase = opts.deeplink ? `deeplink:${raw}` : raw;
      const timeOnPage = Math.round((Date.now() - SHELL_LOADED_AT) / 1000);
      window.trackEvent(`${cfg.id}_rom_loaded`, 'Emulator', labelBase, timeOnPage);
    }

    // Unlock once per console lander app id (derived from the registry).
    if (Object.keys(window.EMULATOR_CONSOLES || {}).includes(cfg.id)) {
      window.heymingAchievements?.unlockForCurrentApp('first-action');
    }

    mountPlayChrome(cfg);

    const mountApi = window.emulatorEjsMount;
    if (!mountApi || typeof mountApi.mount !== 'function') {
      console.error(
        'launchEmulator: emulatorEjsMount missing; load ejs-mount.js before launch.js.'
      );
      return;
    }
    mountApi.mount({
      cfg,
      romSource,
      romName,
      biosFile: biosApi ? biosApi.getActiveFile() : null,
      onExit: returnToGameList
    });
  };
})();

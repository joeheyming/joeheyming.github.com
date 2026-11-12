// Boot orchestrator for the unified /emulator/ shell.
//
// Reads `/emulator/<console>/` (or legacy `?console=`) and either:
//   - specializes the static boot card (brand, file-accept, controls
//     help, identity accent CSS variables) for that console, OR
//   - swaps the static boot card out for a console picker so the
//     visitor can choose between NES / Sega / Game Boy / ...
//
// Also defines `window.launchEmulator(romSource, romName)`. The local-file
// picker calls it, and so does a tile click and a `?rom=` deep link after
// the Archive bytes are wrapped in a File. A tile writes `?rom=<name>` with
// pushHistorySilent so Back returns to the list without a second page view.
// Sega CD and Saturn deep links stay on the download handoff. Once a game is
// chosen, launchEmulator loads the play path (emulator/play.js: play chrome,
// achievements, Ruffle or emulator/ejs-mount.js) and hands it the ROM. BIOS
// lives in emulator/bios.js. This file keeps boot-card orchestration.
//
// Lean-back (TV / console): hides the file picker, starts `?rom=<name>`
// in the page when that console streams, and wires D-pad focus via
// emulatorLeanback.applyRovingTabindex.
//
// Without cross-origin isolation there is no SharedArrayBuffer, so EmulatorJS
// boots its normal single-thread cores with EJS_threads pinned off. Missing
// WebAssembly itself is fatal.
(function () {
  'use strict';

  window.heymingAnalytics?.enable('play-counts');

  let runtimeBlocked = false;
  /** True when we booted a core without cross-origin isolation (no threads). */
  let singleThreadMode = false;
  let pickerRoving = null;

  // Pages list only what their first screen renders. The game list (a
  // console page) and the play path load here, in this order, when needed.
  const LISTING_SCRIPTS = [
    '/emulator/internet-archive.js',
    '/emulator/rom-acquire.js',
    '/emulator/games-sheet.js',
    '/emulator/rom-browser.js',
    '/emulator/bios.js'
  ];
  const PLAY_SCRIPTS = ['/emulator/socd.js', '/emulator/ejs-mount.js', '/emulator/play.js'];
  const RUFFLE_PLAY_SCRIPTS = ['/emulator/play.js'];

  /** Flash runs in Ruffle, which the flash page loads itself; no EmulatorJS mount. */
  function playScripts(cfg) {
    return cfg.player === 'ruffle' ? RUFFLE_PLAY_SCRIPTS : PLAY_SCRIPTS;
  }

  function lazy() {
    return import('/shared/lazy.js');
  }

  function loadInOrder(srcs) {
    return lazy().then((l) => l.loadScriptsInOrder(srcs));
  }

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

  /**
   * Console landers already have their SEO title in <title>. Replacing it
   * made a later history page view look like a different screen. Restore
   * that base; a running game prepends its name instead.
   */
  function setDocumentTitle() {
    if (typeof window.prependBaseTitle === 'function') window.prependBaseTitle('');
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
    setDocumentTitle();
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

  // Keyboard, a remote, and a controller all move from the focused control.
  // The nav toggle does not count: it takes focus on load.
  function focusWhenIdle(el, force) {
    if (!el) return false;
    const remote = window.heymingRemote;
    if (remote && typeof remote.focusIfIdle === 'function') {
      return remote.focusIfIdle(el, !!force, true);
    }
    if (!force) {
      const active = document.activeElement;
      const idle =
        !active ||
        active === document.body ||
        active === document.documentElement ||
        (active.classList && active.classList.contains('heyming-nav-toggle'));
      if (!idle) return false;
    }
    try {
      el.focus({ preventScroll: true, focusVisible: true });
    } catch (err) {
      try {
        el.focus();
      } catch (err2) {
        return false;
      }
    }
    return document.activeElement === el;
  }

  function deepActive() {
    let active = document.activeElement;
    let guard = 0;
    while (active && active.shadowRoot && active.shadowRoot.activeElement && guard < 8) {
      active = active.shadowRoot.activeElement;
      guard += 1;
    }
    return active;
  }

  // wireTvFocus runs before any card exists, so it can only reach the
  // search toggle. Once the list paints, take that focus if the visitor
  // has not moved to another control.
  function focusFirstRomCardIfIdle(bootCard) {
    if (!isTv()) return;
    const browser = bootCard.querySelector('rom-browser');
    const root = browser && browser.shadowRoot;
    if (!root) return;
    const card = root.querySelector('.rom-card');
    if (!card) return;
    const active = deepActive();
    const toggle = root.getElementById('searchToggleBtn');
    const idle =
      !active ||
      active === document.body ||
      active === document.documentElement ||
      active === bootCard ||
      active === toggle ||
      (active.classList && active.classList.contains('heyming-nav-toggle'));
    if (!idle) return;
    try {
      card.focus({ preventScroll: false });
    } catch (err) {
      try {
        card.focus();
      } catch (err2) {
        return;
      }
    }
  }

  function wireTvFocus(bootCard) {
    const lb = leanback();
    if (lb && isTv()) {
      wireTvGrid(bootCard, lb);
      return;
    }

    // Desktop and a phone: land on the first console, or Load ROM while
    // the collection is still on its way. The game list takes over once
    // it paints, if focus is still on this placeholder.
    const start = bootCard.querySelector('.picker-grid .picker-tile, #loadRomBtn');
    if (!start) return;
    const previous = document.querySelector('[data-initial-focus]');
    if (previous && previous !== start) previous.removeAttribute('data-initial-focus');
    start.setAttribute('data-initial-focus', '');
    focusWhenIdle(start, false);
  }

  function wireTvGrid(bootCard, lb) {
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

    // Console boot card: focus a game card once the list is painted, or the
    // search toggle while the collection is still loading. The ready event
    // covers the usual case, where this runs before any card exists.
    const browser = bootCard.querySelector('rom-browser');
    if (browser) {
      browser.addEventListener('rom-list-ready', () => {
        focusFirstRomCardIfIdle(bootCard);
      });
    }
    const romRoot = browser?.shadowRoot;
    const focusTarget =
      romRoot?.querySelector('.rom-card') || romRoot?.getElementById('searchToggleBtn') || null;
    if (focusTarget) focusTarget.focus({ preventScroll: false });
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
      tv || cfg.id === 'ps1' || cfg.id === 'n64' || cfg.id === 'segacd' || cfg.id === 'saturn'
        ? hasGamepadApi()
          ? `<p class="controls-gamepad-hint">A gamepad works best if you have one plugged in.</p>`
          : `<p class="controls-gamepad-hint">Use the keyboard or on-screen controls; this browser does not support gamepads.</p>`
        : '';

    const isDisc = !!cfg.iaExternalDownload;
    const isFlash = cfg.player === 'ruffle';
    const loadLabel = isFlash ? 'Load .swf' : isDisc ? 'Load disc' : 'Load ROM';
    const loadTitle = isFlash
      ? `Load a local Flash game (${cfg.fileExtsLabel})`
      : isDisc
      ? `Load a local disc image (${cfg.fileExtsLabel})`
      : `Load a local ROM (${cfg.fileExtsLabel})`;

    const filePickerHtml = tv
      ? ''
      : `
        <button class="btn btn-secondary" id="loadRomBtn" type="button" title="${escapeHtml(
          loadTitle
        )}">
          <span>📁</span>
          <span>${loadLabel}</span>
        </button>`;
    const fileStack = filePickerHtml ? `<div class="btn-stack">${filePickerHtml}</div>` : '';

    bootCard.innerHTML = `
      <div class="boot-card-header">
        <h2>🕹️ Load a ${isFlash ? 'game' : isDisc ? 'disc' : 'ROM'}</h2>
        ${gamepadBannerHtml()}
        ${singleThreadNoticeHtml()}
        ${
          cfg.audioNote
            ? `<p class="audio-note" role="status">${escapeHtml(cfg.audioNote)}</p>`
            : ''
        }
        ${biosPanelHtml}
        ${fileStack}
        ${romHelpHtml}
        ${tvNoCollectionHtml}
        ${howtoHtml}
        <details class="controls-info">
          <summary>${controlsSummary}</summary>
          <div class="controls-panel">
            ${gamepadHint}
            <div class="controls-grid">${controlsRows}</div>
          </div>
        </details>
      </div>
      <div class="boot-card-scroll">
        <rom-browser console="${cfg.id}"></rom-browser>
      </div>
    `;

    const romInput = document.getElementById('romFileInput');
    if (romInput) romInput.setAttribute('accept', cfg.fileAccept);

    const loadBtn = document.getElementById('loadRomBtn');
    if (loadBtn && romInput) {
      loadBtn.addEventListener('click', () => romInput.click());
    }

    bios()?.wireBiosControls(cfg);
    wireTvFocus(bootCard);
    lazy().then(
      (l) => l.preloadOnIntent(bootCard, playScripts(cfg)),
      () => {}
    );
  }

  /**
   * Archive file name. `?rom=` already matches this in findRomByQuery.
   * @param {{ name?: string, title?: string } | null | undefined} rom
   * @returns {string}
   */
  function romQueryId(rom) {
    if (!rom) return '';
    return String(rom.name || rom.title || '').trim();
  }

  /**
   * Remember the chosen game in the query string without leaving the page.
   * Back then returns to the list entry underneath this one.
   * @param {{ name?: string, title?: string }} rom
   */
  function pushRomQuery(rom) {
    const id = romQueryId(rom);
    if (!id) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('rom') === id && history.state && history.state.emulatorRom === id) {
      return;
    }
    url.searchParams.set('rom', id);
    const next = `${url.pathname}${url.search}${url.hash}`;
    if (typeof window.pushHistorySilent === 'function') {
      window.pushHistorySilent({ emulatorRom: id }, next);
    } else {
      History.prototype.pushState.call(history, { emulatorRom: id }, '', next);
    }
  }

  /** Drop `?rom=` in place when the visitor leaves a game that has not started yet. */
  function clearRomQuery() {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('rom')) return;
    url.searchParams.delete('rom');
    const next = `${url.pathname}${url.search}${url.hash}`;
    if (typeof window.replaceHistorySilent === 'function') {
      window.replaceHistorySilent(history.state, next);
    } else {
      History.prototype.replaceState.call(history, history.state, '', next);
    }
  }

  /**
   * The browser Back button restores the list URL. EmulatorJS cannot unload
   * a running core in place, so a visible game reloads into that URL.
   * Before the canvas is up, re-render the boot card.
   */
  function onRomPopState() {
    const playing = document.getElementById('game-container')?.classList.contains('visible');
    if (playing) {
      window.location.reload();
      return;
    }
    const cfg = window.getEmulatorConsole && window.getEmulatorConsole();
    if (!cfg) {
      window.location.reload();
      return;
    }
    const rom = new URLSearchParams(window.location.search).get('rom');
    if (rom) tryDeeplinkRom(cfg, rom);
    else renderBootCard(cfg);
  }

  function returnToGameList() {
    const url = new URL(window.location.href);
    url.searchParams.delete('rom');
    url.hash = '';
    window.location.assign(`${url.pathname}${url.search}`);
  }

  function renderPicker() {
    const brand = document.getElementById('brand');
    const bootCard = document.getElementById('boot-card');
    if (!brand || !bootCard) return;

    setDocumentTitle();
    renderEmuBreadcrumbs(null);
    bootCard.classList.add('boot-card-picker');

    brand.innerHTML = `
      <span class="brand-logo">🎮</span>
      <h1>
        Retro Game Emulator
        <span class="sub">NES · Sega · Game Gear · 32X · Sega CD · SNES · Game Boy · GBA · Neo Geo · N64 · PS1 · Flash</span>
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
      <p class="picker-help">
        Free, browser-based emulators. No install, no ads. Bring your own ROM
        or browse the built-in collection. Flash games play here too, via Ruffle.
      </p>
    `;

    wireTvFocus(bootCard);
  }

  /** @param {string} message */
  function insertBootNotice(message) {
    const boot = document.getElementById('boot-card');
    if (!boot) return;
    const header = boot.querySelector('.boot-card-header') || boot;
    const note = document.createElement('p');
    note.className = 'deeplink-error';
    note.textContent = message;
    const heading = header.querySelector('h2');
    if (heading) header.insertBefore(note, heading.nextSibling);
    else header.prepend(note);
  }

  /**
   * Insert a panel in the boot-card header handing the visitor the Archive
   * download link plus the local file picker. Used for Sega CD and Saturn
   * deep links, whose discs are too large to stream.
   *
   * @param {object} cfg
   * @param {{ title: string, downloadUrl?: string, fileExtension?: string }} rom
   */
  function renderDeeplinkHandoff(cfg, rom) {
    renderBootCard(cfg);
    const boot = document.getElementById('boot-card');
    if (!boot || !boot.firstChild) return;

    const panel = document.createElement('div');
    panel.className = 'deeplink-handoff';
    panel.innerHTML = `
      <h3>${escapeHtml(rom.title)}</h3>
      <p>
        This disc is too large to load in the page. Download the disc image
        from Internet Archive, then load the saved file below.
      </p>
      <div class="deeplink-handoff-actions">
        <a class="btn btn-secondary" id="deeplinkDownloadLink" href="${escapeHtml(
          rom.downloadUrl || '#'
        )}" target="_blank" rel="noopener noreferrer">Download from Internet Archive</a>
        <button type="button" class="btn btn-secondary" id="deeplinkLoadLocalBtn">
          I have the file — load it
        </button>
      </div>
    `;
    const header = boot.querySelector('.boot-card-header') || boot;
    const heading = header.querySelector('h2');
    if (heading) header.insertBefore(panel, heading.nextSibling);
    else header.prepend(panel);

    document.getElementById('deeplinkLoadLocalBtn')?.addEventListener('click', () => {
      document.getElementById('romFileInput')?.click();
    });
  }

  /**
   * Sheet library when games-sheet.js is configured, otherwise the live
   * Archive listing. Play still downloads through an IA client.
   *
   * @param {object} cfg
   * @returns {Promise<object[]>}
   */
  async function listRoms(cfg) {
    const sheet = window.emulatorGamesSheet;
    const acquire = romAcquire();
    const ia = acquire && acquire.createIaClient(cfg);
    if (sheet && typeof sheet.isConfigured === 'function' && sheet.isConfigured()) {
      try {
        return await sheet.loadConsoleGames(cfg.id, {
          descriptionPrefix: cfg.iaDescriptionPrefix
        });
      } catch (err) {
        console.warn('Games sheet unavailable; listing Internet Archive instead.', err);
        if (!ia) throw err;
      }
    }
    if (!ia) throw new Error('ROM browser is not configured for this console.');
    return ia.fetchRomList();
  }

  /**
   * Deep link: /emulator/nes/?rom=<IA rom.name> (legacy: ?console=nes&rom=…)
   *
   * Cartridge consoles (and PS1) fetch the bytes and start the emulator.
   * Sega CD and Saturn resolve to the download handoff — those discs are
   * too large to stream.
   *
   * @param {object} cfg
   * @param {string} romQuery
   */
  async function tryDeeplinkRom(cfg, romQuery) {
    const bootCard = document.getElementById('boot-card');
    const wanted = romQuery.trim();
    if (!wanted || !bootCard) return;
    // Count the click before the ROM download. A failed fetch is still a start.
    if (typeof window.trackEmulatorGame === 'function') {
      window.trackEmulatorGame(cfg.id, wanted);
    }
    if (window.heymingAnalytics && typeof window.heymingAnalytics.whenCounts === 'function') {
      window.heymingAnalytics.whenCounts((counts) => {
        if (typeof counts.recordEmulatorPlay === 'function') {
          counts.recordEmulatorPlay(cfg.id, wanted);
        }
      });
    }
    const acquire = romAcquire();
    const streams = !(cfg.iaExternalDownload && !cfg.iaAllowInBrowser);

    if (!streams) {
      bootCard.innerHTML = `
        <h2>Finding ${escapeHtml(wanted)}</h2>
        <p class="picker-help">Looking it up in the game library…</p>
        <button type="button" class="btn btn-secondary" id="cancelDeeplinkBtn">
          Cancel — back to game list
        </button>
      `;
      document.getElementById('cancelDeeplinkBtn')?.addEventListener('click', returnToGameList);

      try {
        const roms = await listRoms(cfg);
        const rom = acquire.findRomByQuery(roms, wanted);
        if (!rom) throw new Error(`ROM not found: ${wanted}`);

        renderDeeplinkHandoff(cfg, rom);
      } catch (err) {
        console.error('Deep-link ROM lookup failed:', err);
        renderBootCard(cfg);
        insertBootNotice(
          'Could not find “' + wanted + '”. Pick a game from the collection instead.'
        );
      }
      return;
    }

    const controller = new AbortController();
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

      const roms = await listRoms(cfg);
      if (controller.signal.aborted) return;
      const rom = acquire.findRomByQuery(roms, wanted);
      if (!rom) throw new Error(`ROM not found: ${wanted}`);

      const romData = await ia.loadRom(rom, { signal: controller.signal });
      if (controller.signal.aborted) return;
      const romFile = acquire.fileFromRomBytes(romData, rom);
      window.launchEmulator(romFile, romFile.name, { tracked: true });
    } catch (err) {
      if (controller.signal.aborted || (err && err.name === 'AbortError')) return;
      console.error('Deep-link ROM load failed:', err);
      renderBootCard(cfg);
      insertBootNotice('Could not load “' + wanted + '”. Pick a ROM from the collection instead.');
    }
  }

  function markRuntimeUnavailable() {
    if (runtimeBlocked) return;
    runtimeBlocked = true;
    renderRuntimeUnavailable();
  }

  window.addEventListener('popstate', onRomPopState);

  // A recent on this console is a normal link. Following it reloads the
  // page while Cross is still held, and the new page reads that as Cancel.
  // Start the game here instead. A recent for another console still navigates.
  document.addEventListener(
    'click',
    function (event) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey
      ) {
        return;
      }
      const raw =
        event.target && event.target.nodeType === 1
          ? event.target
          : event.target && event.target.parentElement;
      const link = raw && raw.closest ? raw.closest('a.play-top-link') : null;
      if (!link || !link.href) return;
      const cfg = window.getEmulatorConsole && window.getEmulatorConsole();
      if (!cfg) return;
      let url;
      try {
        url = new URL(link.href, window.location.href);
      } catch (err) {
        return;
      }
      const rom = url.searchParams.get('rom');
      if (!rom) return;
      const dest = url.pathname.replace(/\/+$/, '');
      const here = window.location.pathname.replace(/\/+$/, '');
      if (dest !== here) return;
      event.preventDefault();
      pushRomQuery({ name: rom, title: rom });
      tryDeeplinkRom(cfg, rom);
    },
    true
  );
  window.emulatorPushRomQuery = pushRomQuery;
  window.emulatorClearRomQuery = clearRomQuery;

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
      if (cfg && !romAcquire()) {
        // The hub lists consoles, not games. A console reached from it
        // without its own page loads the game list first.
        loadInOrder(LISTING_SCRIPTS).then(
          () => {
            booted = false;
            bootUi();
          },
          (err) => {
            console.error('emulator: game list did not load', err);
            insertBootNotice('The game list did not load. Refresh the page and try again.');
          }
        );
        return;
      }
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

  window.launchEmulator = async function launchEmulator(romSource, romName, options) {
    const cfg = window.getEmulatorConsole && window.getEmulatorConsole();
    if (!cfg) {
      console.error('launchEmulator: no active console; bailing.');
      return;
    }

    const playingTitle =
      String(romName || 'game')
        .replace(
          /\.(zip|7z|chd|pbp|iso|cue|bin|gba|nes|sfc|smc|md|gen|n64|z64|v64|gb|gbc|nds|gg|ngp|ngc|swf|32x)$/i,
          ''
        )
        .trim() || 'game';
    if (!options || !options.tracked) {
      if (typeof window.trackEmulatorGame === 'function') {
        window.trackEmulatorGame(cfg.id, playingTitle);
      }
      // Recording the play loads a script. The launch must not wait on it.
      const analytics = window.heymingAnalytics;
      if (analytics && typeof analytics.whenCounts === 'function') {
        analytics.whenCounts((counts) => {
          if (typeof counts.recordEmulatorPlay === 'function') {
            counts.recordEmulatorPlay(cfg.id, playingTitle);
          }
        });
      }
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

    try {
      await loadInOrder(playScripts(cfg));
    } catch (err) {
      console.error('launchEmulator: play scripts did not load', err);
      insertBootNotice('The emulator did not load. Check your connection and try again.');
      return;
    }

    await window.emulatorPlay.play(romSource, cfg, {
      romName,
      title: playingTitle,
      biosFile: biosApi ? biosApi.getActiveFile() : null,
      onExit: returnToGameList
    });
  };
})();

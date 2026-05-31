// Boot orchestrator for the unified /emulator/ shell.
//
// Reads `?console=` and either:
//   - specializes the static boot card (brand, file-accept, controls
//     help, identity accent CSS variables) for that console, OR
//   - swaps the static boot card out for a console picker so the
//     visitor can choose between NES / Sega / Game Boy / ...
//
// Also defines `window.launchEmulator(romSource, romName)` which the
// local-file picker and the ROM browser both call. That function sets
// the EJS_* globals, drops in the loader.js, and fires a GA event so
// `<console>_rom_loaded` shows up in our analytics alongside the
// `nes_rom_loaded` event we used to emit from the old custom emulator.
(function () {
  'use strict';

  const SHELL_LOADED_AT = Date.now();

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  function applyConsoleIdentity(cfg) {
    // Identity tokens live on :root so brand.css cascades pick them up
    // and the rom-browser shadow DOM inherits them automatically. One
    // source of truth per console — no per-page CSS overrides.
    const root = document.documentElement;
    root.style.setProperty('--accent-bright', cfg.accentHex);
    root.style.setProperty('--accent-bright-soft', hexToRgba(cfg.accentHex, 0.08));
    root.style.setProperty('--accent-bright-ring', hexToRgba(cfg.accentHex, 0.25));
    root.style.setProperty('--accent-gold', cfg.accentGoldHex);
    root.setAttribute('data-emulator-console', cfg.id);
  }

  function hexToRgba(hex, alpha) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!m) return hex;
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 0xff}, ${(n >> 8) & 0xff}, ${n & 0xff}, ${alpha})`;
  }

  function renderBootCard(cfg) {
    const brand = document.getElementById('brand');
    const bootCard = document.getElementById('boot-card');
    if (!brand || !bootCard) return;

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

    bootCard.innerHTML = `
      <h2>🕹️ Load a ROM to play</h2>
      <div class="btn-stack">
        <rom-browser console="${cfg.id}"></rom-browser>
        <div class="divider">OR</div>
        <button class="btn btn-secondary" id="loadRomBtn" type="button">
          <span>📁</span>
          <span>Load Local ROM File (${escapeHtml(cfg.fileExtsLabel)})</span>
        </button>
      </div>
      <details class="controls-info">
        <summary>Keyboard Controls</summary>
        <div class="controls-grid">${controlsRows}</div>
      </details>
    `;

    const romInput = document.getElementById('romFileInput');
    if (romInput) romInput.setAttribute('accept', cfg.fileAccept);

    const loadBtn = document.getElementById('loadRomBtn');
    if (loadBtn && romInput) {
      loadBtn.addEventListener('click', () => romInput.click());
    }
  }

  function renderPicker() {
    const brand = document.getElementById('brand');
    const bootCard = document.getElementById('boot-card');
    if (!brand || !bootCard) return;

    brand.innerHTML = `
      <span class="brand-logo">🎮</span>
      <h1>
        Retro Game Emulator
        <span class="sub">NES · Sega Genesis · Game Boy · in your browser</span>
      </h1>
    `;

    const tiles = Object.values(window.EMULATOR_CONSOLES || {})
      .map((cfg) => {
        return `
          <a class="picker-tile" href="?console=${encodeURIComponent(cfg.id)}" data-console="${
          cfg.id
        }">
            <span class="picker-emoji">${cfg.emoji}</span>
            <span class="picker-title">${escapeHtml(cfg.title)}</span>
            <span class="picker-sub">${escapeHtml(cfg.subtitle)}</span>
          </a>
        `;
      })
      .join('');

    bootCard.innerHTML = `
      <h2>🕹️ Pick a console</h2>
      <div class="picker-grid">${tiles}</div>
      <p class="picker-help">
        Free, browser-based emulators. No install, no ads. Bring your own ROM
        or browse the built-in public-domain collection.
      </p>
    `;
  }

  function escapeHtml(s) {
    return String(s).replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  ready(() => {
    const cfg = window.getEmulatorConsole && window.getEmulatorConsole();
    if (cfg) {
      applyConsoleIdentity(cfg);
      renderBootCard(cfg);
    } else {
      renderPicker();
    }

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
  // Sets the EJS_* globals based on the active console then injects
  // the EmulatorJS loader. Also emits a GA `<console>_rom_loaded`
  // event so we keep visibility into ROM loads after retiring the
  // old custom NES emulator.
  window.launchEmulator = function launchEmulator(romSource, romName) {
    const cfg = window.getEmulatorConsole && window.getEmulatorConsole();
    if (!cfg) {
      console.error('launchEmulator: no active console; bailing.');
      return;
    }

    const bootEl = document.getElementById('boot');
    const gameContainer = document.getElementById('game-container');
    if (bootEl) bootEl.classList.add('hidden');
    if (gameContainer) gameContainer.classList.add('visible');

    window.EJS_player = '#game';
    window.EJS_core = cfg.ejsCore;
    window.EJS_gameUrl = romSource;
    window.EJS_gameName =
      romName || (romSource && typeof romSource === 'object' && romSource.name) || '';
    window.EJS_pathtodata = 'https://cdn.emulatorjs.org/latest/data/';
    window.EJS_startOnLoaded = true;
    // EJS_color wants a string; pull from the computed accent so a
    // future identity tweak only has to touch consoles.js.
    window.EJS_color =
      getComputedStyle(document.documentElement).getPropertyValue('--accent-bright').trim() ||
      cfg.accentHex;
    window.EJS_defaultControls = 1;
    // Exit Emulation: by default EmulatorJS leaves the user staring at an
    // "EmulatorJS has exited" message because a WASM instance can't be
    // unloaded in place. Override the toolbar button to reload back to the
    // current ?console=<id> URL, which re-renders the boot card with the
    // ROM browser + local-file picker so they can pick another game.
    window.EJS_Buttons = Object.assign({}, window.EJS_Buttons, {
      exitEmulation: {
        callback: () => window.location.reload()
      }
    });

    if (window.trackEvent) {
      const labelBase = (window.EJS_gameName || 'unknown').toString().slice(0, 80);
      const timeOnPage = Math.round((Date.now() - SHELL_LOADED_AT) / 1000);
      window.trackEvent(`${cfg.id}_rom_loaded`, 'Emulator', labelBase, timeOnPage);
    }

    const script = document.createElement('script');
    script.src = 'https://cdn.emulatorjs.org/latest/data/loader.js';
    document.body.appendChild(script);
  };
})();

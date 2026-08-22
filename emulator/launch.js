// Boot orchestrator for the unified /emulator/ shell.
//
// Reads `/emulator/<console>/` (or legacy `?console=`) and either:
//   - specializes the static boot card (brand, file-accept, controls
//     help, identity accent CSS variables) for that console, OR
//   - swaps the static boot card out for a console picker so the
//     visitor can choose between NES / Sega / Game Boy / ...
//
// Also defines `window.launchEmulator(romSource, romName, opts)` which the
// local-file picker and the ROM browser both call. That function sets
// the EJS_* globals, drops in the loader.js, and fires a GA event so
// `<console>_rom_loaded` shows up in our analytics alongside the
// `nes_rom_loaded` event we used to emit from the old custom emulator.
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
  const BIOS_IDB_NAME = 'heyming-emulator-bios';
  const BIOS_IDB_VERSION = 1;
  const BIOS_STORE = 'bios';
  let runtimeBlocked = false;
  /** True when we booted a core without cross-origin isolation (no threads). */
  let singleThreadMode = false;
  let pickerRoving = null;
  /** @type {File|null} BIOS file for the active console (IndexedDB or picker). */
  let activeBiosFile = null;

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

  function openBiosDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(BIOS_IDB_NAME, BIOS_IDB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(BIOS_STORE)) {
          db.createObjectStore(BIOS_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function biosMimeType(cfg, fileName) {
    const name = fileName || (cfg && cfg.biosFileName) || '';
    if (/\.zip$/i.test(name)) return 'application/zip';
    return 'application/octet-stream';
  }

  function biosFileAccept(cfg) {
    const name = (cfg && cfg.biosFileName) || '';
    if (/\.bin$/i.test(name)) return '.bin';
    if (/\.zip$/i.test(name)) return '.zip,.7z';
    return '.bin,.zip,.7z';
  }

  /** ZIP magic for Neo Geo; size floor for PS1 SCPH .bin dumps (~512 KiB). */
  function looksLikeBiosPayload(cfg, bytes) {
    if (!bytes || bytes.length < 64) return false;
    const name = (cfg && cfg.biosFileName) || '';
    if (/\.zip$/i.test(name)) {
      return bytes[0] === 0x50 && bytes[1] === 0x4b;
    }
    if (/\.bin$/i.test(name)) {
      return bytes.length >= 512 * 1024;
    }
    return true;
  }

  async function loadBiosFromIdb(key) {
    const db = await openBiosDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(BIOS_STORE, 'readonly');
      const req = tx.objectStore(BIOS_STORE).get(key);
      req.onsuccess = () => {
        const record = req.result;
        if (!record || !record.buffer) {
          resolve(null);
          return;
        }
        const name = record.name || 'bios.bin';
        resolve(
          new File([record.buffer], name, {
            type: record.type || biosMimeType(null, name)
          })
        );
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function saveBiosToIdb(key, file) {
    const buffer = await file.arrayBuffer();
    const record = {
      name: file.name || 'bios.bin',
      type: file.type || biosMimeType(null, file.name),
      buffer
    };
    const db = await openBiosDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(BIOS_STORE, 'readwrite');
      const req = tx.objectStore(BIOS_STORE).put(record, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async function clearBiosFromIdb(key) {
    const db = await openBiosDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(BIOS_STORE, 'readwrite');
      const req = tx.objectStore(BIOS_STORE).delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Ensure the core sees the canonical BIOS filename. For PS1, keep the
   * uploaded name when the user supplies a different region BIOS
   * (scph5500 / scph5502) so pcsx_rearmed can sniff it.
   */
  function normalizeBiosFile(file, cfg) {
    const wanted = (cfg && cfg.biosFileName) || 'bios.bin';
    const keepUploadedName =
      cfg && cfg.id === 'ps1' && /\.bin$/i.test(file.name || '') && file.name !== wanted;
    const name = keepUploadedName ? file.name : wanted;
    if (file.name === name) return file;
    return new File([file], name, {
      type: file.type || biosMimeType(cfg, name)
    });
  }

  function updateBiosStatusUi(cfg) {
    const status = document.getElementById('biosStatus');
    const clearBtn = document.getElementById('clearBiosBtn');
    const progress = document.getElementById('biosProgress');
    if (progress) progress.hidden = true;
    if (!status) return;
    if (activeBiosFile) {
      status.textContent = `BIOS ready (${activeBiosFile.name}) — saved in this browser for next time.`;
      status.dataset.ready = '1';
      if (clearBtn) clearBtn.hidden = false;
    } else {
      status.textContent = `BIOS needed: load ${(cfg && cfg.biosFileName) || 'bios.bin'} once.`;
      status.dataset.ready = '0';
      if (clearBtn) clearBtn.hidden = true;
    }
  }

  function setBiosProgress(received, total) {
    const progress = document.getElementById('biosProgress');
    const bar = document.getElementById('biosProgressBar');
    const label = document.getElementById('biosProgressLabel');
    const status = document.getElementById('biosStatus');
    if (!progress || !bar) return;
    progress.hidden = false;
    progress.dataset.indeterminate = total > 0 ? '0' : '1';
    const pct = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0;
    bar.style.width = total > 0 ? `${pct}%` : '35%';
    if (label) {
      if (total > 0) {
        label.textContent = `${formatBiosBytes(received)} / ${formatBiosBytes(total)} (${pct}%)`;
      } else {
        label.textContent = `Downloaded ${formatBiosBytes(received)}…`;
      }
    }
    if (status) {
      status.textContent = 'Downloading BIOS from Internet Archive…';
      status.dataset.ready = '0';
    }
  }

  function formatBiosBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  /** Prefer biosIaBaseUrl (PS1); fall back to game iaBaseUrl (Neo Geo). */
  function biosIaUrl(cfg) {
    if (!cfg || !cfg.biosFileName) return null;
    const baseRaw = cfg.biosIaBaseUrl || cfg.iaBaseUrl;
    if (!baseRaw) return null;
    const bases = Array.isArray(baseRaw) ? baseRaw : [baseRaw];
    const base = bases.find(Boolean);
    if (!base) return null;
    // Nested IA zip paths use biosIaFileName (e.g. PlayStation Bios.zip/SCPH-7001.bin).
    const remoteName = cfg.biosIaFileName || cfg.biosFileName;
    return `${String(base).replace(/\/$/, '')}/${remoteName}`;
  }

  async function fetchBiosFromIa(cfg) {
    const url = biosIaUrl(cfg);
    if (!url || !window.proxyService) return null;

    const loadBtn = document.getElementById('loadBiosBtn');
    if (loadBtn) loadBtn.disabled = true;

    // PS1 SCPH dumps are a fixed 512 KiB — use as progress total when proxies
    // omit Content-Length.
    const knownTotal = /\.bin$/i.test(cfg.biosFileName || '') ? 512 * 1024 : 0;

    try {
      let blob;
      if (typeof window.proxyService.fetchBinaryStream === 'function') {
        blob = await window.proxyService.fetchBinaryStream(url, {
          headers: { Accept: 'application/octet-stream,*/*' },
          maxRetries: 3,
          contentType: biosMimeType(cfg, cfg.biosFileName),
          onProgress: (p) => {
            const total = p.total > 0 ? p.total : knownTotal;
            setBiosProgress(p.received, total);
          }
        });
      } else {
        setBiosProgress(0, knownTotal || 1);
        const data = await window.proxyService.fetchBinaryWithProxy(url, {
          headers: { Accept: 'application/octet-stream,*/*' },
          timeout: 60000,
          maxRetries: 3,
          validateBinary: (bytes) => looksLikeBiosPayload(cfg, bytes)
        });
        if (!data) return null;
        blob = new Blob([data], { type: biosMimeType(cfg, cfg.biosFileName) });
      }

      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (!looksLikeBiosPayload(cfg, bytes)) return null;
      setBiosProgress(bytes.length, bytes.length);
      // Persist under the canonical EmulatorJS name (scph5501.bin), even when
      // the IA object path used a different SCPH revision.
      return new File([bytes], cfg.biosFileName, {
        type: biosMimeType(cfg, cfg.biosFileName)
      });
    } finally {
      if (loadBtn) loadBtn.disabled = false;
    }
  }

  /**
   * Resolve BIOS from memory → IndexedDB → Internet Archive (biosIaBaseUrl
   * or the console's game collection). Persists a successful IA fetch so
   * the next visit skips the download.
   */
  async function ensureActiveBios(cfg, opts) {
    opts = opts || {};
    if (!cfg || !cfg.biosRequired) return true;
    if (activeBiosFile) return true;

    const key = cfg.biosStorageKey || cfg.id;
    try {
      const fromDb = await loadBiosFromIdb(key);
      if (fromDb) {
        activeBiosFile = normalizeBiosFile(fromDb, cfg);
        updateBiosStatusUi(cfg);
        return true;
      }
    } catch (err) {
      console.warn('BIOS IndexedDB read failed:', err);
    }

    if (!biosIaUrl(cfg)) return false;

    if (opts.statusMessage !== false) {
      setBiosProgress(0, /\.bin$/i.test(cfg.biosFileName || '') ? 512 * 1024 : 0);
    }

    try {
      const file = await fetchBiosFromIa(cfg);
      if (!file) throw new Error('Empty BIOS download');
      const normalized = normalizeBiosFile(file, cfg);
      try {
        await saveBiosToIdb(key, normalized);
      } catch (err) {
        console.warn('BIOS IndexedDB save failed:', err);
      }
      activeBiosFile = normalized;
      updateBiosStatusUi(cfg);
      return true;
    } catch (err) {
      console.warn('BIOS Internet Archive fetch failed:', err);
      const progress = document.getElementById('biosProgress');
      if (progress) progress.hidden = true;
      statusBiosError(`Could not fetch ${cfg.biosFileName}. Load it manually, then try again.`);
      return false;
    }
  }

  function wireBiosControls(cfg) {
    if (!cfg || !cfg.biosRequired) {
      activeBiosFile = null;
      return;
    }

    const biosInput = document.getElementById('biosFileInput');
    const loadBiosBtn = document.getElementById('loadBiosBtn');
    const clearBiosBtn = document.getElementById('clearBiosBtn');

    const key = cfg.biosStorageKey || cfg.id;
    activeBiosFile = null;
    if (biosInput) biosInput.setAttribute('accept', biosFileAccept(cfg));
    updateBiosStatusUi(cfg);

    // IDB first, then auto-pull from the IA collection when available.
    ensureActiveBios(cfg).catch((err) => {
      console.warn('BIOS ensure failed:', err);
    });

    if (loadBiosBtn && biosInput) {
      loadBiosBtn.addEventListener('click', () => biosInput.click());
      biosInput.onchange = async function () {
        const file = this.files && this.files[0];
        this.value = '';
        if (!file) return;
        try {
          const normalized = normalizeBiosFile(file, cfg);
          await saveBiosToIdb(key, normalized);
          activeBiosFile = normalized;
          updateBiosStatusUi(cfg);
        } catch (err) {
          console.error('BIOS save failed:', err);
          statusBiosError('Could not save BIOS in this browser. Try again.');
        }
      };
    }

    if (clearBiosBtn) {
      clearBiosBtn.addEventListener('click', async () => {
        try {
          await clearBiosFromIdb(key);
        } catch (err) {
          console.warn('BIOS IndexedDB clear failed:', err);
        }
        activeBiosFile = null;
        updateBiosStatusUi(cfg);
      });
    }
  }

  function statusBiosError(message) {
    const status = document.getElementById('biosStatus');
    if (!status) return;
    status.textContent = message;
    status.dataset.ready = '0';
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
      tv || cfg.id === 'ps1' || cfg.id === 'n64'
        ? hasGamepadApi()
          ? `<p class="controls-gamepad-hint">Gamepad recommended — works via the browser Gamepad API.</p>`
          : `<p class="controls-gamepad-hint">Use D-pad or keyboard controls; this browser does not expose the Gamepad API.</p>`
        : '';

    const loadLabel =
      cfg.id === 'ps1'
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
      <h2>🕹️ Load a ${cfg.id === 'ps1' ? 'disc' : 'ROM'} to play</h2>
      ${gamepadBannerHtml()}
      ${singleThreadNoticeHtml()}
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

    wireBiosControls(cfg);
    wireTvFocus(bootCard);
  }

  function returnToGameList() {
    const url = new URL(window.location.href);
    url.searchParams.delete('rom');
    url.hash = '';
    window.location.assign(`${url.pathname}${url.search}`);
  }

  function mountPlayChrome() {
    let bar = document.getElementById('emu-play-chrome');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'emu-play-chrome';
      document.body.appendChild(bar);
    }
    bar.innerHTML =
      '<button type="button" class="emu-chrome-btn" id="emu-game-list-btn">Cancel loading / Game list</button>';
    bar.hidden = false;
    document.getElementById('emu-game-list-btn')?.addEventListener('click', returnToGameList);
  }

  function renderPicker() {
    const brand = document.getElementById('brand');
    const bootCard = document.getElementById('boot-card');
    if (!brand || !bootCard) return;

    setDocumentTitle(null);
    renderEmuBreadcrumbs(null);

    brand.innerHTML = `
      <span class="brand-logo">🎮</span>
      <h1>
        Retro Game Emulator
        <span class="sub">NES · Sega · Game Gear · 32X · SNES · Game Boy · Neo Geo · N64 · PS1</span>
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

  function createIaClient(cfg) {
    if (!cfg || !cfg.iaBaseUrl || !window.InternetArchiveRoms) return null;
    return new window.InternetArchiveRoms({
      baseUrl: cfg.iaBaseUrl,
      descriptionPrefix: cfg.iaDescriptionPrefix,
      fileExtensions: cfg.iaFileExtensions,
      excludeNames: cfg.iaExcludeNames,
      binaryTimeout: cfg.iaBinaryTimeout,
      maxRetries: cfg.iaMaxRetries,
      preferMetadata: cfg.iaPreferMetadata !== false
    });
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
      const ia = createIaClient(cfg);
      if (!ia) throw new Error('ROM browser is not configured for this console.');

      const roms = await ia.getAllRoms();
      if (controller.signal.aborted) return false;
      const lower = wanted.toLowerCase();
      const rom = roms.find(
        (r) =>
          r.name.toLowerCase() === lower ||
          r.title.toLowerCase() === lower ||
          `${r.name}${r.fileExtension || ''}`.toLowerCase() === lower
      );
      if (!rom) throw new Error(`ROM not found: ${wanted}`);

      const romData = await ia.loadRom(rom, { signal: controller.signal });
      if (controller.signal.aborted) return false;
      const ext = rom.fileExtension || '.zip';
      const mimeType = ext === '.zip' ? 'application/zip' : 'application/octet-stream';
      const filename = `${rom.title}${ext}`;
      const romFile = new File([romData], filename, { type: mimeType });
      window.launchEmulator(romFile, filename, { deeplink: true });
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
  // Sets the EJS_* globals based on the active console then injects
  // the EmulatorJS loader. Also emits a GA `<console>_rom_loaded`
  // event so we keep visibility into ROM loads after retiring the
  // old custom NES emulator.
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

    if (cfg.biosRequired) {
      const ok = await ensureActiveBios(cfg);
      if (!ok || !activeBiosFile) {
        renderBootCard(cfg);
        statusBiosError(`Load ${cfg.biosFileName || 'bios.bin'} before starting a game.`);
        return;
      }
    }

    const bootEl = document.getElementById('boot');
    const gameContainer = document.getElementById('game-container');
    const emuHeader = document.getElementById('emu-header');
    if (bootEl) bootEl.classList.add('hidden');
    if (gameContainer) gameContainer.classList.add('visible');
    if (emuHeader) emuHeader.classList.add('is-playing');
    if (cfg.id === 'nes') {
      window.heymingAchievements?.unlockForCurrentApp('first-action');
    }

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

    if (cfg.biosRequired && activeBiosFile) {
      // Same shape as EJS_gameUrl (File). EmulatorJS reads .name so the
      // canonical neogeo.zip filename is preserved for FBNeo.
      window.EJS_biosUrl = activeBiosFile;
    }
    // Exit Emulation: by default EmulatorJS leaves the user staring at an
    // "EmulatorJS has exited" message because a WASM instance can't be
    // unloaded in place. Override the toolbar button to reload back to the
    // current console lander URL, which re-renders the boot card with the
    // ROM browser + local-file picker so they can pick another game.
    window.EJS_Buttons = Object.assign({}, window.EJS_Buttons, {
      exitEmulation: {
        callback: returnToGameList
      }
    });

    if (window.trackEvent) {
      const raw = (window.EJS_gameName || 'unknown').toString().slice(0, 80);
      const labelBase = opts.deeplink ? `deeplink:${raw}` : raw;
      const timeOnPage = Math.round((Date.now() - SHELL_LOADED_AT) / 1000);
      window.trackEvent(`${cfg.id}_rom_loaded`, 'Emulator', labelBase, timeOnPage);
    }

    if (['sega', 'gg', 'sega32x', 'gb', 'neogeo', 'snes', 'n64', 'ps1'].includes(cfg.id)) {
      window.heymingAchievements?.unlockForCurrentApp('first-action');
    }

    mountPlayChrome();

    const script = document.createElement('script');
    script.src = 'https://cdn.emulatorjs.org/latest/data/loader.js';
    document.body.appendChild(script);
  };
})();

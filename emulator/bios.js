// BIOS persistence + Internet Archive fetch for the unified /emulator/ shell.
//
// IndexedDB cache, optional IA download, status/progress UI hooks, and
// `ensureActiveBios` so cores that need a firmware dump (PS1, Neo Geo, …)
// can resolve one before EmulatorJS mounts. Loaded before launch.js.
//
// Public surface: window.emulatorBios
(function () {
  'use strict';

  const BIOS_IDB_NAME = 'heyming-emulator-bios';
  const BIOS_IDB_VERSION = 1;
  const BIOS_STORE = 'bios';

  /** @type {File|null} BIOS file for the active console (IndexedDB or picker). */
  let activeBiosFile = null;

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
      const min = (cfg && cfg.biosMinBytes) || 512 * 1024;
      return bytes.length >= min;
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
    const baseRaw = cfg.biosIaBaseUrl || (cfg.iaExternalDownload ? null : cfg.iaBaseUrl);
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
    const knownTotal = /\.bin$/i.test(cfg.biosFileName || '') ? cfg.biosMinBytes || 512 * 1024 : 0;

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

  window.emulatorBios = {
    getActiveFile() {
      return activeBiosFile;
    },
    setActiveFile(file) {
      activeBiosFile = file || null;
    },
    ensureActiveBios,
    wireBiosControls,
    statusBiosError,
    updateBiosStatusUi,
    normalizeBiosFile,
    biosIaUrl,
    looksLikeBiosPayload,
    biosMimeType,
    biosFileAccept
  };
})();

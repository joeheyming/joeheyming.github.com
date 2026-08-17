// Internet Archive ROM client, parameterized by console.
//
// Each console that has an `iaBaseUrl` in consoles.js gets its own
// instance constructed by rom-browser.js. The class is intentionally
// agnostic to which collection it's pointed at — the only console-
// specific bit is the description prefix ("Classic NES game", etc.).
(function () {
  'use strict';

  /** ZIP local/empty/spanned file signatures (PK..). */
  function looksLikeZip(bytes) {
    if (!bytes || bytes.length < 4) return false;
    return (
      bytes[0] === 0x50 &&
      bytes[1] === 0x4b &&
      (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)
    );
  }

  /** 7z signature. */
  function looksLike7z(bytes) {
    if (!bytes || bytes.length < 6) return false;
    return (
      bytes[0] === 0x37 &&
      bytes[1] === 0x7a &&
      bytes[2] === 0xbc &&
      bytes[3] === 0xaf &&
      bytes[4] === 0x27 &&
      bytes[5] === 0x1c
    );
  }

  /**
   * Reject empty / error-page payloads. Archive extensions get magic checks;
   * raw ROM dumps (.gb/.gbc/.sfc/…) just need a non-trivial size.
   * @param {string} ext lowercase with leading dot
   * @param {Uint8Array} bytes
   */
  function looksLikeRomPayload(ext, bytes) {
    if (!bytes || bytes.length < 64) return false;
    if (ext === '.zip') return looksLikeZip(bytes);
    if (ext === '.7z') return looksLike7z(bytes);
    // MAME CHD / libretro CHD magic ("MComprHD").
    if (ext === '.chd') {
      return (
        bytes[0] === 0x4d &&
        bytes[1] === 0x43 &&
        bytes[2] === 0x6f &&
        bytes[3] === 0x6d &&
        bytes[4] === 0x70 &&
        bytes[5] === 0x72 &&
        bytes[6] === 0x48 &&
        bytes[7] === 0x44
      );
    }
    return true;
  }

  function extensionOfUrl(url) {
    try {
      const path = new URL(url).pathname;
      const m = path.toLowerCase().match(/(\.[a-z0-9]+)$/);
      return m ? m[1] : '';
    } catch {
      const m = String(url)
        .toLowerCase()
        .match(/(\.[a-z0-9]+)(?:\?|#|$)/);
      return m ? m[1] : '';
    }
  }

  async function fetchRom(url, opts) {
    opts = opts || {};
    const ext = extensionOfUrl(url);
    return window.proxyService.fetchBinaryWithProxy(url, {
      headers: { Accept: 'application/octet-stream,*/*' },
      // Arcade / SNES zips are large; flaky proxies need headroom + retries.
      timeout: opts.timeout || 120000,
      maxRetries: opts.maxRetries != null ? opts.maxRetries : 4,
      skipDirect: opts.skipDirect === true,
      validateBinary: (bytes) => looksLikeRomPayload(ext, bytes)
    });
  }

  class InternetArchiveRoms {
    constructor(config) {
      // baseUrl can be a single URL or an array. NES / Sega point at one
      // IA item; Game Boy fans both `theentiregameboycollection` (DMG-era,
      // includes gen-1 Pokémon) and `gameboycolorsystemcollection` (GBC
      // titles like Oracle of Ages, Pokémon Crystal). Results from each
      // are merged and deduped by name.
      const rawBase = Array.isArray(config.baseUrl) ? config.baseUrl : [config.baseUrl];
      this.baseUrls = rawBase.filter(Boolean);
      this.descriptionPrefix = config.descriptionPrefix || 'Classic game';
      // Which file extensions count as ROMs in this collection's directory
      // listing. NES / Sega / `theentiregameboycollection` use per-game
      // .zip; the bare `GameBoyColor` item ships raw .gbc / .gb files.
      // Lowercase + leading dot + longest-first so the strip pass picks
      // the most specific match first.
      const exts = (
        config.fileExtensions && config.fileExtensions.length ? config.fileExtensions : ['.zip']
      ).map((e) => e.toLowerCase());
      this.fileExtensions = exts.slice().sort((a, b) => b.length - a.length);
      // Optional lowercase basenames to drop from the directory listing
      // (e.g. Neo Geo's neogeo.zip / gg-bios.zip system files).
      this.excludeNames = new Set((config.excludeNames || []).map((n) => String(n).toLowerCase()));
      this.listTimeout = config.listTimeout || 45000;
      this.binaryTimeout = config.binaryTimeout || 120000;
      this.maxRetries = config.maxRetries != null ? config.maxRetries : 4;
      // Prefer IA metadata JSON by default: smaller than HTML listings, includes
      // sizes, and archive.org/metadata serves Access-Control-Allow-Origin: *
      // so the browser can fetch it without a CORS proxy. Set
      // preferMetadata: false to force the HTML directory listing first.
      this.preferMetadata = config.preferMetadata !== false;
      this.romCache = null;
      this.cacheTimestamp = null;
      this.cacheExpiry = 30 * 60 * 1000;
      // itemId → `https://{d1}{dir}` from the last successful metadata fetch.
      // Used so HTML-listing fallbacks can still resolve CDN download URLs.
      /** @type {Map<string, string>} */
      this._cdnBases = new Map();
    }

    async fetchRomList() {
      if (
        this.romCache &&
        this.cacheTimestamp &&
        Date.now() - this.cacheTimestamp < this.cacheExpiry
      ) {
        return this.romCache;
      }

      if (!window.proxyService) {
        throw new Error('Proxy service not available');
      }

      // Fetch each source in parallel. A single source failing should not
      // wipe out the others — log and keep going so the user still gets a
      // partial list rather than a dead modal.
      const results = await Promise.all(
        this.baseUrls.map((baseUrl) => this._fetchOneSource(baseUrl))
      );

      // Merge + dedupe by ROM name. Earlier sources win, so list the more
      // authoritative collection first in consoles.js.
      const merged = [];
      const seen = new Set();
      for (const list of results) {
        for (const rom of list) {
          if (seen.has(rom.name)) continue;
          seen.add(rom.name);
          merged.push(rom);
        }
      }
      if (merged.length === 0) {
        throw new Error(
          'No ROMs found and Internet Archive sources unreachable. Please try again later.'
        );
      }
      merged.sort((a, b) => a.name.localeCompare(b.name));

      this.romCache = merged;
      this.cacheTimestamp = Date.now();
      return merged;
    }

    /** Bust the in-memory list cache (used by the Retry button). */
    clearListCache() {
      this.romCache = null;
      this.cacheTimestamp = null;
    }

    _iaIdentifier(baseUrl) {
      const m = String(baseUrl).match(/archive\.org\/download\/([^/?#]+)/i);
      return m ? decodeURIComponent(m[1]) : null;
    }

    _isIaOfflineHtml(html) {
      return (
        html.includes('Temporarily Offline') ||
        html.includes('Internet Archive services are temporarily offline') ||
        html.includes('The Wayback Machine is temporarily offline')
      );
    }

    _listingLooksValid(html) {
      if (!html || this._isIaOfflineHtml(html)) return false;
      const lower = html.toLowerCase();
      return this.fileExtensions.some((ext) => lower.includes(ext));
    }

    async _fetchOneSource(baseUrl) {
      // Prefer the HTML directory listing (matches existing parsers), then
      // fall back to IA's metadata JSON when proxies return junk HTML.
      // preferMetadata flips the order so callers that need file sizes
      // (PS1 CHD handoff UI) get them without a second round-trip.
      const tryHtml = async () => {
        const html = await window.proxyService.fetchWithProxy(baseUrl, {
          skipDirect: true,
          timeout: this.listTimeout,
          maxRetries: this.maxRetries,
          headers: {
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
          },
          validate: (body) => this._listingLooksValid(body)
        });
        return this.parseRomList(html, baseUrl);
      };
      const tryMeta = async () => this._fetchOneSourceViaMetadata(baseUrl);

      const order = this.preferMetadata
        ? [
            ['metadata', tryMeta],
            ['HTML listing', tryHtml]
          ]
        : [
            ['HTML listing', tryHtml],
            ['metadata', tryMeta]
          ];

      for (const [label, fn] of order) {
        try {
          const list = await fn();
          if (list.length) return list;
        } catch (err) {
          console.warn(`ROM ${label} ${baseUrl} failed:`, err);
        }
      }

      return [];
    }

    /**
     * Build `https://{d1}{dir}` from IA metadata. Proxies handle these CDN
     * hosts far more reliably than archive.org/download/… (which 302s).
     * @param {object} meta
     * @returns {string|null}
     */
    _cdnBaseFromMeta(meta) {
      const d1 = meta && meta.d1;
      const dir = meta && meta.dir;
      if (!d1 || !dir) return null;
      const path = String(dir).startsWith('/') ? String(dir) : `/${dir}`;
      return `https://${d1}${path}`.replace(/\/$/, '');
    }

    async _fetchOneSourceViaMetadata(baseUrl) {
      const id = this._iaIdentifier(baseUrl);
      if (!id) return [];
      const metaUrl = `https://archive.org/metadata/${encodeURIComponent(id)}`;

      const acceptMeta = (body) => {
        try {
          const j = JSON.parse(body);
          // Empty `{}` / error payloads are common when IA is busy or the
          // item is darked — treat as invalid so we don't cache them.
          return !!(j && Array.isArray(j.files) && j.files.length > 0 && !j.error);
        } catch {
          return false;
        }
      };

      // archive.org/metadata is CORS-enabled. Try a full-timeout direct fetch
      // before spending proxy budget. Soft-empty responses (`{}`, no files)
      // return [] immediately so the caller can fall back to the HTML listing
      // instead of retrying the same dead payload through every proxy.
      try {
        const signal =
          typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
            ? AbortSignal.timeout(this.listTimeout)
            : undefined;
        const res = await fetch(metaUrl, {
          method: 'GET',
          headers: { Accept: 'application/json,*/*' },
          mode: 'cors',
          signal
        });
        if (res.ok) {
          const text = await res.text();
          if (acceptMeta(text)) {
            const meta = JSON.parse(text);
            const cdnBase = this._cdnBaseFromMeta(meta);
            if (cdnBase) this._cdnBases.set(id, cdnBase);
            return this.parseRomListFromMetadata(meta, baseUrl, cdnBase);
          }
          console.warn(
            `IA metadata for ${id} has no files (item missing/darked or IA busy) — skipping proxy retries`
          );
          return [];
        }
      } catch (err) {
        console.warn(`Direct IA metadata failed for ${id}:`, err && err.message);
      }

      const jsonText = await window.proxyService.fetchWithProxy(metaUrl, {
        // Direct already tried above with the full timeout.
        skipDirect: true,
        timeout: this.listTimeout,
        // Soft failures (empty {}) shouldn't burn a long retry ladder.
        maxRetries: Math.min(this.maxRetries, 1),
        headers: { Accept: 'application/json,*/*' },
        validate: acceptMeta
      });
      const meta = JSON.parse(jsonText);
      const cdnBase = this._cdnBaseFromMeta(meta);
      if (cdnBase) this._cdnBases.set(id, cdnBase);
      return this.parseRomListFromMetadata(meta, baseUrl, cdnBase);
    }

    /**
     * Resolve an archive.org/download/… URL to the item's CDN file URL when
     * we know (or can fetch) metadata. No-ops for already-CDN URLs.
     * @param {string} downloadUrl
     * @returns {Promise<string>}
     */
    async _resolveCdnDownloadUrl(downloadUrl) {
      const m = String(downloadUrl).match(
        /^https?:\/\/(?:www\.)?archive\.org\/download\/([^/?#]+)\/(.+)$/i
      );
      if (!m) return downloadUrl;
      const itemId = decodeURIComponent(m[1]);
      let filePath = m[2];
      try {
        filePath = decodeURIComponent(filePath);
      } catch {
        /* keep encoded */
      }
      let cdnBase = this._cdnBases.get(itemId);
      if (!cdnBase) {
        try {
          await this._fetchOneSourceViaMetadata(
            `https://archive.org/download/${encodeURIComponent(itemId)}`
          );
          cdnBase = this._cdnBases.get(itemId);
        } catch (err) {
          console.warn('CDN resolve via metadata failed:', err);
        }
      }
      if (!cdnBase) return downloadUrl;
      return `${cdnBase}/${filePath.split('/').map(encodeURIComponent).join('/')}`;
    }

    parseRomListFromMetadata(meta, baseUrl, cdnBase) {
      const roms = [];
      const files = (meta && meta.files) || [];
      const base = (cdnBase || String(baseUrl)).replace(/\/$/, '');
      // Some IA items nest games under `…/roms/…` (and also ship theme/artwork
      // zips). When a roms/ folder exists, only index those files.
      const hasRomsDir = files.some((f) => f && f.name && /\/roms\//i.test(String(f.name)));

      for (const file of files) {
        const filename = file && file.name;
        if (!filename) continue;
        if (hasRomsDir) {
          if (!/\/roms\//i.test(String(filename))) continue;
        } else if (String(filename).includes('/')) {
          // Flat collections (nes-collection style): skip nested metadata noise.
          continue;
        }
        const lower = String(filename).toLowerCase();
        const ext = this.fileExtensions.find((e) => lower.endsWith(e));
        if (!ext) continue;
        const baseName = String(filename).split('/').pop();
        const romName = baseName.slice(0, baseName.length - ext.length).trim();
        if (!romName) continue;
        if (this.excludeNames.has(romName.toLowerCase())) continue;
        if (roms.some((rom) => rom.name === romName)) continue;
        const firstChar = romName.charAt(0).toUpperCase();
        const category = /[A-Z]/.test(firstChar) ? firstChar : '#';
        const sizeNum = Number(file.size);
        roms.push({
          name: romName,
          title: romName,
          downloadUrl: `${base}/${String(filename).split('/').map(encodeURIComponent).join('/')}`,
          fileExtension: ext,
          category: category,
          description: `${this.descriptionPrefix}: ${romName}`,
          size: Number.isFinite(sizeNum) && sizeNum > 0 ? this._formatSize(sizeNum) : 'Unknown'
        });
      }

      roms.sort((a, b) => a.name.localeCompare(b.name));
      return roms;
    }

    _formatSize(bytes) {
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    parseRomList(html, baseUrl) {
      const roms = [];
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      // Build one "a[href$=...]" selector per accepted extension so a single
      // querySelectorAll call walks the table once. Each anchor's text is
      // the filename (matches existing IA directory-listing markup).
      const selector = this.fileExtensions.map((ext) => `a[href$="${ext}"]`).join(', ');
      const links = selector ? doc.querySelectorAll(selector) : [];

      links.forEach((link) => {
        const href = link.getAttribute('href');
        const filename = link.textContent.trim();
        if (!href || !filename || filename.length < 2) return;
        const lower = filename.toLowerCase();
        const ext = this.fileExtensions.find((e) => lower.endsWith(e));
        if (!ext) return;
        const romName = filename.slice(0, filename.length - ext.length).trim();
        if (!romName) return;
        if (this.excludeNames.has(romName.toLowerCase())) return;
        if (roms.some((rom) => rom.name === romName)) return;
        // IA's directory listing always serves a pre-encoded relative href
        // (e.g. `Pokemon%20Yellow%20...gbc`). Prefer that exact encoding —
        // re-encoding via encodeURIComponent normalizes parens / exclamation
        // marks differently than IA's own encoder, and we'd rather hand the
        // server back exactly what it gave us.
        const downloadUrl = /^https?:\/\//i.test(href)
          ? href
          : `${baseUrl}/${href.replace(/^\/+/, '')}`;
        const firstChar = romName.charAt(0).toUpperCase();
        const category = /[A-Z]/.test(firstChar) ? firstChar : '#';
        roms.push({
          name: romName,
          title: romName,
          downloadUrl: downloadUrl,
          // Original archive extension. The rom-browser uses this when it
          // wraps the bytes into a File so libretro cores see the right
          // suffix (.zip → unzip path, .gbc/.gb → raw ROM path).
          fileExtension: ext,
          category: category,
          description: `${this.descriptionPrefix}: ${romName}`,
          size: 'Unknown'
        });
      });

      roms.sort((a, b) => a.name.localeCompare(b.name));
      return roms;
    }

    async getAllRoms() {
      return this.fetchRomList();
    }

    async loadRom(rom) {
      if (!window.proxyService) {
        throw new Error('Proxy service not available');
      }
      const url = await this._resolveCdnDownloadUrl(rom.downloadUrl);
      return fetchRom(url, {
        timeout: this.binaryTimeout,
        maxRetries: this.maxRetries
      });
    }
  }

  window.InternetArchiveRoms = InternetArchiveRoms;
})();

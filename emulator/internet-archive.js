// Internet Archive ROM client, parameterized by console.
//
// Each console that has an `iaBaseUrl` in consoles.js gets its own
// instance constructed by rom-browser.js. The class is intentionally
// agnostic to which collection it's pointed at — the only console-
// specific bit is the description prefix ("Classic NES game", etc.).
(function () {
  'use strict';

  async function fetchRom(url) {
    return window.proxyService.fetchBinaryWithProxy(url, {
      headers: { Accept: 'application/octet-stream,*/*' },
      timeout: 30000,
      maxRetries: 3
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
      this.romCache = null;
      this.cacheTimestamp = null;
      this.cacheExpiry = 30 * 60 * 1000;
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

    async _fetchOneSource(baseUrl) {
      try {
        const html = await window.proxyService.fetchWithProxy(baseUrl, {
          skipDirect: true,
          timeout: 30000,
          maxRetries: 3,
          headers: {
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
          }
        });
        if (
          html.includes('Temporarily Offline') ||
          html.includes('Internet Archive services are temporarily offline') ||
          html.includes('The Wayback Machine is temporarily offline')
        ) {
          throw new Error('Internet Archive is temporarily offline.');
        }
        return this.parseRomList(html, baseUrl);
      } catch (err) {
        console.warn(`ROM source ${baseUrl} failed:`, err);
        return [];
      }
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
      return fetchRom(rom.downloadUrl);
    }
  }

  window.InternetArchiveRoms = InternetArchiveRoms;
})();

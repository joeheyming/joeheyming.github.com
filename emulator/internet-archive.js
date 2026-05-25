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
      this.baseUrl = config.baseUrl;
      this.descriptionPrefix = config.descriptionPrefix || 'Classic game';
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

      const html = await window.proxyService.fetchWithProxy(this.baseUrl, {
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
        throw new Error('Internet Archive is temporarily offline. Please try again later.');
      }

      const roms = this.parseRomList(html);
      this.romCache = roms;
      this.cacheTimestamp = Date.now();
      return roms;
    }

    parseRomList(html) {
      const roms = [];
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const zipLinks = doc.querySelectorAll('a[href$=".zip"]');

      zipLinks.forEach((link) => {
        const href = link.getAttribute('href');
        const filename = link.textContent.trim();
        if (!href || !filename || filename.length < 2) return;
        const romName = filename.replace(/\.zip$/i, '').trim();
        if (roms.some((rom) => rom.name === romName)) return;
        const downloadUrl = href.startsWith('http')
          ? href
          : `${this.baseUrl}/${encodeURIComponent(filename)}`;
        const firstChar = romName.charAt(0).toUpperCase();
        const category = /[A-Z]/.test(firstChar) ? firstChar : '#';
        roms.push({
          name: romName,
          title: romName,
          downloadUrl: downloadUrl,
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

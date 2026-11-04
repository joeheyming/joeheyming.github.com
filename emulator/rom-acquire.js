// Shared Internet Archive client + ROM File helpers for the /emulator/ shell.
//
// Used by launch.js deep links and <rom-browser> so both wrap IA bytes into
// a File with the same filename / MIME rules libretro expects. Loaded before
// rom-browser.js and launch.js.
//
// Public surface: window.emulatorRomAcquire
(function () {
  'use strict';

  // Libretro's thumbnail pack names each image after the ROM label, with
  // characters that are illegal in a Windows filename swapped for `_`.
  // Apostrophes stay (`Knuckles' Chaotix`). Confirmed against the live pack:
  // `Adventures of Batman & Robin` is stored as `Adventures of Batman _ Robin`.
  const THUMBNAIL_HOST = 'https://thumbnails.libretro.com';
  const THUMBNAIL_ILLEGAL = /[&*/:`<>?\\|]/g;
  // Articles and filler words. "The Legend of Zelda" and
  // "Legend of Zelda, The (USA)" then share the tokens legend + zelda.
  const THUMBNAIL_STOP = new Set(['the', 'a', 'an', 'of', 'and', 'or']);
  const THUMBNAIL_STORAGE = 'libretro-boxarts:';

  /** @type {Map<string, Promise<{ names: string[], set: Set<string> } | null>>} */
  const thumbnailIndexPromises = new Map();
  /** @type {Map<string, { names: string[], set: Set<string> }>} */
  const thumbnailIndexes = new Map();

  /**
   * @param {string} name
   * @returns {string}
   */
  function thumbnailStem(name) {
    return String(name || '')
      .replace(THUMBNAIL_ILLEGAL, '_')
      .replace(/[. ]+$/g, '')
      .trim();
  }

  /**
   * Significant words in a ROM or box-art name. Parenthetical tags
   * (region, revision, language) are dropped. Hyphenated parts stay
   * separate (`3-D` → `3`, `d`) so both sides tokenize the same way.
   * Underscores are spaces: that is how the pack stores `&`.
   *
   * @param {string} name
   * @returns {string[]}
   */
  function thumbnailTokens(name) {
    const bare = String(name || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s*[([].*?[)\]]/g, ' ')
      .replace(/_+/g, ' ');
    const parts = bare.split(/[^a-z0-9]+/).filter(Boolean);
    const significant = parts.filter((token) => !THUMBNAIL_STOP.has(token));
    return significant.length ? significant : parts;
  }

  /**
   * Lower is better. Retail USA beats Europe, Japan, and beta dumps when
   * two files contain the same words.
   * @param {string} name
   * @returns {{ junk: number, disc: number, region: number }}
   */
  function thumbnailRank(name) {
    const lower = String(name || '').toLowerCase();
    let junk = 0;
    if (/\b(beta|proto|prototype|sample|demo|unl|pirate|alpha)\b/.test(lower)) junk = 2;
    else if (/\brev\b|\bvirtual console\b/.test(lower)) junk = 1;
    const discMatch = lower.match(/\(disc (\d+)/);
    const disc = discMatch ? Number(discMatch[1]) || 9 : 0;
    let region = 5;
    if (/\(usa|\(u\)/.test(lower)) region = 0;
    else if (/\(world/.test(lower)) region = 1;
    else if (/\(europe|\(eur/.test(lower)) region = 2;
    else if (/\(japan|\(jap/.test(lower)) region = 3;
    else if (!/[()]/.test(lower)) region = 1;
    return { junk, disc, region };
  }

  /**
   * Indexed box-art name whose words cover every word of `query`, preferring
   * the tightest title and then a retail USA release. Null when nothing covers.
   *
   * @param {string} query
   * @param {string[]} names
   * @returns {string|null}
   */
  function pickThumbnailName(query, names) {
    const queryTokens = thumbnailTokens(query);
    if (!queryTokens.length || !names || !names.length) return null;
    let best = null;
    /** @type {number[]|null} */
    let bestKey = null;
    for (let i = 0; i < names.length; i++) {
      const candidate = names[i];
      const tokens = thumbnailTokens(candidate);
      const have = new Set(tokens);
      if (!queryTokens.every((token) => have.has(token))) continue;
      const extra = tokens.length - queryTokens.length;
      if (extra < 0) continue;
      const rank = thumbnailRank(candidate);
      const key = [extra, rank.junk, rank.disc, rank.region];
      if (!bestKey || compareThumbnailKey(key, bestKey) < 0) {
        best = candidate;
        bestKey = key;
      }
    }
    return best;
  }

  /**
   * @param {number[]} left
   * @param {number[]} right
   * @returns {number}
   */
  function compareThumbnailKey(left, right) {
    for (let i = 0; i < left.length; i++) {
      if (left[i] !== right[i]) return left[i] - right[i];
    }
    return 0;
  }

  /**
   * @param {string} playlist
   * @param {string} stem
   * @returns {string}
   */
  function thumbnailUrl(playlist, stem) {
    return `${THUMBNAIL_HOST}/${encodeURIComponent(playlist)}/Named_Boxarts/${encodeURIComponent(
      stem
    )}.png`;
  }

  /**
   * Box-art URLs for a ROM name, one per libretro playlist. The name is the
   * filename with its extension already removed. Empty when nothing can be
   * looked up. Uses the exact filename. `thumbnailUrlsResolved` swaps in a
   * token match once a playlist index is loaded.
   *
   * @param {string[]|undefined} systems  e.g. `['Sega - Game Gear']`
   * @param {string} name
   * @returns {string[]}
   */
  function thumbnailUrls(systems, name) {
    const stem = thumbnailStem(name);
    if (!stem || !Array.isArray(systems)) return [];
    const urls = [];
    for (const system of systems) {
      const playlist = String(system || '').trim();
      if (!playlist) continue;
      urls.push(thumbnailUrl(playlist, stem));
    }
    return urls;
  }

  /**
   * Like `thumbnailUrls`, but each playlist that has a loaded name index
   * uses the closest token match instead of a filename that would 404.
   * A playlist with no covering name is skipped.
   *
   * @param {string[]|undefined} systems
   * @param {string} name
   * @returns {string[]}
   */
  function thumbnailUrlsResolved(systems, name) {
    const stem = thumbnailStem(name);
    if (!stem || !Array.isArray(systems)) return [];
    const urls = [];
    for (const system of systems) {
      const playlist = String(system || '').trim();
      if (!playlist) continue;
      const index = thumbnailIndexes.get(playlist);
      if (!index) {
        urls.push(thumbnailUrl(playlist, stem));
        continue;
      }
      if (index.set.has(stem)) {
        urls.push(thumbnailUrl(playlist, stem));
        continue;
      }
      const picked = pickThumbnailName(name, index.names);
      if (picked) urls.push(thumbnailUrl(playlist, picked));
    }
    return urls;
  }

  function thumbnailIndexEnabled() {
    try {
      const ua = window.navigator && window.navigator.userAgent;
      // Unit tests run in jsdom and must stay network-free.
      if (ua && /jsdom/i.test(String(ua))) return false;
    } catch {
      return false;
    }
    return typeof fetch === 'function';
  }

  /**
   * @param {string} playlist
   * @returns {string[]|null}
   */
  function readStoredThumbnailIndex(playlist) {
    try {
      const raw = window.sessionStorage.getItem(THUMBNAIL_STORAGE + playlist);
      if (!raw) return null;
      const names = JSON.parse(raw);
      return Array.isArray(names) && names.length ? names : null;
    } catch {
      return null;
    }
  }

  /**
   * @param {string} playlist
   * @param {string[]} names
   */
  function storeThumbnailIndex(playlist, names) {
    try {
      window.sessionStorage.setItem(THUMBNAIL_STORAGE + playlist, JSON.stringify(names));
    } catch {
      /* quota or private mode — the in-memory copy is enough */
    }
  }

  /**
   * Libretro publishes one Git repo per playlist. The tree lists every
   * Named_Boxarts file, which is the only search the thumbnail host has.
   * @param {string} playlist
   * @returns {Promise<string[]|null>}
   */
  async function fetchThumbnailIndex(playlist) {
    const stored = readStoredThumbnailIndex(playlist);
    if (stored) return stored;
    const repo = playlist.replace(/ - /g, '_-_').replace(/ /g, '_');
    const url = `https://api.github.com/repos/libretro-thumbnails/${encodeURIComponent(
      repo
    )}/git/trees/master?recursive=1`;
    const response = await fetch(url, {
      headers: { Accept: 'application/vnd.github+json' }
    });
    if (!response.ok) return null;
    const data = await response.json();
    const tree = data && data.tree;
    if (!Array.isArray(tree)) return null;
    const prefix = 'Named_Boxarts/';
    const names = [];
    for (let i = 0; i < tree.length; i++) {
      const path = tree[i] && tree[i].path;
      if (!path || path.indexOf(prefix) !== 0 || path.indexOf('.png') !== path.length - 4) continue;
      const file = path.slice(prefix.length);
      if (!file || file.indexOf('/') !== -1) continue;
      names.push(file.slice(0, -4));
    }
    if (!names.length) return null;
    storeThumbnailIndex(playlist, names);
    return names;
  }

  /**
   * @param {string} system
   * @returns {Promise<{ names: string[], set: Set<string> } | null>}
   */
  function loadThumbnailIndex(system) {
    const playlist = String(system || '').trim();
    if (!playlist || !thumbnailIndexEnabled()) return Promise.resolve(null);
    const existing = thumbnailIndexPromises.get(playlist);
    if (existing) return existing;
    const pending = fetchThumbnailIndex(playlist)
      .then((names) => {
        if (!names) return null;
        const packed = { names, set: new Set(names) };
        thumbnailIndexes.set(playlist, packed);
        return packed;
      })
      .catch(() => null);
    thumbnailIndexPromises.set(playlist, pending);
    return pending;
  }

  /**
   * Fetch box-art name lists for the playlists this console uses.
   * Safe to call more than once. Failures leave exact-name lookup in place.
   * @param {string[]|undefined} systems
   * @returns {Promise<void>}
   */
  function preloadThumbnailIndexes(systems) {
    if (!thumbnailIndexEnabled() || !Array.isArray(systems)) return Promise.resolve();
    return Promise.all(systems.map((system) => loadThumbnailIndex(system))).then(() => undefined);
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
   * Wrap downloaded ROM bytes in a File so EmulatorJS / libretro cores see a
   * real filename. Preserve the archive extension: .zip collections unzip
   * inside the core; raw .gb / .gbc must keep their suffix.
   *
   * @param {ArrayBuffer|Uint8Array|Blob} romData
   * @param {{ title?: string, name?: string, fileExtension?: string }} rom
   * @returns {File}
   */
  function fileFromRomBytes(romData, rom) {
    const ext = (rom && rom.fileExtension) || '.zip';
    const mimeType = ext === '.zip' ? 'application/zip' : 'application/octet-stream';
    const title = (rom && (rom.title || rom.name)) || 'rom';
    const filename = `${title}${ext}`;
    return new File([romData], filename, { type: mimeType });
  }

  /**
   * Match a deep-link `?rom=` query against an IA list entry by name, title,
   * or name+extension.
   *
   * @param {Array<{ name: string, title: string, fileExtension?: string }>} roms
   * @param {string} wanted
   * @returns {object|undefined}
   */
  function findRomByQuery(roms, wanted) {
    const lower = String(wanted || '')
      .trim()
      .toLowerCase();
    if (!lower || !Array.isArray(roms)) return undefined;
    return roms.find(
      (r) =>
        r.name.toLowerCase() === lower ||
        r.title.toLowerCase() === lower ||
        `${r.name}${r.fileExtension || ''}`.toLowerCase() === lower
    );
  }

  window.emulatorRomAcquire = {
    createIaClient,
    fileFromRomBytes,
    findRomByQuery,
    thumbnailUrls,
    thumbnailUrlsResolved,
    thumbnailTokens,
    pickThumbnailName,
    preloadThumbnailIndexes
  };
})();

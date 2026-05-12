import {
  MODDB_BASE,
  MODDB_LISTING_URL,
  MODDB_GAMES,
  MODDB_GAME_ID,
  ALLOWED_GAME_SLUGS,
  parseListing,
  parseModPage,
  parseDownloadsList,
  parseDownloadPage,
  pickBestDownload,
  isCloudflareBlocked,
  parseSizeText,
  parseVersion,
  formatBytes,
  extractModSlug,
  absolutize,
  CACHE_KEY,
  CACHE_TTL_MS,
  PLAYABLE_EXTS,
  SIZE_HARD_CAP_BYTES
} from './moddb-browser-parsers.js';
import { UZDoomModdbArchive } from './moddb-archive.js';

// ---- Listing cache (localStorage, 24h) ---------------------------------

function readCache(key) {
  try {
    const raw = localStorage.getItem(CACHE_KEY + ':' + key);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return null;
    if (Date.now() - (obj.t || 0) > CACHE_TTL_MS) return null;
    return obj.v;
  } catch (_) {
    return null;
  }
}
function writeCache(key, value) {
  try {
    localStorage.setItem(CACHE_KEY + ':' + key, JSON.stringify({ t: Date.now(), v: value }));
  } catch (_) {
    /* quota / private mode */
  }
}

// ---- Networking --------------------------------------------------------

/**
 * Build a moddb /mods listing URL.
 *
 * Two modes:
 *   - No `kw`: filter to a specific game (defaults to the primary game id,
 *     or accepts opts.gameId for fan-out across MODDB_GAMES).
 *     Includes filter=t which is moddb's canonical "filter applied" form.
 *   - With `kw`: build a GLOBAL keyword search URL. moddb's kw= param
 *     ignores game= entirely (the page even retitles to "Mods for
 *     Games"), so we drop game= and let the caller filter results
 *     client-side via parseListing's per-row gameSlug.
 */
function buildListingUrl(opts) {
  const params = new URLSearchParams();
  if (opts.kw) {
    // Global keyword search across all games. game= is ignored by moddb
    // for kw= queries, so we omit it. Caller filters client-side.
    params.set('kw', opts.kw);
  } else {
    params.set('filter', 't');
    const gameId = Number.isFinite(opts.gameId) ? opts.gameId : MODDB_GAME_ID;
    params.set('game', String(gameId));
  }
  if (opts.page && opts.page > 1) params.set('page', String(opts.page));
  if (opts.sort) params.set('sort', opts.sort);
  if (opts.released) params.set('released', opts.released);
  if (opts.theme) params.set('theme', opts.theme);
  return MODDB_LISTING_URL + '?' + params.toString();
}

/**
 * Fetch + parse a moddb listing.
 *
 *   - With kw: ONE global request, then client-side filter to mods whose
 *     row's game classification is in ALLOWED_GAME_SLUGS.
 *   - Without kw: parallel requests for each entry in MODDB_GAMES, then
 *     merge & dedupe by mod slug. Pagination collapses to the max page
 *     count seen across the per-game responses (best-effort).
 */
async function fetchListing(opts) {
  if (!window.proxyService) throw new Error('proxyService unavailable');
  const o = opts || {};
  if (o.kw) {
    return fetchKeywordListing(o);
  }
  return fetchMultiGameListing(o);
}

async function fetchSingleListing(opts) {
  const url = buildListingUrl(opts);
  const cacheKey = 'list:' + url;
  const cached = readCache(cacheKey);
  if (cached) return cached;

  const html = await window.proxyService.fetchWithProxy(url, {
    skipDirect: true,
    timeout: 20000,
    maxRetries: 2
  });
  if (isCloudflareBlocked(html)) {
    throw new Error('Cloudflare blocked the proxy. Try again or open moddb directly.');
  }
  const result = parseListing(html, url);
  writeCache(cacheKey, result);
  return result;
}

async function fetchKeywordListing(opts) {
  const result = await fetchSingleListing(opts);
  // moddb returned mods across all games — keep only those whose row
  // identifies as one of our allowed Doom games. Mods with NO gameSlug
  // (rare; usually means moddb's row markup drifted) are kept by
  // default to avoid hiding real results during DOM drift.
  const filtered = result.mods.filter((m) => !m.gameSlug || ALLOWED_GAME_SLUGS.has(m.gameSlug));
  return { mods: filtered, pagination: result.pagination };
}

async function fetchMultiGameListing(opts) {
  // One request per game id, in parallel. Settled (not all) so a single
  // proxy/Cloudflare blip doesn't kill the whole page.
  const settled = await Promise.allSettled(
    MODDB_GAMES.map((g) => fetchSingleListing({ ...opts, gameId: g.id }))
  );

  const successes = settled.filter((s) => s.status === 'fulfilled').map((s) => s.value);
  if (successes.length === 0) {
    // Re-throw the first rejection so the user sees a real error.
    const firstReject = settled.find((s) => s.status === 'rejected');
    throw (firstReject && firstReject.reason) || new Error('All game listings failed');
  }

  // Merge & dedupe by slug, preserving order from the first successful
  // response (so the primary game's "popular" mods stay near the top).
  const seenSlug = new Set();
  const merged = [];
  successes.forEach((res) => {
    res.mods.forEach((m) => {
      if (seenSlug.has(m.slug)) return;
      seenSlug.add(m.slug);
      merged.push(m);
    });
  });

  const lastPage = successes.reduce(
    (max, res) => Math.max(max, (res.pagination && res.pagination.last) || 1),
    1
  );
  return {
    mods: merged,
    pagination: { current: opts.page || 1, last: lastPage }
  };
}

async function fetchModInfo(slugOrUrl) {
  if (!window.proxyService) throw new Error('proxyService unavailable');
  const url = looksLikeUrl(slugOrUrl) ? slugOrUrl : MODDB_BASE + '/mods/' + slugOrUrl;
  const cacheKey = 'mod:' + url;
  const cached = readCache(cacheKey);
  if (cached) return cached;

  const html = await window.proxyService.fetchWithProxy(url, {
    skipDirect: true,
    timeout: 20000,
    maxRetries: 2
  });
  if (isCloudflareBlocked(html)) {
    throw new Error('Cloudflare blocked the proxy. Try again or open moddb directly.');
  }
  const info = parseModPage(html, url);
  writeCache(cacheKey, info);
  return info;
}

function looksLikeUrl(s) {
  return typeof s === 'string' && /^https?:\/\//i.test(s);
}

async function resolveDownloadUrl(modInfo) {
  if (!modInfo || !modInfo.downloadsUrl) {
    throw new Error('No downloads page on moddb for this mod');
  }
  const dlListHtml = await window.proxyService.fetchWithProxy(modInfo.downloadsUrl, {
    skipDirect: true,
    timeout: 20000,
    maxRetries: 2
  });
  const list = parseDownloadsList(dlListHtml, modInfo.downloadsUrl);
  const best = pickBestDownload(list);
  if (!best) throw new Error('No downloads found on moddb');

  if (best.ext && /^(rar|7z)$/.test(best.ext)) {
    throw new Error(
      'Mod ships as .' +
        best.ext +
        ' which we cannot extract in-browser. ' +
        'Download manually from moddb and use the manual upload picker.'
    );
  }

  const dlPageHtml = await window.proxyService.fetchWithProxy(best.url, {
    skipDirect: true,
    timeout: 20000,
    maxRetries: 2
  });
  const page = parseDownloadPage(dlPageHtml, best.url);
  if (page.mirrors.length === 0) {
    throw new Error('No mirrors found on moddb download page');
  }
  return {
    filename: page.filename,
    sizeBytes: page.sizeBytes,
    mirrorUrl: page.mirrors[0].url,
    moddbDownloadUrl: best.url,
    ext: best.ext
  };
}

async function downloadAndExtract(resolved, opts) {
  if (!window.proxyService) throw new Error('proxyService unavailable');
  if (resolved.sizeBytes && resolved.sizeBytes > SIZE_HARD_CAP_BYTES && !opts.allowOversize) {
    throw new Error(
      'Download is ' +
        formatBytes(resolved.sizeBytes) +
        ' which exceeds the ' +
        formatBytes(SIZE_HARD_CAP_BYTES) +
        ' cap. Pass allowOversize:true to override.'
    );
  }

  const buf = await window.proxyService.fetchBinaryWithProxy(resolved.mirrorUrl, {
    skipDirect: true,
    headers: { Accept: 'application/octet-stream,*/*' },
    timeout: 90000,
    maxRetries: 2
  });

  // Heuristic: starts with "PK\x03\x04" → zip. Otherwise treat as raw asset.
  const isZip =
    buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
  if (isZip) {
    if (!UZDoomModdbArchive || !UZDoomModdbArchive.extractZip) {
      throw new Error('archive helper missing');
    }
    const entries = await UZDoomModdbArchive.extractZip(buf, {
      filter: (name) => PLAYABLE_EXTS.test(name)
    });
    if (entries.length === 0) {
      throw new Error('No playable .pk3/.wad files found inside the archive');
    }
    return entries;
  }

  // Raw .pk3/.wad/.pk7 — derive filename from the resolved download.
  const filename = (resolved.filename && resolved.filename) || 'moddb-' + (resolved.ext || 'pk3');
  return [{ name: filename, data: buf }];
}
export const internal = {
  buildListingUrl,
  parseSizeText,
  parseVersion,
  formatBytes,
  extractModSlug,
  absolutize,
  MODDB_GAMES,
  ALLOWED_GAME_SLUGS
};

export { buildListingUrl, fetchListing, fetchModInfo, resolveDownloadUrl, downloadAndExtract };

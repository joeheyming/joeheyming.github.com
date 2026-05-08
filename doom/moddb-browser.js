// moddb mod browser. Lets the user search/sort/paginate Doom mods on
// moddb.com, pick one, fetch + extract it via window.proxyService, and
// hand it off to the existing UZDoomLoader.primeWith()/launch() flow.
//
// Architecture:
//   * All HTML parsing functions are pure (no DOM mutation, no fetch)
//     and live on window.UZDoomModdb.parsers so tests can exercise them
//     against fixtures without spinning up the full UI.
//   * Networking goes through window.proxyService (proxy.js). Direct
//     fetch is skipped because moddb does not send permissive CORS.
//   * Mod assets go through window.UZDoomModdbArchive for extraction
//     and window.UZDoomModdbIwad for the chosen IWAD.
//   * Launch happens via window.UZDoomLoader.primeWith() + launch().
//
// SELECTOR FRAGILITY: every CSS selector this file uses is co-located in
// the SELECTORS table near the top. moddb's DOM drifts; when scraping
// breaks, fix it here and re-run tests/moddb-browser.test.mjs against an
// updated fixture.
//
// COURTESY: every mod card always carries a direct link back to the
// moddb page so users can support the author on the actual site. We
// cache listing pages aggressively (24h via localStorage) so we don't
// hammer moddb's servers.

(function () {
  'use strict';

  // ---- Configuration -----------------------------------------------------

  // moddb game ids we accept. Both run on the same Doom engine via UZDoom,
  // and both .wad files are interchangeable as IWADs from a launcher's
  // standpoint, so the user-facing branding is just "Doom mods".
  //
  //   game id 26  = Doom (1993)        https://www.moddb.com/games/doom
  //   game id 172 = Doom II            https://www.moddb.com/games/doom-ii
  //
  // Many popular mods (e.g. Legend of Doom) are catalogued under Doom II
  // only on moddb. Filtering to game=26 alone silently dropped ~half the
  // catalog. Add Doom 3 / Final Doom / etc. by extending this table.
  const MODDB_BASE = 'https://www.moddb.com';
  const MODDB_GAMES = [
    { id: 26, slug: 'doom', name: 'Doom' },
    { id: 172, slug: 'doom-ii', name: 'Doom II' }
  ];
  const ALLOWED_GAME_SLUGS = new Set(MODDB_GAMES.map((g) => g.slug));
  // Back-compat: a single "primary" game id for callers that still want one.
  const MODDB_GAME_ID = MODDB_GAMES[0].id;
  const MODDB_LISTING_URL = MODDB_BASE + '/mods';

  // Hard-stop for download size — anything bigger requires user confirm.
  // Big mods (Brutal Doom etc.) work but cold-load is brutal on mobile.
  const SIZE_WARN_BYTES = 100 * 1024 * 1024;
  const SIZE_HARD_CAP_BYTES = 250 * 1024 * 1024;

  // localStorage key prefix for the listing cache.
  const CACHE_KEY = 'heyming.uzdoomModdb.v1';
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

  // UZDoom-loadable file extensions (matches doom/index.html's #modPicker).
  const PLAYABLE_EXTS = /\.(wad|pk3|ipk3|pk7|deh|bex)$/i;

  // Selectors. EVERY selector goes here so DOM drift is a one-line patch.
  const SELECTORS = {
    // Listing page (https://www.moddb.com/mods?game=26&page=N).
    listingRow: '.rowcontent, .row.rowcontent, .normalrow',
    listingTitleLink: 'a[href*="/mods/"]',
    listingThumb: 'img',
    listingSummary: '.summary, p',
    listingPagination: '.pagination a',
    // Per-row game classification link, e.g.
    //   <a href="/games/doom-ii" title="Doom II"><img src=".../icon.gif"></a>
    // Used to client-side filter results when moddb returns a global
    // keyword search (kw= ignores game= on moddb).
    listingGameLink: 'a[href^="/games/"]',
    // Mod page (https://www.moddb.com/mods/<slug>).
    modSummary: '#profiledescription, .summary',
    modScreenshot: '.imagebox img, .row img',
    modDownloadsLink: 'a[href*="/downloads"]',
    // Downloads list (https://www.moddb.com/mods/<slug>/downloads).
    downloadRow: '.rowcontent, .row.rowcontent, .normalrow',
    downloadLink: 'a[href*="/downloads/"]',
    downloadTitle: 'a[href*="/downloads/"]',
    // Download page (https://www.moddb.com/downloads/<slug-version>).
    mirrorLink: 'a.mirror, a[href*="/start/"], a.button[href*="cdn"]',
    downloadFilename: '.filename, .row .summary',
    downloadSizeText: '.size'
  };

  const NORMALROW_SELECTOR = SELECTORS.listingRow;

  // ---- Parsers (pure functions, used by tests) ---------------------------

  /**
   * Parse a moddb listing page (HTML string) into mod cards.
   * @param {string} html
   * @param {string} [baseUrl] resolves relative hrefs; defaults to MODDB_BASE
   * @returns {{ mods: ModCard[], pagination: { current: number, last: number } }}
   */
  function parseListing(html, baseUrl) {
    const base = baseUrl || MODDB_BASE;
    const doc = parseHtml(html);
    const mods = [];
    const seen = new Set();

    const rows = doc.querySelectorAll(NORMALROW_SELECTOR);
    rows.forEach((row) => {
      // Pick the first link inside the row that looks like a /mods/<slug> URL
      // (and NOT a pagination/sort link).
      const links = row.querySelectorAll(SELECTORS.listingTitleLink);
      let modLink = null;
      for (const a of links) {
        const href = a.getAttribute('href') || '';
        if (looksLikeModSlug(href) && a.textContent && a.textContent.trim().length > 1) {
          modLink = a;
          break;
        }
      }
      if (!modLink) return;

      const href = absolutize(modLink.getAttribute('href') || '', base);
      const slug = extractModSlug(href);
      if (!slug || seen.has(slug)) return;
      seen.add(slug);

      const title = (modLink.textContent || '').trim();
      const thumbEl = row.querySelector(SELECTORS.listingThumb);
      const thumbUrl = thumbEl
        ? absolutize(thumbEl.getAttribute('src') || '', base)
        : '';
      const summaryEl = row.querySelector(SELECTORS.listingSummary);
      const summary = summaryEl
        ? (summaryEl.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 320)
        : '';

      // Per-row game classification. Skip nav-style /games/<slug> links
      // (add, latest, top) — those are global moddb pages, not games.
      let gameSlug = null;
      let gameTitle = null;
      const gameLinks = row.querySelectorAll(SELECTORS.listingGameLink);
      for (const a of gameLinks) {
        const ghref = a.getAttribute('href') || '';
        const m = ghref.match(/^\/games\/([a-z0-9-]+)\/?$/i);
        if (!m) continue;
        const gslug = m[1].toLowerCase();
        if (GAME_LINK_BLACKLIST.has(gslug)) continue;
        gameSlug = gslug;
        gameTitle = (a.getAttribute('title') || a.textContent || '').trim() || null;
        break;
      }

      mods.push({ slug, title, url: href, thumbUrl, summary, gameSlug, gameTitle });
    });

    // Pagination — best-effort. moddb uses ?page=N and a pagination block.
    const pagination = parsePagination(doc, baseUrl);

    return { mods, pagination };
  }

  /**
   * Parse a mod profile page into metadata + a downloads-tab URL.
   * @param {string} html
   * @param {string} baseUrl the mod's URL
   * @returns {{ title: string, summary: string, screenshots: string[], downloadsUrl: string|null }}
   */
  function parseModPage(html, baseUrl) {
    const doc = parseHtml(html);
    const titleEl = doc.querySelector('h1, .title');
    const title = titleEl ? (titleEl.textContent || '').trim() : '';

    const summaryEl = doc.querySelector(SELECTORS.modSummary);
    const summary = summaryEl
      ? (summaryEl.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 1200)
      : '';

    const screenshots = [];
    doc.querySelectorAll(SELECTORS.modScreenshot).forEach((img) => {
      const src = img.getAttribute('src');
      if (src) screenshots.push(absolutize(src, baseUrl));
    });

    let downloadsUrl = null;
    const dlLinks = doc.querySelectorAll(SELECTORS.modDownloadsLink);
    for (const a of dlLinks) {
      const href = a.getAttribute('href') || '';
      // Match the mod's own /downloads tab, not /downloads/<file-id>.
      if (/\/mods\/[^/]+\/downloads\/?$/.test(href)) {
        downloadsUrl = absolutize(href, baseUrl);
        break;
      }
    }
    // Fallback: derive from the slug.
    if (!downloadsUrl) {
      const slug = extractModSlug(baseUrl);
      if (slug) {
        downloadsUrl = MODDB_BASE + '/mods/' + slug + '/downloads';
      }
    }

    return { title, summary, screenshots: screenshots.slice(0, 6), downloadsUrl };
  }

  // moddb has /games/<slug> links that aren't actual games but global nav
  // (the same pattern as DOWNLOAD_NAV_BLACKLIST below). Skip these when
  // detecting a row's game classification.
  const GAME_LINK_BLACKLIST = new Set([
    'add',
    'latest',
    'top',
    'popular',
    'new',
    'recent',
    'featured',
    'browse'
  ]);

  // Sidebar / nav paths that look like /downloads/<slug> but are actually
  // global moddb pages (sortable indexes), NOT individual mod releases.
  // Hit by the flat-scan if not blacklisted; one of these (`/downloads/top`)
  // was the bug that surfaced as "downloaded the wrong file" in v1.
  const DOWNLOAD_NAV_BLACKLIST = new Set([
    'top',
    'popular',
    'new',
    'recent',
    'featured',
    'hot',
    'all',
    'browse',
    'rss',
    'live',
    'rated'
  ]);

  /**
   * Parse a downloads-list page into individual download entries.
   *
   * Real moddb release URLs follow the pattern
   *   /mods/<mod-slug>/downloads/<release-slug>
   * (NOT /downloads/<release-slug> — that form only exists for global
   * navigation pages like /downloads/top.) v1 of this parser only matched
   * the bare /downloads/<slug> form, which silently dropped EVERY real
   * release on real pages and surfaced as "No downloads found".
   *
   * Strategy: flat-scan ALL anchors whose path matches either form. Real
   * moddb markup wraps releases in many different containers (.row,
   * <table><tr>, raw <div>) so we don't depend on row selectors; we use
   * the link itself plus its closest enclosing row for category text.
   *
   * Filters applied (in order):
   *   1. Path must match one of the two release URL patterns.
   *   2. For the bare /downloads/<slug> form, slug must NOT be a sidebar
   *      nav (DOWNLOAD_NAV_BLACKLIST) — these are global moddb indexes,
   *      not actual mod releases.
   *   3. If we can extract the mod slug from baseUrl, the release path
   *      MUST belong to that mod. Cross-mod sidebar links get rejected.
   *
   * @param {string} html
   * @param {string} baseUrl
   * @returns {DownloadEntry[]}
   */
  function parseDownloadsList(html, baseUrl) {
    const doc = parseHtml(html);
    const out = [];
    const seen = new Set();

    // Mod slug we're listing for, e.g. "brutal-doom" from
    // /mods/brutal-doom/downloads. Used for cross-mod link rejection.
    const baseModSlug = (extractModSlug(baseUrl || '') || '').toLowerCase();

    const allLinks = doc.querySelectorAll('a[href*="/downloads/"]');
    allLinks.forEach((link) => {
      const href = link.getAttribute('href') || '';
      const path = stripHost(href);

      // Try the canonical form first: /mods/<mod-slug>/downloads/<release-slug>.
      // Fall back to the bare /downloads/<release-slug> form for legacy
      // markup and synthetic test fixtures.
      let dlSlug = null;
      let linkModSlug = null;
      const modScopedMatch = path.match(
        /^\/?mods\/([a-z0-9-]+)\/downloads\/([^/?#]+)\/?(?:[?#]|$)/i
      );
      if (modScopedMatch) {
        linkModSlug = modScopedMatch[1].toLowerCase();
        dlSlug = modScopedMatch[2].toLowerCase();
      } else {
        const flatMatch = path.match(/^\/?downloads\/([^/?#]+)\/?(?:[?#]|$)/);
        if (!flatMatch) return;
        dlSlug = flatMatch[1].toLowerCase();
        // Only the flat form can be a sidebar nav slug.
        if (DOWNLOAD_NAV_BLACKLIST.has(dlSlug)) return;
      }

      // Cross-mod rejection. For mod-scoped links the comparison is
      // exact; for flat links we fall back to substring match (legacy
      // form often embeds the mod slug in the release slug).
      if (baseModSlug) {
        if (linkModSlug) {
          if (linkModSlug !== baseModSlug) return;
        } else if (dlSlug.indexOf(baseModSlug) < 0) {
          return;
        }
      }

      const url = absolutize(href, baseUrl);
      if (seen.has(url)) return;
      seen.add(url);

      // Title fallback chain: title attr → link text → nested img
      // alt/title → slug. Real moddb release links are <a class="image">
      // wrapping a thumbnail, with no text content but a descriptive
      // title="..." attribute — try that first.
      let title = (link.getAttribute('title') || '').trim();
      if (title.length < 3) title = (link.textContent || '').trim();
      if (title.length < 3) {
        const img = link.querySelector('img');
        if (img) {
          title =
            (img.getAttribute('alt') || img.getAttribute('title') || '').trim();
        }
      }
      if (title.length < 3) {
        title = dlSlug.replace(/-/g, ' ');
      }

      const row =
        link.closest('tr, .rowcontent, .row, .normalrow') ||
        link.parentElement ||
        link;
      const rowText = (row.textContent || '').toLowerCase();
      // Real moddb pages put the category ("Demo", "Full Version",
      // "Patch", "Addon", "Trailer") in a <span class="subheading">
      // inside the row. Use that for high-confidence classification.
      const subheading = (
        (row.querySelector && row.querySelector('.subheading')) || { textContent: '' }
      ).textContent || '';

      const tagText = (subheading + ' ' + rowText + ' ' + dlSlug).toLowerCase();
      const isFull = /full version|full release|-full-?(version|release)?/.test(tagText);
      const isPatch = /\bpatch\b|-patch-?/.test(tagText) && !isFull;
      const isDemo = /\bdemo\b|-demo-?/.test(tagText);
      const versionMatch = (title + ' ' + dlSlug).match(/v?(\d+(?:\.\d+){0,3})/i);
      const ext = ((title + ' ' + rowText).match(
        /\b(zip|rar|7z|pk3|wad|pk7|ipk3)\b/i
      ) || [, ''])[1];

      out.push({
        title,
        url,
        slug: dlSlug,
        version: versionMatch ? versionMatch[1] : null,
        ext: ext.toLowerCase(),
        isFull,
        isPatch,
        isDemo,
        rawText: rowText.slice(0, 240)
      });
    });

    return out;
  }

  /**
   * From a list of download entries, pick the most likely "main release"
   * to download. Preference order:
   *   1. Full versions over patches/demos.
   *   2. .zip over other archive formats (we can extract zip natively).
   *   3. Highest version number.
   *   4. First seen.
   * @param {DownloadEntry[]} entries
   * @returns {DownloadEntry|null}
   */
  function pickBestDownload(entries) {
    if (!entries || entries.length === 0) return null;
    const ranked = entries.slice().sort((a, b) => {
      const fullA = a.isFull && !a.isPatch && !a.isDemo;
      const fullB = b.isFull && !b.isPatch && !b.isDemo;
      if (fullA !== fullB) return fullA ? -1 : 1;

      const zipA = a.ext === 'zip' || a.ext === 'pk3' || a.ext === 'wad';
      const zipB = b.ext === 'zip' || b.ext === 'pk3' || b.ext === 'wad';
      if (zipA !== zipB) return zipA ? -1 : 1;

      const va = parseVersion(a.version);
      const vb = parseVersion(b.version);
      return vb - va;
    });
    return ranked[0];
  }

  /**
   * Parse a download page into a list of mirror URLs.
   * @param {string} html
   * @param {string} baseUrl
   * @returns {{ mirrors: { name: string, url: string }[], filename: string|null, sizeBytes: number|null }}
   */
  function parseDownloadPage(html, baseUrl) {
    const doc = parseHtml(html);
    const mirrors = [];
    const seen = new Set();

    doc.querySelectorAll(SELECTORS.mirrorLink).forEach((a) => {
      const href = a.getAttribute('href') || '';
      if (!href) return;
      const url = absolutize(href, baseUrl);
      if (seen.has(url)) return;
      seen.add(url);
      const name = (a.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80) || 'mirror';
      mirrors.push({ name, url });
    });

    // Filename hint — usually shown in a sidebar.
    let filename = null;
    const filenameEl = doc.querySelector(SELECTORS.downloadFilename);
    if (filenameEl) {
      const txt = (filenameEl.textContent || '').trim();
      const m = txt.match(/[A-Za-z0-9._-]+\.(zip|rar|7z|pk3|wad|pk7|ipk3)\b/i);
      if (m) filename = m[0];
    }

    // Size hint, e.g. "12.4 mb" or "8 MB".
    let sizeBytes = null;
    const sizeEl = doc.querySelector(SELECTORS.downloadSizeText);
    if (sizeEl) sizeBytes = parseSizeText(sizeEl.textContent || '');
    if (sizeBytes == null) {
      const m = (doc.body ? doc.body.textContent || '' : '').match(
        /(\d+(?:\.\d+)?)\s*(kb|mb|gb)\b/i
      );
      if (m) sizeBytes = parseSizeText(m[0]);
    }

    return { mirrors, filename, sizeBytes };
  }

  /**
   * Detect Cloudflare's interstitial. moddb's CDN sometimes serves a
   * "Just a moment…" challenge page that no static-site client can solve.
   */
  function isCloudflareBlocked(text) {
    if (!text || typeof text !== 'string') return false;
    return (
      /Just a moment/i.test(text) ||
      /Checking your browser/i.test(text) ||
      /cf-browser-verification/i.test(text)
    );
  }

  // ---- Helpers (pure) ----------------------------------------------------

  function parseHtml(html) {
    return new DOMParser().parseFromString(html || '', 'text/html');
  }

  function looksLikeModSlug(href) {
    const path = stripHost(href);
    return /^\/?(mods)\/[a-z0-9-]+\/?$/i.test(path);
  }

  function extractModSlug(href) {
    const path = stripHost(href);
    const m = path.match(/\/mods\/([a-z0-9-]+)/i);
    return m ? m[1] : null;
  }

  function stripHost(href) {
    if (!href) return '';
    try {
      const u = new URL(href, MODDB_BASE);
      return u.pathname + u.search;
    } catch (_) {
      return href;
    }
  }

  function absolutize(href, base) {
    if (!href) return '';
    try {
      return new URL(href, base || MODDB_BASE).toString();
    } catch (_) {
      return href;
    }
  }

  function parseVersion(v) {
    if (!v) return 0;
    const parts = String(v)
      .split('.')
      .map((p) => parseInt(p, 10))
      .filter((n) => Number.isFinite(n));
    let acc = 0;
    for (let i = 0; i < parts.length && i < 4; i++) {
      acc = acc * 1000 + parts[i];
    }
    return acc;
  }

  function parseSizeText(s) {
    if (!s) return null;
    const m = s.match(/(\d+(?:\.\d+)?)\s*(kb|mb|gb)/i);
    if (!m) return null;
    const n = parseFloat(m[1]);
    const unit = m[2].toLowerCase();
    if (unit === 'gb') return Math.round(n * 1024 * 1024 * 1024);
    if (unit === 'mb') return Math.round(n * 1024 * 1024);
    if (unit === 'kb') return Math.round(n * 1024);
    return null;
  }

  function parsePagination(doc, _base) {
    let current = 1;
    let last = 1;
    const links = doc.querySelectorAll(SELECTORS.listingPagination);
    links.forEach((a) => {
      const href = a.getAttribute('href') || '';
      const m = href.match(/[?&]page=(\d+)/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > last) last = n;
      }
      if (a.classList && a.classList.contains('current')) {
        const n = parseInt((a.textContent || '').trim(), 10);
        if (Number.isFinite(n)) current = n;
      }
    });
    return { current, last };
  }

  function formatBytes(n) {
    if (!Number.isFinite(n)) return '?';
    if (n >= 1073741824) return (n / 1073741824).toFixed(2) + ' GB';
    if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
    if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
    return n + ' B';
  }

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
      localStorage.setItem(
        CACHE_KEY + ':' + key,
        JSON.stringify({ t: Date.now(), v: value })
      );
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
    const filtered = result.mods.filter(
      (m) => !m.gameSlug || ALLOWED_GAME_SLUGS.has(m.gameSlug)
    );
    return { mods: filtered, pagination: result.pagination };
  }

  async function fetchMultiGameListing(opts) {
    // One request per game id, in parallel. Settled (not all) so a single
    // proxy/Cloudflare blip doesn't kill the whole page.
    const settled = await Promise.allSettled(
      MODDB_GAMES.map((g) => fetchSingleListing({ ...opts, gameId: g.id }))
    );

    const successes = settled
      .filter((s) => s.status === 'fulfilled')
      .map((s) => s.value);
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
    const url = looksLikeUrl(slugOrUrl)
      ? slugOrUrl
      : MODDB_BASE + '/mods/' + slugOrUrl;
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
        'Mod ships as .' + best.ext + ' which we cannot extract in-browser. ' +
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
        'Download is ' + formatBytes(resolved.sizeBytes) +
          ' which exceeds the ' + formatBytes(SIZE_HARD_CAP_BYTES) + ' cap. Pass allowOversize:true to override.'
      );
    }

    const buf = await window.proxyService.fetchBinaryWithProxy(resolved.mirrorUrl, {
      skipDirect: true,
      headers: { Accept: 'application/octet-stream,*/*' },
      timeout: 90000,
      maxRetries: 2
    });

    // Heuristic: starts with "PK\x03\x04" → zip. Otherwise treat as raw asset.
    const isZip = buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
    if (isZip) {
      if (!window.UZDoomModdbArchive || !window.UZDoomModdbArchive.extractZip) {
        throw new Error('archive helper missing');
      }
      const entries = await window.UZDoomModdbArchive.extractZip(buf, {
        filter: (name) => PLAYABLE_EXTS.test(name)
      });
      if (entries.length === 0) {
        throw new Error('No playable .pk3/.wad files found inside the archive');
      }
      return entries;
    }

    // Raw .pk3/.wad/.pk7 — derive filename from the resolved download.
    const filename =
      (resolved.filename && resolved.filename) ||
      ('moddb-' + (resolved.ext || 'pk3'));
    return [{ name: filename, data: buf }];
  }

  // ---- UI ---------------------------------------------------------------

  let panelEl = null;
  let listingState = {
    page: 1,
    sort: 'visitstotal-desc',
    kw: ''
  };

  function ensurePanel() {
    if (panelEl) return panelEl;
    panelEl = document.getElementById('moddbBrowser');
    if (!panelEl) {
      panelEl = document.createElement('div');
      panelEl.id = 'moddbBrowser';
      panelEl.className = 'moddb-panel hidden';
      document.body.appendChild(panelEl);
    }
    renderShell();
    return panelEl;
  }

  function renderShell() {
    panelEl.innerHTML =
      '<div class="moddb-header">' +
        '<div class="moddb-title">' +
          '<span class="moddb-emoji">🛒</span>' +
          '<h2>Browse Doom mods on moddb.com</h2>' +
        '</div>' +
        '<button type="button" class="moddb-close" data-role="close" aria-label="Close">×</button>' +
      '</div>' +
      '<div class="moddb-disclaimer">' +
        'Mods are streamed through a public CORS proxy directly from moddb. ' +
        'Some mods will fail (Cloudflare, dead mirrors, oversize, .rar/.7z, ' +
        'engine incompatibility). Most GZDoom-family mods work; multiplayer ' +
        '(Zandronum) and prboom+ mods may not. Saves and IWAD downloads ' +
        'persist in this browser.' +
      '</div>' +
      '<form class="moddb-search" data-role="search">' +
        '<input type="search" name="kw" placeholder="Search Doom mods…" data-role="kw" />' +
        '<select name="sort" data-role="sort">' +
          '<option value="visitstotal-desc">Most popular</option>' +
          '<option value="ratingscore-desc">Highest rated</option>' +
          '<option value="dateup-desc">Recently updated</option>' +
          '<option value="released-desc">Recently released</option>' +
          '<option value="name-asc">Name (A→Z)</option>' +
        '</select>' +
        '<button type="submit" class="btn primary">Search</button>' +
      '</form>' +
      '<div class="moddb-status" data-role="status">Loading mod listing…</div>' +
      '<div class="moddb-grid" data-role="grid"></div>' +
      '<div class="moddb-pagination" data-role="pagination"></div>' +
      '<div class="moddb-detail hidden" data-role="detail"></div>';

    panelEl.querySelector('[data-role="close"]').addEventListener('click', close);
    panelEl.querySelector('[data-role="search"]').addEventListener('submit', (e) => {
      e.preventDefault();
      listingState.kw = panelEl.querySelector('[data-role="kw"]').value.trim();
      listingState.sort = panelEl.querySelector('[data-role="sort"]').value;
      listingState.page = 1;
      loadAndRenderListing();
    });
  }

  function setStatus(msg, kind) {
    const el = panelEl && panelEl.querySelector('[data-role="status"]');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'moddb-status' + (kind ? ' ' + kind : '');
  }

  async function loadAndRenderListing() {
    setStatus('Loading mod listing from moddb…');
    const grid = panelEl.querySelector('[data-role="grid"]');
    grid.innerHTML = '';
    panelEl.querySelector('[data-role="pagination"]').innerHTML = '';

    try {
      const result = await fetchListing(listingState);
      renderGrid(result.mods);
      renderPagination(result.pagination);
      setStatus(
        result.mods.length === 0
          ? 'No mods found. Try a different search.'
          : 'Showing ' + result.mods.length + ' mod(s).'
      );
    } catch (e) {
      console.warn('[moddb] listing failed:', e);
      setStatus(
        'Could not load mod listing: ' + (e.message || e) +
          ' — public CORS proxies are flaky; try again in a minute.',
        'err'
      );
    }
  }

  function renderGrid(mods) {
    const grid = panelEl.querySelector('[data-role="grid"]');
    grid.innerHTML = '';
    mods.forEach((mod) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'moddb-card';
      card.dataset.slug = mod.slug;
      const game = MODDB_GAMES.find((g) => g.slug === mod.gameSlug);
      const badge = game
        ? '<span class="moddb-card-game" title="moddb game: ' +
          escapeAttr(game.name) +
          '">' +
          escapeHtml(game.name) +
          '</span>'
        : '';
      card.innerHTML =
        (mod.thumbUrl
          ? '<img class="moddb-card-thumb" loading="lazy" alt="" src="' + escapeAttr(mod.thumbUrl) + '" />'
          : '<div class="moddb-card-thumb placeholder">🎮</div>') +
        '<div class="moddb-card-body">' +
          '<div class="moddb-card-title">' + escapeHtml(mod.title) + badge + '</div>' +
          '<div class="moddb-card-summary">' + escapeHtml(mod.summary || '') + '</div>' +
        '</div>';
      card.addEventListener('click', () => openModDetail(mod));
      grid.appendChild(card);
    });
  }

  function renderPagination(p) {
    const el = panelEl.querySelector('[data-role="pagination"]');
    el.innerHTML = '';
    if (!p || p.last <= 1) return;
    const cur = listingState.page;

    const prev = document.createElement('button');
    prev.type = 'button';
    prev.textContent = '← Prev';
    prev.disabled = cur <= 1;
    prev.addEventListener('click', () => {
      listingState.page = Math.max(1, cur - 1);
      loadAndRenderListing();
    });
    el.appendChild(prev);

    const label = document.createElement('span');
    label.className = 'moddb-page-label';
    label.textContent = 'Page ' + cur + ' / ' + Math.max(p.last, cur);
    el.appendChild(label);

    const next = document.createElement('button');
    next.type = 'button';
    next.textContent = 'Next →';
    next.disabled = cur >= p.last;
    next.addEventListener('click', () => {
      listingState.page = cur + 1;
      loadAndRenderListing();
    });
    el.appendChild(next);
  }

  function openModDetail(mod) {
    const detail = panelEl.querySelector('[data-role="detail"]');
    detail.classList.remove('hidden');
    detail.innerHTML =
      '<div class="moddb-detail-header">' +
        '<button type="button" class="moddb-back" data-role="back">← Back to listing</button>' +
        '<a href="' + escapeAttr(mod.url) + '" target="_blank" rel="noopener" class="moddb-extlink">Open on moddb.com →</a>' +
      '</div>' +
      '<h3>' + escapeHtml(mod.title) + '</h3>' +
      '<div class="moddb-detail-status" data-role="detail-status">Loading mod details…</div>' +
      '<div class="moddb-detail-body" data-role="detail-body"></div>';
    detail.querySelector('[data-role="back"]').addEventListener('click', () => {
      detail.classList.add('hidden');
      detail.innerHTML = '';
    });
    panelEl.querySelector('[data-role="grid"]').classList.add('dimmed');

    fetchModInfo(mod.url).then(
      (info) => renderModDetail(mod, info),
      (e) => {
        const ds = detail.querySelector('[data-role="detail-status"]');
        if (ds) {
          ds.className = 'moddb-detail-status err';
          ds.textContent = 'Could not load mod page: ' + (e.message || e);
        }
      }
    );
  }

  function renderModDetail(mod, info) {
    const detail = panelEl.querySelector('[data-role="detail"]');
    const status = detail.querySelector('[data-role="detail-status"]');
    const body = detail.querySelector('[data-role="detail-body"]');
    status.textContent = '';
    status.className = 'moddb-detail-status';

    const iwadHint = guessIwadHint(info.summary);

    body.innerHTML =
      (info.screenshots.length > 0
        ? '<div class="moddb-shots">' +
          info.screenshots
            .slice(0, 4)
            .map((src) => '<img src="' + escapeAttr(src) + '" alt="" loading="lazy" />')
            .join('') +
          '</div>'
        : '') +
      '<p class="moddb-summary">' + escapeHtml(info.summary || mod.summary || '') + '</p>' +
      '<fieldset class="moddb-iwad">' +
        '<legend>IWAD</legend>' +
        '<label><input type="radio" name="iwad" value="freedoom1" checked /> Freedoom Phase 1 (bundled, free)</label>' +
        '<label><input type="radio" name="iwad" value="doom" /> Classic Doom (doom.wad, side-loaded)</label>' +
        '<label><input type="radio" name="iwad" value="doom2" /> Doom II (doom2.wad, side-loaded)</label>' +
        (iwadHint
          ? '<div class="moddb-iwad-hint">Hint from description: <em>' + escapeHtml(iwadHint) + '</em></div>'
          : '') +
      '</fieldset>' +
      '<div class="moddb-launch-row">' +
        '<button type="button" class="btn primary moddb-launch" data-role="launch">' +
          'Fetch & launch' +
        '</button>' +
        '<span class="moddb-launch-note" data-role="launch-note">' +
          'Mods are streamed via free CORS proxies — expect occasional failures.' +
        '</span>' +
      '</div>';

    body.querySelector('[data-role="launch"]').addEventListener('click', () => {
      const iwad = body.querySelector('input[name="iwad"]:checked').value;
      runFullLaunchFlow(mod, info, iwad).catch((e) => {
        console.warn('[moddb] launch failed:', e);
      });
    });
  }

  function guessIwadHint(summary) {
    if (!summary) return null;
    const s = summary.toLowerCase();
    if (/(doom\s*ii|doom2\.wad|doom 2)/i.test(s)) return 'looks like it expects doom2.wad';
    if (/(doom\s*1|the ultimate doom|knee-deep|doom\.wad)/i.test(s)) return 'looks like it expects doom.wad';
    if (/freedoom/.test(s)) return 'mentions Freedoom — bundled IWAD should work';
    return null;
  }

  async function runFullLaunchFlow(mod, info, iwadChoice) {
    const detailStatus = panelEl.querySelector('[data-role="detail-status"]');
    detailStatus.className = 'moddb-detail-status';
    const setDetailStatus = (msg, kind) => {
      detailStatus.className = 'moddb-detail-status' + (kind ? ' ' + kind : '');
      detailStatus.textContent = msg || '';
    };

    if (!window.UZDoomLoader) {
      setDetailStatus('Engine not ready yet. Wait a few seconds and try again.', 'err');
      return;
    }
    if (!window.UZDoomModdbIwad) {
      setDetailStatus('IWAD helper missing.', 'err');
      return;
    }

    try {
      setDetailStatus('Resolving download from moddb…');
      const resolved = await resolveDownloadUrl(info);

      if (resolved.sizeBytes && resolved.sizeBytes > SIZE_WARN_BYTES) {
        const ok = window.confirm(
          'This mod is ' + formatBytes(resolved.sizeBytes) +
            '. Continue? (Mobile devices may run out of memory.)'
        );
        if (!ok) {
          setDetailStatus('Cancelled.', '');
          return;
        }
      }

      setDetailStatus('Fetching IWAD…');
      const iwad = await window.UZDoomModdbIwad.resolve(iwadChoice, (msg) => {
        setDetailStatus('IWAD: ' + msg);
      });

      setDetailStatus(
        resolved.sizeBytes
          ? 'Downloading mod (' + formatBytes(resolved.sizeBytes) + ')…'
          : 'Downloading mod…'
      );
      const mods = await downloadAndExtract(resolved, {
        allowOversize: resolved.sizeBytes > SIZE_HARD_CAP_BYTES
      });

      setDetailStatus('Priming engine with ' + mods.length + ' file(s)…');
      await window.UZDoomLoader.primeWith({ iwad, mods });

      setDetailStatus('Launching…');
      // Hide the panel first so the engine reveal/melt can take over.
      close();
      window.UZDoomLoader.launch();
    } catch (e) {
      console.warn('[moddb] launch failed:', e);
      setDetailStatus(
        'Failed: ' + (e.message || e) +
          ' — try the manual upload picker (?manual=1) and grab the .pk3 from moddb.com directly.',
        'err'
      );
    }
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  function escapeAttr(s) {
    return escapeHtml(s);
  }

  // ---- Public API --------------------------------------------------------

  function open() {
    ensurePanel();
    panelEl.classList.remove('hidden');
    document.body.classList.add('moddb-open');
    if (!panelEl.dataset.loaded) {
      panelEl.dataset.loaded = '1';
      loadAndRenderListing();
    }
  }
  function close() {
    if (!panelEl) return;
    panelEl.classList.add('hidden');
    document.body.classList.remove('moddb-open');
    const detail = panelEl.querySelector('[data-role="detail"]');
    if (detail) {
      detail.classList.add('hidden');
      detail.innerHTML = '';
    }
    const grid = panelEl.querySelector('[data-role="grid"]');
    if (grid) grid.classList.remove('dimmed');
  }

  window.UZDoomModdb = {
    open,
    close,
    parsers: {
      parseListing,
      parseModPage,
      parseDownloadsList,
      parseDownloadPage,
      pickBestDownload,
      isCloudflareBlocked
    },
    fetchListing,
    fetchModInfo,
    resolveDownloadUrl,
    downloadAndExtract,
    _internal: {
      buildListingUrl,
      parseSizeText,
      parseVersion,
      formatBytes,
      extractModSlug,
      absolutize,
      MODDB_GAMES,
      ALLOWED_GAME_SLUGS
    }
  };

  // Auto-open on ?manual=browse so users can land directly on the panel,
  // and bind the in-page "Browse moddb" button (manual mode instructions
  // panel) so users without the URL trick can also reach the browser.
  function wireEntryPoints() {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('manual') === 'browse') open();
    } catch (_) {
      /* no location (jsdom test env) */
    }
    const btn = document.getElementById('openModdbBrowserBtn');
    if (btn) {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        open();
      });
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireEntryPoints, { once: true });
  } else {
    wireEntryPoints();
  }
})();

/**
 * @typedef {{
 *   slug: string, title: string, url: string, thumbUrl: string, summary: string,
 *   gameSlug: string|null, gameTitle: string|null
 * }} ModCard
 */
/**
 * @typedef {{
 *   title: string, url: string, version: string|null, ext: string,
 *   isFull: boolean, isPatch: boolean, isDemo: boolean, rawText: string
 * }} DownloadEntry
 */

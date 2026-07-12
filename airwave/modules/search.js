/**
 * Unauthenticated YouTube search.
 *
 * No API key, no backend. Three providers tried in order, with the
 * winner cached for the rest of the session so we don't keep probing
 * dead ones on every keystroke:
 *
 *   1. **Scrape `youtube.com/results?search_query=...`** through `proxy.js`
 *      and pull `ytInitialData` out of the HTML (desktop object literal or
 *      mobile hex-escaped string — CORS proxies often forward the phone UA).
 *      Most reliable single source — YouTube itself doesn't go down. Fragile
 *      only when YouTube changes the JSON shape (~2–3x/year, fix-forward).
 *   2. **Invidious** public instance allowlist (`/api/v1/search?q=...`).
 *      Cleanest JSON when an instance is up; instances churn weekly.
 *   3. **Piped** public instance allowlist (`/search?q=...&filter=videos`).
 *
 * If all three fail in a session the caller's UX falls back to "paste
 * a URL" — the search box still works for direct YouTube URLs and IDs.
 *
 * The pure parser (`parseYouTubeSearchHtml`) lives at the top so unit
 * tests can pin it without touching the network.
 */

const INVIDIOUS_INSTANCES = [
  // Public Invidious instances (CORS-friendly, JSON API). Update as needed.
  'https://invidious.materialio.us',
  'https://yewtu.be',
  'https://invidious.privacyredirect.com',
  'https://invidious.nerdvpn.de'
];

const PIPED_API_INSTANCES = [
  // Public Piped API instances. These are the *API* hosts (pipedapi.*),
  // not the user-facing frontends.
  'https://pipedapi.kavin.rocks',
  'https://api-piped.mha.fi',
  'https://pipedapi.adminforge.de'
];

const PROVIDER_KEY = 'heyming.airwave.searchProvider.v1';

let cachedWinner = null;
try {
  if (typeof localStorage !== 'undefined') {
    const raw = localStorage.getItem(PROVIDER_KEY);
    if (raw) cachedWinner = JSON.parse(raw);
  }
} catch {
  /* ignore quota / private mode */
}

function rememberWinner(provider) {
  cachedWinner = provider;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(PROVIDER_KEY, JSON.stringify(provider));
    }
  } catch {
    /* ignore */
  }
}

function forgetWinner() {
  cachedWinner = null;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(PROVIDER_KEY);
    }
  } catch {
    /* ignore */
  }
}

/**
 * Best-effort HH:MM:SS / M:SS parser. Returns seconds as a number, or
 * null when input is unrecognized.
 */
function parseDurationLabel(label) {
  if (typeof label !== 'string' || !label) return null;
  const parts = label
    .trim()
    .split(':')
    .map((p) => parseInt(p, 10));
  if (parts.some((n) => Number.isNaN(n))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return null;
}

/**
 * Normalize one video row from either desktop `videoRenderer` or mobile
 * `videoWithContextRenderer`. Returns null when the item isn't a video.
 *
 * @param {Record<string, unknown>} item
 * @returns {{id:string,title:string,author:string,thumbnail:string,duration:number|null}|null}
 */
function normalizeSearchItem(item) {
  if (!item || typeof item !== 'object') return null;

  // Desktop / tablet search cards.
  const desktop = /** @type {any} */ (item).videoRenderer;
  if (desktop?.videoId) {
    const title = desktop.title?.runs?.[0]?.text ?? desktop.title?.simpleText ?? '';
    const author =
      desktop.ownerText?.runs?.[0]?.text ?? desktop.longBylineText?.runs?.[0]?.text ?? '';
    const thumb = (desktop.thumbnail?.thumbnails || [])
      .slice()
      .sort((a, b) => (a.width || 0) - (b.width || 0))
      .pop();
    const duration = parseDurationLabel(
      desktop.lengthText?.simpleText ?? desktop.lengthText?.runs?.[0]?.text ?? null
    );
    return {
      id: desktop.videoId,
      title,
      author,
      thumbnail: thumb?.url || `https://i.ytimg.com/vi/${desktop.videoId}/hqdefault.jpg`,
      duration
    };
  }

  // Mobile search cards (UA-forwarding CORS proxies hit this path).
  const mobile = /** @type {any} */ (item).videoWithContextRenderer;
  if (mobile) {
    const id =
      (typeof mobile.videoId === 'string' && mobile.videoId) ||
      mobile.navigationEndpoint?.watchEndpoint?.videoId ||
      '';
    if (!id) return null;
    const title = mobile.headline?.runs?.[0]?.text ?? mobile.headline?.simpleText ?? '';
    const author =
      mobile.shortBylineText?.runs?.[0]?.text ?? mobile.longBylineText?.runs?.[0]?.text ?? '';
    const thumb = (mobile.thumbnail?.thumbnails || [])
      .slice()
      .sort((a, b) => (a.width || 0) - (b.width || 0))
      .pop();
    const duration = parseDurationLabel(
      mobile.lengthText?.simpleText ?? mobile.lengthText?.runs?.[0]?.text ?? null
    );
    return {
      id,
      title,
      author,
      thumbnail: thumb?.url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      duration
    };
  }

  return null;
}

/**
 * Collect the item-section arrays YouTube nests under either the desktop
 * two-column search layout or the mobile single-column layout.
 *
 * @param {any} ytInitialData
 * @returns {any[]}
 */
function collectSearchSections(ytInitialData) {
  const desktop =
    ytInitialData?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer
      ?.contents;
  if (Array.isArray(desktop) && desktop.length) return desktop;

  const mobile = ytInitialData?.contents?.sectionListRenderer?.contents;
  if (Array.isArray(mobile) && mobile.length) return mobile;

  return [];
}

/**
 * Parse YouTube's `ytInitialData` JSON (extracted from the search HTML)
 * and return a normalized list of video results.
 *
 * Desktop shape:
 *   contents.twoColumnSearchResultsRenderer.primaryContents
 *     .sectionListRenderer.contents[].itemSectionRenderer.contents[]
 *       videoRenderer
 *
 * Mobile shape (CORS proxies often forward the phone UA):
 *   contents.sectionListRenderer.contents[].itemSectionRenderer.contents[]
 *       videoWithContextRenderer
 *
 * Exported so unit tests can pin it against fixtures without HTTP.
 *
 * @param {any} ytInitialData
 * @returns {{id:string,title:string,author:string,thumbnail:string,duration:number|null}[]}
 */
export function parseYtInitialData(ytInitialData) {
  const out = [];
  const sections = collectSearchSections(ytInitialData);
  for (const section of sections) {
    const items = section?.itemSectionRenderer?.contents ?? [];
    for (const item of items) {
      const row = normalizeSearchItem(item);
      if (!row) continue;
      out.push(row);
      if (out.length >= 25) return out;
    }
  }
  return out;
}

/**
 * Decode a JavaScript single-quoted string literal body into its runtime
 * value, without executing it. Handles \xHH, \uHHHH, and common single-char
 * escapes. Same approach as youtube/modules/channel.js — mobile YouTube
 * ships ytInitialData as a hex-escaped string, not an object literal.
 *
 * @param {string} body
 */
function decodeJsStringLiteral(body) {
  return body.replace(
    /\\x([0-9a-fA-F]{2})|\\u([0-9a-fA-F]{4})|\\(.)/g,
    (_match, hex, unicode, ch) => {
      if (hex) return String.fromCharCode(parseInt(hex, 16));
      if (unicode) return String.fromCharCode(parseInt(unicode, 16));
      switch (ch) {
        case 'n':
          return '\n';
        case 't':
          return '\t';
        case 'r':
          return '\r';
        case 'b':
          return '\b';
        case 'f':
          return '\f';
        case '0':
          return '\0';
        case "'":
        case '"':
        case '\\':
        case '/':
          return ch;
        default:
          return ch;
      }
    }
  );
}

/**
 * Pull ytInitialData out of search HTML. YouTube ships three shapes
 * depending on the User-Agent the (proxied) request used:
 *
 *   1. Desktop object literal: `var ytInitialData = {...};`
 *   2. Bare assignment: `ytInitialData = {...};`
 *   3. Mobile hex-escaped string: `var ytInitialData = '\x7b\x22...';`
 *
 * @param {string} content
 * @returns {string | null} JSON text ready for JSON.parse, or null
 */
function extractYtInitialDataJson(content) {
  // Mobile string form — walk respecting `\\` escapes; a regex on a
  // ~400KB body backtracks badly (same rationale as channel.js).
  const mobileStart = content.search(/var\s+ytInitialData\s*=\s*'/);
  if (mobileStart >= 0) {
    const openIdx = content.indexOf("'", mobileStart);
    if (openIdx >= 0) {
      let i = openIdx + 1;
      while (i < content.length) {
        const c = content[i];
        if (c === '\\') {
          i += 2;
          continue;
        }
        if (c === "'") {
          return decodeJsStringLiteral(content.substring(openIdx + 1, i));
        }
        i++;
      }
    }
  }

  const objLit =
    content.match(/var\s+ytInitialData\s*=\s*(\{[\s\S]+?\});\s*<\/script>/) ||
    content.match(/var\s+ytInitialData\s*=\s*(\{[\s\S]+?\});/) ||
    content.match(/ytInitialData\s*=\s*(\{[\s\S]+?\});\s*<\/script>/) ||
    content.match(/ytInitialData\s*=\s*(\{[\s\S]+?\});/) ||
    content.match(/window\["ytInitialData"\]\s*=\s*(\{[\s\S]+?\});\s*<\/script>/);
  return objLit ? objLit[1] : null;
}

/**
 * Pull ytInitialData out of a YouTube search results HTML page, then hand
 * it to `parseYtInitialData`.
 *
 * Exported for tests.
 *
 * @param {string} html
 */
export function parseYouTubeSearchHtml(html) {
  if (typeof html !== 'string' || !html) return [];
  const jsonText = extractYtInitialDataJson(html);
  if (!jsonText) return [];
  try {
    return parseYtInitialData(JSON.parse(jsonText));
  } catch {
    return [];
  }
}

/* ── Provider implementations ──────────────────────────────────────── */

/**
 * Try a JSON instance endpoint directly first; on CORS/network failure
 * fall back through `proxyService`'s CORS-proxy chain. Public Invidious
 * and Piped instances flip CORS support on and off frequently, so the
 * proxy fallback turns "instance unreachable from this origin" into
 * "proxy still works".
 *
 * Single-pass (`maxRetries: 0`) — when public infrastructure is wide-
 * down we'd rather report failure to the user in seconds than burn
 * minutes on retries. The user can hit Search again to retry.
 */
/** Merge a caller abort with a per-attempt timeout (AbortSignal.any polyfill). */
function mergeAttemptSignal(userSignal, timeoutMs) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!userSignal) return timeoutSignal;
  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any([userSignal, timeoutSignal]);
  }
  const c = new AbortController();
  const bust = () => {
    try {
      c.abort();
    } catch {
      /* ignore */
    }
  };
  if (userSignal.aborted || timeoutSignal.aborted) {
    bust();
    return c.signal;
  }
  userSignal.addEventListener('abort', bust, { once: true });
  timeoutSignal.addEventListener('abort', bust, { once: true });
  return c.signal;
}

async function fetchInstanceJson(url, { signal, proxy, timeout = 6000 } = {}) {
  let directErr;
  try {
    const res = await fetch(url, {
      method: 'GET',
      mode: 'cors',
      signal: mergeAttemptSignal(signal, timeout)
    });
    if (res.ok) return await res.json();
    directErr = new Error(`${res.status}`);
  } catch (err) {
    // Per-attempt timeout is AbortError — only propagate caller aborts so
    // we still get a chance at the proxy fallback.
    if (err && err.name === 'AbortError' && signal && signal.aborted) throw err;
    directErr = err;
  }
  if (!proxy || typeof proxy.fetchJson !== 'function') {
    throw directErr || new Error('CORS blocked and no proxy available');
  }
  return proxy.fetchJson(url, {
    skipDirect: true,
    signal,
    timeout,
    maxRetries: 0
  });
}

async function searchViaYouTubeScrape(query, { proxy, signal } = {}) {
  if (!proxy || typeof proxy.fetchWithProxy !== 'function') {
    throw new Error('proxy required for YouTube scrape');
  }
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  // youtube.com blocks CORS, so skip the direct attempt — straight to
  // proxy. `validate` must require *parseable* results, not just the
  // `ytInitialData` token: consent / bot-check / truncated proxy bodies
  // often include the token but zero videos. Without a parse check we'd
  // cache the bad body and never try the next proxy. `maxRetries: 0`
  // keeps each search snappy when public CORS proxies are flaky.
  const html = await proxy.fetchWithProxy(url, {
    skipDirect: true,
    signal,
    timeout: 8000,
    maxRetries: 0,
    validate: (body) =>
      typeof body === 'string' &&
      body.includes('ytInitialData') &&
      parseYouTubeSearchHtml(body).length > 0
  });
  if (!html) throw new Error('empty response from YouTube');
  const results = parseYouTubeSearchHtml(html);
  if (!results.length) throw new Error('no parseable results in YouTube HTML');
  return results;
}

async function searchViaInvidious(query, instance, { signal, proxy } = {}) {
  const url = `${instance.replace(/\/$/, '')}/api/v1/search?q=${encodeURIComponent(
    query
  )}&type=video`;
  const data = await fetchInstanceJson(url, { signal, proxy, timeout: 8000 });
  if (!Array.isArray(data) || data.length === 0) throw new Error('invidious empty');
  return data
    .filter((row) => row && row.type === 'video' && row.videoId)
    .slice(0, 25)
    .map((row) => ({
      id: row.videoId,
      title: typeof row.title === 'string' ? row.title : '',
      author: typeof row.author === 'string' ? row.author : '',
      thumbnail:
        (row.videoThumbnails || [])
          .slice()
          .sort((a, b) => (a.width || 0) - (b.width || 0))
          .pop()?.url || `https://i.ytimg.com/vi/${row.videoId}/hqdefault.jpg`,
      duration: typeof row.lengthSeconds === 'number' ? row.lengthSeconds : null
    }));
}

async function searchViaPiped(query, instance, { signal, proxy } = {}) {
  const url = `${instance.replace(/\/$/, '')}/search?q=${encodeURIComponent(query)}&filter=videos`;
  const data = await fetchInstanceJson(url, { signal, proxy, timeout: 8000 });
  const items = Array.isArray(data?.items) ? data.items : [];
  if (items.length === 0) throw new Error('piped empty');
  return items
    .filter((row) => row && (row.type === 'stream' || row.url))
    .slice(0, 25)
    .map((row) => {
      // Piped uses URLs like "/watch?v=ID"; normalize to id.
      const id =
        (typeof row.url === 'string' && row.url.match(/[?&]v=([a-zA-Z0-9_-]{11})/)?.[1]) ||
        (typeof row.id === 'string' ? row.id : '');
      return {
        id,
        title: typeof row.title === 'string' ? row.title : '',
        author: typeof row.uploaderName === 'string' ? row.uploaderName : '',
        thumbnail:
          typeof row.thumbnail === 'string'
            ? row.thumbnail
            : id
            ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
            : '',
        duration: typeof row.duration === 'number' ? row.duration : null
      };
    })
    .filter((row) => row.id);
}

/* ── Public API ────────────────────────────────────────────────────── */

/**
 * Run the provider chain. Returns a normalized result list. Throws only
 * when every provider fails.
 *
 * @param {string} query
 * @param {{
 *   proxy?: any,                         // window.proxyService
 *   signal?: AbortSignal,
 *   onProvider?: (info: {provider:string,instance?:string}) => void
 * }} [opts]
 * @returns {Promise<{id:string,title:string,author:string,thumbnail:string,duration:number|null}[]>}
 */
export async function searchYouTube(query, opts = {}) {
  const q = typeof query === 'string' ? query.trim() : '';
  if (!q) return [];

  const seq = buildProviderSequence();
  const errors = [];

  // Overall budget: cap the entire search. Each provider already fails
  // fast (4–8s); the budget insures against a string of slow timeouts
  // when public infra is down. Mobile needs more headroom because CORS
  // proxies are slower over cellular / LAN and we may walk several hosts.
  const budgetMs = typeof opts.budgetMs === 'number' ? opts.budgetMs : 24000;
  const mergedSignal = mergeAttemptSignal(opts.signal, budgetMs);
  const innerOpts = { ...opts, signal: mergedSignal };

  for (const step of seq) {
    if (mergedSignal.aborted) break;
    try {
      let results;
      if (step.kind === 'youtube') {
        results = await searchViaYouTubeScrape(q, innerOpts);
      } else if (step.kind === 'invidious') {
        results = await searchViaInvidious(q, step.instance, innerOpts);
      } else if (step.kind === 'piped') {
        results = await searchViaPiped(q, step.instance, innerOpts);
      }
      if (results && results.length) {
        rememberWinner(step);
        opts.onProvider?.(step);
        return results;
      }
      errors.push(`${step.kind}${step.instance ? ' ' + step.instance : ''}: empty`);
    } catch (err) {
      errors.push(
        `${step.kind}${step.instance ? ' ' + step.instance : ''}: ${err?.message || err}`
      );
      if (
        cachedWinner &&
        step.kind === cachedWinner.kind &&
        step.instance === cachedWinner.instance
      ) {
        forgetWinner();
      }
      if (mergedSignal.aborted) break;
    }
  }

  const detail = errors.slice(0, 3).join(' · ');
  const e = new Error(
    `Search providers all failed${detail ? ` (${detail})` : ''}. Try pasting a URL directly.`
  );
  e.code = 'ALL_PROVIDERS_FAILED';
  throw e;
}

function buildProviderSequence() {
  /** @type {{kind:string,instance?:string}[]} */
  const sequence = [];
  if (cachedWinner && cachedWinner.kind) sequence.push(cachedWinner);

  sequence.push({ kind: 'youtube' });
  for (const instance of INVIDIOUS_INSTANCES) sequence.push({ kind: 'invidious', instance });
  for (const instance of PIPED_API_INSTANCES) sequence.push({ kind: 'piped', instance });

  // Deduplicate (cached winner may also appear later in the default list).
  const seen = new Set();
  return sequence.filter((step) => {
    const k = `${step.kind}|${step.instance || ''}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export const _internals = {
  parseDurationLabel,
  buildProviderSequence,
  rememberWinner,
  forgetWinner,
  INVIDIOUS_INSTANCES,
  PIPED_API_INSTANCES
};

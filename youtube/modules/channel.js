/**
 * @typedef {Object} VideoEntry
 * @property {string} title
 * @property {string} url
 * @property {string} videoId
 */

export const CHANNEL_URL = 'https://www.youtube.com/@joeyjojojojojojojojojojojojojo/videos';

/**
 * Hard-coded channel id matching CHANNEL_URL. Used for the RSS fallback that
 * the mobile path takes (RSS keys off channel_id, not handle).
 */
export const CHANNEL_ID = 'UC6R_br1QP8tczjO4KMfzejw';

/** YouTube's public RSS feed for a channel — 15 most recent uploads, UA-agnostic. */
export const CHANNEL_RSS_URL = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`;

/** Extract the 11-char video ID from any YouTube URL. */
export function getVideoId(url) {
  const m = String(url || '').match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([A-Za-z0-9_-]{11})/
  );
  return m ? m[1] : null;
}

/**
 * Heuristic: are we running in a mobile browser?
 *
 * The bug we're working around is that the CORS proxies (corsproxy.io,
 * proxy.corsfix.com) forward the *client* User-Agent upstream to YouTube.
 * From a mobile browser that means YouTube returns the m.youtube.com
 * channel page, which uses singleColumnBrowseResultsRenderer and ships
 * NO videoIds in its initial HTML — the mobile site paints the video list
 * client-side after hydration. The HTML scrape therefore returns 0 videos.
 *
 * Desktop pages embed the full list, so the HTML path stays on desktop
 * and we only switch to the RSS feed (15 latest, structured XML, no UA
 * dependency) when the user is on a mobile UA.
 *
 * @returns {boolean}
 */
export function isMobileUserAgent() {
  if (typeof navigator === 'undefined') return false;
  const uaData = /** @type {{ mobile?: boolean } | undefined} */ (navigator.userAgentData);
  if (uaData && typeof uaData.mobile === 'boolean') return uaData.mobile;
  return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
}

/**
 * Fetch the channel listing HTML through the shared cross-origin proxy.
 * YouTube blocks CORS for browsers, so we always skip the direct attempt.
 *
 * Only called from the desktop branch of loadVideos(). On mobile, all of
 * our usable proxies (corsproxy.io is explicit about it; corsfix does it
 * in practice) forward the client User-Agent upstream, so the mobile path
 * uses the RSS feed instead — see isMobileUserAgent.
 *
 * corsproxy.io stays deferred so that any quirky desktop UA still has the
 * other proxies tried first; it's a no-op in the common case.
 */
export async function fetchChannelHtml() {
  if (!window.proxyService || typeof window.proxyService.fetchWithProxy !== 'function') {
    throw new Error("Couldn't reach the channel. Try reloading the page.");
  }
  return window.proxyService.fetchWithProxy(CHANNEL_URL, {
    skipDirect: true,
    timeout: 20000,
    maxRetries: 2,
    deferProxies: ['https://corsproxy.io/']
  });
}

/**
 * Pull {title, url, videoId} entries out of the channel HTML.
 * Primary path: parse the `ytInitialData` JSON blob YouTube embeds in the page.
 * Fallback: regex over `/watch?v=` IDs if the JSON structure has shifted.
 *
 * @param {string} html
 * @returns {VideoEntry[]}
 */
export function extractVideoData(html) {
  /** @type {Map<string, VideoEntry>} */
  const videoMap = new Map();
  const addVideo = (videoId, title) => {
    if (!videoId) return;
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const clean = (title || '').trim();
    const existing = videoMap.get(videoId);
    if (!existing || (clean && existing.title.startsWith('Video '))) {
      videoMap.set(videoId, { title: clean || `Video ${videoId}`, url, videoId });
    }
  };

  /** @type {Document | null} */
  let doc = null;
  try {
    doc = new DOMParser().parseFromString(html, 'text/html');
  } catch (e) {
    console.warn('[channel] DOMParser failed, falling back to regex:', e.message);
  }

  if (doc) {
    const scripts = doc.querySelectorAll('script');
    for (const script of scripts) {
      const content = script.textContent || '';
      if (!content.includes('ytInitialData')) continue;
      const jsonText = extractYtInitialDataJson(content);
      if (!jsonText) continue;
      try {
        const data = JSON.parse(jsonText);
        const tabs = data?.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
        for (const tab of tabs) {
          const contents = tab?.tabRenderer?.content?.richGridRenderer?.contents;
          if (!Array.isArray(contents)) continue;
          for (const item of contents) {
            const content = item?.richItemRenderer?.content;
            if (!content) continue;

            // Modern YouTube (2024+): lockupViewModel
            const lockup = content.lockupViewModel;
            if (lockup) {
              const videoId = lockup.contentId;
              const title =
                lockup?.metadata?.lockupMetadataViewModel?.title?.content ||
                lockup?.metadata?.lockupMetadataViewModel?.title?.text ||
                '';
              addVideo(videoId, title);
              continue;
            }

            // Legacy YouTube: videoRenderer
            const renderer = content.videoRenderer;
            if (renderer) {
              const title =
                renderer.title?.runs?.[0]?.text ||
                renderer.title?.simpleText ||
                renderer.accessibility?.accessibilityData?.label ||
                '';
              addVideo(renderer.videoId, title);
            }
          }
        }
      } catch (e) {
        console.warn('[channel] failed to parse ytInitialData JSON:', e.message);
      }
      break;
    }
  }

  if (videoMap.size === 0) {
    const pattern = /\/watch\?v=([a-zA-Z0-9_-]{11})/g;
    let m;
    while ((m = pattern.exec(html)) !== null) {
      addVideo(m[1], '');
    }
  }

  return Array.from(videoMap.values());
}

/**
 * Fetch the channel's RSS feed through the shared proxy. The RSS endpoint
 * is UA-agnostic, so any of the proxies returns the same XML regardless of
 * the client device.
 */
export async function fetchChannelRssXml() {
  if (!window.proxyService || typeof window.proxyService.fetchWithProxy !== 'function') {
    throw new Error("Couldn't reach the channel feed. Try reloading the page.");
  }
  return window.proxyService.fetchWithProxy(CHANNEL_RSS_URL, {
    skipDirect: true,
    timeout: 15000,
    maxRetries: 2
  });
}

/**
 * Pull {title, url, videoId} entries from the channel's Atom/RSS XML.
 * Each `<entry>` carries `<yt:videoId>` and `<title>`; we synthesise the
 * canonical /watch URL from the id so downstream consumers can treat
 * RSS-sourced and HTML-sourced entries identically.
 *
 * @param {string} xml
 * @returns {VideoEntry[]}
 */
export function extractVideoDataFromRss(xml) {
  /** @type {VideoEntry[]} */
  const out = [];
  if (!xml) return out;

  let doc = null;
  try {
    doc = new DOMParser().parseFromString(xml, 'application/xml');
  } catch (_e) {
    return out;
  }
  if (!doc || doc.querySelector('parsererror')) return out;

  const seen = new Set();
  const entries = doc.getElementsByTagName('entry');
  for (const entry of entries) {
    // yt:videoId is namespaced; getElementsByTagName with the local name works
    // in HTML quirks but on XML we need the namespaced form. Try both.
    const idNode =
      entry.getElementsByTagName('yt:videoId')[0] ||
      entry.getElementsByTagNameNS('*', 'videoId')[0];
    const titleNode = entry.getElementsByTagName('title')[0];
    const videoId = (idNode?.textContent || '').trim();
    if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId) || seen.has(videoId)) continue;
    seen.add(videoId);
    const title = (titleNode?.textContent || '').trim() || `Video ${videoId}`;
    out.push({
      title,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      videoId
    });
  }
  return out;
}

/**
 * Fetch + parse in one call. Routes mobile clients to the RSS feed because
 * the HTML scrape returns the m.youtube.com channel page on mobile UAs and
 * that page has no videoIds in its SSR (see isMobileUserAgent).
 */
export async function loadVideos() {
  if (isMobileUserAgent()) {
    const xml = await fetchChannelRssXml();
    return extractVideoDataFromRss(xml);
  }
  const html = await fetchChannelHtml();
  return extractVideoData(html);
}

/**
 * Pull the ytInitialData JSON out of a `<script>` body. YouTube ships it in
 * three different shapes depending on the User-Agent the request used:
 *
 *   1. Desktop (object literal):
 *        var ytInitialData = {"responseContext":...};
 *   2. Some embeds (no `var`):
 *        ytInitialData = {"responseContext":...};
 *   3. Mobile (hex-escaped JSON STRING literal, parsed at runtime):
 *        var ytInitialData = '\x7b\x22responseContext\x22:\x7b...';
 *        window['ytInitialData'] = JSON.parse(window['ytInitialData']);
 *
 * Returns a JSON-parseable string, or null if no shape matched.
 *
 * @param {string} content
 * @returns {string | null}
 */
function extractYtInitialDataJson(content) {
  // Mobile: `var ytInitialData = '<hex-escaped JSON>';`
  // Walk the string respecting `\\` escapes so it always finds the *real*
  // closing quote. A regex with alternation on a 400KB body backtracks badly.
  const mobileStart = content.search(/var\s+ytInitialData\s*=\s*'/);
  if (mobileStart >= 0) {
    // Step past the `var ytInitialData = '` prefix to land on the first
    // character of the string body.
    const openIdx = content.indexOf("'", mobileStart);
    if (openIdx >= 0) {
      let i = openIdx + 1;
      while (i < content.length) {
        const c = content[i];
        if (c === '\\') {
          i += 2; // skip escape sequence as a unit
          continue;
        }
        if (c === "'") {
          return decodeJsStringLiteral(content.substring(openIdx + 1, i));
        }
        i++;
      }
    }
  }

  // Desktop / embedded: bare object literal. Lazy match stops at the first
  // `};` — JSON has no `;` so this is safe.
  const objLit =
    content.match(/var\s+ytInitialData\s*=\s*({[\s\S]+?});\s*<\/script>/) ||
    content.match(/var\s+ytInitialData\s*=\s*({[\s\S]+?});/) ||
    content.match(/ytInitialData\s*=\s*({[\s\S]+?});/);
  return objLit ? objLit[1] : null;
}

/**
 * Decode a JavaScript single-quoted string literal body into its runtime
 * value, without executing it. Handles \xHH, \uHHHH, and common single-char
 * escapes. Anything else falls through as the literal character.
 *
 * @param {string} body  The contents between the surrounding quotes.
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

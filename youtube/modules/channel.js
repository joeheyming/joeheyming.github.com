/**
 * @typedef {Object} VideoEntry
 * @property {string} title
 * @property {string} url
 * @property {string} videoId
 */

export const CHANNEL_URL =
  'https://www.youtube.com/@joeyjojojojojojojojojojojojojo/videos';

/** Extract the 11-char video ID from any YouTube URL. */
export function getVideoId(url) {
  const m = String(url || '').match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([A-Za-z0-9_-]{11})/
  );
  return m ? m[1] : null;
}

/**
 * Fetch the channel listing HTML through the shared cross-origin proxy.
 * YouTube blocks CORS for browsers, so we always skip the direct attempt.
 *
 * We defer `corsproxy.io` because it forwards the client's User-Agent. On a
 * mobile browser that means YouTube returns the m.youtube.com HTML with a
 * totally different `ytInitialData` shape. The other proxies use their own
 * server-side UA, so they always serve the parseable desktop page.
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

/** Convenience: fetch and parse in one call. */
export async function loadVideos() {
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
        case 'n': return '\n';
        case 't': return '\t';
        case 'r': return '\r';
        case 'b': return '\b';
        case 'f': return '\f';
        case '0': return '\0';
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

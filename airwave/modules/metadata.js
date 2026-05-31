/**
 * Resolve YouTube URLs/IDs to display metadata (title, author, thumbnail).
 *
 * Two pieces:
 *   - Pure parsers (`parseYouTubeId`, `parsePlaylistId`, `pickThumbnail`) —
 *     no globals, easy to unit-test.
 *   - `fetchOEmbed(id, { proxy })` — calls YouTube's public oEmbed endpoint.
 *     No API key required. Tries direct first; falls back to `proxy` (e.g.
 *     `window.proxyService`) if CORS blocks. Caller passes the proxy in so
 *     this module stays free of `window` references and is testable in
 *     plain `node --test`.
 */

const YT_OEMBED_BASE = 'https://www.youtube.com/oembed';

const URL_PATTERNS = [
  // youtube.com/watch?v=ID
  /[?&]v=([a-zA-Z0-9_-]{11})/,
  // youtu.be/ID
  /youtu\.be\/([a-zA-Z0-9_-]{11})/,
  // youtube.com/embed/ID  or  /v/ID  or  /shorts/ID  or  /live/ID
  /youtube\.com\/(?:embed|v|shorts|live)\/([a-zA-Z0-9_-]{11})/
];

const PLAIN_ID = /^([a-zA-Z0-9_-]{11})$/;
const PLAYLIST_ID = /[?&]list=([a-zA-Z0-9_-]{10,64})/;

/**
 * Extract a YouTube video ID from a URL, ID, or pasted string. Returns null
 * if no 11-char ID can be confidently identified.
 *
 * @param {string} input
 * @returns {string | null}
 */
export function parseYouTubeId(input) {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim().replace(/^['"]|['"]$/g, '');
  if (!trimmed) return null;
  const plain = trimmed.match(PLAIN_ID);
  if (plain) return plain[1];
  for (const pat of URL_PATTERNS) {
    const m = trimmed.match(pat);
    if (m) return m[1];
  }
  return null;
}

/**
 * Pull a `list=...` playlist ID out of a YouTube URL. Returns null when no
 * playlist parameter is present.
 *
 * @param {string} input
 * @returns {string | null}
 */
export function parsePlaylistId(input) {
  if (typeof input !== 'string') return null;
  const m = input.match(PLAYLIST_ID);
  return m ? m[1] : null;
}

/**
 * Pick the highest-quality thumbnail URL likely to exist for a video ID.
 * `maxresdefault.jpg` is best when present but 404s for ~30% of videos
 * (older uploads), so callers should fall back via `<img onerror>` to
 * `hqdefault.jpg`, which YouTube generates for every video.
 *
 * @param {string} videoId
 * @returns {{ best: string, fallback: string }}
 */
export function pickThumbnail(videoId) {
  return {
    best: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
    fallback: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
  };
}

/**
 * Build the canonical "watch" URL for an id. We use this both for
 * oEmbed lookups and as the `og:url` style canonical when sharing.
 *
 * @param {string} videoId
 */
export function watchUrl(videoId) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/**
 * Fetch oEmbed metadata for a video. Returns `{ title, author, ... }` or
 * throws on hard failure.
 *
 *   - Uses no API key (oEmbed is public).
 *   - Tries direct fetch first; some browsers/regions get CORS, others
 *     don't, so a `proxy` (with `fetchJson`) is used as a fallback when
 *     direct fails.
 *   - Times out at 6s for the direct attempt.
 *
 * @param {string} videoId
 * @param {{ proxy?: { fetchJson: (url: string, opts?: object) => Promise<any> } }} [opts]
 */
export async function fetchOEmbed(videoId, opts = {}) {
  if (!videoId || typeof videoId !== 'string') {
    throw new Error('fetchOEmbed: videoId required');
  }
  const targetUrl = `${YT_OEMBED_BASE}?url=${encodeURIComponent(watchUrl(videoId))}&format=json`;

  // Direct attempt.
  try {
    const res = await fetch(targetUrl, {
      method: 'GET',
      mode: 'cors',
      signal: AbortSignal.timeout(6000)
    });
    if (res.ok) {
      const data = await res.json();
      return normalizeOEmbed(videoId, data);
    }
    // 401/403 from oEmbed = restricted/region-locked; surface a clean error.
    if (res.status === 401 || res.status === 403) {
      throw new Error('This video is not embeddable.');
    }
  } catch (err) {
    if (err && err.message === 'This video is not embeddable.') throw err;
    // Fall through to proxy.
  }

  if (opts.proxy && typeof opts.proxy.fetchJson === 'function') {
    const data = await opts.proxy.fetchJson(targetUrl, {
      friendlyError: "Couldn't read YouTube metadata. The video may be private or region-locked."
    });
    return normalizeOEmbed(videoId, data);
  }

  throw new Error('Could not load video metadata.');
}

function normalizeOEmbed(videoId, data) {
  const thumbs = pickThumbnail(videoId);
  return {
    id: videoId,
    title: typeof data?.title === 'string' && data.title ? data.title : `YouTube · ${videoId}`,
    author: typeof data?.author_name === 'string' ? data.author_name : '',
    authorUrl: typeof data?.author_url === 'string' ? data.author_url : '',
    thumbnail: typeof data?.thumbnail_url === 'string' ? data.thumbnail_url : thumbs.fallback,
    thumbnailHi: thumbs.best,
    thumbnailLo: thumbs.fallback,
    watchUrl: watchUrl(videoId)
  };
}

export const _internals = { URL_PATTERNS, PLAIN_ID, PLAYLIST_ID, normalizeOEmbed };

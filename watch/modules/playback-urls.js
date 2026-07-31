/**
 * Playback URL queue for /watch/ — softens archive.org CDN flake.
 *
 * Online play uses a canonical `archive.org/download/…` URL (the
 * browser follows IA's 302 to a regional CDN). When that fails, we
 * try, in order:
 *
 *   1. Explicit `ep.urlAlternates` (e.g. lower-bitrate `.ia.mp4`
 *      sibling recorded at catalog build time)
 *   2. A synthetic `.ia.mp4` sibling URL derived from `ep.file`
 *   3. Direct CDN hosts from the item's metadata
 *      (`server` / `workable_servers` / `d1` / `d2` + `dir`) —
 *      session-scoped only; never persist these (IA relocates items)
 *
 * The canonical download URL stays first so happy-path play is
 * unchanged. Dedup preserves order.
 */

/**
 * @typedef {Object} IaLocation
 * @property {string} dir
 * @property {string[]} servers
 */

/**
 * @typedef {Object} EpisodeLike
 * @property {string} url
 * @property {string} [file]
 * @property {string} [iaItem]
 * @property {string[]} [urlAlternates]
 */

/**
 * @typedef {Object} CatalogLike
 * @property {Record<string, IaLocation>} [iaLocations]
 */

/**
 * Extract durable CDN location hints from an IA metadata blob.
 * Returns null when the record has no usable dir/servers.
 *
 * @param {Record<string, unknown>} meta
 * @returns {IaLocation | null}
 */
export function extractIaLocation(meta) {
  if (!meta || typeof meta !== 'object') return null;
  const dir = typeof meta.dir === 'string' ? meta.dir : '';
  if (!dir) return null;

  /** @type {string[]} */
  const servers = [];
  const push = (v) => {
    if (typeof v !== 'string' || !v) return;
    const host = v.replace(/^https?:\/\//i, '').replace(/\/$/, '');
    if (host && !servers.includes(host)) servers.push(host);
  };
  push(meta.server);
  if (Array.isArray(meta.workable_servers)) {
    for (const s of meta.workable_servers) push(s);
  }
  push(meta.d1);
  push(meta.d2);
  if (!servers.length) return null;
  return { dir: dir.startsWith('/') ? dir : `/${dir}`, servers };
}

/**
 * Sibling `.ia.mp4` path for a plain `.mp4` file, or null.
 * `Foo.mp4` → `Foo.ia.mp4`; already-derivative names return null.
 *
 * @param {string} file
 * @returns {string | null}
 */
export function iaDerivativeFileName(file) {
  if (typeof file !== 'string' || !file) return null;
  if (/\.ia\.mp4$/i.test(file)) return null;
  if (!/\.mp4$/i.test(file)) return null;
  return file.replace(/\.mp4$/i, '.ia.mp4');
}

/**
 * Canonical download URL (same shape as catalog.js).
 *
 * @param {string} itemId
 * @param {string} name
 * @returns {string}
 */
export function buildDownloadUrl(itemId, name) {
  return `https://archive.org/download/${itemId}/${encodePath(name)}`;
}

/**
 * Direct CDN file URLs from a cached IA location. Empty when inputs
 * are incomplete. These are fallback-only — prefer the canonical
 * `/download/` URL for the first attempt.
 *
 * @param {IaLocation | null | undefined} loc
 * @param {string} file
 * @returns {string[]}
 */
export function buildCdnFileUrls(loc, file) {
  if (!loc || !file || !loc.dir || !Array.isArray(loc.servers)) return [];
  const path = `${loc.dir.replace(/\/$/, '')}/${encodePath(file)}`;
  return loc.servers.map((host) => `https://${host}${path}`);
}

/**
 * Ordered unique playback candidates for an episode.
 *
 * @param {EpisodeLike} ep
 * @param {CatalogLike | null | undefined} [catalog]
 * @returns {string[]}
 */
export function buildPlaybackQueue(ep, catalog) {
  if (!ep || typeof ep.url !== 'string' || !ep.url) return [];

  /** @type {string[]} */
  const out = [];
  const add = (u) => {
    if (typeof u !== 'string' || !u) return;
    if (!out.includes(u)) out.push(u);
  };

  add(ep.url);
  if (Array.isArray(ep.urlAlternates)) {
    for (const u of ep.urlAlternates) add(u);
  }

  const itemId = typeof ep.iaItem === 'string' ? ep.iaItem : '';
  const file = typeof ep.file === 'string' ? ep.file : '';
  const deriv = iaDerivativeFileName(file);
  if (itemId && deriv) add(buildDownloadUrl(itemId, deriv));

  if (itemId && file && catalog?.iaLocations?.[itemId]) {
    for (const u of buildCdnFileUrls(catalog.iaLocations[itemId], file)) add(u);
    if (deriv) {
      for (const u of buildCdnFileUrls(catalog.iaLocations[itemId], deriv)) add(u);
    }
  }

  return out;
}

/** URI-encode every path segment, keep '/' delimiters intact. */
function encodePath(p) {
  return String(p).split('/').map(encodeURIComponent).join('/');
}

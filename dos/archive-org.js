// dos/archive-org.js — turn an Internet Archive item URL into a
// concrete download URL for a playable file.
//
// Archive.org exposes a JSON metadata endpoint at
//   https://archive.org/metadata/{identifier}
// which lists every file in the item with size, format, and filename.
// That endpoint is CORS-permissive — the browser can hit it directly,
// no proxy chain needed. Download URLs follow the pattern
//   https://archive.org/download/{identifier}/{filename}
// and likewise CORS-allow GETs from browser contexts.
//
// We pick the best playable file using a simple heuristic:
//   1) Prefer a .jsdos bundle if the uploader included one — it's
//      already configured for js-dos, no repack needed.
//   2) Otherwise prefer the largest .zip — typically the "complete"
//      release rather than a screenshot or readme zip.
//   3) As a last resort, accept any single .exe/.com (some tiny utility
//      items publish just the program).

/**
 * Parse a string that might be a full archive.org URL, a bare identifier,
 * or a deep download URL. Returns the canonical identifier or null.
 *
 * Examples that resolve to "msdos_Dark_Sun_-_Shattered_Lands_1993":
 *   https://archive.org/details/msdos_Dark_Sun_-_Shattered_Lands_1993
 *   https://archive.org/download/msdos_Dark_Sun_-_Shattered_Lands_1993/file.zip
 *   msdos_Dark_Sun_-_Shattered_Lands_1993
 */
export function parseArchiveId(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;

  // Bare identifier (no slashes, no scheme).
  if (!raw.includes('/') && !raw.includes(':')) {
    return /^[A-Za-z0-9._-]+$/.test(raw) ? raw : null;
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!/(^|\.)archive\.org$/i.test(url.hostname)) return null;

  const parts = url.pathname.split('/').filter(Boolean);
  // /details/{id}  or  /download/{id}/{file...}  or  /embed/{id}
  const head = parts[0];
  if (head === 'details' || head === 'download' || head === 'embed') {
    return parts[1] || null;
  }
  return null;
}

/**
 * @typedef {Object} ArchiveFile
 * @property {string} name        Filename within the item.
 * @property {string} [format]    Archive.org's "format" string (e.g. "ZIP").
 * @property {string} [source]    "original" (uploaded) vs "derivative"
 *                                (auto-generated thumbnails, torrents).
 * @property {number} size        Bytes.
 * @property {string} downloadUrl Browser-fetchable absolute URL.
 */

/**
 * @typedef {Object} ArchiveItem
 * @property {string} id
 * @property {string} title
 * @property {string} detailsUrl
 * @property {ArchiveFile[]} files
 * @property {ArchiveFile | null} bestPlayable
 * @property {string | null} emulatorStart  Curator-supplied boot command
 *                                          from the item metadata
 *                                          (e.g. "ARENA.BAT"). Used as
 *                                          a high-confidence boot hint
 *                                          when present.
 */

const META_URL = (id) => `https://archive.org/metadata/${encodeURIComponent(id)}`;
const DOWNLOAD_URL = (id, name) =>
  `https://archive.org/download/${encodeURIComponent(id)}/${encodeURI(name)}`;

const PLAYABLE_EXT = new Set(['jsdos', 'zip', 'exe', 'com', 'bat']);

/** @param {string} name */
function extOf(name) {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

/** Skip files that are clearly artwork, metadata, or torrent sidecars. */
function looksLikeMetadataFile(name) {
  const lower = name.toLowerCase();
  return (
    lower.endsWith('_meta.xml') ||
    lower.endsWith('_files.xml') ||
    lower.endsWith('_reviews.xml') ||
    lower.endsWith('_archive.torrent') ||
    lower.endsWith('.sqlite') ||
    lower.endsWith('.gif') ||
    lower.endsWith('.png') ||
    lower.endsWith('.jpg') ||
    lower.endsWith('.jpeg') ||
    lower.endsWith('.txt')
  );
}

/**
 * @param {string} idOrUrl
 * @param {AbortSignal} [signal]
 * @returns {Promise<ArchiveItem>}
 */
export async function fetchArchiveItem(idOrUrl, signal) {
  const id = parseArchiveId(idOrUrl);
  if (!id) {
    throw new Error(
      "That doesn't look like an archive.org item. Paste a /details/… URL or the identifier."
    );
  }

  const response = await fetch(META_URL(id), { signal });
  if (!response.ok) {
    throw new Error(`Archive.org returned ${response.status} for "${id}".`);
  }
  /**
   * @type {{
   *   metadata?: {
   *     title?: string,
   *     emulator_start?: string,
   *     'access-restricted'?: string | boolean,
   *     'access-restricted-item'?: string | boolean
   *   },
   *   files?: Array<{ name: string, format?: string, size?: string, source?: string }>
   * }}
   */
  const data = await response.json();
  if (!data || !Array.isArray(data.files)) {
    throw new Error(`No files found in archive.org item "${id}".`);
  }

  // Stop early on Access-Restricted / "Stream Only" items. These play
  // only inside archive.org's own embed iframe; their /download/ URLs
  // 403 from any client (browser, proxy, curl). We learn this from the
  // metadata, not from a download attempt, so the user gets a clear
  // error before we burn the proxy chain on a doomed request.
  const md = data.metadata || {};
  const restricted =
    md['access-restricted-item'] === true ||
    md['access-restricted-item'] === 'true' ||
    md['access-restricted'] === true ||
    md['access-restricted'] === 'true';
  if (restricted) {
    throw new Error(
      `Archive.org item "${id}" is marked Stream Only. It can only be played ` +
        "in archive.org's embedded player and can't be downloaded for offline use. " +
        'Try a different upload of the same game.'
    );
  }

  const files = data.files
    .filter((f) => f && typeof f.name === 'string' && !looksLikeMetadataFile(f.name))
    .map((f) => ({
      name: f.name,
      format: f.format || '',
      source: f.source || '',
      size: Number(f.size) || 0,
      downloadUrl: DOWNLOAD_URL(id, f.name)
    }));

  // Only consider uploader-provided files for playback — skip
  // derivatives like *_thumb.gif and the auto-generated torrent.
  // (For older items `source` may be missing; treat that as eligible.)
  const eligible = files.filter((f) => !f.source || f.source === 'original');
  const playable = eligible.filter((f) => PLAYABLE_EXT.has(extOf(f.name)));

  // Prefer a real .jsdos bundle if the uploader provided one.
  const jsdos = playable.find((f) => extOf(f.name) === 'jsdos');
  // Otherwise, the largest .zip — archive.org items often include a
  // small "manual" zip alongside the actual game; size disambiguates.
  const zips = playable.filter((f) => extOf(f.name) === 'zip').sort((a, b) => b.size - a.size);
  const standalone = playable.find((f) => {
    const e = extOf(f.name);
    return e === 'exe' || e === 'com' || e === 'bat';
  });
  const bestPlayable = jsdos || zips[0] || standalone || null;

  const emulatorStart =
    (data.metadata && typeof data.metadata.emulator_start === 'string'
      ? data.metadata.emulator_start.trim()
      : '') || null;

  return {
    id,
    title: (data.metadata && data.metadata.title) || id,
    detailsUrl: `https://archive.org/details/${encodeURIComponent(id)}`,
    files,
    bestPlayable,
    emulatorStart
  };
}

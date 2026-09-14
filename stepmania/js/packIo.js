import { SimfileParser } from './simfileParser.js';
import { writeSsc, writeSm, chartHasSplitTiming, createEmptySimfile } from './simfileWriter.js';
import { isVideoFileName, parseBgChangesValue, danceSingleCharts } from './simfileParser.js';

const SIMFILE_EXT = /\.(ssc|sm)$/i;
const AUDIO_EXT = /\.(ogg|oga|opus|mp3|wav|m4a|aac|flac)$/i;
const IMAGE_EXT = /\.(png|jpg|jpeg|gif|bmp|webp)$/i;
const VIDEO_EXT = /\.(avi|mp4|webm|mov|mpg|mpeg)$/i;

/**
 * @typedef {Object} PackFile
 * @property {'text'|'binary'} kind
 * @property {string} [text]
 * @property {Blob} [blob]
 * @property {string} [mime]
 */

/**
 * @typedef {Object} SongPack
 * @property {string} group
 * @property {string} songDir
 * @property {string} simfileName
 * @property {import('./simfileParser.js').ParsedSimfile} parsed
 * @property {Map<string, PackFile>} files keys are lowercased relative paths
 * @property {string} [musicPath]
 * @property {string} [bannerPath]
 * @property {string} [backgroundPath]
 * @property {string} [jacketPath]
 * @property {string} [videoPath]
 */

export function sanitizePathPart(name) {
  return (
    String(name || 'Song')
      .replace(/[<>:"/\\|?*]/g, '_')
      .replace(/\s+/g, ' ')
      .trim() || 'Song'
  );
}

export function normalizeZipPath(name) {
  return String(name || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '');
}

function basename(path) {
  const norm = normalizeZipPath(path);
  const i = norm.lastIndexOf('/');
  return i >= 0 ? norm.slice(i + 1) : norm;
}

function dirname(path) {
  const norm = normalizeZipPath(path);
  const i = norm.lastIndexOf('/');
  return i >= 0 ? norm.slice(0, i) : '';
}

const MIME_BY_EXT = {
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mpg: 'video/mpeg',
  mpeg: 'video/mpeg',
  avi: 'video/x-msvideo'
};

function guessMime(name) {
  const ext = String(name || '')
    .toLowerCase()
    .split('.')
    .pop();
  return MIME_BY_EXT[ext] || 'application/octet-stream';
}

/**
 * @param {string} dir
 * @param {string} relative
 * @param {Map<string, PackFile>} files
 */
/**
 * True when `path` lives in `dir` (or `dir` is the zip root).
 * Asset lookups must stay inside one song folder: a pack zip holds many songs
 * that reuse filenames like `audio.ogg`, and a cross-folder match silently
 * pairs one song's chart with another song's music.
 * @param {string} path
 * @param {string} dir
 */
function inDir(path, dir) {
  if (!dir) return true;
  return path.toLowerCase().startsWith(dir.toLowerCase() + '/');
}

/**
 * @param {string} dir song folder the simfile lives in
 * @param {string} relative value of a #MUSIC/#BANNER/... tag
 * @param {Map<string, PackFile>} files
 */
function resolveAsset(dir, relative, files) {
  if (!relative) return null;
  const rel = normalizeZipPath(relative).replace(/^(\.\.\/)+/, '');
  const exact = [normalizeZipPath(`${dir}/${rel}`).toLowerCase()];
  if (!dir) exact.push(normalizeZipPath(rel).toLowerCase());
  for (const key of files.keys()) {
    if (exact.includes(key.toLowerCase())) return key;
  }
  // Tags often disagree with the archive on subfolder or case, so fall back to
  // a basename match — but only within this song's folder.
  const base = basename(rel).toLowerCase();
  for (const key of files.keys()) {
    if (!inDir(key, dir)) continue;
    if (basename(key).toLowerCase() === base) return key;
  }
  return null;
}

/**
 * @param {Map<string, PackFile>} files
 * @param {string} dir
 * @param {string[]} hints tried in order, most specific first
 * @param {RegExp} extPattern
 */
function pickByHint(files, dir, hints, extPattern) {
  for (const hint of hints) {
    for (const [path, file] of files) {
      if (file.kind === 'text') continue;
      if (!inDir(path, dir)) continue;
      if (!extPattern.test(path)) continue;
      if (basename(path).toLowerCase().includes(hint)) return path;
    }
  }
  return null;
}

/**
 * Build a SongPack from an in-memory file map (paths → PackFile).
 * @param {Map<string, PackFile>} files
 * @returns {SongPack}
 */
export function packFromFiles(files, opts = {}) {
  const songs = listPackSongs(files);
  if (songs.length === 0) {
    throw new Error('No .sm or .ssc simfile found in this pack');
  }
  const wanted = opts.simfilePath ? String(opts.simfilePath).toLowerCase() : null;
  const chosen = wanted
    ? songs.find((s) => s.simfilePath.toLowerCase() === wanted) || songs[0]
    : songs[0];
  const simfilePath = chosen.simfilePath;
  const simfileName = basename(simfilePath);
  const songDirPath = dirname(simfilePath);
  const group = dirname(songDirPath) || 'Unsorted';
  const songDir = basename(songDirPath) || sanitizePathPart(simfileName.replace(SIMFILE_EXT, ''));
  const text = files.get(simfilePath)?.text || '';
  const parsed = new SimfileParser().parse(text);

  const musicMeta = parsed.metadata.MUSIC;
  const bannerMeta = parsed.metadata.BANNER;
  const bgMeta = parsed.metadata.BACKGROUND;
  const jacketMeta = parsed.metadata.JACKET;
  const previewVid = parsed.metadata.PREVIEWVID;
  const bgChangeVideo = (parsed.bgChanges || []).find((bg) => bg.isVideo);

  let musicPath = resolveAsset(songDirPath, musicMeta, files);
  let bannerPath = resolveAsset(songDirPath, bannerMeta, files);
  let backgroundPath = resolveAsset(songDirPath, bgMeta, files);
  let jacketPath = resolveAsset(songDirPath, jacketMeta, files);
  let videoPath =
    resolveAsset(songDirPath, previewVid, files) ||
    resolveAsset(songDirPath, bgChangeVideo?.file, files);

  // Every fallback stays inside this song's folder for the reason in inDir().
  const scoped = [...files.keys()].filter(
    (p) => inDir(p, songDirPath) && files.get(p)?.kind !== 'text'
  );
  if (!musicPath) {
    musicPath = scoped.find((p) => AUDIO_EXT.test(p)) || null;
  }
  if (!bannerPath) {
    bannerPath = pickByHint(files, songDirPath, ['-bn', ' bn', 'banner'], IMAGE_EXT);
  }
  if (!backgroundPath) {
    backgroundPath = pickByHint(files, songDirPath, ['-bg', ' bg', 'background', 'bg'], IMAGE_EXT);
  }
  if (!videoPath) {
    videoPath = scoped.find((p) => VIDEO_EXT.test(p)) || null;
  }

  return {
    group: basename(group) || 'Unsorted',
    songDir,
    simfileName,
    simfilePath,
    parsed,
    files,
    songs,
    musicPath,
    bannerPath,
    backgroundPath,
    jacketPath,
    videoPath
  };
}

/**
 * Every song in a file map, sorted so the pick is stable: .ssc before .sm,
 * then shallowest path, then alphabetical.
 * @param {Map<string, PackFile>} files
 * @returns {{simfilePath: string, songDir: string, title: string}[]}
 */
export function listPackSongs(files) {
  /** @type {string[]} */
  const simfiles = [];
  for (const path of files.keys()) {
    if (SIMFILE_EXT.test(path) && files.get(path)?.kind === 'text') {
      simfiles.push(path);
    }
  }
  simfiles.sort((a, b) => {
    const aSsc = a.toLowerCase().endsWith('.ssc') ? 0 : 1;
    const bSsc = b.toLowerCase().endsWith('.ssc') ? 0 : 1;
    if (aSsc !== bSsc) return aSsc - bSsc;
    const depth = a.split('/').length - b.split('/').length;
    if (depth !== 0) return depth;
    return a.localeCompare(b);
  });
  // A song folder holding both .sm and .ssc is one song, not two.
  /** @type {Map<string, string>} */
  const byDir = new Map();
  for (const path of simfiles) {
    const dir = dirname(path).toLowerCase();
    if (!byDir.has(dir)) byDir.set(dir, path);
  }
  return [...byDir.values()].map((simfilePath) => ({
    simfilePath,
    songDir: basename(dirname(simfilePath)) || basename(simfilePath),
    title: titleFromSimfileText(files.get(simfilePath)?.text) || basename(simfilePath)
  }));
}

/**
 * Choose the song to open from a multi-song file map. A pack's first folder is
 * often a chartless placeholder or missing its audio, so prefer the first song
 * that has dance-single charts and music; fall back to the first song so the
 * caller still surfaces a real error about it.
 * @param {Map<string, PackFile>} files
 * @returns {SongPack}
 */
export function packFromFilesPlayable(files) {
  const songs = listPackSongs(files);
  if (songs.length < 2) return packFromFiles(files);
  /** @type {SongPack|null} */
  let first = null;
  for (const song of songs) {
    let pack;
    try {
      pack = packFromFiles(files, { simfilePath: song.simfilePath });
    } catch {
      continue;
    }
    if (!first) first = pack;
    if (pack.musicPath && danceSingleCharts(pack.parsed.charts).length > 0) return pack;
  }
  return first || packFromFiles(files);
}

function titleFromSimfileText(text) {
  const match = /#TITLE:([^;]*);/i.exec(String(text || ''));
  return match ? match[1].trim() : '';
}

/**
 * @param {SongPack} pack
 * @returns {Map<string, Blob|string>}
 */
export function filesFromPack(pack) {
  const group = sanitizePathPart(pack.group || 'Unsorted');
  const song = sanitizePathPart(pack.songDir || pack.parsed.title || 'Song');
  const prefix = `${group}/${song}/`;
  // Write from a copy: this runs on every autosave, and rewriting asset names
  // onto the live pack would compound across saves.
  const parsed = { ...pack.parsed };
  const meta = { ...(parsed.metadata || {}) };

  const stem = sanitizePathPart(song);
  const named = {};
  const copyAsset = (srcPath, destName, metaKey) => {
    if (!srcPath || !pack.files.has(srcPath)) return;
    const file = pack.files.get(srcPath);
    const ext = '.' + basename(srcPath).split('.').pop();
    const dest = destName.endsWith(ext) ? destName : destName + ext;
    named[prefix + dest] = file.kind === 'text' ? file.text : file.blob;
    if (metaKey) meta[metaKey] = dest;
  };

  if (pack.musicPath) copyAsset(pack.musicPath, stem, 'MUSIC');
  if (pack.bannerPath) copyAsset(pack.bannerPath, `${stem}-bn`, 'BANNER');
  if (pack.backgroundPath) copyAsset(pack.backgroundPath, `${stem}-bg`, 'BACKGROUND');
  if (pack.jacketPath) copyAsset(pack.jacketPath, `${stem}-jacket`, 'JACKET');
  if (pack.videoPath) {
    const ext = '.' + basename(pack.videoPath).split('.').pop();
    copyAsset(pack.videoPath, `${stem}-movie${ext}`, 'PREVIEWVID');
    const dest = meta.PREVIEWVID;
    const hasVideoBg = (parsed.bgChanges || []).some((bg) => isVideoFileName(bg.file));
    if (dest && !hasVideoBg) {
      parsed.bgChanges = [
        {
          beat: 0,
          file: dest,
          effect: '1.000',
          x: 0,
          y: 0,
          isVideo: true,
          isNoBackground: false
        },
        ...(parsed.bgChanges || [])
      ];
    } else if (dest) {
      parsed.bgChanges = (parsed.bgChanges || []).map((bg) =>
        bg.isVideo || isVideoFileName(bg.file) ? { ...bg, file: dest, isVideo: true } : bg
      );
    }
  }

  // Mid-song BGCHANGES can point at files that aren't one of the five known
  // roles. Copy those through under their own name, or the exported pack would
  // reference assets it doesn't contain.
  const songDirPath = pack.simfilePath ? dirname(pack.simfilePath) : '';
  parsed.bgChanges = (parsed.bgChanges || []).map((bg) => {
    if (!bg.file || /^https?:/i.test(bg.file)) return bg;
    const destName = basename(bg.file);
    if (named[prefix + destName]) return { ...bg, file: destName };
    const src = resolveAsset(songDirPath, bg.file, pack.files);
    if (!src) return bg;
    const file = pack.files.get(src);
    named[prefix + destName] = file.kind === 'text' ? file.text : file.blob;
    return { ...bg, file: destName };
  });

  parsed.metadata = meta;
  parsed.title = parsed.title || meta.TITLE;
  parsed.artist = parsed.artist || meta.ARTIST;

  const sscName = `${stem}.ssc`;
  named[prefix + sscName] = writeSsc(parsed);
  if (!chartHasSplitTiming(parsed)) {
    named[prefix + `${stem}.sm`] = writeSm(parsed);
  }

  const out = new Map();
  for (const [path, data] of Object.entries(named)) {
    out.set(path, data);
  }
  return out;
}

/**
 * @param {ArrayBuffer|Uint8Array|Blob} data
 * @param {typeof JSZip} [Zip]
 * @param {{simfilePath?: string}} [opts] which song to open in a multi-song zip
 * @returns {Promise<SongPack>}
 */
export async function unpackZip(data, Zip = globalThis.JSZip, opts = {}) {
  return packFromFiles(await readZipFiles(data, Zip), opts);
}

/**
 * @param {ArrayBuffer|Uint8Array|Blob} data
 * @param {typeof JSZip} [Zip]
 * @returns {Promise<Map<string, PackFile>>}
 */
export async function readZipFiles(data, Zip = globalThis.JSZip) {
  if (!Zip) throw new Error('JSZip is not loaded');
  const zip = await Zip.loadAsync(data);
  /** @type {Map<string, PackFile>} */
  const files = new Map();
  for (const [rawName, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    const name = normalizeZipPath(rawName);
    if (!name || name.startsWith('__MACOSX')) continue;
    const lower = name.toLowerCase();
    if (SIMFILE_EXT.test(lower)) {
      files.set(name, { kind: 'text', text: await entry.async('string') });
    } else {
      const blob = await entry.async('blob');
      files.set(name, { kind: 'binary', blob, mime: guessMime(name) });
    }
  }
  return files;
}

/**
 * Load a loose .sm/.ssc file (no zip).
 * @param {string} name
 * @param {string} text
 */
export function packFromSimfileText(name, text) {
  const files = new Map();
  files.set(normalizeZipPath(name) || 'song.ssc', { kind: 'text', text });
  return packFromFiles(files);
}

/**
 * @param {SongPack} pack
 * @param {typeof JSZip} [Zip]
 * @returns {Promise<Blob>}
 */
export async function packToZipBlob(pack, Zip = globalThis.JSZip) {
  if (!Zip) throw new Error('JSZip is not loaded');
  const zip = new Zip();
  for (const [path, data] of filesFromPack(pack)) {
    zip.file(path, data);
  }
  return zip.generateAsync({ type: 'blob' });
}

/**
 * @param {object} [opts]
 * @returns {SongPack}
 */
export function createEmptyPack(opts = {}) {
  const parsed = createEmptySimfile(opts);
  const songDir = sanitizePathPart(parsed.title);
  const simfilePath = `Unsorted/${songDir}/${songDir}.ssc`;
  const files = new Map();
  files.set(simfilePath, { kind: 'text', text: writeSsc(parsed) });
  return {
    group: 'Unsorted',
    songDir,
    simfileName: `${songDir}.ssc`,
    simfilePath,
    parsed,
    files,
    songs: [{ simfilePath, songDir, title: parsed.title }],
    musicPath: null,
    bannerPath: null,
    backgroundPath: null,
    jacketPath: null,
    videoPath: null
  };
}

export function setPackAsset(pack, role, fileName, blob, mime) {
  const path = `${pack.group}/${pack.songDir}/${basename(fileName)}`;
  pack.files.set(path, { kind: 'binary', blob, mime: mime || guessMime(fileName) });
  if (role === 'music') pack.musicPath = path;
  if (role === 'banner') pack.bannerPath = path;
  if (role === 'background') pack.backgroundPath = path;
  if (role === 'jacket') pack.jacketPath = path;
  if (role === 'video') pack.videoPath = path;
  return path;
}

export { AUDIO_EXT, IMAGE_EXT, VIDEO_EXT, guessMime, parseBgChangesValue };

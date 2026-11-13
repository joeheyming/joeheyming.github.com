#!/usr/bin/env node
// Dump the emulator library to a CSV.
//
// One row per game the ROM browser would list from Internet Archive today:
// console id, display name, stable archive.org file URL, libretro box-art
// URL (when the thumbnail pack has a match), file extension, and size.
// Rows for consoles marked preserveCatalog (Flash) are kept as-is.
// Upload the CSV to Google Sheets (tab name `games`), share it as
// "Anyone with the link → Viewer", then paste the spreadsheet id into
// SHEET_ID in emulator/games-sheet.js.
//
// File URLs stay on archive.org/download/… rather than a CDN host. Those
// hosts rotate; the ROM browser rewrites to the current CDN at play time.
//
// Usage:
//   node scripts/dump-emulator-games.mjs --out <path>
//   node scripts/dump-emulator-games.mjs --out <path> --console nes
//   node scripts/dump-emulator-games.mjs --out <path> --fill-missing

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @param {string} flag
 * @returns {string}
 */
function argValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index < 0) return '';
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : '';
}

const outArg = argValue('--out');
if (!outArg) {
  console.error('dump-emulator-games: pass --out <path>');
  process.exit(1);
}
const OUT_PATH = isAbsolute(outArg) ? outArg : resolve(REPO_ROOT, outArg);
const HEADER = 'console,name,downloadUrl,thumbnailUrl,fileExtension,size';
const THUMBNAIL_ILLEGAL = /[&*/:`<>?\\|]/g;

const onlyConsole = (() => {
  const flag = process.argv.indexOf('--console');
  return flag >= 0 ? process.argv[flag + 1] : '';
})();
const fillMissing = process.argv.includes('--fill-missing');

/**
 * Browser scripts share one `window`, the same way the emulator pages do.
 * @returns {Record<string, unknown>}
 */
function loadEmulatorWindow() {
  /** @type {Record<string, unknown>} */
  const sandbox = {
    window: /** @type {Record<string, unknown>} */ ({}),
    console,
    fetch
  };
  vm.createContext(sandbox);
  for (const file of [
    'emulator/consoles.js',
    'emulator/internet-archive.js',
    'emulator/rom-acquire.js'
  ]) {
    const code = readFileSync(resolve(REPO_ROOT, file), 'utf8');
    vm.runInContext(code, sandbox, { filename: file });
  }
  return /** @type {Record<string, unknown>} */ (sandbox.window);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function csvCell(value) {
  const text = value == null ? '' : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/**
 * @param {unknown[]} cells
 * @returns {string}
 */
function csvRow(cells) {
  return cells.map(csvCell).join(',');
}

/**
 * Same stem libretro uses for Named_Boxarts. Kept in step with
 * thumbnailStem() in emulator/rom-acquire.js.
 *
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
 * @param {string} playlist
 * @param {string} stem
 * @returns {string}
 */
/**
 * @param {string} playlist
 * @param {string} stem
 * @param {'Named_Boxarts' | 'Named_Snaps'} [folder]
 * @returns {string}
 */
function thumbnailUrl(playlist, stem, folder = 'Named_Boxarts') {
  return `https://thumbnails.libretro.com/${encodeURIComponent(
    playlist
  )}/${folder}/${encodeURIComponent(stem)}.png`;
}

/**
 * @param {string} playlist
 * @returns {string}
 */
function playlistRepo(playlist) {
  return playlist.replace(/ - /g, '_-_').replace(/ /g, '_');
}

/**
 * @param {string} playlist
 * @returns {Promise<{ names: string[], set: Set<string> } | null>}
 */
/**
 * @param {string} url
 * @returns {Promise<{ ok: boolean, status: number, data: Record<string, unknown> | null }>}
 */
async function githubJson(url) {
  const res = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'joeheyming-emulator-dump'
    },
    signal: AbortSignal.timeout(60000)
  });
  if (!res.ok) return { ok: false, status: res.status, data: null };
  return { ok: true, status: res.status, data: await res.json() };
}

/**
 * Box-art names from a recursive repo tree. Empty when the listing was
 * truncated — those repos are large enough that GitHub 500s or cuts the
 * walk off, and the Named_Boxarts subtree has to be fetched on its own.
 *
 * @param {Array<{ path?: string }> | undefined} tree
 * @param {boolean} truncated
 * @returns {string[]}
 */
function namesFromRecursiveTree(tree, truncated) {
  if (truncated || !Array.isArray(tree)) return [];
  const prefix = 'Named_Boxarts/';
  /** @type {string[]} */
  const names = [];
  for (const entry of tree) {
    const path = entry && entry.path;
    if (!path || !path.startsWith(prefix) || !path.endsWith('.png')) continue;
    const file = path.slice(prefix.length);
    if (!file || file.includes('/')) continue;
    names.push(file.slice(0, -4));
  }
  return names;
}

/**
 * @param {string} playlist
 * @returns {Promise<{ names: string[], set: Set<string> } | null>}
 */
/**
 * @param {string} playlist
 * @param {string} [folder] `Named_Boxarts` or `Named_Snaps`
 * @returns {Promise<{ names: string[], set: Set<string> } | null>}
 */
async function fetchThumbnailIndex(playlist, folder = 'Named_Boxarts') {
  const repo = playlistRepo(playlist);
  const base = `https://api.github.com/repos/libretro-thumbnails/${encodeURIComponent(repo)}`;
  if (folder === 'Named_Boxarts') {
    const recursive = await githubJson(`${base}/git/trees/master?recursive=1`);
    const fromWalk = namesFromRecursiveTree(
      /** @type {Array<{ path?: string }> | undefined} */ (recursive.data && recursive.data.tree),
      !recursive.ok || recursive.data?.truncated === true
    );
    if (fromWalk.length) return { names: fromWalk, set: new Set(fromWalk) };
    if (!recursive.ok) {
      console.warn(
        `thumbnail index ${playlist}: recursive listing HTTP ${recursive.status}, trying ${folder}`
      );
    }
  }
  const root = await githubJson(`${base}/git/trees/master`);
  const rootTree = root.data && root.data.tree;
  if (!root.ok || !Array.isArray(rootTree)) {
    console.warn(`thumbnail index ${playlist}: HTTP ${root.status}`);
    return null;
  }
  const node = rootTree.find((entry) => entry && entry.path === folder && entry.type === 'tree');
  if (!node || !node.sha) return null;
  const sub = await githubJson(`${base}/git/trees/${node.sha}`);
  const subTree = sub.data && sub.data.tree;
  if (!sub.ok || !Array.isArray(subTree)) {
    console.warn(`thumbnail index ${playlist}: ${folder} HTTP ${sub.status}`);
    return null;
  }
  /** @type {string[]} */
  const names = [];
  for (const entry of subTree) {
    const path = entry && entry.path;
    if (!path || !path.endsWith('.png') || path.includes('/')) continue;
    names.push(path.slice(0, -4));
  }
  if (!names.length) return null;
  return { names, set: new Set(names) };
}

/**
 * @param {string[]} playlists
 * @param {'Named_Boxarts' | 'Named_Snaps'} folder
 * @returns {Promise<Map<string, { names: string[], set: Set<string> }>>}
 */
async function loadIndexes(playlists, folder) {
  /** @type {Map<string, { names: string[], set: Set<string> }>} */
  const indexes = new Map();
  await Promise.all(
    playlists.map(async (playlist) => {
      try {
        const index = await fetchThumbnailIndex(playlist, folder);
        if (index) {
          indexes.set(playlist, index);
          console.log(`  ${playlist}: ${index.names.length} ${folder}`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`  ${playlist}: ${message}`);
      }
    })
  );
  return indexes;
}

/**
 * @param {string} text
 * @returns {string[][]}
 */
function parseCsv(text) {
  /** @type {string[][]} */
  const rows = [];
  /** @type {string[]} */
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    if (row.some((value) => value !== '')) rows.push(row);
  }
  return rows;
}

/**
 * BIOS, firmware, and test carts have no box. Leave those cells empty
 * instead of borrowing another game's art.
 *
 * @param {string} name
 * @returns {boolean}
 */
function skipThumbnail(name) {
  return (
    /^\[bios\]/i.test(name) || /\b(boot rom|firmware|test program|aging cartridge)\b/i.test(name)
  );
}

/**
 * Alternate titles to try when the filename is not itself a box-art name.
 * The original name stays first. Later variants drop a subtitle, a region
 * word stuck in the title ("Black Bass USA"), a possessive "s", or split
 * CamelCase ("ClayFighter").
 *
 * @param {string} name
 * @returns {string[]}
 */
function queryVariants(name) {
  /** @type {string[]} */
  const out = [];
  const seen = new Set();
  const add = (value) => {
    const text = String(value || '')
      .replace(/\s+/g, ' ')
      .trim();
    const key = text.toLowerCase();
    if (text.length < 3 || seen.has(key)) return;
    seen.add(key);
    out.push(text);
  };
  const soften = (value) =>
    String(value || '')
      .replace(/['’]s\b/gi, '')
      .replace(/['’]/g, ' ')
      .replace(
        /\b(usa|europe|japan|world|korea|brazil|france|germany|spain|italy|australia|asia|canada|proto|prototype|beta|demo|sample|unl|pirate|hack|alt|rev|aftermarket)\b/gi,
        ' '
      )
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/([A-Za-z])(\d)/g, '$1 $2')
      .replace(/(\d)([A-Za-z])/g, '$1 $2');
  add(name);
  add(soften(name));
  const head = String(name).split(/\s+-\s+/)[0];
  add(head);
  add(soften(head));
  add(name.replace(/\s*&\s*/g, ' - '));
  add(soften(name.replace(/\s*&\s*/g, ' - ')));
  return out;
}

/**
 * FBNeo's gamelist maps a Neo Geo short name (`aof`) to the title printed
 * on the box (`Art of Fighting`). Clones missing from the list (`kof98n`)
 * borrow the longest real driver they extend.
 *
 * @returns {Promise<Map<string, string>>}
 */
async function loadNeoGeoTitles() {
  const res = await fetch('https://raw.githubusercontent.com/libretro/FBNeo/master/gamelist.txt', {
    headers: { 'User-Agent': 'joeheyming-emulator-dump' },
    signal: AbortSignal.timeout(60000)
  });
  if (!res.ok) {
    console.warn(`FBNeo gamelist HTTP ${res.status}`);
    return new Map();
  }
  /** @type {Map<string, string>} */
  const titles = new Map();
  for (const line of (await res.text()).split('\n')) {
    if (!line.startsWith('|')) continue;
    const parts = line.split('|').map((part) => part.trim());
    const short = parts[1] || '';
    const title = parts[3] || '';
    const system = parts[7] || '';
    if (!short || !title || short === 'name' || !/neo\s*geo/i.test(system)) continue;
    titles.set(short.toLowerCase(), title);
  }
  return titles;
}

/**
 * @param {string} name
 * @param {Map<string, string>} titles
 * @returns {string}
 */
function neoGeoTitle(name, titles) {
  if (!titles || /\s/.test(name)) return '';
  const key = name.toLowerCase();
  if (titles.has(key)) return titles.get(key) || '';
  let best = '';
  for (const candidate of titles.keys()) {
    if (candidate.length < 4 || !key.startsWith(candidate)) continue;
    const rest = key.slice(candidate.length);
    if (rest.length > 3) continue;
    if (candidate.length > best.length) best = candidate;
  }
  return best ? titles.get(best) || '' : '';
}

/**
 * @param {string} name
 * @param {Map<string, string>} titles
 * @returns {string[]}
 */
function artQueries(name, titles) {
  /** @type {string[]} */
  const queries = [];
  const seen = new Set();
  const add = (value) => {
    const text = String(value || '')
      .replace(/\s+/g, ' ')
      .trim();
    const key = text.toLowerCase();
    if (text.length < 3 || seen.has(key)) return;
    seen.add(key);
    queries.push(text);
  };
  const alias = neoGeoTitle(name, titles);
  if (alias) {
    const bare = alias.replace(/\s*\([^)]*\)/g, ' ');
    add(bare.split('/')[0]);
    add(bare);
  }
  for (const variant of queryVariants(name)) add(variant);
  return queries;
}

/**
 * @param {string} name
 * @param {string[] | undefined} systems
 * @param {Map<string, { names: string[], set: Set<string> }>} boxarts
 * @param {(query: string, names: string[]) => string | null} pickThumbnailName
 * @param {{ snaps?: Map<string, { names: string[], set: Set<string> }>, titles?: Map<string, string> }} [extra]
 * @returns {string}
 */
function resolveThumbnail(name, systems, boxarts, pickThumbnailName, extra) {
  if (skipThumbnail(name)) return '';
  const options = extra || {};
  const queries = artQueries(name, options.titles || new Map());
  const list = Array.isArray(systems) ? systems : [];
  /** @type {Array<['Named_Boxarts' | 'Named_Snaps', Map<string, { names: string[], set: Set<string> }>]>} */
  const passes = [['Named_Boxarts', boxarts]];
  if (options.snaps) passes.push(['Named_Snaps', options.snaps]);
  for (const [folder, table] of passes) {
    for (const system of list) {
      const playlist = String(system || '').trim();
      const index = table.get(playlist);
      if (!index) continue;
      const stem = thumbnailStem(name);
      if (folder === 'Named_Boxarts' && stem && index.set.has(stem)) {
        return thumbnailUrl(playlist, stem, folder);
      }
      for (const query of queries) {
        const picked = pickThumbnailName(query, index.names);
        if (picked) return thumbnailUrl(playlist, picked, folder);
      }
    }
  }
  return '';
}

/**
 * @param {string} itemId
 * @returns {Promise<Record<string, unknown>>}
 */
async function fetchMetadata(itemId) {
  const url = `https://archive.org/metadata/${encodeURIComponent(itemId)}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'joeheyming-emulator-dump' },
    signal: AbortSignal.timeout(180000)
  });
  if (!res.ok) throw new Error(`metadata ${itemId}: HTTP ${res.status}`);
  const meta = await res.json();
  if (!meta || !Array.isArray(meta.files) || meta.files.length === 0) {
    throw new Error(`metadata ${itemId}: no files`);
  }
  return meta;
}

const browser = loadEmulatorWindow();

const consoles = /** @type {Record<string, Record<string, unknown>>} */ (browser.EMULATOR_CONSOLES);
const InternetArchiveRoms = /** @type {new (config: object) => {
  _iaIdentifier: (url: string) => string | null,
  parseRomListFromMetadata: (meta: object, baseUrl: string, cdnBase: string | null) => Array<Record<string, unknown>>
}} */ (browser.InternetArchiveRoms);
const pickThumbnailName = /** @type {(query: string, names: string[]) => string | null} */ (
  /** @type {{ pickThumbnailName: (query: string, names: string[]) => string | null }} */ (
    browser.emulatorRomAcquire
  ).pickThumbnailName
);

if (!consoles || !InternetArchiveRoms || typeof pickThumbnailName !== 'function') {
  console.error('dump-emulator-games: failed to load emulator scripts');
  process.exit(1);
}

/**
 * Second pass for box arts the first dump missed (a thumbnail repo whose
 * recursive tree listing 500s). Rewrites thumbnailUrl in the CSV already
 * on disk and leaves file URLs alone.
 */
async function fillMissingThumbnails() {
  const table = parseCsv(readFileSync(OUT_PATH, 'utf8'));
  const header = table[0] || [];
  const col = Object.fromEntries(header.map((name, index) => [name, index]));
  for (const key of ['console', 'name', 'thumbnailUrl']) {
    if (col[key] == null) throw new Error(`games csv is missing a ${key} column`);
  }
  /** @type {Set<string>} */
  const need = new Set();
  for (const row of table.slice(1)) {
    if (!row[col.thumbnailUrl] && row[col.console]) need.add(row[col.console]);
  }
  /** @type {Set<string>} */
  const playlists = new Set();
  for (const id of need) {
    const systems = consoles[id] && consoles[id].iaThumbnailSystems;
    if (!Array.isArray(systems)) continue;
    for (const system of systems) {
      const playlist = String(system || '').trim();
      if (playlist) playlists.add(playlist);
    }
  }
  console.log(`filling thumbnails for ${[...need].join(', ') || '(none)'}…`);
  const titles = need.has('neogeo') ? await loadNeoGeoTitles() : new Map();
  if (titles.size) console.log(`  neo geo titles: ${titles.size}`);
  const indexes = await loadIndexes([...playlists], 'Named_Boxarts');
  const snaps = await loadIndexes([...playlists], 'Named_Snaps');
  let filled = 0;
  const lines = [csvRow(header)];
  for (const row of table.slice(1)) {
    if (!row[col.thumbnailUrl]) {
      const cfg = consoles[row[col.console]];
      const art = cfg
        ? resolveThumbnail(
            row[col.name],
            /** @type {string[] | undefined} */ (cfg.iaThumbnailSystems),
            indexes,
            pickThumbnailName,
            { snaps, titles }
          )
        : '';
      if (art) {
        row[col.thumbnailUrl] = art;
        filled += 1;
      }
    }
    lines.push(csvRow(row));
  }
  writeFileSync(OUT_PATH, `${lines.join('\n')}\n`);
  console.log(`filled ${filled} thumbnail urls in ${OUT_PATH}`);
}

/**
 * Rows for catalogs this dump does not regenerate, such as `flash`.
 * Read before the file is truncated.
 * @returns {string[]}
 */
function extraCatalogLines() {
  let text = '';
  try {
    text = readFileSync(OUT_PATH, 'utf8');
  } catch {
    return [];
  }
  const preserved = new Set(
    Object.values(consoles)
      .filter((cfg) => cfg.preserveCatalog)
      .map((cfg) => String(cfg.id || ''))
  );
  const known = new Set(Object.values(consoles).map((cfg) => String(cfg.id || '')));
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(1)
    .filter((line) => {
      const consoleId = line.split(',')[0].replace(/^"|"$/g, '');
      if (!consoleId) return false;
      return preserved.has(consoleId) || !known.has(consoleId);
    });
}

if (fillMissing) {
  await fillMissingThumbnails();
  process.exit(0);
}

/** @type {string[]} */
const playlistNames = [];
const seenPlaylists = new Set();
for (const cfg of Object.values(consoles)) {
  const systems = cfg.iaThumbnailSystems;
  if (!Array.isArray(systems)) continue;
  for (const system of systems) {
    const name = String(system || '').trim();
    if (!name || seenPlaylists.has(name)) continue;
    seenPlaylists.add(name);
    playlistNames.push(name);
  }
}

console.log(`loading ${playlistNames.length} thumbnail indexes…`);
const thumbnailIndexes = await loadIndexes(playlistNames, 'Named_Boxarts');
const thumbnailSnaps = await loadIndexes(playlistNames, 'Named_Snaps');
const neoGeoTitles = await loadNeoGeoTitles();
if (neoGeoTitles.size) console.log(`  neo geo titles: ${neoGeoTitles.size}`);

const keptRows = extraCatalogLines();
writeFileSync(OUT_PATH, `${HEADER}\n`);

let total = 0;
let withArt = 0;
/** @type {string[]} */
const failures = [];

for (const cfg of Object.values(consoles)) {
  const id = String(cfg.id || '');
  if (cfg.preserveCatalog) continue;
  if (onlyConsole && id !== onlyConsole) continue;
  const rawBase = cfg.iaBaseUrl;
  const baseUrls = (Array.isArray(rawBase) ? rawBase : [rawBase]).filter(Boolean).map(String);
  if (!baseUrls.length) continue;

  try {
    const client = new InternetArchiveRoms({
      baseUrl: baseUrls,
      descriptionPrefix: cfg.iaDescriptionPrefix,
      fileExtensions: cfg.iaFileExtensions,
      excludeNames: cfg.iaExcludeNames,
      preferMetadata: true
    });

    /** @type {Array<Record<string, unknown>>} */
    const merged = [];
    const seen = new Set();
    for (const baseUrl of baseUrls) {
      const itemId = client._iaIdentifier(baseUrl);
      if (!itemId) throw new Error(`no Archive item id in ${baseUrl}`);
      console.log(`${id}: fetching ${itemId}…`);
      const meta = await fetchMetadata(itemId);
      const roms = client.parseRomListFromMetadata(meta, baseUrl, null);
      for (const rom of roms) {
        const name = String(rom.name || '');
        if (!name || seen.has(name)) continue;
        seen.add(name);
        merged.push(rom);
      }
    }
    merged.sort((a, b) => String(a.name).localeCompare(String(b.name)));

    const systems = /** @type {string[] | undefined} */ (cfg.iaThumbnailSystems);
    const lines = merged.map((rom) => {
      const name = String(rom.name || '');
      const art = resolveThumbnail(name, systems, thumbnailIndexes, pickThumbnailName, {
        snaps: thumbnailSnaps,
        titles: neoGeoTitles
      });
      if (art) withArt += 1;
      return csvRow([id, name, rom.downloadUrl, art, rom.fileExtension, rom.size]);
    });
    if (lines.length) appendFileSync(OUT_PATH, `${lines.join('\n')}\n`);
    total += lines.length;
    console.log(`${id}: ${lines.length} games`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    failures.push(`${id}: ${message}`);
    console.error(`${id}: ${message}`);
  }
}

if (keptRows.length) {
  appendFileSync(OUT_PATH, `${keptRows.join('\n')}\n`);
  console.log(`kept ${keptRows.length} non-emulator rows (flash and any other console ids)`);
}

console.log(`wrote ${total} games (${withArt} with thumbnails) to ${OUT_PATH}`);
console.log('Import that CSV into Google Sheets, rename the tab to "games",');
console.log('share it as Anyone with the link → Viewer, then paste the spreadsheet');
console.log('id into SHEET_ID at the top of emulator/games-sheet.js.');
if (failures.length) {
  console.error(`failed consoles:\n${failures.join('\n')}`);
  process.exit(1);
}

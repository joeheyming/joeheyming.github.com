// dos/repack.js — convert a raw DOS-game zip into a .jsdos bundle that
// js-dos v8 can launch directly.
//
// A .jsdos bundle is just a regular zip with one extra entry:
//   .jsdos/dosbox.conf   — a DOSBox config whose [autoexec] section
//                          contains the commands run after boot.
//
// For a typical DOS game zip from Internet Archive the layout is:
//     DARKSUN/
//       DARKSUN.EXE
//       INSTALL.EXE
//       …
//
// We pick the most plausible EXE (heuristically, the biggest .exe inside
// the deepest subdirectory that's not named INSTALL / SETUP / README),
// then write an autoexec that does `mount c .`, `c:`, `cd <dir>`, and
// runs the EXE.
//
// If the input zip is already a .jsdos bundle (has .jsdos/dosbox.conf
// or .jsdos/jsdos.json at root) we pass the bytes through unchanged.

/* global JSZip */

const JSDOS_CONF_PATH = '.jsdos/dosbox.conf';
const JSDOS_META_PATH = '.jsdos/jsdos.json';

const EXCLUDED_EXE_NAMES = new Set([
  'INSTALL.EXE',
  'INSTALL.COM',
  'INSTALL.BAT',
  'SETUP.EXE',
  'SETUP.COM',
  'SETUP.BAT',
  'README.EXE',
  'README.COM',
  'README.BAT',
  'UNINSTAL.EXE',
  'UNINSTALL.EXE',
  'HELP.EXE',
  'HELP.COM',
  'HELP.BAT'
]);

const EXECUTABLE_EXTS = new Set(['exe', 'com', 'bat']);

/**
 * @typedef {Object} BundleResult
 * @property {Uint8Array} bytes        The .jsdos zip bytes ready for js-dos.
 * @property {string} bootCommand      Human-readable description of what we boot.
 * @property {string | null} entryExe  Path inside the zip we picked, or null.
 */

/**
 * @typedef {Object} RepackOptions
 * @property {string} [bootHint]  Authoritative boot file path/name
 *   (e.g. "ARENA.BAT" or "GAME/DARKSUN.EXE"). When provided we skip
 *   auto-detection and locate this file inside the zip — typically
 *   sourced from archive.org's `metadata.emulator_start` or a curated
 *   catalog entry. Case-insensitive match.
 */

/**
 * @param {ArrayBuffer | Uint8Array | Blob} input
 * @param {RepackOptions} [options]
 * @returns {Promise<BundleResult>}
 */
export async function repackToJsdos(input, options = {}) {
  if (typeof JSZip === 'undefined') {
    throw new Error('JSZip failed to load — try refreshing.');
  }
  const zip = await JSZip.loadAsync(input);

  // Already a .jsdos bundle? Trust it and pass through.
  if (zip.file(JSDOS_CONF_PATH) || zip.file(JSDOS_META_PATH)) {
    const bytes = await zip.generateAsync({
      type: 'uint8array',
      compression: 'DEFLATE'
    });
    return {
      bytes,
      bootCommand: 'pre-built .jsdos bundle',
      entryExe: null
    };
  }

  const entries = listEntries(zip);
  const candidate = options.bootHint
    ? findHintedEntry(entries, options.bootHint)
    : pickBootCandidate(entries);

  if (!candidate) {
    if (options.bootHint) {
      throw new Error(
        `Boot file "${options.bootHint}" wasn't found inside the zip from archive.org. The item's emulator_start metadata might be wrong.`
      );
    }
    throw new Error(
      'Could not find a .exe/.com/.bat to boot inside the zip. Is this actually a DOS game?'
    );
  }

  const autoexec = buildAutoexec(candidate);
  zip.file(JSDOS_CONF_PATH, autoexec);

  const bytes = await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE'
  });

  return {
    bytes,
    bootCommand: candidate.dir ? `${candidate.dir}\\${candidate.name}` : candidate.name,
    entryExe: candidate.path
  };
}

/**
 * Locate the entry corresponding to an authoritative boot hint.
 * Accepts either a bare filename ("ARENA.BAT") or a path
 * ("DARKSUN/GAME.EXE"); matches case-insensitively against the zip.
 * If the bare name appears in multiple dirs, the shallowest wins —
 * authoritative metadata usually means root-level dispatchers.
 *
 * @param {ZipEntry[]} entries
 * @param {string} hint
 * @returns {ZipEntry | null}
 */
function findHintedEntry(entries, hint) {
  const norm = hint.replace(/\\/g, '/').replace(/^\/+/, '').toUpperCase();
  const exact = entries.find((e) => e.path.toUpperCase() === norm);
  if (exact) return exact;

  const byName = entries
    .filter((e) => e.name === norm.split('/').pop())
    .sort((a, b) => depth(a.dir) - depth(b.dir));
  return byName[0] || null;
}

/**
 * @typedef {Object} ZipEntry
 * @property {string} path   Full path inside the zip (forward slashes).
 * @property {string} dir    Parent directory ("" for root).
 * @property {string} name   File name only, uppercased.
 * @property {string} ext    Extension only, lowercased, no dot.
 * @property {number} size   Uncompressed bytes (best-effort from header).
 */

/**
 * @param {InstanceType<typeof JSZip>} zip
 * @returns {ZipEntry[]}
 */
function listEntries(zip) {
  /** @type {ZipEntry[]} */
  const out = [];
  zip.forEach((relativePath, entry) => {
    if (entry.dir) return;
    const path = relativePath.replace(/\\/g, '/');
    const slash = path.lastIndexOf('/');
    const dir = slash >= 0 ? path.slice(0, slash) : '';
    const name = (slash >= 0 ? path.slice(slash + 1) : path).toUpperCase();
    const dot = name.lastIndexOf('.');
    const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
    const size =
      (entry && entry._data && typeof entry._data.uncompressedSize === 'number'
        ? entry._data.uncompressedSize
        : 0) || 0;
    out.push({ path, dir, name, ext, size });
  });
  return out;
}

/**
 * Heuristic boot pick:
 *   1. Filter to .exe/.com/.bat that are NOT install/setup utilities.
 *   2. Group by directory depth — prefer the deepest non-empty dir, on
 *      the assumption that the game lives in its own subfolder.
 *   3. Within that group, prefer the largest file (the main binary is
 *      almost always bigger than helpers like ATI.COM, MIDI.BAT, etc.).
 *   4. Tiebreak by name — alphabetical, lowercase wins.
 *
 * @param {ZipEntry[]} entries
 * @returns {ZipEntry | null}
 */
function pickBootCandidate(entries) {
  const exes = entries.filter((e) => EXECUTABLE_EXTS.has(e.ext) && !EXCLUDED_EXE_NAMES.has(e.name));
  if (exes.length === 0) {
    // Fall back to any executable, even install/setup, so the user
    // can at least reach the installer.
    const any = entries.filter((e) => EXECUTABLE_EXTS.has(e.ext));
    if (any.length === 0) return null;
    return any.sort((a, b) => b.size - a.size)[0];
  }

  // Prefer the subdirectory most consistent with "the game's home" —
  // the dir with the most .exe/.com files in it. Ties go to the deepest.
  /** @type {Map<string, ZipEntry[]>} */
  const byDir = new Map();
  for (const e of exes) {
    const list = byDir.get(e.dir);
    if (list) list.push(e);
    else byDir.set(e.dir, [e]);
  }

  const ranked = Array.from(byDir.entries()).sort((a, b) => {
    if (b[1].length !== a[1].length) return b[1].length - a[1].length;
    return depth(b[0]) - depth(a[0]);
  });

  const winnerDir = ranked[0][0];
  const winnerExes = byDir.get(winnerDir) || [];
  winnerExes.sort((a, b) => {
    if (b.size !== a.size) return b.size - a.size;
    return a.name.localeCompare(b.name);
  });
  return winnerExes[0] || null;
}

function depth(p) {
  if (!p) return 0;
  let d = 1;
  for (let i = 0; i < p.length; i++) if (p[i] === '/') d++;
  return d;
}

/**
 * Build a DOSBox autoexec section. `mount c .` mounts the zip root as
 * C:, then we cd into the game directory and run the EXE.
 *
 * We include `[cpu]` cycles=auto so games that need a faster CPU
 * (Dark Sun runs cleanest around ~12k cycles, but auto handles it)
 * don't run at 8088 speeds.
 *
 * @param {ZipEntry} candidate
 */
function buildAutoexec(candidate) {
  const dosDir = candidate.dir.replace(/\//g, '\\');
  const lines = ['[cpu]', 'cycles=auto', '', '[autoexec]', 'mount c .', 'c:'];
  if (dosDir) lines.push(`cd "${dosDir}"`);
  lines.push(candidate.name, 'exit');
  return lines.join('\n') + '\n';
}

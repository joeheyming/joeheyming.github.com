// gzip — compress files in place using pako (when available).
//
// Usage:
//   gzip [-c] [-k] [-d] FILE...   compress (default) or decompress with -d
//   gzip -t FILE...               test integrity (decompress, discard)
//
// Notes (jsh):
//   - Compression / decompression uses window.pako (the same lib NES emulation
//     loads from a CDN). If pako isn't on the page, this command fails with a
//     clear message rather than silently no-op.
//   - VFS files are kept as strings; binary content is byte-for-byte preserved
//     because the codepath only ever sees the raw bytes.

import { strToBytes, bytesToStr } from './tar-lib.js';

const GZIP_HELP = `Usage: gzip [OPTION]... FILE...
Compress or uncompress FILEs (default: compress in-place, replacing FILE with FILE.gz).

  -c          write on standard output, keep original files unchanged
  -d          decompress (same as gunzip)
  -k          keep (do not delete) input files
  -t          test compressed file integrity
  -h, --help  display this help and exit

jsh:
  Requires pako (loaded as window.pako) for the actual codec.
`;

function tryGetPako() {
  if (typeof globalThis !== 'undefined' && globalThis.pako) return globalThis.pako;
  if (typeof window !== 'undefined' && /** @type {any} */ (window).pako) {
    return /** @type {any} */ (window).pako;
  }
  return null;
}

function bytesFromContent(content) {
  if (content == null) return new Uint8Array(0);
  if (content instanceof Uint8Array) return content;
  if (Array.isArray(content)) return new Uint8Array(content);
  return strToBytes(String(content));
}

function parseGzipArgv(args, defaultDecompress) {
  let toStdout = false;
  let decompress = !!defaultDecompress;
  let keep = false;
  let test = false;
  const files = [];
  let i = 0;
  while (i < args.length) {
    const a = args[i++];
    if (a === '-h' || a === '--help') return { ok: true, help: true };
    if (a === '--') {
      while (i < args.length) files.push(args[i++]);
      break;
    }
    if (a === '-c' || a === '--stdout' || a === '--to-stdout') {
      toStdout = true;
      continue;
    }
    if (a === '-d' || a === '--decompress' || a === '--uncompress') {
      decompress = true;
      continue;
    }
    if (a === '-k' || a === '--keep') {
      keep = true;
      continue;
    }
    if (a === '-t' || a === '--test') {
      test = true;
      decompress = true;
      continue;
    }
    if (a.startsWith('-') && a.length > 1 && !a.startsWith('--')) {
      for (let j = 1; j < a.length; j++) {
        const c = a[j];
        if (c === 'c') toStdout = true;
        else if (c === 'd') decompress = true;
        else if (c === 'k') keep = true;
        else if (c === 't') {
          test = true;
          decompress = true;
        } else return { ok: false, stderr: `gzip: invalid option -- '${c}'\n`, exitCode: 2 };
      }
      continue;
    }
    files.push(a);
  }
  return { ok: true, toStdout, decompress, keep, test, files };
}

async function processOne(terminal, file, parsed, pako) {
  const abs = terminal.resolvePath(file);
  const item = await terminal.getFileSystemItem(abs);
  if (!item) {
    return { stdout: '', stderr: `gzip: ${file}: No such file or directory\n`, exitCode: 1 };
  }
  if (item.type === 'directory') {
    return { stdout: '', stderr: `gzip: ${file} is a directory -- ignored\n`, exitCode: 1 };
  }
  const bytes = bytesFromContent(item.content);
  let outBytes;
  try {
    outBytes = parsed.decompress ? pako.ungzip(bytes) : pako.gzip(bytes);
  } catch (e) {
    return { stdout: '', stderr: `gzip: ${file}: ${e.message}\n`, exitCode: 1 };
  }
  if (parsed.test) {
    return { stdout: '', stderr: '', exitCode: 0 };
  }
  if (parsed.toStdout) {
    return { stdout: bytesToStr(outBytes), stderr: '', exitCode: 0 };
  }
  // Write to FILE.gz or strip .gz on decompress.
  let dest;
  if (parsed.decompress) {
    if (abs.endsWith('.gz')) dest = abs.slice(0, -3);
    else if (abs.endsWith('.tgz')) dest = abs.slice(0, -4) + '.tar';
    else dest = abs + '.out';
  } else {
    dest = abs + '.gz';
  }
  await terminal.fileSystemDB.createFile(dest, bytesToStr(outBytes), true);
  if (!parsed.keep) {
    try {
      await terminal.fileSystemDB.deleteItem(abs);
    } catch (_) {
      /* ignore */
    }
  }
  return { stdout: '', stderr: '', exitCode: 0 };
}

function makeHandler(defaultDecompress) {
  return async function gzipHandler(terminal, args) {
    const parsed = parseGzipArgv(args || [], defaultDecompress);
    if (parsed.ok === false) {
      return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
    }
    if (parsed.help) return { stdout: GZIP_HELP, stderr: '', exitCode: 0 };
    if (!parsed.files.length) {
      return {
        stdout: '',
        stderr: 'gzip: no input files\n',
        exitCode: 1
      };
    }
    const pako = tryGetPako();
    if (!pako) {
      return {
        stdout: '',
        stderr: 'gzip: pako is not loaded (expected window.pako); load pako.min.js to enable gzip\n',
        exitCode: 1
      };
    }
    let stdout = '';
    let stderr = '';
    let exitCode = 0;
    for (const f of parsed.files) {
      const r = await processOne(terminal, f, parsed, pako);
      stdout += r.stdout;
      stderr += r.stderr;
      if (r.exitCode !== 0) exitCode = r.exitCode;
    }
    return { stdout, stderr, exitCode };
  };
}

export default {
  name: 'gzip',
  handler: makeHandler(false),
  description: 'compress (or, with -d, decompress) files via pako',
  category: 'File System'
};

export { parseGzipArgv, makeHandler };

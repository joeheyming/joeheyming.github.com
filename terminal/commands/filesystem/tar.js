// tar — minimal USTAR archive create / list / extract over the VFS.
//
// Modes:
//   tar cf OUT.tar PATH...   create
//   tar tf IN.tar            list contents
//   tar xf IN.tar [-C DIR]   extract
// Add `z` for transparent gzip (delegates to pako when available, e.g.
// tar czf out.tgz a b / tar xzf in.tgz). When pako isn't loaded the gzip
// step fails with a clear message.

import { packTar, unpackTar, strToBytes, bytesToStr } from './tar-lib.js';

const TAR_HELP = `Usage: tar [MODE] [OPTIONS] [ARCHIVE] [FILE...]
Manipulate USTAR archives over the jsh VFS.

Modes:
  c    create a new archive
  t    list archive contents
  x    extract archive

Flags:
  f FILE   use FILE as the archive (required)
  z        filter through gzip (lazy-loads pako; tar.gz / tgz)
  v        verbose: list each file as it is added or extracted
  -C DIR   change to DIR before reading/writing files (extract / create)
  -h, --help   show this help

jsh:
  ustar headers only (regular files + directories). Symlinks, sparse files,
  ACLs, xattrs, and selinux contexts are not preserved. Numeric uid/gid only.
  gzip requires window.pako (e.g. pako.min.js loaded from CDN).
`;

function joinVfs(a, b) {
  if (a == null || a === '') return b;
  if (a === '/') return '/' + b.replace(/^\/+/, '');
  if (b.startsWith('/')) return b;
  return a.replace(/\/$/, '') + '/' + b;
}

function relTo(base, full) {
  const baseN = base.replace(/\/$/, '');
  if (baseN === '' || baseN === '/') return full.replace(/^\/+/, '');
  if (full === baseN) return '.';
  if (full.startsWith(baseN + '/')) return full.slice(baseN.length + 1);
  return full;
}

function parseTarArgv(args) {
  if (!args || args.length === 0) return { ok: false, stderr: TAR_HELP, exitCode: 1 };
  if (args[0] === '-h' || args[0] === '--help') {
    return { ok: true, help: true };
  }
  let modeStr = args[0];
  let i = 1;
  if (modeStr.startsWith('-') && modeStr.length > 1) modeStr = modeStr.slice(1);
  let mode = null;
  let gzipped = false;
  let verbose = false;
  let needsFileArg = false;
  for (const c of modeStr) {
    if (c === 'c' || c === 't' || c === 'x') mode = c;
    else if (c === 'z') gzipped = true;
    else if (c === 'v') verbose = true;
    else if (c === 'f') needsFileArg = true;
    else return { ok: false, stderr: `tar: unknown option '${c}'\n`, exitCode: 2 };
  }
  if (mode === null) {
    return { ok: false, stderr: 'tar: must specify one of c, t, x\n', exitCode: 2 };
  }
  let archive = null;
  if (needsFileArg) {
    if (i >= args.length) {
      return { ok: false, stderr: "tar: option 'f' requires an argument\n", exitCode: 2 };
    }
    archive = args[i++];
  }
  let cwd = null;
  const operands = [];
  while (i < args.length) {
    const a = args[i];
    if (a === '-C') {
      if (i + 1 >= args.length) {
        return { ok: false, stderr: "tar: option '-C' requires an argument\n", exitCode: 2 };
      }
      cwd = args[i + 1];
      i += 2;
      continue;
    }
    operands.push(a);
    i++;
  }
  if (archive === null) {
    return { ok: false, stderr: 'tar: archive file required (use f option)\n', exitCode: 2 };
  }
  return { ok: true, mode, gzipped, verbose, archive, cwd, operands };
}

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
  // Treat as text (strings stored in the VFS).
  return strToBytes(String(content));
}

async function gatherEntries(terminal, paths, baseCwd) {
  const entries = [];
  for (const p of paths) {
    const abs = terminal.resolvePath(p);
    const item = await terminal.getFileSystemItem(abs);
    if (!item) {
      throw new Error(`tar: cannot stat '${p}': No such file or directory`);
    }
    async function walk(absPath, relName) {
      const it = await terminal.getFileSystemItem(absPath);
      if (!it) return;
      if (it.type === 'directory') {
        entries.push({
          name: relName,
          type: 'directory',
          mode: it.mode,
          mtime: it.modified ? Math.floor(new Date(it.modified).getTime() / 1000) : undefined,
          size: 0
        });
        const children = await terminal.listDirectoryContents(absPath);
        for (const c of children) {
          const childName = terminal.fileSystemDB.getFileName(c.path);
          await walk(c.path, relName ? `${relName}/${childName}` : childName);
        }
        return;
      }
      const data = bytesFromContent(it.content);
      entries.push({
        name: relName,
        type: 'file',
        mode: it.mode,
        mtime: it.modified ? Math.floor(new Date(it.modified).getTime() / 1000) : undefined,
        size: data.length,
        data
      });
    }
    // Top-level: include the basename so tar cf out.tar dir/ creates entries
    // under "dir/...".
    const base = terminal.fileSystemDB.getFileName(abs) || abs;
    await walk(abs, base);
  }
  return entries;
}

async function tarCreate(terminal, parsed) {
  const archiveAbs = terminal.resolvePath(parsed.archive);
  const startingCwd = parsed.cwd ? terminal.resolvePath(parsed.cwd) : terminal.cwd;
  // For -C: temporarily resolve paths relative to cwd by changing terminal.cwd
  // briefly. Simpler: just join with startingCwd manually.
  const paths = parsed.operands.map((p) =>
    p.startsWith('/') ? p : joinVfs(startingCwd, p)
  );
  let entries;
  try {
    entries = await gatherEntries(terminal, paths, startingCwd);
  } catch (e) {
    return { stdout: '', stderr: e.message + '\n', exitCode: 1 };
  }
  let bytes = packTar(entries);
  if (parsed.gzipped) {
    const pako = tryGetPako();
    if (!pako) {
      return {
        stdout: '',
        stderr: 'tar: gzip requested but pako is not loaded (window.pako)\n',
        exitCode: 1
      };
    }
    bytes = pako.gzip(bytes);
  }
  await terminal.fileSystemDB.createFile(archiveAbs, bytes, true);
  let stdout = '';
  if (parsed.verbose) {
    stdout = entries.map((e) => e.name + (e.type === 'directory' ? '/' : '')).join('\n') + '\n';
  }
  return { stdout, stderr: '', exitCode: 0 };
}

async function loadArchiveBytes(terminal, parsed) {
  const archiveAbs = terminal.resolvePath(parsed.archive);
  const item = await terminal.getFileSystemItem(archiveAbs);
  if (!item) {
    throw new Error(`tar: ${parsed.archive}: Cannot open: No such file or directory`);
  }
  let bytes = bytesFromContent(item.content);
  if (parsed.gzipped) {
    const pako = tryGetPako();
    if (!pako) {
      throw new Error('tar: gzip requested but pako is not loaded (window.pako)');
    }
    bytes = pako.ungzip(bytes);
  }
  return bytes;
}

async function tarList(terminal, parsed) {
  let bytes;
  try {
    bytes = await loadArchiveBytes(terminal, parsed);
  } catch (e) {
    return { stdout: '', stderr: e.message + '\n', exitCode: 1 };
  }
  const entries = unpackTar(bytes);
  const lines = entries.map((e) => (e.type === 'directory' ? e.name + '/' : e.name));
  return { stdout: lines.join('\n') + (lines.length ? '\n' : ''), stderr: '', exitCode: 0 };
}

async function tarExtract(terminal, parsed) {
  let bytes;
  try {
    bytes = await loadArchiveBytes(terminal, parsed);
  } catch (e) {
    return { stdout: '', stderr: e.message + '\n', exitCode: 1 };
  }
  const entries = unpackTar(bytes);
  const baseDir = parsed.cwd ? terminal.resolvePath(parsed.cwd) : terminal.cwd;
  const outNames = [];
  for (const entry of entries) {
    const dest = joinVfs(baseDir, entry.name);
    if (entry.type === 'directory') {
      try {
        await terminal.fileSystemDB.createDirectory(dest);
      } catch (_) {
        /* may already exist */
      }
    } else {
      // Make sure parent exists.
      const parent = dest.slice(0, dest.lastIndexOf('/')) || '/';
      try {
        await terminal.fileSystemDB.createDirectory(parent);
      } catch (_) {
        /* may already exist */
      }
      // Stored as string for VFS readability; binary content survives as bytes.
      const content = entry.data ? bytesToStr(entry.data) : '';
      await terminal.fileSystemDB.createFile(dest, content, true);
    }
    if (parsed.verbose) outNames.push(entry.name + (entry.type === 'directory' ? '/' : ''));
  }
  return {
    stdout: parsed.verbose ? outNames.join('\n') + '\n' : '',
    stderr: '',
    exitCode: 0
  };
}

async function tarHandler(terminal, args) {
  const parsed = parseTarArgv(args);
  if (parsed.ok === false) {
    return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
  }
  if (parsed.help) return { stdout: TAR_HELP, stderr: '', exitCode: 0 };
  if (parsed.mode === 'c') return tarCreate(terminal, parsed);
  if (parsed.mode === 't') return tarList(terminal, parsed);
  if (parsed.mode === 'x') return tarExtract(terminal, parsed);
  return { stdout: '', stderr: 'tar: unknown mode\n', exitCode: 2 };
}

export default {
  name: 'tar',
  handler: tarHandler,
  description: 'create / list / extract USTAR archives (c, t, x, f, z, v, -C)',
  category: 'File System'
};

export { parseTarArgv };

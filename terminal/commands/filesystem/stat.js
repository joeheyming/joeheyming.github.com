// stat — display virtual file status (GNU-like summary)
(function () {
  'use strict';

  function shellSingleQuote(s) {
    return `'${String(s).replace(/'/g, "'\\''")}'`;
  }

  function dirnameVirtual(p) {
    if (p == null || p === '' || p === '/') {
      return '/';
    }
    const i = p.lastIndexOf('/');
    if (i <= 0) {
      return '/';
    }
    return p.slice(0, i) || '/';
  }

  function typeLabel(type) {
    if (type === 'directory') {
      return 'directory';
    }
    if (type === 'symlink') {
      return 'symbolic link';
    }
    if (type === 'device') {
      return 'character special file';
    }
    return 'regular file';
  }

  function firstModeChar(type) {
    if (type === 'directory') {
      return 'd';
    }
    if (type === 'symlink') {
      return 'l';
    }
    if (type === 'device') {
      return 'c';
    }
    return '-';
  }

  function modeToRwx(mode, type) {
    const m = (mode & 0o777) >>> 0;
    const r = (b) => (b & 4 ? 'r' : '-');
    const w = (b) => (b & 2 ? 'w' : '-');
    const x = (b) => (b & 1 ? 'x' : '-');
    const u = (m >> 6) & 7;
    const g = (m >> 3) & 7;
    const o = m & 7;
    const fc = firstModeChar(type);
    return `${fc}${r(u)}${w(u)}${x(u)}${r(g)}${w(g)}${x(g)}${r(o)}${w(o)}${x(o)}`;
  }

  function formatTs(stats) {
    const raw = stats.modified != null ? stats.modified : stats.mtime;
    if (raw == null) {
      return 'unknown';
    }
    const d = raw instanceof Date ? raw : new Date(raw);
    if (Number.isNaN(d.getTime())) {
      return 'unknown';
    }
    return d
      .toISOString()
      .replace('T', ' ')
      .replace(/\.\d{3}Z$/, '.000000000 +0000');
  }

  function formatBlock(stats, fullPath, terminal) {
    const user = terminal.env.USER || 'user';
    const uid = stats.uid != null ? stats.uid : 1000;
    const gid = stats.gid != null ? stats.gid : 1000;
    const mode =
      stats.mode != null
        ? stats.mode
        : stats.type === 'directory'
        ? 0o755
        : stats.type === 'symlink'
        ? 0o777
        : 0o644;
    const size = stats.size != null ? stats.size : 0;
    const blocks = size === 0 ? 0 : Math.ceil(size / 512);
    const label = typeLabel(stats.type);
    let fileLine = `  File: ${fullPath}`;
    if (stats.type === 'symlink' && stats.target != null) {
      fileLine = `  File: ${fullPath} -> ${shellSingleQuote(stats.target)}`;
    }
    const oct = ((mode & 0o777) >>> 0).toString(8).padStart(4, '0');
    const rwx = modeToRwx(mode, stats.type);
    const ts = formatTs(stats);
    return [
      fileLine,
      `  Size: ${String(size).padEnd(11)}\tBlocks: ${String(blocks).padEnd(
        11
      )} IO Block: 4096   ${label}`,
      `Device: 0,0\tInode: 0          Links: 1`,
      `Access: (${oct}/${rwx})  Uid: (${uid}/${user})   Gid: (${gid}/${user})`,
      `Access: ${ts}`,
      `Modify: ${ts}`,
      `Change: ${ts}`,
      ''
    ].join('\n');
  }

  async function resolveStat(terminal, operand, dereference) {
    let fullPath = terminal.resolvePath(operand);
    const visited = new Set();
    for (let depth = 0; depth < 32; depth++) {
      if (visited.has(fullPath)) {
        return {
          ok: false,
          stderr: `stat: cannot stat '${operand}': Too many levels of symbolic links\n`
        };
      }
      visited.add(fullPath);
      let stats;
      try {
        stats = await terminal.syscall('stat', fullPath);
      } catch (e) {
        const msg = e && e.message ? String(e.message) : String(e);
        if (msg.includes('not found') || msg.includes('File not found')) {
          return {
            ok: false,
            stderr: `stat: cannot stat '${operand}': No such file or directory\n`
          };
        }
        if (msg.includes('Permission denied')) {
          return { ok: false, stderr: `stat: cannot stat '${operand}': Permission denied\n` };
        }
        return { ok: false, stderr: `stat: ${operand}: ${msg}\n` };
      }
      if (!stats) {
        return {
          ok: false,
          stderr: `stat: cannot stat '${operand}': No such file or directory\n`
        };
      }
      if (!dereference || stats.type !== 'symlink') {
        return { ok: true, text: formatBlock(stats, fullPath, terminal) };
      }
      const raw = stats.target;
      if (raw == null || String(raw).trim() === '') {
        return { ok: false, stderr: `stat: cannot stat '${operand}': Invalid argument\n` };
      }
      const parent = dirnameVirtual(fullPath);
      fullPath = ShellCore.resolveVirtualPath(String(raw).trim(), parent);
    }
    return {
      ok: false,
      stderr: `stat: cannot stat '${operand}': Too many levels of symbolic links\n`
    };
  }

  registerCommand(
    'stat',
    async (terminal, args) => {
      const parsed = StatLib.parseStatArgv(args);
      if (parsed.ok === false) {
        return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
      }
      if (parsed.help) {
        return { stdout: StatLib.STAT_HELP, stderr: '', exitCode: 0 };
      }
      const { dereference, operands } = parsed;
      const out = [];
      const err = [];
      let anyErr = false;
      for (const op of operands) {
        const r = await resolveStat(terminal, op, dereference);
        if (r.ok) {
          out.push(r.text);
        } else {
          err.push(r.stderr);
          anyErr = true;
        }
      }
      return {
        stdout: out.join(''),
        stderr: err.join(''),
        exitCode: anyErr ? 1 : 0
      };
    },
    'display file or file system status',
    'File System'
  );
})();

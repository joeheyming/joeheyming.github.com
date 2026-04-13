// test / [ — POSIX-style conditional (subset)
(function () {
  'use strict';

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

  function errPrefix(progName) {
    return progName === '[' ? '[: ' : 'test: ';
  }

  /**
   * Follow symlink chain; final stat or missing (GNU-like for -e/-f/-d).
   * @returns {Promise<{ ok: true, stats: object } | { ok: false }>}
   */
  async function statDeref(terminal, operand) {
    let fullPath = terminal.resolvePath(operand);
    const visited = new Set();
    for (let depth = 0; depth < 32; depth++) {
      if (visited.has(fullPath)) {
        return { ok: false };
      }
      visited.add(fullPath);
      let stats;
      try {
        stats = await terminal.syscall('stat', fullPath);
      } catch {
        return { ok: false };
      }
      if (!stats) {
        return { ok: false };
      }
      if (stats.type !== 'symlink') {
        return { ok: true, stats };
      }
      const raw = stats.target;
      if (raw == null || String(raw).trim() === '') {
        return { ok: false };
      }
      const parent = dirnameVirtual(fullPath);
      fullPath = ShellCore.resolveVirtualPath(String(raw).trim(), parent);
    }
    return { ok: false };
  }

  async function statLstat(terminal, operand) {
    const fullPath = terminal.resolvePath(operand);
    try {
      const stats = await terminal.syscall('stat', fullPath);
      return stats || null;
    } catch {
      return null;
    }
  }

  async function unaryFile(terminal, op, operand, progName) {
    const pfx = errPrefix(progName);
    if (op === '-n') {
      return operand !== '';
    }
    if (op === '-z') {
      return operand === '';
    }
    if (op === '-e' || op === '-f' || op === '-d') {
      const deref = await statDeref(terminal, operand);
      if (op === '-e') {
        return deref.ok;
      }
      if (op === '-f') {
        return deref.ok && deref.stats.type === 'file';
      }
      return deref.ok && deref.stats.type === 'directory';
    }
    if (op === '-L' || op === '-h') {
      const link = await statLstat(terminal, operand);
      return link != null && link.type === 'symlink';
    }
    return {
      error: `${pfx}${op}: unary operator expected\n`,
      exitCode: 2
    };
  }

  async function evalExpr(terminal, args, progName) {
    if (args.length === 0) {
      return { ok: true, value: false };
    }
    if (args[0] === '!') {
      const inner = await evalExpr(terminal, args.slice(1), progName);
      if (inner.ok === false) {
        return inner;
      }
      return { ok: true, value: !inner.value };
    }

    const n = args.length;
    if (n === 1) {
      return { ok: true, value: args[0] !== '' };
    }
    if (n === 2) {
      const op = args[0];
      const operand = args[1];
      const u = await unaryFile(terminal, op, operand, progName);
      if (u && typeof u === 'object' && 'error' in u) {
        return { ok: false, stderr: u.error, exitCode: u.exitCode };
      }
      return { ok: true, value: u };
    }
    if (n === 3) {
      const mid = args[1];
      if (mid === '=') {
        return { ok: true, value: args[0] === args[2] };
      }
      if (mid === '!=') {
        return { ok: true, value: args[0] !== args[2] };
      }
      const pfx = errPrefix(progName);
      return {
        ok: false,
        stderr: `${pfx}${mid}: binary operator expected\n`,
        exitCode: 2
      };
    }

    const pfx = errPrefix(progName);
    return {
      ok: false,
      stderr: `${pfx}too many arguments\n`,
      exitCode: 2
    };
  }

  async function runTest(terminal, args, progName) {
    let exprArgs = Array.isArray(args) ? args.slice() : [];

    if (progName === '[') {
      if (exprArgs.length === 0) {
        return { stdout: '', stderr: "[: missing `]'\n", exitCode: 2 };
      }
      if (exprArgs[exprArgs.length - 1] !== ']') {
        return { stdout: '', stderr: "[: missing `]'\n", exitCode: 2 };
      }
      exprArgs = exprArgs.slice(0, -1);
    }

    const parsed = TestLib.parseTestArgv(exprArgs);
    if (parsed.ok === false) {
      return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
    }
    if (parsed.help) {
      return { stdout: TestLib.TEST_HELP, stderr: '', exitCode: 0 };
    }
    if (parsed.version) {
      return { stdout: TestLib.TEST_VERSION_LINE, stderr: '', exitCode: 0 };
    }

    const ev = await evalExpr(terminal, exprArgs, progName);
    if (ev.ok === false) {
      return { stdout: '', stderr: ev.stderr, exitCode: ev.exitCode };
    }
    return { stdout: '', stderr: '', exitCode: ev.value ? 0 : 1 };
  }

  registerCommand(
    'test',
    async (terminal, args) => runTest(terminal, args, 'test'),
    'evaluate a conditional expression (POSIX subset)',
    'System'
  );
  registerCommand(
    '[',
    async (terminal, args) => runTest(terminal, args, '['),
    'evaluate a conditional expression (POSIX subset)',
    'System'
  );
})();

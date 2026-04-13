'use strict';

/**
 * Shell core infrastructure — the minimal set of pure functions that the
 * shell itself (terminal.js) and the pipeline runner depend on.
 *
 * Loaded as a global before terminal.js. Commands should NOT import from
 * here directly — use the ProcessContext convenience methods instead.
 */

// ---------------------------------------------------------------------------
// POSIX exit code constants
// ---------------------------------------------------------------------------

const EXIT_SUCCESS = 0;
const EXIT_FAILURE = 1;
const EXIT_USAGE = 2;
const EXIT_NOEXEC = 126;
const EXIT_NOTFOUND = 127;

/** @param {number} signum @returns {number} */
function EXIT_SIGNAL(signum) {
  return 128 + signum;
}

// POSIX signal numbers (for EXIT_SIGNAL)
const SIG = {
  HUP: 1,
  INT: 2,
  QUIT: 3,
  ILL: 4,
  TRAP: 5,
  ABRT: 6,
  FPE: 8,
  KILL: 9,
  SEGV: 11,
  PIPE: 13,
  ALRM: 14,
  TERM: 15,
  CHLD: 17,
  CONT: 18,
  STOP: 19,
  TSTP: 20
};

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

/**
 * Canonical absolute path (Unix-style): resolves `.`, `..`, duplicate slashes.
 * @param {string} path
 * @param {string} [cwd='/']
 * @returns {string}
 */
function resolveVirtualPath(path, cwd) {
  const CWD = normalizeCwdForResolve(cwd);
  if (path == null || path === '') return CWD;
  let absolute;
  if (path.startsWith('/')) {
    absolute = path;
  } else {
    absolute = CWD === '/' ? `/${path}` : `${CWD}/${path}`;
  }
  const parts = absolute.split('/').filter((p) => p !== '');
  const stack = [];
  for (const part of parts) {
    if (part === '.' || part === '') continue;
    if (part === '..') {
      if (stack.length > 0) stack.pop();
    } else {
      stack.push(part);
    }
  }
  return stack.length === 0 ? '/' : '/' + stack.join('/');
}

function normalizeCwdForResolve(cwd) {
  if (cwd == null || cwd === '') return '/';
  let c = cwd.startsWith('/') ? cwd : `/${cwd}`;
  while (c.length > 1 && c.endsWith('/')) c = c.slice(0, -1);
  return c;
}

// ---------------------------------------------------------------------------
// String coercion
// ---------------------------------------------------------------------------

/** Ensure pipeline / addOutput always receive a string. */
function coerceShellString(value) {
  if (value == null) return '';
  const t = typeof value;
  if (t === 'string') return value;
  if (t === 'number' || t === 'boolean' || t === 'bigint') return String(value);
  if (Array.isArray(value)) return value.map((x) => (x == null ? '' : String(x))).join('\n');
  return String(value);
}

// ---------------------------------------------------------------------------
// Redirect helpers
// ---------------------------------------------------------------------------

function normalizeRedirectFilename(token) {
  if (token == null) return '';
  const s = String(token);
  if (
    s.length >= 2 &&
    ((s[0] === '"' && s[s.length - 1] === '"') || (s[0] === "'" && s[s.length - 1] === "'"))
  ) {
    return s.slice(1, -1);
  }
  return s;
}

function isEmptyRedirectTarget(token) {
  return normalizeRedirectFilename(token) === '';
}

// ---------------------------------------------------------------------------
// Shell list splitting (&&, ||, ;)
// ---------------------------------------------------------------------------

/**
 * @param {string} line
 * @returns {{ ok: true, pipelines: string[], ops: string[] } | { ok: false, error: string }}
 */
function splitShellList(line) {
  if (line == null || line === '') return { ok: true, pipelines: [''], ops: [] };
  const pipelines = [];
  const ops = [];
  let current = '';
  let inQuotes = false;
  let quoteChar = '';
  const s = String(line);
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if ((c === '"' || c === "'") && (!inQuotes || c === quoteChar)) {
      if (!inQuotes) {
        inQuotes = true;
        quoteChar = c;
      } else if (c === quoteChar) {
        inQuotes = false;
        quoteChar = '';
      }
      current += c;
      continue;
    }
    if (!inQuotes) {
      if (c === '&' && s[i + 1] === '&') {
        pipelines.push(current.trim());
        ops.push('&&');
        current = '';
        i += 1;
        continue;
      }
      if (c === '|' && s[i + 1] === '|') {
        pipelines.push(current.trim());
        ops.push('||');
        current = '';
        i += 1;
        continue;
      }
      if (c === ';') {
        pipelines.push(current.trim());
        ops.push(';');
        current = '';
        continue;
      }
    }
    current += c;
  }
  pipelines.push(current.trim());
  for (let i = 0; i < pipelines.length; i++) {
    const p = pipelines[i];
    if (p !== '') continue;
    if (i === 0) {
      if (ops[0] === '&&' || ops[0] === '||')
        return { ok: false, error: 'jsh: syntax error: expression expected before && or ||' };
      continue;
    }
    const prevOp = ops[i - 1];
    if (prevOp === ';') continue;
    if (prevOp === '&&' || prevOp === '||')
      return { ok: false, error: 'jsh: syntax error: expression expected after && or ||' };
  }
  return { ok: true, pipelines, ops };
}

// ---------------------------------------------------------------------------
// Token merging
// ---------------------------------------------------------------------------

function mergeRedirectDupStderrTokens(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === '2>' && tokens[i + 1] === '&1') {
      out.push('2>&1');
      i++;
    } else out.push(tokens[i]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Command result normalization
// ---------------------------------------------------------------------------

function normalizeCommandResult(stdout, stderr, exitCode) {
  const out = coerceShellString(stdout);
  const err = coerceShellString(stderr);
  const code = exitCode !== undefined && exitCode !== null ? exitCode : err.length > 0 ? 1 : 0;
  return { stdout: out, stderr: err, exitCode: code };
}

function normalizeHandlerResult(output) {
  if (output === null || output === undefined)
    return { stdout: '', stderr: '', exitCode: undefined };
  if (typeof output === 'string') return { stdout: output, stderr: '', exitCode: undefined };
  if (typeof output !== 'object' || Array.isArray(output))
    return { stdout: String(output), stderr: '', exitCode: undefined };
  const has =
    Object.prototype.hasOwnProperty.call(output, 'stdout') ||
    Object.prototype.hasOwnProperty.call(output, 'stderr') ||
    Object.prototype.hasOwnProperty.call(output, 'exitCode');
  if (!has) return { stdout: String(output), stderr: '', exitCode: undefined };
  return {
    stdout: output.stdout != null ? String(output.stdout) : '',
    stderr: output.stderr != null ? String(output.stderr) : '',
    exitCode: output.exitCode
  };
}

function normalizeExitByte(n) {
  if (n == null || !Number.isFinite(Number(n))) return 0;
  const t = Math.trunc(Number(n));
  return ((t % 256) + 256) % 256;
}

/**
 * Parse `exit [n]` operands (bash-like). Used by the exit builtin and tests.
 *
 * @param {string[]} args - Command args after `exit`
 * @param {number} [lastExitCode=0] - Value of `$?` before this command
 * @returns {{ ok: true, help?: boolean, status: number } | { ok: false, stderr: string, exitCode: number }}
 */
function parseExitStatus(args, lastExitCode) {
  const argsArr = Array.isArray(args) ? args : [];
  const lc = normalizeExitByte(lastExitCode);

  if (argsArr.length === 0) {
    return { ok: true, status: lc };
  }
  if (argsArr[0] === '--help') {
    if (argsArr.length !== 1) {
      return { ok: false, stderr: 'exit: too many arguments', exitCode: 1 };
    }
    return { ok: true, help: true, status: 0 };
  }
  let i = 0;
  if (argsArr[0] === '--') {
    i = 1;
    if (i >= argsArr.length) {
      return { ok: true, status: lc };
    }
  }
  if (argsArr.length - i > 1) {
    return { ok: false, stderr: 'exit: too many arguments', exitCode: 1 };
  }
  const word = argsArr[i];
  if (word == null || word === '') {
    return { ok: false, stderr: 'exit: : numeric argument required', exitCode: 2 };
  }
  if (!/^-?\d+$/.test(word)) {
    return { ok: false, stderr: `exit: ${word}: numeric argument required`, exitCode: 2 };
  }
  const n = parseInt(word, 10);
  const status = ((n % 256) + 256) % 256;
  return { ok: true, status };
}

/** Usage text for the jsh `help` builtin (see terminal.js). */
const HELP_USAGE = `help: usage: help [-h | --help] [--] [topic]

  -h, --help    Show this help
  topic         Show description for one registered command (if known)`;

/**
 * Parse argv for the `help` builtin.
 *
 * @param {string[]} argv
 * @returns {{ ok: true, sawHelpFlag: boolean, rest: string[] } | { ok: false, stderr: string, exitCode: number }}
 */
function parseHelpArgs(argv) {
  const argsArr = Array.isArray(argv) ? argv : [];
  let i = 0;
  let sawHelp = false;
  while (i < argsArr.length) {
    const a = argsArr[i];
    if (a === '--') {
      i++;
      break;
    }
    if (a === '--help' || a === '-h') {
      sawHelp = true;
      i++;
      continue;
    }
    if (a.startsWith('-') && a.length > 1) {
      const bad = a.slice(1);
      return {
        ok: false,
        stderr: `help: invalid option -- '${bad}'\n${HELP_USAGE}`,
        exitCode: 2
      };
    }
    break;
  }
  const rest = argsArr.slice(i);
  if (sawHelp && rest.length > 0) {
    return { ok: false, stderr: 'help: too many arguments', exitCode: 1 };
  }
  if (sawHelp) {
    return { ok: true, sawHelpFlag: true, rest: [] };
  }
  if (rest.length > 1) {
    return { ok: false, stderr: 'help: too many arguments', exitCode: 1 };
  }
  return { ok: true, sawHelpFlag: false, rest };
}

/** Usage line for `kill` (stderr) when operands are wrong. */
const KILL_USAGE =
  'kill: usage: kill [-s sigspec | -n signum | -sigspec] pid | jobspec ... or kill -l [sigspec]\n';

/**
 * Parse jsh `kill` argv (subset: numeric PIDs only; no jobspec).
 *
 * @param {string[]} args
 * @returns {{ kind: 'usage', stderr: string, exitCode: number }
 *   | { kind: 'list' }
 *   | { kind: 'run', signal: string, pids: number[] }
 *   | { kind: 'error', stderr: string, exitCode: number }}
 */
function parseKillArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  if (argsArr.length === 0) {
    return { kind: 'usage', stderr: KILL_USAGE, exitCode: 1 };
  }
  if (argsArr.includes('-l')) {
    return { kind: 'list' };
  }
  let signal = 'SIGTERM';
  const pids = [];
  for (let i = 0; i < argsArr.length; i++) {
    const arg = argsArr[i];
    if (arg.startsWith('-')) {
      if (arg === '-9' || arg === '-KILL') {
        signal = 'SIGKILL';
      } else if (arg === '-15' || arg === '-TERM') {
        signal = 'SIGTERM';
      } else if (arg === '-1' || arg === '-HUP') {
        signal = 'SIGHUP';
      } else if (arg === '-2' || arg === '-INT') {
        signal = 'SIGINT';
      } else {
        return {
          kind: 'error',
          stderr: `kill: invalid signal specification '${arg}'\n`,
          exitCode: 1
        };
      }
    } else {
      const pid = parseInt(arg, 10);
      if (Number.isNaN(pid)) {
        return {
          kind: 'error',
          stderr: `kill: '${arg}': arguments must be process or job IDs\n`,
          exitCode: 1
        };
      }
      pids.push(pid);
    }
  }
  if (pids.length === 0) {
    return { kind: 'usage', stderr: KILL_USAGE, exitCode: 1 };
  }
  return { kind: 'run', signal, pids };
}

/**
 * Escape a string for use inside bash double quotes in `declare -x` / `export -p` output.
 * @param {string} value
 * @returns {string}
 */
function escapeBashDoubleQuotedContent(value) {
  const s = value == null ? '' : String(value);
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

/**
 * One line of bash-style `declare -x NAME="value"` (as used by `export -p`).
 * @param {string} key
 * @param {string} value
 * @returns {string}
 */
function formatDeclareXLine(key, value) {
  return `declare -x ${key}="${escapeBashDoubleQuotedContent(value)}"`;
}

/**
 * Escape alias text for bash-style `type` output (backticks).
 * @param {string} s
 * @returns {string}
 */
function escapeTypeAliasBody(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/`/g, '\\`');
}

// ---------------------------------------------------------------------------
// Variable expansion
// ---------------------------------------------------------------------------

function expandVariablesInString(str, env, lastExitCode) {
  if (str == null) return '';
  const s = typeof str === 'string' ? str : String(str);
  const e = env && typeof env === 'object' ? env : {};
  const lc = lastExitCode !== undefined && lastExitCode !== null ? lastExitCode : 0;
  return s
    .replace(/\$\?/g, () => String(lc))
    .replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, varName) => e[varName] ?? '')
    .replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, varName) => e[varName] ?? '');
}

// ---------------------------------------------------------------------------
// Signal / fetch helpers
// ---------------------------------------------------------------------------

function combinedFetchSignal(timeoutMs, userSignal) {
  const t = AbortSignal.timeout(timeoutMs);
  if (!userSignal) return t;
  if (typeof (/** @type {*} */ (AbortSignal).any) === 'function')
    return /** @type {*} */ (AbortSignal).any([t, userSignal]);
  const c = new AbortController();
  const bust = () => {
    try {
      c.abort();
    } catch (_) {
      /* ignore */
    }
  };
  t.addEventListener('abort', bust);
  userSignal.addEventListener('abort', bust);
  return c.signal;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

const ShellCore = {
  // POSIX exit codes
  EXIT_SUCCESS,
  EXIT_FAILURE,
  EXIT_USAGE,
  EXIT_NOEXEC,
  EXIT_NOTFOUND,
  EXIT_SIGNAL,
  SIG,

  // Core functions
  resolveVirtualPath,
  coerceShellString,
  normalizeRedirectFilename,
  isEmptyRedirectTarget,
  splitShellList,
  mergeRedirectDupStderrTokens,
  normalizeCommandResult,
  normalizeHandlerResult,
  normalizeExitByte,
  parseExitStatus,
  HELP_USAGE,
  parseHelpArgs,
  KILL_USAGE,
  parseKillArgv,
  escapeBashDoubleQuotedContent,
  formatDeclareXLine,
  escapeTypeAliasBody,
  expandVariablesInString,
  combinedFetchSignal
};

if (typeof globalThis !== 'undefined') {
  /** @type {*} */ (globalThis).ShellCore = ShellCore;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ShellCore;
}

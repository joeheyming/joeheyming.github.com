/**
 * Shell core infrastructure — the minimal set of pure functions that the
 * shell itself (terminal.js) and the pipeline runner depend on.
 *
 * Consumed via ES module imports. Commands should NOT import from here
 * directly — use the ProcessContext convenience methods instead.
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
  let parenDepth = 0;
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
      if (c === '(') {
        parenDepth++;
        current += c;
        continue;
      }
      if (c === ')') {
        parenDepth = Math.max(0, parenDepth - 1);
        current += c;
        continue;
      }
      if (parenDepth === 0 && c === '&' && s[i + 1] === '&') {
        pipelines.push(current.trim());
        ops.push('&&');
        current = '';
        i += 1;
        continue;
      }
      if (parenDepth === 0 && c === '|' && s[i + 1] === '|') {
        pipelines.push(current.trim());
        ops.push('||');
        current = '';
        i += 1;
        continue;
      }
      if (parenDepth === 0 && c === ';') {
        pipelines.push(current.trim());
        ops.push(';');
        current = '';
        continue;
      }
      // Bare `&` (not `&&`) → background separator.
      if (parenDepth === 0 && c === '&' && s[i + 1] !== '&') {
        pipelines.push(current.trim());
        ops.push('&');
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
    if (prevOp === ';' || prevOp === '&') continue;
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
// Variable expansion (bash-style: $VAR, ${VAR}, ${VAR:-d}, ${VAR%pat}, ${#VAR})
// ---------------------------------------------------------------------------

/**
 * Find matching closing brace, accounting for nested ${...} groups.
 * @param {string} s
 * @param {number} start - index of the opening `{`
 * @returns {number} index of matching `}`, or -1 if not found
 */
function findMatchingBrace(s, start) {
  let depth = 1;
  for (let i = start + 1; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '$' && s[i + 1] === '{') {
      depth++;
      i++;
      continue;
    }
    if (c === '{') {
      depth++;
      continue;
    }
    if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Convert a shell glob-ish pattern (with *, ?, [...]) to a JS RegExp source
 * suitable for matching a single word in parameter-expansion patterns
 * like `${VAR#pat}` / `${VAR%pat}`.
 * @param {string} pat
 * @returns {string}
 */
function shellPatternToRegexSrc(pat) {
  let src = '';
  for (let i = 0; i < pat.length; i++) {
    const c = pat[i];
    if (c === '\\' && i + 1 < pat.length) {
      src += pat[i + 1].replace(/[\\^$.|?*+()[\]{}]/g, '\\$&');
      i++;
      continue;
    }
    if (c === '*') {
      src += '.*';
      continue;
    }
    if (c === '?') {
      src += '.';
      continue;
    }
    if (c === '[') {
      let end = pat.indexOf(']', i + 1);
      if (end === -1) {
        src += '\\[';
        continue;
      }
      src += pat.slice(i, end + 1);
      i = end;
      continue;
    }
    src += c.replace(/[\\^$.|?*+()[\]{}]/g, '\\$&');
  }
  return src;
}

/**
 * Compile a shell glob pattern (`*`, `?`, `[abc]`, `[!abc]`) into an anchored
 * RegExp that matches the whole string. Convenience wrapper around
 * `shellPatternToRegexSrc` for callers that want a ready-to-use regex.
 * @param {string} pattern
 * @param {string} [flags]
 * @returns {RegExp}
 */
function shellPatternToRegex(pattern, flags = '') {
  return new RegExp('^' + shellPatternToRegexSrc(pattern) + '$', flags);
}

/**
 * Strip the longest/shortest matching prefix/suffix using a shell glob pattern.
 * @param {string} value
 * @param {string} pattern
 * @param {'prefix'|'suffix'} side
 * @param {boolean} longest
 * @returns {string}
 */
function trimPattern(value, pattern, side, longest) {
  if (!pattern) return value;
  const src = shellPatternToRegexSrc(pattern);
  if (side === 'prefix') {
    const re = new RegExp('^' + (longest ? src : src.replace(/\.\*/g, '.*?')));
    const m = re.exec(value);
    if (!m) return value;
    return value.slice(m[0].length);
  }
  const re = new RegExp((longest ? src : src.replace(/\.\*/g, '.*?')) + '$');
  if (longest) {
    const m = re.exec(value);
    if (!m) return value;
    return value.slice(0, value.length - m[0].length);
  }
  // shortest suffix: find the largest i where value.slice(i) fully matches
  const r = new RegExp('^' + src.replace(/\.\*/g, '.*?') + '$');
  for (let i = value.length; i >= 0; i--) {
    const tail = value.slice(i);
    if (r.test(tail)) return value.slice(0, i);
  }
  return value;
}

/**
 * Evaluate one ${...} parameter expansion.
 * @param {string} body - content between `${` and `}`
 * @param {Record<string,string>} env
 * @param {number} lastExitCode
 * @returns {string}
 */
function evalParamExpansion(body, env, lastExitCode) {
  // ${#VAR} — length
  if (body.startsWith('#') && body.length > 1) {
    const name = body.slice(1);
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      const v = env[name];
      return String((v == null ? '' : String(v)).length);
    }
  }
  // ${VAR:-default} / ${VAR-default} / ${VAR:=default} / ${VAR:+alt} / ${VAR:?msg}
  const opMatch = body.match(/^([A-Za-z_][A-Za-z0-9_]*)(:?)([-=+?])([\s\S]*)$/);
  if (opMatch) {
    const name = opMatch[1];
    const colon = opMatch[2] === ':';
    const op = opMatch[3];
    const word = expandVariablesInString(opMatch[4], env, lastExitCode);
    const v = env[name];
    const empty = v == null || (colon && v === '');
    if (op === '-') return empty ? word : String(v);
    if (op === '=') {
      if (empty) {
        env[name] = word;
        return word;
      }
      return String(v);
    }
    if (op === '+') return empty ? '' : word;
    if (op === '?') {
      if (empty) throw new Error(`${name}: ${word || 'parameter null or not set'}`);
      return String(v);
    }
  }
  // ${VAR#pat} / ${VAR##pat} / ${VAR%pat} / ${VAR%%pat}
  const trimMatch = body.match(/^([A-Za-z_][A-Za-z0-9_]*)(##|#|%%|%)([\s\S]*)$/);
  if (trimMatch) {
    const name = trimMatch[1];
    const op = trimMatch[2];
    const pat = expandVariablesInString(trimMatch[3], env, lastExitCode);
    const v = env[name] == null ? '' : String(env[name]);
    if (op === '#') return trimPattern(v, pat, 'prefix', false);
    if (op === '##') return trimPattern(v, pat, 'prefix', true);
    if (op === '%') return trimPattern(v, pat, 'suffix', false);
    if (op === '%%') return trimPattern(v, pat, 'suffix', true);
  }
  // ${VAR}
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(body)) {
    return env[body] == null ? '' : String(env[body]);
  }
  // ${?} / ${0}-${9}
  if (body === '?') return String(lastExitCode);
  if (/^[0-9]+$/.test(body)) return env[body] == null ? '' : String(env[body]);
  return '';
}

function expandVariablesInString(str, env, lastExitCode) {
  if (str == null) return '';
  const s = typeof str === 'string' ? str : String(str);
  const e = env && typeof env === 'object' ? env : {};
  const lc = lastExitCode !== undefined && lastExitCode !== null ? lastExitCode : 0;
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c !== '$') {
      out += c;
      i++;
      continue;
    }
    // `$$` literal not supported as PID; preserve verbatim
    const next = s[i + 1];
    if (next === '{') {
      const close = findMatchingBrace(s, i + 1);
      if (close === -1) {
        out += c;
        i++;
        continue;
      }
      const body = s.slice(i + 2, close);
      try {
        out += evalParamExpansion(body, e, lc);
      } catch (err) {
        throw err;
      }
      i = close + 1;
      continue;
    }
    if (next === '?') {
      out += String(lc);
      i += 2;
      continue;
    }
    if (next && /[A-Za-z_]/.test(next)) {
      let j = i + 2;
      while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++;
      const name = s.slice(i + 1, j);
      out += e[name] == null ? '' : String(e[name]);
      i = j;
      continue;
    }
    if (next && /[0-9]/.test(next)) {
      out += e[next] == null ? '' : String(e[next]);
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Brace expansion ({a,b,c} and {1..5})
// ---------------------------------------------------------------------------

/**
 * Find matching closing brace at the same brace-nesting depth (no $-escape semantics).
 * Used for brace expansion only.
 * @param {string} s
 * @param {number} start
 * @returns {number}
 */
function findClosingBraceFlat(s, start) {
  let depth = 1;
  for (let i = start + 1; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Split brace body on commas at depth 0.
 * @param {string} body
 * @returns {string[]|null} null when no top-level comma (treat as literal)
 */
function splitBraceList(body) {
  const parts = [];
  let depth = 0;
  let cur = '';
  let sawComma = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '\\') {
      cur += c;
      if (i + 1 < body.length) {
        cur += body[i + 1];
        i++;
      }
      continue;
    }
    if (c === '{') {
      depth++;
      cur += c;
      continue;
    }
    if (c === '}') {
      depth--;
      cur += c;
      continue;
    }
    if (c === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
      sawComma = true;
      continue;
    }
    cur += c;
  }
  parts.push(cur);
  return sawComma ? parts : null;
}

/**
 * Parse `{START..END[..STEP]}` numeric or single-character sequence.
 * @param {string} body
 * @returns {string[]|null}
 */
function parseBraceSequence(body) {
  const m = body.match(/^(-?\d+)\.\.(-?\d+)(?:\.\.(-?\d+))?$/);
  if (m) {
    const start = parseInt(m[1], 10);
    const end = parseInt(m[2], 10);
    let step = m[3] != null ? Math.abs(parseInt(m[3], 10)) : 1;
    if (step === 0) step = 1;
    const out = [];
    if (start <= end) {
      for (let v = start; v <= end; v += step) out.push(String(v));
    } else {
      for (let v = start; v >= end; v -= step) out.push(String(v));
    }
    return out;
  }
  const a = body.match(/^([A-Za-z])\.\.([A-Za-z])(?:\.\.(\d+))?$/);
  if (a) {
    const s = a[1].charCodeAt(0);
    const e = a[2].charCodeAt(0);
    const step = a[3] != null ? Math.max(1, parseInt(a[3], 10)) : 1;
    const out = [];
    if (s <= e) {
      for (let v = s; v <= e; v += step) out.push(String.fromCharCode(v));
    } else {
      for (let v = s; v >= e; v -= step) out.push(String.fromCharCode(v));
    }
    return out;
  }
  return null;
}

/**
 * Bash-style brace expansion on a single token (no $-evaluation; runs after
 * variable expansion but before glob expansion).
 *
 * @param {string} token
 * @returns {string[]}
 */
function expandBraces(token) {
  if (token == null) return [''];
  const s = String(token);
  // Find first unmatched opening brace at depth 0
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\') {
      i++;
      continue;
    }
    if (s[i] !== '{') continue;
    const close = findClosingBraceFlat(s, i);
    if (close === -1) break;
    const body = s.slice(i + 1, close);
    const seq = parseBraceSequence(body);
    /** @type {string[]|null} */
    let items = seq;
    if (!items) items = splitBraceList(body);
    if (!items) continue;
    const before = s.slice(0, i);
    const after = s.slice(close + 1);
    const results = [];
    for (const item of items) {
      for (const inner of expandBraces(item)) {
        for (const tail of expandBraces(after)) {
          results.push(before + inner + tail);
        }
      }
    }
    return results;
  }
  return [s];
}

/**
 * Apply brace expansion across an argv list, preserving ordering.
 * @param {string[]} args
 * @returns {string[]}
 */
function expandBracesInArgv(args) {
  const out = [];
  for (const a of args) {
    out.push(...expandBraces(a));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Shell function definitions (`name() { body }`)
// ---------------------------------------------------------------------------

/**
 * Try to parse a function definition. Supports:
 *   name() { body }
 *   name () { body }
 *   function name { body }
 *   function name() { body }
 *
 * @param {string} line
 * @returns {{ ok: true, name: string, body: string } | { ok: false }}
 */
function parseFunctionDefinition(line) {
  if (line == null) return { ok: false };
  const trimmed = String(line).trim();
  // function name [()] { body }
  let m = trimmed.match(/^function\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(\s*\))?\s*\{([\s\S]*)\}\s*$/);
  if (m) return { ok: true, name: m[1], body: m[2].trim() };
  // name() { body }
  m = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*\)\s*\{([\s\S]*)\}\s*$/);
  if (m) return { ok: true, name: m[1], body: m[2].trim() };
  return { ok: false };
}

// ---------------------------------------------------------------------------
// Command substitution: extract $(...) and `...` spans
// ---------------------------------------------------------------------------

/**
 * Scan a line for command-substitution spans (`$(...)` and backticks).
 * Returns a list of literal text segments interleaved with inner pipelines.
 * Single-quoted content does NOT expand substitutions; double-quoted content
 * does.
 *
 * @param {string} line
 * @returns {Array<{type:'text', value:string} | {type:'subst', inner:string, kind:'dollar'|'backtick'}>}
 */
function extractCommandSubstitutions(line) {
  if (line == null) return [{ type: 'text', value: '' }];
  const s = String(line);
  const out = [];
  let buf = '';
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  while (i < s.length) {
    const c = s[i];
    if (!inDouble && c === "'" && !inSingle) {
      inSingle = true;
      buf += c;
      i++;
      continue;
    }
    if (inSingle && c === "'") {
      inSingle = false;
      buf += c;
      i++;
      continue;
    }
    if (inSingle) {
      buf += c;
      i++;
      continue;
    }
    if (!inSingle && c === '"') {
      inDouble = !inDouble;
      buf += c;
      i++;
      continue;
    }
    if (c === '\\' && i + 1 < s.length) {
      buf += c + s[i + 1];
      i += 2;
      continue;
    }
    if (c === '$' && s[i + 1] === '(') {
      const close = findMatchingParen(s, i + 1);
      if (close === -1) {
        buf += c;
        i++;
        continue;
      }
      if (buf.length > 0) {
        out.push({ type: 'text', value: buf });
        buf = '';
      }
      out.push({ type: 'subst', inner: s.slice(i + 2, close), kind: 'dollar' });
      i = close + 1;
      continue;
    }
    if (c === '`') {
      let end = i + 1;
      while (end < s.length) {
        if (s[end] === '\\' && end + 1 < s.length) {
          end += 2;
          continue;
        }
        if (s[end] === '`') break;
        end++;
      }
      if (end >= s.length) {
        buf += c;
        i++;
        continue;
      }
      if (buf.length > 0) {
        out.push({ type: 'text', value: buf });
        buf = '';
      }
      out.push({ type: 'subst', inner: s.slice(i + 1, end), kind: 'backtick' });
      i = end + 1;
      continue;
    }
    buf += c;
    i++;
  }
  if (buf.length > 0) out.push({ type: 'text', value: buf });
  if (out.length === 0) out.push({ type: 'text', value: '' });
  return out;
}

/**
 * Find the matching `)` for the `(` at index `start`. Skips quoted regions
 * and nested parentheses.
 * @param {string} s
 * @param {number} start - index of opening `(`
 * @returns {number} index of matching `)`, or -1
 */
function findMatchingParen(s, start) {
  let depth = 1;
  let inSingle = false;
  let inDouble = false;
  for (let i = start + 1; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length) {
      i++;
      continue;
    }
    if (!inDouble && c === "'") {
      inSingle = !inSingle;
      continue;
    }
    if (!inSingle && c === '"') {
      inDouble = !inDouble;
      continue;
    }
    if (inSingle || inDouble) continue;
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * After all substitutions have been resolved into strings, splice them back
 * into the original line.
 *
 * @param {ReturnType<typeof extractCommandSubstitutions>} parts
 * @param {string[]} substResults - resolved output per substitution (in order)
 * @returns {string}
 */
function spliceCommandSubstitutions(parts, substResults) {
  let out = '';
  let idx = 0;
  for (const p of parts) {
    if (p.type === 'text') out += p.value;
    else {
      out += substResults[idx] != null ? substResults[idx] : '';
      idx++;
    }
  }
  return out;
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

export const ShellCore = {
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
  combinedFetchSignal,
  // Brace expansion + parameter helpers
  expandBraces,
  expandBracesInArgv,
  shellPatternToRegexSrc,
  shellPatternToRegex,
  // Command substitution
  extractCommandSubstitutions,
  spliceCommandSubstitutions,
  // Shell functions
  parseFunctionDefinition
};

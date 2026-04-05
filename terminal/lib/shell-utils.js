'use strict';

/**
 * Pure helpers shared by jsh and Node tests (exit normalization, $VAR / $? expansion).
 * Loaded in the browser before terminal.js as global ShellUtils.
 */

/**
 * Canonical absolute path (Unix-style): resolves `.`, `..`, duplicate slashes; `/..` at root stays `/`.
 * Does not expand symlinks (none in the VFS). Empty path yields normalized cwd.
 *
 * @param {string} path - Absolute or relative path
 * @param {string} [cwd='/'] - Absolute current directory
 * @returns {string} Path with no trailing slash except root `/`
 */
function resolveVirtualPath(path, cwd) {
  const CWD = normalizeCwdForResolve(cwd);
  if (path == null || path === '') {
    return CWD;
  }
  let absolute;
  if (path.startsWith('/')) {
    absolute = path;
  } else {
    absolute = CWD === '/' ? `/${path}` : `${CWD}/${path}`;
  }
  const parts = absolute.split('/').filter((p) => p !== '');
  const stack = [];
  for (const part of parts) {
    if (part === '.' || part === '') {
      continue;
    }
    if (part === '..') {
      if (stack.length > 0) {
        stack.pop();
      }
    } else {
      stack.push(part);
    }
  }
  return stack.length === 0 ? '/' : '/' + stack.join('/');
}

function normalizeCwdForResolve(cwd) {
  if (cwd == null || cwd === '') {
    return '/';
  }
  let c = cwd.startsWith('/') ? cwd : `/${cwd}`;
  while (c.length > 1 && c.endsWith('/')) {
    c = c.slice(0, -1);
  }
  return c;
}

/**
 * Ensure pipeline / addOutput always receive a string (never a structured object).
 * Preserves numeric 0 as "0" (unlike `x || ''`).
 */
function coerceShellString(value) {
  if (value == null) {
    return '';
  }
  const t = typeof value;
  if (t === 'string') {
    return value;
  }
  if (t === 'number' || t === 'boolean' || t === 'bigint') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((x) => (x == null ? '' : String(x))).join('\n');
  }
  if (t === 'object') {
    return String(value);
  }
  return String(value);
}

/**
 * One layer of surrounding single/double quotes removed for redirect targets (jsh).
 * @param {string} token
 * @returns {string}
 */
function normalizeRedirectFilename(token) {
  if (token == null) {
    return '';
  }
  const s = String(token);
  if (
    s.length >= 2 &&
    ((s[0] === '"' && s[s.length - 1] === '"') || (s[0] === "'" && s[s.length - 1] === "'"))
  ) {
    return s.slice(1, -1);
  }
  return s;
}

/**
 * True if the redirect target is empty after quote normalization (e.g. "", '').
 * @param {string} token
 * @returns {boolean}
 */
function isEmptyRedirectTarget(token) {
  return normalizeRedirectFilename(token) === '';
}

/**
 * Split a jsh line at top-level `&&`, `||`, `;` (not inside single/double quotes).
 * Single `|` is not a list separator (pipes stay inside each segment).
 *
 * @param {string} line
 * @returns {{ ok: true, pipelines: string[], ops: string[] } | { ok: false, error: string }}
 */
function splitShellList(line) {
  if (line == null || line === '') {
    return { ok: true, pipelines: [''], ops: [] };
  }
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
      if (ops[0] === '&&' || ops[0] === '||') {
        return {
          ok: false,
          error: 'jsh: syntax error: expression expected before && or ||'
        };
      }
      continue;
    }
    const prevOp = ops[i - 1];
    if (prevOp === ';') continue;
    if (prevOp === '&&' || prevOp === '||') {
      return {
        ok: false,
        error: 'jsh: syntax error: expression expected after && or ||'
      };
    }
  }
  return { ok: true, pipelines, ops };
}

/**
 * After tokenization, merge `2>` + `&1` into `2>&1` (stderr follows stdout / same stream).
 * @param {string[]} tokens
 * @returns {string[]}
 */
function mergeRedirectDupStderrTokens(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === '2>' && tokens[i + 1] === '&1') {
      out.push('2>&1');
      i++;
    } else {
      out.push(tokens[i]);
    }
  }
  return out;
}

function normalizeCommandResult(stdout, stderr, exitCode) {
  const out = coerceShellString(stdout);
  const err = coerceShellString(stderr);
  const code = exitCode !== undefined && exitCode !== null ? exitCode : err.length > 0 ? 1 : 0;
  return { stdout: out, stderr: err, exitCode: code };
}

/**
 * Coerce a command handler return value into fields for normalizeCommandResult.
 * Legacy string → stdout only, exit 0 (unless stderr is set later).
 * Structured: { stdout?, stderr?, exitCode? } for coreutils-style errors.
 *
 * @param {*} output
 * @returns {{ stdout: string, stderr: string, exitCode?: number }}
 */
function normalizeHandlerResult(output) {
  if (output === null || output === undefined) {
    return { stdout: '', stderr: '', exitCode: undefined };
  }
  if (typeof output === 'string') {
    return { stdout: output, stderr: '', exitCode: undefined };
  }
  if (typeof output !== 'object' || Array.isArray(output)) {
    return { stdout: String(output), stderr: '', exitCode: undefined };
  }
  const has =
    Object.prototype.hasOwnProperty.call(output, 'stdout') ||
    Object.prototype.hasOwnProperty.call(output, 'stderr') ||
    Object.prototype.hasOwnProperty.call(output, 'exitCode');
  if (!has) {
    return { stdout: String(output), stderr: '', exitCode: undefined };
  }
  return {
    stdout: output.stdout != null ? String(output.stdout) : '',
    stderr: output.stderr != null ? String(output.stderr) : '',
    exitCode: output.exitCode
  };
}

/**
 * Map a shell exit code to an 8-bit status (bash-style wrap).
 * @param {number} n
 * @returns {number}
 */
function normalizeExitByte(n) {
  if (n == null || !Number.isFinite(Number(n))) {
    return 0;
  }
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

/** Text aligned with GNU coreutils `tee --help` (flags/usage we implement; jsh limits below). */
const TEE_HELP = `Usage: tee [OPTION]... [FILE]...
Copy standard input to each FILE, and also to standard output.

  -a, --append              append to the given FILEs, do not overwrite
      --help                display this help and exit

When FILE is -, duplicate standard output.

jsh:
  -h is accepted as an alias for --help (GNU tee has no -h).
  Stdin is only from a pipe or \`< file\`; interactive terminal typing is not supported.
  Not implemented vs GNU: -i, -p, --output-error, --version.

Full documentation: <https://www.gnu.org/software/coreutils/tee>
`;

/**
 * GNU-style option error for tee (matches coreutils getopt messages).
 * @param {string} arg
 * @returns {string}
 */
function teeOptionError(arg) {
  const tryLine = "Try 'tee --help' for more information.\n";
  if (arg.startsWith('--') && arg.length > 2) {
    return `tee: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `tee: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `tee: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * Parse jsh `tee` argv (GNU-ish subset: -a/--append, -h/--help, --).
 *
 * @param {string[]} args
 * @returns {{ ok: true, append: boolean, files: string[], help?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseTeeArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  let append = false;
  const files = [];
  for (let i = 0; i < argsArr.length; i++) {
    const arg = argsArr[i];
    if (arg === '--help' || arg === '-h') {
      return { ok: true, append: false, files: [], help: true };
    }
    if (arg === '--append' || arg === '-a') {
      append = true;
      continue;
    }
    if (arg === '--') {
      files.push(...argsArr.slice(i + 1));
      break;
    }
    if (arg.startsWith('-') && arg.length > 1) {
      return { ok: false, stderr: teeOptionError(arg), exitCode: 1 };
    }
    files.push(arg, ...argsArr.slice(i + 1));
    break;
  }
  return { ok: true, append, files };
}

/** Text aligned with GNU coreutils `cat --help` (flags we implement; jsh limits below). */
const CAT_HELP = `Usage: cat [OPTION]... [FILE]...
Concatenate FILE(s) to standard output.

With no FILE, or when FILE is -, read standard input.

  -h, --help     display this help and exit

jsh:
  Symlink operands are followed to a regular file (cycle / depth limit).
  Not implemented vs GNU: -A, -b, -e, -E, -n, -s, -t, -T, -u, -v, --version.

Full documentation: <https://www.gnu.org/software/coreutils/cat>
`;

/**
 * GNU-style option error for cat (matches coreutils getopt messages).
 * @param {string} arg
 * @returns {string}
 */
function catOptionError(arg) {
  const tryLine = "Try 'cat --help' for more information.\n";
  if (arg.startsWith('--') && arg.length > 2) {
    return `cat: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `cat: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `cat: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * Parse jsh `cat` argv (GNU-ish: -h/--help, --, operands; `-` is stdin).
 *
 * @param {string[]} args
 * @returns {{ ok: true, operands: string[], help?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseCatArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  const operands = [];
  for (let i = 0; i < argsArr.length; i++) {
    const arg = argsArr[i];
    if (arg === '--') {
      operands.push(...argsArr.slice(i + 1));
      break;
    }
    if (arg === '--help' || arg === '-h') {
      return { ok: true, operands: [], help: true };
    }
    if (arg.startsWith('-') && arg.length > 1) {
      return { ok: false, stderr: catOptionError(arg), exitCode: 1 };
    }
    operands.push(arg, ...argsArr.slice(i + 1));
    break;
  }
  return { ok: true, operands };
}

/** Text aligned with GNU coreutils `echo --help` (flags we implement; jsh notes below). */
const ECHO_HELP = `Usage: echo [SHORT-OPTION]... [STRING]...
  or:  echo LONG-OPTION
Echo the STRING(s) to standard output.

  -n             do not output the trailing newline
  -e             enable interpretation of backslash escapes
  -E             disable interpretation of backslash escapes (default)
  -h, --help     display this help and exit (jsh: **-h** is help; GNU has no **-h**)
      --version  display version information and exit

jsh:
  Options are parsed only from leading arguments; after the first STRING, every
  argument is printed literally (GNU-style). **--** ends option parsing.
  **$VAR** / **$?** expansion is applied to the joined STRINGs (jsh extension).
  Not full GNU: no **printf**-style formats; octal/hex escapes follow common **echo -e** rules.

Full documentation: <https://www.gnu.org/software/coreutils/echo>
`;

const ECHO_VERSION_LINE = 'echo (jsh Heyming Terminal) 1.0\n';

/**
 * GNU-style option error for echo (exit status 2).
 * @param {string} arg
 * @returns {string}
 */
function echoOptionError(arg) {
  const tryLine = "Try 'echo --help' for more information.\n";
  if (arg.startsWith('--') && arg.length > 2) {
    return `echo: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `echo: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `echo: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * Parse a single `-` token (e.g. `-ne`, `-n`) for GNU echo flags.
 * @param {string} token
 * @returns {{ ok: true, noNewline: boolean, escapes: boolean, hasEscapeFlag: boolean } | { ok: false }}
 */
function parseEchoShortFlagToken(token) {
  if (token == null || token.length < 2 || token[0] !== '-') {
    return { ok: false };
  }
  let noNewline = false;
  let escapes = false;
  let hasEscapeFlag = false;
  for (let j = 1; j < token.length; j++) {
    const c = token[j];
    if (c === 'n') {
      noNewline = true;
    } else if (c === 'e') {
      escapes = true;
      hasEscapeFlag = true;
    } else if (c === 'E') {
      escapes = false;
      hasEscapeFlag = true;
    } else {
      return { ok: false };
    }
  }
  return { ok: true, noNewline, escapes, hasEscapeFlag };
}

/**
 * Parse jsh `echo` argv (GNU-ish: leading `-n`/`-e`/`-E`, `--`, operands).
 *
 * @param {string[]} args
 * @returns {{ ok: true, operands: string[], noNewline: boolean, escapes: boolean, help?: true, version?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseEchoArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  const operands = [];
  let noNewline = false;
  let escapes = false;
  let i = 0;
  let parsingOptions = true;

  while (i < argsArr.length) {
    const a = argsArr[i];
    if (!parsingOptions) {
      operands.push(a);
      i++;
      continue;
    }
    if (a === '--') {
      operands.push(...argsArr.slice(i + 1));
      break;
    }
    if (a === '--help' || a === '-h') {
      return { ok: true, operands: [], noNewline: false, escapes: false, help: true };
    }
    if (a === '--version') {
      return { ok: true, operands: [], noNewline: false, escapes: false, version: true };
    }
    if (a.startsWith('--') && a.length > 2) {
      return { ok: false, stderr: echoOptionError(a), exitCode: 2 };
    }
    if (a === '-') {
      operands.push('-');
      i++;
      parsingOptions = false;
      continue;
    }
    if (a.startsWith('-') && a.length > 1) {
      const r = parseEchoShortFlagToken(a);
      if (r.ok) {
        if (r.noNewline) {
          noNewline = true;
        }
        if (r.hasEscapeFlag) {
          escapes = r.escapes;
        }
        i++;
        continue;
      }
      return { ok: false, stderr: echoOptionError(a), exitCode: 2 };
    }
    parsingOptions = false;
    operands.push(a);
    i++;
  }

  return { ok: true, operands, noNewline, escapes };
}

/**
 * Apply GNU `echo -e` backslash escapes (subset aligned with common coreutils behavior).
 * @param {string} str
 * @returns {string}
 */
function echoApplyBackslashEscapes(str) {
  const s = String(str);
  let out = '';
  let i = 0;
  while (i < s.length) {
    if (s[i] !== '\\') {
      out += s[i];
      i++;
      continue;
    }
    i++;
    if (i >= s.length) {
      out += '\\';
      break;
    }
    const c = s[i];
    switch (c) {
      case 'a':
        out += '\x07';
        i++;
        break;
      case 'b':
        out += '\b';
        i++;
        break;
      case 'c':
        return out;
      case 'e':
      case 'E':
        out += '\x1b';
        i++;
        break;
      case 'f':
        out += '\f';
        i++;
        break;
      case 'n':
        out += '\n';
        i++;
        break;
      case 'r':
        out += '\r';
        i++;
        break;
      case 't':
        out += '\t';
        i++;
        break;
      case 'v':
        out += '\v';
        i++;
        break;
      case '\\':
        out += '\\';
        i++;
        break;
      case '0':
      case '1':
      case '2':
      case '3':
      case '4':
      case '5':
      case '6':
      case '7': {
        let val = 0;
        let count = 0;
        while (count < 3 && i < s.length) {
          const ch = s[i];
          if (ch < '0' || ch > '7') {
            break;
          }
          val = val * 8 + (ch.charCodeAt(0) - 48);
          i++;
          count++;
        }
        out += String.fromCharCode(val & 0xff);
        break;
      }
      case 'x': {
        i++;
        let hex = '';
        while (hex.length < 2 && i < s.length && /[0-9a-fA-F]/.test(s[i])) {
          hex += s[i];
          i++;
        }
        if (hex.length > 0) {
          out += String.fromCharCode(parseInt(hex, 16) & 0xff);
        } else {
          out += 'x';
        }
        break;
      }
      default:
        out += c;
        i++;
    }
  }
  return out;
}

/** Matches the pager page size in `less` (browser modal). */
const LESS_LINES_PER_PAGE = 20;

/** GNU less default tab stop interval (columns). */
const LESS_DEFAULT_TAB_STOPS = 8;

const LESS_HELP = `Usage: less [OPTION]... [FILE]
View FILE (or standard input) with paging. jsh uses a full-screen viewer.

  +N                         start at line N (1-based), like GNU less startup command +N
  +G                         start at end of file (last screen)
  -p, --pattern=PATTERN      start at the first line containing PATTERN (literal substring, like / search)
  -F, --quit-if-one-screen  exit immediately if the entire file fits the first screen
  -N, --LINE-NUMBERS         display a line number at the start of each line
  -S, --chop-long-lines      do not wrap long lines; scroll horizontally (← →) in the viewer
  -s, --squeeze-blank-lines  squeeze consecutive blank lines into one (GNU less)
  -x [N], --tabs=[N]         set tab stops every N columns (default ${LESS_DEFAULT_TAB_STOPS}; same as GNU)
  -# [N]                     same as -x (GNU less)
  -m  -M  --long-prompt      show a long prompt (status line includes percent through the file)
  -i, --ignore-case          searches ignore case (default is case-sensitive, like GNU less)
  -R, --RAW-CONTROL-CHARS    interpret ANSI color/style sequences (CSI SGR) in the text viewer
  -e, --quit-at-eof          exit the second time you press a forward key at end-of-file (GNU less)
  -E, --QUIT-AT-EOF          exit the first time you press a forward key at end-of-file (GNU less)
      --html                 render content as HTML in the viewer (not for stdout)
  -V, --version              display version information and exit
  -?, -h, --help             display this help and exit (GNU less accepts -? for help)
      --                     end of options (e.g. less -- -h opens a file named -h)

jsh:
  Symlink operands are followed to a regular file. At most one FILE; use \`-\` for stdin.
  **+N** / **+G** cannot be combined with **-p** / **--pattern** (exit **2**).
  **+N** / **+G** apply only to the interactive viewer (ignored for **-F** stdout short-circuit).
  **-F** prints to standard output and skips the viewer when the text fits **${LESS_LINES_PER_PAGE}** lines
  (same line count as one page in the viewer). **-F** is ignored when **--html** or **-p** is set (interactive only).
  **-N** applies to **-F** stdout and to the text viewer; with **--html**, line numbers are not shown (HTML layout).
  **-S** applies only to the text viewer (not **-F** stdout or **--html**).
  **-s** / **--squeeze-blank-lines** applies to the text viewer and to **-F** stdout (not **--html** — would distort markup).
  **-x** / **-#** / **--tabs** expand **TAB** (ASCII) to spaces per GNU tab stops (default **${LESS_DEFAULT_TAB_STOPS}**); applies to the text viewer and **-F** stdout, not **--html** (HTML layout). **Limitation:** column width is character-based (UTF-16 code units), not full POSIX **wcwidth**; tab stops inside **-R** ANSI sequences are not modeled.
  **-m** / **-M** / **--long-prompt** add a **(N%)** line-based position (first visible line / total lines); not full GNU byte/exact prompt.
  **-i** applies to **-p** / **/** search (not **-F** stdout).
  **-R** / **--RAW-CONTROL-CHARS** applies only to the interactive text viewer (not **--html**); **-F** stdout short-circuit is unchanged (raw bytes). SGR **38;5;** / **48;5;** 256-color and hyperlinks are not interpreted.
  **-e** / **-E** apply only to the interactive pager (forward keys: **j**, **e**, **Enter**, **Space**, **f**, **z**, **Z**, **PageDown**, **d**, **^D**). **-E** wins if both **-e** and **-E** are given.
  In the viewer, **digits** before a movement key set a repeat count (GNU-style): e.g. **12j** moves 12 lines, **5z**/**5f**/**5Space** move 5 lines (default with no digits is one window). **w**/**W**/**b**/**PageUp** backward; **d**/**u** use half-window default. **Ng** / **NG** jump so line **N** is at the top (1-based; same as **+N**); bare **g**/**G** still mean first / last screen. **n**/**N** search repeat also use a digit prefix (**3n**, **2N**); **/** search status shows **Found: i/total at line L, col C** (1-based); **Search wrapped** when the search wraps to the first match. Keys that do not consume a prefix (**h**, **q**, **/**, …) clear pending digits.
  After **--**, a leading **+** is part of a file name (e.g. **less -- +10** opens **+10**).
  **+/pattern** startup is not supported; use **less -p pattern FILE** instead.
  Not full GNU less: no POSIX regex for **-p**, no multi-file session, true tty, or exact terminal width (horizontal scroll is per line group).

Full documentation: <https://www.greenwoodsoftware.com/less/less.html>
`;

const LESS_VERSION_LINE = 'less (jsh Heyming Terminal) 1.0\n';

/**
 * GNU-style option error for less (exit status 2).
 * @param {string} arg
 * @returns {string}
 */
function lessOptionError(arg) {
  const tryLine = "Try 'less --help' for more information.\n";
  if (arg.startsWith('--') && arg.length > 2) {
    return `less: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `less: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `less: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * True when `content` fits the first jsh less screen (line count only).
 * @param {string} content
 * @returns {boolean}
 */
function lessContentFitsOneScreen(content) {
  return String(content).split('\n').length <= LESS_LINES_PER_PAGE;
}

/**
 * Prefix each line with a fixed-width line number (GNU less **-N** / **--LINE-NUMBERS**).
 * @param {string} content
 * @returns {string}
 */
function lessFormatWithLineNumbers(content) {
  const lines = String(content).split('\n');
  const w = Math.max(6, String(lines.length).length);
  return lines.map((line, i) => `${String(i + 1).padStart(w)}  ${line}`).join('\n');
}

/**
 * GNU less **-s** / **--squeeze-blank-lines**: consecutive empty lines become a single blank line.
 * @param {string} content
 * @returns {string}
 */
function lessSqueezeBlankLines(content) {
  const lines = String(content).split('\n');
  const out = [];
  let prevBlank = false;
  for (const line of lines) {
    const blank = line === '';
    if (blank) {
      if (!prevBlank) {
        out.push('');
      }
      prevBlank = true;
    } else {
      prevBlank = false;
      out.push(line);
    }
  }
  return out.join('\n');
}

/**
 * GNU less **-x** / **-#** / **--tabs**: expand tab characters to spaces to the next tab stop.
 * @param {string} line
 * @param {number} [tabWidth] columns per stop (clamped 1–256; default {@link LESS_DEFAULT_TAB_STOPS})
 * @returns {string}
 */
function lessExpandTabsInLine(line, tabWidth) {
  const raw = tabWidth == null ? LESS_DEFAULT_TAB_STOPS : Number(tabWidth);
  const w = Number.isFinite(raw)
    ? Math.min(256, Math.max(1, Math.floor(raw)))
    : LESS_DEFAULT_TAB_STOPS;
  let col = 0;
  let out = '';
  const s = String(line);
  for (let i = 0; i < s.length; i++) {
    const ch = s.charAt(i);
    if (ch === '\t') {
      const rem = col % w;
      const spaces = rem === 0 ? w : w - rem;
      out += ' '.repeat(spaces);
      col += spaces;
    } else {
      out += ch;
      col = ch === '\n' || ch === '\r' ? 0 : col + 1;
    }
  }
  return out;
}

/**
 * Expand tabs on each line of a string (for **less** viewer and **-F** stdout).
 * @param {string} text
 * @param {number} [tabWidth]
 * @returns {string}
 */
function lessExpandTabsInText(text, tabWidth) {
  return String(text)
    .split('\n')
    .map((line) => lessExpandTabsInLine(line, tabWidth))
    .join('\n');
}

/**
 * Parse GNU-style `+cmd` startup token for `less` (+N line, +G end of file).
 * @param {string} arg
 * @returns {{ ok: true, spec: { kind: 'line', line: number } | { kind: 'eof' } } | { ok: false, stderr: string }}
 */
function parseLessPlusStart(arg) {
  if (arg === '+') {
    return {
      ok: false,
      stderr: `less: invalid start command '${arg}'\nTry 'less --help' for more information.\n`
    };
  }
  if (!arg.startsWith('+') || arg.length < 2) {
    return {
      ok: false,
      stderr: `less: invalid start command '${arg}'\nTry 'less --help' for more information.\n`
    };
  }
  const rest = arg.slice(1);
  if (rest === 'G' || rest === 'g') {
    return { ok: true, spec: { kind: 'eof' } };
  }
  if (/^\d+$/.test(rest)) {
    return { ok: true, spec: { kind: 'line', line: parseInt(rest, 10) } };
  }
  if (rest.startsWith('/')) {
    return {
      ok: false,
      stderr: `less: '+/pattern' start command is not supported in jsh\nTry 'less --help' for more information.\n`
    };
  }
  return {
    ok: false,
    stderr: `less: invalid start command '${arg}'\nTry 'less --help' for more information.\n`
  };
}

/**
 * First scroll line (0-based) for the less viewer from a startup spec (GNU-like line-at-top, clamped near EOF).
 * @param {number} lineCount
 * @param {number} linesPerPage
 * @param {{ kind: 'line', line: number } | { kind: 'eof' } | null | undefined} spec
 * @returns {number}
 */
/**
 * First visible line index (0-based) when line **lineOneBased** should appear at the top (clamped near EOF), like **+N** startup.
 * @param {number} lineCount
 * @param {number} linesPerPage
 * @param {number} lineOneBased
 * @returns {number}
 */
function lessScrollLineForTargetLineOneBased(lineCount, linesPerPage, lineOneBased) {
  if (lineCount <= 0) return 0;
  const n = lineOneBased;
  if (n < 1) return 0;
  const targetZero = n - 1;
  const maxStart = Math.max(0, lineCount - linesPerPage);
  return Math.min(targetZero, maxStart);
}

function lessInitialScrollLine(lineCount, linesPerPage, spec) {
  if (!spec || lineCount <= 0) {
    return 0;
  }
  if (spec.kind === 'eof') {
    return Math.max(0, lineCount - linesPerPage);
  }
  return lessScrollLineForTargetLineOneBased(lineCount, linesPerPage, spec.line);
}

/**
 * Digits typed before **g** / **G** in the pager: target line (1-based). Empty → **null** (caller: **g** = first screen, **G** = last screen).
 * @param {string} [prefixDigits]
 * @returns {number | null}
 */
function lessTargetLineOneBasedFromPrefix(prefixDigits) {
  const s = prefixDigits == null ? '' : String(prefixDigits);
  if (s === '') return null;
  const raw = parseInt(s, 10);
  if (!Number.isFinite(raw) || raw < 1) return 1;
  return Math.min(raw, 1000000);
}

/**
 * GNU less half-window scroll distance: floor(page/2), at least 1 line.
 * @param {number} linesPerPage
 * @returns {number}
 */
function lessHalfPageLineCount(linesPerPage) {
  const n = Number(linesPerPage);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.max(1, Math.floor(n / 2));
}

/**
 * GNU less-style repeat count from a digit prefix typed before a movement key.
 * Empty or missing prefix returns `defaultLines` (one line, one window, half window, …).
 * @param {number} defaultLines
 * @param {string} [prefixDigits]
 * @returns {number}
 */
function lessRepeatCountFromPrefix(defaultLines, prefixDigits) {
  const s = prefixDigits == null ? '' : String(prefixDigits);
  if (s === '') return defaultLines;
  const raw = parseInt(s, 10);
  if (!Number.isFinite(raw) || raw < 1) return 1;
  return Math.min(raw, 1000000);
}

/**
 * Footer text for the active **less** search match: index/total plus 1-based line and column (start of substring).
 * @param {{ line: number, col: number }} result
 * @param {number} matchIndexZeroBased
 * @param {number} totalMatches
 * @param {string} [wrapHint] e.g. `'Search wrapped'` (GNU-style wrap message)
 * @returns {string}
 */
function formatLessSearchMatchFooter(result, matchIndexZeroBased, totalMatches, wrapHint) {
  const line = result.line + 1;
  const col = result.col + 1;
  const base = `Found: ${matchIndexZeroBased + 1}/${totalMatches} at line ${line}, col ${col}`;
  const hint = wrapHint == null || wrapHint === '' ? '' : String(wrapHint).trim();
  return hint ? `${hint} — ${base}` : base;
}

/** 8-color ANSI foreground/background (approximate xterm). */
const LESS_ANSI_BASIC = [
  '#000000',
  '#cd0000',
  '#00cd00',
  '#cdcd00',
  '#0000ee',
  '#cd00cd',
  '#00cdcd',
  '#e5e5e5'
];
const LESS_ANSI_BRIGHT = [
  '#626262',
  '#ff0000',
  '#00ff00',
  '#ffff00',
  '#0000ff',
  '#ff00ff',
  '#00ffff',
  '#ffffff'
];

/**
 * Remove ANSI CSI SGR sequences and other common `\x1b[` … letter sequences from a string (for search / plain display).
 * @param {string} s
 * @returns {string}
 */
function lessStripAnsi(s) {
  return (
    String(s)
      // eslint-disable-next-line no-control-regex -- strip ANSI CSI SGR and other CSI sequences
      .replace(/\x1b\[[0-9;]*m/g, '')
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b\[[\x20-\x3f]*[\x40-\x7e]/g, '')
  );
}

function lessEscapeHtmlChunk(t) {
  return String(t)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Convert a line containing ANSI SGR codes to HTML spans (GNU **less -R** subset).
 * Unknown or non-SGR `\x1b[` sequences are stripped.
 * @param {string} line
 * @returns {string}
 */
function lessAnsiToHtml(line) {
  const s = String(line);
  let bold = false;
  let fg = /** @type {string | null} */ (null);
  let bg = /** @type {string | null} */ (null);

  function applyCodes(codesStr) {
    const raw = codesStr.trim();
    const parts = raw === '' ? ['0'] : raw.split(';');
    const codes = parts.map((p) => parseInt(p, 10) || 0);
    for (const c of codes) {
      if (c === 0) {
        bold = false;
        fg = null;
        bg = null;
      } else if (c === 1) {
        bold = true;
      } else if (c === 22) {
        bold = false;
      } else if (c === 39) {
        fg = null;
      } else if (c === 49) {
        bg = null;
      } else if (c >= 30 && c <= 37) {
        fg = LESS_ANSI_BASIC[c - 30];
      } else if (c >= 90 && c <= 97) {
        fg = LESS_ANSI_BRIGHT[c - 90];
      } else if (c >= 40 && c <= 47) {
        bg = LESS_ANSI_BASIC[c - 40];
      } else if (c >= 100 && c <= 107) {
        bg = LESS_ANSI_BRIGHT[c - 100];
      }
    }
  }

  function styleAttr() {
    const st = [];
    if (bold) {
      st.push('font-weight:bold');
    }
    if (fg) {
      st.push(`color:${fg}`);
    }
    if (bg) {
      st.push(`background-color:${bg}`);
    }
    return st.length ? ` style="${st.join(';')}"` : '';
  }

  let out = '';
  let i = 0;
  while (i < s.length) {
    if (s.charCodeAt(i) === 0x1b && s.charAt(i + 1) === '[') {
      const close = s.indexOf('m', i + 2);
      if (close === -1) {
        out += lessEscapeHtmlChunk(s.slice(i));
        break;
      }
      const inner = s.slice(i + 2, close);
      if (/^[0-9;]*$/.test(inner)) {
        applyCodes(inner);
      }
      i = close + 1;
      continue;
    }
    let j = i;
    while (j < s.length && !(s.charCodeAt(j) === 0x1b && s.charAt(j + 1) === '[')) {
      j++;
    }
    const chunk = s.slice(i, j);
    if (chunk.length > 0) {
      const st = styleAttr();
      out += st ? `<span${st}>${lessEscapeHtmlChunk(chunk)}</span>` : lessEscapeHtmlChunk(chunk);
    }
    i = j;
  }
  return out;
}

/**
 * Parse jsh `less` argv: +N/+G, -p/--pattern, -F/--quit-if-one-screen, -N/--LINE-NUMBERS, -S/--chop-long-lines, -s/--squeeze-blank-lines, -i/--ignore-case, -R/--RAW-CONTROL-CHARS, --html, -?/-h/--help, --, single file or stdin.
 *
 * @param {string[]} args
 * @returns {{ ok: true, quitIfOneScreen: boolean, quitAtEofMode: 'none'|'first'|'second', lineNumbers: boolean, chopLongLines: boolean, squeezeBlankLines: boolean, longPrompt: boolean, ignoreCase: boolean, rawControlChars: boolean, html: boolean, tabStops: number, startSpec: { kind: 'line', line: number } | { kind: 'eof' } | null, pattern: string | null, operands: string[], help?: true, version?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseLessArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  let quitIfOneScreen = false;
  /** @type {'none'|'first'|'second'} */
  let quitAtEofMode = 'none';
  let lineNumbers = false;
  let chopLongLines = false;
  let squeezeBlankLines = false;
  let longPrompt = false;
  let ignoreCase = false;
  let rawControlChars = false;
  let html = false;
  let tabStops = LESS_DEFAULT_TAB_STOPS;
  /** @type {{ kind: 'line', line: number } | { kind: 'eof' } | null} */
  let startSpec = null;
  /** @type {string | null} */
  let pattern = null;
  const operands = [];
  let i = 0;
  while (i < argsArr.length) {
    const arg = argsArr[i];
    if (arg === '--') {
      operands.push(...argsArr.slice(i + 1));
      break;
    }
    if (arg.startsWith('+')) {
      if (startSpec != null) {
        return { ok: false, stderr: 'less: too many + commands\n', exitCode: 2 };
      }
      const ps = parseLessPlusStart(arg);
      if (!ps.ok) {
        return { ok: false, stderr: ps.stderr, exitCode: 2 };
      }
      startSpec = ps.spec;
      i++;
      continue;
    }
    if (arg === '--help' || arg === '-h' || arg === '-?') {
      return {
        ok: true,
        quitIfOneScreen,
        quitAtEofMode,
        lineNumbers,
        chopLongLines,
        squeezeBlankLines,
        longPrompt,
        ignoreCase,
        rawControlChars,
        html,
        tabStops,
        startSpec: null,
        pattern: null,
        operands: [],
        help: true
      };
    }
    if (arg === '--version' || arg === '-V') {
      return {
        ok: true,
        quitIfOneScreen,
        quitAtEofMode,
        lineNumbers,
        chopLongLines,
        squeezeBlankLines,
        longPrompt,
        ignoreCase,
        rawControlChars,
        html,
        tabStops,
        startSpec: null,
        pattern: null,
        operands: [],
        version: true
      };
    }
    if (arg === '--html') {
      html = true;
      i++;
      continue;
    }
    if (arg === '-N' || arg === '--LINE-NUMBERS') {
      lineNumbers = true;
      i++;
      continue;
    }
    if (arg === '-S' || arg === '--chop-long-lines') {
      chopLongLines = true;
      i++;
      continue;
    }
    if (arg === '-s' || arg === '--squeeze-blank-lines') {
      squeezeBlankLines = true;
      i++;
      continue;
    }
    if (arg === '-m' || arg === '-M' || arg === '--long-prompt' || arg === '--LONG-PROMPT') {
      longPrompt = true;
      i++;
      continue;
    }
    if (arg === '-e' || arg === '--quit-at-eof') {
      if (quitAtEofMode !== 'first') {
        quitAtEofMode = 'second';
      }
      i++;
      continue;
    }
    if (arg === '-E' || arg === '--QUIT-AT-EOF') {
      quitAtEofMode = 'first';
      i++;
      continue;
    }
    if (arg === '-F' || arg === '--quit-if-one-screen') {
      quitIfOneScreen = true;
      i++;
      continue;
    }
    if (arg === '-i' || arg === '--ignore-case') {
      ignoreCase = true;
      i++;
      continue;
    }
    if (arg === '-R' || arg === '--RAW-CONTROL-CHARS') {
      rawControlChars = true;
      i++;
      continue;
    }
    if (arg === '-#' || arg === '-x') {
      const next = argsArr[i + 1];
      if (next != null && /^\d+$/.test(next)) {
        const n = parseInt(next, 10);
        if (n < 1 || n > 256) {
          return {
            ok: false,
            stderr: "less: invalid tab width\nTry 'less --help' for more information.\n",
            exitCode: 2
          };
        }
        tabStops = n;
        i += 2;
        continue;
      }
      tabStops = LESS_DEFAULT_TAB_STOPS;
      i++;
      continue;
    }
    if (arg.startsWith('-#') && arg.length > 2) {
      const rest = arg.slice(2);
      if (!/^\d+$/.test(rest)) {
        return { ok: false, stderr: lessOptionError(arg), exitCode: 2 };
      }
      const n = parseInt(rest, 10);
      if (n < 1 || n > 256) {
        return {
          ok: false,
          stderr: "less: invalid tab width\nTry 'less --help' for more information.\n",
          exitCode: 2
        };
      }
      tabStops = n;
      i++;
      continue;
    }
    if (arg.startsWith('-x') && arg.length > 2) {
      const rest = arg.slice(2);
      if (!/^\d+$/.test(rest)) {
        return { ok: false, stderr: lessOptionError(arg), exitCode: 2 };
      }
      const n = parseInt(rest, 10);
      if (n < 1 || n > 256) {
        return {
          ok: false,
          stderr: "less: invalid tab width\nTry 'less --help' for more information.\n",
          exitCode: 2
        };
      }
      tabStops = n;
      i++;
      continue;
    }
    if (arg === '--tabs') {
      i++;
      if (i >= argsArr.length) {
        return {
          ok: false,
          stderr:
            "less: option '--tabs' requires an argument\nTry 'less --help' for more information.\n",
          exitCode: 2
        };
      }
      const tv = argsArr[i];
      if (!/^\d+$/.test(String(tv))) {
        return {
          ok: false,
          stderr: "less: invalid tab width\nTry 'less --help' for more information.\n",
          exitCode: 2
        };
      }
      const n = parseInt(String(tv), 10);
      if (n < 1 || n > 256) {
        return {
          ok: false,
          stderr: "less: invalid tab width\nTry 'less --help' for more information.\n",
          exitCode: 2
        };
      }
      tabStops = n;
      i++;
      continue;
    }
    if (arg.startsWith('--tabs=')) {
      const v = arg.slice('--tabs='.length);
      if (v === '' || !/^\d+$/.test(v)) {
        return {
          ok: false,
          stderr: "less: invalid tab width\nTry 'less --help' for more information.\n",
          exitCode: 2
        };
      }
      const n = parseInt(v, 10);
      if (n < 1 || n > 256) {
        return {
          ok: false,
          stderr: "less: invalid tab width\nTry 'less --help' for more information.\n",
          exitCode: 2
        };
      }
      tabStops = n;
      i++;
      continue;
    }
    if (arg === '-p' || arg === '--pattern') {
      if (pattern != null) {
        return { ok: false, stderr: 'less: duplicate pattern option\n', exitCode: 2 };
      }
      if (arg === '--pattern') {
        i++;
        if (i >= argsArr.length) {
          return {
            ok: false,
            stderr:
              "less: option '--pattern' requires an argument\nTry 'less --help' for more information.\n",
            exitCode: 2
          };
        }
        pattern = argsArr[i];
        i++;
        continue;
      }
      // -p PATTERN
      i++;
      if (i >= argsArr.length) {
        return {
          ok: false,
          stderr:
            "less: option requires an argument -- 'p'\nTry 'less --help' for more information.\n",
          exitCode: 2
        };
      }
      pattern = argsArr[i];
      i++;
      continue;
    }
    if (arg.startsWith('--pattern=')) {
      if (pattern != null) {
        return { ok: false, stderr: 'less: duplicate pattern option\n', exitCode: 2 };
      }
      const pv = arg.slice('--pattern='.length);
      if (pv === '') {
        return {
          ok: false,
          stderr:
            "less: option '--pattern=' requires a non-empty value\nTry 'less --help' for more information.\n",
          exitCode: 2
        };
      }
      pattern = pv;
      i++;
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1) {
      return { ok: false, stderr: lessOptionError(arg), exitCode: 2 };
    }
    operands.push(arg, ...argsArr.slice(i + 1));
    break;
  }
  if (pattern != null && pattern === '') {
    return {
      ok: false,
      stderr: "less: empty pattern for -p\nTry 'less --help' for more information.\n",
      exitCode: 2
    };
  }
  if (pattern != null && startSpec != null) {
    return {
      ok: false,
      stderr:
        "less: cannot use both a start command (+N/+G) and --pattern\nTry 'less --help' for more information.\n",
      exitCode: 2
    };
  }
  if (operands.length > 1) {
    return { ok: false, stderr: 'less: too many arguments\n', exitCode: 1 };
  }
  return {
    ok: true,
    quitIfOneScreen,
    quitAtEofMode,
    lineNumbers,
    chopLongLines,
    squeezeBlankLines,
    longPrompt,
    ignoreCase,
    rawControlChars,
    html,
    tabStops,
    startSpec,
    pattern,
    operands
  };
}

const GREP_HELP = `Usage: grep [OPTION]... PATTERN [FILE]...
Search for PATTERN in each FILE or standard input.

  -i, --ignore-case        ignore case distinctions in patterns and data
  -n, --line-number        print line numbers with output lines
  -v, --invert-match       select non-matching lines
  -h, --no-filename        suppress the file name prefix on output
      --help               display this help and exit

jsh:
  PATTERN is a literal substring (not POSIX regular expressions). Use --
  before PATTERN or FILE that starts with '-'. Operand '-' reads standard
  input. GNU grep uses **-h** for **--no-filename** (not help); use **--help**
  for usage.

Full documentation: <https://www.gnu.org/software/grep/manual/html_node/grep-invocation.html>
`;

/**
 * GNU-style option error for grep (exit status 2).
 * @param {string} arg
 * @returns {string}
 */
function grepOptionError(arg) {
  const tryLine = "Try 'grep --help' for more information.\n";
  if (arg.startsWith('--') && arg.length > 2) {
    return `grep: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `grep: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `grep: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * Parse jsh `grep` argv: -i/-n/-v/-h, --help, --, PATTERN then FILE operands.
 *
 * @param {string[]} args
 * @returns {{ ok: true, caseInsensitive: boolean, lineNumbers: boolean, invertMatch: boolean, noFilename: boolean, pattern: string, fileOperands: string[], help?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseGrepArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  let caseInsensitive = false;
  let lineNumbers = false;
  let invertMatch = false;
  let noFilename = false;
  let i = 0;
  while (i < argsArr.length) {
    const arg = argsArr[i];
    if (arg === '--') {
      const rest = argsArr.slice(i + 1);
      if (rest.length === 0) {
        return { ok: false, stderr: 'grep: missing operand\n', exitCode: 2 };
      }
      return {
        ok: true,
        caseInsensitive,
        lineNumbers,
        invertMatch,
        noFilename,
        pattern: rest[0],
        fileOperands: rest.slice(1)
      };
    }
    if (arg === '--help') {
      return {
        ok: true,
        help: true,
        caseInsensitive,
        lineNumbers,
        invertMatch,
        noFilename,
        pattern: '',
        fileOperands: []
      };
    }
    if (arg === '-i' || arg === '--ignore-case') {
      caseInsensitive = true;
      i++;
      continue;
    }
    if (arg === '-n' || arg === '--line-number') {
      lineNumbers = true;
      i++;
      continue;
    }
    if (arg === '-v' || arg === '--invert-match') {
      invertMatch = true;
      i++;
      continue;
    }
    if (arg === '-h' || arg === '--no-filename') {
      noFilename = true;
      i++;
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1 && !arg.startsWith('--')) {
      for (let j = 1; j < arg.length; j++) {
        const c = arg[j];
        if (c === 'i') caseInsensitive = true;
        else if (c === 'n') lineNumbers = true;
        else if (c === 'v') invertMatch = true;
        else if (c === 'h') noFilename = true;
        else {
          return { ok: false, stderr: grepOptionError(`-${c}`), exitCode: 2 };
        }
      }
      i++;
      continue;
    }
    if (arg.startsWith('--') && arg.length > 2) {
      return { ok: false, stderr: grepOptionError(arg), exitCode: 2 };
    }
    return {
      ok: true,
      caseInsensitive,
      lineNumbers,
      invertMatch,
      noFilename,
      pattern: arg,
      fileOperands: argsArr.slice(i + 1)
    };
  }
  return { ok: false, stderr: 'grep: missing operand\n', exitCode: 2 };
}

const SED_HELP = `Usage: sed [OPTION]... SCRIPT [FILE]...
  or:  sed [OPTION]... -e SCRIPT ... [FILE]...

Stream-edit lines from FILEs or standard input.

  -n, --quiet, --silent    suppress automatic printing of pattern space
  -e SCRIPT, --expression=SCRIPT   add SCRIPT to the commands to be executed
      --help               display this help and exit
  -h                       same as --help (jsh; GNU sed uses -h differently)

jsh:
  SCRIPT is **d** (delete every line, like GNU **d** with no address), **Nd** /
  **$d** / **N,Md** / **N,$d** (delete matching line(s) by 1-based input line
  number; **$** is the last line), **/PATTERN/d** (delete lines whose text
  contains the **literal** substring **PATTERN**; **\\\\** and **\\\\/** escape
  backslash and slash inside **PATTERN**), **/PAT1/,/PAT2/d** (delete from the
  first line containing **PAT1** through the first line after that containing
  **PAT2**, inclusive; if **PAT2** never appears, delete through end of input;
  the end pattern is not tested on the line where **PAT1** matched, GNU-style),
  or a single **s** command (with the same **literal** address forms as **d**):
  **Ns** / **N,Ms** / **N,$s** / **/PAT/s** / **/PAT1/,/PAT2/s** / **/PAT/,Ns** /
  **N,/PAT/s** then **sDELIMpatDELIMreplDELIM[flags]** (DELIM is any char except
  newline; **\\\\** and **\\\\DELIM** escape backslash and delimiter). Pattern and
  replacement are **literal** text (not POSIX regex). Flags: **g** (global per line),
  **i** (ignore case), **p** (print line when substitution happens; with **-n** only
  **p** lines print; without **-n**, **p** prints an extra copy like GNU). In
  replacement, **&** is the matched text; **\\\\&** is a literal **&**. Multiple **-e**
  scripts and **;**-separated commands in one script run in order on each line (**d**
  ends the line cycle like GNU). Mixed addresses (GNU-style): **/PAT/,Nd** deletes
  from the first line containing **PAT** through line **N** (inclusive); if that first
  match is on line **L** with **L > N**, only line **L** is deleted. **N,/PAT/d**
  deletes from line **N** through the first line containing **PAT** (inclusive). The
  same address rules apply to **s** (substitute on selected lines only).
  Operand **-** reads standard input. No **-f** or **-i** in-place.

Full documentation: <https://www.gnu.org/software/sed/manual/html_node/sed-invocation.html>
`;

/**
 * GNU-style option error for sed (exit status 2).
 * @param {string} arg
 * @returns {string}
 */
function sedOptionError(arg) {
  const tryLine = "Try 'sed --help' for more information.\n";
  if (arg.startsWith('--') && arg.length > 2) {
    return `sed: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `sed: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `sed: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * Parse jsh `sed` argv: -n, -e/--expression, --help/-h, --, then script + FILEs.
 *
 * @param {string[]} args
 * @returns {{ ok: true, quiet: boolean, scripts: string[], fileOperands: string[], help?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseSedArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  let quiet = false;
  /** @type {string[]} */
  const scripts = [];
  let i = 0;
  while (i < argsArr.length) {
    const arg = argsArr[i];
    if (arg === '--') {
      const rest = argsArr.slice(i + 1);
      return { ok: true, quiet, scripts, fileOperands: rest };
    }
    if (arg === '--help' || arg === '-h') {
      return { ok: true, help: true, quiet, scripts: [], fileOperands: [] };
    }
    if (arg === '-n' || arg === '--quiet' || arg === '--silent') {
      quiet = true;
      i++;
      continue;
    }
    if (arg === '-e' || arg === '--expression') {
      if (i + 1 >= argsArr.length) {
        return {
          ok: false,
          stderr: "sed: option requires an argument -- 'e'\n",
          exitCode: 2
        };
      }
      scripts.push(argsArr[i + 1]);
      i += 2;
      continue;
    }
    if (arg.startsWith('--expression=')) {
      const rest = arg.slice('--expression='.length);
      if (rest === '') {
        return {
          ok: false,
          stderr: "sed: option requires an argument -- 'expression'\n",
          exitCode: 2
        };
      }
      scripts.push(rest);
      i++;
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1 && !arg.startsWith('--')) {
      return { ok: false, stderr: sedOptionError(arg), exitCode: 2 };
    }
    if (arg.startsWith('--') && arg.length > 2) {
      return { ok: false, stderr: sedOptionError(arg), exitCode: 2 };
    }
    if (scripts.length === 0) {
      scripts.push(arg);
      i++;
      return { ok: true, quiet, scripts, fileOperands: argsArr.slice(i) };
    }
    return { ok: true, quiet, scripts, fileOperands: argsArr.slice(i) };
  }
  if (scripts.length === 0) {
    return { ok: false, stderr: 'sed: missing operand\n', exitCode: 2 };
  }
  return { ok: true, quiet, scripts, fileOperands: [] };
}

/**
 * Read one field in an `s` command until unescaped DELIM.
 * @param {string} s
 * @param {number} start
 * @param {string} delim
 * @returns {{ ok: true, text: string, next: number } | { ok: false, stderr: string }}
 */
function sedReadSubstField(s, start, delim) {
  let out = '';
  let i = start;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length) {
      const n = s[i + 1];
      if (n === delim) {
        out += delim;
        i += 2;
        continue;
      }
      if (n === '\\') {
        out += '\\';
        i += 2;
        continue;
      }
      if (n === 'n') {
        out += '\n';
        i += 2;
        continue;
      }
      if (n === 't') {
        out += '\t';
        i += 2;
        continue;
      }
    }
    if (c === delim) {
      return { ok: true, text: out, next: i + 1 };
    }
    out += c;
    i++;
  }
  return { ok: false, stderr: "sed: unterminated `s' command\n" };
}

/**
 * Expand GNU-style `&` and `\&` in substitute replacement (single match).
 * @param {string} replacement
 * @param {string} matched
 * @returns {string}
 */
function sedExpandSubstReplacement(replacement, matched) {
  let out = '';
  let i = 0;
  while (i < replacement.length) {
    if (replacement[i] === '\\' && i + 1 < replacement.length) {
      const n = replacement[i + 1];
      if (n === '&') {
        out += '&';
        i += 2;
        continue;
      }
      if (n === 'n') {
        out += '\n';
        i += 2;
        continue;
      }
      if (n === 't') {
        out += '\t';
        i += 2;
        continue;
      }
      if (n === '\\') {
        out += '\\';
        i += 2;
        continue;
      }
    }
    if (replacement[i] === '&') {
      out += matched;
      i++;
      continue;
    }
    out += replacement[i];
    i++;
  }
  return out;
}

/**
 * Parse one `s///` sed script (trimmed). Pattern/replacement are literals.
 *
 * @param {string} script
 * @returns {{ ok: true, pattern: string, replacement: string, global: boolean, printFlag: boolean, ignoreCase: boolean } | { ok: false, stderr: string }}
 */
function parseSedSubstituteScript(script) {
  const s = String(script).trim();
  if (!s.startsWith('s')) {
    return {
      ok: false,
      stderr: `sed: unsupported command \`${s.slice(0, 40)}${s.length > 40 ? '…' : ''}'\n`
    };
  }
  const delim = s[1];
  if (!delim || /[\r\n]/.test(delim)) {
    return { ok: false, stderr: "sed: invalid `s' command\n" };
  }
  const p1 = sedReadSubstField(s, 2, delim);
  if (!p1.ok) {
    return p1;
  }
  const p2 = sedReadSubstField(s, p1.next, delim);
  if (!p2.ok) {
    return p2;
  }
  let flags = s.slice(p2.next).trim();
  if (flags.length > 0 && flags[0] === delim) {
    flags = flags.slice(1).trim();
  }
  let global = false;
  let printFlag = false;
  let ignoreCase = false;
  for (const ch of flags) {
    if (ch === 'g') global = true;
    else if (ch === 'p') printFlag = true;
    else if (ch === 'i' || ch === 'I') ignoreCase = true;
    else {
      return { ok: false, stderr: `sed: unknown option to \`s' (${ch})\n` };
    }
  }
  return {
    ok: true,
    pattern: p1.text,
    replacement: p2.text,
    global,
    printFlag,
    ignoreCase
  };
}

/**
 * @param {{ type: 'single', n: number } | { type: 'single', last: true } | { type: 'range', start: number, end: number | 'last' } | { type: 'pattern', pattern: string } | { type: 'patternRange', start: string, end: string } | { type: 'patternToLine', pattern: string, n: number } | { type: 'lineToPattern', n: number, pattern: string }} address
 * @param {string} scriptFromS
 * @returns {{ ok: true, kind: 'substitute', address: typeof address, pattern: string, replacement: string, global: boolean, printFlag: boolean, ignoreCase: boolean } | { ok: false, stderr: string }}
 */
function parseSedSubstituteWithAddress(address, scriptFromS) {
  const sub = parseSedSubstituteScript(scriptFromS);
  if (!sub.ok) {
    return sub;
  }
  return {
    ok: true,
    kind: 'substitute',
    address,
    pattern: sub.pattern,
    replacement: sub.replacement,
    global: sub.global,
    printFlag: sub.printFlag,
    ignoreCase: sub.ignoreCase
  };
}

/**
 * Line-number **s** forms: **Ns** / **N,Ms** / **N,$s** (trimmed).
 *
 * @param {string} t
 * @returns {{ ok: true, kind: 'substitute', address: { type: 'single', n: number } | { type: 'range', start: number, end: number | 'last' }, pattern: string, replacement: string, global: boolean, printFlag: boolean, ignoreCase: boolean } | { ok: false, stderr: string } | null}
 */
function parseSedLineNumberSubstitute(t) {
  const s = String(t).trim();
  const mRange = /^([1-9]\d*),([1-9]\d*)s/.exec(s);
  if (mRange) {
    const rest = s.slice(mRange.index + mRange[0].length - 1);
    const sub = parseSedSubstituteScript(rest);
    if (!sub.ok) {
      return sub;
    }
    return {
      ok: true,
      kind: 'substitute',
      address: { type: 'range', start: parseInt(mRange[1], 10), end: parseInt(mRange[2], 10) },
      pattern: sub.pattern,
      replacement: sub.replacement,
      global: sub.global,
      printFlag: sub.printFlag,
      ignoreCase: sub.ignoreCase
    };
  }
  const mLast = /^([1-9]\d*),\$s/.exec(s);
  if (mLast) {
    const rest = s.slice(mLast.index + mLast[0].length - 1);
    const sub = parseSedSubstituteScript(rest);
    if (!sub.ok) {
      return sub;
    }
    return {
      ok: true,
      kind: 'substitute',
      address: { type: 'range', start: parseInt(mLast[1], 10), end: 'last' },
      pattern: sub.pattern,
      replacement: sub.replacement,
      global: sub.global,
      printFlag: sub.printFlag,
      ignoreCase: sub.ignoreCase
    };
  }
  const mSingle = /^([1-9]\d*)s(.)/.exec(s);
  if (mSingle) {
    const delim = mSingle[2];
    if (/[\r\n]/.test(delim)) {
      return null;
    }
    const rest = s.slice(mSingle.index + mSingle[1].length);
    const sub = parseSedSubstituteScript(rest);
    if (!sub.ok) {
      return sub;
    }
    return {
      ok: true,
      kind: 'substitute',
      address: { type: 'single', n: parseInt(mSingle[1], 10) },
      pattern: sub.pattern,
      replacement: sub.replacement,
      global: sub.global,
      printFlag: sub.printFlag,
      ignoreCase: sub.ignoreCase
    };
  }
  return null;
}

/**
 * **N,/PAT/s** — same address as **N,/PAT/d** with **s///** command.
 *
 * @param {string} t
 * @returns {{ ok: true, kind: 'substitute', address: { type: 'lineToPattern', n: number, pattern: string }, pattern: string, replacement: string, global: boolean, printFlag: boolean, ignoreCase: boolean } | { ok: false, stderr: string } | null}
 */
function parseSedLineToPatternSubstitute(t) {
  const s = String(t).trim();
  const m = /^([1-9]\d*),/.exec(s);
  if (!m) {
    return null;
  }
  const n = parseInt(m[1], 10);
  let pos = m[0].length;
  pos = sedSkipWs(s, pos);
  if (pos >= s.length || s[pos] !== '/') {
    return null;
  }
  const read = sedReadSubstField(s, pos + 1, '/');
  if (!read.ok) {
    return { ok: false, stderr: "sed: unterminated `/' pattern in address\n" };
  }
  const rest = s.slice(read.next).trim();
  if (!rest.startsWith('s')) {
    return null;
  }
  return parseSedSubstituteWithAddress({ type: 'lineToPattern', n, pattern: read.text }, rest);
}

/**
 * Slash-address PAT, comma, line N, then **s///** (same selection as slash-PAT comma **Nd** delete).
 *
 * @param {string} t
 * @returns {{ ok: true, kind: 'substitute', address: { type: 'patternToLine', pattern: string, n: number }, pattern: string, replacement: string, global: boolean, printFlag: boolean, ignoreCase: boolean } | { ok: false, stderr: string } | null}
 */
function parseSedSlashPatternToLineSubstitute(t) {
  const s = String(t).trim();
  if (!s.startsWith('/')) {
    return null;
  }
  const read1 = sedReadSubstField(s, 1, '/');
  if (!read1.ok) {
    return { ok: false, stderr: "sed: unterminated `/' pattern in address\n" };
  }
  let rest = s.slice(read1.next).trim();
  if (!rest.startsWith(',')) {
    return null;
  }
  rest = rest.slice(1).trim();
  const mNum = /^([1-9]\d*)s(.)/.exec(rest);
  if (!mNum) {
    return null;
  }
  const restFromS = rest.slice(mNum.index + mNum[1].length);
  const sub = parseSedSubstituteScript(restFromS);
  if (!sub.ok) {
    return sub;
  }
  return {
    ok: true,
    kind: 'substitute',
    address: { type: 'patternToLine', pattern: read1.text, n: parseInt(mNum[1], 10) },
    pattern: sub.pattern,
    replacement: sub.replacement,
    global: sub.global,
    printFlag: sub.printFlag,
    ignoreCase: sub.ignoreCase
  };
}

/**
 * Pattern range **PAT1** through **PAT2** (slash form), then **s///** substitute.
 *
 * @param {string} t
 * @returns {{ ok: true, kind: 'substitute', address: { type: 'patternRange', start: string, end: string }, pattern: string, replacement: string, global: boolean, printFlag: boolean, ignoreCase: boolean } | { ok: false, stderr: string } | null}
 */
function parseSedSlashPatternRangeSubstitute(t) {
  const s = String(t).trim();
  if (!s.startsWith('/')) {
    return null;
  }
  const read1 = sedReadSubstField(s, 1, '/');
  if (!read1.ok) {
    return { ok: false, stderr: "sed: unterminated `/' pattern in address\n" };
  }
  let rest = s.slice(read1.next).trim();
  if (!rest.startsWith(',')) {
    return null;
  }
  rest = rest.slice(1).trim();
  if (!rest.startsWith('/')) {
    return null;
  }
  const read2 = sedReadSubstField(rest, 1, '/');
  if (!read2.ok) {
    return { ok: false, stderr: read2.stderr };
  }
  const rest2 = rest.slice(read2.next).trim();
  if (!rest2.startsWith('s')) {
    return null;
  }
  return parseSedSubstituteWithAddress(
    { type: 'patternRange', start: read1.text, end: read2.text },
    rest2
  );
}

/**
 * Single slash **PAT** address, then **s///** substitute.
 *
 * @param {string} t
 * @returns {{ ok: true, kind: 'substitute', address: { type: 'pattern', pattern: string }, pattern: string, replacement: string, global: boolean, printFlag: boolean, ignoreCase: boolean } | { ok: false, stderr: string } | null}
 */
function parseSedSlashPatternSingleSubstitute(t) {
  const s = String(t).trim();
  if (!s.startsWith('/')) {
    return null;
  }
  const read = sedReadSubstField(s, 1, '/');
  if (!read.ok) {
    return { ok: false, stderr: "sed: unterminated `/' pattern in address\n" };
  }
  const rest = s.slice(read.next).trim();
  if (rest.startsWith(',')) {
    return null;
  }
  if (!rest.startsWith('s')) {
    return null;
  }
  return parseSedSubstituteWithAddress({ type: 'pattern', pattern: read.text }, rest);
}

/**
 * Parse line-number **d** forms: **Nd**, **$d**, **N,Md**, **N,$d** (trimmed).
 *
 * @param {string} t
 * @returns {{ ok: true, kind: 'delete', address: { type: 'single', n: number } | { type: 'single', last: true } | { type: 'range', start: number, end: number | 'last' } } } | null
 */
function parseSedAddressedDelete(t) {
  if (t === '$d') {
    return { ok: true, kind: 'delete', address: { type: 'single', last: true } };
  }
  const mN = /^([1-9]\d*)d$/.exec(t);
  if (mN) {
    const n = parseInt(mN[1], 10);
    return { ok: true, kind: 'delete', address: { type: 'single', n } };
  }
  const mRange = /^([1-9]\d*),([1-9]\d*)d$/.exec(t);
  if (mRange) {
    const a = parseInt(mRange[1], 10);
    const b = parseInt(mRange[2], 10);
    return { ok: true, kind: 'delete', address: { type: 'range', start: a, end: b } };
  }
  const mRangeLast = /^([1-9]\d*),\$d$/.exec(t);
  if (mRangeLast) {
    const a = parseInt(mRangeLast[1], 10);
    return { ok: true, kind: 'delete', address: { type: 'range', start: a, end: 'last' } };
  }
  return null;
}

/**
 * **N,/PAT/d** — line **N** through first line containing literal **PAT** (inclusive).
 *
 * @param {string} t
 * @returns {{ ok: true, kind: 'delete', address: { type: 'lineToPattern', n: number, pattern: string } } | { ok: false, stderr: string } | null}
 */
function parseSedLineToPatternDelete(t) {
  const s = String(t).trim();
  const m = /^([1-9]\d*),/.exec(s);
  if (!m) {
    return null;
  }
  const n = parseInt(m[1], 10);
  let pos = m[0].length;
  pos = sedSkipWs(s, pos);
  if (pos >= s.length || s[pos] !== '/') {
    return null;
  }
  const read = sedReadSubstField(s, pos + 1, '/');
  if (!read.ok) {
    return { ok: false, stderr: "sed: unterminated `/' pattern in address\n" };
  }
  const rest = s.slice(read.next).trim();
  if (rest === 'd') {
    return {
      ok: true,
      kind: 'delete',
      address: { type: 'lineToPattern', n, pattern: read.text }
    };
  }
  if (rest === '') {
    return { ok: false, stderr: "sed: missing command after `/pattern/'\n" };
  }
  return {
    ok: false,
    stderr: `sed: unsupported command \`${rest.slice(0, 40)}${
      rest.length > 40 ? '…' : ''
    }' after /pattern/\n`
  };
}

/**
 * Slash pattern through line number: **\/PAT/,Nd** — first line matching **PAT** through line **N**
 * (GNU: if **L > N**, only line **L**).
 *
 * @param {string} t
 * @returns {{ ok: true, kind: 'delete', address: { type: 'patternToLine', pattern: string, n: number } } | { ok: false, stderr: string } | null}
 */
function parseSedSlashPatternToLineDelete(t) {
  const s = String(t).trim();
  if (!s.startsWith('/')) {
    return null;
  }
  const read1 = sedReadSubstField(s, 1, '/');
  if (!read1.ok) {
    return { ok: false, stderr: "sed: unterminated `/' pattern in address\n" };
  }
  let rest = s.slice(read1.next).trim();
  if (!rest.startsWith(',')) {
    return null;
  }
  rest = rest.slice(1).trim();
  const mNum = /^([1-9]\d*)d$/.exec(rest);
  if (!mNum) {
    if (/^[1-9]/.test(rest)) {
      return { ok: false, stderr: 'sed: invalid address range\n' };
    }
    return null;
  }
  const n = parseInt(mNum[1], 10);
  return {
    ok: true,
    kind: 'delete',
    address: { type: 'patternToLine', pattern: read1.text, n }
  };
}

/**
 * Parse a slash-delimited pattern delete command (literal substring; escapes match sedReadSubstField with slash).
 *
 * @param {string} t
 * @returns {{ ok: true, kind: 'delete', address: { type: 'pattern', pattern: string } } | { ok: false, stderr: string } | null}
 */
function parseSedSlashPatternDelete(t) {
  const s = String(t).trim();
  if (!s.startsWith('/')) {
    return null;
  }
  const read = sedReadSubstField(s, 1, '/');
  if (!read.ok) {
    return { ok: false, stderr: "sed: unterminated `/' pattern in address\n" };
  }
  const rest = s.slice(read.next).trim();
  if (rest.startsWith(',')) {
    return null;
  }
  if (rest === 'd') {
    return { ok: true, kind: 'delete', address: { type: 'pattern', pattern: read.text } };
  }
  if (rest === '') {
    return { ok: false, stderr: "sed: missing command after `/pattern/'\n" };
  }
  return {
    ok: false,
    stderr: `sed: unsupported command \`${rest.slice(0, 40)}${
      rest.length > 40 ? '…' : ''
    }' after /pattern/\n`
  };
}

/**
 * Parse a two-pattern delete command: slash, PAT1, slash, comma, slash, PAT2, slash, `d`
 * (literal substrings; same escapes as **s///**).
 *
 * @param {string} t
 * @returns {{ ok: true, kind: 'delete', address: { type: 'patternRange', start: string, end: string } } | { ok: false, stderr: string } | null}
 */
function parseSedSlashPatternRangeDelete(t) {
  const s = String(t).trim();
  if (!s.startsWith('/')) {
    return null;
  }
  const read1 = sedReadSubstField(s, 1, '/');
  if (!read1.ok) {
    return { ok: false, stderr: "sed: unterminated `/' pattern in address\n" };
  }
  let rest = s.slice(read1.next).trim();
  if (!rest.startsWith(',')) {
    return null;
  }
  rest = rest.slice(1).trim();
  if (!rest.startsWith('/')) {
    return { ok: false, stderr: 'sed: invalid address range\n' };
  }
  const read2 = sedReadSubstField(rest, 1, '/');
  if (!read2.ok) {
    return { ok: false, stderr: "sed: unterminated `/' pattern in address\n" };
  }
  const rest2 = rest.slice(read2.next).trim();
  if (rest2 === 'd') {
    return {
      ok: true,
      kind: 'delete',
      address: { type: 'patternRange', start: read1.text, end: read2.text }
    };
  }
  if (rest2 === '') {
    return { ok: false, stderr: "sed: missing command after `/pattern/'\n" };
  }
  return {
    ok: false,
    stderr: `sed: unsupported command \`${rest2.slice(0, 40)}${
      rest2.length > 40 ? '…' : ''
    }' after range\n`
  };
}

/**
 * @param {string} s
 * @param {number} i
 * @returns {number}
 */
function sedSkipWs(s, i) {
  while (i < s.length && /\s/.test(s[i])) i++;
  return i;
}

/**
 * Consume one **s///** command starting after **sedSkipWs**; **next** index stops
 * before any **;** that separates commands (GNU-style).
 *
 * @param {string} s
 * @param {number} start
 * @returns {{ ok: true, next: number } | { ok: false, stderr: string }}
 */
function sedConsumeSubstituteCommand(s, start) {
  const i = sedSkipWs(s, start);
  if (i >= s.length || s[i] !== 's') {
    return {
      ok: false,
      stderr: `sed: unsupported command \`${String(s.slice(start)).trim().slice(0, 40)}${
        String(s.slice(start)).trim().length > 40 ? '…' : ''
      }'\n`
    };
  }
  const delim = s[i + 1];
  if (!delim || /[\r\n]/.test(delim)) {
    return { ok: false, stderr: "sed: invalid `s' command\n" };
  }
  const p1 = sedReadSubstField(s, i + 2, delim);
  if (!p1.ok) return p1;
  const p2 = sedReadSubstField(s, p1.next, delim);
  if (!p2.ok) return p2;
  let j = p2.next;
  j = sedSkipWs(s, j);
  if (j < s.length && s[j] === delim) {
    j++;
    j = sedSkipWs(s, j);
  }
  while (j < s.length && /[gipI]/.test(s[j])) j++;
  j = sedSkipWs(s, j);
  if (j < s.length && s[j] !== ';') {
    return { ok: false, stderr: `sed: unknown option to \`s' (${s[j]})\n` };
  }
  return { ok: true, next: j };
}

/**
 * **Ns** / **N,Ms** / **N,$s** at **start** (after whitespace).
 *
 * @param {string} s
 * @param {number} start
 * @returns {{ ok: true, next: number } | { ok: false, stderr: string } | null}
 */
function sedConsumeLineNumberedSubstitute(s, start) {
  const i = sedSkipWs(s, start);
  const sub = s.slice(i);
  const m = /^([1-9]\d*),([1-9]\d*)s/.exec(sub);
  const m2 = /^([1-9]\d*),\$s/.exec(sub);
  const m3 = /^([1-9]\d*)s/.exec(sub);
  let sPos = -1;
  if (m) {
    sPos = i + m.index + m[0].length - 1;
  } else if (m2) {
    sPos = i + m2.index + m2[0].length - 1;
  } else if (m3) {
    sPos = i + m3.index + m3[0].length - 1;
  }
  if (sPos < 0) {
    return null;
  }
  return sedConsumeSubstituteCommand(s, sPos);
}

/**
 * Consume slash-delimited **pat** **d** or **pat1**,**pat2** range **d** from **start**
 * (after whitespace); **null** if the line does not start with a slash.
 *
 * @param {string} s
 * @param {number} start
 * @returns {{ ok: true, next: number } | { ok: false, stderr: string } | null}
 */
function sedConsumeSlashDelete(s, start) {
  const i = sedSkipWs(s, start);
  if (i >= s.length || s[i] !== '/') {
    return null;
  }
  const r1 = sedReadSubstField(s, i + 1, '/');
  if (!r1.ok) {
    return { ok: false, stderr: r1.stderr };
  }
  let pos = r1.next;
  pos = sedSkipWs(s, pos);
  if (pos >= s.length) {
    return { ok: false, stderr: "sed: missing command after `/pattern/'\n" };
  }
  if (s[pos] === ',') {
    pos++;
    pos = sedSkipWs(s, pos);
    if (pos >= s.length) {
      return { ok: false, stderr: 'sed: invalid address range\n' };
    }
    if (/[1-9]/.test(s[pos])) {
      let j = pos;
      while (j < s.length && /[0-9]/.test(s[j])) {
        j++;
      }
      if (j === pos) {
        return { ok: false, stderr: 'sed: invalid address range\n' };
      }
      pos = sedSkipWs(s, j);
      if (pos >= s.length || s[pos] !== 'd') {
        if (pos < s.length && s[pos] === 's') {
          return sedConsumeSubstituteCommand(s, pos);
        }
        const rest = pos < s.length ? s.slice(pos) : '';
        if (rest === '') {
          return { ok: false, stderr: "sed: missing command after `/pattern/'\n" };
        }
        return {
          ok: false,
          stderr: `sed: unsupported command \`${rest.slice(0, 40)}${
            rest.length > 40 ? '…' : ''
          }' after range\n`
        };
      }
      return { ok: true, next: pos + 1 };
    }
    if (s[pos] !== '/') {
      return { ok: false, stderr: 'sed: invalid address range\n' };
    }
    const r2 = sedReadSubstField(s, pos + 1, '/');
    if (!r2.ok) {
      return { ok: false, stderr: r2.stderr };
    }
    pos = r2.next;
    pos = sedSkipWs(s, pos);
    if (pos >= s.length || s[pos] !== 'd') {
      if (pos < s.length && s[pos] === 's') {
        return sedConsumeSubstituteCommand(s, pos);
      }
      const rest = pos < s.length ? s.slice(pos) : '';
      if (rest === '') {
        return { ok: false, stderr: "sed: missing command after `/pattern/'\n" };
      }
      return {
        ok: false,
        stderr: `sed: unsupported command \`${rest.slice(0, 40)}${
          rest.length > 40 ? '…' : ''
        }' after range\n`
      };
    }
    return { ok: true, next: pos + 1 };
  }
  if (s[pos] === 'd' && (pos + 1 >= s.length || /[\s;]/.test(s[pos + 1]))) {
    return { ok: true, next: pos + 1 };
  }
  if (s[pos] === 's') {
    return sedConsumeSubstituteCommand(s, pos);
  }
  const rest = s.slice(pos);
  if (rest === '') {
    return { ok: false, stderr: "sed: missing command after `/pattern/'\n" };
  }
  return {
    ok: false,
    stderr: `sed: unsupported command \`${rest.slice(0, 40)}${
      rest.length > 40 ? '…' : ''
    }' after /pattern/\n`
  };
}

/**
 * **N,/PAT/d** starting at **start** (after whitespace).
 *
 * @param {string} s
 * @param {number} start
 * @returns {{ ok: true, next: number } | { ok: false, stderr: string } | null}
 */
function sedConsumeLinePatternDelete(s, start) {
  const i = sedSkipWs(s, start);
  const sub = s.slice(i);
  const m = /^([1-9]\d*),\//.exec(sub);
  if (!m) {
    return null;
  }
  const slashPos = i + m[0].length - 1;
  const read = sedReadSubstField(s, slashPos + 1, '/');
  if (!read.ok) {
    return { ok: false, stderr: read.stderr };
  }
  let pos = read.next;
  pos = sedSkipWs(s, pos);
  if (pos >= s.length || s[pos] !== 'd') {
    if (pos < s.length && s[pos] === 's') {
      return sedConsumeSubstituteCommand(s, pos);
    }
    const rest = pos < s.length ? s.slice(pos) : '';
    if (rest === '') {
      return { ok: false, stderr: "sed: missing command after `/pattern/'\n" };
    }
    return {
      ok: false,
      stderr: `sed: unsupported command \`${rest.slice(0, 40)}${
        rest.length > 40 ? '…' : ''
      }' after /pattern/\n`
    };
  }
  return { ok: true, next: pos + 1 };
}

/**
 * Find end index of one sed command in a script string (**;**-separable).
 *
 * @param {string} s
 * @param {number} start
 * @returns {{ ok: true, next: number, empty?: true } | { ok: false, stderr: string }}
 */
function sedConsumeOneCommand(s, start) {
  let i = sedSkipWs(s, start);
  if (i >= s.length) {
    return { ok: true, next: start, empty: true };
  }
  if (s[i] === 's') {
    return sedConsumeSubstituteCommand(s, start);
  }
  const lineNumSub = sedConsumeLineNumberedSubstitute(s, start);
  if (lineNumSub !== null) {
    return lineNumSub;
  }
  const linePat = sedConsumeLinePatternDelete(s, start);
  if (linePat !== null) {
    return linePat;
  }
  const slash = sedConsumeSlashDelete(s, start);
  if (slash !== null) {
    return slash;
  }
  const sub = s.slice(i);
  const mRange = /^([1-9]\d*),([1-9]\d*)d(?=\s|;|$)/.exec(sub);
  if (mRange) {
    return { ok: true, next: i + mRange[0].length };
  }
  const mRangeLast = /^([1-9]\d*),\$d(?=\s|;|$)/.exec(sub);
  if (mRangeLast) {
    return { ok: true, next: i + mRangeLast[0].length };
  }
  const mN = /^([1-9]\d*)d(?=\s|;|$)/.exec(sub);
  if (mN) {
    return { ok: true, next: i + mN[0].length };
  }
  const mDollar = /^\$d(?=\s|;|$)/.exec(sub);
  if (mDollar) {
    return { ok: true, next: i + 2 };
  }
  if (s[i] === 'd' && (i + 1 >= s.length || /[\s;]/.test(s[i + 1]))) {
    return { ok: true, next: i + 1 };
  }
  return {
    ok: false,
    stderr: `sed: unsupported command \`${sub.slice(0, 40)}${sub.length > 40 ? '…' : ''}'\n`
  };
}

/**
 * Split one **SCRIPT** string into commands separated by **;** (outside **s**-command
 * delimiter fields). Same effect as multiple **-e** fragments. Empty / whitespace-only →
 * no commands (pass-through).
 *
 * @param {string} script
 * @returns {{ ok: true, commands: string[] } | { ok: false, stderr: string }}
 */
function splitSedScriptIntoCommands(script) {
  const s = String(script);
  if (!s.trim()) {
    return { ok: true, commands: [] };
  }
  /** @type {string[]} */
  const commands = [];
  let i = 0;
  while (i < s.length) {
    i = sedSkipWs(s, i);
    if (i >= s.length) break;
    if (s[i] === ';') {
      i++;
      continue;
    }
    const r = sedConsumeOneCommand(s, i);
    if (!r.ok) return r;
    if (r.empty) {
      return { ok: false, stderr: 'sed: invalid script\n' };
    }
    const cmd = s.slice(i, r.next).trim();
    if (cmd.length) commands.push(cmd);
    i = r.next;
    i = sedSkipWs(s, i);
    if (i < s.length && s[i] === ';') {
      i++;
      continue;
    }
    if (i >= s.length) break;
    return { ok: false, stderr: 'sed: extra characters after command\n' };
  }
  return { ok: true, commands };
}

/**
 * Whether **lineNum** (1-based) is selected by an addressed **d** spec.
 * For **{ type: 'pattern' }**, pass **lineText** (substring match); **lineNum** /
 * **totalLines** are ignored.
 *
 * @param {{ type: 'single', n: number } | { type: 'single', last: true } | { type: 'range', start: number, end: number | 'last' } | { type: 'pattern', pattern: string }} address
 * @param {number} lineNum
 * @param {number} totalLines
 * @param {string} [lineText]
 * @returns {boolean}
 */
function sedLineMatchesDeleteAddress(address, lineNum, totalLines, lineText) {
  if (address.type === 'pattern') {
    const pat = address.pattern;
    if (pat === '') {
      return true;
    }
    return String(lineText).indexOf(pat) >= 0;
  }
  if (address.type === 'single') {
    if ('last' in address && address.last === true) {
      return lineNum === totalLines;
    }
    return lineNum === address.n;
  }
  const { start, end } = address;
  if (typeof end === 'number') {
    if (start > end) {
      return false;
    }
    return lineNum >= start && lineNum <= end;
  }
  return lineNum >= start;
}

/**
 * Parse one jsh `sed` script: **d** (delete line(s)), line-addressed **d**, pattern **d**, pattern-range **d**, or **s///** substitute.
 *
 * @param {string} script
 * @returns {{ ok: true, kind: 'delete', address?: null | { type: 'single', n: number } | { type: 'single', last: true } | { type: 'range', start: number, end: number | 'last' } | { type: 'pattern', pattern: string } | { type: 'patternRange', start: string, end: string } | { type: 'patternToLine', pattern: string, n: number } | { type: 'lineToPattern', n: number, pattern: string } } | { ok: true, kind: 'substitute', address?: { type: 'single', n: number } | { type: 'single', last: true } | { type: 'range', start: number, end: number | 'last' } | { type: 'pattern', pattern: string } | { type: 'patternRange', start: string, end: string } | { type: 'patternToLine', pattern: string, n: number } | { type: 'lineToPattern', n: number, pattern: string }, pattern: string, replacement: string, global: boolean, printFlag: boolean, ignoreCase: boolean } | { ok: false, stderr: string }}
 */
function parseSedScript(script) {
  const t = String(script).trim();
  if (t === 'd') {
    return { ok: true, kind: 'delete', address: null };
  }
  const addrDel = parseSedAddressedDelete(t);
  if (addrDel) {
    return addrDel;
  }
  const lineNumSub = parseSedLineNumberSubstitute(t);
  if (lineNumSub !== null) {
    return lineNumSub;
  }
  const linePatSub = parseSedLineToPatternSubstitute(t);
  if (linePatSub !== null) {
    return linePatSub;
  }
  const linePatDel = parseSedLineToPatternDelete(t);
  if (linePatDel !== null) {
    return linePatDel;
  }
  if (t.startsWith('/')) {
    const patToLineSub = parseSedSlashPatternToLineSubstitute(t);
    if (patToLineSub !== null) {
      return patToLineSub;
    }
    const patToLine = parseSedSlashPatternToLineDelete(t);
    if (patToLine !== null) {
      return patToLine;
    }
    const rangeSub = parseSedSlashPatternRangeSubstitute(t);
    if (rangeSub !== null) {
      return rangeSub;
    }
    const rangeDel = parseSedSlashPatternRangeDelete(t);
    if (rangeDel !== null) {
      return rangeDel;
    }
    const slashSub = parseSedSlashPatternSingleSubstitute(t);
    if (slashSub !== null) {
      return slashSub;
    }
    const slashDel = parseSedSlashPatternDelete(t);
    return slashDel;
  }
  const sub = parseSedSubstituteScript(script);
  if (!sub.ok) {
    return sub;
  }
  return {
    ok: true,
    kind: 'substitute',
    pattern: sub.pattern,
    replacement: sub.replacement,
    global: sub.global,
    printFlag: sub.printFlag,
    ignoreCase: sub.ignoreCase
  };
}

/**
 * Apply one literal substitute to a line; returns updated line and whether a replacement occurred.
 *
 * @param {string} line
 * @param {{ pattern: string, replacement: string, global: boolean, ignoreCase: boolean }} spec
 * @returns {{ line: string, subbed: boolean }}
 */
function sedApplySubstituteLine(line, spec) {
  const { pattern, replacement, global, ignoreCase } = spec;
  if (pattern === '') {
    return { line, subbed: false };
  }

  function oneReplace(src, pat, replFn) {
    if (!ignoreCase) {
      const idx = src.indexOf(pat);
      if (idx < 0) {
        return { out: src, subbed: false };
      }
      const matched = src.slice(idx, idx + pat.length);
      const repl = replFn(matched);
      return {
        out: src.slice(0, idx) + repl + src.slice(idx + pat.length),
        subbed: true
      };
    }
    const lower = src.toLowerCase();
    const p = pat.toLowerCase();
    const idx = lower.indexOf(p);
    if (idx < 0) {
      return { out: src, subbed: false };
    }
    const matched = src.slice(idx, idx + pattern.length);
    const repl = replFn(matched);
    return {
      out: src.slice(0, idx) + repl + src.slice(idx + pattern.length),
      subbed: true
    };
  }

  if (!global) {
    const r = oneReplace(line, pattern, (m) => sedExpandSubstReplacement(replacement, m));
    return { line: r.out, subbed: r.subbed };
  }

  let out = line;
  let any = false;
  if (!ignoreCase) {
    let pos = 0;
    while (pos <= out.length) {
      const idx = out.indexOf(pattern, pos);
      if (idx < 0) {
        break;
      }
      const matched = out.slice(idx, idx + pattern.length);
      const repl = sedExpandSubstReplacement(replacement, matched);
      out = out.slice(0, idx) + repl + out.slice(idx + pattern.length);
      pos = idx + repl.length;
      any = true;
    }
    return { line: out, subbed: any };
  }

  const esc = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(esc, 'gi');
  const newLine = out.replace(re, (m) => {
    any = true;
    return sedExpandSubstReplacement(replacement, m);
  });
  return { line: newLine, subbed: any };
}

/**
 * Run parsed sed scripts on full text (newline-separated lines). Specs may be
 * **parseSedScript** results (**kind: 'delete'** | **'substitute'**) or legacy
 * substitute-only objects from **parseSedSubstituteScript**.
 *
 * @param {string} content
 * @param {Array<{ kind?: 'delete' | 'substitute', address?: null | { type: 'single', n: number } | { type: 'single', last: true } | { type: 'range', start: number, end: number | 'last' } | { type: 'pattern', pattern: string } | { type: 'patternRange', start: string, end: string } | { type: 'patternToLine', pattern: string, n: number } | { type: 'lineToPattern', n: number, pattern: string }, pattern?: string, replacement?: string, global?: boolean, printFlag?: boolean, ignoreCase?: boolean }>} specs — **substitute** may include **address** (same shapes as **delete**).
 * @param {boolean} quiet
 * @returns {string}
 */
function sedProcessContent(content, specs, quiet) {
  const trailingNl = content.endsWith('\n');
  let lines = content.split('\n');
  if (trailingNl && lines.length > 0 && lines[lines.length - 1] === '') {
    lines = lines.slice(0, -1);
  }
  /** @type {Array<{ active: boolean } | null>} */
  const patternRangeStates = specs.map((spec) =>
    spec.address && spec.address.type === 'patternRange' ? { active: false } : null
  );
  /** @type {Array<{ phase: 'idle' | 'in_range' } | null>} */
  const patternToLineStates = specs.map((spec) =>
    spec.address && spec.address.type === 'patternToLine' ? { phase: 'idle' } : null
  );
  /** @type {Array<{ phase: 'idle' | 'in_range' } | null>} */
  const lineToPatternStates = specs.map((spec) =>
    spec.address && spec.address.type === 'lineToPattern' ? { phase: 'idle' } : null
  );
  const outParts = [];
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    let cur = line;
    /** @type {string[]} */
    const pPrints = [];
    let deleted = false;
    for (let si = 0; si < specs.length; si++) {
      const spec = specs[si];
      if (spec.kind === 'delete') {
        if (spec.address == null) {
          deleted = true;
          break;
        }
        if (spec.address.type === 'patternRange') {
          const st = patternRangeStates[si];
          const { start: startPat, end: endPat } = spec.address;
          const hasStart = startPat === '' || line.indexOf(startPat) >= 0;
          const hasEnd = endPat === '' || line.indexOf(endPat) >= 0;
          if (!st.active) {
            if (hasStart) {
              st.active = true;
              deleted = true;
              break;
            }
            continue;
          }
          if (hasEnd) {
            deleted = true;
            st.active = false;
            break;
          }
          deleted = true;
          break;
        }
        if (spec.address.type === 'patternToLine') {
          const st = patternToLineStates[si];
          const { pattern: pat, n: endLine } = spec.address;
          const lineNum = li + 1;
          const lineHasPat = pat === '' || line.indexOf(pat) >= 0;
          if (st.phase === 'idle') {
            if (lineHasPat) {
              const L = lineNum;
              if (L <= endLine) {
                st.phase = 'in_range';
                deleted = true;
                break;
              }
              deleted = true;
              break;
            }
            continue;
          }
          deleted = true;
          if (lineNum === endLine) {
            st.phase = 'idle';
          }
          break;
        }
        if (spec.address.type === 'lineToPattern') {
          const st = lineToPatternStates[si];
          const { n: startLine, pattern: pat } = spec.address;
          const lineNum = li + 1;
          const lineHasPat = pat === '' || line.indexOf(pat) >= 0;
          if (st.phase === 'idle') {
            if (lineNum === startLine) {
              if (lineHasPat) {
                deleted = true;
                break;
              }
              st.phase = 'in_range';
              deleted = true;
              break;
            }
            continue;
          }
          if (lineHasPat) {
            st.phase = 'idle';
            deleted = true;
            break;
          }
          deleted = true;
          break;
        }
        const lineNum = li + 1;
        const totalLines = lines.length;
        if (spec.address.type === 'pattern') {
          if (sedLineMatchesDeleteAddress(spec.address, lineNum, totalLines, line)) {
            deleted = true;
            break;
          }
          continue;
        }
        if (sedLineMatchesDeleteAddress(spec.address, lineNum, totalLines)) {
          deleted = true;
          break;
        }
        continue;
      }
      if (spec.kind === 'substitute' && spec.address) {
        const lineNum = li + 1;
        const totalLines = lines.length;
        if (spec.address.type === 'patternRange') {
          const st = patternRangeStates[si];
          const { start: startPat, end: endPat } = spec.address;
          const hasStart = startPat === '' || line.indexOf(startPat) >= 0;
          const hasEnd = endPat === '' || line.indexOf(endPat) >= 0;
          if (!st.active) {
            if (hasStart) {
              st.active = true;
              const r = sedApplySubstituteLine(cur, spec);
              cur = r.line;
              if (spec.printFlag && r.subbed) {
                pPrints.push(cur);
              }
              if (hasEnd) {
                st.active = false;
              }
            }
            continue;
          }
          const r = sedApplySubstituteLine(cur, spec);
          cur = r.line;
          if (spec.printFlag && r.subbed) {
            pPrints.push(cur);
          }
          if (hasEnd) {
            st.active = false;
          }
          continue;
        }
        if (spec.address.type === 'patternToLine') {
          const st = patternToLineStates[si];
          const { pattern: pat, n: endLine } = spec.address;
          const lineHasPat = pat === '' || line.indexOf(pat) >= 0;
          if (st.phase === 'idle') {
            if (lineHasPat) {
              const L = lineNum;
              if (L <= endLine) {
                st.phase = 'in_range';
                const r = sedApplySubstituteLine(cur, spec);
                cur = r.line;
                if (spec.printFlag && r.subbed) {
                  pPrints.push(cur);
                }
                continue;
              }
              const r = sedApplySubstituteLine(cur, spec);
              cur = r.line;
              if (spec.printFlag && r.subbed) {
                pPrints.push(cur);
              }
              continue;
            }
            continue;
          }
          const r = sedApplySubstituteLine(cur, spec);
          cur = r.line;
          if (spec.printFlag && r.subbed) {
            pPrints.push(cur);
          }
          if (lineNum === endLine) {
            st.phase = 'idle';
          }
          continue;
        }
        if (spec.address.type === 'lineToPattern') {
          const st = lineToPatternStates[si];
          const { n: startLine, pattern: pat } = spec.address;
          const lineHasPat = pat === '' || line.indexOf(pat) >= 0;
          if (st.phase === 'idle') {
            if (lineNum === startLine) {
              if (lineHasPat) {
                const r = sedApplySubstituteLine(cur, spec);
                cur = r.line;
                if (spec.printFlag && r.subbed) {
                  pPrints.push(cur);
                }
                continue;
              }
              st.phase = 'in_range';
              const r = sedApplySubstituteLine(cur, spec);
              cur = r.line;
              if (spec.printFlag && r.subbed) {
                pPrints.push(cur);
              }
              continue;
            }
            continue;
          }
          const r = sedApplySubstituteLine(cur, spec);
          cur = r.line;
          if (spec.printFlag && r.subbed) {
            pPrints.push(cur);
          }
          if (lineHasPat) {
            st.phase = 'idle';
          }
          continue;
        }
        if (spec.address.type === 'pattern') {
          if (sedLineMatchesDeleteAddress(spec.address, lineNum, totalLines, line)) {
            const r = sedApplySubstituteLine(cur, spec);
            cur = r.line;
            if (spec.printFlag && r.subbed) {
              pPrints.push(cur);
            }
          }
          continue;
        }
        if (sedLineMatchesDeleteAddress(spec.address, lineNum, totalLines)) {
          const r = sedApplySubstituteLine(cur, spec);
          cur = r.line;
          if (spec.printFlag && r.subbed) {
            pPrints.push(cur);
          }
        }
        continue;
      }
      const r = sedApplySubstituteLine(cur, spec);
      cur = r.line;
      if (spec.printFlag && r.subbed) {
        pPrints.push(cur);
      }
    }
    const addNl = li < lines.length - 1 || trailingNl;
    if (deleted) {
      // GNU: **p** before **d** on the same line still prints; **d** suppresses only the default print.
      if (quiet) {
        for (const pl of pPrints) {
          outParts.push(pl);
          if (addNl) {
            outParts.push('\n');
          }
        }
      } else {
        for (const pl of pPrints) {
          outParts.push(pl);
          outParts.push('\n');
        }
      }
      continue;
    }
    if (quiet) {
      for (const pl of pPrints) {
        outParts.push(pl);
        if (addNl) {
          outParts.push('\n');
        }
      }
      continue;
    }
    for (const pl of pPrints) {
      outParts.push(pl);
      outParts.push('\n');
    }
    outParts.push(cur);
    if (addNl) {
      outParts.push('\n');
    }
  }
  return outParts.join('');
}

const AWK_HELP = `Usage: awk [POSIX or GNU-style options]... 'program' [FILE]...
Pattern scanning and processing language (jsh subset).

  -F SEP, --field-separator=SEP   use SEP as field separator (default: whitespace)
  -h, --help                       display this help and exit
      --                           end of options

jsh:
  **program** may include optional **BEGIN {print ...}**, optional **{print ...}**,
  optional **END {print ...}** (that order). Each EXPR is **$0**, **$N**, **NR**,
  **NF**, **RSTART**, **RLENGTH**, a quoted string, **length** / **length()** / **length(EXPR)**,
  **substr(S, I [, L])** (1-based **I**, optional length **L**; **I** before **1** is
  treated as **1** like GNU awk),   **index(S, T)** (1-based start of first **T** in **S**,
  or **0**), **match(S, P [, ARRAY])** (literal substring **P** in **S** unless **P** is **slash-delimited**
  **/ERE/flags** — then **JavaScript RegExp**; sets **RSTART** / **RLENGTH**; returns start index or **0**;
  optional third arg must be an identifier — clears and fills **ARRAY[0]** (full match), **ARRAY[1]**… (regex
  capture groups only); read back with **ARRAY[EXPR]** — **EXPR** may be a number, **$N**, or nested **ARRAY[…]**),
  **split(STRING, ARRAY [, SEP])** (fills **ARRAY[1]**…; **SEP** defaults to current **-F** FS; returns field count),
  **gsub(PAT, REP [, $N])** / **sub(...)** (literal **PAT** unless **/ERE/flags**; mutates **$0** or **$N**;
  returns substitution count; in **regex** mode **REP** expands **&** to the match and **\\1**–**\\9** to groups). Arithmetic: **+**, **-**, ${'*'}, **/**, **%**, **^** (exponentiation is
  right-associative, e.g. **2^3^2** → **512**; **^** binds before unary **-**, so **-2^2** → **-4**),
  unary **-**, parentheses; operands are numeric literals, **$N**, **NR**, **NF**,
  **RSTART**, **RLENGTH**, quoted strings (coerced like awk), and **length(...)**. **print** with no expressions prints **$0**. **BEGIN** sees **NR=0**,
  **NF=0**, **$0** empty. **END** sees the last record (**NR=0** if no input). Default
  field splitting matches runs of whitespace; **-F** uses a literal separator string
  (often one character). **/ERE/** uses **JavaScript** syntax (not full POSIX ERE); invalid patterns fail the **print** expression. No patterns, user variables, or **-f** script files.
  **gsub** with empty **PAT**: GNU-style — inserts **REP** at each of **length($N)+1** positions (before
  each character and after the last). **sub** with empty **PAT**: one insertion before the first character only.

Full documentation: <https://www.gnu.org/software/gawk/manual/html_node/Getting-Started.html>
`;

/**
 * GNU-style option error for awk (exit status 2).
 * @param {string} arg
 * @returns {string}
 */
function awkOptionError(arg) {
  const tryLine = "Try 'awk --help' for more information.\n";
  if (arg.startsWith('--') && arg.length > 2) {
    return `awk: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `awk: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `awk: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * Parse jsh `awk` argv: -F/--field-separator, --help/-h, --, program, FILEs.
 *
 * @param {string[]} args
 * @returns {{ ok: true, fieldSeparator: string, program: string, fileOperands: string[], help?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseAwkArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  let fieldSeparator = ' ';
  let i = 0;
  while (i < argsArr.length) {
    const arg = argsArr[i];
    if (arg === '--') {
      const rest = argsArr.slice(i + 1);
      if (rest.length === 0) {
        return { ok: false, stderr: 'awk: missing program\n', exitCode: 2 };
      }
      return {
        ok: true,
        fieldSeparator,
        program: rest[0],
        fileOperands: rest.slice(1)
      };
    }
    if (arg === '--help' || arg === '-h') {
      return { ok: true, help: true, fieldSeparator, program: '', fileOperands: [] };
    }
    if (arg === '-F' || arg === '--field-separator') {
      if (i + 1 >= argsArr.length) {
        return {
          ok: false,
          stderr: "awk: option requires an argument -- 'F'\n",
          exitCode: 2
        };
      }
      fieldSeparator = argsArr[i + 1];
      i += 2;
      continue;
    }
    if (arg.startsWith('--field-separator=')) {
      const rest = arg.slice('--field-separator='.length);
      if (rest === '') {
        return {
          ok: false,
          stderr: "awk: option requires an argument -- 'field-separator'\n",
          exitCode: 2
        };
      }
      fieldSeparator = rest;
      i++;
      continue;
    }
    if (arg.startsWith('-F') && arg.length > 2) {
      fieldSeparator = arg.slice(2);
      i++;
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1 && !arg.startsWith('--')) {
      return { ok: false, stderr: awkOptionError(arg), exitCode: 2 };
    }
    if (arg.startsWith('--') && arg.length > 2) {
      return { ok: false, stderr: awkOptionError(arg), exitCode: 2 };
    }
    return {
      ok: true,
      fieldSeparator,
      program: arg,
      fileOperands: argsArr.slice(i + 1)
    };
  }
  return { ok: false, stderr: 'awk: missing program\n', exitCode: 2 };
}

/**
 * Split awk default (whitespace) fields — $0 preserved separately.
 * @param {string} line
 * @returns {string[]}
 */
function awkSplitFieldsDefault(line) {
  const m = line.match(/[^\s]+/g);
  return m || [];
}

/**
 * @param {string} line
 * @param {string} fs — ' ' means default whitespace; otherwise literal split string
 * @returns {string[]}
 */
function awkSplitFields(line, fs) {
  if (fs === ' ') {
    return awkSplitFieldsDefault(line);
  }
  return line.split(fs);
}

/**
 * Split at top-level commas (respects quotes and **(...)** nesting). Used for
 * **`print` arg lists** and for function-call argument lists (**`substr`**, **`index`**).
 * @param {string} s
 * @returns {string[]}
 */
function awkSplitCommaListTopLevel(s) {
  const parts = [];
  let cur = '';
  let depth = 0;
  let i = 0;
  const str = String(s);
  while (i < str.length) {
    const c = str[i];
    if (c === '"' || c === "'") {
      const end = awkSkipQuotedString(str, i);
      cur += str.slice(i, end);
      i = end;
      continue;
    }
    if (c === '(') {
      depth++;
      cur += c;
      i++;
      continue;
    }
    if (c === ')') {
      depth--;
      cur += c;
      i++;
      continue;
    }
    if (c === ',' && depth === 0) {
      parts.push(cur.trim());
      cur = '';
      i++;
      continue;
    }
    cur += c;
    i++;
  }
  parts.push(cur.trim());
  return parts;
}

/**
 * Split comma-separated print arguments respecting quotes and parentheses.
 * @param {string} s
 * @returns {{ ok: true, parts: string[] } | { ok: false, stderr: string }}
 */
function awkSplitPrintArgs(s) {
  const parts = awkSplitCommaListTopLevel(String(s))
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return { ok: true, parts };
}

/**
 * Parse inner of `{ ... }` as `print EXPR,...` (jsh subset).
 * @param {string} body
 * @returns {{ ok: true, exprs: string[] } | { ok: false, stderr: string }}
 */
function parseAwkPrintBlockBody(body) {
  const trimmed = String(body).trim();
  const m = /^\s*print\s*(.*)\s*$/s.exec(trimmed);
  if (!m) {
    return { ok: false, stderr: 'awk: jsh only supports {print ...} blocks\n' };
  }
  const inner = m[1].trim();
  if (inner === '') {
    return { ok: true, exprs: ['$0'] };
  }
  const sp = awkSplitPrintArgs(inner);
  if (!sp.ok) {
    return sp;
  }
  if (sp.parts.length === 0) {
    return { ok: true, exprs: ['$0'] };
  }
  return { ok: true, exprs: sp.parts };
}

/**
 * Extract `{ ... }` starting at the first character of `s` (must be `{`).
 * Respects single/double-quoted strings and `\\` escapes inside quotes.
 * @param {string} s
 * @returns {{ inner: string, rest: string } | null}
 */
function extractAwkBraceBlock(s) {
  const t = String(s).trimStart();
  if (t[0] !== '{') {
    return null;
  }
  let depth = 1;
  let i = 1;
  let inQuote = '';
  while (i < t.length && depth > 0) {
    const c = t[i];
    if (inQuote) {
      if (c === inQuote) {
        inQuote = '';
      } else if (c === '\\' && i + 1 < t.length) {
        i++;
      }
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      inQuote = c;
      i++;
      continue;
    }
    if (c === '{') {
      depth++;
    } else if (c === '}') {
      depth--;
    }
    i++;
  }
  if (depth !== 0) {
    return null;
  }
  const inner = t.slice(1, i - 1);
  return { inner: inner.trim(), rest: t.slice(i) };
}

/**
 * Parse optional BEGIN / main / END `{print ...}` blocks (jsh subset).
 * @param {string} program
 * @returns {{ ok: true, beginExprs: string[] | null, mainExprs: string[] | null, endExprs: string[] | null } | { ok: false, stderr: string }}
 */
function parseAwkFullProgram(program) {
  let s = String(program).trim();
  let beginExprs = null;
  let mainExprs = null;
  let endExprs = null;

  if (s.startsWith('BEGIN')) {
    s = s.slice(5).trimStart();
    const br = extractAwkBraceBlock(s);
    if (!br) {
      return { ok: false, stderr: 'awk: missing { after BEGIN\n' };
    }
    const pb = parseAwkPrintBlockBody(br.inner);
    if (!pb.ok) {
      return pb;
    }
    beginExprs = pb.exprs;
    s = br.rest.trimStart();
  }

  if (s.startsWith('{')) {
    const br = extractAwkBraceBlock(s);
    if (!br) {
      return { ok: false, stderr: 'awk: unmatched {\n' };
    }
    const pb = parseAwkPrintBlockBody(br.inner);
    if (!pb.ok) {
      return pb;
    }
    mainExprs = pb.exprs;
    s = br.rest.trimStart();
  }

  if (s.startsWith('END')) {
    s = s.slice(3).trimStart();
    const br = extractAwkBraceBlock(s);
    if (!br) {
      return { ok: false, stderr: 'awk: missing { after END\n' };
    }
    const pb = parseAwkPrintBlockBody(br.inner);
    if (!pb.ok) {
      return pb;
    }
    endExprs = pb.exprs;
    s = br.rest.trimStart();
  }

  if (s.length > 0) {
    return { ok: false, stderr: 'awk: jsh: unexpected trailing program text\n' };
  }

  if (beginExprs === null && mainExprs === null && endExprs === null) {
    return {
      ok: false,
      stderr: 'awk: jsh only supports BEGIN ... {print ...} END ...\n'
    };
  }

  return { ok: true, beginExprs, mainExprs, endExprs };
}

/**
 * Parse `{print ...}` body (jsh subset).
 * @param {string} program
 * @returns {{ ok: true, exprs: string[] } | { ok: false, stderr: string }}
 */
function parseAwkPrintProgram(program) {
  const fp = parseAwkFullProgram(program);
  if (!fp.ok) {
    return fp;
  }
  if (fp.beginExprs !== null || fp.endExprs !== null) {
    return {
      ok: false,
      stderr: 'awk: jsh only supports a single {print ...} program\n'
    };
  }
  if (fp.mainExprs === null) {
    return {
      ok: false,
      stderr: 'awk: jsh only supports a single {print ...} program\n'
    };
  }
  return { ok: true, exprs: fp.mainExprs };
}

/**
 * Advance past a single- or double-quoted awk string starting at `i` (index of opening quote).
 * @param {string} s
 * @param {number} i
 * @returns {number} index just after closing quote or **s.length** if unterminated
 */
function awkSkipQuotedString(s, i) {
  const q = s[i];
  if (q !== '"' && q !== "'") {
    return i;
  }
  let j = i + 1;
  while (j < s.length) {
    if (s[j] === '\\' && j + 1 < s.length) {
      j += 2;
      continue;
    }
    if (s[j] === q) {
      return j + 1;
    }
    j++;
  }
  return s.length;
}

/**
 * Index of the `)` matching the `(` at **openIdx**, respecting quotes.
 * @param {string} s
 * @param {number} openIdx
 * @returns {number} closing index, or **-1**
 */
function awkFindMatchingParen(s, openIdx) {
  let depth = 1;
  let j = openIdx + 1;
  while (j < s.length && depth > 0) {
    const c = s[j];
    if (c === '"' || c === "'") {
      j = awkSkipQuotedString(s, j);
      continue;
    }
    if (c === '(') {
      depth++;
    } else if (c === ')') {
      depth--;
    }
    j++;
  }
  if (depth !== 0) {
    return -1;
  }
  return j - 1;
}

/**
 * Index of the `]` matching the `[` at **openIdx**, respecting quotes.
 * @param {string} s
 * @param {number} openIdx
 * @returns {number} closing index, or **-1**
 */
function awkFindMatchingBracket(s, openIdx) {
  if (s[openIdx] !== '[') {
    return -1;
  }
  let depth = 1;
  let j = openIdx + 1;
  while (j < s.length && depth > 0) {
    const c = s[j];
    if (c === '"' || c === "'") {
      j = awkSkipQuotedString(s, j);
      continue;
    }
    if (c === '[') {
      depth++;
    } else if (c === ']') {
      depth--;
    }
    j++;
  }
  if (depth !== 0) {
    return -1;
  }
  return j - 1;
}

/**
 * Parse **name[EXPR]** as a whole expression (balanced **]**); **EXPR** is evaluated for the key.
 * @param {string} expr
 * @returns {{ name: string, inner: string } | null}
 */
function awkParseArrayAccess(expr) {
  const t = expr.trim();
  const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*\[/.exec(t);
  if (!m) {
    return null;
  }
  const name = m[1];
  const openIdx = m.index + m[0].length - 1;
  if (t[openIdx] !== '[') {
    return null;
  }
  const closeIdx = awkFindMatchingBracket(t, openIdx);
  if (closeIdx < 0 || closeIdx !== t.length - 1) {
    return null;
  }
  const inner = t.slice(openIdx + 1, closeIdx).trim();
  return { name, inner };
}

/**
 * Parse **length**, **length()**, or **length(EXPR)** at the start of an expression.
 * @param {string} expr
 * @returns {{ ok: true, inner: string | null } | { ok: false }}
 */
function awkParseLengthCall(expr) {
  const t = expr.trim();
  if (t === 'length') {
    return { ok: true, inner: null };
  }
  if (!t.startsWith('length')) {
    return { ok: false };
  }
  let i = 6;
  while (i < t.length && /\s/.test(t[i])) {
    i++;
  }
  if (i >= t.length || t[i] !== '(') {
    return { ok: false };
  }
  const closeIdx = awkFindMatchingParen(t, i);
  if (closeIdx < 0) {
    return { ok: false };
  }
  const inner = t.slice(i + 1, closeIdx).trim();
  const rest = t.slice(closeIdx + 1).trim();
  if (rest !== '') {
    return { ok: false };
  }
  return { ok: true, inner: inner === '' ? null : inner };
}

/**
 * Split **inner** of a function call at top-level commas (same rules as **`print`** lists).
 * @param {string} s
 * @returns {string[]}
 */
function awkSplitTopLevelCommas(s) {
  return awkSplitCommaListTopLevel(s);
}

/**
 * Parse **name(...)** at the start of **expr** (whole expression only).
 * @param {string} expr
 * @param {string} name
 * @returns {string | null} inner between parentheses
 */
function awkParseNamedCall(expr, name) {
  const t = expr.trim();
  if (!t.startsWith(name)) {
    return null;
  }
  let i = name.length;
  if (i < t.length && !/\s/.test(t[i]) && t[i] !== '(') {
    return null;
  }
  while (i < t.length && /\s/.test(t[i])) {
    i++;
  }
  if (i >= t.length || t[i] !== '(') {
    return null;
  }
  const closeIdx = awkFindMatchingParen(t, i);
  if (closeIdx < 0) {
    return null;
  }
  const inner = t.slice(i + 1, closeIdx).trim();
  const rest = t.slice(closeIdx + 1).trim();
  if (rest !== '') {
    return null;
  }
  return inner;
}

/**
 * @param {string} inner — comma-separated args
 * @param {{ $0: string, fields: string[], NR: number, NF: number }} ctx
 * @returns {string | null}
 */
function awkEvalSubstrExpr(inner, ctx) {
  const parts = awkSplitTopLevelCommas(inner);
  if (parts.length !== 2 && parts.length !== 3) {
    return null;
  }
  const strV = awkEvalPrintExpr(parts[0], ctx);
  if (strV === null) {
    return null;
  }
  const startV = awkEvalPrintExpr(parts[1], ctx);
  if (startV === null) {
    return null;
  }
  const s = String(strV);
  let start = Number(startV);
  if (!Number.isFinite(start)) {
    start = 0;
  }
  start = Math.floor(start);
  if (start < 1) {
    start = 1;
  }
  if (start > s.length) {
    return '';
  }
  const i0 = start - 1;
  if (parts.length === 2) {
    return s.slice(i0);
  }
  const lenV = awkEvalPrintExpr(parts[2], ctx);
  if (lenV === null) {
    return null;
  }
  let len = Number(lenV);
  if (!Number.isFinite(len)) {
    len = 0;
  }
  len = Math.floor(len);
  if (len < 0) {
    len = 0;
  }
  return s.slice(i0, i0 + len);
}

/**
 * @param {string} inner — comma-separated args (**S**, **T**)
 * @param {{ $0: string, fields: string[], NR: number, NF: number }} ctx
 * @returns {string | null}
 */
function awkEvalIndexExpr(inner, ctx) {
  const parts = awkSplitTopLevelCommas(inner);
  if (parts.length !== 2) {
    return null;
  }
  const a = awkEvalPrintExpr(parts[0], ctx);
  if (a === null) {
    return null;
  }
  const b = awkEvalPrintExpr(parts[1], ctx);
  if (b === null) {
    return null;
  }
  const s = String(a);
  const t = String(b);
  if (t === '') {
    return '1';
  }
  const idx = s.indexOf(t);
  if (idx < 0) {
    return '0';
  }
  return String(idx + 1);
}

/**
 * **split(STRING, ARRAY [, SEP])** — GNU-like: fills **ARRAY[1]**… with fields; returns field count as string.
 * **SEP** omitted uses current **-F** field separator (whitespace when **FS** is space).
 * @param {string} inner — comma-separated args
 * @param {{ $0: string, fields: string[], NR: number, NF: number, fieldSeparator?: string, awkArrays?: Record<string, Record<string, string>> }} ctx
 * @returns {string | null}
 */
function awkEvalSplitExpr(inner, ctx) {
  const parts = awkSplitTopLevelCommas(inner);
  if (parts.length < 2 || parts.length > 3) {
    return null;
  }
  const strV = awkEvalPrintExpr(parts[0], ctx);
  if (strV === null) {
    return null;
  }
  const arrTok = parts[1].trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(arrTok)) {
    return null;
  }
  let fs = ctx.fieldSeparator !== undefined ? ctx.fieldSeparator : ' ';
  if (parts.length === 3) {
    const sepV = awkEvalPrintExpr(parts[2], ctx);
    if (sepV === null) {
      return null;
    }
    fs = String(sepV);
  }
  if (!ctx.awkArrays) {
    ctx.awkArrays = Object.create(null);
  }
  let store = ctx.awkArrays[arrTok];
  if (!store) {
    store = Object.create(null);
    ctx.awkArrays[arrTok] = store;
  } else {
    for (const k of Object.keys(store)) {
      delete store[k];
    }
  }
  const fields = awkSplitFields(String(strV), fs === ' ' ? ' ' : fs);
  for (let i = 0; i < fields.length; i++) {
    store[String(i + 1)] = fields[i];
  }
  return String(fields.length);
}

/**
 * Rebuild **$0** from **fields** using the same separator as **-F** (GNU **OFS**-like for jsh).
 * @param {string[]} fields
 * @param {string} ofs
 * @returns {string}
 */
function awkRebuild0FromFields(fields, ofs) {
  if (ofs === ' ') {
    return fields.join(' ');
  }
  return fields.join(ofs);
}

/**
 * If pat starts with a slash and has a closing delimiter (use backslash-slash for a literal slash in the ERE),
 * compile as a JavaScript RegExp with optional trailing flags; otherwise treat as a literal substring.
 * @param {string} pat
 * @returns {{ kind: 'literal' } | { kind: 'regex', re: RegExp } | { kind: 'bad' }}
 */
function awkParseSlashDelimitedRegex(pat) {
  const p = String(pat);
  if (p.length < 2 || p[0] !== '/') {
    return { kind: 'literal' };
  }
  let i = 1;
  let src = '';
  while (i < p.length) {
    const c = p[i];
    if (c === '\\' && i + 1 < p.length) {
      const n = p[i + 1];
      if (n === '/') {
        src += '/';
        i += 2;
      } else {
        src += '\\' + n;
        i += 2;
      }
      continue;
    }
    if (c === '/') {
      const flags = p.slice(i + 1);
      try {
        const re = new RegExp(src, flags);
        return { kind: 'regex', re };
      } catch {
        return { kind: 'bad' };
      }
    }
    src += c;
    i++;
  }
  return { kind: 'literal' };
}

/**
 * gsub/sub replacement for regex mode: `&` → full match, `\\1`–`\\9` → groups,
 * `\\&` and `\\\\` escapes (GNU-like subset).
 * @param {string} repl
 * @param {any[]} matchArgs — replace callback args: match, groups…, offset, whole
 * @returns {string}
 */
function awkExpandRegexReplacement(repl, matchArgs) {
  const mat = matchArgs.slice(0, matchArgs.length - 2);
  const r = String(repl);
  let out = '';
  for (let j = 0; j < r.length; j++) {
    if (r[j] === '&') {
      out += mat[0];
    } else if (r[j] === '\\' && j + 1 < r.length) {
      const c = r[j + 1];
      if (c >= '1' && c <= '9') {
        const g = mat[parseInt(c, 10)];
        out += g !== undefined ? String(g) : '';
        j++;
      } else if (c === '&') {
        out += '&';
        j++;
      } else if (c === '\\') {
        out += '\\';
        j++;
      } else {
        out += c;
        j++;
      }
    } else {
      out += r[j];
    }
  }
  return out;
}

/**
 * @param {string} s
 * @param {RegExp} re
 * @param {string} repl
 * @returns {{ count: number, result: string }}
 */
function awkRegexGsubAll(s, re, repl) {
  const rg = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  let count = 0;
  const result = String(s).replace(rg, (...args) => {
    count++;
    return awkExpandRegexReplacement(repl, args);
  });
  return { count, result };
}

/**
 * @param {string} s
 * @param {RegExp} re
 * @param {string} repl
 * @returns {{ count: number, result: string }}
 */
function awkRegexSubFirst(s, re, repl) {
  const r1 = new RegExp(re.source, re.flags.replace(/g/g, ''));
  const st = String(s);
  const m = r1.exec(st);
  if (!m) {
    return { count: 0, result: st };
  }
  const args = [...m, m.index, st];
  const expanded = awkExpandRegexReplacement(repl, args);
  const result = st.slice(0, m.index) + expanded + st.slice(m.index + m[0].length);
  return { count: 1, result };
}

/**
 * Global literal substring replace. Empty **PAT**: GNU **gsub** — insert **repl** before each
 * character and after the last (**count** = **s.length + 1**).
 * @param {string} s
 * @param {string} pat
 * @param {string} repl
 * @returns {{ count: number, result: string }}
 */
function awkLiteralGsubAll(s, pat, repl) {
  const str = String(s);
  const p = String(pat);
  const r = String(repl);
  if (p === '') {
    const count = str.length + 1;
    let out = '';
    for (let i = 0; i < str.length; i++) {
      out += r + str[i];
    }
    out += r;
    return { count, result: out };
  }
  let count = 0;
  let out = '';
  let i = 0;
  while (i < str.length) {
    const j = str.indexOf(p, i);
    if (j < 0) {
      out += str.slice(i);
      break;
    }
    count++;
    out += str.slice(i, j) + repl;
    i = j + p.length;
  }
  return { count, result: out };
}

/**
 * First literal substring replace only. Empty **PAT**: GNU **sub** — one insertion before the first
 * character (**repl** + **s**).
 * @param {string} s
 * @param {string} pat
 * @param {string} repl
 * @returns {{ count: number, result: string }}
 */
function awkLiteralSubFirst(s, pat, repl) {
  const str = String(s);
  const p = String(pat);
  if (p === '') {
    return { count: 1, result: String(repl) + str };
  }
  const j = str.indexOf(p);
  if (j < 0) {
    return { count: 0, result: str };
  }
  return { count: 1, result: str.slice(0, j) + repl + str.slice(j + p.length) };
}

/**
 * gsub and sub: literal pattern and replacement; optional third arg is $0…$N (default $0).
 * Mutates **ctx** (and returns substitution count as a string).
 * @param {string} inner
 * @param {{ $0: string, fields: string[], NR: number, NF: number, fieldSeparator?: string }} ctx
 * @param {boolean} global
 * @returns {string | null}
 */
function awkEvalGsubExpr(inner, ctx, global) {
  const parts = awkSplitTopLevelCommas(inner);
  if (parts.length !== 2 && parts.length !== 3) {
    return null;
  }
  const patV = awkEvalPrintExpr(parts[0], ctx);
  const replV = awkEvalPrintExpr(parts[1], ctx);
  if (patV === null || replV === null) {
    return null;
  }
  const pat = String(patV);
  const repl = String(replV);
  const mode = awkParseSlashDelimitedRegex(pat);
  if (mode.kind === 'bad') {
    return null;
  }
  let targetN = 0;
  if (parts.length === 3) {
    const t3 = parts[2].trim();
    const m = /^\$(\d+)$/.exec(t3);
    if (!m) {
      return null;
    }
    targetN = parseInt(m[1], 10);
  }
  const fs = ctx.fieldSeparator === undefined ? ' ' : ctx.fieldSeparator;
  const apply = (fieldStr) => {
    if (mode.kind === 'regex') {
      return global
        ? awkRegexGsubAll(fieldStr, mode.re, repl)
        : awkRegexSubFirst(fieldStr, mode.re, repl);
    }
    const replacer = global ? awkLiteralGsubAll : awkLiteralSubFirst;
    return replacer(fieldStr, pat, repl);
  };
  if (targetN === 0) {
    const r = apply(ctx.$0);
    ctx.$0 = r.result;
    ctx.fields = awkSplitFields(ctx.$0, fs);
    ctx.NF = ctx.fields.length;
    return String(r.count);
  }
  const idx = targetN - 1;
  if (idx < 0) {
    return null;
  }
  while (ctx.fields.length <= idx) {
    ctx.fields.push('');
  }
  const fieldStr = ctx.fields[idx] !== undefined ? String(ctx.fields[idx]) : '';
  const r = apply(fieldStr);
  ctx.fields[idx] = r.result;
  ctx.$0 = awkRebuild0FromFields(ctx.fields, fs);
  ctx.NF = ctx.fields.length;
  return String(r.count);
}

/**
 * match(S, P [, ARRAY]): literal substring P in S, or slash-delimited ERE with optional flags (JavaScript RegExp);
 * sets RSTART and RLENGTH (GNU-like); optional third arg clears and fills **ctx.awkArrays[ARRAY]**.
 * @param {string} inner
 * @param {{ $0: string, fields: string[], NR: number, NF: number, RSTART?: number, RLENGTH?: number, awkArrays?: Record<string, Record<string, string>> }} ctx
 * @returns {string | null}
 */
function awkEvalMatchExpr(inner, ctx) {
  const parts = awkSplitTopLevelCommas(inner);
  if (parts.length !== 2 && parts.length !== 3) {
    return null;
  }
  let arrayName = null;
  if (parts.length === 3) {
    const t = parts[2].trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(t)) {
      return null;
    }
    arrayName = t;
  }
  const a = awkEvalPrintExpr(parts[0], ctx);
  const b = awkEvalPrintExpr(parts[1], ctx);
  if (a === null || b === null) {
    return null;
  }
  const s = String(a);
  const p = String(b);
  const applyArray = (/** @type {RegExpExecArray | null} */ execResult, literalSlice) => {
    if (!arrayName) {
      return;
    }
    if (!ctx.awkArrays) {
      ctx.awkArrays = Object.create(null);
    }
    const store = Object.create(null);
    ctx.awkArrays[arrayName] = store;
    if (execResult) {
      for (let i = 0; i < execResult.length; i++) {
        if (execResult[i] !== undefined) {
          store[String(i)] = String(execResult[i]);
        }
      }
      return;
    }
    if (literalSlice !== null && literalSlice !== undefined) {
      store['0'] = String(literalSlice);
    }
  };
  if (p === '') {
    ctx.RSTART = 0;
    ctx.RLENGTH = -1;
    applyArray(null, null);
    return '0';
  }
  const mode = awkParseSlashDelimitedRegex(p);
  if (mode.kind === 'bad') {
    return null;
  }
  if (mode.kind === 'regex') {
    const re = new RegExp(mode.re.source, mode.re.flags.replace(/g/g, ''));
    const m = re.exec(s);
    if (!m) {
      ctx.RSTART = 0;
      ctx.RLENGTH = -1;
      applyArray(null, null);
      return '0';
    }
    ctx.RSTART = m.index + 1;
    ctx.RLENGTH = m[0].length;
    applyArray(m, null);
    return String(m.index + 1);
  }
  const idx = s.indexOf(p);
  if (idx < 0) {
    ctx.RSTART = 0;
    ctx.RLENGTH = -1;
    applyArray(null, null);
    return '0';
  }
  ctx.RSTART = idx + 1;
  ctx.RLENGTH = p.length;
  applyArray(null, s.slice(idx, idx + p.length));
  return String(idx + 1);
}

/**
 * Coerce a string to a number (GNU awk–like for jsh: **parseFloat** leading portion, **''** → **0**).
 * @param {string} s
 * @returns {number}
 */
function awkStrToNum(s) {
  const t = String(s).trim();
  if (t === '') {
    return 0;
  }
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Format an arithmetic result for **print** output (integers without trailing **.0** when exact).
 * @param {number} n
 * @returns {string}
 */
function awkFormatArithResult(n) {
  if (Number.isNaN(n)) {
    return 'nan';
  }
  if (n === Infinity) {
    return 'inf';
  }
  if (n === -Infinity) {
    return '-inf';
  }
  if (Math.abs(n) < 1e15 && Math.abs(n - Math.round(n)) < 1e-9) {
    return String(Math.round(n));
  }
  return String(n);
}

/**
 * Recursive-descent parser for +, -, *, /, %, ^ (right-assoc), unary -, parentheses,
 * and awk primaries inside print expressions (jsh subset).
 */
class AwkArithParser {
  /**
   * @param {string} str
   * @param {{ $0: string, fields: string[], NR: number, NF: number }} ctx
   */
  constructor(str, ctx) {
    this.s = str;
    this.i = 0;
    this.ctx = ctx;
  }

  skipSpaces() {
    while (this.i < this.s.length && /\s/.test(this.s[this.i])) {
      this.i++;
    }
  }

  peek() {
    return this.i < this.s.length ? this.s[this.i] : '';
  }

  parseAddSub() {
    let left = this.parseMulDiv();
    if (left === null) {
      return null;
    }
    for (;;) {
      this.skipSpaces();
      const c = this.peek();
      if (c === '+') {
        this.i++;
        const right = this.parseMulDiv();
        if (right === null) {
          return null;
        }
        left += right;
      } else if (c === '-') {
        this.i++;
        const right = this.parseMulDiv();
        if (right === null) {
          return null;
        }
        left -= right;
      } else {
        break;
      }
    }
    return left;
  }

  parseMulDiv() {
    let left = this.parseUnaryExpr();
    if (left === null) {
      return null;
    }
    for (;;) {
      this.skipSpaces();
      const op = this.peek();
      if (op === '*') {
        this.i++;
        const right = this.parseUnaryExpr();
        if (right === null) {
          return null;
        }
        left *= right;
      } else if (op === '/') {
        this.i++;
        const right = this.parseUnaryExpr();
        if (right === null) {
          return null;
        }
        left /= right;
      } else if (op === '%') {
        this.i++;
        const right = this.parseUnaryExpr();
        if (right === null) {
          return null;
        }
        if (right === 0) {
          return null;
        }
        left %= right;
      } else {
        break;
      }
    }
    return left;
  }

  /**
   * Unary plus/minus binds looser than caret (GNU awk: -2^2 is -(2^2)).
   * Non-unary path parses exponentiation / postfix.
   */
  parseUnaryExpr() {
    this.skipSpaces();
    if (this.peek() === '+') {
      this.i++;
      return this.parseUnaryExpr();
    }
    if (this.peek() === '-') {
      this.i++;
      const u = this.parseUnaryExpr();
      return u === null ? null : -u;
    }
    return this.parsePowExpr();
  }

  /** **^** is right-associative; exponent may start with unary (**2^-2**). */
  parsePowExpr() {
    let left = this.parsePrimary();
    if (left === null) {
      return null;
    }
    for (;;) {
      this.skipSpaces();
      if (this.peek() !== '^') {
        break;
      }
      this.i++;
      const right = this.parseUnaryExpr();
      if (right === null) {
        return null;
      }
      left = Math.pow(left, right);
    }
    return left;
  }

  parsePrimary() {
    this.skipSpaces();
    const c = this.peek();
    if (c === '') {
      return null;
    }
    if (c === '(') {
      this.i++;
      const inner = this.parseAddSub();
      if (inner === null) {
        return null;
      }
      this.skipSpaces();
      if (this.peek() !== ')') {
        return null;
      }
      this.i++;
      return inner;
    }
    if (c === '"' || c === "'") {
      const q = c;
      const end = awkSkipQuotedString(this.s, this.i);
      if (end <= this.i + 1 || this.s[end - 1] !== q) {
        return null;
      }
      const inner = this.s.slice(this.i + 1, end - 1);
      this.i = end;
      return awkStrToNum(inner);
    }
    if (c === '$') {
      this.i++;
      this.skipSpaces();
      const m = /^\d+/.exec(this.s.slice(this.i));
      if (!m) {
        return null;
      }
      this.i += m[0].length;
      const n = parseInt(m[0], 10);
      const fv = this.ctx.fields[n - 1];
      return awkStrToNum(fv !== undefined ? fv : '');
    }
    if (
      this.s.slice(this.i, this.i + 2) === 'NR' &&
      (this.i + 2 >= this.s.length || !/[A-Za-z0-9_]/.test(this.s[this.i + 2]))
    ) {
      this.i += 2;
      return awkStrToNum(String(this.ctx.NR));
    }
    if (
      this.s.slice(this.i, this.i + 2) === 'NF' &&
      (this.i + 2 >= this.s.length || !/[A-Za-z0-9_]/.test(this.s[this.i + 2]))
    ) {
      this.i += 2;
      return awkStrToNum(String(this.ctx.NF));
    }
    if (
      this.s.slice(this.i).startsWith('RSTART') &&
      (this.i + 6 >= this.s.length || !/[A-Za-z0-9_]/.test(this.s[this.i + 6]))
    ) {
      this.i += 6;
      return awkStrToNum(String(this.ctx.RSTART !== undefined ? this.ctx.RSTART : 0));
    }
    if (
      this.s.slice(this.i).startsWith('RLENGTH') &&
      (this.i + 7 >= this.s.length || !/[A-Za-z0-9_]/.test(this.s[this.i + 7]))
    ) {
      this.i += 7;
      return awkStrToNum(String(this.ctx.RLENGTH !== undefined ? this.ctx.RLENGTH : -1));
    }
    {
      const rest = this.s.slice(this.i);
      const mArr = /^([A-Za-z_][A-Za-z0-9_]*)\s*\[/.exec(rest);
      if (mArr) {
        const openIdx = this.i + mArr[0].length - 1;
        const closeIdx = awkFindMatchingBracket(this.s, openIdx);
        if (closeIdx >= 0) {
          const full = this.s.slice(this.i, closeIdx + 1);
          const acc = awkParseArrayAccess(full);
          if (acc) {
            const v = awkEvalPrintExpr(full, this.ctx);
            if (v === null) {
              return null;
            }
            this.i = closeIdx + 1;
            return awkStrToNum(v);
          }
        }
      }
    }
    if (this.s.slice(this.i).startsWith('length')) {
      let k = this.i + 6;
      while (k < this.s.length && /\s/.test(this.s[k])) {
        k++;
      }
      if (k >= this.s.length || this.s[k] !== '(') {
        return null;
      }
      const closeIdx = awkFindMatchingParen(this.s, k);
      if (closeIdx < 0) {
        return null;
      }
      const inner = this.s.slice(k + 1, closeIdx).trim();
      this.i = closeIdx + 1;
      if (inner === '') {
        return String(this.ctx.$0).length;
      }
      const v = awkEvalPrintExpr(inner, this.ctx);
      if (v === null) {
        return null;
      }
      return String(v).length;
    }
    const rest = this.s.slice(this.i);
    const numRe = /^(\d+\.?\d*([eE][+-]?\d+)?|\.\d+([eE][+-]?\d+)?)/;
    const nm = numRe.exec(rest);
    if (nm) {
      const n = parseFloat(nm[0]);
      if (!Number.isFinite(n)) {
        return null;
      }
      this.i += nm[0].length;
      return n;
    }
    return null;
  }
}

/**
 * Evaluate a full-string arithmetic expression for awk **print** (returns **null** if invalid).
 * @param {string} expr
 * @param {{ $0: string, fields: string[], NR: number, NF: number }} ctx
 * @returns {number | null}
 */
function awkEvalArithmeticExpr(expr, ctx) {
  const p = new AwkArithParser(expr, ctx);
  const v = p.parseAddSub();
  if (v === null) {
    return null;
  }
  p.skipSpaces();
  if (p.i !== p.s.length) {
    return null;
  }
  return v;
}

/**
 * @param {string} expr
 * @param {{ $0: string, fields: string[], NR: number, NF: number }} ctx
 * @returns {string | null}
 */
function awkEvalPrintExpr(expr, ctx) {
  const e = expr.trim();
  const lc = awkParseLengthCall(e);
  if (lc.ok) {
    if (lc.inner === null) {
      return String(String(ctx.$0).length);
    }
    const v = awkEvalPrintExpr(lc.inner, ctx);
    if (v === null) {
      return null;
    }
    return String(String(v).length);
  }
  const subInner = awkParseNamedCall(e, 'substr');
  if (subInner !== null) {
    return awkEvalSubstrExpr(subInner, ctx);
  }
  const idxInner = awkParseNamedCall(e, 'index');
  if (idxInner !== null) {
    return awkEvalIndexExpr(idxInner, ctx);
  }
  const gsubInner = awkParseNamedCall(e, 'gsub');
  if (gsubInner !== null) {
    return awkEvalGsubExpr(gsubInner, ctx, true);
  }
  const subOnlyInner = awkParseNamedCall(e, 'sub');
  if (subOnlyInner !== null) {
    return awkEvalGsubExpr(subOnlyInner, ctx, false);
  }
  const matchInner = awkParseNamedCall(e, 'match');
  if (matchInner !== null) {
    return awkEvalMatchExpr(matchInner, ctx);
  }
  const splitInner = awkParseNamedCall(e, 'split');
  if (splitInner !== null) {
    return awkEvalSplitExpr(splitInner, ctx);
  }
  const arrAcc = awkParseArrayAccess(e);
  if (arrAcc) {
    const keyV = awkEvalPrintExpr(arrAcc.inner, ctx);
    if (keyV === null) {
      return null;
    }
    const store = ctx.awkArrays && ctx.awkArrays[arrAcc.name];
    if (!store) {
      return '';
    }
    const k = String(keyV);
    const v = store[k];
    return v !== undefined ? String(v) : '';
  }
  if (e === '$0') {
    return ctx.$0;
  }
  if (e === 'NR') {
    return String(ctx.NR);
  }
  if (e === 'NF') {
    return String(ctx.NF);
  }
  if (e === 'RSTART') {
    return String(ctx.RSTART !== undefined ? ctx.RSTART : 0);
  }
  if (e === 'RLENGTH') {
    return String(ctx.RLENGTH !== undefined ? ctx.RLENGTH : -1);
  }
  const m = /^\$(\d+)$/.exec(e);
  if (m) {
    const n = parseInt(m[1], 10);
    const v = ctx.fields[n - 1];
    return v !== undefined ? v : '';
  }
  if (e.length >= 2) {
    const q = e[0];
    if ((q === '"' || q === "'") && e[e.length - 1] === q) {
      return e.slice(1, -1);
    }
  }
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(e)) {
    return e;
  }
  const ar = awkEvalArithmeticExpr(e, ctx);
  if (ar !== null) {
    return awkFormatArithResult(ar);
  }
  return null;
}

/**
 * Split input into awk records (lines). Trailing newline does not add an extra empty record.
 * @param {string} text
 * @returns {string[]}
 */
function awkSplitRecordLines(text) {
  const raw = String(text);
  if (raw === '') {
    return [];
  }
  const lines = raw.split('\n');
  if (lines.length && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

/**
 * Awk BEGIN context (NR, NF, $0 before any input).
 * @param {string} [fieldSeparator]
 * @param {Record<string, Record<string, string>>} [awkArrays] — shared **match(…, …, arr)** store across BEGIN / records / END
 * @returns {{ $0: string, fields: string[], NR: number, NF: number, fieldSeparator: string, RSTART: number, RLENGTH: number, awkArrays: Record<string, Record<string, string>> }}
 */
function awkBeginCtx(fieldSeparator, awkArrays) {
  const fs = fieldSeparator === undefined ? ' ' : fieldSeparator;
  return {
    $0: '',
    fields: [],
    NR: 0,
    NF: 0,
    fieldSeparator: fs,
    RSTART: 0,
    RLENGTH: -1,
    awkArrays: awkArrays === undefined ? Object.create(null) : awkArrays
  };
}

/**
 * Evaluate one `print` (single output line with trailing newline).
 * @param {string[]} exprs
 * @param {{ $0: string, fields: string[], NR: number, NF: number }} ctx
 * @returns {{ ok: true, stdout: string } | { ok: false, stderr: string }}
 */
function awkRunPrintOnce(exprs, ctx) {
  const parts = [];
  for (const ex of exprs) {
    const v = awkEvalPrintExpr(ex, ctx);
    if (v === null) {
      return {
        ok: false,
        stderr: `awk: invalid print expression: ${ex.trim()}\n`
      };
    }
    parts.push(v);
  }
  return { ok: true, stdout: parts.join(' ') + '\n' };
}

/**
 * Run main-rule `print` on each line, or scan lines only when **exprs** is **null** (for **NR**).
 * @param {string} text
 * @param {string[] | null} exprs
 * @param {string} fieldSeparator
 * @param {number} nrStart — starting NR (1-based)
 * @param {Record<string, Record<string, string>>} [awkArraysStore] — shared across lines for **match(…, …, arr)** and **arr[i]** reads
 * @returns {{ ok: true, stdout: string, nextNr: number, lastReadCtx: { $0: string, fields: string[], NR: number, NF: number } | null } | { ok: false, stderr: string }}
 */
function awkRunPrintProgram(text, exprs, fieldSeparator, nrStart, awkArraysStore) {
  const raw = String(text);
  const lines = awkSplitRecordLines(raw);
  const hadTrailingNl = raw.length > 0 && raw.endsWith('\n');
  const out = [];
  let nr = nrStart;
  let lastReadCtx = null;
  const arrStore = awkArraysStore === undefined ? Object.create(null) : awkArraysStore;
  for (const line of lines) {
    const fields = awkSplitFields(line, fieldSeparator);
    const ctx = {
      $0: line,
      fields,
      NR: nr,
      NF: fields.length,
      fieldSeparator,
      RSTART: 0,
      RLENGTH: -1,
      awkArrays: arrStore
    };
    lastReadCtx = ctx;
    if (exprs !== null && exprs !== undefined) {
      const parts = [];
      for (const ex of exprs) {
        const v = awkEvalPrintExpr(ex, ctx);
        if (v === null) {
          return {
            ok: false,
            stderr: `awk: invalid print expression: ${ex.trim()}\n`
          };
        }
        parts.push(v);
      }
      out.push(parts.join(' '));
    }
    nr++;
  }
  let stdout = out.join('\n');
  if (out.length > 0 && (hadTrailingNl || lines.length === 0)) {
    stdout += '\n';
  }
  return { ok: true, stdout, nextNr: nr, lastReadCtx };
}

const CP_HELP = `Usage: cp [OPTION]... SOURCE DEST
Copy SOURCE to DEST.

  -r, -R, --recursive    copy directories recursively
  -h, --help             display this help and exit

jsh:
  Two operands only (no DIRECTORY multi-source form). Use -- before paths
  that start with '-'.

Full documentation: <https://www.gnu.org/software/coreutils/manual/html_node/cp-invocation.html>
`;

const MV_HELP = `Usage: mv [OPTION]... SOURCE DEST
Rename SOURCE to DEST, or move SOURCE to DEST.

  -f, --force            ignored (jsh does not overwrite existing DEST)
  -i, --interactive      ignored
  -n, --no-clobber       ignored
  -v, --verbose          ignored
  -h, --help             display this help and exit

jsh:
  Two operands only. Use -- before paths that start with '-'.

Full documentation: <https://www.gnu.org/software/coreutils/manual/html_node/mv-invocation.html>
`;

/**
 * GNU-style option error for cp.
 * @param {string} arg
 * @returns {string}
 */
function cpOptionError(arg) {
  const tryLine = "Try 'cp --help' for more information.\n";
  if (arg.startsWith('--') && arg.length > 2) {
    return `cp: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `cp: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `cp: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * GNU-style option error for mv.
 * @param {string} arg
 * @returns {string}
 */
function mvOptionError(arg) {
  const tryLine = "Try 'mv --help' for more information.\n";
  if (arg.startsWith('--') && arg.length > 2) {
    return `mv: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `mv: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `mv: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * Parse jsh `cp` argv: -r/-R/--recursive, -h/--help, --, operands (two-operand handler).
 *
 * @param {string[]} args
 * @returns {{ ok: true, recursive: boolean, operands: string[], help?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseCpArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  let recursive = false;
  const operands = [];
  let i = 0;
  while (i < argsArr.length) {
    const arg = argsArr[i];
    if (arg === '--help' || arg === '-h') {
      return { ok: true, help: true, recursive, operands: [] };
    }
    if (arg === '--') {
      operands.push(...argsArr.slice(i + 1));
      break;
    }
    if (arg === '--recursive') {
      recursive = true;
      i++;
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1 && !arg.startsWith('--')) {
      for (let j = 1; j < arg.length; j++) {
        const c = arg[j];
        if (c === 'r' || c === 'R') {
          recursive = true;
        } else {
          return { ok: false, stderr: cpOptionError(`-${c}`), exitCode: 1 };
        }
      }
      i++;
      continue;
    }
    if (arg.startsWith('--') && arg.length > 2) {
      return { ok: false, stderr: cpOptionError(arg), exitCode: 1 };
    }
    operands.push(arg, ...argsArr.slice(i + 1));
    break;
  }
  return { ok: true, recursive, operands };
}

/**
 * Parse jsh `mv` argv: GNU-ish no-op flags, -h/--help, --, operands (two-operand handler).
 *
 * @param {string[]} args
 * @returns {{ ok: true, operands: string[], help?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseMvArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  const operands = [];
  let i = 0;
  while (i < argsArr.length) {
    const arg = argsArr[i];
    if (arg === '--help' || arg === '-h') {
      return { ok: true, help: true, operands: [] };
    }
    if (arg === '--') {
      operands.push(...argsArr.slice(i + 1));
      break;
    }
    if (
      arg === '--force' ||
      arg === '-f' ||
      arg === '--interactive' ||
      arg === '-i' ||
      arg === '--no-clobber' ||
      arg === '-n' ||
      arg === '--verbose' ||
      arg === '-v'
    ) {
      i++;
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1 && !arg.startsWith('--')) {
      for (let j = 1; j < arg.length; j++) {
        const c = arg[j];
        if (c === 'f' || c === 'i' || c === 'n' || c === 'v') {
          /* GNU no-ops in jsh */
        } else {
          return { ok: false, stderr: mvOptionError(`-${c}`), exitCode: 1 };
        }
      }
      i++;
      continue;
    }
    if (arg.startsWith('--') && arg.length > 2) {
      return { ok: false, stderr: mvOptionError(arg), exitCode: 1 };
    }
    operands.push(arg, ...argsArr.slice(i + 1));
    break;
  }
  return { ok: true, operands };
}

const RM_HELP = `Usage: rm [OPTION]... [FILE]...
Remove (unlink) the FILE(s).

  -f, --force           ignore nonexistent files and arguments, never prompt
  -i, --interactive     prompt before every removal (ignored in jsh)
  -I                    prompt once when removing many files (ignored in jsh)
  -r, -R, --recursive   remove directories and their contents recursively
  -d, --dir             remove empty directories (ignored in jsh; use -r for trees)
  -v, --verbose         explain what is being done (ignored in jsh)
  -h, --help             display this help and exit

jsh:
  No interactive prompts; -i/-I/-v are accepted as no-ops. Use -- before paths
  that start with '-'.

Full documentation: <https://www.gnu.org/software/coreutils/manual/html_node/rm-invocation.html>
`;

/**
 * GNU-style option error for rm.
 * @param {string} arg
 * @returns {string}
 */
function rmOptionError(arg) {
  const tryLine = "Try 'rm --help' for more information.\n";
  if (arg.startsWith('--') && arg.length > 2) {
    return `rm: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `rm: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `rm: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * Parse jsh `rm` argv: -f/-r/-R, GNU no-op flags, -h/--help, --, operands.
 *
 * @param {string[]} args
 * @returns {{ ok: true, recursive: boolean, force: boolean, operands: string[], help?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseRmArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  let recursive = false;
  let force = false;
  const operands = [];
  let i = 0;
  while (i < argsArr.length) {
    const arg = argsArr[i];
    if (arg === '--help' || arg === '-h') {
      return { ok: true, help: true, recursive, force, operands: [] };
    }
    if (arg === '--') {
      operands.push(...argsArr.slice(i + 1));
      break;
    }
    if (arg === '--recursive') {
      recursive = true;
      i++;
      continue;
    }
    if (arg === '--force') {
      force = true;
      i++;
      continue;
    }
    if (arg === '--verbose') {
      i++;
      continue;
    }
    if (arg === '--dir') {
      i++;
      continue;
    }
    if (arg === '--interactive') {
      i++;
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1 && !arg.startsWith('--')) {
      for (let j = 1; j < arg.length; j++) {
        const c = arg[j];
        if (c === 'r' || c === 'R') {
          recursive = true;
        } else if (c === 'f') {
          force = true;
        } else if (c === 'i' || c === 'I' || c === 'v' || c === 'd') {
          /* GNU no-ops in jsh */
        } else {
          return { ok: false, stderr: rmOptionError(`-${c}`), exitCode: 1 };
        }
      }
      i++;
      continue;
    }
    if (arg.startsWith('--') && arg.length > 2) {
      return { ok: false, stderr: rmOptionError(arg), exitCode: 1 };
    }
    operands.push(arg, ...argsArr.slice(i + 1));
    break;
  }
  return { ok: true, recursive, force, operands };
}

const RMDIR_HELP = `Usage: rmdir [OPTION]... DIRECTORY...
Remove the DIRECTORY(ies), if they are empty.

  -p, --parents       remove DIRECTORY, then each non-root parent directory
                      component as long as each is empty
  -v, --verbose       no-op (accepted for GNU compatibility)
  -h, --help          display this help and exit

jsh:
  Operands are resolved like other file commands; symlinks are not dereferenced
  (removing a symlink path is not supported — use rm).

Full documentation: <https://www.gnu.org/software/coreutils/manual/html_node/rmdir-invocation.html>
`;

/**
 * GNU-style option error for rmdir.
 * @param {string} arg
 * @returns {string}
 */
function rmdirOptionError(arg) {
  const tryLine = "Try 'rmdir --help' for more information.\n";
  if (arg.startsWith('--') && arg.length > 2) {
    return `rmdir: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `rmdir: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `rmdir: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * Parse jsh `rmdir` argv: -p/--parents, -v/--verbose (no-op), -h/--help, --, operands.
 *
 * @param {string[]} args
 * @returns {{ ok: true, parents: boolean, operands: string[], help?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseRmdirArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  let parents = false;
  const operands = [];
  let i = 0;
  while (i < argsArr.length) {
    const arg = argsArr[i];
    if (arg === '--help' || arg === '-h') {
      return { ok: true, help: true, parents, operands: [] };
    }
    if (arg === '--') {
      operands.push(...argsArr.slice(i + 1));
      break;
    }
    if (arg === '--parents') {
      parents = true;
      i++;
      continue;
    }
    if (arg === '--verbose') {
      i++;
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1 && !arg.startsWith('--')) {
      for (let j = 1; j < arg.length; j++) {
        const c = arg[j];
        if (c === 'p') {
          parents = true;
        } else if (c === 'v') {
          /* GNU no-op */
        } else {
          return { ok: false, stderr: rmdirOptionError(`-${c}`), exitCode: 1 };
        }
      }
      i++;
      continue;
    }
    if (arg.startsWith('--') && arg.length > 2) {
      return { ok: false, stderr: rmdirOptionError(arg), exitCode: 1 };
    }
    operands.push(arg, ...argsArr.slice(i + 1));
    break;
  }
  return { ok: true, parents, operands };
}

const UNLINK_HELP = `Usage: unlink FILE
Call unlink(2) on FILE: remove one regular file or symlink (same IndexedDB VFS as rm/rmdir).

  -h, --help          display this help and exit

jsh:
  Exactly one FILE operand (GNU-style). Use -- before paths that start with '-'.
  Not implemented vs GNU: --version.

Full documentation: <https://www.gnu.org/software/coreutils/manual/html_node/unlink-invocation.html>
`;

/**
 * GNU-style option error for unlink.
 * @param {string} arg
 * @returns {string}
 */
function unlinkOptionError(arg) {
  const tryLine = "Try 'unlink --help' for more information.\n";
  if (arg.startsWith('--') && arg.length > 2) {
    return `unlink: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `unlink: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `unlink: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * Parse jsh `unlink` argv: -h/--help, --, exactly one FILE operand expected by handler.
 *
 * @param {string[]} args
 * @returns {{ ok: true, operands: string[], help?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseUnlinkArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  const operands = [];
  let i = 0;
  while (i < argsArr.length) {
    const arg = argsArr[i];
    if (arg === '--help' || arg === '-h') {
      return { ok: true, help: true, operands: [] };
    }
    if (arg === '--') {
      operands.push(...argsArr.slice(i + 1));
      break;
    }
    if (arg.startsWith('-') && arg.length > 1 && !arg.startsWith('--')) {
      for (let j = 1; j < arg.length; j++) {
        const c = arg[j];
        if (c === 'h') {
          return { ok: true, help: true, operands: [] };
        }
        return { ok: false, stderr: unlinkOptionError(`-${c}`), exitCode: 1 };
      }
      i++;
      continue;
    }
    if (arg.startsWith('--') && arg.length > 2) {
      return { ok: false, stderr: unlinkOptionError(arg), exitCode: 1 };
    }
    operands.push(arg, ...argsArr.slice(i + 1));
    break;
  }
  return { ok: true, operands };
}

const ENV_HELP = `Usage: env [OPTION]... [-] [NAME=VALUE]...
Print the environment. NAME=VALUE merges into the displayed environment.

  -i, --ignore-environment   start with an empty environment
  -u, --unset=NAME          remove NAME from the inherited environment
      --help                 display this help and exit

jsh:
  Running a command via env is not supported.
`;

/**
 * Parse jsh `env` argv: GNU-like **-i** / **--ignore-environment**, **-u** / **--unset**,
 * **--**, lone **-**, then **NAME=VALUE** operands (no command execution).
 *
 * @param {string[]} args - argv after the command name
 * @returns {{ ok: true, help?: true, ignore: boolean, unset: string[], rest: string[] } | { ok: false, stderr: string, exitCode: number }}
 */
function parseEnvArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  /** @type {string[]} */
  const unset = [];
  let ignore = false;
  let i = 0;
  while (i < argsArr.length) {
    const a = argsArr[i];
    if (a === '--') {
      i++;
      break;
    }
    if (a === '-') {
      i++;
      break;
    }
    if (!a.startsWith('-')) {
      break;
    }
    if (a === '--help') {
      return { ok: true, help: true, ignore: false, unset: [], rest: [] };
    }
    if (a === '--ignore-environment') {
      ignore = true;
      i++;
      continue;
    }
    if (a.startsWith('--unset=')) {
      const name = a.slice('--unset='.length);
      if (name === '') {
        return {
          ok: false,
          stderr: "env: option '--unset' requires an argument\n",
          exitCode: 2
        };
      }
      unset.push(name);
      i++;
      continue;
    }
    if (a === '--unset') {
      if (i + 1 >= argsArr.length) {
        return {
          ok: false,
          stderr: "env: option '--unset' requires an argument\n",
          exitCode: 2
        };
      }
      unset.push(argsArr[i + 1]);
      i += 2;
      continue;
    }
    if (a.startsWith('--')) {
      return {
        ok: false,
        stderr: `env: unrecognized option '${a}'\n`,
        exitCode: 2
      };
    }
    if (a === '-i') {
      ignore = true;
      i++;
      continue;
    }
    if (a.length > 1) {
      let j = 1;
      let consumedUArg = false;
      while (j < a.length) {
        const c = a[j];
        if (c === 'i') {
          ignore = true;
          j++;
          continue;
        }
        if (c === 'u') {
          if (j !== a.length - 1) {
            return {
              ok: false,
              stderr: `env: invalid option -- '${a}'\n`,
              exitCode: 2
            };
          }
          if (i + 1 >= argsArr.length) {
            return {
              ok: false,
              stderr: "env: option requires an argument -- 'u'\n",
              exitCode: 2
            };
          }
          unset.push(argsArr[i + 1]);
          i += 2;
          consumedUArg = true;
          break;
        }
        return {
          ok: false,
          stderr: `env: invalid option -- '${c}'\n`,
          exitCode: 2
        };
      }
      if (!consumedUArg) {
        i++;
      }
      continue;
    }
    return {
      ok: false,
      stderr: `env: invalid option -- '${a}'\n`,
      exitCode: 2
    };
  }
  return { ok: true, ignore, unset, rest: argsArr.slice(i) };
}

function expandVariablesInString(str, env, lastExitCode) {
  if (str == null) {
    return '';
  }
  const s = typeof str === 'string' ? str : String(str);
  const e = env && typeof env === 'object' ? env : {};
  const lc = lastExitCode !== undefined && lastExitCode !== null ? lastExitCode : 0;
  return s
    .replace(/\$\?/g, () => String(lc))
    .replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, varName) => e[varName] ?? '')
    .replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, varName) => e[varName] ?? '');
}

/**
 * Merge a wall-clock timeout with an optional user interrupt (e.g. Terminal.runAbortSignal from Ctrl+C).
 * Same semantics as browser git HTTP: first of timeout or user abort wins.
 *
 * @param {number} timeoutMs
 * @param {AbortSignal|null|undefined} userSignal
 * @returns {AbortSignal}
 */
function combinedFetchSignal(timeoutMs, userSignal) {
  const t = AbortSignal.timeout(timeoutMs);
  if (!userSignal) {
    return t;
  }
  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any([t, userSignal]);
  }
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

/**
 * Bash/readline-style filename completion: omit entries whose names start with `.`
 * unless the typed prefix already starts with `.` (so bare Tab in a directory
 * does not offer dotfiles; typing `.` or `.pro` still completes them).
 *
 * @param {Array<{ name: string }>} entries - directory entries from `readdir` (full list)
 * @param {string} searchPattern - partial filename being completed (may be empty)
 * @returns {Array<{ name: string }>} filtered entries still matching `startsWith(searchPattern)`
 */
function filterDirectoryEntriesForTabCompletion(entries, searchPattern) {
  const pat = searchPattern == null ? '' : String(searchPattern);
  const includeDotfiles = pat.length > 0 && pat.startsWith('.');
  return entries.filter((entry) => {
    const name = entry && entry.name != null ? String(entry.name) : '';
    if (!includeDotfiles && name.startsWith('.')) {
      return false;
    }
    return name.startsWith(pat);
  });
}

/**
 * GNU-like `ls` flags used by jsh: `-l` / `--long`, `-a` / `--all`, combined `-la`.
 *
 * @param {string[]} args - argv after the command name
 * @returns {{ showDetails: boolean, showAll: boolean }}
 */
function parseLsDisplayFlags(args) {
  let showDetails = false;
  let showAll = false;
  if (!args || !args.length) {
    return { showDetails, showAll };
  }
  for (const arg of args) {
    if (arg === '--') {
      break;
    }
    if (arg === '--long') {
      showDetails = true;
      continue;
    }
    if (arg === '--all') {
      showAll = true;
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1 && !arg.startsWith('--')) {
      for (let i = 1; i < arg.length; i++) {
        const c = arg[i];
        if (c === 'l') {
          showDetails = true;
        }
        if (c === 'a') {
          showAll = true;
        }
      }
    }
  }
  return { showDetails, showAll };
}

/**
 * Stable locale sort of directory entries by `name` (for `ls` output).
 *
 * @param {Array<{ name: string }>} entries
 * @returns {Array<{ name: string }>}
 */
function sortDirectoryEntriesByName(entries) {
  return [...entries].sort((a, b) => String(a.name).localeCompare(String(b.name)));
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
 * Parse `mkdir` argv: `-p` / `--parents` and operands (after `--`).
 * @param {string[]} args
 * @returns {{ ok: true, parents: boolean, operands: string[] } | { ok: false, stderr: string }}
 */
function parseMkdirArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  let parents = false;
  const operands = [];
  let i = 0;
  while (i < argsArr.length) {
    const a = argsArr[i];
    if (a === '--') {
      operands.push(...argsArr.slice(i + 1));
      break;
    }
    if (a === '--parents') {
      parents = true;
      i++;
      continue;
    }
    if (a === '-p') {
      parents = true;
      i++;
      continue;
    }
    if (a.startsWith('-') && a.length > 1) {
      if (a.startsWith('--')) {
        return { ok: false, stderr: `mkdir: unrecognized option '${a}'` };
      }
      for (let j = 1; j < a.length; j++) {
        const c = a[j];
        if (c === 'p') {
          parents = true;
        } else {
          return { ok: false, stderr: `mkdir: invalid option -- '${c}'` };
        }
      }
      i++;
      continue;
    }
    operands.push(a);
    i++;
  }
  return { ok: true, parents, operands };
}

const CHMOD_HELP = `Usage: chmod [OPTION]... MODE FILE...
  or:  chmod [OPTION]... OCTAL-MODE FILE...

Change file mode bits (jsh).

jsh does not model Unix permission bits; MODE and options like -R are accepted for
script compatibility but are not applied. Exit status is 0 when the invocation
is well-formed.

Options:
  -R, --recursive   no-op (accepted for compatibility)
  -v, --verbose     no-op
      --help        display this help and exit
  -h                same as --help

Try 'man chmod' on a real system for POSIX/GNU semantics.
`;

/**
 * Parse `chmod` argv (jsh fake: mode not applied).
 * @param {string[]} args
 * @returns {{ ok: true, help: true } | { ok: true, flags: { recursive: boolean, verbose: boolean }, mode: string, files: string[] } | { ok: false, stderr: string }}
 */
function parseChmodArgv(args) {
  const arr = Array.isArray(args) ? args : [];
  const flags = { recursive: false, verbose: false };
  let i = 0;
  while (i < arr.length) {
    const a = arr[i];
    if (a === '--') {
      i++;
      break;
    }
    if (a === '--help') {
      return { ok: true, help: true };
    }
    if (a === '--recursive') {
      flags.recursive = true;
      i++;
      continue;
    }
    if (a === '--verbose') {
      flags.verbose = true;
      i++;
      continue;
    }
    if (a.startsWith('-') && a.length > 1) {
      if (a.startsWith('--')) {
        return { ok: false, stderr: `chmod: unrecognized option '${a}'` };
      }
      for (let j = 1; j < a.length; j++) {
        const c = a[j];
        if (c === 'R') {
          flags.recursive = true;
        } else if (c === 'v') {
          flags.verbose = true;
        } else if (c === 'h') {
          return { ok: true, help: true };
        } else {
          return { ok: false, stderr: `chmod: invalid option -- '${c}'` };
        }
      }
      i++;
      continue;
    }
    break;
  }
  const rest = arr.slice(i);
  if (rest.length < 2) {
    if (rest.length === 0) {
      return { ok: false, stderr: 'chmod: missing operand' };
    }
    return { ok: false, stderr: `chmod: missing operand after '${rest[0]}'` };
  }
  const mode = rest[0];
  const files = rest.slice(1);
  return { ok: true, flags, mode, files };
}

const STAT_HELP = `Usage: stat [OPTION]... FILE...
Display file status (GNU-like summary; jsh VFS).

Options:
  -L, --dereference   follow symlinks and stat the target
  -h, --help          display this help and exit

jsh:
  Default output is a short multi-line block (not full GNU \`stat -c\` formats).
  Inode/device IDs are not modeled; shown as 0. Timestamps use the virtual FS
  \`modified\` field for Access/Modify/Change.

Not implemented vs GNU: \`-c\`, \`-t\`, \`--file-system\`, \`--printf\`, BSD flags.
`;

/**
 * GNU-style option error for stat.
 * @param {string} arg
 * @returns {string}
 */
function statOptionError(arg) {
  const tryLine = "Try 'stat --help' for more information.\n";
  if (arg.startsWith('--') && arg.length > 2) {
    return `stat: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `stat: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `stat: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * Parse jsh `stat` argv (GNU-ish subset: -L/--dereference, -h/--help, --).
 *
 * @param {string[]} args
 * @returns {{ ok: true, dereference: boolean, operands: string[], help?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseStatArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  let dereference = false;
  const operands = [];
  for (let i = 0; i < argsArr.length; i++) {
    const a = argsArr[i];
    if (a === '--') {
      operands.push(...argsArr.slice(i + 1));
      break;
    }
    if (a === '--help' || a === '-h') {
      return { ok: true, dereference: false, operands: [], help: true };
    }
    if (a === '--dereference' || a === '-L') {
      dereference = true;
      continue;
    }
    if (a.startsWith('-') && a.length > 1) {
      if (a.startsWith('--')) {
        return { ok: false, stderr: statOptionError(a), exitCode: 1 };
      }
      for (let j = 1; j < a.length; j++) {
        const c = a[j];
        if (c === 'L') {
          dereference = true;
        } else if (c === 'h') {
          return { ok: true, dereference: false, operands: [], help: true };
        } else {
          return { ok: false, stderr: statOptionError(`-${c}`), exitCode: 1 };
        }
      }
      continue;
    }
    operands.push(a, ...argsArr.slice(i + 1));
    break;
  }
  if (!operands.length) {
    return { ok: false, stderr: 'stat: missing operand\n', exitCode: 1 };
  }
  return { ok: true, dereference, operands };
}

const TYPE_HELP = `Usage: type [-a] [--help] [--] name [name ...]
Display how each NAME would be interpreted as a command.

  -a              display all locations containing an executable named NAME
  -h, --help      display this help and exit

jsh:
  Registered commands are shown as "NAME is /bin/NAME" (same path story as which).
  Aliases use bash-style backticks around the replacement text.
  Not implemented vs bash: -t, -p, -P, -f, keywords, functions, hashed paths.
`;

/**
 * GNU-style option error for type.
 * @param {string} arg
 * @returns {string}
 */
function typeOptionError(arg) {
  const tryLine = "Try 'type --help' for more information.\n";
  if (arg.startsWith('--') && arg.length > 2) {
    return `type: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `type: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `type: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * Parse jsh `type` argv (bash-like subset: -a, -h/--help, --).
 *
 * @param {string[]} args
 * @returns {{ ok: true, showAll: boolean, names: string[], help?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseTypeArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  let showAll = false;
  let i = 0;
  for (; i < argsArr.length; i++) {
    const a = argsArr[i];
    if (a === '--') {
      i++;
      break;
    }
    if (a === '--help' || a === '-h') {
      return { ok: true, showAll: false, names: [], help: true };
    }
    if (a === '-a') {
      showAll = true;
      continue;
    }
    if (a.startsWith('-') && a.length > 1) {
      return { ok: false, stderr: typeOptionError(a), exitCode: 2 };
    }
    break;
  }
  const names = argsArr.slice(i).filter((n) => n !== '');
  if (!names.length) {
    const usage = 'type: usage: type [-a] [--] name [name ...]\n';
    return { ok: false, stderr: usage, exitCode: 2 };
  }
  return { ok: true, showAll, names };
}

const WHICH_HELP = `Usage: which [options] [--] name [name ...]
Locate a command in PATH.

  -a, --all         print all matching pathnames (alias line and /bin/NAME when both exist)
  -h, --help        display this help and exit

jsh:
  Registered builtins are listed as /bin/NAME (same path story as type).
  Aliases use "NAME: aliased to REPLACEMENT" (unquoted; not bash \`…\` like type).
  Not implemented vs GNU debianutils which: -s/--skip-alias, -v/--read-alias, external executables in PATH.
`;

/**
 * GNU-style option error for which.
 * @param {string} arg
 * @returns {string}
 */
function whichOptionError(arg) {
  const tryLine = "Try 'which --help' for more information.\n";
  if (arg.startsWith('--') && arg.length > 2) {
    return `which: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `which: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `which: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * Parse jsh `which` argv (GNU-like subset: -a/--all, -h/--help, --).
 *
 * @param {string[]} args
 * @returns {{ ok: true, showAll: boolean, names: string[], help?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseWhichArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  let showAll = false;
  let i = 0;
  for (; i < argsArr.length; i++) {
    const a = argsArr[i];
    if (a === '--') {
      i++;
      break;
    }
    if (a === '--help' || a === '-h') {
      return { ok: true, showAll: false, names: [], help: true };
    }
    if (a === '-a' || a === '--all') {
      showAll = true;
      continue;
    }
    if (a.startsWith('-') && a.length > 1) {
      return { ok: false, stderr: whichOptionError(a), exitCode: 2 };
    }
    break;
  }
  const names = argsArr.slice(i).filter((n) => n !== '');
  if (!names.length) {
    return { ok: false, stderr: 'which: missing operand\n', exitCode: 1 };
  }
  return { ok: true, showAll, names };
}

/**
 * Escape alias text for bash-style `type` output (backticks).
 * @param {string} s
 * @returns {string}
 */
function escapeTypeAliasBody(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/`/g, '\\`');
}

const ALIAS_HELP = `Usage: alias [-p] [--help] [--] [name[=value] ...]
Define or display command aliases.

  -p              print all aliases in a reusable form (same output lines as bare alias)
  -h, --help      display this help and exit (jsh; bash alias has no --help)
      --          end of options (define an alias whose name starts with -)

jsh:
  Aliases expand when the command line is parsed (see terminal README). Names must match
  [A-Za-z_][A-Za-z0-9_-]*. Not implemented vs bash: trailing space in value for next-word alias expansion.
`;

/**
 * GNU-style option error for alias (exit status 2).
 * @param {string} arg
 * @returns {string}
 */
function aliasOptionError(arg) {
  const tryLine = "Try 'alias --help' for more information.\n";
  if (arg.startsWith('--') && arg.length > 2) {
    return `alias: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `alias: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `alias: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * Parse jsh `alias` argv: optional `-p`, `--help`/`-h`, `--`, operands (name[=value] or name).
 *
 * @param {string[]} args
 * @returns {{ ok: true, printReusable: boolean, operands: string[], help?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseAliasArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  let printReusable = false;
  let i = 0;
  for (; i < argsArr.length; i++) {
    const a = argsArr[i];
    if (a === '--') {
      i++;
      break;
    }
    if (a === '--help' || a === '-h') {
      return { ok: true, printReusable: false, operands: [], help: true };
    }
    if (a === '-p') {
      printReusable = true;
      continue;
    }
    if (a.startsWith('-') && a.length > 1) {
      return { ok: false, stderr: aliasOptionError(a), exitCode: 2 };
    }
    break;
  }
  const operands = argsArr.slice(i).filter((n) => n !== '');
  return { ok: true, printReusable, operands };
}

/** Parent directory for an absolute virtual path (for symlink resolution). */
function dirnameVirtualPath(p) {
  if (p == null || p === '' || p === '/') {
    return '/';
  }
  const i = p.lastIndexOf('/');
  if (i <= 0) {
    return '/';
  }
  return p.slice(0, i) || '/';
}

const PWD_HELP = `Usage: pwd [OPTION]...
Print the full filename of the current working directory.

  -L, --logical   print logical path (default; jsh uses terminal cwd)
  -P, --physical  resolve symlinks in the path
  -h, --help      display this help and exit

jsh:
  -L does not consult the PWD environment variable; logical cwd is the shell's current directory.
  Not implemented vs GNU: --version.

Full documentation: <https://www.gnu.org/software/coreutils/manual/html_node/pwd-invocation.html>
`;

/**
 * GNU-style option error for pwd.
 * @param {string} arg
 * @returns {string}
 */
function pwdOptionError(arg) {
  const tryLine = "Try 'pwd --help' for more information.\n";
  if (arg.startsWith('--') && arg.length > 2) {
    return `pwd: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `pwd: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `pwd: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * Parse jsh `pwd` argv: -L/--logical, -P/--physical, -h/--help, --, rejects operands.
 *
 * @param {string[]} args
 * @returns {{ ok: true, physical: boolean, help?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parsePwdArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  let physical = false;
  let i = 0;
  for (; i < argsArr.length; i++) {
    const a = argsArr[i];
    if (a === '--') {
      i++;
      break;
    }
    if (a === '--help' || a === '-h') {
      return { ok: true, physical: false, help: true };
    }
    if (a === '-L' || a === '--logical') {
      physical = false;
      continue;
    }
    if (a === '-P' || a === '--physical') {
      physical = true;
      continue;
    }
    if (a.startsWith('-') && a.length > 1) {
      if (a.startsWith('--')) {
        return { ok: false, stderr: pwdOptionError(a), exitCode: 2 };
      }
      for (let j = 1; j < a.length; j++) {
        const c = a[j];
        if (c === 'L') {
          physical = false;
        } else if (c === 'P') {
          physical = true;
        } else {
          return { ok: false, stderr: pwdOptionError(`-${c}`), exitCode: 2 };
        }
      }
      continue;
    }
    break;
  }
  const operands = argsArr.slice(i).filter((n) => n !== '');
  if (operands.length > 0) {
    return {
      ok: false,
      stderr: `pwd: extra operand '${operands[0]}'\nTry 'pwd --help' for more information.\n`,
      exitCode: 1
    };
  }
  return { ok: true, physical };
}

/** Text aligned with GNU coreutils `date --help` (flags we implement; jsh notes below). */
const DATE_HELP = `Usage: date [OPTION]...

Display the current time in the given FORMAT, or the default format.

  -u, --utc, --universal    print or set Coordinated Universal Time
  -I, --iso-8601[=FMT]      output ISO 8601 date (FMT=date) or date+time (FMT=seconds)
  -h, --help                display this help and exit
      --version             display version information and exit
  --                        end of options

jsh:
  Default output is **Date.prototype.toString()** (local) or **toUTCString()** with **-u**.
  **-I** / **--iso-8601** prints **YYYY-MM-DD** (local, or UTC with **-u**).
  **-Is** / **--iso-8601=seconds** prints **YYYY-MM-DDTHH:MM:SS** (local) or **toISOString()** (UTC with **-u**).
  Combined short flags: **-uI** (UTC + ISO date), **-uIs** (UTC + ISO seconds).
  Not implemented vs GNU: **-d** / **-s** / **-r**, **+FORMAT** strings, **--file**, **TZ** overrides.

Full documentation: <https://www.gnu.org/software/coreutils/manual/html_node/date-invocation.html>
`;

const DATE_VERSION_LINE = 'date (jsh Heyming Terminal) 1.0\n';

/**
 * GNU-style option error for date (exit status 2).
 * @param {string} arg
 * @returns {string}
 */
function dateOptionError(arg) {
  const tryLine = "Try 'date --help' for more information.\n";
  if (arg.startsWith('--') && arg.length > 2) {
    return `date: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `date: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `date: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * Format current instant for jsh `date` (utc, ISO date, ISO seconds, or default).
 * @param {Date} d
 * @param {{ utc: boolean, iso: 'none' | 'date' | 'seconds' }} opts
 * @returns {string}
 */
function formatDateOutput(d, opts) {
  const utc = opts.utc;
  const iso = opts.iso;
  const pad = (n) => String(n).padStart(2, '0');
  if (iso === 'date') {
    if (utc) {
      return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    }
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  if (iso === 'seconds') {
    if (utc) {
      return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
    }
    const y = d.getFullYear();
    const m = pad(d.getMonth() + 1);
    const day = pad(d.getDate());
    const hh = pad(d.getHours());
    const mm = pad(d.getMinutes());
    const ss = pad(d.getSeconds());
    return `${y}-${m}-${day}T${hh}:${mm}:${ss}`;
  }
  if (utc) {
    return d.toUTCString();
  }
  return d.toString();
}

/**
 * Parse jsh `date` argv: -u, -I/-Is, long forms, --help/--version/--, rejects operands.
 *
 * @param {string[]} args
 * @returns {{ ok: true, utc: boolean, iso: 'none' | 'date' | 'seconds', help?: true, version?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseDateArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  let utc = false;
  let iso = /** @type {'none' | 'date' | 'seconds'} */ ('none');
  let i = 0;
  for (; i < argsArr.length; i++) {
    const a = argsArr[i];
    if (a === '--') {
      i++;
      break;
    }
    if (a === '--help' || a === '-h') {
      return { ok: true, utc: false, iso: 'none', help: true };
    }
    if (a === '--version') {
      return { ok: true, utc: false, iso: 'none', version: true };
    }
    if (a === '--utc' || a === '--universal') {
      utc = true;
      continue;
    }
    if (a === '--iso-8601') {
      iso = 'date';
      continue;
    }
    if (a.startsWith('--iso-8601=')) {
      const v = a.slice('--iso-8601='.length);
      if (v === 'seconds' || v === 's') {
        iso = 'seconds';
      } else if (v === 'date' || v === '') {
        iso = 'date';
      } else {
        return {
          ok: false,
          stderr: `date: invalid argument '${v}' for '--iso-8601'\nTry 'date --help' for more information.\n`,
          exitCode: 1
        };
      }
      continue;
    }
    if (a.startsWith('--') && a.length > 2) {
      return { ok: false, stderr: dateOptionError(a), exitCode: 2 };
    }
    if (a === '-I') {
      iso = 'date';
      continue;
    }
    if (a === '-Is') {
      iso = 'seconds';
      continue;
    }
    if (a.startsWith('-') && a.length > 1) {
      const rest = a.slice(1);
      let j = 0;
      while (j < rest.length) {
        if (rest[j] === 'u') {
          utc = true;
          j++;
          continue;
        }
        if (rest[j] === 'I') {
          if (rest.slice(j, j + 2) === 'Is') {
            iso = 'seconds';
            j += 2;
            continue;
          }
          iso = 'date';
          j++;
          continue;
        }
        return { ok: false, stderr: dateOptionError(`-${rest[j]}`), exitCode: 2 };
      }
      continue;
    }
    break;
  }
  const operands = argsArr.slice(i).filter((n) => n !== '');
  if (operands.length > 0) {
    return {
      ok: false,
      stderr: `date: extra operand '${operands[0]}'\nTry 'date --help' for more information.\n`,
      exitCode: 1
    };
  }
  return { ok: true, utc, iso };
}

const SEQ_HELP = `Usage: seq [OPTION]... LAST
  or:  seq [OPTION]... FIRST LAST
  or:  seq [OPTION]... FIRST INCREMENT LAST

Print a sequence of numbers to standard output.

  -s, --separator=STRING   use STRING to separate numbers (default: newline)
  -w, --equal-width          equalize width with leading zeros (GNU-like; see jsh notes)
  -h, --help                 display this help and exit
      --version              output version information and exit
      --                     end of options

jsh:
  **LAST** only: **FIRST** is **1**; **INCREMENT** is **1** or **-1** by range direction (GNU-style).
  **FIRST LAST**: **INCREMENT** is **1** or **-1** by direction. **FIRST INCREMENT LAST** rejects
  a zero increment (**exit 1**). At most **1000000** values per run.
  Not implemented vs GNU: **-f** / **--format**, **-t** / **--terminator**.

Full documentation: <https://www.gnu.org/software/coreutils/manual/html_node/seq-invocation.html>
`;

const SEQ_VERSION_LINE = 'seq (jsh Heyming Terminal) 1.0\n';

/** Maximum sequence length (inclusive) for jsh \`seq\`. */
const SEQ_MAX_VALUES = 1_000_000;

/**
 * GNU-style option error for seq (exit status 2).
 * @param {string} arg
 * @returns {string}
 */
function seqOptionError(arg) {
  const tryLine = "Try 'seq --help' for more information.\n";
  if (arg.startsWith('--') && arg.length > 2) {
    return `seq: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `seq: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `seq: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * @param {string} s
 * @returns {{ ok: true, value: number } | { ok: false }}
 */
function parseSeqNum(s) {
  const t = String(s).trim();
  if (t === '') {
    return { ok: false };
  }
  const n = Number(t);
  if (!Number.isFinite(n)) {
    return { ok: false };
  }
  return { ok: true, value: n };
}

/**
 * @param {number} first
 * @param {number} incr
 * @param {number} last
 * @returns {{ ok: true, values: number[] } | { ok: false, stderr: string, exitCode: number }}
 */
function genSeqSequence(first, incr, last) {
  if (incr === 0) {
    return { ok: false, stderr: 'seq: zero increment\n', exitCode: 1 };
  }
  const out = [];
  for (let n = 0; ; n++) {
    if (n >= SEQ_MAX_VALUES) {
      return { ok: false, stderr: 'seq: result too large\n', exitCode: 1 };
    }
    const x = first + n * incr;
    if (incr > 0 && x > last) {
      break;
    }
    if (incr < 0 && x < last) {
      break;
    }
    out.push(x);
  }
  return { ok: true, values: out };
}

/**
 * @param {number[]} values
 * @param {string} separator
 * @param {boolean} equalWidth
 * @returns {string}
 */
function formatSeqOutput(values, separator, equalWidth) {
  if (values.length === 0) {
    return '';
  }
  let strs = values.map((v) => String(v));
  if (equalWidth) {
    const w = Math.max(...strs.map((s) => s.length));
    strs = strs.map((s) => {
      if (s.startsWith('-')) {
        const rest = s.slice(1);
        return `-${rest.padStart(Math.max(0, w - 1), '0')}`;
      }
      return s.padStart(w, '0');
    });
  }
  return strs.join(separator) + '\n';
}

/**
 * Parse jsh `seq` argv: -s, -w, --help/--version/--, GNU-style operands.
 *
 * @param {string[]} args
 * @returns {{ ok: true, first: number, incr: number, last: number, separator: string, equalWidth: boolean, help?: true, version?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseSeqArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  let separator = '\n';
  let equalWidth = false;
  let i = 0;
  while (i < argsArr.length) {
    const a = argsArr[i];
    if (a === '--') {
      i++;
      break;
    }
    if (a === '--help' || a === '-h') {
      return { ok: true, help: true };
    }
    if (a === '--version') {
      return { ok: true, version: true };
    }
    if (a === '-w' || a === '--equal-width') {
      equalWidth = true;
      i++;
      continue;
    }
    if (a === '-s') {
      const sep = argsArr[i + 1];
      if (sep === undefined) {
        return {
          ok: false,
          stderr: `seq: option requires an argument -- 's'\n`,
          exitCode: 2
        };
      }
      separator = sep;
      i += 2;
      continue;
    }
    if (a.startsWith('--separator=')) {
      separator = a.slice('--separator='.length);
      i++;
      continue;
    }
    if (a === '--separator') {
      const sep = argsArr[i + 1];
      if (sep === undefined) {
        return {
          ok: false,
          stderr: `seq: option requires an argument -- 'separator'\n`,
          exitCode: 2
        };
      }
      separator = sep;
      i += 2;
      continue;
    }
    const asNum = parseSeqNum(a);
    if (asNum.ok) {
      break;
    }
    if (a.startsWith('-') && a.length > 1) {
      return { ok: false, stderr: seqOptionError(a), exitCode: 2 };
    }
    break;
  }
  const operands = argsArr.slice(i);
  if (operands.length === 0) {
    return { ok: false, stderr: 'seq: missing operand\n', exitCode: 1 };
  }
  if (operands.length > 3) {
    return {
      ok: false,
      stderr: `seq: extra operand '${operands[3]}'\nTry 'seq --help' for more information.\n`,
      exitCode: 1
    };
  }
  const numbers = [];
  for (const op of operands) {
    const p = parseSeqNum(op);
    if (!p.ok) {
      return {
        ok: false,
        stderr: `seq: invalid floating point argument: '${op}'\n`,
        exitCode: 1
      };
    }
    numbers.push(p.value);
  }
  let first;
  let incr;
  let last;
  if (numbers.length === 1) {
    last = numbers[0];
    first = 1;
    incr = last >= first ? 1 : -1;
  } else if (numbers.length === 2) {
    first = numbers[0];
    last = numbers[1];
    incr = first <= last ? 1 : -1;
  } else {
    first = numbers[0];
    incr = numbers[1];
    last = numbers[2];
  }
  return { ok: true, first, incr, last, separator, equalWidth };
}

const SLEEP_HELP = `Usage: sleep NUMBER[SUFFIX]...
  or:  sleep OPTION

Pause for NUMBER seconds. SUFFIX may be **s** (seconds, default), **m**, **h**, or **d**.
Multiple NUMBERs are summed (GNU-style). A decimal value is allowed.

  -h, --help     display this help and exit
      --version  output version information and exit
      --         end of options

jsh:
  **Ctrl+C** aborts the wait (**exit 130**). Long sleeps are applied in chunks (browser
  **setTimeout** limit ~24.8 days per chunk). Not implemented vs GNU: no **--**-only
  special cases beyond operand parsing.

Full documentation: <https://www.gnu.org/software/coreutils/manual/html_node/sleep-invocation.html>
`;

const SLEEP_VERSION_LINE = 'sleep (jsh Heyming Terminal) 1.0\n';

/**
 * GNU-style option error for sleep (exit status 2).
 * @param {string} arg
 * @returns {string}
 */
function sleepOptionError(arg) {
  const tryLine = "Try 'sleep --help' for more information.\n";
  if (arg.startsWith('--') && arg.length > 2) {
    return `sleep: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `sleep: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `sleep: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * Parse one GNU-style sleep duration token (non-negative float + optional s/m/h/d).
 * @param {string} tok
 * @returns {{ ok: true, seconds: number } | { ok: false }}
 */
function parseSleepIntervalToken(tok) {
  const t = String(tok).trim();
  if (t === '') {
    return { ok: false };
  }
  const m = t.match(/^(-?)([0-9]*\.?[0-9]+|[0-9]+\.[0-9]+)([smhd])?$/i);
  if (!m) {
    return { ok: false };
  }
  const num = parseFloat((m[1] || '') + m[2]);
  if (!Number.isFinite(num) || num < 0) {
    return { ok: false };
  }
  const suf = (m[3] || 's').toLowerCase();
  const mult = { s: 1, m: 60, h: 3600, d: 86400 }[suf];
  if (mult === undefined) {
    return { ok: false };
  }
  const sec = num * mult;
  if (!Number.isFinite(sec)) {
    return { ok: false };
  }
  return { ok: true, seconds: sec };
}

/**
 * Parse jsh `sleep` argv: GNU-style NUMBER[SUFFIX] operands (summed), --help/--version/--.
 *
 * @param {string[]} args
 * @returns {{ ok: true, totalSeconds: number, help?: true, version?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseSleepArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  let i = 0;
  while (i < argsArr.length) {
    const a = argsArr[i];
    if (a === '--') {
      i++;
      break;
    }
    if (a === '--help' || a === '-h') {
      return { ok: true, help: true };
    }
    if (a === '--version') {
      return { ok: true, version: true };
    }
    if (a.startsWith('-') && a.length > 1) {
      if (/^-\d/.test(a) || /^-\.\d/.test(a)) {
        break;
      }
      return { ok: false, stderr: sleepOptionError(a), exitCode: 2 };
    }
    break;
  }
  const operands = argsArr.slice(i);
  if (operands.length === 0) {
    return { ok: false, stderr: 'sleep: missing operand\n', exitCode: 1 };
  }
  let totalSec = 0;
  for (const op of operands) {
    const p = parseSleepIntervalToken(op);
    if (!p.ok) {
      return {
        ok: false,
        stderr: `sleep: invalid time interval '${op}'\n`,
        exitCode: 1
      };
    }
    totalSec += p.seconds;
  }
  if (!Number.isFinite(totalSec) || totalSec < 0) {
    return { ok: false, stderr: 'sleep: invalid time interval\n', exitCode: 1 };
  }
  return { ok: true, totalSeconds: totalSec };
}

const PRINTF_HELP = `Usage: printf FORMAT [ARGUMENT]...
  or:  printf OPTION

Print formatted strings (POSIX/GNU subset; jsh).

FORMAT may contain escape sequences (\\n, \\t, \\\\, octal \\0NNN, \\xHH, …) and
conversion specifications: %% %s %d %i %u %o %x %X %f %F %c (optional width / precision).

If more ARGUMENTs remain after FORMAT is consumed, FORMAT is reused until all are consumed.

  -h, --help     display this help and exit
      --version  output version information and exit
      --         end of options

jsh:
  Shell expands \\$VAR / \\$? in FORMAT and operands before formatting (like echo).
  Not implemented vs GNU/POSIX: **%b**, **%q**, **%n**, **\\*** width/precision from args,
  positional **%n\\$**, locale-specific numeric formats, long doubles.

Full documentation: <https://www.gnu.org/software/coreutils/manual/html_node/printf-invocation.html>
`;

const PRINTF_VERSION_LINE = 'printf (jsh Heyming Terminal) 1.0\n';

/**
 * GNU-style option error for printf (exit status 2).
 * @param {string} arg
 * @returns {string}
 */
function printfOptionError(arg) {
  const tryLine = "Try 'printf --help' for more information.\n";
  if (arg.startsWith('--') && arg.length > 2) {
    return `printf: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `printf: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `printf: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * Consume one backslash escape in a printf FORMAT string (echo-like; no \\c stop in format).
 * @param {string} format
 * @param {number} i index of '\\'
 * @returns {{ out: string, next: number }}
 */
function printfConsumeBackslashEscape(format, i) {
  const s = format;
  let j = i + 1;
  if (j >= s.length) {
    return { out: '\\', next: s.length };
  }
  const c = s[j];
  switch (c) {
    case 'a':
      return { out: '\x07', next: j + 1 };
    case 'b':
      return { out: '\b', next: j + 1 };
    case 'f':
      return { out: '\f', next: j + 1 };
    case 'n':
      return { out: '\n', next: j + 1 };
    case 'r':
      return { out: '\r', next: j + 1 };
    case 't':
      return { out: '\t', next: j + 1 };
    case 'v':
      return { out: '\v', next: j + 1 };
    case '\\':
      return { out: '\\', next: j + 1 };
    case 'e':
    case 'E':
      return { out: '\x1b', next: j + 1 };
    case '0':
    case '1':
    case '2':
    case '3':
    case '4':
    case '5':
    case '6':
    case '7': {
      let val = 0;
      let count = 0;
      let k = j;
      while (count < 3 && k < s.length) {
        const ch = s[k];
        if (ch < '0' || ch > '7') {
          break;
        }
        val = val * 8 + (ch.charCodeAt(0) - 48);
        k++;
        count++;
      }
      return { out: String.fromCharCode(val & 0xff), next: k };
    }
    case 'x': {
      j++;
      let hex = '';
      while (j < s.length && /[0-9a-fA-F]/.test(s[j])) {
        hex += s[j];
        j++;
      }
      if (hex === '') {
        return { out: 'x', next: j };
      }
      const code = parseInt(hex, 16);
      return { out: String.fromCharCode(code & 0xff), next: j };
    }
    default:
      return { out: c, next: j + 1 };
  }
}

/**
 * @param {string} format
 * @param {number} start index of '%'
 * @returns {{ kind: 'literal', end: number } | { kind: 'spec', flags: string, width: number | null, precision: number | null, conv: string, end: number } | null}
 */
function printfParseSpec(format, start) {
  if (start >= format.length || format[start] !== '%') {
    return null;
  }
  if (format[start + 1] === '%') {
    return { kind: 'literal', end: start + 2 };
  }
  let j = start + 1;
  let flags = '';
  while (j < format.length && "0- #+'".includes(format[j])) {
    flags += format[j];
    j++;
  }
  let widthStr = '';
  while (j < format.length && format[j] >= '0' && format[j] <= '9') {
    widthStr += format[j];
    j++;
  }
  let precision = null;
  if (j < format.length && format[j] === '.') {
    j++;
    let precStr = '';
    while (j < format.length && format[j] >= '0' && format[j] <= '9') {
      precStr += format[j];
      j++;
    }
    precision = precStr === '' ? 0 : parseInt(precStr, 10);
  }
  const conv = format[j];
  if (!conv) {
    return null;
  }
  const width = widthStr === '' ? null : parseInt(widthStr, 10);
  j++;
  return { kind: 'spec', flags, width, precision, conv, end: j };
}

/**
 * @param {string} arg
 * @returns {string}
 */
function printfFormatChar(arg) {
  const s = String(arg);
  if (s === '') {
    return '';
  }
  const n = Number(s);
  if (s.trim() !== '' && Number.isFinite(n) && String(Math.trunc(n)) === s.trim()) {
    const code = Math.trunc(n);
    if (code >= 0 && code <= 0x10ffff) {
      return String.fromCodePoint(code);
    }
  }
  return s[0];
}

/**
 * @param {{ flags: string, width: number | null, precision: number | null, conv: string }} spec
 * @param {string} value
 * @returns {string}
 */
function printfPadString(spec, value) {
  const w = spec.width;
  if (w == null || w <= 0) {
    return value;
  }
  const left = spec.flags.includes('-');
  const pad = spec.flags.includes('0') ? '0' : ' ';
  if (value.length >= w) {
    return value;
  }
  const padLen = w - value.length;
  const p = pad.repeat(padLen);
  return left ? value + p : p + value;
}

/**
 * @param {{ flags: string, width: number | null, precision: number | null, conv: string }} spec
 * @param {string} rawArg
 * @returns {{ ok: true, text: string } | { ok: false, stderr: string }}
 */
function printfApplySpec(spec, rawArg) {
  const { conv, precision } = spec;
  const arg = rawArg === undefined ? '' : rawArg;
  switch (conv) {
    case 's': {
      let t = String(arg);
      if (precision != null && precision >= 0) {
        t = t.slice(0, precision);
      }
      return { ok: true, text: printfPadString(spec, t) };
    }
    case 'd':
    case 'i': {
      const n = Number(String(arg).trim());
      if (!Number.isFinite(n)) {
        return { ok: false, stderr: `printf: '${arg}': value not completely converted\n` };
      }
      let t = String(Math.trunc(n));
      const w = spec.width;
      if (w != null && w > 0 && spec.flags.includes('0') && !spec.flags.includes('-') && n >= 0) {
        t = t.padStart(w, '0');
      } else {
        t = printfPadString(spec, t);
      }
      return { ok: true, text: t };
    }
    case 'u': {
      const n = Number(String(arg).trim());
      if (!Number.isFinite(n) || n < 0) {
        return { ok: false, stderr: `printf: '${arg}': value not completely converted\n` };
      }
      let t = String(Math.trunc(n));
      t = printfPadString(spec, t);
      return { ok: true, text: t };
    }
    case 'o': {
      const n = Number(String(arg).trim());
      if (!Number.isFinite(n) || n < 0) {
        return { ok: false, stderr: `printf: '${arg}': value not completely converted\n` };
      }
      let t = Math.trunc(n).toString(8);
      t = printfPadString(spec, t);
      return { ok: true, text: t };
    }
    case 'x':
    case 'X': {
      const n = Number(String(arg).trim());
      if (!Number.isFinite(n) || n < 0) {
        return { ok: false, stderr: `printf: '%${conv}': value not completely converted\n` };
      }
      let t = Math.trunc(n).toString(16);
      if (conv === 'X') {
        t = t.toUpperCase();
      }
      t = printfPadString(spec, t);
      return { ok: true, text: t };
    }
    case 'f':
    case 'F':
    case 'g':
    case 'G': {
      const n = Number(String(arg).trim());
      if (!Number.isFinite(n)) {
        return { ok: false, stderr: `printf: '${arg}': value not completely converted\n` };
      }
      const prec = precision != null ? precision : 6;
      let t = n.toFixed(prec);
      if ((conv === 'g' || conv === 'G') && /[eE]/.test(t)) {
        t = String(n);
      }
      t = printfPadString(spec, t);
      return { ok: true, text: t };
    }
    case 'c':
      return { ok: true, text: printfFormatChar(arg) };
    default:
      return { ok: false, stderr: `printf: %${conv}: invalid conversion specification\n` };
  }
}

/**
 * Count conversion specs that consume an argument (excludes %%).
 * @param {string} format
 * @returns {number} -1 if incomplete % at end
 */
function printfCountArgConsumingSpecs(format) {
  let n = 0;
  let i = 0;
  while (i < format.length) {
    if (format[i] === '\\') {
      const { next } = printfConsumeBackslashEscape(format, i);
      i = next;
      continue;
    }
    if (format[i] === '%') {
      const spec = printfParseSpec(format, i);
      if (!spec) {
        return -1;
      }
      if (spec.kind === 'literal') {
        i = spec.end;
      } else {
        n++;
        i = spec.end;
      }
      continue;
    }
    i++;
  }
  return n;
}

/**
 * Run printf FORMAT against ARGUMENTs (after shell expansion). Implements format reuse for extra args.
 *
 * @param {string} format
 * @param {string[]} argv
 * @returns {{ ok: true, stdout: string, stderr: string } | { ok: false, stderr: string, exitCode: number }}
 */
function runPrintfFormat(format, argv) {
  const args = Array.isArray(argv) ? argv : [];
  let argIdx = 0;
  let out = '';
  let stderr = '';

  const processOnePass = () => {
    let i = 0;
    while (i < format.length) {
      const ch = format[i];
      if (ch === '\\') {
        const { out: seg, next } = printfConsumeBackslashEscape(format, i);
        out += seg;
        i = next;
        continue;
      }
      if (ch === '%') {
        const spec = printfParseSpec(format, i);
        if (!spec) {
          return { ok: false, stderr: 'printf: missing conversion character\n', exitCode: 1 };
        }
        if (spec.kind === 'literal') {
          out += '%';
          i = spec.end;
          continue;
        }
        if (argIdx >= args.length) {
          return { ok: false, stderr: 'printf: missing argument for format\n', exitCode: 1 };
        }
        const raw = args[argIdx++];
        const applied = printfApplySpec(spec, raw);
        if (!applied.ok) {
          return { ok: false, stderr: applied.stderr, exitCode: 1 };
        }
        out += applied.text;
        i = spec.end;
        continue;
      }
      out += ch;
      i++;
    }
    return { ok: true };
  };

  const specCount = printfCountArgConsumingSpecs(format);
  if (specCount < 0) {
    return { ok: false, stderr: 'printf: missing conversion character\n', exitCode: 1 };
  }

  if (specCount === 0) {
    const once = processOnePass();
    if (!once.ok) {
      return once;
    }
    if (argIdx < args.length) {
      stderr = `printf: warning: ignoring excess arguments, starting with '${args[argIdx]}'\n`;
    }
    return { ok: true, stdout: out, stderr };
  }

  do {
    const pass = processOnePass();
    if (!pass.ok) {
      return pass;
    }
  } while (argIdx < args.length);

  return { ok: true, stdout: out, stderr };
}

/**
 * Parse jsh `printf` argv: --help/--version/--, FORMAT + operands.
 *
 * @param {string[]} args
 * @returns {{ ok: true, format: string, operands: string[], help?: true, version?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parsePrintfArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  let i = 0;
  while (i < argsArr.length) {
    const a = argsArr[i];
    if (a === '--') {
      i++;
      break;
    }
    if (a === '--help' || a === '-h') {
      return { ok: true, format: '', operands: [], help: true };
    }
    if (a === '--version') {
      return { ok: true, format: '', operands: [], version: true };
    }
    if (a.startsWith('-') && a.length > 1) {
      return { ok: false, stderr: printfOptionError(a), exitCode: 2 };
    }
    break;
  }
  const rest = argsArr.slice(i);
  if (rest.length === 0) {
    return { ok: false, stderr: 'printf: missing operand\n', exitCode: 1 };
  }
  const format = rest[0];
  const operands = rest.slice(1);
  return { ok: true, format, operands };
}

const HEAD_HELP = `Usage: head [OPTION]... [FILE]...
Print the first 10 lines of each FILE to standard output.

With more than one FILE, precede each with a header giving the file name.

  -n, --lines=[-]NUM    print the first NUM lines instead of the first 10
  -h, --help            display this help and exit (jsh: -h is alias)

A line count may be written as -NUM (e.g. head -5 FILE).

jsh:
  Operand - reads standard input. Piped stdin is used only when no FILE operands are given.
  Text files use UTF-8; binary files yield empty lines here.
  Not implemented vs GNU: -c/--bytes, -q/-v, -z, negative -n counts, --version.

Full documentation: <https://www.gnu.org/software/coreutils/head>
`;

const TAIL_HELP = `Usage: tail [OPTION]... [FILE]...
Print the last 10 lines of each FILE to standard output.

With more than one FILE, precede each with a header giving the file name.

  -n, --lines=[-]NUM    output the last NUM lines (default 10)
  -h, --help            display this help and exit (jsh: -h is alias)

A line count may be written as -NUM (e.g. tail -5 FILE).

jsh:
  Operand - reads standard input. Piped stdin is used only when no FILE operands are given.
  Text files use UTF-8; binary files yield empty lines here.
  Not implemented vs GNU: -c/--bytes, -f/--follow, -q/-v, -z, --version.

Full documentation: <https://www.gnu.org/software/coreutils/tail>
`;

/**
 * GNU-style option error for head/tail.
 * @param {string} cmd
 * @param {string} arg
 * @returns {string}
 */
function linesCommandOptionError(cmd, arg) {
  const tryLine = `Try '${cmd} --help' for more information.\n`;
  if (arg.startsWith('--') && arg.length > 2) {
    return `${cmd}: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `${cmd}: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `${cmd}: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * Parse jsh `head` / `tail` argv: -n/--lines, -NUM, --, --help/-h, rejects unknown flags.
 *
 * @param {string[]} args
 * @param {'head'|'tail'} cmdName
 * @param {number} defaultLines
 * @returns {{ ok: true, lines: number, operands: string[], help?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseLinesFilterArgv(args, cmdName, defaultLines) {
  const argsArr = Array.isArray(args) ? args : [];
  let lines = defaultLines;
  const operands = [];
  let i = 0;
  while (i < argsArr.length) {
    const arg = argsArr[i];
    if (arg === '--help' || arg === '-h') {
      return { ok: true, lines, operands: [], help: true };
    }
    if (arg === '--') {
      operands.push(...argsArr.slice(i + 1));
      break;
    }
    if (arg === '-n' || arg === '--lines') {
      if (i + 1 >= argsArr.length) {
        const opt = arg === '-n' ? 'n' : 'lines';
        return {
          ok: false,
          stderr: `${cmdName}: option requires an argument -- '${opt}'\n`,
          exitCode: 1
        };
      }
      const raw = argsArr[i + 1];
      const n = parseInt(raw, 10);
      if (Number.isNaN(n) || raw === '' || n < 0) {
        return {
          ok: false,
          stderr: `${cmdName}: invalid number of lines: '${raw}'\n`,
          exitCode: 1
        };
      }
      lines = n;
      i += 2;
      continue;
    }
    if (arg.startsWith('--lines=')) {
      const raw = arg.slice('--lines='.length);
      const n = parseInt(raw, 10);
      if (Number.isNaN(n) || raw === '' || n < 0) {
        return {
          ok: false,
          stderr: `${cmdName}: invalid number of lines: '${raw}'\n`,
          exitCode: 1
        };
      }
      lines = n;
      i++;
      continue;
    }
    if (/^-n\d+$/.test(arg)) {
      const n = parseInt(arg.slice(2), 10);
      if (Number.isNaN(n) || n < 0) {
        return {
          ok: false,
          stderr: `${cmdName}: invalid number of lines: '${arg.slice(2)}'\n`,
          exitCode: 1
        };
      }
      lines = n;
      i++;
      continue;
    }
    if (/^-\d+$/.test(arg)) {
      const n = parseInt(arg.substring(1), 10);
      if (Number.isNaN(n) || n < 0) {
        return {
          ok: false,
          stderr: `${cmdName}: invalid number of lines: '${arg.substring(1)}'\n`,
          exitCode: 1
        };
      }
      lines = n;
      i++;
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1) {
      return { ok: false, stderr: linesCommandOptionError(cmdName, arg), exitCode: 1 };
    }
    operands.push(arg, ...argsArr.slice(i + 1));
    break;
  }
  return { ok: true, lines, operands };
}

const WC_HELP = `Usage: wc [OPTION]... [FILE]...
Print newline, word, and byte counts for each FILE, and a total line if more than one FILE is given.

  -c, --bytes    print the byte counts (UTF-8)
  -l, --lines    print the newline counts
  -w, --words    print the word counts
  -h, --help     display this help and exit
  --             end of options

With no FILE, or when FILE is -, read standard input. Piped stdin is used only when no FILE operands are given.

jsh:
  Multiple FILE operands are supported; a final "total" line is printed when two or more inputs are counted.
  Words are runs of non-whitespace (\\S+). Symlinks are followed to a regular file (like head/tail).
  Not implemented vs GNU: -L/--max-line-length, -m/--chars, --files0-from, --version.

Full documentation: <https://www.gnu.org/software/coreutils/wc>
`;

const NL_HELP = `Usage: nl [OPTION]... [FILE]...
Write FILE(s) to standard output with line numbers; with no FILE, or when FILE is -, read stdin.

  -b, --body-numbering=STYLE   a (all), t (nonempty, default), or n (none)
  -n, --number-format=FORMAT   ln (left), rn (right, default), rz (right zero-filled)
  -w, --number-width=NUM       line number field width (default 6)
  -s, --number-separator=STR   separate number from line (default TAB)
  -h, --help                   display this help and exit
  --                           end of options

With no FILE, or when FILE is -, read standard input. Piped stdin requires stdin to be supplied (empty pipe works).

jsh:
  Multiple FILE operands print ==> path <== headers before each file (like head/wc). Line numbering restarts at 1 for each FILE.
  Symlinks are followed to a regular file. Binary files print a single numbered [binary file] line.
  -h is --help (GNU nl uses -h for logical-page header text).
  Not full GNU: no logical page mode (-f/-d/-v/-i/-p), or --version.

Full documentation: <https://www.gnu.org/software/coreutils/nl>
`;

/**
 * GNU-style option error for nl (exit status 1).
 * @param {string} arg
 * @returns {string}
 */
function nlOptionError(arg) {
  const tryLine = "Try 'nl --help' for more information.\n";
  if (arg.startsWith('--') && arg.length > 2) {
    return `nl: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `nl: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `nl: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * @param {string} s
 * @returns {{ ok: true, value: 'a'|'t'|'n' } | { ok: false, stderr: string, exitCode: number }}
 */
function nlParseBodyNumberingStyle(s) {
  const v = String(s).trim();
  if (v === 'a' || v === 't' || v === 'n') return { ok: true, value: v };
  return {
    ok: false,
    stderr: `nl: invalid body numbering style: '${v}'\nTry 'nl --help' for more information.\n`,
    exitCode: 1
  };
}

/**
 * @param {string} s
 * @returns {{ ok: true, value: 'ln'|'rn'|'rz' } | { ok: false, stderr: string, exitCode: number }}
 */
function nlParseNumberFormat(s) {
  const v = String(s).trim();
  if (v === 'ln' || v === 'rn' || v === 'rz') return { ok: true, value: v };
  return {
    ok: false,
    stderr: `nl: invalid line numbering format: '${v}'\nTry 'nl --help' for more information.\n`,
    exitCode: 1
  };
}

/**
 * Parse jsh \`nl\` argv (GNU subset: -b -n -w -s, long forms, --, -h/--help).
 *
 * @param {string[]} args
 * @returns {{ ok: true, bodyNumbering: 'a'|'t'|'n', numberFormat: 'ln'|'rn'|'rz', numberWidth: number, separator: string, operands: string[], help?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseNlArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  let bodyNumbering = 't';
  let numberFormat = 'rn';
  let numberWidth = 6;
  let separator = '\t';
  const operands = [];
  let i = 0;
  while (i < argsArr.length) {
    const arg = argsArr[i];
    if (arg === '--help' || arg === '-h') {
      return {
        ok: true,
        bodyNumbering,
        numberFormat,
        numberWidth,
        separator,
        operands: [],
        help: true
      };
    }
    if (arg === '--') {
      operands.push(...argsArr.slice(i + 1));
      break;
    }
    if (arg === '-') {
      operands.push('-');
      i++;
      continue;
    }
    if (arg === '--body-numbering') {
      const v = argsArr[++i];
      if (v == null || (v.startsWith('-') && v !== '-')) {
        return {
          ok: false,
          stderr: `nl: option '--body-numbering' requires an argument\nTry 'nl --help' for more information.\n`,
          exitCode: 1
        };
      }
      const r = nlParseBodyNumberingStyle(v);
      if (!r.ok) return r;
      bodyNumbering = r.value;
      i++;
      continue;
    }
    if (arg.startsWith('--body-numbering=')) {
      const v = arg.slice('--body-numbering='.length);
      const r = nlParseBodyNumberingStyle(v);
      if (!r.ok) return r;
      bodyNumbering = r.value;
      i++;
      continue;
    }
    if (arg === '--number-format') {
      const v = argsArr[++i];
      if (v == null || (v.startsWith('-') && v !== '-')) {
        return {
          ok: false,
          stderr: `nl: option '--number-format' requires an argument\nTry 'nl --help' for more information.\n`,
          exitCode: 1
        };
      }
      const r = nlParseNumberFormat(v);
      if (!r.ok) return r;
      numberFormat = r.value;
      i++;
      continue;
    }
    if (arg.startsWith('--number-format=')) {
      const v = arg.slice('--number-format='.length);
      const r = nlParseNumberFormat(v);
      if (!r.ok) return r;
      numberFormat = r.value;
      i++;
      continue;
    }
    if (arg === '--number-width') {
      const v = argsArr[++i];
      if (v == null || (v.startsWith('-') && v !== '-')) {
        return {
          ok: false,
          stderr: `nl: option '--number-width' requires an argument\nTry 'nl --help' for more information.\n`,
          exitCode: 1
        };
      }
      const n = parseInt(String(v), 10);
      if (!Number.isFinite(n) || n < 1 || n > 256) {
        return {
          ok: false,
          stderr: `nl: invalid line number width: '${v}'\nTry 'nl --help' for more information.\n`,
          exitCode: 1
        };
      }
      numberWidth = n;
      i++;
      continue;
    }
    if (arg.startsWith('--number-width=')) {
      const v = arg.slice('--number-width='.length);
      const n = parseInt(String(v), 10);
      if (!Number.isFinite(n) || n < 1 || n > 256) {
        return {
          ok: false,
          stderr: `nl: invalid line number width: '${v}'\nTry 'nl --help' for more information.\n`,
          exitCode: 1
        };
      }
      numberWidth = n;
      i++;
      continue;
    }
    if (arg === '--number-separator') {
      const v = argsArr[++i];
      if (v == null) {
        return {
          ok: false,
          stderr: `nl: option '--number-separator' requires an argument\nTry 'nl --help' for more information.\n`,
          exitCode: 1
        };
      }
      separator = String(v);
      i++;
      continue;
    }
    if (arg.startsWith('--number-separator=')) {
      separator = arg.slice('--number-separator='.length);
      i++;
      continue;
    }
    if (arg === '-b') {
      const next = argsArr[i + 1];
      if (next != null && !next.startsWith('-')) {
        const r = nlParseBodyNumberingStyle(next);
        if (!r.ok) return r;
        bodyNumbering = r.value;
        i += 2;
        continue;
      }
      return {
        ok: false,
        stderr: `nl: option requires an argument -- 'b'\nTry 'nl --help' for more information.\n`,
        exitCode: 1
      };
    }
    if (arg.startsWith('-b') && arg.length > 2) {
      const v = arg.slice(2);
      const r = nlParseBodyNumberingStyle(v);
      if (!r.ok) return r;
      bodyNumbering = r.value;
      i++;
      continue;
    }
    if (arg === '-n') {
      const next = argsArr[i + 1];
      if (next != null && !next.startsWith('-')) {
        const r = nlParseNumberFormat(next);
        if (!r.ok) return r;
        numberFormat = r.value;
        i += 2;
        continue;
      }
      return {
        ok: false,
        stderr: `nl: option requires an argument -- 'n'\nTry 'nl --help' for more information.\n`,
        exitCode: 1
      };
    }
    if (arg.startsWith('-n') && arg.length > 2) {
      const v = arg.slice(2);
      const r = nlParseNumberFormat(v);
      if (!r.ok) return r;
      numberFormat = r.value;
      i++;
      continue;
    }
    if (arg === '-w') {
      const next = argsArr[i + 1];
      if (next != null && !next.startsWith('-')) {
        const n = parseInt(String(next), 10);
        if (!Number.isFinite(n) || n < 1 || n > 256) {
          return {
            ok: false,
            stderr: `nl: invalid line number width: '${next}'\nTry 'nl --help' for more information.\n`,
            exitCode: 1
          };
        }
        numberWidth = n;
        i += 2;
        continue;
      }
      return {
        ok: false,
        stderr: `nl: option requires an argument -- 'w'\nTry 'nl --help' for more information.\n`,
        exitCode: 1
      };
    }
    if (arg.startsWith('-w') && arg.length > 2) {
      const v = arg.slice(2);
      const n = parseInt(v, 10);
      if (!Number.isFinite(n) || n < 1 || n > 256) {
        return {
          ok: false,
          stderr: `nl: invalid line number width: '${v}'\nTry 'nl --help' for more information.\n`,
          exitCode: 1
        };
      }
      numberWidth = n;
      i++;
      continue;
    }
    if (arg === '-s') {
      const next = argsArr[i + 1];
      if (next == null) {
        return {
          ok: false,
          stderr: `nl: option requires an argument -- 's'\nTry 'nl --help' for more information.\n`,
          exitCode: 1
        };
      }
      separator = String(next);
      i += 2;
      continue;
    }
    if (arg.startsWith('-s') && arg.length > 2) {
      separator = arg.slice(2);
      i++;
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1) {
      return { ok: false, stderr: nlOptionError(arg), exitCode: 1 };
    }
    operands.push(arg, ...argsArr.slice(i + 1));
    break;
  }
  return { ok: true, bodyNumbering, numberFormat, numberWidth, separator, operands };
}

/**
 * @param {number} n
 * @param {number} width
 * @param {'ln'|'rn'|'rz'} fmt
 * @returns {string}
 */
function nlFormatNumberField(n, width, fmt) {
  const w = Math.max(1, Math.min(256, width));
  const s = String(n);
  if (fmt === 'ln') return s.padEnd(w, ' ');
  if (fmt === 'rz') return s.padStart(w, '0');
  return s.padStart(w, ' ');
}

/**
 * @param {string} text
 * @param {{ bodyNumbering: 'a'|'t'|'n', numberFormat: 'ln'|'rn'|'rz', numberWidth: number, separator: string }} opts
 * @returns {string}
 */
function formatNlNumberedText(text, opts) {
  const { bodyNumbering, numberFormat, numberWidth, separator } = opts;
  const lines = String(text).split('\n');
  if (lines.length === 0) return '';
  let lineNum = 0;
  const out = [];
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const isBlank = line.trim() === '';
    if (bodyNumbering === 'n') {
      out.push(line);
      continue;
    }
    if (bodyNumbering === 't' && isBlank) {
      out.push('');
      continue;
    }
    lineNum += 1;
    const numField = nlFormatNumberField(lineNum, numberWidth, numberFormat);
    out.push(`${numField}${separator}${line}`);
  }
  if (out.length === 0) return '';
  return out.join('\n') + '\n';
}

const PASTE_HELP = `Usage: paste [OPTION]... [FILE]...
Merge lines of files; write to standard output.

  -d, --delimit-list=LIST   reuse characters from LIST between columns (default TAB)
  -s, --serial              paste lines of each file one after another (one output line per FILE)
  -z, --zero-terminated     line delimiter is NUL, not newline
  -h, --help                display this help and exit
  --                        end of options

With no FILE, or when FILE is -, read standard input. Piped stdin requires stdin to be supplied (empty pipe works).

jsh:
  Parallel mode (default) merges line N from each FILE. Missing lines use empty fields. Serial mode (-s) joins all lines of each FILE with delimiters between lines, one output line per FILE.
  Symlinks are followed to a regular file. Binary files contribute a single [binary file] field.
  Not implemented vs GNU: --version, full getopt edge cases.

Full documentation: <https://www.gnu.org/software/coreutils/paste>
`;

/**
 * GNU-style option error for paste (exit status 1).
 * @param {string} arg
 * @returns {string}
 */
function pasteOptionError(arg) {
  const tryLine = "Try 'paste --help' for more information.\n";
  if (arg.startsWith('--') && arg.length > 2) {
    return `paste: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `paste: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `paste: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * Split file content into lines for paste (newline or NUL records).
 * @param {string} text
 * @param {boolean} nullTerm
 * @returns {string[]}
 */
function pasteSplitLines(text, nullTerm) {
  const s = String(text);
  if (nullTerm) {
    if (s === '') return [];
    const parts = s.split('\0');
    if (parts.length && parts[parts.length - 1] === '') parts.pop();
    return parts;
  }
  const lines = s.split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * Parallel merge: one output line per row index, columns separated by cycling delimiters.
 * @param {string[][]} columnArrays
 * @param {string} delimiterList
 * @returns {string[]}
 */
function pasteJoinParallelRows(columnArrays, delimiterList) {
  const cols = Array.isArray(columnArrays) ? columnArrays : [];
  const delim = String(delimiterList);
  const delimLen = delim.length;
  const maxR = cols.length ? Math.max(0, ...cols.map((c) => c.length)) : 0;
  const out = [];
  for (let i = 0; i < maxR; i++) {
    const row = [];
    for (let j = 0; j < cols.length; j++) {
      row.push(cols[j][i] !== undefined ? cols[j][i] : '');
    }
    let line = '';
    for (let j = 0; j < row.length; j++) {
      line += row[j];
      if (j < row.length - 1) {
        line += delimLen === 0 ? '' : delim[j % delimLen];
      }
    }
    out.push(line);
  }
  return out;
}

/**
 * Serial merge: for each file's lines, join with cycling delimiters; one output line per file.
 * @param {string[][]} filesLines
 * @param {string} delimiterList
 * @returns {string[]}
 */
function pasteJoinSerialRows(filesLines, delimiterList) {
  const files = Array.isArray(filesLines) ? filesLines : [];
  const delim = String(delimiterList);
  const delimLen = delim.length;
  const out = [];
  for (const lines of files) {
    if (lines.length === 0) {
      out.push('');
      continue;
    }
    let line = '';
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) {
        line += delimLen === 0 ? '' : delim[(i - 1) % delimLen];
      }
      line += lines[i];
    }
    out.push(line);
  }
  return out;
}

/**
 * @param {string[]} lines
 * @param {boolean} nullTerm
 * @returns {string}
 */
function pasteFormatOutputLines(lines, nullTerm) {
  const sep = nullTerm ? '\0' : '\n';
  const arr = Array.isArray(lines) ? lines : [];
  if (arr.length === 0) return '';
  return arr.join(sep) + sep;
}

/**
 * Parse jsh \`paste\` argv (GNU subset: -d -s -z, --, -h/--help).
 *
 * @param {string[]} args
 * @returns {{ ok: true, delimiterList: string, serial: boolean, nullTerminated: boolean, operands: string[], help?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parsePasteArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  let delimiterList = '\t';
  let serial = false;
  let nullTerminated = false;
  let i = 0;
  while (i < argsArr.length) {
    const arg = argsArr[i];
    if (arg === '--') {
      i++;
      break;
    }
    if (arg === '--help' || arg === '-h') {
      return { ok: true, delimiterList, serial, nullTerminated, operands: [], help: true };
    }
    if (arg === '--serial') {
      serial = true;
      i++;
      continue;
    }
    if (arg === '--zero-terminated') {
      nullTerminated = true;
      i++;
      continue;
    }
    if (arg === '--delimiter') {
      const v = argsArr[++i];
      if (v == null) {
        return {
          ok: false,
          stderr: `paste: option '--delimiter' requires an argument\nTry 'paste --help' for more information.\n`,
          exitCode: 1
        };
      }
      delimiterList = v;
      i++;
      continue;
    }
    if (arg.startsWith('--delimiter=')) {
      delimiterList = arg.slice('--delimiter='.length);
      i++;
      continue;
    }
    if (arg === '-d' || (arg.startsWith('-d') && arg.length > 2)) {
      let list;
      if (arg === '-d') {
        list = argsArr[++i];
        if (list == null) {
          return {
            ok: false,
            stderr: `paste: option requires an argument -- 'd'\nTry 'paste --help' for more information.\n`,
            exitCode: 1
          };
        }
      } else {
        list = arg.slice(2);
      }
      delimiterList = list;
      i++;
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1 && !arg.startsWith('--')) {
      let j = 1;
      while (j < arg.length) {
        const c = arg[j];
        if (c === 'd') {
          const rest = arg.slice(j + 1);
          if (rest.length > 0) {
            delimiterList = rest;
            j = arg.length;
            break;
          }
          const next = argsArr[i + 1];
          if (next == null) {
            return {
              ok: false,
              stderr: `paste: option requires an argument -- 'd'\nTry 'paste --help' for more information.\n`,
              exitCode: 1
            };
          }
          delimiterList = next;
          i++;
          j = arg.length;
          break;
        }
        if (c === 's') {
          serial = true;
          j++;
          continue;
        }
        if (c === 'z') {
          nullTerminated = true;
          j++;
          continue;
        }
        if (c === 'h') {
          return { ok: true, delimiterList, serial, nullTerminated, operands: [], help: true };
        }
        return { ok: false, stderr: pasteOptionError(`-${c}`), exitCode: 1 };
      }
      i++;
      continue;
    }
    break;
  }
  const operands = argsArr.slice(i);
  return { ok: true, delimiterList, serial, nullTerminated, operands };
}

const JOIN_HELP = `Usage: join [OPTION]... FILE1 FILE2
For each pair of input lines with identical join fields, write a line to standard output.

  -a FILENO              print unpairable lines from FILENO (1 or 2); may be repeated
  -e EMPTY               replace empty input fields with EMPTY (default empty string)
  -1 FIELD              join on FIELD of file 1 (default 1)
  -2 FIELD              join on FIELD of file 2 (default 1)
  -j FIELD              same as -1 FIELD -2 FIELD
  -t CHAR               use CHAR as the input and output field separator (default: whitespace)
  -v FILENO              like -a FILENO but do not print matched join lines; may be repeated
  -h, --help             display this help and exit
  -?                     same as --help
  --                     end of options

FILE1 and FILE2 are required. At most one operand may be - (standard input; piped stdin must be supplied).

jsh:
  Input lines must be sorted on the join field (GNU requirement); jsh does not sort or verify order.
  Matched output uses one join field, then remaining fields from FILE1, then from FILE2, separated by the same character as -t (or SPACE for whitespace fields).
  Unpairable lines (-a / -v) are printed as the original line from that file.
  Symlinks are followed to a regular file. Binary files contribute a single [binary file] field.
  Not implemented vs GNU: -o, -i, --check-order, --header, -z, --version.

Full documentation: <https://www.gnu.org/software/coreutils/join>
`;

/**
 * GNU-style option error for join (exit status 1).
 * @param {string} arg
 * @returns {string}
 */
function joinOptionError(arg) {
  const tryLine = "Try 'join --help' for more information.\n";
  if (arg.startsWith('--') && arg.length > 2) {
    return `join: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `join: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `join: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * Split a line into fields for join: whitespace mode (leading blanks ignored) or single-char delimiter.
 * @param {string} line
 * @param {string | null} delimChar null = whitespace between fields
 * @returns {string[]}
 */
function joinSplitFields(line, delimChar) {
  const s = String(line);
  if (delimChar == null) {
    const t = s.replace(/^\s+/, '');
    if (t === '') return [];
    return t.split(/\s+/);
  }
  return s.split(delimChar);
}

/**
 * Build join records: key, fields, raw line.
 * @param {string[]} lines
 * @param {number} joinField 1-based
 * @param {string | null} delimChar
 * @returns {{ key: string, fields: string[], raw: string }[]}
 */
function joinBuildRecords(lines, joinField, delimChar) {
  const jf = Math.max(1, Math.floor(Number(joinField)) || 1);
  const out = [];
  for (const line of lines) {
    const fields = joinSplitFields(line, delimChar);
    const key = fields[jf - 1] != null ? fields[jf - 1] : '';
    out.push({ key, fields, raw: line });
  }
  return out;
}

/**
 * Compare join keys (GNU strcmp-style lexicographic order for C locale; jsh uses UTF-16 unit order).
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function joinCompareKeys(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Emit one matched join line (GNU default output format).
 * @param {{ fields: string[] }} r1
 * @param {{ fields: string[] }} r2
 * @param {number} jf1
 * @param {number} jf2
 * @param {string | null} delimChar
 * @param {string} emptyStr
 * @returns {string}
 */
function joinEmitMatchedLine(r1, r2, jf1, jf2, delimChar, emptyStr) {
  const f1 = r1.fields;
  const f2 = r2.fields;
  const k = f1[jf1 - 1] != null ? f1[jf1 - 1] : '';
  const rest1 = f1.filter((_, idx) => idx !== jf1 - 1);
  const rest2 = f2.filter((_, idx) => idx !== jf2 - 1);
  const sep = delimChar == null ? ' ' : delimChar;
  const parts = [k, ...rest1, ...rest2];
  const mapped = parts.map((p) => (p === '' ? emptyStr : p));
  return mapped.join(sep);
}

/**
 * Merge-join two sorted record lists (GNU join).
 * @param {{ key: string, fields: string[], raw: string }[]} rec1
 * @param {{ key: string, fields: string[], raw: string }[]} rec2
 * @param {{ joinField1: number, joinField2: number, delimChar: string | null, a1: boolean, a2: boolean, v1: boolean, v2: boolean, emptyStr: string }} opts
 * @returns {string[]}
 */
function joinMergeRecords(rec1, rec2, opts) {
  const { joinField1, joinField2, delimChar, a1, a2, v1, v2, emptyStr } = opts;
  const jf1 = Math.max(1, Math.floor(Number(joinField1)) || 1);
  const jf2 = Math.max(1, Math.floor(Number(joinField2)) || 1);
  const emitMatched = !v1 && !v2;
  const showUnpaired1 = a1 || v1;
  const showUnpaired2 = a2 || v2;
  const out = [];
  let i = 0;
  let j = 0;
  while (i < rec1.length && j < rec2.length) {
    const k1 = rec1[i].key;
    const k2 = rec2[j].key;
    const c = joinCompareKeys(k1, k2);
    if (c < 0) {
      if (showUnpaired1) out.push(rec1[i].raw);
      i++;
    } else if (c > 0) {
      if (showUnpaired2) out.push(rec2[j].raw);
      j++;
    } else {
      const k = k1;
      const iStart = i;
      while (i < rec1.length && rec1[i].key === k) i++;
      const jStart = j;
      while (j < rec2.length && rec2[j].key === k) j++;
      if (emitMatched) {
        for (let ii = iStart; ii < i; ii++) {
          for (let jj = jStart; jj < j; jj++) {
            out.push(joinEmitMatchedLine(rec1[ii], rec2[jj], jf1, jf2, delimChar, emptyStr));
          }
        }
      }
    }
  }
  while (i < rec1.length) {
    if (showUnpaired1) out.push(rec1[i].raw);
    i++;
  }
  while (j < rec2.length) {
    if (showUnpaired2) out.push(rec2[j].raw);
    j++;
  }
  return out;
}

/**
 * Parse jsh `join` argv (GNU subset: -1 -2 -j -t -a -v -e, --, help).
 *
 * @param {string[]} args
 * @returns {{ ok: true, joinField1: number, joinField2: number, delimChar: string | null, a1: boolean, a2: boolean, v1: boolean, v2: boolean, emptyStr: string, operands: string[], help?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseJoinArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  let joinField1 = 1;
  let joinField2 = 1;
  let delimChar = null;
  let a1 = false;
  let a2 = false;
  let v1 = false;
  let v2 = false;
  let emptyStr = '';
  let i = 0;

  while (i < argsArr.length) {
    const arg = argsArr[i];
    if (arg === '--') {
      i++;
      break;
    }
    if (arg === '--help' || arg === '-h' || arg === '-?') {
      return {
        ok: true,
        joinField1,
        joinField2,
        delimChar,
        a1,
        a2,
        v1,
        v2,
        emptyStr,
        operands: [],
        help: true
      };
    }
    if (arg === '-e') {
      const v = argsArr[++i];
      if (v == null) {
        return {
          ok: false,
          stderr: `join: option '${arg}' requires an argument\nTry 'join --help' for more information.\n`,
          exitCode: 1
        };
      }
      emptyStr = v;
      i++;
      continue;
    }
    if (arg === '-j' || (arg.startsWith('-j') && arg.length > 2 && /^\d+$/.test(arg.slice(2)))) {
      let n;
      if (arg === '-j') {
        const v = argsArr[++i];
        if (v == null || !/^\d+$/.test(v)) {
          return {
            ok: false,
            stderr: `join: option requires an argument -- 'j'\nTry 'join --help' for more information.\n`,
            exitCode: 1
          };
        }
        n = parseInt(v, 10);
      } else {
        n = parseInt(arg.slice(2), 10);
      }
      if (n < 1) {
        return {
          ok: false,
          stderr: `join: invalid field number for -j\nTry 'join --help' for more information.\n`,
          exitCode: 1
        };
      }
      joinField1 = n;
      joinField2 = n;
      i++;
      continue;
    }
    if (arg === '-1' || /^-1\d+$/.test(arg)) {
      let n;
      if (/^-1\d+$/.test(arg)) {
        n = parseInt(arg.slice(2), 10);
        if (n < 1) {
          return {
            ok: false,
            stderr: `join: invalid field number for -1\nTry 'join --help' for more information.\n`,
            exitCode: 1
          };
        }
      } else {
        const v = argsArr[++i];
        if (v == null || !/^\d+$/.test(v)) {
          return {
            ok: false,
            stderr: `join: option requires an argument -- '1'\nTry 'join --help' for more information.\n`,
            exitCode: 1
          };
        }
        n = parseInt(v, 10);
        if (n < 1) {
          return {
            ok: false,
            stderr: `join: invalid field number for -1\nTry 'join --help' for more information.\n`,
            exitCode: 1
          };
        }
      }
      joinField1 = n;
      i++;
      continue;
    }
    if (arg === '-2' || /^-2\d+$/.test(arg)) {
      let n;
      if (/^-2\d+$/.test(arg)) {
        n = parseInt(arg.slice(2), 10);
        if (n < 1) {
          return {
            ok: false,
            stderr: `join: invalid field number for -2\nTry 'join --help' for more information.\n`,
            exitCode: 1
          };
        }
      } else {
        const v = argsArr[++i];
        if (v == null || !/^\d+$/.test(v)) {
          return {
            ok: false,
            stderr: `join: option requires an argument -- '2'\nTry 'join --help' for more information.\n`,
            exitCode: 1
          };
        }
        n = parseInt(v, 10);
        if (n < 1) {
          return {
            ok: false,
            stderr: `join: invalid field number for -2\nTry 'join --help' for more information.\n`,
            exitCode: 1
          };
        }
      }
      joinField2 = n;
      i++;
      continue;
    }
    if (arg === '-a' || /^-a[12]$/.test(arg)) {
      let fileno;
      if (arg === '-a') {
        const v = argsArr[++i];
        if (v !== '1' && v !== '2') {
          return {
            ok: false,
            stderr: `join: invalid file number for -a\nTry 'join --help' for more information.\n`,
            exitCode: 1
          };
        }
        fileno = v;
      } else {
        fileno = arg.slice(2);
      }
      if (fileno === '1') a1 = true;
      else a2 = true;
      i++;
      continue;
    }
    if (arg === '-v' || /^-v[12]$/.test(arg)) {
      let fileno;
      if (arg === '-v') {
        const v = argsArr[++i];
        if (v !== '1' && v !== '2') {
          return {
            ok: false,
            stderr: `join: invalid file number for -v\nTry 'join --help' for more information.\n`,
            exitCode: 1
          };
        }
        fileno = v;
      } else {
        fileno = arg.slice(2);
      }
      if (fileno === '1') v1 = true;
      else v2 = true;
      i++;
      continue;
    }
    if (arg === '-t' || (arg.startsWith('-t') && arg.length === 3)) {
      let ch;
      if (arg === '-t') {
        const v = argsArr[++i];
        if (v == null) {
          return {
            ok: false,
            stderr: `join: option requires an argument -- 't'\nTry 'join --help' for more information.\n`,
            exitCode: 1
          };
        }
        ch = v;
      } else {
        ch = arg.slice(2);
      }
      delimChar = ch === '' ? null : ch[0];
      i++;
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1 && !arg.startsWith('--')) {
      return { ok: false, stderr: joinOptionError(arg), exitCode: 1 };
    }
    break;
  }

  const operands = argsArr.slice(i);
  return {
    ok: true,
    joinField1,
    joinField2,
    delimChar,
    a1,
    a2,
    v1,
    v2,
    emptyStr,
    operands
  };
}

const EXPAND_VERSION_LINE = 'expand (jsh Heyming Terminal) 1.0\n';

const EXPAND_HELP = `Usage: expand [OPTION]... [FILE]...
Convert tabs to spaces; write to standard output.

  -i, --initial       do not convert tabs after non-blanks (GNU-style leading whitespace only)
  -t, --tabs=N        have tab stops every N columns (default ${LESS_DEFAULT_TAB_STOPS})
  -t, --tabs=LIST     comma- or blank-separated tab stop columns (0-based, like GNU; see below)
  -h, --help          display this help and exit
      --version       output version information and exit
  --                  end of options

With no FILE, or when FILE is -, read standard input. Piped stdin requires stdin to be supplied (empty pipe works).

jsh:
  Single **-t N** is uniform spacing (same model as **less -x**). **-t N,M,...** or **-t N M ...** sets explicit tab stop columns (0-based, ascending, nonzero); after the last stop, each further tab is one space (GNU-style). GNU extensions: last value may be **/N** (repeat every **N** columns from column 0 after explicit stops) or **+N** (step **N** after the last explicit stop). **/** and **+** are mutually exclusive; **-t /N** or **-t +N** alone matches uniform **-t N** (GNU **finalize_tab_stops**). One shell argument only: **expand -t 1 8** still gives **-t 1** and file **8** (GNU).
  Symlinks are followed to a regular file (like cat). Binary files show one [binary file] line. Backspace does not adjust columns (GNU does).

Full documentation: <https://www.gnu.org/software/coreutils/expand>
`;

/**
 * GNU-style option error for expand (exit status 1).
 * @param {string} arg
 * @returns {string}
 */
function expandOptionError(arg) {
  const tryLine = "Try 'expand --help' for more information.\n";
  if (arg.startsWith('--') && arg.length > 2) {
    return `expand: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `expand: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `expand: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * Single `-t` token: uniform width, or slash-N / plus-N alone (GNU finalize_tab_stops).
 * @param {string} raw
 * @param {string} tryLine
 * @returns {{ ok: true, tabSpec: { kind: 'uniform', width: number } } | { ok: false, stderr: string, exitCode: number }}
 */
function parseExpandSingleTabStopToken(raw, tryLine) {
  if (raw.startsWith('/')) {
    const num = raw.slice(1);
    if (!/^\d+$/.test(num)) {
      return {
        ok: false,
        stderr: `expand: invalid tab stop '${raw}'\n${tryLine}`,
        exitCode: 1
      };
    }
    const n = parseInt(num, 10);
    if (n < 1 || n > 256) {
      return {
        ok: false,
        stderr: `expand: tab stop width must be between 1 and 256\n${tryLine}`,
        exitCode: 1
      };
    }
    return { ok: true, tabSpec: { kind: 'uniform', width: n } };
  }
  if (raw.startsWith('+')) {
    const num = raw.slice(1);
    if (!/^\d+$/.test(num)) {
      return {
        ok: false,
        stderr: `expand: invalid tab stop '${raw}'\n${tryLine}`,
        exitCode: 1
      };
    }
    const n = parseInt(num, 10);
    if (n < 1 || n > 256) {
      return {
        ok: false,
        stderr: `expand: tab stop width must be between 1 and 256\n${tryLine}`,
        exitCode: 1
      };
    }
    return { ok: true, tabSpec: { kind: 'uniform', width: n } };
  }
  if (!/^\d+$/.test(raw)) {
    return {
      ok: false,
      stderr: `expand: invalid tab stop '${raw}'\n${tryLine}`,
      exitCode: 1
    };
  }
  const n = parseInt(raw, 10);
  if (n < 1 || n > 256) {
    return {
      ok: false,
      stderr: `expand: tab stop width must be between 1 and 256\n${tryLine}`,
      exitCode: 1
    };
  }
  return { ok: true, tabSpec: { kind: 'uniform', width: n } };
}

/**
 * Parse `-t` / `--tabs` value: uniform width, GNU slash-N or plus-N suffix on last field, or `-t /N` / `-t +N` alone (uniform).
 * Tab lists may use **commas and/or whitespace** (GNU **expand-common**), e.g. **1,8** or **1 8** in one argument.
 * @param {string} v
 * @returns {{ ok: true, tabSpec: { kind: 'uniform', width: number } | { kind: 'list', stops: number[], extendRepeat?: number, incrementStep?: number } } | { ok: false, stderr: string, exitCode: number }}
 */
function parseExpandTabStopsArg(v) {
  const raw = String(v).trim();
  const tryLine = "Try 'expand --help' for more information.\n";
  if (raw === '') {
    return {
      ok: false,
      stderr: `expand: invalid tab stop ''\n${tryLine}`,
      exitCode: 1
    };
  }

  const parts = raw.split(/[,\s]+/).filter(Boolean);
  if (parts.length === 0) {
    return {
      ok: false,
      stderr: `expand: invalid tab stop ''\n${tryLine}`,
      exitCode: 1
    };
  }
  if (parts.length === 1) {
    return parseExpandSingleTabStopToken(parts[0], tryLine);
  }
  let extendRepeat = 0;
  let incrementStep = 0;
  const stops = [];

  for (let idx = 0; idx < parts.length; idx++) {
    const orig = parts[idx];
    if (orig === '') {
      return {
        ok: false,
        stderr: `expand: invalid tab stop in list\n${tryLine}`,
        exitCode: 1
      };
    }
    const isLast = idx === parts.length - 1;
    let p = orig;
    let isExtend = false;
    let isIncrement = false;
    if (p.startsWith('/')) {
      if (!isLast) {
        return {
          ok: false,
          stderr: `expand: '/' specifier only allowed with the last value\n${tryLine}`,
          exitCode: 1
        };
      }
      isExtend = true;
      p = p.slice(1);
    } else if (p.startsWith('+')) {
      if (!isLast) {
        return {
          ok: false,
          stderr: `expand: '+' specifier only allowed with the last value\n${tryLine}`,
          exitCode: 1
        };
      }
      isIncrement = true;
      p = p.slice(1);
    }

    if (p === '' || !/^\d+$/.test(p)) {
      return {
        ok: false,
        stderr: `expand: invalid tab stop '${orig}'\n${tryLine}`,
        exitCode: 1
      };
    }
    const n = parseInt(p, 10);
    if (n < 1 || n > 256) {
      return {
        ok: false,
        stderr: `expand: tab stop must be between 1 and 256\n${tryLine}`,
        exitCode: 1
      };
    }

    if (isExtend) {
      extendRepeat = n;
      continue;
    }
    if (isIncrement) {
      incrementStep = n;
      continue;
    }
    stops.push(n);
  }

  if (extendRepeat > 0 && incrementStep > 0) {
    return {
      ok: false,
      stderr: `expand: '/' specifier is mutually exclusive with '+'\n${tryLine}`,
      exitCode: 1
    };
  }

  if (incrementStep > 0 && stops.length === 0) {
    return { ok: true, tabSpec: { kind: 'uniform', width: incrementStep } };
  }
  if (extendRepeat > 0 && stops.length === 0) {
    return { ok: true, tabSpec: { kind: 'uniform', width: extendRepeat } };
  }

  for (let i = 1; i < stops.length; i++) {
    if (stops[i] <= stops[i - 1]) {
      return {
        ok: false,
        stderr: `expand: tab sizes must be ascending\n${tryLine}`,
        exitCode: 1
      };
    }
  }

  if (extendRepeat > 0) {
    return { ok: true, tabSpec: { kind: 'list', stops, extendRepeat } };
  }
  if (incrementStep > 0) {
    return { ok: true, tabSpec: { kind: 'list', stops, incrementStep } };
  }
  return { ok: true, tabSpec: { kind: 'list', stops } };
}

/**
 * GNU **expand** / **expand-common**: next tab stop column (0-based column index of next character position).
 * @param {number} column
 * @param {{ kind: 'uniform', width: number } | { kind: 'list', stops: number[], extendRepeat?: number, incrementStep?: number }} tabSpec
 * @param {{ i: number }} tabIndexRef — list mode only; advances past skipped stops
 * @returns {number}
 */
function expandGetNextTabColumn(column, tabSpec, tabIndexRef) {
  if (tabSpec.kind === 'uniform') {
    const w = tabSpec.width;
    const rem = column % w;
    const tabDistance = w - rem;
    return column + tabDistance;
  }
  const stops = tabSpec.stops;
  const ti = tabIndexRef;
  while (ti.i < stops.length) {
    const t = stops[ti.i];
    if (column < t) {
      return t;
    }
    ti.i++;
  }
  if (tabSpec.extendRepeat != null && tabSpec.extendRepeat > 0) {
    const ext = tabSpec.extendRepeat;
    const tabDistance = ext - (column % ext);
    return column + tabDistance;
  }
  if (tabSpec.incrementStep != null && tabSpec.incrementStep > 0 && stops.length > 0) {
    const endTab = stops[stops.length - 1];
    const inc = tabSpec.incrementStep;
    const tabDistance = inc - ((column - endTab) % inc);
    return column + tabDistance;
  }
  return column + 1;
}

/**
 * Expand one tab to spaces (GNU **expand** loop).
 * @param {number} column
 * @param {{ kind: 'uniform', width: number } | { kind: 'list', stops: number[] }} tabSpec
 * @param {{ i: number }} tabIndexRef
 * @returns {{ out: string, column: number }}
 */
function expandEmitTabGnu(column, tabSpec, tabIndexRef) {
  const nextTabCol = expandGetNextTabColumn(column, tabSpec, tabIndexRef);
  let out = '';
  let col = column;
  while (++col < nextTabCol) {
    out += ' ';
  }
  out += ' ';
  return { out, column: col };
}

/**
 * GNU **expand**: full line with explicit tab stops (0-based columns).
 * @param {string} line
 * @param {{ kind: 'list', stops: number[] }} tabSpec
 * @returns {string}
 */
function expandExpandLineListGnu(line, tabSpec) {
  const tabIdx = { i: 0 };
  let col = 0;
  let out = '';
  const s = String(line);
  for (let i = 0; i < s.length; i++) {
    const ch = s.charAt(i);
    if (ch === '\t') {
      const r = expandEmitTabGnu(col, tabSpec, tabIdx);
      out += r.out;
      col = r.column;
      continue;
    }
    out += ch;
    if (ch === '\n' || ch === '\r') {
      col = 0;
      tabIdx.i = 0;
    } else {
      col += 1;
    }
  }
  return out;
}

/**
 * GNU **expand** with **-i** and explicit tab stops (leading whitespace only).
 * @param {string} line
 * @param {{ kind: 'list', stops: number[] }} tabSpec
 * @returns {string}
 */
function expandExpandLineListGnuInitial(line, tabSpec) {
  const s = String(line);
  const tabIdx = { i: 0 };
  let col = 0;
  let out = '';
  let i = 0;
  while (i < s.length) {
    const ch = s.charAt(i);
    if (ch !== '\t' && ch !== ' ') {
      break;
    }
    if (ch === '\t') {
      const r = expandEmitTabGnu(col, tabSpec, tabIdx);
      out += r.out;
      col = r.column;
      i++;
      continue;
    }
    out += ch;
    col += 1;
    i++;
  }
  return out + s.slice(i);
}

/**
 * GNU **expand**: convert tabs to spaces on one line.
 * @param {string} line
 * @param {{ kind: 'uniform', width: number } | { kind: 'list', stops: number[] }} tabSpec
 * @param {boolean} initialOnly **-i**: only tabs in leading blank run (spaces/tabs before first non-blank)
 * @returns {string}
 */
function expandExpandLine(line, tabSpec, initialOnly) {
  if (tabSpec.kind === 'list') {
    if (!initialOnly) {
      return expandExpandLineListGnu(line, tabSpec);
    }
    return expandExpandLineListGnuInitial(line, tabSpec);
  }
  const w =
    tabSpec.width == null
      ? LESS_DEFAULT_TAB_STOPS
      : Math.min(256, Math.max(1, Math.floor(Number(tabSpec.width))));
  if (!initialOnly) {
    return lessExpandTabsInLine(line, w);
  }
  const s = String(line);
  let col = 0;
  let out = '';
  let i = 0;
  while (i < s.length) {
    const ch = s.charAt(i);
    if (ch !== '\t' && ch !== ' ') {
      break;
    }
    if (ch === '\t') {
      const rem = col % w;
      const spaces = rem === 0 ? w : w - rem;
      out += ' '.repeat(spaces);
      col += spaces;
    } else {
      out += ch;
      col += 1;
    }
    i++;
  }
  return out + s.slice(i);
}

/**
 * @param {string} text
 * @param {{ kind: 'uniform', width: number } | { kind: 'list', stops: number[] }} tabSpec
 * @param {boolean} initialOnly
 * @returns {string}
 */
function expandExpandText(text, tabSpec, initialOnly) {
  return String(text)
    .split('\n')
    .map((line) => expandExpandLine(line, tabSpec, initialOnly))
    .join('\n');
}

/**
 * Parse jsh `expand` argv (GNU subset: -i, -t, --, --help, --version).
 *
 * @param {string[]} args
 * @returns {{ ok: true, tabSpec: { kind: 'uniform', width: number } | { kind: 'list', stops: number[], extendRepeat?: number, incrementStep?: number }, initialOnly: boolean, operands: string[], help?: true, version?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseExpandArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  let tabSpec =
    /** @type {{ kind: 'uniform', width: number } | { kind: 'list', stops: number[] }} */ ({
      kind: 'uniform',
      width: LESS_DEFAULT_TAB_STOPS
    });
  let initialOnly = false;
  let i = 0;
  while (i < argsArr.length) {
    const arg = argsArr[i];
    if (arg === '--') {
      i++;
      break;
    }
    if (arg === '--help' || arg === '-h') {
      return { ok: true, tabSpec, initialOnly, operands: [], help: true };
    }
    if (arg === '--version') {
      return { ok: true, tabSpec, initialOnly, operands: [], version: true };
    }
    if (arg === '-i' || arg === '--initial') {
      initialOnly = true;
      i++;
      continue;
    }
    if (arg === '--tabs') {
      const v = argsArr[++i];
      if (v == null) {
        return {
          ok: false,
          stderr: `expand: option '--tabs' requires an argument\nTry 'expand --help' for more information.\n`,
          exitCode: 1
        };
      }
      const p = parseExpandTabStopsArg(v);
      if (!p.ok) {
        return p;
      }
      tabSpec = p.tabSpec;
      i++;
      continue;
    }
    if (arg.startsWith('--tabs=')) {
      const v = arg.slice('--tabs='.length);
      const p = parseExpandTabStopsArg(v);
      if (!p.ok) {
        return p;
      }
      tabSpec = p.tabSpec;
      i++;
      continue;
    }
    if (arg === '-t') {
      const v = argsArr[++i];
      if (v == null) {
        return {
          ok: false,
          stderr: `expand: option requires an argument -- 't'\nTry 'expand --help' for more information.\n`,
          exitCode: 1
        };
      }
      const p = parseExpandTabStopsArg(v);
      if (!p.ok) {
        return p;
      }
      tabSpec = p.tabSpec;
      i++;
      continue;
    }
    if (arg.startsWith('-t') && arg.length > 2) {
      const v = arg.slice(2);
      const p = parseExpandTabStopsArg(v);
      if (!p.ok) {
        return p;
      }
      tabSpec = p.tabSpec;
      i++;
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1 && !arg.startsWith('--')) {
      let j = 1;
      while (j < arg.length) {
        const c = arg[j];
        if (c === 'i') {
          initialOnly = true;
          j++;
          continue;
        }
        if (c === 'h') {
          return { ok: true, tabSpec, initialOnly, operands: [], help: true };
        }
        if (c === 't') {
          const rest = arg.slice(j + 1);
          if (rest.length >= 1) {
            const p = parseExpandTabStopsArg(rest);
            if (!p.ok) {
              return p;
            }
            tabSpec = p.tabSpec;
            j = arg.length;
            break;
          }
          const next = argsArr[i + 1];
          if (next == null) {
            return {
              ok: false,
              stderr: `expand: option requires an argument -- 't'\nTry 'expand --help' for more information.\n`,
              exitCode: 1
            };
          }
          const p = parseExpandTabStopsArg(next);
          if (!p.ok) {
            return p;
          }
          tabSpec = p.tabSpec;
          i++;
          j = arg.length;
          break;
        }
        return { ok: false, stderr: expandOptionError(`-${c}`), exitCode: 1 };
      }
      i++;
      continue;
    }
    break;
  }
  const operands = argsArr.slice(i);
  return { ok: true, tabSpec, initialOnly, operands };
}

/** GNU **fold** default wrap width (columns or bytes). */
const FOLD_DEFAULT_WIDTH = 80;

const FOLD_VERSION_LINE = 'fold (jsh Heyming Terminal) 1.0\n';

const FOLD_HELP = `Usage: fold [OPTION]... [FILE]...
Wrap each input line to fit in WIDTH columns (or bytes); write to standard output.

With no FILE, or when FILE is -, read standard input.

  -b, --bytes         count bytes rather than columns (UTF-8)
  -s, --spaces        break at spaces (GNU-style)
  -w, --width=WIDTH   use WIDTH columns instead of 80 (also: -w WIDTH)
  -h, --help          display this help and exit
      --version       output version information and exit
  --                  end of options

jsh:
  Column mode counts Unicode code points (not full POSIX locale width). Byte mode (-b) splits UTF-8 octets and may break inside multibyte characters (GNU-style). Piped stdin requires stdin to be supplied (empty pipe works). Symlinks are followed to a regular file (like expand). Binary files show one [binary file] line.

Full documentation: <https://www.gnu.org/software/coreutils/fold>
`;

/**
 * GNU-style option error for fold (exit status 1).
 * @param {string} arg
 * @returns {string}
 */
function foldOptionError(arg) {
  const tryLine = "Try 'fold --help' for more information.\n";
  if (arg.startsWith('--') && arg.length > 2) {
    return `fold: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `fold: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `fold: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * @param {string} v
 * @returns {{ ok: true, width: number } | { ok: false, stderr: string, exitCode: number }}
 */
function parseFoldWidthValue(v) {
  const s = String(v);
  if (!/^\d+$/.test(s)) {
    return {
      ok: false,
      stderr: `fold: invalid number of columns: '${s}'\nTry 'fold --help' for more information.\n`,
      exitCode: 1
    };
  }
  const n = parseInt(s, 10);
  if (n < 1) {
    return {
      ok: false,
      stderr: `fold: column number must be a positive integer\nTry 'fold --help' for more information.\n`,
      exitCode: 1
    };
  }
  if (n > 1000000) {
    return {
      ok: false,
      stderr: `fold: column width too large\nTry 'fold --help' for more information.\n`,
      exitCode: 1
    };
  }
  return { ok: true, width: n };
}

/**
 * Fold one logical line (no embedded newline) using Unicode code points.
 * @param {string} line
 * @param {number} width
 * @param {boolean} breakAtSpaces **-s**
 * @returns {string}
 */
function foldFoldLineChars(line, width, breakAtSpaces) {
  const w = width > 0 ? width : FOLD_DEFAULT_WIDTH;
  const chars = Array.from(line);
  if (chars.length === 0) {
    return '';
  }
  if (!breakAtSpaces) {
    const parts = [];
    for (let i = 0; i < chars.length; i += w) {
      parts.push(chars.slice(i, i + w).join(''));
    }
    return parts.join('\n');
  }
  const parts = [];
  let start = 0;
  while (start < chars.length) {
    if (chars.length - start <= w) {
      parts.push(chars.slice(start).join(''));
      break;
    }
    const slice = chars.slice(start, start + w);
    const s = slice.join('');
    const lastSpace = s.lastIndexOf(' ');
    if (lastSpace > 0) {
      parts.push(chars.slice(start, start + lastSpace).join(''));
      start += lastSpace + 1;
      continue;
    }
    if (lastSpace === 0) {
      parts.push(' ');
      start += 1;
      continue;
    }
    parts.push(chars.slice(start, start + w).join(''));
    start += w;
  }
  return parts.join('\n');
}

/**
 * Fold one logical line in UTF-8 byte mode.
 * @param {string} line
 * @param {number} width
 * @param {boolean} breakAtSpaces **-s**
 * @returns {string}
 */
function foldFoldLineBytes(line, width, breakAtSpaces) {
  const w = width > 0 ? width : FOLD_DEFAULT_WIDTH;
  const enc = new TextEncoder();
  const bytes = enc.encode(line);
  const dec = new TextDecoder('utf-8', { fatal: false });
  if (bytes.length === 0) {
    return '';
  }
  if (!breakAtSpaces) {
    const parts = [];
    for (let i = 0; i < bytes.length; i += w) {
      parts.push(dec.decode(bytes.slice(i, i + w)));
    }
    return parts.join('\n');
  }
  const parts = [];
  let start = 0;
  while (start < bytes.length) {
    if (bytes.length - start <= w) {
      parts.push(dec.decode(bytes.slice(start)));
      break;
    }
    const chunk = bytes.slice(start, start + w);
    let lastSpace = -1;
    for (let j = chunk.length - 1; j >= 0; j--) {
      if (chunk[j] === 0x20) {
        lastSpace = j;
        break;
      }
    }
    if (lastSpace > 0) {
      parts.push(dec.decode(bytes.slice(start, start + lastSpace)));
      start += lastSpace + 1;
      continue;
    }
    if (lastSpace === 0) {
      parts.push(' ');
      start += 1;
      continue;
    }
    parts.push(dec.decode(bytes.slice(start, start + w)));
    start += w;
  }
  return parts.join('\n');
}

/**
 * @param {string} text
 * @param {number} width
 * @param {boolean} bytesMode **-b**
 * @param {boolean} breakAtSpaces **-s**
 * @returns {string}
 */
function foldFoldText(text, width, bytesMode, breakAtSpaces) {
  const w = width > 0 ? width : FOLD_DEFAULT_WIDTH;
  const foldLine = bytesMode ? foldFoldLineBytes : foldFoldLineChars;
  return String(text)
    .split('\n')
    .map((line) => foldLine(line, w, breakAtSpaces))
    .join('\n');
}

/**
 * Parse jsh `fold` argv (GNU subset: -b, -s, -w, --, --help, --version).
 *
 * @param {string[]} args
 * @returns {{ ok: true, width: number, bytesMode: boolean, breakAtSpaces: boolean, operands: string[], help?: true, version?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseFoldArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  let width = FOLD_DEFAULT_WIDTH;
  let bytesMode = false;
  let breakAtSpaces = false;
  let i = 0;
  while (i < argsArr.length) {
    const arg = argsArr[i];
    if (arg === '--') {
      i++;
      break;
    }
    if (arg === '--help' || arg === '-h' || arg === '-?') {
      return { ok: true, width, bytesMode, breakAtSpaces, operands: [], help: true };
    }
    if (arg === '--version') {
      return { ok: true, width, bytesMode, breakAtSpaces, operands: [], version: true };
    }
    if (arg === '-b' || arg === '--bytes') {
      bytesMode = true;
      i++;
      continue;
    }
    if (arg === '-s' || arg === '--spaces') {
      breakAtSpaces = true;
      i++;
      continue;
    }
    if (arg === '-w' || arg === '--width') {
      const v = argsArr[++i];
      if (v == null) {
        return {
          ok: false,
          stderr: `fold: option requires an argument -- 'width'\nTry 'fold --help' for more information.\n`,
          exitCode: 1
        };
      }
      const p = parseFoldWidthValue(v);
      if (!p.ok) {
        return p;
      }
      width = p.width;
      i++;
      continue;
    }
    if (arg.startsWith('--width=')) {
      const v = arg.slice('--width='.length);
      const p = parseFoldWidthValue(v);
      if (!p.ok) {
        return p;
      }
      width = p.width;
      i++;
      continue;
    }
    if (arg.startsWith('-w') && arg.length > 2) {
      const v = arg.slice(2);
      const p = parseFoldWidthValue(v);
      if (!p.ok) {
        return p;
      }
      width = p.width;
      i++;
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1 && !arg.startsWith('--')) {
      let j = 1;
      while (j < arg.length) {
        const c = arg[j];
        if (c === 'b') {
          bytesMode = true;
          j++;
          continue;
        }
        if (c === 's') {
          breakAtSpaces = true;
          j++;
          continue;
        }
        if (c === 'h' || c === '?') {
          return { ok: true, width, bytesMode, breakAtSpaces, operands: [], help: true };
        }
        if (c === 'w') {
          const rest = arg.slice(j + 1);
          if (rest.length >= 1) {
            const p = parseFoldWidthValue(rest);
            if (!p.ok) {
              return p;
            }
            width = p.width;
            j = arg.length;
            break;
          }
          const next = argsArr[i + 1];
          if (next == null) {
            return {
              ok: false,
              stderr: `fold: option requires an argument -- 'w'\nTry 'fold --help' for more information.\n`,
              exitCode: 1
            };
          }
          const p = parseFoldWidthValue(next);
          if (!p.ok) {
            return p;
          }
          width = p.width;
          i++;
          j = arg.length;
          break;
        }
        return { ok: false, stderr: foldOptionError(`-${c}`), exitCode: 1 };
      }
      i++;
      continue;
    }
    break;
  }
  const operands = argsArr.slice(i);
  return { ok: true, width, bytesMode, breakAtSpaces, operands };
}

/** GNU **fmt** default width (columns). */
const FMT_DEFAULT_WIDTH = 75;

const FMT_VERSION_LINE = 'fmt (jsh Heyming Terminal) 1.0\n';

const FMT_HELP = `Usage: fmt [OPTION]... [FILE]...
Reformat paragraphs from each FILE; write to standard output.

With no FILE, or when FILE is -, read standard input.

  -c, --crown-margin  first output line uses the first input line's indent; continuations use the second line's indent (GNU -c)
  -p, --prefix=STRING reformat only lines beginning with STRING (after optional leading spaces); reattach prefix to output lines (GNU -p)
  -s, --split-only    split long lines only; do not join short input lines
  -t, --tagged-paragraph  indentation of first line differs from second (GNU -t); with -s, same as -c per line
  -u, --uniform-spacing   one space between words (GNU -u; default uses two spaces after .?! like GNU without -u)
  -w, --width=WIDTH   maximum line width (default ${FMT_DEFAULT_WIDTH})
  -g, --goal=WIDTH    goal width (default ${FMT_DEFAULT_WIDTH}×187/200, GNU LEEWAY 7); if only **-g** is given, maximum width becomes goal+10
  -h, --help          display this help and exit
      --version       output version information and exit
  --                  end of options

jsh:
  Paragraphs are separated by blank lines; within a paragraph, non-empty lines are merged (whitespace-separated) then word-wrapped. Unicode width counts code points (not full POSIX locale width). Piped stdin requires stdin to be supplied (empty pipe works). Symlinks are followed to a regular file (like fold). Binary files show one [binary file] line.

  **-g (goal width):** plain merge mode uses a GNU-like cost-based line fill (short lines vs raggedness) toward **goal**; **-c**/**-t**/**-p** still use greedy wrap with a proportional inner goal (full GNU crown/tagged DP not implemented).

  **-c (crown margin):** lines after the second must share the **same leading space count** as the second line (GNU paragraph rules); otherwise a new paragraph starts. **-s -c:** each non-empty line is wrapped with its own leading indent preserved (plain **-s** still trims indents in jsh).

  **-t (tagged paragraph):** when the first two lines of a paragraph have **different** leading space counts, behavior matches **-c** for that paragraph. When they are **equal** and there are multiple lines, each input line is formatted as its own paragraph (GNU: no merge). A **single** tagged paragraph line uses first-line indent then **no** indent on wrapped continuations (GNU; differs from **-c** single-line wrap).

  **-p (prefix):** only lines matching optional leading spaces + PREFIX are reformatted; other lines pass through. Consecutive matching lines with the **same** prefix column merge unless **-s** (split-only). With **-c**/**-t**, prefix is stripped and inner text is formatted with an effective width of WIDTH minus the prefix length.

  **Tabs:** input **TAB** characters are expanded to spaces at **${LESS_DEFAULT_TAB_STOPS}**-column stops (same as **less -x** / **expand -t8**) before line wrapping and indent detection; output lines use spaces only. Not full GNU fmt: sentence punctuation costs / widow-orphan bonuses from GNU **fmt** are not modeled; **-c**/**-t** goal is approximate.

Full documentation: <https://www.gnu.org/software/coreutils/fmt>
`;

/**
 * GNU-style option error for fmt (exit status 1).
 * @param {string} arg
 * @returns {string}
 */
function fmtOptionError(arg) {
  const tryLine = "Try 'fmt --help' for more information.\n";
  if (arg.startsWith('--') && arg.length > 2) {
    return `fmt: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `fmt: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `fmt: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * @param {string} v
 * @returns {{ ok: true, width: number } | { ok: false, stderr: string, exitCode: number }}
 */
function parseFmtWidthValue(v) {
  const s = String(v);
  if (!/^\d+$/.test(s)) {
    return {
      ok: false,
      stderr: `fmt: invalid width: '${s}'\nTry 'fmt --help' for more information.\n`,
      exitCode: 1
    };
  }
  const n = parseInt(s, 10);
  if (n < 1) {
    return {
      ok: false,
      stderr: `fmt: width must be positive\nTry 'fmt --help' for more information.\n`,
      exitCode: 1
    };
  }
  if (n > 1000000) {
    return {
      ok: false,
      stderr: `fmt: width too large\nTry 'fmt --help' for more information.\n`,
      exitCode: 1
    };
  }
  return { ok: true, width: n };
}

/** GNU **fmt** LEEWAY 7 → default goal = max_width × (2×(100−7)+1) / 200. */
const FMT_FMT_GOAL_NUMERATOR = 187;
const FMT_FMT_GOAL_DENOMINATOR = 200;

/**
 * Default goal width for **fmt** (GNU **coreutils** with LEEWAY 7).
 * @param {number} maxWidth
 * @returns {number}
 */
function fmtFmtDefaultGoal(maxWidth) {
  const w = maxWidth > 0 ? maxWidth : FMT_DEFAULT_WIDTH;
  return Math.max(
    1,
    Math.min(w, Math.floor((w * FMT_FMT_GOAL_NUMERATOR) / FMT_FMT_GOAL_DENOMINATOR))
  );
}

/**
 * Scale outer **goal** to an inner width when prefix/crown reduces the fill column.
 * @param {number} outerWidth
 * @param {number} innerWidth
 * @param {number} outerGoal
 * @returns {number}
 */
function fmtInnerGoal(outerWidth, innerWidth, outerGoal) {
  const ow = outerWidth > 0 ? outerWidth : FMT_DEFAULT_WIDTH;
  const iw = Math.max(1, innerWidth);
  const g = Math.max(1, Math.min(outerGoal, ow));
  return Math.max(1, Math.min(iw, Math.floor((g * iw) / ow)));
}

/**
 * @param {string} v
 * @param {number} maxWidth inclusive upper bound for goal
 * @returns {{ ok: true, goal: number } | { ok: false, stderr: string, exitCode: number }}
 */
function parseFmtGoalValue(v, maxWidth) {
  const p = parseFmtWidthValue(v);
  if (!p.ok) {
    return p;
  }
  if (p.width > maxWidth) {
    return {
      ok: false,
      stderr: `fmt: goal width greater than maximum width\nTry 'fmt --help' for more information.\n`,
      exitCode: 1
    };
  }
  return { ok: true, goal: p.width };
}

/**
 * @param {string} s
 * @returns {number}
 */
function fmtLen(s) {
  return Array.from(String(s)).length;
}

/**
 * Count leading space characters. **fmtFmtText** expands tabs to spaces first (see **lessExpandTabsInText**), so paragraph logic sees space-only indents.
 * @param {string} line
 * @returns {number}
 */
function fmtLeadingSpaceCount(line) {
  let n = 0;
  for (const ch of String(line)) {
    if (ch !== ' ') break;
    n++;
  }
  return n;
}

/**
 * @param {string} s
 * @returns {string}
 */
function fmtPrefixEscapeForRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * GNU **fmt** **-p**: line begins with optional leading spaces + PREFIX; remainder is **rest**.
 * @param {string} line
 * @param {string} prefix
 * @returns {{ prefixPart: string, rest: string } | null}
 */
function fmtPrefixMatchLine(line, prefix) {
  const p = String(prefix);
  if (p === '') {
    return null;
  }
  const re = new RegExp(`^(\\s*)(${fmtPrefixEscapeForRegex(p)})(.*)$`);
  const m = String(line).match(re);
  if (!m) {
    return null;
  }
  return { prefixPart: m[1] + m[2], rest: m[3] };
}

/**
 * @param {string} text
 * @param {number} width
 * @param {boolean} splitOnly
 * @param {boolean} uniformSpacing
 * @param {boolean} crownMargin
 * @param {boolean} taggedParagraph
 * @param {string} prefix
 * @param {number} [goal]
 * @returns {string}
 */
function fmtFmtTextWithPrefix(
  text,
  width,
  splitOnly,
  uniformSpacing,
  crownMargin,
  taggedParagraph,
  prefix,
  goal
) {
  const outerW = width > 0 ? width : FMT_DEFAULT_WIDTH;
  const outerGoal = goal !== undefined ? goal : fmtFmtDefaultGoal(outerW);
  const raw = String(text);
  const hadTrailingNewline = raw.endsWith('\n');
  const rawLines = raw.split('\n');
  const outBlocks = [];
  let i = 0;
  while (i < rawLines.length) {
    const line = rawLines[i];
    if (line === '') {
      outBlocks.push('');
      i++;
      continue;
    }
    const m = fmtPrefixMatchLine(line, prefix);
    if (!m) {
      outBlocks.push(line);
      i++;
      continue;
    }
    if (splitOnly) {
      const gap = m.rest.startsWith(' ') ? 1 : 0;
      const innerW = Math.max(1, width - fmtLen(m.prefixPart) - gap);
      const innerGoal = fmtInnerGoal(outerW, innerW, outerGoal);
      const innerOut = fmtFmtText(
        m.rest,
        innerW,
        true,
        uniformSpacing,
        crownMargin,
        taggedParagraph,
        null,
        innerGoal
      );
      const lines = innerOut.split('\n');
      const leadAfterPrefix = gap ? ' ' : '';
      outBlocks.push(lines.map((l) => m.prefixPart + leadAfterPrefix + l).join('\n'));
      i++;
      continue;
    }
    const paraPrefix = m.prefixPart;
    const restLines = [m.rest];
    i++;
    while (i < rawLines.length && rawLines[i] !== '') {
      const m2 = fmtPrefixMatchLine(rawLines[i], prefix);
      if (!m2 || m2.prefixPart !== paraPrefix) {
        break;
      }
      restLines.push(m2.rest);
      i++;
    }
    const gap = restLines[0].startsWith(' ') ? 1 : 0;
    const innerW = Math.max(1, width - fmtLen(paraPrefix) - gap);
    const innerGoal = fmtInnerGoal(outerW, innerW, outerGoal);
    let innerOut;
    if (crownMargin || taggedParagraph) {
      innerOut = fmtFmtText(
        restLines.join('\n'),
        innerW,
        false,
        uniformSpacing,
        crownMargin,
        taggedParagraph,
        null,
        innerGoal
      );
    } else {
      const words = [];
      for (const r of restLines) {
        words.push(...r.trim().split(/\s+/).filter(Boolean));
      }
      innerOut = fmtWrapWords(words, innerW, uniformSpacing, innerGoal);
    }
    const mergedLines = innerOut.split('\n');
    const leadAfterPrefix = gap ? ' ' : '';
    outBlocks.push(mergedLines.map((l) => paraPrefix + leadAfterPrefix + l).join('\n'));
  }
  let body = outBlocks.join('\n');
  if (hadTrailingNewline) {
    if (body !== '' && !body.endsWith('\n')) {
      return `${body}\n`;
    }
    return body;
  }
  return body.replace(/\n$/, '');
}

/**
 * @param {string} word
 * @param {number} width
 * @returns {string[]}
 */
function fmtBreakLongWord(word, width) {
  const chars = Array.from(word);
  const lines = [];
  const w = width > 0 ? width : FMT_DEFAULT_WIDTH;
  for (let i = 0; i < chars.length; i += w) {
    lines.push(chars.slice(i, i + w).join(''));
  }
  return lines;
}

/**
 * @param {string} prevWord
 * @param {boolean} uniformSpacing
 * @returns {number}
 */
function fmtInterWordSepWidth(prevWord, uniformSpacing) {
  if (uniformSpacing) {
    return 1;
  }
  return /[.!?]$/.test(prevWord) ? 2 : 1;
}

/**
 * Split overlong words into chunks ≤ **maxLen** (same as greedy **fmt**).
 * @param {string[]} words
 * @param {number} maxLen
 * @returns {string[]}
 */
function fmtExplodeWordsForMaxWidth(words, maxLen) {
  const out = [];
  const w = maxLen > 0 ? maxLen : FMT_DEFAULT_WIDTH;
  for (const word of words) {
    if (fmtLen(word) <= w) {
      out.push(word);
    } else {
      out.push(...fmtBreakLongWord(word, w));
    }
  }
  return out;
}

/**
 * Greedy word-wrap (GNU **fmt** without goal optimization).
 * @param {string[]} words
 * @param {number} width
 * @param {boolean} uniformSpacing
 * @returns {string}
 */
function fmtWrapWordsGreedy(words, width, uniformSpacing) {
  if (words.length === 0) {
    return '';
  }
  const w = width > 0 ? width : FMT_DEFAULT_WIDTH;
  const outLines = [];
  let line = '';
  let prevWord = '';
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    let sep = '';
    if (line !== '') {
      sep = ' '.repeat(fmtInterWordSepWidth(prevWord, uniformSpacing));
    }
    const candidate = line + sep + word;
    if (fmtLen(candidate) <= w) {
      line = candidate;
      prevWord = word;
      continue;
    }
    if (line) {
      outLines.push(line);
      line = '';
    }
    if (fmtLen(word) <= w) {
      line = word;
      prevWord = word;
      continue;
    }
    const chunks = fmtBreakLongWord(word, w);
    for (let k = 0; k < chunks.length - 1; k++) {
      outLines.push(chunks[k]);
    }
    line = chunks[chunks.length - 1];
    prevWord = word;
  }
  if (line) {
    outLines.push(line);
  }
  return outLines.join('\n');
}

/**
 * GNU **fmt**-style backward DP (simplified **line_cost** / **RAGGED_COST**; no **base_cost** punctuation).
 * @param {string[]} words
 * @param {number} maxWidth
 * @param {boolean} uniformSpacing
 * @param {number} goalWidth
 * @returns {string}
 */
function fmtWrapWordsDp(words, maxWidth, uniformSpacing, goalWidth) {
  const maxLen = maxWidth > 0 ? maxWidth : FMT_DEFAULT_WIDTH;
  const goal = Math.max(1, Math.min(goalWidth, maxLen));
  const wordsExp = fmtExplodeWordsForMaxWidth(words, maxLen);
  const n = wordsExp.length;
  if (n === 0) {
    return '';
  }

  function lineLenRange(i, j) {
    let len = fmtLen(wordsExp[i]);
    for (let k = i + 1; k < j; k++) {
      len += fmtInterWordSepWidth(wordsExp[k - 1], uniformSpacing) + fmtLen(wordsExp[k]);
    }
    return len;
  }

  function lineCost(len, nextIsEnd) {
    if (nextIsEnd) {
      return 0;
    }
    const d = goal - len;
    return d * d * 100;
  }

  function raggedCost(len, nextLen) {
    const d = len - nextLen;
    return (d * d * 100) / 2;
  }

  const bestCost = new Array(n + 1);
  const nextBreak = new Array(n);
  const lineLenAt = new Array(n);
  bestCost[n] = 0;

  for (let i = n - 1; i >= 0; i--) {
    let best = Infinity;
    let bestJ = n;
    let bestLenLine = 0;
    for (let j = i + 1; j <= n; j++) {
      const len = lineLenRange(i, j);
      if (len > maxLen) {
        break;
      }
      const nextIsEnd = j === n;
      let wc = lineCost(len, nextIsEnd) + bestCost[j];
      if (!nextIsEnd) {
        wc += raggedCost(len, lineLenAt[j]);
      }
      if (wc < best) {
        best = wc;
        bestJ = j;
        bestLenLine = len;
      }
    }
    bestCost[i] = best;
    nextBreak[i] = bestJ;
    lineLenAt[i] = bestLenLine;
  }

  const outLines = [];
  let idx = 0;
  while (idx < n) {
    const nb = nextBreak[idx];
    let line = wordsExp[idx];
    for (let k = idx + 1; k < nb; k++) {
      const sep = ' '.repeat(fmtInterWordSepWidth(wordsExp[k - 1], uniformSpacing));
      line += sep + wordsExp[k];
    }
    outLines.push(line);
    idx = nb;
  }
  return outLines.join('\n');
}

/**
 * Word-wrap words to width; **uniformSpacing** uses single spaces; otherwise two spaces after sentence-ending punctuation (GNU-style) before the next word.
 * With **goalWidth** &lt; **width**, uses a GNU-like DP toward the goal (plain merge mode).
 * @param {string[]} words
 * @param {number} width
 * @param {boolean} uniformSpacing
 * @param {number} [goalWidth]
 * @returns {string}
 */
function fmtWrapWords(words, width, uniformSpacing, goalWidth) {
  if (words.length === 0) {
    return '';
  }
  const w = width > 0 ? width : FMT_DEFAULT_WIDTH;
  const g = goalWidth !== undefined ? goalWidth : fmtFmtDefaultGoal(w);
  if (g >= w) {
    return fmtWrapWordsGreedy(words, w, uniformSpacing);
  }
  return fmtWrapWordsDp(words, w, uniformSpacing, g);
}

/**
 * Word-wrap with a crown margin: first line uses **indent1** spaces, later lines **indent2** (GNU **-c** subset).
 * @param {string[]} words
 * @param {number} width
 * @param {boolean} uniformSpacing
 * @param {number} indent1
 * @param {number} indent2
 * @returns {string}
 */
function fmtWrapWordsCrown(words, width, uniformSpacing, indent1, indent2) {
  if (words.length === 0) {
    return '';
  }
  const w = width > 0 ? width : FMT_DEFAULT_WIDTH;
  const p1 = Math.max(0, Math.min(indent1, w));
  const p2 = Math.max(0, Math.min(indent2, w));
  let maxLen = Math.max(1, w - p1);
  const maxLater = Math.max(1, w - p2);
  const outLines = [];
  let line = '';
  let prevWord = '';
  let isFirstLine = true;

  function flushLine() {
    if (!line) {
      return;
    }
    outLines.push(`${' '.repeat(isFirstLine ? p1 : p2)}${line}`);
    line = '';
    isFirstLine = false;
    maxLen = maxLater;
  }

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    let sep = '';
    if (line !== '') {
      if (uniformSpacing) {
        sep = ' ';
      } else {
        sep = /[.!?]$/.test(prevWord) ? '  ' : ' ';
      }
    }
    const candidate = line + sep + word;
    if (fmtLen(candidate) <= maxLen) {
      line = candidate;
      prevWord = word;
      continue;
    }
    if (line) {
      flushLine();
      i--;
      continue;
    }
    if (fmtLen(word) <= maxLen) {
      line = word;
      prevWord = word;
      continue;
    }
    const chunks = fmtBreakLongWord(word, maxLen);
    for (let k = 0; k < chunks.length - 1; k++) {
      outLines.push(`${' '.repeat(isFirstLine ? p1 : p2)}${chunks[k]}`);
      isFirstLine = false;
      maxLen = maxLater;
    }
    line = chunks[chunks.length - 1];
    prevWord = word;
  }
  flushLine();
  return outLines.join('\n');
}

/**
 * @param {string} text
 * @param {number} width
 * @param {boolean} splitOnly
 * @param {boolean} uniformSpacing
 * @param {boolean} [crownMargin=false]
 * @param {boolean} [taggedParagraph=false]
 * @param {string | null} [prefix=null]
 * @param {number} [goal]
 * @returns {string}
 */
function fmtFmtText(
  text,
  width,
  splitOnly,
  uniformSpacing,
  crownMargin = false,
  taggedParagraph = false,
  prefix = null,
  goal = undefined
) {
  const w = width > 0 ? width : FMT_DEFAULT_WIDTH;
  const resolvedGoal = goal !== undefined ? goal : fmtFmtDefaultGoal(w);
  const expandedInput = lessExpandTabsInText(String(text), LESS_DEFAULT_TAB_STOPS);
  if (prefix != null && prefix !== '') {
    return fmtFmtTextWithPrefix(
      expandedInput,
      width,
      splitOnly,
      uniformSpacing,
      crownMargin,
      taggedParagraph,
      prefix,
      resolvedGoal
    );
  }
  const raw = expandedInput;
  const hadTrailingNewline = raw.endsWith('\n');
  let body;
  if (splitOnly) {
    const rawLines = raw.split('\n');
    const out = [];
    for (const ln of rawLines) {
      if (ln.trim() === '') {
        out.push('');
        continue;
      }
      const words = ln.trim().split(/\s+/).filter(Boolean);
      const indent = fmtLeadingSpaceCount(ln);
      if (crownMargin || taggedParagraph) {
        out.push(fmtWrapWordsCrown(words, width, uniformSpacing, indent, indent));
      } else {
        out.push(fmtWrapWords(words, width, uniformSpacing, resolvedGoal));
      }
    }
    body = out.join('\n');
  } else {
    const rawLines = raw.split('\n');
    const blocks = [];
    let i = 0;
    while (i < rawLines.length) {
      if (rawLines[i] === '') {
        blocks.push({ type: 'blank' });
        i++;
        continue;
      }
      if (crownMargin) {
        const L1 = rawLines[i];
        i++;
        if (i >= rawLines.length || rawLines[i] === '') {
          blocks.push({ type: 'para', lines: [L1] });
          continue;
        }
        const L2 = rawLines[i];
        i++;
        const bodyIndent = fmtLeadingSpaceCount(L2);
        const paraLines = [L1, L2];
        while (i < rawLines.length && rawLines[i] !== '') {
          if (fmtLeadingSpaceCount(rawLines[i]) !== bodyIndent) {
            break;
          }
          paraLines.push(rawLines[i]);
          i++;
        }
        blocks.push({ type: 'para', lines: paraLines });
        continue;
      }
      if (taggedParagraph) {
        const L1 = rawLines[i];
        i++;
        if (i >= rawLines.length || rawLines[i] === '') {
          blocks.push({ type: 'para', lines: [L1], taggedSingle: true });
          continue;
        }
        const L2 = rawLines[i];
        if (fmtLeadingSpaceCount(L1) !== fmtLeadingSpaceCount(L2)) {
          i++;
          const bodyIndent = fmtLeadingSpaceCount(L2);
          const paraLines = [L1, L2];
          while (i < rawLines.length && rawLines[i] !== '') {
            if (fmtLeadingSpaceCount(rawLines[i]) !== bodyIndent) {
              break;
            }
            paraLines.push(rawLines[i]);
            i++;
          }
          blocks.push({ type: 'para', lines: paraLines, taggedMerge: true });
          continue;
        }
        blocks.push({ type: 'para', lines: [L1], taggedSingle: true });
        continue;
      }
      const paraLines = [];
      while (i < rawLines.length && rawLines[i] !== '') {
        paraLines.push(rawLines[i]);
        i++;
      }
      blocks.push({ type: 'para', lines: paraLines });
    }
    const outParts = [];
    for (const b of blocks) {
      if (b.type === 'blank') {
        outParts.push('');
      } else {
        const words = [];
        for (const pl of b.lines) {
          words.push(...pl.trim().split(/\s+/).filter(Boolean));
        }
        const indent1 = fmtLeadingSpaceCount(b.lines[0]);
        const indent2 = b.lines.length > 1 ? fmtLeadingSpaceCount(b.lines[1]) : indent1;
        if (crownMargin) {
          outParts.push(fmtWrapWordsCrown(words, width, uniformSpacing, indent1, indent2));
        } else if (taggedParagraph) {
          if (b.taggedMerge) {
            outParts.push(fmtWrapWordsCrown(words, width, uniformSpacing, indent1, indent2));
          } else {
            outParts.push(fmtWrapWordsCrown(words, width, uniformSpacing, indent1, 0));
          }
        } else {
          outParts.push(fmtWrapWords(words, width, uniformSpacing, resolvedGoal));
        }
      }
    }
    body = outParts.join('\n');
  }
  if (hadTrailingNewline) {
    if (body !== '' && !body.endsWith('\n')) {
      return `${body}\n`;
    }
    return body;
  }
  return body.replace(/\n$/, '');
}

/**
 * Parse jsh `fmt` argv (GNU subset: -c, -p, -s, -t, -u, -w, -g, --, --help, --version).
 *
 * @param {string[]} args
 * @returns {{ ok: true, width: number, goal: number, splitOnly: boolean, uniformSpacing: boolean, crownMargin: boolean, taggedParagraph: boolean, prefix: string | null, operands: string[], help?: true, version?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseFmtArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  let width = FMT_DEFAULT_WIDTH;
  let widthFromOption = false;
  /** @type {string | null} */
  let goalStr = null;
  let splitOnly = false;
  let uniformSpacing = false;
  let crownMargin = false;
  let taggedParagraph = false;
  let prefix = null;
  let i = 0;
  while (i < argsArr.length) {
    const arg = argsArr[i];
    if (arg === '--') {
      i++;
      break;
    }
    if (arg === '--help' || arg === '-h' || arg === '-?') {
      return {
        ok: true,
        width,
        goal: fmtFmtDefaultGoal(width),
        splitOnly,
        uniformSpacing,
        crownMargin,
        taggedParagraph,
        prefix,
        operands: [],
        help: true
      };
    }
    if (arg === '--version') {
      return {
        ok: true,
        width,
        goal: fmtFmtDefaultGoal(width),
        splitOnly,
        uniformSpacing,
        crownMargin,
        taggedParagraph,
        prefix,
        operands: [],
        version: true
      };
    }
    if (arg === '-c' || arg === '--crown-margin') {
      crownMargin = true;
      i++;
      continue;
    }
    if (arg === '-t' || arg === '--tagged-paragraph') {
      taggedParagraph = true;
      i++;
      continue;
    }
    if (arg === '-s' || arg === '--split-only') {
      splitOnly = true;
      i++;
      continue;
    }
    if (arg === '-u' || arg === '--uniform-spacing') {
      uniformSpacing = true;
      i++;
      continue;
    }
    if (arg === '-p' || arg === '--prefix') {
      const v = argsArr[++i];
      if (v == null) {
        return {
          ok: false,
          stderr: `fmt: option requires an argument -- 'prefix'\nTry 'fmt --help' for more information.\n`,
          exitCode: 1
        };
      }
      prefix = v;
      i++;
      continue;
    }
    if (arg.startsWith('--prefix=')) {
      prefix = arg.slice('--prefix='.length);
      i++;
      continue;
    }
    if (arg === '-w' || arg === '--width') {
      const v = argsArr[++i];
      if (v == null) {
        return {
          ok: false,
          stderr: `fmt: option requires an argument -- 'width'\nTry 'fmt --help' for more information.\n`,
          exitCode: 1
        };
      }
      const p = parseFmtWidthValue(v);
      if (!p.ok) {
        return p;
      }
      width = p.width;
      widthFromOption = true;
      i++;
      continue;
    }
    if (arg.startsWith('--width=')) {
      const v = arg.slice('--width='.length);
      const p = parseFmtWidthValue(v);
      if (!p.ok) {
        return p;
      }
      width = p.width;
      widthFromOption = true;
      i++;
      continue;
    }
    if (arg.startsWith('-w') && arg.length > 2) {
      const v = arg.slice(2);
      const p = parseFmtWidthValue(v);
      if (!p.ok) {
        return p;
      }
      width = p.width;
      widthFromOption = true;
      i++;
      continue;
    }
    if (arg === '-g' || arg === '--goal') {
      const v = argsArr[++i];
      if (v == null) {
        return {
          ok: false,
          stderr: `fmt: option requires an argument -- 'goal'\nTry 'fmt --help' for more information.\n`,
          exitCode: 1
        };
      }
      goalStr = v;
      i++;
      continue;
    }
    if (arg.startsWith('--goal=')) {
      goalStr = arg.slice('--goal='.length);
      i++;
      continue;
    }
    if (arg.startsWith('-g') && arg.length > 2) {
      goalStr = arg.slice(2);
      i++;
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1 && !arg.startsWith('--')) {
      let j = 1;
      while (j < arg.length) {
        const c = arg[j];
        if (c === 'c') {
          crownMargin = true;
          j++;
          continue;
        }
        if (c === 's') {
          splitOnly = true;
          j++;
          continue;
        }
        if (c === 'u') {
          uniformSpacing = true;
          j++;
          continue;
        }
        if (c === 't') {
          taggedParagraph = true;
          j++;
          continue;
        }
        if (c === 'p') {
          const rest = arg.slice(j + 1);
          if (rest.length >= 1) {
            prefix = rest;
            j = arg.length;
            break;
          }
          const next = argsArr[i + 1];
          if (next == null) {
            return {
              ok: false,
              stderr: `fmt: option requires an argument -- 'p'\nTry 'fmt --help' for more information.\n`,
              exitCode: 1
            };
          }
          prefix = next;
          i++;
          j = arg.length;
          break;
        }
        if (c === 'h' || c === '?') {
          return {
            ok: true,
            width,
            goal: fmtFmtDefaultGoal(width),
            splitOnly,
            uniformSpacing,
            crownMargin,
            taggedParagraph,
            prefix,
            operands: [],
            help: true
          };
        }
        if (c === 'w') {
          const rest = arg.slice(j + 1);
          if (rest.length >= 1) {
            const p = parseFmtWidthValue(rest);
            if (!p.ok) {
              return p;
            }
            width = p.width;
            widthFromOption = true;
            j = arg.length;
            break;
          }
          const next = argsArr[i + 1];
          if (next == null) {
            return {
              ok: false,
              stderr: `fmt: option requires an argument -- 'w'\nTry 'fmt --help' for more information.\n`,
              exitCode: 1
            };
          }
          const p = parseFmtWidthValue(next);
          if (!p.ok) {
            return p;
          }
          width = p.width;
          widthFromOption = true;
          i++;
          j = arg.length;
          break;
        }
        if (c === 'g') {
          const rest = arg.slice(j + 1);
          if (rest.length >= 1) {
            goalStr = rest;
            j = arg.length;
            break;
          }
          const next = argsArr[i + 1];
          if (next == null) {
            return {
              ok: false,
              stderr: `fmt: option requires an argument -- 'g'\nTry 'fmt --help' for more information.\n`,
              exitCode: 1
            };
          }
          goalStr = next;
          i++;
          j = arg.length;
          break;
        }
        return { ok: false, stderr: fmtOptionError(`-${c}`), exitCode: 1 };
      }
      i++;
      continue;
    }
    break;
  }
  const operands = argsArr.slice(i);
  let goal;
  if (goalStr != null) {
    const maxForGoal = widthFromOption ? width : FMT_DEFAULT_WIDTH;
    const pg = parseFmtGoalValue(goalStr, maxForGoal);
    if (!pg.ok) {
      return pg;
    }
    goal = pg.goal;
    if (!widthFromOption) {
      width = goal + 10;
    }
  } else {
    goal = fmtFmtDefaultGoal(width);
  }
  return {
    ok: true,
    width,
    goal,
    splitOnly,
    uniformSpacing,
    crownMargin,
    taggedParagraph,
    prefix,
    operands
  };
}

const SPLIT_VERSION_LINE = 'split (jsh Heyming Terminal) 1.0\n';

const SPLIT_HELP = `Usage: split [OPTION]... [INPUT [PREFIX]]
Output fixed-size pieces of INPUT to PREFIXaa, PREFIXab, ...; default PREFIX is 'x'.

With no INPUT, or when INPUT is -, read standard input. Output files are created in
the current working directory using PREFIX + suffix (same path rules as other jsh commands).

  -l, --lines=NUMBER  put NUMBER lines per output file (default 1000)
  -b, --bytes=SIZE    put SIZE bytes per output file (suffix: b=512, k/K=1024, KB=1000, M/MB, …)
  -a, --suffix-length=N   generate suffixes of length N (default 2)
      --additional-suffix=SUFFIX  append SUFFIX after the generated suffix
  -d, --numeric-suffixes  use numeric suffixes (00, 01, …) instead of alphabetic
  -x, --hex-suffixes    use hex suffixes instead of alphabetic
  -h, --help            display this help and exit
      --version         output version information and exit
  --                    end of options

jsh:
  Line mode is the default (1000 lines per chunk unless -l is set). -b and -l are mutually exclusive.
  Piped stdin requires stdin to be supplied (empty pipe works). Symlinks are followed to a regular file.
  Binary files split by newline bytes in line mode; byte mode uses raw file bytes.
  Not implemented vs GNU: -C/--line-bytes, --filter, -n, numeric suffix FROM, verbose, or full SIZE parsing.

Full documentation: <https://www.gnu.org/software/coreutils/split>
`;

/**
 * GNU-style option error for split (exit status 1).
 * @param {string} arg
 * @returns {string}
 */
function splitOptionError(arg) {
  const tryLine = "Try 'split --help' for more information.\n";
  if (arg.startsWith('--') && arg.length > 2) {
    return `split: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `split: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `split: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * Split text into lines, each element is a line segment including its trailing \\n when present.
 * @param {string} text
 * @returns {string[]}
 */
function splitLinesWithSeparators(text) {
  const t = String(text);
  const lines = [];
  let start = 0;
  for (let i = 0; i < t.length; i++) {
    if (t.charCodeAt(i) === 10) {
      lines.push(t.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < t.length) {
    lines.push(t.slice(start));
  }
  return lines;
}

/**
 * Split UTF-8 bytes into lines (newline = 0x0a); each segment includes trailing \\n when present.
 * @param {Uint8Array} u8
 * @returns {Uint8Array[]}
 */
function splitLinesBytes(u8) {
  const lines = [];
  let start = 0;
  for (let i = 0; i < u8.length; i++) {
    if (u8[i] === 0x0a) {
      lines.push(u8.subarray(start, i + 1));
      start = i + 1;
    }
  }
  if (start < u8.length) {
    lines.push(u8.subarray(start));
  }
  return lines;
}

/**
 * @param {number} index
 * @param {number} width
 * @returns {string|null}
 */
function splitAlphabeticSuffix(index, width) {
  const w = width > 0 ? width : 2;
  let n = index;
  const chars = new Array(w);
  for (let i = w - 1; i >= 0; i--) {
    chars[i] = String.fromCharCode(97 + (n % 26));
    n = Math.floor(n / 26);
  }
  if (n > 0) {
    return null;
  }
  return chars.join('');
}

/**
 * @param {number} index
 * @param {'digit'|'hex'} mode
 * @param {number} width
 * @returns {string|null}
 */
function splitNumericOrHexSuffix(index, mode, width) {
  const w = width > 0 ? width : 2;
  const base = mode === 'hex' ? 16 : 10;
  const max = Math.pow(base, w);
  if (index < 0 || index >= max) {
    return null;
  }
  const s = index.toString(base);
  return s.padStart(w, '0');
}

/**
 * @param {number} index
 * @param {{ suffixMode: 'alpha'|'digit'|'hex', suffixWidth: number }} cfg
 * @returns {string|null}
 */
function splitGenerateSuffix(index, cfg) {
  const { suffixMode, suffixWidth } = cfg;
  if (suffixMode === 'alpha') {
    return splitAlphabeticSuffix(index, suffixWidth);
  }
  return splitNumericOrHexSuffix(index, suffixMode === 'hex' ? 'hex' : 'digit', suffixWidth);
}

/**
 * Max output file index (inclusive) for suffix config.
 * @param {{ suffixMode: 'alpha'|'digit'|'hex', suffixWidth: number }} cfg
 * @returns {number}
 */
function splitMaxSuffixIndex(cfg) {
  const w = cfg.suffixWidth > 0 ? cfg.suffixWidth : 2;
  if (cfg.suffixMode === 'alpha') {
    return Math.pow(26, w) - 1;
  }
  if (cfg.suffixMode === 'hex') {
    return Math.pow(16, w) - 1;
  }
  return Math.pow(10, w) - 1;
}

/**
 * Parse GNU-style SIZE for **split -b** (subset: digits + b/k/K/M/G/T + KB/MB decimal SI).
 * @param {string} raw
 * @returns {{ ok: true, bytes: number } | { ok: false, stderr: string, exitCode: number }}
 */
function parseSplitByteSize(raw) {
  const s = String(raw).trim();
  if (!s) {
    return {
      ok: false,
      stderr: `split: invalid byte count: '${raw}'\nTry 'split --help' for more information.\n`,
      exitCode: 1
    };
  }
  const m = /^(\d+)([a-zA-Z]*)$/.exec(s);
  if (!m) {
    return {
      ok: false,
      stderr: `split: invalid byte count: '${s}'\nTry 'split --help' for more information.\n`,
      exitCode: 1
    };
  }
  let n = parseInt(m[1], 10);
  const suf = m[2] || '';
  if (!suf) {
    if (n < 1) {
      return {
        ok: false,
        stderr: `split: invalid byte count: '${s}'\nTry 'split --help' for more information.\n`,
        exitCode: 1
      };
    }
    return { ok: true, bytes: n };
  }
  const sl = suf.toLowerCase();
  if (suf.length === 1 && sl === 'b') {
    n *= 512;
  } else if (sl === 'k' || sl === 'kb' || sl === 'kib') {
    n *= 1024;
  } else if (sl === 'm' || sl === 'mb' || sl === 'mib') {
    n *= 1024 * 1024;
  } else if (sl === 'g' || sl === 'gb' || sl === 'gib') {
    n *= 1024 * 1024 * 1024;
  } else if (sl === 't' || sl === 'tb' || sl === 'tib') {
    n *= Math.pow(1024, 4);
  } else if (sl === 'p' || sl === 'pb' || sl === 'pib') {
    n *= Math.pow(1024, 5);
  } else if (sl === 'e' || sl === 'eb' || sl === 'eib') {
    n *= Math.pow(1024, 6);
  } else if (suf === 'KB' || suf === 'kB') {
    n *= 1000;
  } else if (suf === 'MB' || suf === 'mB') {
    n *= 1000 * 1000;
  } else if (suf === 'GB' || suf === 'gB') {
    n *= 1000 * 1000 * 1000;
  } else {
    return {
      ok: false,
      stderr: `split: invalid byte count: '${s}'\nTry 'split --help' for more information.\n`,
      exitCode: 1
    };
  }
  if (n < 1 || !Number.isFinite(n)) {
    return {
      ok: false,
      stderr: `split: invalid byte count: '${s}'\nTry 'split --help' for more information.\n`,
      exitCode: 1
    };
  }
  return { ok: true, bytes: n };
}

/**
 * Parse jsh `split` argv (GNU subset).
 *
 * @param {string[]} args
 * @returns {{ ok: true, byteMode: boolean, linesPerChunk: number, bytesPerChunk: number, suffixWidth: number, additionalSuffix: string, suffixMode: 'alpha'|'digit'|'hex', operands: string[], help?: true, version?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseSplitArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  let byteMode = false;
  let linesPerChunk = 1000;
  let bytesPerChunk = 0;
  let suffixWidth = 2;
  let additionalSuffix = '';
  /** @type {'alpha'|'digit'|'hex'} */
  let suffixMode = 'alpha';
  let linesOptionSeen = false;
  let bytesOptionSeen = false;
  let i = 0;
  while (i < argsArr.length) {
    const arg = argsArr[i];
    if (arg === '--') {
      i++;
      break;
    }
    if (arg === '--help' || arg === '-h' || arg === '-?') {
      return {
        ok: true,
        byteMode,
        linesPerChunk,
        bytesPerChunk,
        suffixWidth,
        additionalSuffix,
        suffixMode,
        operands: [],
        help: true
      };
    }
    if (arg === '--version') {
      return {
        ok: true,
        byteMode,
        linesPerChunk,
        bytesPerChunk,
        suffixWidth,
        additionalSuffix,
        suffixMode,
        operands: [],
        version: true
      };
    }
    if (arg === '-l' || arg === '--lines') {
      const v = argsArr[++i];
      if (v == null) {
        return {
          ok: false,
          stderr: `split: option requires an argument -- 'lines'\nTry 'split --help' for more information.\n`,
          exitCode: 1
        };
      }
      if (!/^\d+$/.test(v)) {
        return {
          ok: false,
          stderr: `split: invalid number of lines: '${v}'\nTry 'split --help' for more information.\n`,
          exitCode: 1
        };
      }
      const n = parseInt(v, 10);
      if (n < 1) {
        return {
          ok: false,
          stderr: `split: invalid number of lines: '${v}'\nTry 'split --help' for more information.\n`,
          exitCode: 1
        };
      }
      linesPerChunk = n;
      linesOptionSeen = true;
      byteMode = false;
      i++;
      continue;
    }
    if (arg.startsWith('--lines=')) {
      const v = arg.slice('--lines='.length);
      if (!/^\d+$/.test(v)) {
        return {
          ok: false,
          stderr: `split: invalid number of lines: '${v}'\nTry 'split --help' for more information.\n`,
          exitCode: 1
        };
      }
      const n = parseInt(v, 10);
      if (n < 1) {
        return {
          ok: false,
          stderr: `split: invalid number of lines: '${v}'\nTry 'split --help' for more information.\n`,
          exitCode: 1
        };
      }
      linesPerChunk = n;
      linesOptionSeen = true;
      byteMode = false;
      i++;
      continue;
    }
    if (arg === '-b' || arg === '--bytes') {
      const v = argsArr[++i];
      if (v == null) {
        return {
          ok: false,
          stderr: `split: option requires an argument -- 'bytes'\nTry 'split --help' for more information.\n`,
          exitCode: 1
        };
      }
      const p = parseSplitByteSize(v);
      if (!p.ok) {
        return p;
      }
      bytesPerChunk = p.bytes;
      bytesOptionSeen = true;
      byteMode = true;
      i++;
      continue;
    }
    if (arg.startsWith('--bytes=')) {
      const v = arg.slice('--bytes='.length);
      const p = parseSplitByteSize(v);
      if (!p.ok) {
        return p;
      }
      bytesPerChunk = p.bytes;
      bytesOptionSeen = true;
      byteMode = true;
      i++;
      continue;
    }
    if (arg === '-a' || arg === '--suffix-length') {
      const v = argsArr[++i];
      if (v == null) {
        return {
          ok: false,
          stderr: `split: option requires an argument -- 'suffix-length'\nTry 'split --help' for more information.\n`,
          exitCode: 1
        };
      }
      if (!/^\d+$/.test(v)) {
        return {
          ok: false,
          stderr: `split: invalid suffix length: '${v}'\nTry 'split --help' for more information.\n`,
          exitCode: 1
        };
      }
      const n = parseInt(v, 10);
      if (n < 1 || n > 64) {
        return {
          ok: false,
          stderr: `split: invalid suffix length: '${v}'\nTry 'split --help' for more information.\n`,
          exitCode: 1
        };
      }
      suffixWidth = n;
      i++;
      continue;
    }
    if (arg.startsWith('--suffix-length=')) {
      const v = arg.slice('--suffix-length='.length);
      if (!/^\d+$/.test(v)) {
        return {
          ok: false,
          stderr: `split: invalid suffix length: '${v}'\nTry 'split --help' for more information.\n`,
          exitCode: 1
        };
      }
      const n = parseInt(v, 10);
      if (n < 1 || n > 64) {
        return {
          ok: false,
          stderr: `split: invalid suffix length: '${v}'\nTry 'split --help' for more information.\n`,
          exitCode: 1
        };
      }
      suffixWidth = n;
      i++;
      continue;
    }
    if (arg.startsWith('--additional-suffix=')) {
      additionalSuffix = arg.slice('--additional-suffix='.length);
      i++;
      continue;
    }
    if (arg === '--additional-suffix') {
      const v = argsArr[++i];
      if (v == null) {
        return {
          ok: false,
          stderr: `split: option '--additional-suffix' requires an argument\nTry 'split --help' for more information.\n`,
          exitCode: 1
        };
      }
      additionalSuffix = v;
      i++;
      continue;
    }
    if (arg === '-d' || arg === '--numeric-suffixes') {
      suffixMode = 'digit';
      i++;
      continue;
    }
    if (arg === '-x' || arg === '--hex-suffixes') {
      suffixMode = 'hex';
      i++;
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1 && !arg.startsWith('--')) {
      let j = 1;
      while (j < arg.length) {
        const c = arg[j];
        if (c === 'l') {
          const rest = arg.slice(j + 1);
          if (rest.length >= 1 && /^\d+$/.test(rest)) {
            const n = parseInt(rest, 10);
            if (n < 1) {
              return {
                ok: false,
                stderr: `split: invalid number of lines: '${rest}'\nTry 'split --help' for more information.\n`,
                exitCode: 1
              };
            }
            linesPerChunk = n;
            linesOptionSeen = true;
            byteMode = false;
            j = arg.length;
            break;
          }
          const next = argsArr[i + 1];
          if (next == null) {
            return {
              ok: false,
              stderr: `split: option requires an argument -- 'l'\nTry 'split --help' for more information.\n`,
              exitCode: 1
            };
          }
          if (!/^\d+$/.test(next)) {
            return {
              ok: false,
              stderr: `split: invalid number of lines: '${next}'\nTry 'split --help' for more information.\n`,
              exitCode: 1
            };
          }
          const n = parseInt(next, 10);
          if (n < 1) {
            return {
              ok: false,
              stderr: `split: invalid number of lines: '${next}'\nTry 'split --help' for more information.\n`,
              exitCode: 1
            };
          }
          linesPerChunk = n;
          linesOptionSeen = true;
          byteMode = false;
          i++;
          j = arg.length;
          break;
        }
        if (c === 'b') {
          const rest = arg.slice(j + 1);
          if (rest.length >= 1) {
            const p = parseSplitByteSize(rest);
            if (!p.ok) {
              return p;
            }
            bytesPerChunk = p.bytes;
            bytesOptionSeen = true;
            byteMode = true;
            j = arg.length;
            break;
          }
          const next = argsArr[i + 1];
          if (next == null) {
            return {
              ok: false,
              stderr: `split: option requires an argument -- 'b'\nTry 'split --help' for more information.\n`,
              exitCode: 1
            };
          }
          const p = parseSplitByteSize(next);
          if (!p.ok) {
            return p;
          }
          bytesPerChunk = p.bytes;
          bytesOptionSeen = true;
          byteMode = true;
          i++;
          j = arg.length;
          break;
        }
        if (c === 'a') {
          const rest = arg.slice(j + 1);
          if (rest.length >= 1 && /^\d+$/.test(rest)) {
            const n = parseInt(rest, 10);
            if (n < 1 || n > 64) {
              return {
                ok: false,
                stderr: `split: invalid suffix length: '${rest}'\nTry 'split --help' for more information.\n`,
                exitCode: 1
              };
            }
            suffixWidth = n;
            j = arg.length;
            break;
          }
          const next = argsArr[i + 1];
          if (next == null) {
            return {
              ok: false,
              stderr: `split: option requires an argument -- 'a'\nTry 'split --help' for more information.\n`,
              exitCode: 1
            };
          }
          if (!/^\d+$/.test(next)) {
            return {
              ok: false,
              stderr: `split: invalid suffix length: '${next}'\nTry 'split --help' for more information.\n`,
              exitCode: 1
            };
          }
          const n = parseInt(next, 10);
          if (n < 1 || n > 64) {
            return {
              ok: false,
              stderr: `split: invalid suffix length: '${next}'\nTry 'split --help' for more information.\n`,
              exitCode: 1
            };
          }
          suffixWidth = n;
          i++;
          j = arg.length;
          break;
        }
        if (c === 'd') {
          suffixMode = 'digit';
          j++;
          continue;
        }
        if (c === 'x') {
          suffixMode = 'hex';
          j++;
          continue;
        }
        return { ok: false, stderr: splitOptionError(`-${c}`), exitCode: 1 };
      }
      i++;
      continue;
    }
    if (arg.startsWith('--') && arg.length > 2) {
      return { ok: false, stderr: splitOptionError(arg), exitCode: 1 };
    }
    break;
  }
  const operands = argsArr.slice(i);
  if (linesOptionSeen && bytesOptionSeen) {
    return {
      ok: false,
      stderr: `split: cannot split in more than one way\nTry 'split --help' for more information.\n`,
      exitCode: 1
    };
  }
  return {
    ok: true,
    byteMode,
    linesPerChunk,
    bytesPerChunk,
    suffixWidth,
    additionalSuffix,
    suffixMode,
    operands
  };
}

const CSPLIT_VERSION_LINE = 'csplit (jsh Heyming Terminal) 1.0\n';

const CSPLIT_HELP = `Usage: csplit [OPTION]... FILE PATTERN...
Split FILE into pieces at line boundaries defined by PATTERN(s), writing PREFIX00, PREFIX01, ...
(default PREFIX is 'xx').

  -f, --prefix=PREFIX   use PREFIX instead of 'xx'
  -n, --digits=N        use N digits in output file suffix (default 2)
  -k, --keep-files      do not remove output files on error
  -s, --silent          do not print byte counts of created files
  -q                    same as -s
  -z, --elide-empty-files  omit empty output files (and their size lines)
  -h, --help            display this help and exit
      --version         output version information and exit
  --                    end of options

PATTERN may be:
  N           split before line N (line numbers are 1-based from the start of the file)
  /STRING/    split after the next line containing STRING (literal substring in jsh)
  %STRING%    skip lines until a line contains STRING (no output for the skipped part)
  {COUNT}     repeat the preceding pattern COUNT times

jsh:
  Reads stdin when FILE is '-' and stdin is supplied. Symlinks are followed to a regular file.
  Patterns use literal substring matching (not POSIX regex). Empty /STRING/ matches every line.
  Binary files split on newline bytes; matching uses UTF-8 decoding per line (invalid bytes may match oddly).
  Not implemented vs GNU: -b/--suffix-format, offsets after patterns, regexp syntax, or full error cleanup.

Full documentation: <https://www.gnu.org/software/coreutils/csplit>
`;

/**
 * @param {string} arg
 * @returns {string}
 */
function csplitOptionError(arg) {
  const tryLine = "Try 'csplit --help' for more information.\n";
  if (arg.startsWith('--') && arg.length > 2) {
    return `csplit: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `csplit: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `csplit: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * Parse /.../ or %...% with \\ escapes for the closing delimiter.
 * @param {string} token
 * @param {'/'|'%'} delim
 * @returns {{ ok: true, pat: string } | { ok: false, stderr: string, exitCode: number }}
 */
function parseCsplitDelimitedPattern(token, delim) {
  const s = String(token);
  if (s.length < 2 || s[0] !== delim) {
    return { ok: false, stderr: `csplit: invalid pattern: '${token}'\n`, exitCode: 1 };
  }
  let buf = '';
  let i = 1;
  while (i < s.length) {
    if (s[i] === '\\' && i + 1 < s.length) {
      buf += s[i + 1];
      i += 2;
      continue;
    }
    if (s[i] === delim) {
      return { ok: true, pat: buf };
    }
    buf += s[i];
    i++;
  }
  return { ok: false, stderr: `csplit: invalid pattern: '${token}'\n`, exitCode: 1 };
}

/**
 * @param {string} token
 * @returns {{ ok: true, atom: { type: 'line', n: number } | { type: 'regex', pat: string, skip: boolean } } | { ok: false, stderr: string, exitCode: number }}
 */
function parseCsplitPatternToken(token) {
  const t = String(token);
  if (/^\d+$/.test(t)) {
    const n = parseInt(t, 10);
    if (n < 1) {
      return { ok: false, stderr: `csplit: invalid line number: '${t}'\n`, exitCode: 1 };
    }
    return { ok: true, atom: { type: 'line', n } };
  }
  if (t[0] === '/') {
    const p = parseCsplitDelimitedPattern(t, '/');
    if (!p.ok) {
      return p;
    }
    return { ok: true, atom: { type: 'regex', pat: p.pat, skip: false } };
  }
  if (t[0] === '%') {
    const p = parseCsplitDelimitedPattern(t, '%');
    if (!p.ok) {
      return p;
    }
    return { ok: true, atom: { type: 'regex', pat: p.pat, skip: true } };
  }
  return { ok: false, stderr: `csplit: invalid pattern: '${t}'\n`, exitCode: 1 };
}

/**
 * @param {string[]} patternTokens
 * @returns {{ ok: true, atoms: object[] } | { ok: false, stderr: string, exitCode: number }}
 */
function expandCsplitPatternTokens(patternTokens) {
  const argsArr = Array.isArray(patternTokens) ? patternTokens : [];
  /** @type {{ type: 'line', n: number } | { type: 'regex', pat: string, skip: boolean }[]} */
  const atoms = [];
  for (let i = 0; i < argsArr.length; i++) {
    const t = argsArr[i];
    const rep = /^\{(\d+)\}$/.exec(t);
    if (rep) {
      const count = parseInt(rep[1], 10);
      if (count < 1) {
        return {
          ok: false,
          stderr: `csplit: invalid repeat count: '${t}'\nTry 'csplit --help' for more information.\n`,
          exitCode: 1
        };
      }
      if (atoms.length === 0) {
        return {
          ok: false,
          stderr: "csplit: '{': no such pattern\nTry 'csplit --help' for more information.\n",
          exitCode: 1
        };
      }
      const last = atoms.pop();
      for (let k = 0; k < count; k++) {
        atoms.push(
          last.type === 'line'
            ? { type: 'line', n: last.n }
            : { type: 'regex', pat: last.pat, skip: last.skip }
        );
      }
      continue;
    }
    const p = parseCsplitPatternToken(t);
    if (!p.ok) {
      return p;
    }
    atoms.push(p.atom);
  }
  return { ok: true, atoms };
}

/**
 * @param {string[]} lines — from splitLinesWithSeparators
 * @param {{ type: 'line', n: number } | { type: 'regex', pat: string, skip: boolean }[]} atoms
 * @returns {{ ok: true, pieces: string[], sizes: number[] } | { ok: false, stderr: string, exitCode: number }}
 */
function csplitComputeTextPieces(lines, atoms) {
  const pieces = [];
  let cur = 0;
  const nLines = lines.length;
  for (const atom of atoms) {
    if (atom.type === 'line') {
      const N = atom.n;
      if (cur > N - 1) {
        return { ok: false, stderr: `csplit: line number out of range\n`, exitCode: 1 };
      }
      pieces.push(lines.slice(cur, N - 1).join(''));
      cur = N - 1;
    } else if (atom.skip) {
      let j = cur;
      while (j < nLines) {
        const line = lines[j];
        const body = line.endsWith('\n') ? line.slice(0, -1) : line;
        if (body.includes(atom.pat)) {
          break;
        }
        j++;
      }
      if (j >= nLines) {
        const wrap = atom.pat.indexOf('\n') >= 0 ? '\n' : '';
        return {
          ok: false,
          stderr: `csplit: *: '%${atom.pat.replace(/\n/g, '\\n')}${wrap}%': match not found\n`,
          exitCode: 1
        };
      }
      cur = j + 1;
    } else {
      let j = cur;
      while (j < nLines) {
        const line = lines[j];
        const body = line.endsWith('\n') ? line.slice(0, -1) : line;
        if (body.includes(atom.pat)) {
          break;
        }
        j++;
      }
      if (j >= nLines) {
        const wrap = atom.pat.indexOf('\n') >= 0 ? '\n' : '';
        return {
          ok: false,
          stderr: `csplit: *: '/${atom.pat.replace(/\n/g, '\\n')}${wrap}/': match not found\n`,
          exitCode: 1
        };
      }
      pieces.push(lines.slice(cur, j + 1).join(''));
      cur = j + 1;
    }
  }
  if (cur < nLines) {
    pieces.push(lines.slice(cur).join(''));
  }
  const sizes = pieces.map((p) => new TextEncoder().encode(p).length);
  return { ok: true, pieces, sizes };
}

/**
 * @param {Uint8Array[]} lineParts
 * @param {{ type: 'line', n: number } | { type: 'regex', pat: string, skip: boolean }[]} atoms
 * @returns {{ ok: true, pieces: Uint8Array[], sizes: number[] } | { ok: false, stderr: string, exitCode: number }}
 */
function csplitComputeBinaryPieces(lineParts, atoms) {
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const pieces = [];
  let cur = 0;
  const nLines = lineParts.length;
  for (const atom of atoms) {
    if (atom.type === 'line') {
      const N = atom.n;
      if (cur > N - 1) {
        return { ok: false, stderr: `csplit: line number out of range\n`, exitCode: 1 };
      }
      pieces.push(csplitConcatUint8LineRange(lineParts, cur, N - 1));
      cur = N - 1;
    } else if (atom.skip) {
      let j = cur;
      while (j < nLines) {
        const u8 = lineParts[j];
        const lineStr = decoder.decode(u8);
        const body = lineStr.endsWith('\n') ? lineStr.slice(0, -1) : lineStr;
        if (body.includes(atom.pat)) {
          break;
        }
        j++;
      }
      if (j >= nLines) {
        return {
          ok: false,
          stderr: `csplit: *: '%${atom.pat}%': match not found\n`,
          exitCode: 1
        };
      }
      cur = j + 1;
    } else {
      let j = cur;
      while (j < nLines) {
        const u8 = lineParts[j];
        const lineStr = decoder.decode(u8);
        const body = lineStr.endsWith('\n') ? lineStr.slice(0, -1) : lineStr;
        if (body.includes(atom.pat)) {
          break;
        }
        j++;
      }
      if (j >= nLines) {
        return {
          ok: false,
          stderr: `csplit: *: '/${atom.pat}/': match not found\n`,
          exitCode: 1
        };
      }
      pieces.push(csplitConcatUint8LineRange(lineParts, cur, j + 1));
      cur = j + 1;
    }
  }
  if (cur < nLines) {
    pieces.push(csplitConcatUint8LineRange(lineParts, cur, nLines));
  }
  const sizes = pieces.map((p) => p.length);
  return { ok: true, pieces, sizes };
}

/**
 * @param {Uint8Array[]} lineParts
 * @param {number} start inclusive
 * @param {number} end exclusive
 */
function csplitConcatUint8LineRange(lineParts, start, end) {
  let total = 0;
  for (let i = start; i < end; i++) {
    total += lineParts[i].length;
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (let i = start; i < end; i++) {
    out.set(lineParts[i], o);
    o += lineParts[i].length;
  }
  return out;
}

/**
 * @param {number[]} sizes
 * @param {boolean} silent
 * @returns {string}
 */
function csplitFormatStdoutSizes(sizes, silent) {
  if (silent) {
    return '';
  }
  let s = '';
  for (const n of sizes) {
    s += `${String(n).padStart(6, ' ')}\n`;
  }
  return s;
}

/**
 * Parse jsh `csplit` argv (GNU subset).
 *
 * @param {string[]} args
 * @returns {{ ok: true, prefix: string, digits: number, silent: boolean, keepFiles: boolean, elideEmpty: boolean, operands: string[], help?: true, version?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseCsplitArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  let prefix = 'xx';
  let digits = 2;
  let silent = false;
  let keepFiles = false;
  let elideEmpty = false;
  let i = 0;
  while (i < argsArr.length) {
    const arg = argsArr[i];
    if (arg === '--') {
      i++;
      break;
    }
    if (arg === '--help' || arg === '-h' || arg === '-?') {
      return {
        ok: true,
        prefix,
        digits,
        silent,
        keepFiles,
        elideEmpty,
        operands: [],
        help: true
      };
    }
    if (arg === '--version') {
      return {
        ok: true,
        prefix,
        digits,
        silent,
        keepFiles,
        elideEmpty,
        operands: [],
        version: true
      };
    }
    if (arg === '--silent') {
      silent = true;
      i++;
      continue;
    }
    if (arg === '--keep-files') {
      keepFiles = true;
      i++;
      continue;
    }
    if (arg === '--elide-empty-files') {
      elideEmpty = true;
      i++;
      continue;
    }
    if (arg === '-f' || arg === '--prefix') {
      const v = argsArr[++i];
      if (v == null) {
        return {
          ok: false,
          stderr: `csplit: option requires an argument -- 'prefix'\nTry 'csplit --help' for more information.\n`,
          exitCode: 1
        };
      }
      prefix = v;
      i++;
      continue;
    }
    if (arg.startsWith('--prefix=')) {
      prefix = arg.slice('--prefix='.length);
      i++;
      continue;
    }
    if (arg === '-n' || arg === '--digits') {
      const v = argsArr[++i];
      if (v == null) {
        return {
          ok: false,
          stderr: `csplit: option requires an argument -- 'digits'\nTry 'csplit --help' for more information.\n`,
          exitCode: 1
        };
      }
      if (!/^\d+$/.test(v)) {
        return {
          ok: false,
          stderr: `csplit: invalid digits: '${v}'\nTry 'csplit --help' for more information.\n`,
          exitCode: 1
        };
      }
      const n = parseInt(v, 10);
      if (n < 1 || n > 64) {
        return {
          ok: false,
          stderr: `csplit: invalid digits: '${v}'\nTry 'csplit --help' for more information.\n`,
          exitCode: 1
        };
      }
      digits = n;
      i++;
      continue;
    }
    if (arg.startsWith('--digits=')) {
      const v = arg.slice('--digits='.length);
      if (!/^\d+$/.test(v)) {
        return {
          ok: false,
          stderr: `csplit: invalid digits: '${v}'\nTry 'csplit --help' for more information.\n`,
          exitCode: 1
        };
      }
      const n = parseInt(v, 10);
      if (n < 1 || n > 64) {
        return {
          ok: false,
          stderr: `csplit: invalid digits: '${v}'\nTry 'csplit --help' for more information.\n`,
          exitCode: 1
        };
      }
      digits = n;
      i++;
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1 && !arg.startsWith('--')) {
      let j = 1;
      while (j < arg.length) {
        const c = arg[j];
        if (c === 's' || c === 'q') {
          silent = true;
          j++;
          continue;
        }
        if (c === 'k') {
          keepFiles = true;
          j++;
          continue;
        }
        if (c === 'z') {
          elideEmpty = true;
          j++;
          continue;
        }
        if (c === 'f') {
          const rest = arg.slice(j + 1);
          if (rest.length > 0) {
            prefix = rest;
            j = arg.length;
            break;
          }
          const v = argsArr[++i];
          if (v == null) {
            return {
              ok: false,
              stderr: `csplit: option requires an argument -- 'f'\nTry 'csplit --help' for more information.\n`,
              exitCode: 1
            };
          }
          prefix = v;
          j = arg.length;
          break;
        }
        if (c === 'n') {
          const rest = arg.slice(j + 1);
          if (rest.length > 0 && /^\d+$/.test(rest)) {
            const n = parseInt(rest, 10);
            if (n < 1 || n > 64) {
              return {
                ok: false,
                stderr: `csplit: invalid digits: '${rest}'\nTry 'csplit --help' for more information.\n`,
                exitCode: 1
              };
            }
            digits = n;
            j = arg.length;
            break;
          }
          const v = argsArr[++i];
          if (v == null) {
            return {
              ok: false,
              stderr: `csplit: option requires an argument -- 'n'\nTry 'csplit --help' for more information.\n`,
              exitCode: 1
            };
          }
          if (!/^\d+$/.test(v)) {
            return {
              ok: false,
              stderr: `csplit: invalid digits: '${v}'\nTry 'csplit --help' for more information.\n`,
              exitCode: 1
            };
          }
          const n = parseInt(v, 10);
          if (n < 1 || n > 64) {
            return {
              ok: false,
              stderr: `csplit: invalid digits: '${v}'\nTry 'csplit --help' for more information.\n`,
              exitCode: 1
            };
          }
          digits = n;
          j = arg.length;
          break;
        }
        return { ok: false, stderr: csplitOptionError(`-${c}`), exitCode: 1 };
      }
      i++;
      continue;
    }
    if (arg.startsWith('--') && arg.length > 2) {
      return { ok: false, stderr: csplitOptionError(arg), exitCode: 1 };
    }
    break;
  }
  const operands = argsArr.slice(i);
  return {
    ok: true,
    prefix,
    digits,
    silent,
    keepFiles,
    elideEmpty,
    operands
  };
}

const SORT_HELP = `Usage: sort [OPTION]... [FILE]...
Write sorted concatenation of all FILE(s) to standard output.

  -n, --numeric-sort    compare according to string numerical value
  -r, --reverse         reverse the result of comparisons
  -u, --unique          output only unique lines (after sort)
  -h, --help            display this help and exit
  --                    end of options

With no FILE, or when FILE is -, read standard input. Piped stdin is used only when no FILE operands are given.

jsh:
  Multiple FILE operands are concatenated (like cat) then sorted as one stream. Blank lines are preserved.
  Symlinks are followed to a regular file (like wc/head). Binary files sort as empty text.
  Not implemented vs GNU: -f/--ignore-case, -M/--month-sort, --human-numeric-sort (GNU short -h), field keys, locales, --version.

Full documentation: <https://www.gnu.org/software/coreutils/sort>
`;

/**
 * Parse jsh `sort` argv: -r/-n/-u, long forms, --, --help/-h.
 *
 * @param {string[]} args
 * @returns {{ ok: true, reverse: boolean, numeric: boolean, unique: boolean, operands: string[], help?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseSortArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  let reverse = false;
  let numeric = false;
  let unique = false;
  const operands = [];
  let i = 0;
  while (i < argsArr.length) {
    const arg = argsArr[i];
    if (arg === '--help' || arg === '-h') {
      return { ok: true, reverse, numeric, unique, operands: [], help: true };
    }
    if (arg === '--') {
      operands.push(...argsArr.slice(i + 1));
      break;
    }
    if (arg === '-') {
      operands.push('-');
      i++;
      continue;
    }
    if (arg === '-r' || arg === '--reverse') {
      reverse = true;
      i++;
      continue;
    }
    if (arg === '-n' || arg === '--numeric-sort') {
      numeric = true;
      i++;
      continue;
    }
    if (arg === '-u' || arg === '--unique') {
      unique = true;
      i++;
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1 && !arg.startsWith('--')) {
      const rest = arg.slice(1);
      for (const c of rest) {
        if (c === 'r') reverse = true;
        else if (c === 'n') numeric = true;
        else if (c === 'u') unique = true;
        else {
          return { ok: false, stderr: linesCommandOptionError('sort', `-${c}`), exitCode: 1 };
        }
      }
      i++;
      continue;
    }
    if (arg.startsWith('--') && arg.length > 2) {
      return { ok: false, stderr: linesCommandOptionError('sort', arg), exitCode: 1 };
    }
    operands.push(arg, ...argsArr.slice(i + 1));
    break;
  }
  return { ok: true, reverse, numeric, unique, operands };
}

const UNIQ_HELP = `Usage: uniq [OPTION]... [INPUT [OUTPUT]]
Filter adjacent matching lines from INPUT (or standard input), writing to OUTPUT
(or standard output).

  -c, --count           prefix lines by the number of occurrences
  -d, --repeated        only print duplicate lines, one for each group
  -u, --unique          only print unique lines
  -h, --help            display this help and exit
  --                    end of options

With no INPUT, or when INPUT is -, read standard input. When OUTPUT is given,
results are written only to OUTPUT (nothing on standard output), like GNU uniq.

jsh:
  Empty piped stdin is accepted when stdin is supplied (e.g. echo -n | uniq).
  Input symlinks are followed to a regular file. Binary files are treated as empty text.
  If both -d and -u are given, behavior matches GNU: only duplicate lines are considered (-d).
  Not implemented vs GNU: -f/-s/-w/-z, -D/--all-repeated, --group, --version.

Full documentation: <https://www.gnu.org/software/coreutils/uniq>
`;

/**
 * Parse jsh `uniq` argv: -c/-d/-u, long forms, --, --help/-h, at most two operands.
 *
 * @param {string[]} args
 * @returns {{ ok: true, count: boolean, repeatedOnly: boolean, uniqueOnly: boolean, operands: string[], help?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseUniqArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  let count = false;
  let repeatedOnly = false;
  let uniqueOnly = false;
  const operands = [];
  let i = 0;
  while (i < argsArr.length) {
    const arg = argsArr[i];
    if (arg === '--help' || arg === '-h') {
      return { ok: true, count, repeatedOnly, uniqueOnly, operands: [], help: true };
    }
    if (arg === '--') {
      operands.push(...argsArr.slice(i + 1));
      break;
    }
    if (arg === '-') {
      operands.push('-');
      i++;
      continue;
    }
    if (arg === '-c' || arg === '--count') {
      count = true;
      i++;
      continue;
    }
    if (arg === '-d' || arg === '--repeated') {
      repeatedOnly = true;
      i++;
      continue;
    }
    if (arg === '-u' || arg === '--unique') {
      uniqueOnly = true;
      i++;
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1 && !arg.startsWith('--')) {
      const rest = arg.slice(1);
      for (const c of rest) {
        if (c === 'c') count = true;
        else if (c === 'd') repeatedOnly = true;
        else if (c === 'u') uniqueOnly = true;
        else {
          return { ok: false, stderr: linesCommandOptionError('uniq', `-${c}`), exitCode: 1 };
        }
      }
      i++;
      continue;
    }
    if (arg.startsWith('--') && arg.length > 2) {
      return { ok: false, stderr: linesCommandOptionError('uniq', arg), exitCode: 1 };
    }
    operands.push(arg, ...argsArr.slice(i + 1));
    break;
  }
  if (repeatedOnly && uniqueOnly) {
    uniqueOnly = false;
  }
  if (operands.length > 2) {
    const extra = operands[2];
    return {
      ok: false,
      stderr: `uniq: extra operand '${extra}'\nTry 'uniq --help' for more information.\n`,
      exitCode: 1
    };
  }
  return { ok: true, count, repeatedOnly, uniqueOnly, operands };
}

const TR_HELP = `Usage: tr [OPTION]... SET1 [SET2]
Translate, squeeze, or delete characters from standard input, writing to standard output.

  -c, -C, --complement   use the complement of SET1 (only with -d in jsh)
  -d, --delete           delete characters in SET1 instead of translating
  -s, --squeeze-repeats  replace each sequence of a repeated character from SET1
                         with one occurrence, then translate with SET2 if given
  -h, --help             display this help and exit
  --                     end of options

Reads standard input only. SET1 and SET2 are character sets; ranges like a-z are expanded.

jsh:
  Complement (-c) is supported only with -d (delete characters not in SET1).
  Not implemented vs GNU: -t/--truncate-set1, character classes like [:alpha:], full
  -c translation, combining -d with -s.

Full documentation: <https://www.gnu.org/software/coreutils/tr>
`;

/**
 * @param {string} cmd
 * @param {string} opt
 */
function trOptionError(cmd, opt) {
  if (opt.startsWith('--')) {
    return `${cmd}: unrecognized option '${opt}'\nTry '${cmd} --help' for more information.\n`;
  }
  return `${cmd}: invalid option -- '${opt.replace(
    /^-/,
    ''
  )}'\nTry '${cmd} --help' for more information.\n`;
}

/**
 * Read one backslash escape for tr SET strings (GNU-like subset).
 * @param {string} s
 * @param {number} i index of '\\'
 * @returns {{ ch: string, next: number }}
 */
function readTrBackslash(s, i) {
  if (i >= s.length || s[i] !== '\\') {
    return { ch: '\\', next: i + 1 };
  }
  const j = i + 1;
  if (j >= s.length) {
    return { ch: '\\', next: j };
  }
  const c = s[j];
  const esc = {
    '\\': '\\',
    a: '\u0007',
    b: '\b',
    f: '\f',
    n: '\n',
    r: '\r',
    t: '\t',
    v: '\v'
  };
  if (esc[c] !== undefined) {
    return { ch: esc[c], next: j + 1 };
  }
  if (c === 'x') {
    let k = j + 1;
    let hex = '';
    while (k < s.length && /[0-9a-fA-F]/.test(s[k]) && hex.length < 8) {
      hex += s[k];
      k++;
    }
    if (hex.length === 0) {
      return { ch: 'x', next: j + 1 };
    }
    const v = parseInt(hex, 16);
    if (Number.isNaN(v) || v < 0) {
      return { ch: String.fromCodePoint(0), next: k };
    }
    const cp = v > 0x10ffff ? 0xfffd : v;
    return { ch: String.fromCodePoint(cp), next: k };
  }
  if (c >= '0' && c <= '7') {
    let k = j;
    let oct = '';
    while (k < s.length && s[k] >= '0' && s[k] <= '7' && oct.length < 3) {
      oct += s[k];
      k++;
    }
    const v = parseInt(oct, 8) & 0xff;
    return { ch: String.fromCodePoint(v), next: k };
  }
  return { ch: c, next: j + 1 };
}

/**
 * @param {string} s
 * @param {number} i
 * @returns {{ cp: number, len: number }}
 */
function trCodePointAt(s, i) {
  const c0 = s.charCodeAt(i);
  if (c0 >= 0xd800 && c0 <= 0xdbff && i + 1 < s.length) {
    const c1 = s.charCodeAt(i + 1);
    if (c1 >= 0xdc00 && c1 <= 0xdfff) {
      return { cp: 0x10000 + ((c0 - 0xd800) << 10) + (c1 - 0xdc00), len: 2 };
    }
  }
  return { cp: c0, len: 1 };
}

/**
 * Expand tr SET1/SET2 string: backslashes, a-z style ranges (code-point order).
 * @param {string} s
 * @returns {string[]}
 */
function expandTrSetString(s) {
  const str = String(s);
  const out = [];
  let i = 0;
  while (i < str.length) {
    if (str[i] === '\\') {
      const r = readTrBackslash(str, i);
      out.push(r.ch);
      i = r.next;
      continue;
    }
    const startCp = trCodePointAt(str, i);
    const afterStart = i + startCp.len;
    if (afterStart < str.length && str[afterStart] === '-' && afterStart + 1 < str.length) {
      const afterDash = afterStart + 1;
      let endCp;
      let endI;
      if (str[afterDash] === '\\') {
        const r = readTrBackslash(str, afterDash);
        endCp = trCodePointAt(r.ch, 0).cp;
        endI = r.next;
      } else {
        const e = trCodePointAt(str, afterDash);
        endCp = e.cp;
        endI = afterDash + e.len;
      }
      const lo = Math.min(startCp.cp, endCp);
      const hi = Math.max(startCp.cp, endCp);
      for (let cp = lo; cp <= hi; cp++) {
        out.push(String.fromCodePoint(cp));
      }
      i = endI;
      continue;
    }
    out.push(String.fromCodePoint(startCp.cp));
    i += startCp.len;
  }
  return out;
}

/**
 * @param {string[]} expanded
 * @returns {Set<string>}
 */
function trSetFromExpanded(expanded) {
  return new Set(expanded);
}

/**
 * @param {string[]} set1
 * @param {string[]} set2
 * @returns {Map<string, string>}
 */
function trBuildTranslationMap(set1, set2) {
  const map = new Map();
  const last = set2.length > 0 ? set2[set2.length - 1] : '';
  for (let i = 0; i < set1.length; i++) {
    const ch = set1[i];
    if (map.has(ch)) continue;
    const repl = set2.length === 0 ? '' : set2[i] !== undefined ? set2[i] : last;
    map.set(ch, repl);
  }
  return map;
}

/**
 * Squeeze consecutive runs of characters listed in `set` (expanded array as Set).
 * @param {string} input
 * @param {Set<string>} set
 */
function trSqueezeInput(input, set) {
  let out = '';
  let prev = null;
  for (const ch of input) {
    if (set.has(ch) && prev === ch) {
      continue;
    }
    out += ch;
    prev = ch;
  }
  return out;
}

/**
 * Run tr on stdin text (code points via JS string iteration).
 * @param {string} stdin
 * @param {{ complement: boolean, delete: boolean, squeeze: boolean, squeezeOnly: boolean, set1: string[], set2: string[] }} opts
 */
function runTr(stdin, opts) {
  const { complement, delete: del, squeeze, squeezeOnly = false, set1, set2 } = opts;
  const e1 = set1;
  const e2 = set2;
  const set1Set = trSetFromExpanded(e1);

  if (del) {
    let out = '';
    for (const ch of stdin) {
      const inSet = set1Set.has(ch);
      const drop = complement ? !inSet : inSet;
      if (!drop) out += ch;
    }
    return out;
  }

  const map = trBuildTranslationMap(e1, e2);

  let body = stdin;
  if (squeeze) {
    body = trSqueezeInput(body, set1Set);
  }
  if (squeezeOnly) {
    return body;
  }

  let out = '';
  for (const ch of body) {
    if (map.has(ch)) {
      out += map.get(ch);
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * Parse jsh `tr` argv.
 *
 * @param {string[]} args
 * @returns {{ ok: true, complement: boolean, delete: boolean, squeeze: boolean, squeezeOnly: boolean, operands: string[], help?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseTrArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  let complement = false;
  let deleteFlag = false;
  let squeeze = false;
  const operands = [];
  let i = 0;
  while (i < argsArr.length) {
    const arg = argsArr[i];
    if (arg === '--help' || arg === '-h') {
      return { ok: true, complement, delete: deleteFlag, squeeze, operands: [], help: true };
    }
    if (arg === '--') {
      operands.push(...argsArr.slice(i + 1));
      break;
    }
    if (arg === '--complement') {
      complement = true;
      i++;
      continue;
    }
    if (arg === '--delete') {
      deleteFlag = true;
      i++;
      continue;
    }
    if (arg === '--squeeze-repeats' || arg === '--squeeze') {
      squeeze = true;
      i++;
      continue;
    }
    if (arg === '-c' || arg === '-C') {
      complement = true;
      i++;
      continue;
    }
    if (arg === '-d') {
      deleteFlag = true;
      i++;
      continue;
    }
    if (arg === '-s') {
      squeeze = true;
      i++;
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1 && !arg.startsWith('--')) {
      const rest = arg.slice(1);
      for (const c of rest) {
        if (c === 'c' || c === 'C') complement = true;
        else if (c === 'd') deleteFlag = true;
        else if (c === 's') squeeze = true;
        else if (c === 'h') {
          return { ok: true, complement, delete: deleteFlag, squeeze, operands: [], help: true };
        } else {
          return { ok: false, stderr: trOptionError('tr', `-${c}`), exitCode: 2 };
        }
      }
      i++;
      continue;
    }
    if (arg.startsWith('--') && arg.length > 2) {
      return { ok: false, stderr: trOptionError('tr', arg), exitCode: 2 };
    }
    operands.push(arg, ...argsArr.slice(i + 1));
    break;
  }

  if (complement && !deleteFlag) {
    return {
      ok: false,
      stderr: `tr: when translating, complement is not supported in jsh; use tr SET1 SET2 without -c, or tr -cd SET1\nTry 'tr --help' for more information.\n`,
      exitCode: 2
    };
  }
  if (deleteFlag && squeeze) {
    return {
      ok: false,
      stderr: `tr: combining -d and -s is not supported in jsh\nTry 'tr --help' for more information.\n`,
      exitCode: 2
    };
  }

  if (deleteFlag) {
    if (operands.length < 1) {
      return {
        ok: false,
        stderr: `tr: missing operand after '-d'\nTwo strings must be given when both translating and deleting.\n`,
        exitCode: 2
      };
    }
    if (operands.length > 1) {
      return {
        ok: false,
        stderr: `tr: extra operand '${operands[1]}'\nTry 'tr --help' for more information.\n`,
        exitCode: 2
      };
    }
    return { ok: true, complement, delete: true, squeeze: false, squeezeOnly: false, operands };
  }

  if (squeeze) {
    if (operands.length < 1) {
      return {
        ok: false,
        stderr: `tr: missing operand\nTry 'tr --help' for more information.\n`,
        exitCode: 2
      };
    }
    if (operands.length > 2) {
      return {
        ok: false,
        stderr: `tr: extra operand '${operands[2]}'\nTry 'tr --help' for more information.\n`,
        exitCode: 2
      };
    }
    return {
      ok: true,
      complement,
      delete: false,
      squeeze: true,
      squeezeOnly: operands.length === 1,
      operands
    };
  }

  if (operands.length < 2) {
    return {
      ok: false,
      stderr: `tr: missing operand\nTry 'tr --help' for more information.\n`,
      exitCode: 2
    };
  }
  if (operands.length > 2) {
    return {
      ok: false,
      stderr: `tr: extra operand '${operands[2]}'\nTry 'tr --help' for more information.\n`,
      exitCode: 2
    };
  }
  return { ok: true, complement, delete: false, squeeze: false, squeezeOnly: false, operands };
}

const XARGS_HELP = `Usage: xargs [OPTION]... [COMMAND [INITIAL-ARGS]...]
Build and execute COMMAND lines from standard input.

  -0, --null                  input items are null-separated, not whitespace-separated
  -I REPLACE-STR              replace REPLACE-STR in INITIAL-ARGS with each input record
      --replace=REPLACE-STR
  -n MAX-ARGS, --max-args=MAX-ARGS   use at most MAX-ARGS input items per invocation
  -t, --verbose               print each command before executing (to stderr)
  -h, --help                  display this help and exit
  --                          end of options

If COMMAND is omitted, echo is used (GNU-style).

jsh:
  Reads stdin only (pipe or redirect). Whitespace mode splits on runs of whitespace;
  -0 splits on NUL bytes into records. With -I/--replace, each line (or -0 record) is one
  substitution; empty stdin yields zero invocations. Child commands run with empty stdin.
  Exit status is 0 only if every invocation exits 0; otherwise 1.
  Not implemented vs GNU: -P, -s, -x, -r, -d, --show-limits, line limits, env -0, shell -I.

Full documentation: <https://www.gnu.org/software/findutils/manual/html_node/xargs-options.html>
`;

/**
 * @param {string} arg
 * @returns {string}
 */
function xargsOptionError(arg) {
  const tryLine = `Try 'xargs --help' for more information.\n`;
  if (arg.startsWith('--') && arg.length > 2) {
    return `xargs: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `xargs: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `xargs: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * Split xargs stdin into words (GNU-like whitespace runs).
 * @param {string} stdin
 * @returns {string[]}
 */
function xargsSplitWhitespaceWords(stdin) {
  const s = String(stdin ?? '');
  const t = s.trim();
  if (t === '') return [];
  return t.split(/\s+/);
}

/**
 * Split xargs stdin into lines for -I mode (drop only a final empty segment from trailing newline).
 * @param {string} stdin
 * @returns {string[]}
 */
function xargsSplitLines(stdin) {
  const s = String(stdin ?? '');
  const parts = s.split(/\r?\n/);
  if (parts.length && parts[parts.length - 1] === '') {
    parts.pop();
  }
  return parts;
}

/**
 * Split xargs stdin into NUL-terminated records (drop only a final empty after trailing NUL).
 * @param {string} stdin
 * @returns {string[]}
 */
function xargsSplitNullRecords(stdin) {
  const s = String(stdin ?? '');
  const parts = s.split('\0');
  if (parts.length && parts[parts.length - 1] === '') {
    parts.pop();
  }
  return parts;
}

/**
 * Substitute replaceStr with record in each initial argument (GNU -I).
 * @param {string[]} args
 * @param {string} replaceStr
 * @param {string} record
 * @returns {string[]}
 */
function xargsSubstituteInArgs(args, replaceStr, record) {
  return args.map((a) => String(a).split(replaceStr).join(record));
}

/**
 * @param {string} name
 * @param {string[]} args
 * @returns {string}
 */
function xargsFormatVerboseCommandLine(name, args) {
  const parts = [name, ...args].map((p) => {
    if (/[\s"'\\]/.test(p)) {
      return `'${String(p).replace(/'/g, `'\\''`)}'`;
    }
    return p;
  });
  return parts.join(' ');
}

/**
 * Parse jsh `xargs` argv.
 *
 * @param {string[]} args
 * @returns {{ ok: true, nullDelim: boolean, maxArgs: number|null, replaceStr: string|null, verbose: boolean, command: string[], help?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseXargsArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  let nullDelim = false;
  let maxArgs = null;
  let replaceStr = null;
  let verbose = false;
  const operands = [];
  let i = 0;

  while (i < argsArr.length) {
    const arg = argsArr[i];
    if (arg === '--help' || arg === '-h') {
      return {
        ok: true,
        nullDelim,
        maxArgs,
        replaceStr,
        verbose,
        command: [],
        help: true
      };
    }
    if (arg === '--') {
      operands.push(...argsArr.slice(i + 1));
      break;
    }
    if (arg === '-0' || arg === '--null') {
      nullDelim = true;
      i++;
      continue;
    }
    if (arg === '-t' || arg === '--verbose') {
      verbose = true;
      i++;
      continue;
    }
    if (arg === '-I' || arg === '--replace') {
      if (i + 1 >= argsArr.length) {
        return {
          ok: false,
          stderr: `xargs: option '${arg}' requires an argument\nTry 'xargs --help' for more information.\n`,
          exitCode: 2
        };
      }
      replaceStr = argsArr[i + 1];
      i += 2;
      continue;
    }
    if (arg.startsWith('--replace=')) {
      replaceStr = arg.slice('--replace='.length);
      i++;
      continue;
    }
    if (arg === '-n' || arg === '--max-args') {
      if (i + 1 >= argsArr.length) {
        return {
          ok: false,
          stderr: `xargs: option requires an argument -- '${arg}'\nTry 'xargs --help' for more information.\n`,
          exitCode: 2
        };
      }
      const n = parseInt(String(argsArr[i + 1]), 10);
      if (!Number.isFinite(n) || n < 1) {
        return {
          ok: false,
          stderr: `xargs: invalid number for -n option\nTry 'xargs --help' for more information.\n`,
          exitCode: 2
        };
      }
      maxArgs = n;
      i += 2;
      continue;
    }
    if (arg.startsWith('--max-args=')) {
      const raw = arg.slice('--max-args='.length);
      const n = parseInt(raw, 10);
      if (!Number.isFinite(n) || n < 1) {
        return {
          ok: false,
          stderr: `xargs: invalid number for --max-args option\nTry 'xargs --help' for more information.\n`,
          exitCode: 2
        };
      }
      maxArgs = n;
      i++;
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1 && !arg.startsWith('--')) {
      const rest = arg.slice(1);
      let j = 0;
      while (j < rest.length) {
        const c = rest[j];
        if (c === '0') {
          nullDelim = true;
          j++;
        } else if (c === 't') {
          verbose = true;
          j++;
        } else if (c === 'h') {
          return {
            ok: true,
            nullDelim,
            maxArgs,
            replaceStr,
            verbose,
            command: [],
            help: true
          };
        } else if (c === 'I') {
          const tail = rest.slice(j + 1);
          if (tail.length > 0) {
            replaceStr = tail;
            j = rest.length;
          } else {
            if (i + 1 >= argsArr.length) {
              return {
                ok: false,
                stderr: `xargs: option requires an argument -- 'I'\nTry 'xargs --help' for more information.\n`,
                exitCode: 2
              };
            }
            replaceStr = argsArr[i + 1];
            i++;
            j = rest.length;
          }
        } else if (c === 'n') {
          const tail = rest.slice(j + 1);
          let numStr = tail;
          if (numStr === '' || !/^\d+$/.test(numStr)) {
            if (i + 1 >= argsArr.length) {
              return {
                ok: false,
                stderr: `xargs: option requires an argument -- 'n'\nTry 'xargs --help' for more information.\n`,
                exitCode: 2
              };
            }
            numStr = String(argsArr[i + 1]);
            i++;
          }
          const n = parseInt(numStr, 10);
          if (!Number.isFinite(n) || n < 1) {
            return {
              ok: false,
              stderr: `xargs: invalid number for -n option\nTry 'xargs --help' for more information.\n`,
              exitCode: 2
            };
          }
          maxArgs = n;
          j = rest.length;
        } else {
          return { ok: false, stderr: xargsOptionError(`-${c}`), exitCode: 2 };
        }
      }
      i++;
      continue;
    }
    if (arg.startsWith('--') && arg.length > 2) {
      return { ok: false, stderr: xargsOptionError(arg), exitCode: 2 };
    }
    operands.push(arg, ...argsArr.slice(i + 1));
    break;
  }

  let command = operands.length > 0 ? operands.slice() : ['echo'];
  if (command.length === 0) {
    command = ['echo'];
  }

  if (replaceStr != null && maxArgs != null) {
    maxArgs = null;
  }

  return {
    ok: true,
    nullDelim,
    maxArgs,
    replaceStr,
    verbose,
    command
  };
}

const CUT_HELP = `Usage: cut OPTION... [FILE]...
Print selected parts of lines from each FILE to standard output.

  -b, --bytes=LIST        select only these bytes (UTF-8)
  -c, --characters=LIST   select only these characters (Unicode code points)
  -d, --delimiter=DELIM   use DELIM instead of TAB for field delimiter (-f only)
  -f, --fields=LIST       select only these fields; see -s
  -s, --only-delimited    do not print lines not containing delimiters (-f only)
      --complement        complement the set of selected bytes, characters, or fields
      --output-delimiter=STRING  use STRING as the output delimiter between selected fields (-f)
  -h, --help              display this help and exit (jsh: -h is alias)
  --                      end of options

LIST is comma-separated ranges: N, N-M, N-, -M (1-based).

jsh:
  Multiple FILE operands are supported (headers like head when more than one).
  Operand - reads standard input. Empty piped stdin works (stdinSupplied), like cat/tee.
  Symlinks are followed to a regular file.
  -d uses the first character of DELIM as the field separator (TAB is default for -f).
  Binary files are treated as empty text for display.
  Not implemented vs GNU: -z/--zero-terminated, -n, --version, full multibyte -b edge cases.

Full documentation: <https://www.gnu.org/software/coreutils/cut>
`;

/**
 * GNU-style option error for cut.
 * @param {string} arg
 * @returns {string}
 */
function cutOptionError(arg) {
  const tryLine = `Try 'cut --help' for more information.\n`;
  if (arg.startsWith('--') && arg.length > 2) {
    return `cut: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `cut: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `cut: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * Parse a GNU-style LIST for cut (-b/-c/-f).
 * @param {string} raw
 * @returns {{ ok: true, parts: { kind: 'range', from: number, to: number }[] } | { ok: false, stderr: string }}
 */
function parseCutListString(raw) {
  const s = String(raw ?? '').trim();
  if (s === '') {
    return { ok: false, stderr: 'cut: invalid byte, character or field list\n' };
  }
  const segments = s.split(',');
  const parts = [];
  for (const seg of segments) {
    const tok = seg.trim();
    if (tok === '') {
      return { ok: false, stderr: 'cut: invalid byte, character or field list\n' };
    }
    let m = /^(\d+)$/.exec(tok);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n < 1) {
        return { ok: false, stderr: 'cut: invalid byte, character or field list\n' };
      }
      parts.push({ kind: 'range', from: n, to: n });
      continue;
    }
    m = /^(\d+)-(\d+)$/.exec(tok);
    if (m) {
      const a = parseInt(m[1], 10);
      const b = parseInt(m[2], 10);
      if (a < 1 || b < 1) {
        return { ok: false, stderr: 'cut: invalid byte, character or field list\n' };
      }
      parts.push({ kind: 'range', from: Math.min(a, b), to: Math.max(a, b) });
      continue;
    }
    m = /^(\d+)-$/.exec(tok);
    if (m) {
      const a = parseInt(m[1], 10);
      if (a < 1) {
        return { ok: false, stderr: 'cut: invalid byte, character or field list\n' };
      }
      parts.push({ kind: 'range', from: a, to: Infinity });
      continue;
    }
    m = /^-(\d+)$/.exec(tok);
    if (m) {
      const b = parseInt(m[1], 10);
      if (b < 1) {
        return { ok: false, stderr: 'cut: invalid byte, character or field list\n' };
      }
      parts.push({ kind: 'range', from: 1, to: b });
      continue;
    }
    return { ok: false, stderr: 'cut: invalid byte, character or field list\n' };
  }
  return { ok: true, parts };
}

/**
 * Parse jsh `cut` argv.
 *
 * @param {string[]} args
 * @returns {{ ok: true, mode: 'b'|'c'|'f', listStr: string, delim: string, suppressOnlyDelimited: boolean, complement: boolean, outputDelimiter: string|null, operands: string[], help?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseCutArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  let mode = null;
  let listStr = '';
  let delim = '\t';
  let suppressOnlyDelimited = false;
  let complement = false;
  let outputDelimiter = null;
  const operands = [];
  let i = 0;

  function setMode(m, list, idx) {
    if (mode != null && mode !== m) {
      return {
        ok: false,
        stderr: 'cut: only one type of list may be specified\n',
        exitCode: 1
      };
    }
    mode = m;
    listStr = list;
    return { ok: true, next: idx };
  }

  while (i < argsArr.length) {
    const arg = argsArr[i];
    if (arg === '--help' || arg === '-h') {
      return { ok: true, help: true };
    }
    if (arg === '--') {
      operands.push(...argsArr.slice(i + 1));
      break;
    }
    if (arg === '-') {
      operands.push('-');
      i++;
      continue;
    }
    if (arg === '-s' || arg === '--only-delimited') {
      suppressOnlyDelimited = true;
      i++;
      continue;
    }
    if (arg === '--complement') {
      complement = true;
      i++;
      continue;
    }
    if (arg.startsWith('--output-delimiter=')) {
      outputDelimiter = arg.slice('--output-delimiter='.length);
      i++;
      continue;
    }
    if (arg === '--output-delimiter') {
      if (i + 1 >= argsArr.length) {
        return {
          ok: false,
          stderr: `cut: option '--output-delimiter' requires an argument\n`,
          exitCode: 1
        };
      }
      outputDelimiter = argsArr[i + 1];
      i += 2;
      continue;
    }
    if (arg.startsWith('--delimiter=')) {
      const v = arg.slice('--delimiter='.length);
      delim = v === '' ? '' : v[0];
      i++;
      continue;
    }
    if (arg === '--delimiter') {
      if (i + 1 >= argsArr.length) {
        return {
          ok: false,
          stderr: `cut: option '--delimiter' requires an argument\n`,
          exitCode: 1
        };
      }
      const v = argsArr[i + 1];
      delim = v === '' ? '' : v[0];
      i += 2;
      continue;
    }
    if (arg === '-d') {
      if (i + 1 >= argsArr.length) {
        return {
          ok: false,
          stderr: `cut: option requires an argument -- 'd'\n`,
          exitCode: 1
        };
      }
      const v = argsArr[i + 1];
      delim = v === '' ? '' : v[0];
      i += 2;
      continue;
    }
    if (arg.startsWith('--bytes=')) {
      const list = arg.slice('--bytes='.length);
      const r = setMode('b', list, i + 1);
      if (!r.ok) return r;
      i = r.next;
      continue;
    }
    if (arg === '--bytes') {
      if (i + 1 >= argsArr.length) {
        return {
          ok: false,
          stderr: `cut: option '--bytes' requires an argument\n`,
          exitCode: 1
        };
      }
      const r = setMode('b', argsArr[i + 1], i + 2);
      if (!r.ok) return r;
      i = r.next;
      continue;
    }
    if (arg.startsWith('--characters=')) {
      const list = arg.slice('--characters='.length);
      const r = setMode('c', list, i + 1);
      if (!r.ok) return r;
      i = r.next;
      continue;
    }
    if (arg === '--characters') {
      if (i + 1 >= argsArr.length) {
        return {
          ok: false,
          stderr: `cut: option '--characters' requires an argument\n`,
          exitCode: 1
        };
      }
      const r = setMode('c', argsArr[i + 1], i + 2);
      if (!r.ok) return r;
      i = r.next;
      continue;
    }
    if (arg.startsWith('--fields=')) {
      const list = arg.slice('--fields='.length);
      const r = setMode('f', list, i + 1);
      if (!r.ok) return r;
      i = r.next;
      continue;
    }
    if (arg === '--fields') {
      if (i + 1 >= argsArr.length) {
        return {
          ok: false,
          stderr: `cut: option '--fields' requires an argument\n`,
          exitCode: 1
        };
      }
      const r = setMode('f', argsArr[i + 1], i + 2);
      if (!r.ok) return r;
      i = r.next;
      continue;
    }
    if (arg === '-b' || (arg.startsWith('-b') && arg.length > 2)) {
      const list = arg === '-b' ? argsArr[i + 1] : arg.slice(2);
      if (arg === '-b' && i + 1 >= argsArr.length) {
        return {
          ok: false,
          stderr: `cut: option requires an argument -- 'b'\n`,
          exitCode: 1
        };
      }
      const r = setMode('b', list, arg === '-b' ? i + 2 : i + 1);
      if (!r.ok) return r;
      i = r.next;
      continue;
    }
    if (arg === '-c' || (arg.startsWith('-c') && arg.length > 2)) {
      const list = arg === '-c' ? argsArr[i + 1] : arg.slice(2);
      if (arg === '-c' && i + 1 >= argsArr.length) {
        return {
          ok: false,
          stderr: `cut: option requires an argument -- 'c'\n`,
          exitCode: 1
        };
      }
      const r = setMode('c', list, arg === '-c' ? i + 2 : i + 1);
      if (!r.ok) return r;
      i = r.next;
      continue;
    }
    if (arg === '-f' || (arg.startsWith('-f') && arg.length > 2)) {
      const list = arg === '-f' ? argsArr[i + 1] : arg.slice(2);
      if (arg === '-f' && i + 1 >= argsArr.length) {
        return {
          ok: false,
          stderr: `cut: option requires an argument -- 'f'\n`,
          exitCode: 1
        };
      }
      const r = setMode('f', list, arg === '-f' ? i + 2 : i + 1);
      if (!r.ok) return r;
      i = r.next;
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1 && !arg.startsWith('--')) {
      return { ok: false, stderr: cutOptionError(arg), exitCode: 1 };
    }
    if (arg.startsWith('--') && arg.length > 2) {
      return { ok: false, stderr: cutOptionError(arg), exitCode: 1 };
    }
    operands.push(arg, ...argsArr.slice(i + 1));
    break;
  }

  if (!mode) {
    return {
      ok: false,
      stderr: `cut: you must specify a list of bytes, characters, or fields\nTry 'cut --help' for more information.\n`,
      exitCode: 1
    };
  }
  const listCheck = parseCutListString(listStr);
  if (!listCheck.ok) {
    return { ok: false, stderr: listCheck.stderr, exitCode: 1 };
  }
  if (delim === '' && mode === 'f') {
    return {
      ok: false,
      stderr: 'cut: the delimiter must be a single character\n',
      exitCode: 1
    };
  }
  return {
    ok: true,
    mode,
    listStr,
    delim,
    suppressOnlyDelimited,
    complement,
    outputDelimiter,
    operands
  };
}

const READLINK_HELP = `Usage: readlink [OPTION]... FILE
Print value of a symbolic link or canonical file name.

  -f, --canonicalize            canonicalize by following every symlink (missing path OK)
  -e, --canonicalize-existing   canonicalize; entire path must exist
  -m, --canonicalize-missing    canonicalize; missing components are treated as missing
  -n, --no-newline              do not output the trailing delimiter
  -h, --help                    display this help and exit (jsh: -h is alias)
  --                            end of options

jsh:
  Default mode prints the stored symlink target (literal value), like GNU readlink without -f.
  Virtual paths use the same rules as resolveVirtualPath; symlink cycles are rejected.
  Not implemented vs GNU: -v/--verbose, --version.

Full documentation: <https://www.gnu.org/software/coreutils/readlink>
`;

/**
 * GNU-style option error for readlink.
 * @param {string} arg
 * @returns {string}
 */
function readlinkOptionError(arg) {
  const tryLine = `Try 'readlink --help' for more information.\n`;
  if (arg.startsWith('--') && arg.length > 2) {
    return `readlink: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `readlink: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `readlink: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * Parse jsh `readlink` argv: -n/-f/-e/-m, long forms, --, --help/-h, single FILE.
 *
 * @param {string[]} args
 * @returns {{ ok: true, noNewline: boolean, canonMode: 'none'|'f'|'e'|'m', operand: string, help?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseReadlinkArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  let noNewline = false;
  /** @type {'none'|'f'|'e'|'m'} */
  let canonMode = 'none';
  const operands = [];
  let i = 0;
  while (i < argsArr.length) {
    const arg = argsArr[i];
    if (arg === '--help' || arg === '-h') {
      return { ok: true, noNewline, canonMode, operand: '', help: true };
    }
    if (arg === '--') {
      operands.push(...argsArr.slice(i + 1));
      break;
    }
    if (arg === '-n' || arg === '--no-newline') {
      noNewline = true;
      i++;
      continue;
    }
    if (arg === '-f' || arg === '--canonicalize') {
      canonMode = 'f';
      i++;
      continue;
    }
    if (arg === '-e' || arg === '--canonicalize-existing') {
      canonMode = 'e';
      i++;
      continue;
    }
    if (arg === '-m' || arg === '--canonicalize-missing') {
      canonMode = 'm';
      i++;
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1 && !arg.startsWith('--')) {
      const rest = arg.slice(1);
      for (const c of rest) {
        if (c === 'n') noNewline = true;
        else if (c === 'f') canonMode = 'f';
        else if (c === 'e') canonMode = 'e';
        else if (c === 'm') canonMode = 'm';
        else if (c === 'v') {
          /* GNU -v is verbose; jsh ignores */
        } else {
          return { ok: false, stderr: readlinkOptionError(`-${c}`), exitCode: 1 };
        }
      }
      i++;
      continue;
    }
    if (arg.startsWith('--') && arg.length > 2) {
      return { ok: false, stderr: readlinkOptionError(arg), exitCode: 1 };
    }
    operands.push(arg, ...argsArr.slice(i + 1));
    break;
  }
  if (operands.length === 0) {
    return {
      ok: false,
      stderr: "readlink: missing operand\nTry 'readlink --help' for more information.\n",
      exitCode: 1
    };
  }
  if (operands.length > 1) {
    const extra = operands[1];
    return {
      ok: false,
      stderr: `readlink: extra operand '${extra}'\nTry 'readlink --help' for more information.\n`,
      exitCode: 1
    };
  }
  return { ok: true, noNewline, canonMode, operand: operands[0] };
}

const LN_HELP = `Usage: ln [OPTION]... [-T] TARGET LINK_NAME
  or:    ln [OPTION]... TARGET
Create links. jsh supports symbolic links only (GNU-style subset).

  -s, --symbolic              make symbolic links instead of hard links (required in jsh)
  -f, --force                 remove existing destination files (files/symlinks only)
  -h, --help                  display this help and exit (jsh: -h is alias)
  --                          end of options

jsh:
  With one TARGET after -s, the link is created in the current directory with the same
  basename as TARGET (GNU behavior). Hard links are not implemented; use -s.

  Not implemented vs GNU: hard links, multi-target DIRECTORY form, -L/-P/-n/-r/-t/-T,
  relative prefix options, --verbose, --backup.

Full documentation: <https://www.gnu.org/software/coreutils/ln>
`;

/**
 * GNU-style option error for ln.
 * @param {string} arg
 * @returns {string}
 */
function lnOptionError(arg) {
  const tryLine = `Try 'ln --help' for more information.\n`;
  if (arg.startsWith('--') && arg.length > 2) {
    return `ln: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `ln: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `ln: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * Basename for ln -s TARGET (single-operand form), GNU-style.
 * @param {string} target
 * @returns {string}
 */
function symlinkBasenameForLn(target) {
  const t = String(target).replace(/\/+$/, '');
  const parts = t.split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : t || '.';
}

/**
 * Parse jsh `ln` argv: -s/--symbolic, -f/--force, --, --help/-h; symlink mode only is useful.
 *
 * @param {string[]} args
 * @returns {{ ok: true, help: true } | { ok: true, symbolic: false, operands: string[] } | { ok: true, symbolic: true, force: boolean, target: string, linkName: string | null } | { ok: false, stderr: string, exitCode: number }}
 */
function parseLnArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  let symbolic = false;
  let force = false;
  const operands = [];
  let i = 0;
  while (i < argsArr.length) {
    const arg = argsArr[i];
    if (arg === '--help' || arg === '-h') {
      return { ok: true, help: true };
    }
    if (arg === '--') {
      operands.push(...argsArr.slice(i + 1));
      break;
    }
    if (arg === '-s' || arg === '--symbolic') {
      symbolic = true;
      i++;
      continue;
    }
    if (arg === '-f' || arg === '--force') {
      force = true;
      i++;
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1 && !arg.startsWith('--')) {
      const rest = arg.slice(1);
      for (const c of rest) {
        if (c === 's') symbolic = true;
        else if (c === 'f') force = true;
        else {
          return { ok: false, stderr: lnOptionError(`-${c}`), exitCode: 1 };
        }
      }
      i++;
      continue;
    }
    if (arg.startsWith('--') && arg.length > 2) {
      return { ok: false, stderr: lnOptionError(arg), exitCode: 1 };
    }
    operands.push(arg, ...argsArr.slice(i + 1));
    break;
  }

  if (!symbolic) {
    return { ok: true, symbolic: false, operands };
  }

  if (operands.length === 0) {
    return {
      ok: false,
      stderr: "ln: missing file operand\nTry 'ln --help' for more information.\n",
      exitCode: 1
    };
  }
  if (operands.length === 1) {
    return { ok: true, symbolic: true, force, target: operands[0], linkName: null };
  }
  if (operands.length === 2) {
    return {
      ok: true,
      symbolic: true,
      force,
      target: operands[0],
      linkName: operands[1]
    };
  }
  const extra = operands[2];
  return {
    ok: false,
    stderr: `ln: extra operand '${extra}'\nTry 'ln --help' for more information.\n`,
    exitCode: 1
  };
}

const TOUCH_HELP = `Usage: touch [OPTION]... FILE...
Update the access and modification times of each FILE to the current time.

  -c, --no-create    do not create any files
  -h, --help         display this help and exit

jsh:
  Timestamps are updated by rewriting file metadata (same path) via the virtual FS.
  With -c, missing FILE operands are skipped silently (GNU-style).

  Not implemented vs GNU: -a, -m, -d, -t, -r, --reference, and GNU's -h
  (--no-dereference on symlinks). Here -h is --help like other jsh commands.

Try 'touch --help' on GNU coreutils for full option lists.
`;

/**
 * GNU-style option error for touch.
 * @param {string} arg
 * @returns {string}
 */
function touchOptionError(arg) {
  const tryLine = "Try 'touch --help' for more information.\n";
  if (arg.startsWith('--') && arg.length > 2) {
    return `touch: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `touch: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `touch: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * Parse jsh `touch` argv: -c/--no-create, --, -h/--help.
 *
 * @param {string[]} args
 * @returns {{ ok: true, noCreate: boolean, operands: string[], help?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseTouchArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  let noCreate = false;
  const operands = [];
  let i = 0;
  while (i < argsArr.length) {
    const arg = argsArr[i];
    if (arg === '--help' || arg === '-h') {
      return { ok: true, noCreate: false, operands: [], help: true };
    }
    if (arg === '--') {
      operands.push(...argsArr.slice(i + 1));
      break;
    }
    if (arg === '-c' || arg === '--no-create') {
      noCreate = true;
      i++;
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1 && !arg.startsWith('--')) {
      const rest = arg.slice(1);
      for (const c of rest) {
        if (c === 'c') {
          noCreate = true;
        } else if (c === 'h') {
          return { ok: true, noCreate: false, operands: [], help: true };
        } else {
          return { ok: false, stderr: touchOptionError(`-${c}`), exitCode: 1 };
        }
      }
      i++;
      continue;
    }
    if (arg.startsWith('--') && arg.length > 2) {
      return { ok: false, stderr: touchOptionError(arg), exitCode: 1 };
    }
    operands.push(arg, ...argsArr.slice(i + 1));
    break;
  }
  if (!operands.length) {
    return { ok: false, stderr: 'touch: missing file operand\n', exitCode: 1 };
  }
  return { ok: true, noCreate, operands };
}

const TEST_HELP = `Usage: test [OPTION]
       test [EXPRESSION]
       [ EXPRESSION]
       [ EXPRESSION ]

Check file types and compare strings.

Options:
      --help     display this help and exit
      --version  output version information and exit

jsh implements a subset of POSIX test: recursive \`!\`, one-arg non-empty
string, two-arg unary primaries (\`-n\`, \`-z\`, \`-e\`, \`-f\`, \`-d\`,
\`-L\`, \`-h\`), and three-arg \`=\` / \`!=\` string comparisons. Symlinks
for \`-e\` / \`-f\` / \`-d\` are followed (like GNU); \`-L\` and \`-h\` test
the link itself.

Not implemented: \`-a\` / \`-o\`, parentheses, integer comparisons (\`-eq\`,
\`-gt\`, …), \`-r\` / \`-w\` / \`-x\` / \`-s\`, and other primaries.

The \`-h\` primary means a symbolic link (BSD-style), not \`--help\`. Use
\`test --help\` for this usage.

Full documentation: <https://www.gnu.org/software/coreutils/manual/html_node/test-invocation.html>
`;

const TEST_VERSION_LINE = 'Heyming OS jsh 2.0.0 — in-browser test(1) subset (see test --help).\n';

/**
 * Parse leading `test` / `[` options only (`--help`, `--version`).
 * Expression operands (including `-f`, `-h`, …) are not parsed here.
 *
 * @param {string[]} args
 * @returns {{ ok: true, help?: true, version?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseTestArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  if (argsArr.length === 0) {
    return { ok: true };
  }
  const a0 = argsArr[0];
  if (a0 === '--help') {
    return { ok: true, help: true };
  }
  if (a0 === '--version') {
    return { ok: true, version: true };
  }
  if (a0.startsWith('--') && a0.length > 2) {
    const tryLine = `Try 'test --help' for more information.\n`;
    return {
      ok: false,
      stderr: `test: unrecognized option '${a0}'\n${tryLine}`,
      exitCode: 2
    };
  }
  return { ok: true };
}

const TRUE_HELP = `Usage: true [OPTION]...
Exit with a status code of zero.

      --help     display this help and exit
      --version  output version information and exit

jsh: GNU-style; operands are ignored. A lone \`-\` is treated as an operand, not an option.

Full documentation: <https://www.gnu.org/software/coreutils/manual/html_node/true-invocation.html>
`;

const FALSE_HELP = `Usage: false [OPTION]...
Exit with a status code of one.

      --help     display this help and exit
      --version  output version information and exit

jsh: GNU-style; operands are ignored. A lone \`-\` is treated as an operand, not an option.

Full documentation: <https://www.gnu.org/software/coreutils/manual/html_node/false-invocation.html>
`;

/**
 * Parse `true` / `false` argv (GNU coreutils-style).
 * A lone `-` is an operand (ignored), not an option.
 *
 * @param {string[]} args
 * @param {'true'|'false'} progName
 * @returns {{ ok: true, help?: true, version?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseTrueFalseArgv(args, progName) {
  const argsArr = Array.isArray(args) ? args : [];
  let i = 0;
  while (i < argsArr.length) {
    const a = argsArr[i];
    if (a === '--') {
      break;
    }
    if (a === '-') {
      i++;
      continue;
    }
    if (a === '--help' || a === '-h') {
      return { ok: true, help: true };
    }
    if (a === '--version') {
      return { ok: true, version: true };
    }
    if (a.startsWith('-')) {
      const tryLine = `Try '${progName} --help' for more information.\n`;
      if (a.startsWith('--') && a.length > 2) {
        return {
          ok: false,
          stderr: `${progName}: unrecognized option '${a}'\n${tryLine}`,
          exitCode: 2
        };
      }
      if (a.length === 2) {
        return {
          ok: false,
          stderr: `${progName}: invalid option -- '${a[1]}'\n${tryLine}`,
          exitCode: 2
        };
      }
      return {
        ok: false,
        stderr: `${progName}: unrecognized option '${a}'\n${tryLine}`,
        exitCode: 2
      };
    }
    i++;
  }
  return { ok: true };
}

/**
 * Canonical path after following symlink chain; missing final path allowed for modes f/m, not e.
 *
 * @param {{ resolvePath: (s: string) => string, getFileSystemItem: (p: string) => Promise<*> }} terminal
 * @param {string} operand
 * @param {'f'|'e'|'m'} mode
 * @param {string} [cmdPrefix='readlink'] — prefix for error lines (e.g. **pwd** for \`pwd -P\`).
 * @returns {Promise<{ ok: true, path: string } | { ok: false, stderr: string }>}
 */
async function vfsReadlinkCanonical(terminal, operand, mode, cmdPrefix = 'readlink') {
  let p = terminal.resolvePath(operand);
  p = resolveVirtualPath(p, '/');
  const visited = new Set();
  for (let depth = 0; depth < 32; depth++) {
    if (visited.has(p)) {
      return {
        ok: false,
        stderr: `${cmdPrefix}: ${operand}: Too many levels of symbolic links`
      };
    }
    visited.add(p);
    const item = await terminal.getFileSystemItem(p);
    if (!item) {
      if (mode === 'e') {
        return {
          ok: false,
          stderr: `${cmdPrefix}: ${operand}: No such file or directory`
        };
      }
      return { ok: true, path: p };
    }
    if (item.type === 'symlink') {
      const raw = String(item.target || '').trim();
      if (!raw) {
        return { ok: false, stderr: `${cmdPrefix}: ${operand}: Invalid argument` };
      }
      const parent = dirnameVirtualPath(p);
      p = resolveVirtualPath(raw, parent);
      continue;
    }
    return { ok: true, path: p };
  }
  return {
    ok: false,
    stderr: `${cmdPrefix}: ${operand}: Too many levels of symbolic links`
  };
}

/**
 * Parse jsh `wc` argv: -l/-w/-c (combined -lwc), --lines/--words/--bytes, --, --help/-h.
 *
 * @param {string[]} args
 * @returns {{ ok: true, showLines: boolean, showWords: boolean, showBytes: boolean, showAll: boolean, operands: string[], help?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseWcArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  let showLines = false;
  let showWords = false;
  let showBytes = false;
  const operands = [];
  let i = 0;
  while (i < argsArr.length) {
    const arg = argsArr[i];
    if (arg === '--help' || arg === '-h') {
      return { ok: true, showLines, showWords, showBytes, showAll: true, operands: [], help: true };
    }
    if (arg === '--') {
      operands.push(...argsArr.slice(i + 1));
      break;
    }
    if (arg === '-') {
      operands.push('-');
      i++;
      continue;
    }
    if (arg === '-l' || arg === '--lines') {
      showLines = true;
      i++;
      continue;
    }
    if (arg === '-w' || arg === '--words') {
      showWords = true;
      i++;
      continue;
    }
    if (arg === '-c' || arg === '--bytes') {
      showBytes = true;
      i++;
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1 && !arg.startsWith('--')) {
      const rest = arg.slice(1);
      for (const c of rest) {
        if (c === 'l') showLines = true;
        else if (c === 'w') showWords = true;
        else if (c === 'c') showBytes = true;
        else {
          return {
            ok: false,
            stderr: linesCommandOptionError('wc', `-${c}`),
            exitCode: 1
          };
        }
      }
      i++;
      continue;
    }
    if (arg.startsWith('--') && arg.length > 2) {
      return { ok: false, stderr: linesCommandOptionError('wc', arg), exitCode: 1 };
    }
    operands.push(arg, ...argsArr.slice(i + 1));
    break;
  }
  const showAll = !showLines && !showWords && !showBytes;
  return { ok: true, showLines, showWords, showBytes, showAll, operands };
}

/**
 * Follow symlink chain to a regular file (GNU head/tail read through symlinks).
 *
 * @param {{ resolvePath: (s: string) => string, getFileSystemItem: (p: string) => Promise<*> }} terminal
 * @param {string} operand
 * @param {'head'|'tail'|'wc'|'sort'|'uniq'|'cat'|'grep'|'nl'} cmdName
 * @returns {Promise<{ ok: true, file: object } | { ok: false, stderr: string }>}
 */
async function vfsFollowSymlinksToFile(terminal, operand, cmdName) {
  let fullPath = terminal.resolvePath(operand);
  const visited = new Set();
  for (let depth = 0; depth < 32; depth++) {
    if (visited.has(fullPath)) {
      return {
        ok: false,
        stderr: `${cmdName}: ${operand}: Too many levels of symbolic links`
      };
    }
    visited.add(fullPath);
    const file = await terminal.getFileSystemItem(fullPath);
    if (!file) {
      return {
        ok: false,
        stderr: `${cmdName}: cannot open '${operand}' for reading: No such file or directory`
      };
    }
    if (file.type === 'symlink') {
      const raw = file.target;
      if (raw == null || String(raw).trim() === '') {
        return { ok: false, stderr: `${cmdName}: ${operand}: Invalid argument` };
      }
      const parent = dirnameVirtualPath(fullPath);
      fullPath = resolveVirtualPath(String(raw).trim(), parent);
      continue;
    }
    if (file.type !== 'file') {
      return {
        ok: false,
        stderr: `${cmdName}: Error reading '${operand}': Is a directory`
      };
    }
    return { ok: true, file };
  }
  return {
    ok: false,
    stderr: `${cmdName}: ${operand}: Too many levels of symbolic links`
  };
}

/**
 * VFS file items may hold data in `content` (string) or `contentBytes` (e.g. git checkout via jsh-git-fs).
 * Produces a UTF-8 string for cat/vi/shell text paths; sets isBinary when sampled bytes contain NUL.
 *
 * @param {{ type?: string, content?: string, contentBytes?: ArrayBuffer|ArrayBufferView }} item
 * @returns {{ text: string, isBinary: boolean }}
 */
function fileItemUtf8ForDisplay(item) {
  if (!item || item.type !== 'file') {
    return { text: '', isBinary: false };
  }
  if (item.content != null && item.content !== '') {
    return { text: String(item.content), isBinary: false };
  }
  const raw = item.contentBytes;
  if (raw == null) {
    return { text: '', isBinary: false };
  }
  let u8;
  if (raw instanceof ArrayBuffer) {
    u8 = new Uint8Array(raw);
  } else if (ArrayBuffer.isView(raw)) {
    u8 = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  } else {
    return { text: '', isBinary: false };
  }
  if (u8.byteLength === 0) {
    return { text: '', isBinary: false };
  }
  const maxSample = 8192;
  const sample = u8.byteLength > maxSample ? u8.subarray(0, maxSample) : u8;
  if (sample.indexOf(0) !== -1) {
    return { text: '', isBinary: true };
  }
  const text = new TextDecoder('utf-8', { fatal: false }).decode(u8);
  return { text, isBinary: false };
}

const BASENAME_HELP = `Usage: basename NAME [SUFFIX]
  or:  basename OPTION... NAME...

Print NAME with any leading directory components removed.
If specified, also remove a trailing SUFFIX.

  -a, --multiple       support more than one NAME argument
  -s, --suffix=SUFFIX  remove a trailing SUFFIX (replaces optional SUFFIX operand)
  -z, --zero            end each output line with NUL, not newline
      --help            display this help and exit
      --version         output version information and exit

jsh: \`-h\` is an alias for \`--help\`. Paths are resolved against the virtual cwd (see \`pwd\`).

Full documentation: <https://www.gnu.org/software/coreutils/manual/html_node/basename-invocation.html>
`;

const BASENAME_VERSION_LINE = 'basename (jsh Heyming Terminal) 1.0\n';

function basenameStripTrailingSlashes(p) {
  if (!p || p === '/') return p;
  return p.replace(/\/+$/, '') || '/';
}

/**
 * GNU-style basename: strip trailing slashes, last path component, optional suffix.
 * @param {string} path
 * @param {string|null|undefined} suffix
 * @returns {string}
 */
function basenameCompute(path, suffix) {
  const s = basenameStripTrailingSlashes(path);
  if (!s) return '';
  if (s === '/') return '/';
  const i = s.lastIndexOf('/');
  let name = i === -1 ? s : s.slice(i + 1);
  if (name === '') name = '/';
  if (suffix != null && suffix !== '' && name.endsWith(suffix)) {
    name = name.slice(0, -suffix.length);
  }
  return name;
}

function basenameTryLine() {
  return "Try 'basename --help' for more information.\n";
}

/**
 * Parse GNU-style basename argv.
 * @param {string[]} args
 * @returns {{ ok: true, names: string[], suffix: string|null, zero: boolean, help?: true, version?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseBasenameArgv(args) {
  const prog = 'basename';
  const argsArr = Array.isArray(args) ? args : [];
  let i = 0;
  let suffixFromOpt = null;
  let zero = false;
  let sawHelp = false;
  let sawVersion = false;
  let multiple = false;

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
    if (a === '--version') {
      sawVersion = true;
      i++;
      continue;
    }
    if (a === '-a' || a === '--multiple') {
      multiple = true;
      i++;
      continue;
    }
    if (a === '-z' || a === '--zero') {
      zero = true;
      i++;
      continue;
    }
    if (a.startsWith('--suffix=')) {
      const v = a.slice('--suffix='.length);
      if (v === '') {
        return {
          ok: false,
          stderr: `${prog}: option '--suffix' requires an argument\n${basenameTryLine()}`,
          exitCode: 2
        };
      }
      suffixFromOpt = v;
      i++;
      continue;
    }
    if (a === '-s') {
      const next = argsArr[i + 1];
      if (next == null) {
        return {
          ok: false,
          stderr: `${prog}: option '-s' requires an argument\n${basenameTryLine()}`,
          exitCode: 2
        };
      }
      suffixFromOpt = next;
      i += 2;
      continue;
    }
    if (a.startsWith('-s') && a.length > 2) {
      suffixFromOpt = a.slice(2);
      i++;
      continue;
    }
    if (a === '-') {
      break;
    }
    if (a.startsWith('-')) {
      if (a.startsWith('--') && a.length > 2) {
        return {
          ok: false,
          stderr: `${prog}: unrecognized option '${a}'\n${basenameTryLine()}`,
          exitCode: 2
        };
      }
      if (a.length === 2) {
        return {
          ok: false,
          stderr: `${prog}: invalid option -- '${a[1]}'\n${basenameTryLine()}`,
          exitCode: 2
        };
      }
      return {
        ok: false,
        stderr: `${prog}: unrecognized option '${a}'\n${basenameTryLine()}`,
        exitCode: 2
      };
    }
    break;
  }

  if (sawHelp) {
    return { ok: true, help: true };
  }
  if (sawVersion) {
    return { ok: true, version: true };
  }

  const operands = argsArr.slice(i);
  if (multiple) {
    if (operands.length === 0) {
      return { ok: false, stderr: `${prog}: missing operand\n`, exitCode: 1 };
    }
    return { ok: true, names: operands, suffix: suffixFromOpt, zero };
  }

  if (operands.length === 0) {
    return { ok: false, stderr: `${prog}: missing operand\n`, exitCode: 1 };
  }

  if (suffixFromOpt != null) {
    if (operands.length > 1) {
      const extra = operands[1];
      return {
        ok: false,
        stderr: `${prog}: extra operand '${extra}'\n${basenameTryLine()}`,
        exitCode: 1
      };
    }
    return { ok: true, names: [operands[0]], suffix: suffixFromOpt, zero };
  }

  if (operands.length === 1) {
    return { ok: true, names: [operands[0]], suffix: null, zero };
  }
  if (operands.length === 2) {
    return { ok: true, names: [operands[0]], suffix: operands[1], zero };
  }
  const extra = operands[2];
  return {
    ok: false,
    stderr: `${prog}: extra operand '${extra}'\n${basenameTryLine()}`,
    exitCode: 1
  };
}

const DIRNAME_HELP = `Usage: dirname [OPTION] NAME...
  -z, --zero            end each output line with NUL, not newline
      --help            display this help and exit
      --version         output version information and exit

jsh: \`-h\` is an alias for \`--help\`. Paths are resolved against the virtual cwd (see \`pwd\`).

Full documentation: <https://www.gnu.org/software/coreutils/manual/html_node/dirname-invocation.html>
`;

const DIRNAME_VERSION_LINE = 'dirname (jsh Heyming Terminal) 1.0\n';

function dirnameTryLine() {
  return "Try 'dirname --help' for more information.\n";
}

/**
 * GNU-style option error for dirname.
 * @param {string} arg
 * @returns {string}
 */
function dirnameOptionError(arg) {
  const tryLine = dirnameTryLine();
  if (arg.startsWith('--') && arg.length > 2) {
    return `dirname: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `dirname: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `dirname: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * POSIX/GNU dirname: parent path of NAME (last non-slash component removed).
 * @param {string} path
 * @returns {string}
 */
function dirnameCompute(path) {
  if (path == null || path === '') return '.';
  let s = path.replace(/\/+$/, '');
  if (s === '') return '/';
  const i = s.lastIndexOf('/');
  if (i === -1) return '.';
  if (i === 0) return '/';
  return s.slice(0, i) || '/';
}

/**
 * Parse GNU-style dirname argv.
 * @param {string[]} args
 * @returns {{ ok: true, names: string[], zero: boolean, help?: true, version?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseDirnameArgv(args) {
  const prog = 'dirname';
  const argsArr = Array.isArray(args) ? args : [];
  let i = 0;
  let zero = false;
  let sawHelp = false;
  let sawVersion = false;

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
    if (a === '--version') {
      sawVersion = true;
      i++;
      continue;
    }
    if (a === '-z' || a === '--zero') {
      zero = true;
      i++;
      continue;
    }
    if (a.startsWith('-')) {
      return { ok: false, stderr: dirnameOptionError(a), exitCode: 2 };
    }
    break;
  }

  if (sawHelp) {
    return { ok: true, help: true };
  }
  if (sawVersion) {
    return { ok: true, version: true };
  }

  const operands = argsArr.slice(i);
  if (operands.length === 0) {
    return { ok: false, stderr: `${prog}: missing operand\n`, exitCode: 1 };
  }
  return { ok: true, names: operands, zero };
}

const ShellUtils = {
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
  TEE_HELP,
  parseTeeArgv,
  CAT_HELP,
  parseCatArgv,
  ECHO_HELP,
  ECHO_VERSION_LINE,
  parseEchoArgv,
  echoOptionError,
  echoApplyBackslashEscapes,
  LESS_LINES_PER_PAGE,
  LESS_DEFAULT_TAB_STOPS,
  LESS_HELP,
  LESS_VERSION_LINE,
  lessContentFitsOneScreen,
  lessFormatWithLineNumbers,
  lessSqueezeBlankLines,
  lessExpandTabsInLine,
  lessExpandTabsInText,
  lessInitialScrollLine,
  lessScrollLineForTargetLineOneBased,
  lessTargetLineOneBasedFromPrefix,
  lessHalfPageLineCount,
  lessRepeatCountFromPrefix,
  formatLessSearchMatchFooter,
  lessStripAnsi,
  lessAnsiToHtml,
  parseLessArgv,
  GREP_HELP,
  grepOptionError,
  parseGrepArgv,
  SED_HELP,
  sedOptionError,
  parseSedArgv,
  parseSedSubstituteScript,
  parseSedScript,
  parseSedAddressedDelete,
  parseSedSlashPatternDelete,
  parseSedSlashPatternRangeDelete,
  parseSedSlashPatternToLineDelete,
  parseSedLineToPatternDelete,
  sedLineMatchesDeleteAddress,
  sedApplySubstituteLine,
  sedProcessContent,
  splitSedScriptIntoCommands,
  AWK_HELP,
  awkOptionError,
  parseAwkArgv,
  parseAwkFullProgram,
  parseAwkPrintProgram,
  awkBeginCtx,
  awkRunPrintOnce,
  awkRunPrintProgram,
  awkSplitFields,
  awkSplitCommaListTopLevel,
  awkSplitTopLevelCommas,
  awkParseNamedCall,
  awkEvalArithmeticExpr,
  awkStrToNum,
  awkFormatArithResult,
  awkEvalPrintExpr,
  awkParseArrayAccess,
  awkEvalSplitExpr,
  awkRebuild0FromFields,
  awkLiteralGsubAll,
  awkLiteralSubFirst,
  awkParseSlashDelimitedRegex,
  awkExpandRegexReplacement,
  awkRegexGsubAll,
  awkRegexSubFirst,
  CP_HELP,
  parseCpArgv,
  cpOptionError,
  MV_HELP,
  parseMvArgv,
  mvOptionError,
  RM_HELP,
  parseRmArgv,
  rmOptionError,
  RMDIR_HELP,
  parseRmdirArgv,
  rmdirOptionError,
  UNLINK_HELP,
  parseUnlinkArgv,
  unlinkOptionError,
  ENV_HELP,
  parseEnvArgv,
  expandVariablesInString,
  combinedFetchSignal,
  fileItemUtf8ForDisplay,
  filterDirectoryEntriesForTabCompletion,
  parseLsDisplayFlags,
  sortDirectoryEntriesByName,
  escapeBashDoubleQuotedContent,
  formatDeclareXLine,
  parseMkdirArgv,
  CHMOD_HELP,
  parseChmodArgv,
  STAT_HELP,
  parseStatArgv,
  TYPE_HELP,
  parseTypeArgv,
  escapeTypeAliasBody,
  ALIAS_HELP,
  parseAliasArgv,
  aliasOptionError,
  typeOptionError,
  WHICH_HELP,
  parseWhichArgv,
  whichOptionError,
  HEAD_HELP,
  TAIL_HELP,
  parseLinesFilterArgv,
  WC_HELP,
  parseWcArgv,
  NL_HELP,
  parseNlArgv,
  formatNlNumberedText,
  nlFormatNumberField,
  PASTE_HELP,
  parsePasteArgv,
  pasteSplitLines,
  pasteJoinParallelRows,
  pasteJoinSerialRows,
  pasteFormatOutputLines,
  JOIN_HELP,
  parseJoinArgv,
  joinOptionError,
  joinSplitFields,
  joinBuildRecords,
  joinMergeRecords,
  joinEmitMatchedLine,
  joinCompareKeys,
  EXPAND_HELP,
  EXPAND_VERSION_LINE,
  parseExpandArgv,
  parseExpandTabStopsArg,
  expandExpandLine,
  expandExpandText,
  expandOptionError,
  FOLD_HELP,
  FOLD_VERSION_LINE,
  FOLD_DEFAULT_WIDTH,
  parseFoldArgv,
  foldFoldText,
  foldFoldLineChars,
  foldFoldLineBytes,
  foldOptionError,
  FMT_HELP,
  FMT_VERSION_LINE,
  FMT_DEFAULT_WIDTH,
  FMT_FMT_GOAL_NUMERATOR,
  FMT_FMT_GOAL_DENOMINATOR,
  fmtFmtDefaultGoal,
  parseFmtGoalValue,
  fmtInnerGoal,
  parseFmtArgv,
  fmtFmtText,
  fmtPrefixMatchLine,
  fmtLeadingSpaceCount,
  fmtWrapWordsCrown,
  fmtOptionError,
  SPLIT_HELP,
  SPLIT_VERSION_LINE,
  parseSplitArgv,
  splitOptionError,
  parseSplitByteSize,
  splitLinesWithSeparators,
  splitLinesBytes,
  splitGenerateSuffix,
  splitAlphabeticSuffix,
  splitNumericOrHexSuffix,
  splitMaxSuffixIndex,
  CSPLIT_HELP,
  CSPLIT_VERSION_LINE,
  parseCsplitArgv,
  csplitOptionError,
  expandCsplitPatternTokens,
  csplitComputeTextPieces,
  csplitComputeBinaryPieces,
  csplitFormatStdoutSizes,
  SORT_HELP,
  parseSortArgv,
  CUT_HELP,
  parseCutArgv,
  cutOptionError,
  parseCutListString,
  UNIQ_HELP,
  parseUniqArgv,
  READLINK_HELP,
  parseReadlinkArgv,
  readlinkOptionError,
  LN_HELP,
  parseLnArgv,
  lnOptionError,
  TOUCH_HELP,
  parseTouchArgv,
  touchOptionError,
  TEST_HELP,
  TEST_VERSION_LINE,
  parseTestArgv,
  TRUE_HELP,
  FALSE_HELP,
  parseTrueFalseArgv,
  symlinkBasenameForLn,
  PWD_HELP,
  parsePwdArgv,
  DATE_HELP,
  DATE_VERSION_LINE,
  parseDateArgv,
  dateOptionError,
  formatDateOutput,
  SEQ_HELP,
  SEQ_VERSION_LINE,
  parseSeqArgv,
  seqOptionError,
  genSeqSequence,
  formatSeqOutput,
  SLEEP_HELP,
  SLEEP_VERSION_LINE,
  parseSleepArgv,
  sleepOptionError,
  PRINTF_HELP,
  PRINTF_VERSION_LINE,
  parsePrintfArgv,
  printfOptionError,
  runPrintfFormat,
  vfsReadlinkCanonical,
  vfsFollowSymlinksToFile,
  BASENAME_HELP,
  BASENAME_VERSION_LINE,
  basenameCompute,
  parseBasenameArgv,
  DIRNAME_HELP,
  DIRNAME_VERSION_LINE,
  dirnameCompute,
  parseDirnameArgv,
  TR_HELP,
  parseTrArgv,
  trOptionError,
  expandTrSetString,
  runTr,
  XARGS_HELP,
  parseXargsArgv,
  xargsOptionError,
  xargsSplitWhitespaceWords,
  xargsSplitLines,
  xargsSplitNullRecords,
  xargsSubstituteInArgs,
  xargsFormatVerboseCommandLine
};

if (typeof globalThis !== 'undefined') {
  globalThis.ShellUtils = ShellUtils;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ShellUtils;
}

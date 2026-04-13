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
      if (ps.ok === false) {
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

export const LessLib = {
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
  lessOptionError,
  lessEscapeHtmlChunk,
  parseLessPlusStart
};

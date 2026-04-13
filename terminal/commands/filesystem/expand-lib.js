import { LessLib } from '../system/less-lib.js';

const _less = LessLib;

const EXPAND_VERSION_LINE = 'expand (jsh Heyming Terminal) 1.0\n';

const EXPAND_HELP = `Usage: expand [OPTION]... [FILE]...
Convert tabs to spaces; write to standard output.

  -i, --initial       do not convert tabs after non-blanks (GNU-style leading whitespace only)
  -t, --tabs=N        have tab stops every N columns (default ${_less.LESS_DEFAULT_TAB_STOPS})
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
      ? _less.LESS_DEFAULT_TAB_STOPS
      : Math.min(256, Math.max(1, Math.floor(Number(tabSpec.width))));
  if (!initialOnly) {
    return _less.lessExpandTabsInLine(line, w);
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
      width: _less.LESS_DEFAULT_TAB_STOPS
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
      if (p.ok === false) {
        return p;
      }
      tabSpec = p.tabSpec;
      i++;
      continue;
    }
    if (arg.startsWith('--tabs=')) {
      const v = arg.slice('--tabs='.length);
      const p = parseExpandTabStopsArg(v);
      if (p.ok === false) {
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
      if (p.ok === false) {
        return p;
      }
      tabSpec = p.tabSpec;
      i++;
      continue;
    }
    if (arg.startsWith('-t') && arg.length > 2) {
      const v = arg.slice(2);
      const p = parseExpandTabStopsArg(v);
      if (p.ok === false) {
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
            if (p.ok === false) {
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
          if (p.ok === false) {
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

export const ExpandLib = {
  EXPAND_HELP,
  EXPAND_VERSION_LINE,
  parseExpandArgv,
  parseExpandTabStopsArg,
  expandExpandLine,
  expandExpandText,
  expandOptionError
};

'use strict';

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
  /** @type {'a' | 'n' | 't'} */
  let bodyNumbering = 't';
  /** @type {'ln' | 'rn' | 'rz'} */
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
      if (r.ok === false) return r;
      bodyNumbering = r.value;
      i++;
      continue;
    }
    if (arg.startsWith('--body-numbering=')) {
      const v = arg.slice('--body-numbering='.length);
      const r = nlParseBodyNumberingStyle(v);
      if (r.ok === false) return r;
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
      if (r.ok === false) return r;
      numberFormat = r.value;
      i++;
      continue;
    }
    if (arg.startsWith('--number-format=')) {
      const v = arg.slice('--number-format='.length);
      const r = nlParseNumberFormat(v);
      if (r.ok === false) return r;
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
        if (r.ok === false) return r;
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
      if (r.ok === false) return r;
      bodyNumbering = r.value;
      i++;
      continue;
    }
    if (arg === '-n') {
      const next = argsArr[i + 1];
      if (next != null && !next.startsWith('-')) {
        const r = nlParseNumberFormat(next);
        if (r.ok === false) return r;
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
      if (r.ok === false) return r;
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

const NlLib = {
  NL_HELP,
  nlOptionError,
  nlParseBodyNumberingStyle,
  nlParseNumberFormat,
  parseNlArgv,
  nlFormatNumberField,
  formatNlNumberedText
};
if (typeof globalThis !== 'undefined') {
  /** @type {*} */ (globalThis).NlLib = NlLib;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = NlLib;
}

'use strict';

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
          return {
            ok: /** @type {false} */ (false),
            stderr: 'printf: missing conversion character\n',
            exitCode: 1
          };
        }
        if (spec.kind === 'literal') {
          out += '%';
          i = spec.end;
          continue;
        }
        if (argIdx >= args.length) {
          return { ok: /** @type {false} */ (false), stderr: 'printf: missing argument for format\n', exitCode: 1 };
        }
        const raw = args[argIdx++];
        const applied = printfApplySpec(spec, raw);
        if (applied.ok === false) {
          return { ok: /** @type {false} */ (false), stderr: applied.stderr, exitCode: 1 };
        }
        out += applied.text;
        i = spec.end;
        continue;
      }
      out += ch;
      i++;
    }
    return { ok: /** @type {true} */ (true), stdout: out, stderr };
  };

  const specCount = printfCountArgConsumingSpecs(format);
  if (specCount < 0) {
    return {
      ok: /** @type {false} */ (false),
      stderr: 'printf: missing conversion character\n',
      exitCode: 1
    };
  }

  if (specCount === 0) {
    const once = processOnePass();
    if (once.ok === false) {
      return /** @type {{ ok: false, stderr: string, exitCode: number }} */ (once);
    }
    if (argIdx < args.length) {
      stderr = `printf: warning: ignoring excess arguments, starting with '${args[argIdx]}'\n`;
    }
    return { ok: /** @type {true} */ (true), stdout: out, stderr };
  }

  do {
    const pass = processOnePass();
    if (pass.ok === false) {
      return /** @type {{ ok: false, stderr: string, exitCode: number }} */ (pass);
    }
  } while (argIdx < args.length);

  return { ok: /** @type {true} */ (true), stdout: out, stderr };
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

const PrintfLib = {
  PRINTF_HELP,
  PRINTF_VERSION_LINE,
  parsePrintfArgv,
  printfOptionError,
  runPrintfFormat
};
if (typeof globalThis !== 'undefined') { /** @type {*} */ (globalThis).PrintfLib = PrintfLib; }
if (typeof module !== 'undefined' && module.exports) { module.exports = PrintfLib; }

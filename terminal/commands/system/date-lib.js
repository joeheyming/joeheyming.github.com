'use strict';

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

const DateLib = {
  DATE_HELP,
  DATE_VERSION_LINE,
  dateOptionError,
  formatDateOutput,
  parseDateArgv
};
if (typeof globalThis !== 'undefined') {
  /** @type {*} */ (globalThis).DateLib = DateLib;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DateLib;
}

'use strict';

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
      return { ok: true, totalSeconds: 0, help: true };
    }
    if (a === '--version') {
      return { ok: true, totalSeconds: 0, version: true };
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
    if (p.ok === false) {
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

const SleepLib = {
  SLEEP_HELP,
  SLEEP_VERSION_LINE,
  sleepOptionError,
  parseSleepIntervalToken,
  parseSleepArgv
};
if (typeof globalThis !== 'undefined') {
  /** @type {*} */ (globalThis).SleepLib = SleepLib;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SleepLib;
}

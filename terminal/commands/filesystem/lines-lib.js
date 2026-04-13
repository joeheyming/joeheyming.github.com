'use strict';

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

const LinesLib = {
  HEAD_HELP,
  TAIL_HELP,
  linesCommandOptionError,
  parseLinesFilterArgv
};
if (typeof globalThis !== 'undefined') {
  /** @type {*} */ (globalThis).LinesLib = LinesLib;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = LinesLib;
}

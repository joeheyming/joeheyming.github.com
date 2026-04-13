'use strict';

/** @type {typeof LinesLib} */
const _lines =
  typeof LinesLib !== 'undefined'
    ? LinesLib
    : typeof require === 'function'
    ? // @ts-ignore Node require in tests
      require('./lines-lib.js')
    : /** @type {*} */ ({});
const linesCommandOptionError = _lines.linesCommandOptionError;

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

const UniqLib = {
  UNIQ_HELP,
  parseUniqArgv
};
if (typeof globalThis !== 'undefined') {
  /** @type {*} */ (globalThis).UniqLib = UniqLib;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = UniqLib;
}

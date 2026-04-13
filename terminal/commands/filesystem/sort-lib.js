import { LinesLib } from './lines-lib.js';

const { linesCommandOptionError } = LinesLib;

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

export const SortLib = {
  SORT_HELP,
  parseSortArgv
};

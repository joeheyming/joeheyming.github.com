import { LinesLib } from './lines-lib.js';

const { linesCommandOptionError } = LinesLib;

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

export const WcLib = {
  WC_HELP,
  parseWcArgv
};

const CAT_HELP = `Usage: cat [OPTION]... [FILE]...
Concatenate FILE(s) to standard output.

With no FILE, or when FILE is -, read standard input.

  -h, --help     display this help and exit

jsh:
  Symlink operands are followed to a regular file (cycle / depth limit).
  Not implemented vs GNU: -A, -b, -e, -E, -n, -s, -t, -T, -u, -v, --version.

Full documentation: <https://www.gnu.org/software/coreutils/cat>
`;

/**
 * GNU-style option error for cat (matches coreutils getopt messages).
 * @param {string} arg
 * @returns {string}
 */
function catOptionError(arg) {
  const tryLine = "Try 'cat --help' for more information.\n";
  if (arg.startsWith('--') && arg.length > 2) {
    return `cat: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `cat: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `cat: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * Parse jsh `cat` argv (GNU-ish: -h/--help, --, operands; `-` is stdin).
 *
 * @param {string[]} args
 * @returns {{ ok: true, operands: string[], help?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseCatArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  const operands = [];
  for (let i = 0; i < argsArr.length; i++) {
    const arg = argsArr[i];
    if (arg === '--') {
      operands.push(...argsArr.slice(i + 1));
      break;
    }
    if (arg === '--help' || arg === '-h') {
      return { ok: true, operands: [], help: true };
    }
    if (arg.startsWith('-') && arg.length > 1) {
      return { ok: false, stderr: catOptionError(arg), exitCode: 1 };
    }
    operands.push(arg, ...argsArr.slice(i + 1));
    break;
  }
  return { ok: true, operands };
}

export const CatLib = {
  CAT_HELP,
  catOptionError,
  parseCatArgv
};

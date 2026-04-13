const TEE_HELP = `Usage: tee [OPTION]... [FILE]...
Copy standard input to each FILE, and also to standard output.

  -a, --append              append to the given FILEs, do not overwrite
      --help                display this help and exit

When FILE is -, duplicate standard output.

jsh:
  -h is accepted as an alias for --help (GNU tee has no -h).
  Stdin is only from a pipe or \`< file\`; interactive terminal typing is not supported.
  Not implemented vs GNU: -i, -p, --output-error, --version.

Full documentation: <https://www.gnu.org/software/coreutils/tee>
`;

/**
 * GNU-style option error for tee (matches coreutils getopt messages).
 * @param {string} arg
 * @returns {string}
 */
function teeOptionError(arg) {
  const tryLine = "Try 'tee --help' for more information.\n";
  if (arg.startsWith('--') && arg.length > 2) {
    return `tee: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `tee: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `tee: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * Parse jsh `tee` argv (GNU-ish subset: -a/--append, -h/--help, --).
 *
 * @param {string[]} args
 * @returns {{ ok: true, append: boolean, files: string[], help?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseTeeArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  let append = false;
  const files = [];
  for (let i = 0; i < argsArr.length; i++) {
    const arg = argsArr[i];
    if (arg === '--help' || arg === '-h') {
      return { ok: true, append: false, files: [], help: true };
    }
    if (arg === '--append' || arg === '-a') {
      append = true;
      continue;
    }
    if (arg === '--') {
      files.push(...argsArr.slice(i + 1));
      break;
    }
    if (arg.startsWith('-') && arg.length > 1) {
      return { ok: false, stderr: teeOptionError(arg), exitCode: 1 };
    }
    files.push(arg, ...argsArr.slice(i + 1));
    break;
  }
  return { ok: true, append, files };
}

export const TeeLib = {
  TEE_HELP,
  teeOptionError,
  parseTeeArgv
};

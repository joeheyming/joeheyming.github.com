const READLINK_HELP = `Usage: readlink [OPTION]... FILE
Print value of a symbolic link or canonical file name.

  -f, --canonicalize            canonicalize by following every symlink (missing path OK)
  -e, --canonicalize-existing   canonicalize; entire path must exist
  -m, --canonicalize-missing    canonicalize; missing components are treated as missing
  -n, --no-newline              do not output the trailing delimiter
  -h, --help                    display this help and exit (jsh: -h is alias)
  --                            end of options

jsh:
  Default mode prints the stored symlink target (literal value), like GNU readlink without -f.
  Virtual paths use the same rules as resolveVirtualPath; symlink cycles are rejected.
  Not implemented vs GNU: -v/--verbose, --version.

Full documentation: <https://www.gnu.org/software/coreutils/readlink>
`;

/**
 * GNU-style option error for readlink.
 * @param {string} arg
 * @returns {string}
 */
function readlinkOptionError(arg) {
  const tryLine = `Try 'readlink --help' for more information.\n`;
  if (arg.startsWith('--') && arg.length > 2) {
    return `readlink: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `readlink: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `readlink: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * Parse jsh `readlink` argv: -n/-f/-e/-m, long forms, --, --help/-h, single FILE.
 *
 * @param {string[]} args
 * @returns {{ ok: true, noNewline: boolean, canonMode: 'none'|'f'|'e'|'m', operand: string, help?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseReadlinkArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  let noNewline = false;
  /** @type {'none'|'f'|'e'|'m'} */
  let canonMode = 'none';
  const operands = [];
  let i = 0;
  while (i < argsArr.length) {
    const arg = argsArr[i];
    if (arg === '--help' || arg === '-h') {
      return { ok: true, noNewline, canonMode, operand: '', help: true };
    }
    if (arg === '--') {
      operands.push(...argsArr.slice(i + 1));
      break;
    }
    if (arg === '-n' || arg === '--no-newline') {
      noNewline = true;
      i++;
      continue;
    }
    if (arg === '-f' || arg === '--canonicalize') {
      canonMode = 'f';
      i++;
      continue;
    }
    if (arg === '-e' || arg === '--canonicalize-existing') {
      canonMode = 'e';
      i++;
      continue;
    }
    if (arg === '-m' || arg === '--canonicalize-missing') {
      canonMode = 'm';
      i++;
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1 && !arg.startsWith('--')) {
      const rest = arg.slice(1);
      for (const c of rest) {
        if (c === 'n') noNewline = true;
        else if (c === 'f') canonMode = 'f';
        else if (c === 'e') canonMode = 'e';
        else if (c === 'm') canonMode = 'm';
        else if (c === 'v') {
          /* GNU -v is verbose; jsh ignores */
        } else {
          return { ok: false, stderr: readlinkOptionError(`-${c}`), exitCode: 1 };
        }
      }
      i++;
      continue;
    }
    if (arg.startsWith('--') && arg.length > 2) {
      return { ok: false, stderr: readlinkOptionError(arg), exitCode: 1 };
    }
    operands.push(arg, ...argsArr.slice(i + 1));
    break;
  }
  if (operands.length === 0) {
    return {
      ok: false,
      stderr: "readlink: missing operand\nTry 'readlink --help' for more information.\n",
      exitCode: 1
    };
  }
  if (operands.length > 1) {
    const extra = operands[1];
    return {
      ok: false,
      stderr: `readlink: extra operand '${extra}'\nTry 'readlink --help' for more information.\n`,
      exitCode: 1
    };
  }
  return { ok: true, noNewline, canonMode, operand: operands[0] };
}

export const ReadlinkLib = {
  READLINK_HELP,
  readlinkOptionError,
  parseReadlinkArgv
};

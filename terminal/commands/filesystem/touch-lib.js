const TOUCH_HELP = `Usage: touch [OPTION]... FILE...
Update the access and modification times of each FILE to the current time.

  -c, --no-create    do not create any files
  -h, --help         display this help and exit

jsh:
  Timestamps are updated by rewriting file metadata (same path) via the virtual FS.
  With -c, missing FILE operands are skipped silently (GNU-style).

  Not implemented vs GNU: -a, -m, -d, -t, -r, --reference, and GNU's -h
  (--no-dereference on symlinks). Here -h is --help like other jsh commands.

Try 'touch --help' on GNU coreutils for full option lists.
`;

/**
 * GNU-style option error for touch.
 * @param {string} arg
 * @returns {string}
 */
function touchOptionError(arg) {
  const tryLine = "Try 'touch --help' for more information.\n";
  if (arg.startsWith('--') && arg.length > 2) {
    return `touch: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `touch: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `touch: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * Parse jsh `touch` argv: -c/--no-create, --, -h/--help.
 *
 * @param {string[]} args
 * @returns {{ ok: true, noCreate: boolean, operands: string[], help?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseTouchArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  let noCreate = false;
  const operands = [];
  let i = 0;
  while (i < argsArr.length) {
    const arg = argsArr[i];
    if (arg === '--help' || arg === '-h') {
      return { ok: true, noCreate: false, operands: [], help: true };
    }
    if (arg === '--') {
      operands.push(...argsArr.slice(i + 1));
      break;
    }
    if (arg === '-c' || arg === '--no-create') {
      noCreate = true;
      i++;
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1 && !arg.startsWith('--')) {
      const rest = arg.slice(1);
      for (const c of rest) {
        if (c === 'c') {
          noCreate = true;
        } else if (c === 'h') {
          return { ok: true, noCreate: false, operands: [], help: true };
        } else {
          return { ok: false, stderr: touchOptionError(`-${c}`), exitCode: 1 };
        }
      }
      i++;
      continue;
    }
    if (arg.startsWith('--') && arg.length > 2) {
      return { ok: false, stderr: touchOptionError(arg), exitCode: 1 };
    }
    operands.push(arg, ...argsArr.slice(i + 1));
    break;
  }
  if (!operands.length) {
    return { ok: false, stderr: 'touch: missing file operand\n', exitCode: 1 };
  }
  return { ok: true, noCreate, operands };
}

export const TouchLib = {
  TOUCH_HELP,
  touchOptionError,
  parseTouchArgv
};

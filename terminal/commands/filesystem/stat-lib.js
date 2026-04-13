const STAT_HELP = `Usage: stat [OPTION]... FILE...
Display file status (GNU-like summary; jsh VFS).

Options:
  -L, --dereference   follow symlinks and stat the target
  -h, --help          display this help and exit

jsh:
  Default output is a short multi-line block (not full GNU \`stat -c\` formats).
  Inode/device IDs are not modeled; shown as 0. Timestamps use the virtual FS
  \`modified\` field for Access/Modify/Change.

Not implemented vs GNU: \`-c\`, \`-t\`, \`--file-system\`, \`--printf\`, BSD flags.
`;

/**
 * GNU-style option error for stat.
 * @param {string} arg
 * @returns {string}
 */
function statOptionError(arg) {
  const tryLine = "Try 'stat --help' for more information.\n";
  if (arg.startsWith('--') && arg.length > 2) {
    return `stat: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `stat: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `stat: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * Parse jsh `stat` argv (GNU-ish subset: -L/--dereference, -h/--help, --).
 *
 * @param {string[]} args
 * @returns {{ ok: true, dereference: boolean, operands: string[], help?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseStatArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  let dereference = false;
  const operands = [];
  for (let i = 0; i < argsArr.length; i++) {
    const a = argsArr[i];
    if (a === '--') {
      operands.push(...argsArr.slice(i + 1));
      break;
    }
    if (a === '--help' || a === '-h') {
      return { ok: true, dereference: false, operands: [], help: true };
    }
    if (a === '--dereference' || a === '-L') {
      dereference = true;
      continue;
    }
    if (a.startsWith('-') && a.length > 1) {
      if (a.startsWith('--')) {
        return { ok: false, stderr: statOptionError(a), exitCode: 1 };
      }
      for (let j = 1; j < a.length; j++) {
        const c = a[j];
        if (c === 'L') {
          dereference = true;
        } else if (c === 'h') {
          return { ok: true, dereference: false, operands: [], help: true };
        } else {
          return { ok: false, stderr: statOptionError(`-${c}`), exitCode: 1 };
        }
      }
      continue;
    }
    operands.push(a, ...argsArr.slice(i + 1));
    break;
  }
  if (!operands.length) {
    return { ok: false, stderr: 'stat: missing operand\n', exitCode: 1 };
  }
  return { ok: true, dereference, operands };
}

export const StatLib = {
  STAT_HELP,
  statOptionError,
  parseStatArgv
};

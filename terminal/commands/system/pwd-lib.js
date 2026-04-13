const PWD_HELP = `Usage: pwd [OPTION]...
Print the full filename of the current working directory.

  -L, --logical   print logical path (default; jsh uses terminal cwd)
  -P, --physical  resolve symlinks in the path
  -h, --help      display this help and exit

jsh:
  -L does not consult the PWD environment variable; logical cwd is the shell's current directory.
  Not implemented vs GNU: --version.

Full documentation: <https://www.gnu.org/software/coreutils/manual/html_node/pwd-invocation.html>
`;

/**
 * GNU-style option error for pwd.
 * @param {string} arg
 * @returns {string}
 */
function pwdOptionError(arg) {
  const tryLine = "Try 'pwd --help' for more information.\n";
  if (arg.startsWith('--') && arg.length > 2) {
    return `pwd: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `pwd: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `pwd: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * Parse jsh `pwd` argv: -L/--logical, -P/--physical, -h/--help, --, rejects operands.
 *
 * @param {string[]} args
 * @returns {{ ok: true, physical: boolean, help?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parsePwdArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  let physical = false;
  let i = 0;
  for (; i < argsArr.length; i++) {
    const a = argsArr[i];
    if (a === '--') {
      i++;
      break;
    }
    if (a === '--help' || a === '-h') {
      return { ok: true, physical: false, help: true };
    }
    if (a === '-L' || a === '--logical') {
      physical = false;
      continue;
    }
    if (a === '-P' || a === '--physical') {
      physical = true;
      continue;
    }
    if (a.startsWith('-') && a.length > 1) {
      if (a.startsWith('--')) {
        return { ok: false, stderr: pwdOptionError(a), exitCode: 2 };
      }
      for (let j = 1; j < a.length; j++) {
        const c = a[j];
        if (c === 'L') {
          physical = false;
        } else if (c === 'P') {
          physical = true;
        } else {
          return { ok: false, stderr: pwdOptionError(`-${c}`), exitCode: 2 };
        }
      }
      continue;
    }
    break;
  }
  const operands = argsArr.slice(i).filter((n) => n !== '');
  if (operands.length > 0) {
    return {
      ok: false,
      stderr: `pwd: extra operand '${operands[0]}'\nTry 'pwd --help' for more information.\n`,
      exitCode: 1
    };
  }
  return { ok: true, physical };
}

export const PwdLib = {
  PWD_HELP,
  pwdOptionError,
  parsePwdArgv
};

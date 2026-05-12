/**
 * GNU-style option error for awk (exit status 2).
 * @param {string} arg
 * @returns {string}
 */
function awkOptionError(arg) {
  const tryLine = "Try 'awk --help' for more information.\n";
  if (arg.startsWith('--') && arg.length > 2) {
    return `awk: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `awk: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `awk: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * Parse jsh `awk` argv: -F/--field-separator, --help/-h, --, program, FILEs.
 *
 * @param {string[]} args
 * @returns {{ ok: true, fieldSeparator: string, program: string, fileOperands: string[], help?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseAwkArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  let fieldSeparator = ' ';
  let i = 0;
  while (i < argsArr.length) {
    const arg = argsArr[i];
    if (arg === '--') {
      const rest = argsArr.slice(i + 1);
      if (rest.length === 0) {
        return { ok: false, stderr: 'awk: missing program\n', exitCode: 2 };
      }
      return {
        ok: true,
        fieldSeparator,
        program: rest[0],
        fileOperands: rest.slice(1)
      };
    }
    if (arg === '--help' || arg === '-h') {
      return { ok: true, help: true, fieldSeparator, program: '', fileOperands: [] };
    }
    if (arg === '-F' || arg === '--field-separator') {
      if (i + 1 >= argsArr.length) {
        return {
          ok: false,
          stderr: "awk: option requires an argument -- 'F'\n",
          exitCode: 2
        };
      }
      fieldSeparator = argsArr[i + 1];
      i += 2;
      continue;
    }
    if (arg.startsWith('--field-separator=')) {
      const rest = arg.slice('--field-separator='.length);
      if (rest === '') {
        return {
          ok: false,
          stderr: "awk: option requires an argument -- 'field-separator'\n",
          exitCode: 2
        };
      }
      fieldSeparator = rest;
      i++;
      continue;
    }
    if (arg.startsWith('-F') && arg.length > 2) {
      fieldSeparator = arg.slice(2);
      i++;
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1 && !arg.startsWith('--')) {
      return { ok: false, stderr: awkOptionError(arg), exitCode: 2 };
    }
    if (arg.startsWith('--') && arg.length > 2) {
      return { ok: false, stderr: awkOptionError(arg), exitCode: 2 };
    }
    return {
      ok: true,
      fieldSeparator,
      program: arg,
      fileOperands: argsArr.slice(i + 1)
    };
  }
  return { ok: false, stderr: 'awk: missing program\n', exitCode: 2 };
}

export { awkOptionError, parseAwkArgv };

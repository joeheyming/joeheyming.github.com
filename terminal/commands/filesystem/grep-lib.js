const GREP_HELP = `Usage: grep [OPTION]... PATTERN [FILE]...
Search for PATTERN in each FILE or standard input.

  -i, --ignore-case        ignore case distinctions in patterns and data
  -n, --line-number        print line numbers with output lines
  -v, --invert-match       select non-matching lines
  -h, --no-filename        suppress the file name prefix on output
      --help               display this help and exit

jsh:
  PATTERN is a literal substring (not POSIX regular expressions). Use --
  before PATTERN or FILE that starts with '-'. Operand '-' reads standard
  input. GNU grep uses **-h** for **--no-filename** (not help); use **--help**
  for usage.

Full documentation: <https://www.gnu.org/software/grep/manual/html_node/grep-invocation.html>
`;

/**
 * GNU-style option error for grep (exit status 2).
 * @param {string} arg
 * @returns {string}
 */
function grepOptionError(arg) {
  const tryLine = "Try 'grep --help' for more information.\n";
  if (arg.startsWith('--') && arg.length > 2) {
    return `grep: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `grep: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `grep: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * Parse jsh `grep` argv: -i/-n/-v/-h, --help, --, PATTERN then FILE operands.
 *
 * @param {string[]} args
 * @returns {{ ok: true, caseInsensitive: boolean, lineNumbers: boolean, invertMatch: boolean, noFilename: boolean, pattern: string, fileOperands: string[], help?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseGrepArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  let caseInsensitive = false;
  let lineNumbers = false;
  let invertMatch = false;
  let noFilename = false;
  let i = 0;
  while (i < argsArr.length) {
    const arg = argsArr[i];
    if (arg === '--') {
      const rest = argsArr.slice(i + 1);
      if (rest.length === 0) {
        return { ok: false, stderr: 'grep: missing operand\n', exitCode: 2 };
      }
      return {
        ok: true,
        caseInsensitive,
        lineNumbers,
        invertMatch,
        noFilename,
        pattern: rest[0],
        fileOperands: rest.slice(1)
      };
    }
    if (arg === '--help') {
      return {
        ok: true,
        help: true,
        caseInsensitive,
        lineNumbers,
        invertMatch,
        noFilename,
        pattern: '',
        fileOperands: []
      };
    }
    if (arg === '-i' || arg === '--ignore-case') {
      caseInsensitive = true;
      i++;
      continue;
    }
    if (arg === '-n' || arg === '--line-number') {
      lineNumbers = true;
      i++;
      continue;
    }
    if (arg === '-v' || arg === '--invert-match') {
      invertMatch = true;
      i++;
      continue;
    }
    if (arg === '-h' || arg === '--no-filename') {
      noFilename = true;
      i++;
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1 && !arg.startsWith('--')) {
      for (let j = 1; j < arg.length; j++) {
        const c = arg[j];
        if (c === 'i') caseInsensitive = true;
        else if (c === 'n') lineNumbers = true;
        else if (c === 'v') invertMatch = true;
        else if (c === 'h') noFilename = true;
        else {
          return { ok: false, stderr: grepOptionError(`-${c}`), exitCode: 2 };
        }
      }
      i++;
      continue;
    }
    if (arg.startsWith('--') && arg.length > 2) {
      return { ok: false, stderr: grepOptionError(arg), exitCode: 2 };
    }
    return {
      ok: true,
      caseInsensitive,
      lineNumbers,
      invertMatch,
      noFilename,
      pattern: arg,
      fileOperands: argsArr.slice(i + 1)
    };
  }
  return { ok: false, stderr: 'grep: missing operand\n', exitCode: 2 };
}

export const GrepLib = {
  GREP_HELP,
  grepOptionError,
  parseGrepArgv
};

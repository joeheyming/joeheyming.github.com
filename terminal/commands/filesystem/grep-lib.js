const GREP_HELP = `Usage: grep [OPTION]... PATTERN [FILE]...
Search for PATTERN in each FILE or standard input.

  -E, --extended-regexp    PATTERN is an ERE (default in jsh: ERE-flavor regex)
  -F, --fixed-strings      PATTERN is a fixed literal (no regex)
  -i, --ignore-case        ignore case distinctions in patterns and data
  -n, --line-number        print line numbers with output lines
  -v, --invert-match       select non-matching lines
  -w, --word-regexp        match whole words only
  -h, --no-filename        suppress the file name prefix on output
  -l, --files-with-matches print only names of FILEs with selected lines
  -L, --files-without-match print only names of FILEs without selected lines
  -r, --recursive          read all files under each directory, recursively
      --color[=WHEN]       colorize the output (never|always|auto)
      --help               display this help and exit

jsh:
  PATTERN is a JS RegExp by default. Use -F for fixed/literal matching. Use
  -- before PATTERN or FILE that starts with '-'. Operand '-' reads standard
  input. GNU grep uses -h for --no-filename (not help); use --help.

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
 * Parse jsh `grep` argv (B9: regex-by-default, -E/-F/-w/-r/-l/-L/--color).
 *
 * @param {string[]} args
 * @returns {{ ok: true, caseInsensitive: boolean, lineNumbers: boolean, invertMatch: boolean, noFilename: boolean, fixedStrings: boolean, extended: boolean, wholeWord: boolean, recursive: boolean, filesWithMatches: boolean, filesWithoutMatch: boolean, color: 'never'|'always'|'auto', pattern: string, fileOperands: string[], help?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseGrepArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  let caseInsensitive = false;
  let lineNumbers = false;
  let invertMatch = false;
  let noFilename = false;
  let fixedStrings = false;
  let extended = false;
  let wholeWord = false;
  let recursive = false;
  let filesWithMatches = false;
  let filesWithoutMatch = false;
  /** @type {'never'|'always'|'auto'} */
  let color = 'never';
  let i = 0;
  const finalize = (pattern, fileOperands) => ({
    ok: true,
    caseInsensitive,
    lineNumbers,
    invertMatch,
    noFilename,
    fixedStrings,
    extended,
    wholeWord,
    recursive,
    filesWithMatches,
    filesWithoutMatch,
    color,
    pattern,
    fileOperands
  });
  while (i < argsArr.length) {
    const arg = argsArr[i];
    if (arg === '--') {
      const rest = argsArr.slice(i + 1);
      if (rest.length === 0) {
        return { ok: false, stderr: 'grep: missing operand\n', exitCode: 2 };
      }
      return finalize(rest[0], rest.slice(1));
    }
    if (arg === '--help') {
      return { ...finalize('', []), help: true };
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
    if (arg === '-E' || arg === '--extended-regexp') {
      extended = true;
      i++;
      continue;
    }
    if (arg === '-F' || arg === '--fixed-strings') {
      fixedStrings = true;
      i++;
      continue;
    }
    if (arg === '-w' || arg === '--word-regexp') {
      wholeWord = true;
      i++;
      continue;
    }
    if (arg === '-r' || arg === '-R' || arg === '--recursive') {
      recursive = true;
      i++;
      continue;
    }
    if (arg === '-l' || arg === '--files-with-matches') {
      filesWithMatches = true;
      i++;
      continue;
    }
    if (arg === '-L' || arg === '--files-without-match') {
      filesWithoutMatch = true;
      i++;
      continue;
    }
    if (arg === '--color' || arg === '--color=auto') {
      color = 'auto';
      i++;
      continue;
    }
    if (arg === '--color=never' || arg === '--colour=never') {
      color = 'never';
      i++;
      continue;
    }
    if (arg === '--color=always' || arg === '--colour=always') {
      color = 'always';
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
        else if (c === 'E') extended = true;
        else if (c === 'F') fixedStrings = true;
        else if (c === 'w') wholeWord = true;
        else if (c === 'r' || c === 'R') recursive = true;
        else if (c === 'l') filesWithMatches = true;
        else if (c === 'L') filesWithoutMatch = true;
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
    return finalize(arg, argsArr.slice(i + 1));
  }
  return { ok: false, stderr: 'grep: missing operand\n', exitCode: 2 };
}

/**
 * Build a RegExp for grep given the flags.
 * @param {{pattern:string, caseInsensitive:boolean, extended:boolean, fixedStrings:boolean, wholeWord:boolean}} opts
 * @returns {RegExp|{ ok:false, stderr:string }}
 */
function buildGrepRegex(opts) {
  let src;
  if (opts.fixedStrings) {
    src = opts.pattern.replace(/[\\^$.|?*+()[\]{}]/g, '\\$&');
  } else {
    src = opts.pattern;
    // jsh BRE/ERE compromise: just use JS regex.
    void opts.extended;
  }
  if (opts.wholeWord) {
    src = `(?:^|\\W)(?:${src})(?=\\W|$)`;
  }
  try {
    return new RegExp(src, opts.caseInsensitive ? 'i' : '');
  } catch (err) {
    return { ok: false, stderr: `grep: invalid regular expression: ${err.message}\n` };
  }
}

export const GrepLib = {
  GREP_HELP,
  grepOptionError,
  parseGrepArgv,
  buildGrepRegex
};

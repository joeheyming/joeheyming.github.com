const XARGS_HELP = `Usage: xargs [OPTION]... [COMMAND [INITIAL-ARGS]...]
Build and execute COMMAND lines from standard input.

  -0, --null                  input items are null-separated, not whitespace-separated
  -d DELIM, --delimiter=DELIM use DELIM as the input item separator (supports \\n, \\t, \\0)
  -I REPLACE-STR              replace REPLACE-STR in INITIAL-ARGS with each input record
      --replace=REPLACE-STR
  -n MAX-ARGS, --max-args=MAX-ARGS   use at most MAX-ARGS input items per invocation
  -P MAX-PROCS                in GNU xargs, run up to MAX-PROCS in parallel; jsh treats
                              this as -P 1 (no real parallelism in a single-tab JS runtime)
  -t, --verbose               print each command before executing (to stderr)
  -h, --help                  display this help and exit
  --                          end of options

If COMMAND is omitted, echo is used (GNU-style).

jsh:
  Reads stdin only (pipe or redirect). Whitespace mode splits on runs of whitespace;
  -0 (alias for -d '\\0') splits on NUL bytes; -d DELIM splits on the given delimiter.
  With -I/--replace, each line (or -0 record) is one substitution; empty stdin yields
  zero invocations. Child commands run with empty stdin. Exit status is 0 only if every
  invocation exits 0; otherwise 1.
  Not implemented vs GNU: -s, -x, -r, --show-limits, line limits, env -0, shell -I.
  -P is parsed but treated as -P 1 (documented stub).

Full documentation: <https://www.gnu.org/software/findutils/manual/html_node/xargs-options.html>
`;

/**
 * @param {string} arg
 * @returns {string}
 */
function xargsOptionError(arg) {
  const tryLine = `Try 'xargs --help' for more information.\n`;
  if (arg.startsWith('--') && arg.length > 2) {
    return `xargs: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `xargs: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `xargs: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * Split xargs stdin into words (GNU-like whitespace runs).
 * @param {string} stdin
 * @returns {string[]}
 */
function xargsSplitWhitespaceWords(stdin) {
  const s = String(stdin ?? '');
  const t = s.trim();
  if (t === '') return [];
  return t.split(/\s+/);
}

/**
 * Split xargs stdin into lines for -I mode (drop only a final empty segment from trailing newline).
 * @param {string} stdin
 * @returns {string[]}
 */
function xargsSplitLines(stdin) {
  const s = String(stdin ?? '');
  const parts = s.split(/\r?\n/);
  if (parts.length && parts[parts.length - 1] === '') {
    parts.pop();
  }
  return parts;
}

/**
 * Split xargs stdin into NUL-terminated records (drop only a final empty after trailing NUL).
 * @param {string} stdin
 * @returns {string[]}
 */
function xargsSplitNullRecords(stdin) {
  const s = String(stdin ?? '');
  const parts = s.split('\0');
  if (parts.length && parts[parts.length - 1] === '') {
    parts.pop();
  }
  return parts;
}

/**
 * Interpret GNU-style escape sequences in a -d argument:
 *   \\n \\t \\r \\0 \\\\
 * @param {string} raw
 * @returns {string}
 */
function xargsDecodeDelim(raw) {
  if (raw == null || raw === '') return '';
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c !== '\\' || i + 1 >= raw.length) {
      out += c;
      continue;
    }
    const nxt = raw[i + 1];
    if (nxt === 'n') out += '\n';
    else if (nxt === 't') out += '\t';
    else if (nxt === 'r') out += '\r';
    else if (nxt === '0') out += '\0';
    else if (nxt === '\\') out += '\\';
    else out += '\\' + nxt;
    i++;
  }
  return out;
}

/**
 * Split xargs stdin on a single-character (or multi-char) delimiter (-d DELIM).
 * Does not strip whitespace inside fields. Trailing delim → drop trailing empty.
 * @param {string} stdin
 * @param {string} delim
 * @returns {string[]}
 */
function xargsSplitOnDelim(stdin, delim) {
  const s = String(stdin ?? '');
  if (s === '') return [];
  if (!delim) return [s];
  const parts = s.split(delim);
  if (parts.length && parts[parts.length - 1] === '') {
    parts.pop();
  }
  return parts;
}

/**
 * Substitute replaceStr with record in each initial argument (GNU -I).
 * @param {string[]} args
 * @param {string} replaceStr
 * @param {string} record
 * @returns {string[]}
 */
function xargsSubstituteInArgs(args, replaceStr, record) {
  return args.map((a) => String(a).split(replaceStr).join(record));
}

/**
 * @param {string} name
 * @param {string[]} args
 * @returns {string}
 */
function xargsFormatVerboseCommandLine(name, args) {
  const parts = [name, ...args].map((p) => {
    if (/[\s"'\\]/.test(p)) {
      return `'${String(p).replace(/'/g, `'\\''`)}'`;
    }
    return p;
  });
  return parts.join(' ');
}

/**
 * Parse jsh `xargs` argv.
 *
 * @param {string[]} args
 * @returns {{ ok: true, nullDelim: boolean, maxArgs: number|null, replaceStr: string|null, verbose: boolean, command: string[], help?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseXargsArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  let nullDelim = false;
  let maxArgs = null;
  let replaceStr = null;
  let verbose = false;
  let delim = null; // raw user delimiter (decoded)
  let maxProcs = 1;
  const operands = [];
  let i = 0;

  while (i < argsArr.length) {
    const arg = argsArr[i];
    if (arg === '--help' || arg === '-h') {
      return {
        ok: true,
        nullDelim,
        maxArgs,
        replaceStr,
        verbose,
        delim,
        maxProcs,
        command: [],
        help: true
      };
    }
    if (arg === '--') {
      operands.push(...argsArr.slice(i + 1));
      break;
    }
    if (arg === '-0' || arg === '--null') {
      nullDelim = true;
      delim = '\0';
      i++;
      continue;
    }
    if (arg === '-t' || arg === '--verbose') {
      verbose = true;
      i++;
      continue;
    }
    if (arg === '-d' || arg === '--delimiter') {
      if (i + 1 >= argsArr.length) {
        return {
          ok: false,
          stderr: `xargs: option '${arg}' requires an argument\nTry 'xargs --help' for more information.\n`,
          exitCode: 2
        };
      }
      delim = xargsDecodeDelim(String(argsArr[i + 1]));
      if (delim === '\0') nullDelim = true;
      i += 2;
      continue;
    }
    if (arg.startsWith('--delimiter=')) {
      delim = xargsDecodeDelim(arg.slice('--delimiter='.length));
      if (delim === '\0') nullDelim = true;
      i++;
      continue;
    }
    if (arg === '-P') {
      if (i + 1 >= argsArr.length) {
        return {
          ok: false,
          stderr: `xargs: option requires an argument -- 'P'\nTry 'xargs --help' for more information.\n`,
          exitCode: 2
        };
      }
      const n = parseInt(String(argsArr[i + 1]), 10);
      if (!Number.isFinite(n) || n < 0) {
        return {
          ok: false,
          stderr: `xargs: invalid number for -P option\nTry 'xargs --help' for more information.\n`,
          exitCode: 2
        };
      }
      // Documented stub: jsh is single-tab JS, no real parallelism.
      maxProcs = 1;
      i += 2;
      continue;
    }
    if (arg === '-I' || arg === '--replace') {
      if (i + 1 >= argsArr.length) {
        return {
          ok: false,
          stderr: `xargs: option '${arg}' requires an argument\nTry 'xargs --help' for more information.\n`,
          exitCode: 2
        };
      }
      replaceStr = argsArr[i + 1];
      i += 2;
      continue;
    }
    if (arg.startsWith('--replace=')) {
      replaceStr = arg.slice('--replace='.length);
      i++;
      continue;
    }
    if (arg === '-n' || arg === '--max-args') {
      if (i + 1 >= argsArr.length) {
        return {
          ok: false,
          stderr: `xargs: option requires an argument -- '${arg}'\nTry 'xargs --help' for more information.\n`,
          exitCode: 2
        };
      }
      const n = parseInt(String(argsArr[i + 1]), 10);
      if (!Number.isFinite(n) || n < 1) {
        return {
          ok: false,
          stderr: `xargs: invalid number for -n option\nTry 'xargs --help' for more information.\n`,
          exitCode: 2
        };
      }
      maxArgs = n;
      i += 2;
      continue;
    }
    if (arg.startsWith('--max-args=')) {
      const raw = arg.slice('--max-args='.length);
      const n = parseInt(raw, 10);
      if (!Number.isFinite(n) || n < 1) {
        return {
          ok: false,
          stderr: `xargs: invalid number for --max-args option\nTry 'xargs --help' for more information.\n`,
          exitCode: 2
        };
      }
      maxArgs = n;
      i++;
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1 && !arg.startsWith('--')) {
      const rest = arg.slice(1);
      let j = 0;
      while (j < rest.length) {
        const c = rest[j];
        if (c === '0') {
          nullDelim = true;
          delim = '\0';
          j++;
        } else if (c === 't') {
          verbose = true;
          j++;
        } else if (c === 'h') {
          return {
            ok: true,
            nullDelim,
            maxArgs,
            replaceStr,
            verbose,
            delim,
            maxProcs,
            command: [],
            help: true
          };
        } else if (c === 'I') {
          const tail = rest.slice(j + 1);
          if (tail.length > 0) {
            replaceStr = tail;
            j = rest.length;
          } else {
            if (i + 1 >= argsArr.length) {
              return {
                ok: false,
                stderr: `xargs: option requires an argument -- 'I'\nTry 'xargs --help' for more information.\n`,
                exitCode: 2
              };
            }
            replaceStr = argsArr[i + 1];
            i++;
            j = rest.length;
          }
        } else if (c === 'n') {
          const tail = rest.slice(j + 1);
          let numStr = tail;
          if (numStr === '' || !/^\d+$/.test(numStr)) {
            if (i + 1 >= argsArr.length) {
              return {
                ok: false,
                stderr: `xargs: option requires an argument -- 'n'\nTry 'xargs --help' for more information.\n`,
                exitCode: 2
              };
            }
            numStr = String(argsArr[i + 1]);
            i++;
          }
          const n = parseInt(numStr, 10);
          if (!Number.isFinite(n) || n < 1) {
            return {
              ok: false,
              stderr: `xargs: invalid number for -n option\nTry 'xargs --help' for more information.\n`,
              exitCode: 2
            };
          }
          maxArgs = n;
          j = rest.length;
        } else {
          return { ok: false, stderr: xargsOptionError(`-${c}`), exitCode: 2 };
        }
      }
      i++;
      continue;
    }
    if (arg.startsWith('--') && arg.length > 2) {
      return { ok: false, stderr: xargsOptionError(arg), exitCode: 2 };
    }
    operands.push(arg, ...argsArr.slice(i + 1));
    break;
  }

  let command = operands.length > 0 ? operands.slice() : ['echo'];
  if (command.length === 0) {
    command = ['echo'];
  }

  if (replaceStr != null && maxArgs != null) {
    maxArgs = null;
  }

  return {
    ok: true,
    nullDelim,
    maxArgs,
    replaceStr,
    verbose,
    delim,
    maxProcs,
    command
  };
}

export const XargsLib = {
  XARGS_HELP,
  xargsOptionError,
  xargsSplitWhitespaceWords,
  xargsSplitLines,
  xargsSplitNullRecords,
  xargsSplitOnDelim,
  xargsDecodeDelim,
  xargsSubstituteInArgs,
  xargsFormatVerboseCommandLine,
  parseXargsArgv
};

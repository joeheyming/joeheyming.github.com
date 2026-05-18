const STAT_HELP = `Usage: stat [OPTION]... FILE...
Display file status (GNU-like summary; jsh VFS).

Options:
  -L, --dereference   follow symlinks and stat the target
  -c FORMAT, --format=FORMAT
                      use FORMAT instead of the default; appends a newline
  --printf=FORMAT     like -c FORMAT but interprets backslash escapes and
                      does not append a newline
  -h, --help          display this help and exit

Supported format specifiers (subset of GNU stat):
  %n  file name (as given)        %F  file type (regular file / directory / …)
  %s  total size, in bytes        %a  access rights in octal
  %A  access rights human-readable (e.g. -rw-r--r--)
  %u  owner user ID               %U  owner user name (from env USER)
  %g  owner group ID              %G  owner group name (from env USER)
  %i  inode (always 0; not modeled)
  %h  hard link count (always 1)
  %t  device major / %T device minor (always 0)
  %b  number of allocated 512-byte blocks
  %y  time of last data modification, human-readable
  %Y  time of last data modification, seconds since epoch
  %X / %x  last access (mirrors modification time)
  %Z / %z  last status change (mirrors modification time)
  %%  literal %

jsh:
  Inode/device IDs are not modeled; shown as 0. All three timestamps mirror
  the VFS \`modified\` field. \`--format\` adds a trailing newline; \`--printf\`
  does not, and decodes \\n / \\t / \\\\ in the format string.
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
 * Decode backslash escapes (\\n, \\t, \\r, \\\\) inside a --printf FORMAT.
 * @param {string} s
 * @returns {string}
 */
function statDecodePrintfFormat(s) {
  if (s == null) return '';
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== '\\' || i + 1 >= s.length) {
      out += c;
      continue;
    }
    const nxt = s[i + 1];
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
 * Parse jsh `stat` argv (GNU-ish subset: -L, -c, --printf, -h, --).
 *
 * @param {string[]} args
 * @returns {{ ok: true, dereference: boolean, operands: string[], format: string|null, addNewline: boolean, help?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseStatArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  let dereference = false;
  let format = null;
  let addNewline = true; // -c / --format adds \n; --printf does not
  const operands = [];
  for (let i = 0; i < argsArr.length; i++) {
    const a = argsArr[i];
    if (a === '--') {
      operands.push(...argsArr.slice(i + 1));
      break;
    }
    if (a === '--help' || a === '-h') {
      return {
        ok: true,
        dereference: false,
        operands: [],
        format: null,
        addNewline: true,
        help: true
      };
    }
    if (a === '--dereference' || a === '-L') {
      dereference = true;
      continue;
    }
    if (a === '-c' || a === '--format') {
      if (i + 1 >= argsArr.length) {
        return {
          ok: false,
          stderr: `stat: option requires an argument -- '${a}'\nTry 'stat --help' for more information.\n`,
          exitCode: 1
        };
      }
      format = String(argsArr[i + 1]);
      addNewline = true;
      i++;
      continue;
    }
    if (a.startsWith('--format=')) {
      format = a.slice('--format='.length);
      addNewline = true;
      continue;
    }
    if (a.startsWith('--printf=')) {
      format = statDecodePrintfFormat(a.slice('--printf='.length));
      addNewline = false;
      continue;
    }
    if (a === '--printf') {
      if (i + 1 >= argsArr.length) {
        return {
          ok: false,
          stderr: "stat: option '--printf' requires an argument\nTry 'stat --help' for more information.\n",
          exitCode: 1
        };
      }
      format = statDecodePrintfFormat(String(argsArr[i + 1]));
      addNewline = false;
      i++;
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
          return {
            ok: true,
            dereference: false,
            operands: [],
            format: null,
            addNewline: true,
            help: true
          };
        } else if (c === 'c') {
          // -cFORMAT or "-c" followed by next arg
          const tail = a.slice(j + 1);
          if (tail.length > 0) {
            format = tail;
            addNewline = true;
            j = a.length;
          } else {
            if (i + 1 >= argsArr.length) {
              return {
                ok: false,
                stderr: "stat: option requires an argument -- 'c'\nTry 'stat --help' for more information.\n",
                exitCode: 1
              };
            }
            format = String(argsArr[i + 1]);
            addNewline = true;
            i++;
            j = a.length;
          }
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
  return { ok: true, dereference, operands, format, addNewline };
}

/**
 * Apply a stat FORMAT string to a stats record. The vars object provides
 * resolved values; unknown specifiers are emitted as `?` like GNU.
 * @param {string} format
 * @param {Record<string, string|number>} vars
 * @returns {string}
 */
function statApplyFormat(format, vars) {
  if (format == null) return '';
  let out = '';
  for (let i = 0; i < format.length; i++) {
    const c = format[i];
    if (c !== '%' || i + 1 >= format.length) {
      out += c;
      continue;
    }
    const spec = format[i + 1];
    i++;
    if (spec === '%') {
      out += '%';
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(vars, spec)) {
      out += String(vars[spec]);
    } else {
      out += '?';
    }
  }
  return out;
}

export const StatLib = {
  STAT_HELP,
  statOptionError,
  statDecodePrintfFormat,
  parseStatArgv,
  statApplyFormat
};

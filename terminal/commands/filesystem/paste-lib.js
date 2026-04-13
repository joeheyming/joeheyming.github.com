const PASTE_HELP = `Usage: paste [OPTION]... [FILE]...
Merge lines of files; write to standard output.

  -d, --delimit-list=LIST   reuse characters from LIST between columns (default TAB)
  -s, --serial              paste lines of each file one after another (one output line per FILE)
  -z, --zero-terminated     line delimiter is NUL, not newline
  -h, --help                display this help and exit
  --                        end of options

With no FILE, or when FILE is -, read standard input. Piped stdin requires stdin to be supplied (empty pipe works).

jsh:
  Parallel mode (default) merges line N from each FILE. Missing lines use empty fields. Serial mode (-s) joins all lines of each FILE with delimiters between lines, one output line per FILE.
  Symlinks are followed to a regular file. Binary files contribute a single [binary file] field.
  Not implemented vs GNU: --version, full getopt edge cases.

Full documentation: <https://www.gnu.org/software/coreutils/paste>
`;

/**
 * GNU-style option error for paste (exit status 1).
 * @param {string} arg
 * @returns {string}
 */
function pasteOptionError(arg) {
  const tryLine = "Try 'paste --help' for more information.\n";
  if (arg.startsWith('--') && arg.length > 2) {
    return `paste: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `paste: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `paste: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * Split file content into lines for paste (newline or NUL records).
 * @param {string} text
 * @param {boolean} nullTerm
 * @returns {string[]}
 */
function pasteSplitLines(text, nullTerm) {
  const s = String(text);
  if (nullTerm) {
    if (s === '') return [];
    const parts = s.split('\0');
    if (parts.length && parts[parts.length - 1] === '') parts.pop();
    return parts;
  }
  const lines = s.split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * Parallel merge: one output line per row index, columns separated by cycling delimiters.
 * @param {string[][]} columnArrays
 * @param {string} delimiterList
 * @returns {string[]}
 */
function pasteJoinParallelRows(columnArrays, delimiterList) {
  const cols = Array.isArray(columnArrays) ? columnArrays : [];
  const delim = String(delimiterList);
  const delimLen = delim.length;
  const maxR = cols.length ? Math.max(0, ...cols.map((c) => c.length)) : 0;
  const out = [];
  for (let i = 0; i < maxR; i++) {
    const row = [];
    for (let j = 0; j < cols.length; j++) {
      row.push(cols[j][i] !== undefined ? cols[j][i] : '');
    }
    let line = '';
    for (let j = 0; j < row.length; j++) {
      line += row[j];
      if (j < row.length - 1) {
        line += delimLen === 0 ? '' : delim[j % delimLen];
      }
    }
    out.push(line);
  }
  return out;
}

/**
 * Serial merge: for each file's lines, join with cycling delimiters; one output line per file.
 * @param {string[][]} filesLines
 * @param {string} delimiterList
 * @returns {string[]}
 */
function pasteJoinSerialRows(filesLines, delimiterList) {
  const files = Array.isArray(filesLines) ? filesLines : [];
  const delim = String(delimiterList);
  const delimLen = delim.length;
  const out = [];
  for (const lines of files) {
    if (lines.length === 0) {
      out.push('');
      continue;
    }
    let line = '';
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) {
        line += delimLen === 0 ? '' : delim[(i - 1) % delimLen];
      }
      line += lines[i];
    }
    out.push(line);
  }
  return out;
}

/**
 * @param {string[]} lines
 * @param {boolean} nullTerm
 * @returns {string}
 */
function pasteFormatOutputLines(lines, nullTerm) {
  const sep = nullTerm ? '\0' : '\n';
  const arr = Array.isArray(lines) ? lines : [];
  if (arr.length === 0) return '';
  return arr.join(sep) + sep;
}

/**
 * Parse jsh \`paste\` argv (GNU subset: -d -s -z, --, -h/--help).
 *
 * @param {string[]} args
 * @returns {{ ok: true, delimiterList: string, serial: boolean, nullTerminated: boolean, operands: string[], help?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parsePasteArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  let delimiterList = '\t';
  let serial = false;
  let nullTerminated = false;
  let i = 0;
  while (i < argsArr.length) {
    const arg = argsArr[i];
    if (arg === '--') {
      i++;
      break;
    }
    if (arg === '--help' || arg === '-h') {
      return { ok: true, delimiterList, serial, nullTerminated, operands: [], help: true };
    }
    if (arg === '--serial') {
      serial = true;
      i++;
      continue;
    }
    if (arg === '--zero-terminated') {
      nullTerminated = true;
      i++;
      continue;
    }
    if (arg === '--delimiter') {
      const v = argsArr[++i];
      if (v == null) {
        return {
          ok: false,
          stderr: `paste: option '--delimiter' requires an argument\nTry 'paste --help' for more information.\n`,
          exitCode: 1
        };
      }
      delimiterList = v;
      i++;
      continue;
    }
    if (arg.startsWith('--delimiter=')) {
      delimiterList = arg.slice('--delimiter='.length);
      i++;
      continue;
    }
    if (arg === '-d' || (arg.startsWith('-d') && arg.length > 2)) {
      let list;
      if (arg === '-d') {
        list = argsArr[++i];
        if (list == null) {
          return {
            ok: false,
            stderr: `paste: option requires an argument -- 'd'\nTry 'paste --help' for more information.\n`,
            exitCode: 1
          };
        }
      } else {
        list = arg.slice(2);
      }
      delimiterList = list;
      i++;
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1 && !arg.startsWith('--')) {
      let j = 1;
      while (j < arg.length) {
        const c = arg[j];
        if (c === 'd') {
          const rest = arg.slice(j + 1);
          if (rest.length > 0) {
            delimiterList = rest;
            j = arg.length;
            break;
          }
          const next = argsArr[i + 1];
          if (next == null) {
            return {
              ok: false,
              stderr: `paste: option requires an argument -- 'd'\nTry 'paste --help' for more information.\n`,
              exitCode: 1
            };
          }
          delimiterList = next;
          i++;
          j = arg.length;
          break;
        }
        if (c === 's') {
          serial = true;
          j++;
          continue;
        }
        if (c === 'z') {
          nullTerminated = true;
          j++;
          continue;
        }
        if (c === 'h') {
          return { ok: true, delimiterList, serial, nullTerminated, operands: [], help: true };
        }
        return { ok: false, stderr: pasteOptionError(`-${c}`), exitCode: 1 };
      }
      i++;
      continue;
    }
    break;
  }
  const operands = argsArr.slice(i);
  return { ok: true, delimiterList, serial, nullTerminated, operands };
}

export const PasteLib = {
  PASTE_HELP,
  pasteOptionError,
  pasteSplitLines,
  pasteJoinParallelRows,
  pasteJoinSerialRows,
  pasteFormatOutputLines,
  parsePasteArgv
};

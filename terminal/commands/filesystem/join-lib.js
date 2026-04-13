const JOIN_HELP = `Usage: join [OPTION]... FILE1 FILE2
For each pair of input lines with identical join fields, write a line to standard output.

  -a FILENO              print unpairable lines from FILENO (1 or 2); may be repeated
  -e EMPTY               replace empty input fields with EMPTY (default empty string)
  -1 FIELD              join on FIELD of file 1 (default 1)
  -2 FIELD              join on FIELD of file 2 (default 1)
  -j FIELD              same as -1 FIELD -2 FIELD
  -t CHAR               use CHAR as the input and output field separator (default: whitespace)
  -v FILENO              like -a FILENO but do not print matched join lines; may be repeated
  -h, --help             display this help and exit
  -?                     same as --help
  --                     end of options

FILE1 and FILE2 are required. At most one operand may be - (standard input; piped stdin must be supplied).

jsh:
  Input lines must be sorted on the join field (GNU requirement); jsh does not sort or verify order.
  Matched output uses one join field, then remaining fields from FILE1, then from FILE2, separated by the same character as -t (or SPACE for whitespace fields).
  Unpairable lines (-a / -v) are printed as the original line from that file.
  Symlinks are followed to a regular file. Binary files contribute a single [binary file] field.
  Not implemented vs GNU: -o, -i, --check-order, --header, -z, --version.

Full documentation: <https://www.gnu.org/software/coreutils/join>
`;

/**
 * GNU-style option error for join (exit status 1).
 * @param {string} arg
 * @returns {string}
 */
function joinOptionError(arg) {
  const tryLine = "Try 'join --help' for more information.\n";
  if (arg.startsWith('--') && arg.length > 2) {
    return `join: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `join: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `join: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * Split a line into fields for join: whitespace mode (leading blanks ignored) or single-char delimiter.
 * @param {string} line
 * @param {string | null} delimChar null = whitespace between fields
 * @returns {string[]}
 */
function joinSplitFields(line, delimChar) {
  const s = String(line);
  if (delimChar == null) {
    const t = s.replace(/^\s+/, '');
    if (t === '') return [];
    return t.split(/\s+/);
  }
  return s.split(delimChar);
}

/**
 * Build join records: key, fields, raw line.
 * @param {string[]} lines
 * @param {number} joinField 1-based
 * @param {string | null} delimChar
 * @returns {{ key: string, fields: string[], raw: string }[]}
 */
function joinBuildRecords(lines, joinField, delimChar) {
  const jf = Math.max(1, Math.floor(Number(joinField)) || 1);
  const out = [];
  for (const line of lines) {
    const fields = joinSplitFields(line, delimChar);
    const key = fields[jf - 1] != null ? fields[jf - 1] : '';
    out.push({ key, fields, raw: line });
  }
  return out;
}

/**
 * Compare join keys (GNU strcmp-style lexicographic order for C locale; jsh uses UTF-16 unit order).
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function joinCompareKeys(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Emit one matched join line (GNU default output format).
 * @param {{ fields: string[] }} r1
 * @param {{ fields: string[] }} r2
 * @param {number} jf1
 * @param {number} jf2
 * @param {string | null} delimChar
 * @param {string} emptyStr
 * @returns {string}
 */
function joinEmitMatchedLine(r1, r2, jf1, jf2, delimChar, emptyStr) {
  const f1 = r1.fields;
  const f2 = r2.fields;
  const k = f1[jf1 - 1] != null ? f1[jf1 - 1] : '';
  const rest1 = f1.filter((_, idx) => idx !== jf1 - 1);
  const rest2 = f2.filter((_, idx) => idx !== jf2 - 1);
  const sep = delimChar == null ? ' ' : delimChar;
  const parts = [k, ...rest1, ...rest2];
  const mapped = parts.map((p) => (p === '' ? emptyStr : p));
  return mapped.join(sep);
}

/**
 * Merge-join two sorted record lists (GNU join).
 * @param {{ key: string, fields: string[], raw: string }[]} rec1
 * @param {{ key: string, fields: string[], raw: string }[]} rec2
 * @param {{ joinField1: number, joinField2: number, delimChar: string | null, a1: boolean, a2: boolean, v1: boolean, v2: boolean, emptyStr: string }} opts
 * @returns {string[]}
 */
function joinMergeRecords(rec1, rec2, opts) {
  const { joinField1, joinField2, delimChar, a1, a2, v1, v2, emptyStr } = opts;
  const jf1 = Math.max(1, Math.floor(Number(joinField1)) || 1);
  const jf2 = Math.max(1, Math.floor(Number(joinField2)) || 1);
  const emitMatched = !v1 && !v2;
  const showUnpaired1 = a1 || v1;
  const showUnpaired2 = a2 || v2;
  const out = [];
  let i = 0;
  let j = 0;
  while (i < rec1.length && j < rec2.length) {
    const k1 = rec1[i].key;
    const k2 = rec2[j].key;
    const c = joinCompareKeys(k1, k2);
    if (c < 0) {
      if (showUnpaired1) out.push(rec1[i].raw);
      i++;
    } else if (c > 0) {
      if (showUnpaired2) out.push(rec2[j].raw);
      j++;
    } else {
      const k = k1;
      const iStart = i;
      while (i < rec1.length && rec1[i].key === k) i++;
      const jStart = j;
      while (j < rec2.length && rec2[j].key === k) j++;
      if (emitMatched) {
        for (let ii = iStart; ii < i; ii++) {
          for (let jj = jStart; jj < j; jj++) {
            out.push(joinEmitMatchedLine(rec1[ii], rec2[jj], jf1, jf2, delimChar, emptyStr));
          }
        }
      }
    }
  }
  while (i < rec1.length) {
    if (showUnpaired1) out.push(rec1[i].raw);
    i++;
  }
  while (j < rec2.length) {
    if (showUnpaired2) out.push(rec2[j].raw);
    j++;
  }
  return out;
}

/**
 * Parse jsh `join` argv (GNU subset: -1 -2 -j -t -a -v -e, --, help).
 *
 * @param {string[]} args
 * @returns {{ ok: true, joinField1: number, joinField2: number, delimChar: string | null, a1: boolean, a2: boolean, v1: boolean, v2: boolean, emptyStr: string, operands: string[], help?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseJoinArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  let joinField1 = 1;
  let joinField2 = 1;
  let delimChar = null;
  let a1 = false;
  let a2 = false;
  let v1 = false;
  let v2 = false;
  let emptyStr = '';
  let i = 0;

  while (i < argsArr.length) {
    const arg = argsArr[i];
    if (arg === '--') {
      i++;
      break;
    }
    if (arg === '--help' || arg === '-h' || arg === '-?') {
      return {
        ok: true,
        joinField1,
        joinField2,
        delimChar,
        a1,
        a2,
        v1,
        v2,
        emptyStr,
        operands: [],
        help: true
      };
    }
    if (arg === '-e') {
      const v = argsArr[++i];
      if (v == null) {
        return {
          ok: false,
          stderr: `join: option '${arg}' requires an argument\nTry 'join --help' for more information.\n`,
          exitCode: 1
        };
      }
      emptyStr = v;
      i++;
      continue;
    }
    if (arg === '-j' || (arg.startsWith('-j') && arg.length > 2 && /^\d+$/.test(arg.slice(2)))) {
      let n;
      if (arg === '-j') {
        const v = argsArr[++i];
        if (v == null || !/^\d+$/.test(v)) {
          return {
            ok: false,
            stderr: `join: option requires an argument -- 'j'\nTry 'join --help' for more information.\n`,
            exitCode: 1
          };
        }
        n = parseInt(v, 10);
      } else {
        n = parseInt(arg.slice(2), 10);
      }
      if (n < 1) {
        return {
          ok: false,
          stderr: `join: invalid field number for -j\nTry 'join --help' for more information.\n`,
          exitCode: 1
        };
      }
      joinField1 = n;
      joinField2 = n;
      i++;
      continue;
    }
    if (arg === '-1' || /^-1\d+$/.test(arg)) {
      let n;
      if (/^-1\d+$/.test(arg)) {
        n = parseInt(arg.slice(2), 10);
        if (n < 1) {
          return {
            ok: false,
            stderr: `join: invalid field number for -1\nTry 'join --help' for more information.\n`,
            exitCode: 1
          };
        }
      } else {
        const v = argsArr[++i];
        if (v == null || !/^\d+$/.test(v)) {
          return {
            ok: false,
            stderr: `join: option requires an argument -- '1'\nTry 'join --help' for more information.\n`,
            exitCode: 1
          };
        }
        n = parseInt(v, 10);
        if (n < 1) {
          return {
            ok: false,
            stderr: `join: invalid field number for -1\nTry 'join --help' for more information.\n`,
            exitCode: 1
          };
        }
      }
      joinField1 = n;
      i++;
      continue;
    }
    if (arg === '-2' || /^-2\d+$/.test(arg)) {
      let n;
      if (/^-2\d+$/.test(arg)) {
        n = parseInt(arg.slice(2), 10);
        if (n < 1) {
          return {
            ok: false,
            stderr: `join: invalid field number for -2\nTry 'join --help' for more information.\n`,
            exitCode: 1
          };
        }
      } else {
        const v = argsArr[++i];
        if (v == null || !/^\d+$/.test(v)) {
          return {
            ok: false,
            stderr: `join: option requires an argument -- '2'\nTry 'join --help' for more information.\n`,
            exitCode: 1
          };
        }
        n = parseInt(v, 10);
        if (n < 1) {
          return {
            ok: false,
            stderr: `join: invalid field number for -2\nTry 'join --help' for more information.\n`,
            exitCode: 1
          };
        }
      }
      joinField2 = n;
      i++;
      continue;
    }
    if (arg === '-a' || /^-a[12]$/.test(arg)) {
      let fileno;
      if (arg === '-a') {
        const v = argsArr[++i];
        if (v !== '1' && v !== '2') {
          return {
            ok: false,
            stderr: `join: invalid file number for -a\nTry 'join --help' for more information.\n`,
            exitCode: 1
          };
        }
        fileno = v;
      } else {
        fileno = arg.slice(2);
      }
      if (fileno === '1') a1 = true;
      else a2 = true;
      i++;
      continue;
    }
    if (arg === '-v' || /^-v[12]$/.test(arg)) {
      let fileno;
      if (arg === '-v') {
        const v = argsArr[++i];
        if (v !== '1' && v !== '2') {
          return {
            ok: false,
            stderr: `join: invalid file number for -v\nTry 'join --help' for more information.\n`,
            exitCode: 1
          };
        }
        fileno = v;
      } else {
        fileno = arg.slice(2);
      }
      if (fileno === '1') v1 = true;
      else v2 = true;
      i++;
      continue;
    }
    if (arg === '-t' || (arg.startsWith('-t') && arg.length === 3)) {
      let ch;
      if (arg === '-t') {
        const v = argsArr[++i];
        if (v == null) {
          return {
            ok: false,
            stderr: `join: option requires an argument -- 't'\nTry 'join --help' for more information.\n`,
            exitCode: 1
          };
        }
        ch = v;
      } else {
        ch = arg.slice(2);
      }
      delimChar = ch === '' ? null : ch[0];
      i++;
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1 && !arg.startsWith('--')) {
      return { ok: false, stderr: joinOptionError(arg), exitCode: 1 };
    }
    break;
  }

  const operands = argsArr.slice(i);
  return {
    ok: true,
    joinField1,
    joinField2,
    delimChar,
    a1,
    a2,
    v1,
    v2,
    emptyStr,
    operands
  };
}

export const JoinLib = {
  JOIN_HELP,
  joinOptionError,
  joinSplitFields,
  joinBuildRecords,
  joinCompareKeys,
  joinEmitMatchedLine,
  joinMergeRecords,
  parseJoinArgv
};

const CSPLIT_VERSION_LINE = 'csplit (jsh Heyming Terminal) 1.0\n';

const CSPLIT_HELP = `Usage: csplit [OPTION]... FILE PATTERN...
Split FILE into pieces at line boundaries defined by PATTERN(s), writing PREFIX00, PREFIX01, ...
(default PREFIX is 'xx').

  -f, --prefix=PREFIX   use PREFIX instead of 'xx'
  -n, --digits=N        use N digits in output file suffix (default 2)
  -k, --keep-files      do not remove output files on error
  -s, --silent          do not print byte counts of created files
  -q                    same as -s
  -z, --elide-empty-files  omit empty output files (and their size lines)
  -h, --help            display this help and exit
      --version         output version information and exit
  --                    end of options

PATTERN may be:
  N           split before line N (line numbers are 1-based from the start of the file)
  /STRING/    split after the next line containing STRING (literal substring in jsh)
  %STRING%    skip lines until a line contains STRING (no output for the skipped part)
  {COUNT}     repeat the preceding pattern COUNT times

jsh:
  Reads stdin when FILE is '-' and stdin is supplied. Symlinks are followed to a regular file.
  Patterns use literal substring matching (not POSIX regex). Empty /STRING/ matches every line.
  Binary files split on newline bytes; matching uses UTF-8 decoding per line (invalid bytes may match oddly).
  Not implemented vs GNU: -b/--suffix-format, offsets after patterns, regexp syntax, or full error cleanup.

Full documentation: <https://www.gnu.org/software/coreutils/csplit>
`;

/**
 * @param {string} arg
 * @returns {string}
 */
function csplitOptionError(arg) {
  const tryLine = "Try 'csplit --help' for more information.\n";
  if (arg.startsWith('--') && arg.length > 2) {
    return `csplit: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `csplit: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `csplit: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * Parse /.../ or %...% with \\ escapes for the closing delimiter.
 * @param {string} token
 * @param {'/'|'%'} delim
 * @returns {{ ok: true, pat: string } | { ok: false, stderr: string, exitCode: number }}
 */
function parseCsplitDelimitedPattern(token, delim) {
  const s = String(token);
  if (s.length < 2 || s[0] !== delim) {
    return { ok: false, stderr: `csplit: invalid pattern: '${token}'\n`, exitCode: 1 };
  }
  let buf = '';
  let i = 1;
  while (i < s.length) {
    if (s[i] === '\\' && i + 1 < s.length) {
      buf += s[i + 1];
      i += 2;
      continue;
    }
    if (s[i] === delim) {
      return { ok: true, pat: buf };
    }
    buf += s[i];
    i++;
  }
  return { ok: false, stderr: `csplit: invalid pattern: '${token}'\n`, exitCode: 1 };
}

/**
 * @param {string} token
 * @returns {{ ok: true, atom: { type: 'line', n: number } | { type: 'regex', pat: string, skip: boolean } } | { ok: false, stderr: string, exitCode: number }}
 */
function parseCsplitPatternToken(token) {
  const t = String(token);
  if (/^\d+$/.test(t)) {
    const n = parseInt(t, 10);
    if (n < 1) {
      return { ok: false, stderr: `csplit: invalid line number: '${t}'\n`, exitCode: 1 };
    }
    return { ok: true, atom: { type: 'line', n } };
  }
  if (t[0] === '/') {
    const p = parseCsplitDelimitedPattern(t, '/');
    if (p.ok === false) {
      return p;
    }
    return { ok: true, atom: { type: 'regex', pat: p.pat, skip: false } };
  }
  if (t[0] === '%') {
    const p = parseCsplitDelimitedPattern(t, '%');
    if (p.ok === false) {
      return p;
    }
    return { ok: true, atom: { type: 'regex', pat: p.pat, skip: true } };
  }
  return { ok: false, stderr: `csplit: invalid pattern: '${t}'\n`, exitCode: 1 };
}

/**
 * @param {string[]} patternTokens
 * @returns {{ ok: true, atoms: object[] } | { ok: false, stderr: string, exitCode: number }}
 */
function expandCsplitPatternTokens(patternTokens) {
  const argsArr = Array.isArray(patternTokens) ? patternTokens : [];
  /** @type {Array<{ type: 'line', n: number } | { type: 'regex', pat: string, skip: boolean }>} */
  const atoms = [];
  for (let i = 0; i < argsArr.length; i++) {
    const t = argsArr[i];
    const rep = /^\{(\d+)\}$/.exec(t);
    if (rep) {
      const count = parseInt(rep[1], 10);
      if (count < 1) {
        return {
          ok: false,
          stderr: `csplit: invalid repeat count: '${t}'\nTry 'csplit --help' for more information.\n`,
          exitCode: 1
        };
      }
      if (atoms.length === 0) {
        return {
          ok: false,
          stderr: "csplit: '{': no such pattern\nTry 'csplit --help' for more information.\n",
          exitCode: 1
        };
      }
      const last = atoms.pop();
      for (let k = 0; k < count; k++) {
        atoms.push(
          last.type === 'line'
            ? { type: 'line', n: last.n }
            : { type: 'regex', pat: last.pat, skip: last.skip }
        );
      }
      continue;
    }
    const p = parseCsplitPatternToken(t);
    if (p.ok === false) {
      return p;
    }
    atoms.push(p.atom);
  }
  return { ok: true, atoms };
}

/**
 * @param {string[]} lines — from splitLinesWithSeparators
 * @param {Array<{ type: 'line', n: number } | { type: 'regex', pat: string, skip: boolean }>} atoms
 * @returns {{ ok: true, pieces: string[], sizes: number[] } | { ok: false, stderr: string, exitCode: number }}
 */
function csplitComputeTextPieces(lines, atoms) {
  const pieces = [];
  let cur = 0;
  const nLines = lines.length;
  for (const atom of atoms) {
    if (atom.type === 'line') {
      const N = atom.n;
      if (cur > N - 1) {
        return { ok: false, stderr: `csplit: line number out of range\n`, exitCode: 1 };
      }
      pieces.push(lines.slice(cur, N - 1).join(''));
      cur = N - 1;
    } else if (atom.skip) {
      let j = cur;
      while (j < nLines) {
        const line = lines[j];
        const body = line.endsWith('\n') ? line.slice(0, -1) : line;
        if (body.includes(atom.pat)) {
          break;
        }
        j++;
      }
      if (j >= nLines) {
        const wrap = atom.pat.indexOf('\n') >= 0 ? '\n' : '';
        return {
          ok: false,
          stderr: `csplit: *: '%${atom.pat.replace(/\n/g, '\\n')}${wrap}%': match not found\n`,
          exitCode: 1
        };
      }
      cur = j + 1;
    } else {
      let j = cur;
      while (j < nLines) {
        const line = lines[j];
        const body = line.endsWith('\n') ? line.slice(0, -1) : line;
        if (body.includes(atom.pat)) {
          break;
        }
        j++;
      }
      if (j >= nLines) {
        const wrap = atom.pat.indexOf('\n') >= 0 ? '\n' : '';
        return {
          ok: false,
          stderr: `csplit: *: '/${atom.pat.replace(/\n/g, '\\n')}${wrap}/': match not found\n`,
          exitCode: 1
        };
      }
      pieces.push(lines.slice(cur, j + 1).join(''));
      cur = j + 1;
    }
  }
  if (cur < nLines) {
    pieces.push(lines.slice(cur).join(''));
  }
  const sizes = pieces.map((p) => new TextEncoder().encode(p).length);
  return { ok: true, pieces, sizes };
}

/**
 * @param {Uint8Array[]} lineParts
 * @param {Array<{ type: 'line', n: number } | { type: 'regex', pat: string, skip: boolean }>} atoms
 * @returns {{ ok: true, pieces: Uint8Array[], sizes: number[] } | { ok: false, stderr: string, exitCode: number }}
 */
function csplitComputeBinaryPieces(lineParts, atoms) {
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const pieces = [];
  let cur = 0;
  const nLines = lineParts.length;
  for (const atom of atoms) {
    if (atom.type === 'line') {
      const N = atom.n;
      if (cur > N - 1) {
        return { ok: false, stderr: `csplit: line number out of range\n`, exitCode: 1 };
      }
      pieces.push(csplitConcatUint8LineRange(lineParts, cur, N - 1));
      cur = N - 1;
    } else if (atom.skip) {
      let j = cur;
      while (j < nLines) {
        const u8 = lineParts[j];
        const lineStr = decoder.decode(u8);
        const body = lineStr.endsWith('\n') ? lineStr.slice(0, -1) : lineStr;
        if (body.includes(atom.pat)) {
          break;
        }
        j++;
      }
      if (j >= nLines) {
        return {
          ok: false,
          stderr: `csplit: *: '%${atom.pat}%': match not found\n`,
          exitCode: 1
        };
      }
      cur = j + 1;
    } else {
      let j = cur;
      while (j < nLines) {
        const u8 = lineParts[j];
        const lineStr = decoder.decode(u8);
        const body = lineStr.endsWith('\n') ? lineStr.slice(0, -1) : lineStr;
        if (body.includes(atom.pat)) {
          break;
        }
        j++;
      }
      if (j >= nLines) {
        return {
          ok: false,
          stderr: `csplit: *: '/${atom.pat}/': match not found\n`,
          exitCode: 1
        };
      }
      pieces.push(csplitConcatUint8LineRange(lineParts, cur, j + 1));
      cur = j + 1;
    }
  }
  if (cur < nLines) {
    pieces.push(csplitConcatUint8LineRange(lineParts, cur, nLines));
  }
  const sizes = pieces.map((p) => p.length);
  return { ok: true, pieces, sizes };
}

/**
 * @param {Uint8Array[]} lineParts
 * @param {number} start inclusive
 * @param {number} end exclusive
 */
function csplitConcatUint8LineRange(lineParts, start, end) {
  let total = 0;
  for (let i = start; i < end; i++) {
    total += lineParts[i].length;
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (let i = start; i < end; i++) {
    out.set(lineParts[i], o);
    o += lineParts[i].length;
  }
  return out;
}

/**
 * @param {number[]} sizes
 * @param {boolean} silent
 * @returns {string}
 */
function csplitFormatStdoutSizes(sizes, silent) {
  if (silent) {
    return '';
  }
  let s = '';
  for (const n of sizes) {
    s += `${String(n).padStart(6, ' ')}\n`;
  }
  return s;
}

/**
 * Parse jsh `csplit` argv (GNU subset).
 *
 * @param {string[]} args
 * @returns {{ ok: true, prefix: string, digits: number, silent: boolean, keepFiles: boolean, elideEmpty: boolean, operands: string[], help?: true, version?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseCsplitArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  let prefix = 'xx';
  let digits = 2;
  let silent = false;
  let keepFiles = false;
  let elideEmpty = false;
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
        prefix,
        digits,
        silent,
        keepFiles,
        elideEmpty,
        operands: [],
        help: true
      };
    }
    if (arg === '--version') {
      return {
        ok: true,
        prefix,
        digits,
        silent,
        keepFiles,
        elideEmpty,
        operands: [],
        version: true
      };
    }
    if (arg === '--silent') {
      silent = true;
      i++;
      continue;
    }
    if (arg === '--keep-files') {
      keepFiles = true;
      i++;
      continue;
    }
    if (arg === '--elide-empty-files') {
      elideEmpty = true;
      i++;
      continue;
    }
    if (arg === '-f' || arg === '--prefix') {
      const v = argsArr[++i];
      if (v == null) {
        return {
          ok: false,
          stderr: `csplit: option requires an argument -- 'prefix'\nTry 'csplit --help' for more information.\n`,
          exitCode: 1
        };
      }
      prefix = v;
      i++;
      continue;
    }
    if (arg.startsWith('--prefix=')) {
      prefix = arg.slice('--prefix='.length);
      i++;
      continue;
    }
    if (arg === '-n' || arg === '--digits') {
      const v = argsArr[++i];
      if (v == null) {
        return {
          ok: false,
          stderr: `csplit: option requires an argument -- 'digits'\nTry 'csplit --help' for more information.\n`,
          exitCode: 1
        };
      }
      if (!/^\d+$/.test(v)) {
        return {
          ok: false,
          stderr: `csplit: invalid digits: '${v}'\nTry 'csplit --help' for more information.\n`,
          exitCode: 1
        };
      }
      const n = parseInt(v, 10);
      if (n < 1 || n > 64) {
        return {
          ok: false,
          stderr: `csplit: invalid digits: '${v}'\nTry 'csplit --help' for more information.\n`,
          exitCode: 1
        };
      }
      digits = n;
      i++;
      continue;
    }
    if (arg.startsWith('--digits=')) {
      const v = arg.slice('--digits='.length);
      if (!/^\d+$/.test(v)) {
        return {
          ok: false,
          stderr: `csplit: invalid digits: '${v}'\nTry 'csplit --help' for more information.\n`,
          exitCode: 1
        };
      }
      const n = parseInt(v, 10);
      if (n < 1 || n > 64) {
        return {
          ok: false,
          stderr: `csplit: invalid digits: '${v}'\nTry 'csplit --help' for more information.\n`,
          exitCode: 1
        };
      }
      digits = n;
      i++;
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1 && !arg.startsWith('--')) {
      let j = 1;
      while (j < arg.length) {
        const c = arg[j];
        if (c === 's' || c === 'q') {
          silent = true;
          j++;
          continue;
        }
        if (c === 'k') {
          keepFiles = true;
          j++;
          continue;
        }
        if (c === 'z') {
          elideEmpty = true;
          j++;
          continue;
        }
        if (c === 'f') {
          const rest = arg.slice(j + 1);
          if (rest.length > 0) {
            prefix = rest;
            j = arg.length;
            break;
          }
          const v = argsArr[++i];
          if (v == null) {
            return {
              ok: false,
              stderr: `csplit: option requires an argument -- 'f'\nTry 'csplit --help' for more information.\n`,
              exitCode: 1
            };
          }
          prefix = v;
          j = arg.length;
          break;
        }
        if (c === 'n') {
          const rest = arg.slice(j + 1);
          if (rest.length > 0 && /^\d+$/.test(rest)) {
            const n = parseInt(rest, 10);
            if (n < 1 || n > 64) {
              return {
                ok: false,
                stderr: `csplit: invalid digits: '${rest}'\nTry 'csplit --help' for more information.\n`,
                exitCode: 1
              };
            }
            digits = n;
            j = arg.length;
            break;
          }
          const v = argsArr[++i];
          if (v == null) {
            return {
              ok: false,
              stderr: `csplit: option requires an argument -- 'n'\nTry 'csplit --help' for more information.\n`,
              exitCode: 1
            };
          }
          if (!/^\d+$/.test(v)) {
            return {
              ok: false,
              stderr: `csplit: invalid digits: '${v}'\nTry 'csplit --help' for more information.\n`,
              exitCode: 1
            };
          }
          const n = parseInt(v, 10);
          if (n < 1 || n > 64) {
            return {
              ok: false,
              stderr: `csplit: invalid digits: '${v}'\nTry 'csplit --help' for more information.\n`,
              exitCode: 1
            };
          }
          digits = n;
          j = arg.length;
          break;
        }
        return { ok: false, stderr: csplitOptionError(`-${c}`), exitCode: 1 };
      }
      i++;
      continue;
    }
    if (arg.startsWith('--') && arg.length > 2) {
      return { ok: false, stderr: csplitOptionError(arg), exitCode: 1 };
    }
    break;
  }
  const operands = argsArr.slice(i);
  return {
    ok: true,
    prefix,
    digits,
    silent,
    keepFiles,
    elideEmpty,
    operands
  };
}

export const CsplitLib = {
  CSPLIT_VERSION_LINE,
  CSPLIT_HELP,
  csplitOptionError,
  expandCsplitPatternTokens,
  csplitComputeTextPieces,
  csplitComputeBinaryPieces,
  csplitFormatStdoutSizes,
  parseCsplitArgv
};

const CUT_HELP = `Usage: cut OPTION... [FILE]...
Print selected parts of lines from each FILE to standard output.

  -b, --bytes=LIST        select only these bytes (UTF-8)
  -c, --characters=LIST   select only these characters (Unicode code points)
  -d, --delimiter=DELIM   use DELIM instead of TAB for field delimiter (-f only)
  -f, --fields=LIST       select only these fields; see -s
  -s, --only-delimited    do not print lines not containing delimiters (-f only)
      --complement        complement the set of selected bytes, characters, or fields
      --output-delimiter=STRING  use STRING as the output delimiter between selected fields (-f)
  -h, --help              display this help and exit (jsh: -h is alias)
  --                      end of options

LIST is comma-separated ranges: N, N-M, N-, -M (1-based).

jsh:
  Multiple FILE operands are supported (headers like head when more than one).
  Operand - reads standard input. Empty piped stdin works (stdinSupplied), like cat/tee.
  Symlinks are followed to a regular file.
  -d uses the first character of DELIM as the field separator (TAB is default for -f).
  Binary files are treated as empty text for display.
  Not implemented vs GNU: -z/--zero-terminated, -n, --version, full multibyte -b edge cases.

Full documentation: <https://www.gnu.org/software/coreutils/cut>
`;

/**
 * GNU-style option error for cut.
 * @param {string} arg
 * @returns {string}
 */
function cutOptionError(arg) {
  const tryLine = `Try 'cut --help' for more information.\n`;
  if (arg.startsWith('--') && arg.length > 2) {
    return `cut: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `cut: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `cut: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * Parse a GNU-style LIST for cut (-b/-c/-f).
 * @param {string} raw
 * @returns {{ ok: true, parts: { kind: 'range', from: number, to: number }[] } | { ok: false, stderr: string }}
 */
function parseCutListString(raw) {
  const s = String(raw ?? '').trim();
  if (s === '') {
    return { ok: false, stderr: 'cut: invalid byte, character or field list\n' };
  }
  const segments = s.split(',');
  /** @type {Array<{ kind: 'range', from: number, to: number }>} */
  const parts = [];
  for (const seg of segments) {
    const tok = seg.trim();
    if (tok === '') {
      return { ok: false, stderr: 'cut: invalid byte, character or field list\n' };
    }
    let m = /^(\d+)$/.exec(tok);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n < 1) {
        return { ok: false, stderr: 'cut: invalid byte, character or field list\n' };
      }
      parts.push({ kind: 'range', from: n, to: n });
      continue;
    }
    m = /^(\d+)-(\d+)$/.exec(tok);
    if (m) {
      const a = parseInt(m[1], 10);
      const b = parseInt(m[2], 10);
      if (a < 1 || b < 1) {
        return { ok: false, stderr: 'cut: invalid byte, character or field list\n' };
      }
      parts.push({ kind: 'range', from: Math.min(a, b), to: Math.max(a, b) });
      continue;
    }
    m = /^(\d+)-$/.exec(tok);
    if (m) {
      const a = parseInt(m[1], 10);
      if (a < 1) {
        return { ok: false, stderr: 'cut: invalid byte, character or field list\n' };
      }
      parts.push({ kind: 'range', from: a, to: Infinity });
      continue;
    }
    m = /^-(\d+)$/.exec(tok);
    if (m) {
      const b = parseInt(m[1], 10);
      if (b < 1) {
        return { ok: false, stderr: 'cut: invalid byte, character or field list\n' };
      }
      parts.push({ kind: 'range', from: 1, to: b });
      continue;
    }
    return { ok: false, stderr: 'cut: invalid byte, character or field list\n' };
  }
  return { ok: true, parts };
}

/**
 * Parse jsh `cut` argv.
 *
 * @param {string[]} args
 * @returns {{ ok: true, mode: 'b'|'c'|'f', listStr: string, delim: string, suppressOnlyDelimited: boolean, complement: boolean, outputDelimiter: string|null, operands: string[], help?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseCutArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  let mode = null;
  let listStr = '';
  let delim = '\t';
  let suppressOnlyDelimited = false;
  let complement = false;
  let outputDelimiter = null;
  const operands = [];
  let i = 0;

  function setMode(m, list, idx) {
    if (mode != null && mode !== m) {
      return {
        ok: /** @type {false} */ (false),
        stderr: 'cut: only one type of list may be specified\n',
        exitCode: 1
      };
    }
    mode = m;
    listStr = list;
    return { ok: /** @type {true} */ (true), next: idx };
  }

  while (i < argsArr.length) {
    const arg = argsArr[i];
    if (arg === '--help' || arg === '-h') {
      return {
        ok: true,
        help: true,
        mode: 'b',
        listStr: '',
        delim: '\t',
        suppressOnlyDelimited: false,
        complement: false,
        outputDelimiter: null,
        operands: []
      };
    }
    if (arg === '--') {
      operands.push(...argsArr.slice(i + 1));
      break;
    }
    if (arg === '-') {
      operands.push('-');
      i++;
      continue;
    }
    if (arg === '-s' || arg === '--only-delimited') {
      suppressOnlyDelimited = true;
      i++;
      continue;
    }
    if (arg === '--complement') {
      complement = true;
      i++;
      continue;
    }
    if (arg.startsWith('--output-delimiter=')) {
      outputDelimiter = arg.slice('--output-delimiter='.length);
      i++;
      continue;
    }
    if (arg === '--output-delimiter') {
      if (i + 1 >= argsArr.length) {
        return {
          ok: false,
          stderr: `cut: option '--output-delimiter' requires an argument\n`,
          exitCode: 1
        };
      }
      outputDelimiter = argsArr[i + 1];
      i += 2;
      continue;
    }
    if (arg.startsWith('--delimiter=')) {
      const v = arg.slice('--delimiter='.length);
      delim = v === '' ? '' : v[0];
      i++;
      continue;
    }
    if (arg === '--delimiter') {
      if (i + 1 >= argsArr.length) {
        return {
          ok: false,
          stderr: `cut: option '--delimiter' requires an argument\n`,
          exitCode: 1
        };
      }
      const v = argsArr[i + 1];
      delim = v === '' ? '' : v[0];
      i += 2;
      continue;
    }
    if (arg === '-d') {
      if (i + 1 >= argsArr.length) {
        return {
          ok: false,
          stderr: `cut: option requires an argument -- 'd'\n`,
          exitCode: 1
        };
      }
      const v = argsArr[i + 1];
      delim = v === '' ? '' : v[0];
      i += 2;
      continue;
    }
    if (arg.startsWith('--bytes=')) {
      const list = arg.slice('--bytes='.length);
      const r = setMode('b', list, i + 1);
      if (r.ok === false) return r;
      i = r.next;
      continue;
    }
    if (arg === '--bytes') {
      if (i + 1 >= argsArr.length) {
        return {
          ok: false,
          stderr: `cut: option '--bytes' requires an argument\n`,
          exitCode: 1
        };
      }
      const r = setMode('b', argsArr[i + 1], i + 2);
      if (r.ok === false) return r;
      i = r.next;
      continue;
    }
    if (arg.startsWith('--characters=')) {
      const list = arg.slice('--characters='.length);
      const r = setMode('c', list, i + 1);
      if (r.ok === false) return r;
      i = r.next;
      continue;
    }
    if (arg === '--characters') {
      if (i + 1 >= argsArr.length) {
        return {
          ok: false,
          stderr: `cut: option '--characters' requires an argument\n`,
          exitCode: 1
        };
      }
      const r = setMode('c', argsArr[i + 1], i + 2);
      if (r.ok === false) return r;
      i = r.next;
      continue;
    }
    if (arg.startsWith('--fields=')) {
      const list = arg.slice('--fields='.length);
      const r = setMode('f', list, i + 1);
      if (r.ok === false) return r;
      i = r.next;
      continue;
    }
    if (arg === '--fields') {
      if (i + 1 >= argsArr.length) {
        return {
          ok: false,
          stderr: `cut: option '--fields' requires an argument\n`,
          exitCode: 1
        };
      }
      const r = setMode('f', argsArr[i + 1], i + 2);
      if (r.ok === false) return r;
      i = r.next;
      continue;
    }
    if (arg === '-b' || (arg.startsWith('-b') && arg.length > 2)) {
      const list = arg === '-b' ? argsArr[i + 1] : arg.slice(2);
      if (arg === '-b' && i + 1 >= argsArr.length) {
        return {
          ok: false,
          stderr: `cut: option requires an argument -- 'b'\n`,
          exitCode: 1
        };
      }
      const r = setMode('b', list, arg === '-b' ? i + 2 : i + 1);
      if (r.ok === false) return r;
      i = r.next;
      continue;
    }
    if (arg === '-c' || (arg.startsWith('-c') && arg.length > 2)) {
      const list = arg === '-c' ? argsArr[i + 1] : arg.slice(2);
      if (arg === '-c' && i + 1 >= argsArr.length) {
        return {
          ok: false,
          stderr: `cut: option requires an argument -- 'c'\n`,
          exitCode: 1
        };
      }
      const r = setMode('c', list, arg === '-c' ? i + 2 : i + 1);
      if (r.ok === false) return r;
      i = r.next;
      continue;
    }
    if (arg === '-f' || (arg.startsWith('-f') && arg.length > 2)) {
      const list = arg === '-f' ? argsArr[i + 1] : arg.slice(2);
      if (arg === '-f' && i + 1 >= argsArr.length) {
        return {
          ok: false,
          stderr: `cut: option requires an argument -- 'f'\n`,
          exitCode: 1
        };
      }
      const r = setMode('f', list, arg === '-f' ? i + 2 : i + 1);
      if (r.ok === false) return r;
      i = r.next;
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1 && !arg.startsWith('--')) {
      return { ok: false, stderr: cutOptionError(arg), exitCode: 1 };
    }
    if (arg.startsWith('--') && arg.length > 2) {
      return { ok: false, stderr: cutOptionError(arg), exitCode: 1 };
    }
    operands.push(arg, ...argsArr.slice(i + 1));
    break;
  }

  if (!mode) {
    return {
      ok: false,
      stderr: `cut: you must specify a list of bytes, characters, or fields\nTry 'cut --help' for more information.\n`,
      exitCode: 1
    };
  }
  const listCheck = parseCutListString(listStr);
  if (listCheck.ok === false) {
    return { ok: false, stderr: listCheck.stderr, exitCode: 1 };
  }
  if (delim === '' && mode === 'f') {
    return {
      ok: false,
      stderr: 'cut: the delimiter must be a single character\n',
      exitCode: 1
    };
  }
  return {
    ok: true,
    mode,
    listStr,
    delim,
    suppressOnlyDelimited,
    complement,
    outputDelimiter,
    operands
  };
}

export const CutLib = {
  CUT_HELP,
  cutOptionError,
  parseCutListString,
  parseCutArgv
};

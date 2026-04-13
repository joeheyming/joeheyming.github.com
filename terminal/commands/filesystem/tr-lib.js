const TR_HELP = `Usage: tr [OPTION]... SET1 [SET2]
Translate, squeeze, or delete characters from standard input, writing to standard output.

  -c, -C, --complement   use the complement of SET1 (only with -d in jsh)
  -d, --delete           delete characters in SET1 instead of translating
  -s, --squeeze-repeats  replace each sequence of a repeated character from SET1
                         with one occurrence, then translate with SET2 if given
  -h, --help             display this help and exit
  --                     end of options

Reads standard input only. SET1 and SET2 are character sets; ranges like a-z are expanded.

jsh:
  Complement (-c) is supported only with -d (delete characters not in SET1).
  Not implemented vs GNU: -t/--truncate-set1, character classes like [:alpha:], full
  -c translation, combining -d with -s.

Full documentation: <https://www.gnu.org/software/coreutils/tr>
`;

/**
 * @param {string} cmd
 * @param {string} opt
 */
function trOptionError(cmd, opt) {
  if (opt.startsWith('--')) {
    return `${cmd}: unrecognized option '${opt}'\nTry '${cmd} --help' for more information.\n`;
  }
  return `${cmd}: invalid option -- '${opt.replace(
    /^-/,
    ''
  )}'\nTry '${cmd} --help' for more information.\n`;
}

/**
 * Read one backslash escape for tr SET strings (GNU-like subset).
 * @param {string} s
 * @param {number} i index of '\\'
 * @returns {{ ch: string, next: number }}
 */
function readTrBackslash(s, i) {
  if (i >= s.length || s[i] !== '\\') {
    return { ch: '\\', next: i + 1 };
  }
  const j = i + 1;
  if (j >= s.length) {
    return { ch: '\\', next: j };
  }
  const c = s[j];
  const esc = {
    '\\': '\\',
    a: '\u0007',
    b: '\b',
    f: '\f',
    n: '\n',
    r: '\r',
    t: '\t',
    v: '\v'
  };
  if (esc[c] !== undefined) {
    return { ch: esc[c], next: j + 1 };
  }
  if (c === 'x') {
    let k = j + 1;
    let hex = '';
    while (k < s.length && /[0-9a-fA-F]/.test(s[k]) && hex.length < 8) {
      hex += s[k];
      k++;
    }
    if (hex.length === 0) {
      return { ch: 'x', next: j + 1 };
    }
    const v = parseInt(hex, 16);
    if (Number.isNaN(v) || v < 0) {
      return { ch: String.fromCodePoint(0), next: k };
    }
    const cp = v > 0x10ffff ? 0xfffd : v;
    return { ch: String.fromCodePoint(cp), next: k };
  }
  if (c >= '0' && c <= '7') {
    let k = j;
    let oct = '';
    while (k < s.length && s[k] >= '0' && s[k] <= '7' && oct.length < 3) {
      oct += s[k];
      k++;
    }
    const v = parseInt(oct, 8) & 0xff;
    return { ch: String.fromCodePoint(v), next: k };
  }
  return { ch: c, next: j + 1 };
}

/**
 * @param {string} s
 * @param {number} i
 * @returns {{ cp: number, len: number }}
 */
function trCodePointAt(s, i) {
  const c0 = s.charCodeAt(i);
  if (c0 >= 0xd800 && c0 <= 0xdbff && i + 1 < s.length) {
    const c1 = s.charCodeAt(i + 1);
    if (c1 >= 0xdc00 && c1 <= 0xdfff) {
      return { cp: 0x10000 + ((c0 - 0xd800) << 10) + (c1 - 0xdc00), len: 2 };
    }
  }
  return { cp: c0, len: 1 };
}

/**
 * Expand tr SET1/SET2 string: backslashes, a-z style ranges (code-point order).
 * @param {string} s
 * @returns {string[]}
 */
function expandTrSetString(s) {
  const str = String(s);
  const out = [];
  let i = 0;
  while (i < str.length) {
    if (str[i] === '\\') {
      const r = readTrBackslash(str, i);
      out.push(r.ch);
      i = r.next;
      continue;
    }
    const startCp = trCodePointAt(str, i);
    const afterStart = i + startCp.len;
    if (afterStart < str.length && str[afterStart] === '-' && afterStart + 1 < str.length) {
      const afterDash = afterStart + 1;
      let endCp;
      let endI;
      if (str[afterDash] === '\\') {
        const r = readTrBackslash(str, afterDash);
        endCp = trCodePointAt(r.ch, 0).cp;
        endI = r.next;
      } else {
        const e = trCodePointAt(str, afterDash);
        endCp = e.cp;
        endI = afterDash + e.len;
      }
      const lo = Math.min(startCp.cp, endCp);
      const hi = Math.max(startCp.cp, endCp);
      for (let cp = lo; cp <= hi; cp++) {
        out.push(String.fromCodePoint(cp));
      }
      i = endI;
      continue;
    }
    out.push(String.fromCodePoint(startCp.cp));
    i += startCp.len;
  }
  return out;
}

/**
 * @param {string[]} expanded
 * @returns {Set<string>}
 */
function trSetFromExpanded(expanded) {
  return new Set(expanded);
}

/**
 * @param {string[]} set1
 * @param {string[]} set2
 * @returns {Map<string, string>}
 */
function trBuildTranslationMap(set1, set2) {
  const map = new Map();
  const last = set2.length > 0 ? set2[set2.length - 1] : '';
  for (let i = 0; i < set1.length; i++) {
    const ch = set1[i];
    if (map.has(ch)) continue;
    const repl = set2.length === 0 ? '' : set2[i] !== undefined ? set2[i] : last;
    map.set(ch, repl);
  }
  return map;
}

/**
 * Squeeze consecutive runs of characters listed in `set` (expanded array as Set).
 * @param {string} input
 * @param {Set<string>} set
 */
function trSqueezeInput(input, set) {
  let out = '';
  let prev = null;
  for (const ch of input) {
    if (set.has(ch) && prev === ch) {
      continue;
    }
    out += ch;
    prev = ch;
  }
  return out;
}

/**
 * Run tr on stdin text (code points via JS string iteration).
 * @param {string} stdin
 * @param {{ complement: boolean, delete: boolean, squeeze: boolean, squeezeOnly: boolean, set1: string[], set2: string[] }} opts
 */
function runTr(stdin, opts) {
  const { complement, delete: del, squeeze, squeezeOnly = false, set1, set2 } = opts;
  const e1 = set1;
  const e2 = set2;
  const set1Set = trSetFromExpanded(e1);

  if (del) {
    let out = '';
    for (const ch of stdin) {
      const inSet = set1Set.has(ch);
      const drop = complement ? !inSet : inSet;
      if (!drop) out += ch;
    }
    return out;
  }

  const map = trBuildTranslationMap(e1, e2);

  let body = stdin;
  if (squeeze) {
    body = trSqueezeInput(body, set1Set);
  }
  if (squeezeOnly) {
    return body;
  }

  let out = '';
  for (const ch of body) {
    if (map.has(ch)) {
      out += map.get(ch);
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * Parse jsh `tr` argv.
 *
 * @param {string[]} args
 * @returns {{ ok: true, complement: boolean, delete: boolean, squeeze: boolean, squeezeOnly: boolean, operands: string[], help?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseTrArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  let complement = false;
  let deleteFlag = false;
  let squeeze = false;
  const operands = [];
  let i = 0;
  while (i < argsArr.length) {
    const arg = argsArr[i];
    if (arg === '--help' || arg === '-h') {
      return {
        ok: true,
        complement,
        delete: deleteFlag,
        squeeze,
        squeezeOnly: false,
        operands: [],
        help: true
      };
    }
    if (arg === '--') {
      operands.push(...argsArr.slice(i + 1));
      break;
    }
    if (arg === '--complement') {
      complement = true;
      i++;
      continue;
    }
    if (arg === '--delete') {
      deleteFlag = true;
      i++;
      continue;
    }
    if (arg === '--squeeze-repeats' || arg === '--squeeze') {
      squeeze = true;
      i++;
      continue;
    }
    if (arg === '-c' || arg === '-C') {
      complement = true;
      i++;
      continue;
    }
    if (arg === '-d') {
      deleteFlag = true;
      i++;
      continue;
    }
    if (arg === '-s') {
      squeeze = true;
      i++;
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1 && !arg.startsWith('--')) {
      const rest = arg.slice(1);
      for (const c of rest) {
        if (c === 'c' || c === 'C') complement = true;
        else if (c === 'd') deleteFlag = true;
        else if (c === 's') squeeze = true;
        else if (c === 'h') {
          return {
            ok: true,
            complement,
            delete: deleteFlag,
            squeeze,
            squeezeOnly: false,
            operands: [],
            help: true
          };
        } else {
          return { ok: false, stderr: trOptionError('tr', `-${c}`), exitCode: 2 };
        }
      }
      i++;
      continue;
    }
    if (arg.startsWith('--') && arg.length > 2) {
      return { ok: false, stderr: trOptionError('tr', arg), exitCode: 2 };
    }
    operands.push(arg, ...argsArr.slice(i + 1));
    break;
  }

  if (complement && !deleteFlag) {
    return {
      ok: false,
      stderr: `tr: when translating, complement is not supported in jsh; use tr SET1 SET2 without -c, or tr -cd SET1\nTry 'tr --help' for more information.\n`,
      exitCode: 2
    };
  }
  if (deleteFlag && squeeze) {
    return {
      ok: false,
      stderr: `tr: combining -d and -s is not supported in jsh\nTry 'tr --help' for more information.\n`,
      exitCode: 2
    };
  }

  if (deleteFlag) {
    if (operands.length < 1) {
      return {
        ok: false,
        stderr: `tr: missing operand after '-d'\nTwo strings must be given when both translating and deleting.\n`,
        exitCode: 2
      };
    }
    if (operands.length > 1) {
      return {
        ok: false,
        stderr: `tr: extra operand '${operands[1]}'\nTry 'tr --help' for more information.\n`,
        exitCode: 2
      };
    }
    return { ok: true, complement, delete: true, squeeze: false, squeezeOnly: false, operands };
  }

  if (squeeze) {
    if (operands.length < 1) {
      return {
        ok: false,
        stderr: `tr: missing operand\nTry 'tr --help' for more information.\n`,
        exitCode: 2
      };
    }
    if (operands.length > 2) {
      return {
        ok: false,
        stderr: `tr: extra operand '${operands[2]}'\nTry 'tr --help' for more information.\n`,
        exitCode: 2
      };
    }
    return {
      ok: true,
      complement,
      delete: false,
      squeeze: true,
      squeezeOnly: operands.length === 1,
      operands
    };
  }

  if (operands.length < 2) {
    return {
      ok: false,
      stderr: `tr: missing operand\nTry 'tr --help' for more information.\n`,
      exitCode: 2
    };
  }
  if (operands.length > 2) {
    return {
      ok: false,
      stderr: `tr: extra operand '${operands[2]}'\nTry 'tr --help' for more information.\n`,
      exitCode: 2
    };
  }
  return { ok: true, complement, delete: false, squeeze: false, squeezeOnly: false, operands };
}

export const TrLib = {
  TR_HELP,
  trOptionError,
  readTrBackslash,
  trCodePointAt,
  expandTrSetString,
  trSetFromExpanded,
  trBuildTranslationMap,
  trSqueezeInput,
  runTr,
  parseTrArgv
};

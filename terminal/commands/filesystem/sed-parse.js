/**
 * Read one field in an `s` command until unescaped DELIM.
 * @param {string} s
 * @param {number} start
 * @param {string} delim
 * @returns {{ ok: true, text: string, next: number } | { ok: false, stderr: string }}
 */
function sedReadSubstField(s, start, delim) {
  let out = '';
  let i = start;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length) {
      const n = s[i + 1];
      if (n === delim) {
        out += delim;
        i += 2;
        continue;
      }
      if (n === '\\') {
        out += '\\';
        i += 2;
        continue;
      }
      if (n === 'n') {
        out += '\n';
        i += 2;
        continue;
      }
      if (n === 't') {
        out += '\t';
        i += 2;
        continue;
      }
    }
    if (c === delim) {
      return { ok: true, text: out, next: i + 1 };
    }
    out += c;
    i++;
  }
  return { ok: false, stderr: "sed: unterminated `s' command\n" };
}
/**
 * Parse one `s///` sed script (trimmed). Pattern/replacement are literals.
 *
 * @param {string} script
 * @returns {{ ok: true, pattern: string, replacement: string, global: boolean, printFlag: boolean, ignoreCase: boolean } | { ok: false, stderr: string }}
 */
export function parseSedSubstituteScript(script) {
  const s = String(script).trim();
  if (!s.startsWith('s')) {
    return {
      ok: false,
      stderr: `sed: unsupported command \`${s.slice(0, 40)}${s.length > 40 ? '…' : ''}'\n`
    };
  }
  const delim = s[1];
  if (!delim || /[\r\n]/.test(delim)) {
    return { ok: false, stderr: "sed: invalid `s' command\n" };
  }
  const p1 = sedReadSubstField(s, 2, delim);
  if (p1.ok === false) {
    return p1;
  }
  const p2 = sedReadSubstField(s, p1.next, delim);
  if (p2.ok === false) {
    return p2;
  }
  let flags = s.slice(p2.next).trim();
  if (flags.length > 0 && flags[0] === delim) {
    flags = flags.slice(1).trim();
  }
  let global = false;
  let printFlag = false;
  let ignoreCase = false;
  for (const ch of flags) {
    if (ch === 'g') global = true;
    else if (ch === 'p') printFlag = true;
    else if (ch === 'i' || ch === 'I') ignoreCase = true;
    else {
      return { ok: false, stderr: `sed: unknown option to \`s' (${ch})\n` };
    }
  }
  return {
    ok: true,
    pattern: p1.text,
    replacement: p2.text,
    global,
    printFlag,
    ignoreCase
  };
}

/**
 * @param {{ type: 'single', n: number } | { type: 'single', last: true } | { type: 'range', start: number, end: number | 'last' } | { type: 'pattern', pattern: string } | { type: 'patternRange', start: string, end: string } | { type: 'patternToLine', pattern: string, n: number } | { type: 'lineToPattern', n: number, pattern: string }} address
 * @param {string} scriptFromS
 * @returns {{ ok: true, kind: 'substitute', address: *, pattern: string, replacement: string, global: boolean, printFlag: boolean, ignoreCase: boolean } | { ok: false, stderr: string }}
 */
function parseSedSubstituteWithAddress(address, scriptFromS) {
  const sub = parseSedSubstituteScript(scriptFromS);
  if (sub.ok === false) {
    return sub;
  }
  return {
    ok: true,
    kind: 'substitute',
    address,
    pattern: sub.pattern,
    replacement: sub.replacement,
    global: sub.global,
    printFlag: sub.printFlag,
    ignoreCase: sub.ignoreCase
  };
}

/**
 * Line-number **s** forms: **Ns** / **N,Ms** / **N,$s** (trimmed).
 *
 * @param {string} t
 * @returns {{ ok: true, kind: 'substitute', address: { type: 'single', n: number } | { type: 'range', start: number, end: number | 'last' }, pattern: string, replacement: string, global: boolean, printFlag: boolean, ignoreCase: boolean } | { ok: false, stderr: string } | null}
 */
function parseSedLineNumberSubstitute(t) {
  const s = String(t).trim();
  const mRange = /^([1-9]\d*),([1-9]\d*)s/.exec(s);
  if (mRange) {
    const rest = s.slice(mRange.index + mRange[0].length - 1);
    const sub = parseSedSubstituteScript(rest);
    if (sub.ok === false) {
      return sub;
    }
    return {
      ok: true,
      kind: 'substitute',
      address: { type: 'range', start: parseInt(mRange[1], 10), end: parseInt(mRange[2], 10) },
      pattern: sub.pattern,
      replacement: sub.replacement,
      global: sub.global,
      printFlag: sub.printFlag,
      ignoreCase: sub.ignoreCase
    };
  }
  const mLast = /^([1-9]\d*),\$s/.exec(s);
  if (mLast) {
    const rest = s.slice(mLast.index + mLast[0].length - 1);
    const sub = parseSedSubstituteScript(rest);
    if (sub.ok === false) {
      return sub;
    }
    return {
      ok: true,
      kind: 'substitute',
      address: { type: 'range', start: parseInt(mLast[1], 10), end: 'last' },
      pattern: sub.pattern,
      replacement: sub.replacement,
      global: sub.global,
      printFlag: sub.printFlag,
      ignoreCase: sub.ignoreCase
    };
  }
  const mSingle = /^([1-9]\d*)s(.)/.exec(s);
  if (mSingle) {
    const delim = mSingle[2];
    if (/[\r\n]/.test(delim)) {
      return null;
    }
    const rest = s.slice(mSingle.index + mSingle[1].length);
    const sub = parseSedSubstituteScript(rest);
    if (sub.ok === false) {
      return sub;
    }
    return {
      ok: true,
      kind: 'substitute',
      address: { type: 'single', n: parseInt(mSingle[1], 10) },
      pattern: sub.pattern,
      replacement: sub.replacement,
      global: sub.global,
      printFlag: sub.printFlag,
      ignoreCase: sub.ignoreCase
    };
  }
  return null;
}

/**
 * **N,/PAT/s** — same address as **N,/PAT/d** with **s///** command.
 *
 * @param {string} t
 * @returns {{ ok: true, kind: 'substitute', address: { type: 'lineToPattern', n: number, pattern: string }, pattern: string, replacement: string, global: boolean, printFlag: boolean, ignoreCase: boolean } | { ok: false, stderr: string } | null}
 */
function parseSedLineToPatternSubstitute(t) {
  const s = String(t).trim();
  const m = /^([1-9]\d*),/.exec(s);
  if (!m) {
    return null;
  }
  const n = parseInt(m[1], 10);
  let pos = m[0].length;
  pos = sedSkipWs(s, pos);
  if (pos >= s.length || s[pos] !== '/') {
    return null;
  }
  const read = sedReadSubstField(s, pos + 1, '/');
  if (read.ok === false) {
    return { ok: false, stderr: "sed: unterminated `/' pattern in address\n" };
  }
  const rest = s.slice(read.next).trim();
  if (!rest.startsWith('s')) {
    return null;
  }
  return parseSedSubstituteWithAddress({ type: 'lineToPattern', n, pattern: read.text }, rest);
}

/**
 * Slash-address PAT, comma, line N, then **s///** (same selection as slash-PAT comma **Nd** delete).
 *
 * @param {string} t
 * @returns {{ ok: true, kind: 'substitute', address: { type: 'patternToLine', pattern: string, n: number }, pattern: string, replacement: string, global: boolean, printFlag: boolean, ignoreCase: boolean } | { ok: false, stderr: string } | null}
 */
function parseSedSlashPatternToLineSubstitute(t) {
  const s = String(t).trim();
  if (!s.startsWith('/')) {
    return null;
  }
  const read1 = sedReadSubstField(s, 1, '/');
  if (read1.ok === false) {
    return { ok: false, stderr: "sed: unterminated `/' pattern in address\n" };
  }
  let rest = s.slice(read1.next).trim();
  if (!rest.startsWith(',')) {
    return null;
  }
  rest = rest.slice(1).trim();
  const mNum = /^([1-9]\d*)s(.)/.exec(rest);
  if (!mNum) {
    return null;
  }
  const restFromS = rest.slice(mNum.index + mNum[1].length);
  const sub = parseSedSubstituteScript(restFromS);
  if (sub.ok === false) {
    return sub;
  }
  return {
    ok: true,
    kind: 'substitute',
    address: { type: 'patternToLine', pattern: read1.text, n: parseInt(mNum[1], 10) },
    pattern: sub.pattern,
    replacement: sub.replacement,
    global: sub.global,
    printFlag: sub.printFlag,
    ignoreCase: sub.ignoreCase
  };
}

/**
 * Pattern range **PAT1** through **PAT2** (slash form), then **s///** substitute.
 *
 * @param {string} t
 * @returns {{ ok: true, kind: 'substitute', address: { type: 'patternRange', start: string, end: string }, pattern: string, replacement: string, global: boolean, printFlag: boolean, ignoreCase: boolean } | { ok: false, stderr: string } | null}
 */
function parseSedSlashPatternRangeSubstitute(t) {
  const s = String(t).trim();
  if (!s.startsWith('/')) {
    return null;
  }
  const read1 = sedReadSubstField(s, 1, '/');
  if (read1.ok === false) {
    return { ok: false, stderr: "sed: unterminated `/' pattern in address\n" };
  }
  let rest = s.slice(read1.next).trim();
  if (!rest.startsWith(',')) {
    return null;
  }
  rest = rest.slice(1).trim();
  if (!rest.startsWith('/')) {
    return null;
  }
  const read2 = sedReadSubstField(rest, 1, '/');
  if (read2.ok === false) {
    return { ok: false, stderr: read2.stderr };
  }
  const rest2 = rest.slice(read2.next).trim();
  if (!rest2.startsWith('s')) {
    return null;
  }
  return parseSedSubstituteWithAddress(
    { type: 'patternRange', start: read1.text, end: read2.text },
    rest2
  );
}

/**
 * Single slash **PAT** address, then **s///** substitute.
 *
 * @param {string} t
 * @returns {{ ok: true, kind: 'substitute', address: { type: 'pattern', pattern: string }, pattern: string, replacement: string, global: boolean, printFlag: boolean, ignoreCase: boolean } | { ok: false, stderr: string } | null}
 */
function parseSedSlashPatternSingleSubstitute(t) {
  const s = String(t).trim();
  if (!s.startsWith('/')) {
    return null;
  }
  const read = sedReadSubstField(s, 1, '/');
  if (read.ok === false) {
    return { ok: false, stderr: "sed: unterminated `/' pattern in address\n" };
  }
  const rest = s.slice(read.next).trim();
  if (rest.startsWith(',')) {
    return null;
  }
  if (!rest.startsWith('s')) {
    return null;
  }
  return parseSedSubstituteWithAddress({ type: 'pattern', pattern: read.text }, rest);
}

/**
 * Parse line-number **d** forms: **Nd**, **$d**, **N,Md**, **N,$d** (trimmed).
 *
 * @param {string} t
 * @returns {{ ok: true, kind: 'delete', address: { type: 'single', n: number } | { type: 'single', last: true } | { type: 'range', start: number, end: number | 'last' } } } | null
 */
export function parseSedAddressedDelete(t) {
  if (t === '$d') {
    return { ok: true, kind: 'delete', address: { type: 'single', last: true } };
  }
  const mN = /^([1-9]\d*)d$/.exec(t);
  if (mN) {
    const n = parseInt(mN[1], 10);
    return { ok: true, kind: 'delete', address: { type: 'single', n } };
  }
  const mRange = /^([1-9]\d*),([1-9]\d*)d$/.exec(t);
  if (mRange) {
    const a = parseInt(mRange[1], 10);
    const b = parseInt(mRange[2], 10);
    return { ok: true, kind: 'delete', address: { type: 'range', start: a, end: b } };
  }
  const mRangeLast = /^([1-9]\d*),\$d$/.exec(t);
  if (mRangeLast) {
    const a = parseInt(mRangeLast[1], 10);
    return { ok: true, kind: 'delete', address: { type: 'range', start: a, end: 'last' } };
  }
  return null;
}

/**
 * **N,/PAT/d** — line **N** through first line containing literal **PAT** (inclusive).
 *
 * @param {string} t
 * @returns {{ ok: true, kind: 'delete', address: { type: 'lineToPattern', n: number, pattern: string } } | { ok: false, stderr: string } | null}
 */
export function parseSedLineToPatternDelete(t) {
  const s = String(t).trim();
  const m = /^([1-9]\d*),/.exec(s);
  if (!m) {
    return null;
  }
  const n = parseInt(m[1], 10);
  let pos = m[0].length;
  pos = sedSkipWs(s, pos);
  if (pos >= s.length || s[pos] !== '/') {
    return null;
  }
  const read = sedReadSubstField(s, pos + 1, '/');
  if (read.ok === false) {
    return { ok: false, stderr: "sed: unterminated `/' pattern in address\n" };
  }
  const rest = s.slice(read.next).trim();
  if (rest === 'd') {
    return {
      ok: true,
      kind: 'delete',
      address: { type: 'lineToPattern', n, pattern: read.text }
    };
  }
  if (rest === '') {
    return { ok: false, stderr: "sed: missing command after `/pattern/'\n" };
  }
  return {
    ok: false,
    stderr: `sed: unsupported command \`${rest.slice(0, 40)}${
      rest.length > 40 ? '…' : ''
    }' after /pattern/\n`
  };
}

/**
 * Slash pattern through line number: **\/PAT/,Nd** — first line matching **PAT** through line **N**
 * (GNU: if **L > N**, only line **L**).
 *
 * @param {string} t
 * @returns {{ ok: true, kind: 'delete', address: { type: 'patternToLine', pattern: string, n: number } } | { ok: false, stderr: string } | null}
 */
export function parseSedSlashPatternToLineDelete(t) {
  const s = String(t).trim();
  if (!s.startsWith('/')) {
    return null;
  }
  const read1 = sedReadSubstField(s, 1, '/');
  if (read1.ok === false) {
    return { ok: false, stderr: "sed: unterminated `/' pattern in address\n" };
  }
  let rest = s.slice(read1.next).trim();
  if (!rest.startsWith(',')) {
    return null;
  }
  rest = rest.slice(1).trim();
  const mNum = /^([1-9]\d*)d$/.exec(rest);
  if (!mNum) {
    if (/^[1-9]/.test(rest)) {
      return { ok: false, stderr: 'sed: invalid address range\n' };
    }
    return null;
  }
  const n = parseInt(mNum[1], 10);
  return {
    ok: true,
    kind: 'delete',
    address: { type: 'patternToLine', pattern: read1.text, n }
  };
}

/**
 * Parse a slash-delimited pattern delete command (literal substring; escapes match sedReadSubstField with slash).
 *
 * @param {string} t
 * @returns {{ ok: true, kind: 'delete', address: { type: 'pattern', pattern: string } } | { ok: false, stderr: string } | null}
 */
export function parseSedSlashPatternDelete(t) {
  const s = String(t).trim();
  if (!s.startsWith('/')) {
    return null;
  }
  const read = sedReadSubstField(s, 1, '/');
  if (read.ok === false) {
    return { ok: false, stderr: "sed: unterminated `/' pattern in address\n" };
  }
  const rest = s.slice(read.next).trim();
  if (rest.startsWith(',')) {
    return null;
  }
  if (rest === 'd') {
    return { ok: true, kind: 'delete', address: { type: 'pattern', pattern: read.text } };
  }
  if (rest === '') {
    return { ok: false, stderr: "sed: missing command after `/pattern/'\n" };
  }
  return {
    ok: false,
    stderr: `sed: unsupported command \`${rest.slice(0, 40)}${
      rest.length > 40 ? '…' : ''
    }' after /pattern/\n`
  };
}

/**
 * Parse a two-pattern delete command: slash, PAT1, slash, comma, slash, PAT2, slash, `d`
 * (literal substrings; same escapes as **s///**).
 *
 * @param {string} t
 * @returns {{ ok: true, kind: 'delete', address: { type: 'patternRange', start: string, end: string } } | { ok: false, stderr: string } | null}
 */
export function parseSedSlashPatternRangeDelete(t) {
  const s = String(t).trim();
  if (!s.startsWith('/')) {
    return null;
  }
  const read1 = sedReadSubstField(s, 1, '/');
  if (read1.ok === false) {
    return { ok: false, stderr: "sed: unterminated `/' pattern in address\n" };
  }
  let rest = s.slice(read1.next).trim();
  if (!rest.startsWith(',')) {
    return null;
  }
  rest = rest.slice(1).trim();
  if (!rest.startsWith('/')) {
    return { ok: false, stderr: 'sed: invalid address range\n' };
  }
  const read2 = sedReadSubstField(rest, 1, '/');
  if (read2.ok === false) {
    return { ok: false, stderr: "sed: unterminated `/' pattern in address\n" };
  }
  const rest2 = rest.slice(read2.next).trim();
  if (rest2 === 'd') {
    return {
      ok: true,
      kind: 'delete',
      address: { type: 'patternRange', start: read1.text, end: read2.text }
    };
  }
  if (rest2 === '') {
    return { ok: false, stderr: "sed: missing command after `/pattern/'\n" };
  }
  return {
    ok: false,
    stderr: `sed: unsupported command \`${rest2.slice(0, 40)}${
      rest2.length > 40 ? '…' : ''
    }' after range\n`
  };
}

/**
 * @param {string} s
 * @param {number} i
 * @returns {number}
 */
function sedSkipWs(s, i) {
  while (i < s.length && /\s/.test(s[i])) i++;
  return i;
}

/**
 * Consume one **s///** command starting after **sedSkipWs**; **next** index stops
 * before any **;** that separates commands (GNU-style).
 *
 * @param {string} s
 * @param {number} start
 * @returns {{ ok: true, next: number } | { ok: false, stderr: string }}
 */
function sedConsumeSubstituteCommand(s, start) {
  const i = sedSkipWs(s, start);
  if (i >= s.length || s[i] !== 's') {
    return {
      ok: false,
      stderr: `sed: unsupported command \`${String(s.slice(start)).trim().slice(0, 40)}${
        String(s.slice(start)).trim().length > 40 ? '…' : ''
      }'\n`
    };
  }
  const delim = s[i + 1];
  if (!delim || /[\r\n]/.test(delim)) {
    return { ok: false, stderr: "sed: invalid `s' command\n" };
  }
  const p1 = sedReadSubstField(s, i + 2, delim);
  if (p1.ok === false) return p1;
  const p2 = sedReadSubstField(s, p1.next, delim);
  if (p2.ok === false) return p2;
  let j = p2.next;
  j = sedSkipWs(s, j);
  if (j < s.length && s[j] === delim) {
    j++;
    j = sedSkipWs(s, j);
  }
  while (j < s.length && /[gipI]/.test(s[j])) j++;
  j = sedSkipWs(s, j);
  if (j < s.length && s[j] !== ';') {
    return { ok: false, stderr: `sed: unknown option to \`s' (${s[j]})\n` };
  }
  return { ok: true, next: j };
}

/**
 * **Ns** / **N,Ms** / **N,$s** at **start** (after whitespace).
 *
 * @param {string} s
 * @param {number} start
 * @returns {{ ok: true, next: number } | { ok: false, stderr: string } | null}
 */
function sedConsumeLineNumberedSubstitute(s, start) {
  const i = sedSkipWs(s, start);
  const sub = s.slice(i);
  const m = /^([1-9]\d*),([1-9]\d*)s/.exec(sub);
  const m2 = /^([1-9]\d*),\$s/.exec(sub);
  const m3 = /^([1-9]\d*)s/.exec(sub);
  let sPos = -1;
  if (m) {
    sPos = i + m.index + m[0].length - 1;
  } else if (m2) {
    sPos = i + m2.index + m2[0].length - 1;
  } else if (m3) {
    sPos = i + m3.index + m3[0].length - 1;
  }
  if (sPos < 0) {
    return null;
  }
  return sedConsumeSubstituteCommand(s, sPos);
}

/**
 * Consume slash-delimited **pat** **d** or **pat1**,**pat2** range **d** from **start**
 * (after whitespace); **null** if the line does not start with a slash.
 *
 * @param {string} s
 * @param {number} start
 * @returns {{ ok: true, next: number } | { ok: false, stderr: string } | null}
 */
function sedConsumeSlashDelete(s, start) {
  const i = sedSkipWs(s, start);
  if (i >= s.length || s[i] !== '/') {
    return null;
  }
  const r1 = sedReadSubstField(s, i + 1, '/');
  if (r1.ok === false) {
    return { ok: false, stderr: r1.stderr };
  }
  let pos = r1.next;
  pos = sedSkipWs(s, pos);
  if (pos >= s.length) {
    return { ok: false, stderr: "sed: missing command after `/pattern/'\n" };
  }
  if (s[pos] === ',') {
    pos++;
    pos = sedSkipWs(s, pos);
    if (pos >= s.length) {
      return { ok: false, stderr: 'sed: invalid address range\n' };
    }
    if (/[1-9]/.test(s[pos])) {
      let j = pos;
      while (j < s.length && /[0-9]/.test(s[j])) {
        j++;
      }
      if (j === pos) {
        return { ok: false, stderr: 'sed: invalid address range\n' };
      }
      pos = sedSkipWs(s, j);
      if (pos >= s.length || s[pos] !== 'd') {
        if (pos < s.length && s[pos] === 's') {
          return sedConsumeSubstituteCommand(s, pos);
        }
        const rest = pos < s.length ? s.slice(pos) : '';
        if (rest === '') {
          return { ok: false, stderr: "sed: missing command after `/pattern/'\n" };
        }
        return {
          ok: false,
          stderr: `sed: unsupported command \`${rest.slice(0, 40)}${
            rest.length > 40 ? '…' : ''
          }' after range\n`
        };
      }
      return { ok: true, next: pos + 1 };
    }
    if (s[pos] !== '/') {
      return { ok: false, stderr: 'sed: invalid address range\n' };
    }
    const r2 = sedReadSubstField(s, pos + 1, '/');
    if (r2.ok === false) {
      return { ok: false, stderr: r2.stderr };
    }
    pos = r2.next;
    pos = sedSkipWs(s, pos);
    if (pos >= s.length || s[pos] !== 'd') {
      if (pos < s.length && s[pos] === 's') {
        return sedConsumeSubstituteCommand(s, pos);
      }
      const rest = pos < s.length ? s.slice(pos) : '';
      if (rest === '') {
        return { ok: false, stderr: "sed: missing command after `/pattern/'\n" };
      }
      return {
        ok: false,
        stderr: `sed: unsupported command \`${rest.slice(0, 40)}${
          rest.length > 40 ? '…' : ''
        }' after range\n`
      };
    }
    return { ok: true, next: pos + 1 };
  }
  if (s[pos] === 'd' && (pos + 1 >= s.length || /[\s;]/.test(s[pos + 1]))) {
    return { ok: true, next: pos + 1 };
  }
  if (s[pos] === 's') {
    return sedConsumeSubstituteCommand(s, pos);
  }
  const rest = s.slice(pos);
  if (rest === '') {
    return { ok: false, stderr: "sed: missing command after `/pattern/'\n" };
  }
  return {
    ok: false,
    stderr: `sed: unsupported command \`${rest.slice(0, 40)}${
      rest.length > 40 ? '…' : ''
    }' after /pattern/\n`
  };
}

/**
 * **N,/PAT/d** starting at **start** (after whitespace).
 *
 * @param {string} s
 * @param {number} start
 * @returns {{ ok: true, next: number } | { ok: false, stderr: string } | null}
 */
function sedConsumeLinePatternDelete(s, start) {
  const i = sedSkipWs(s, start);
  const sub = s.slice(i);
  const m = /^([1-9]\d*),\//.exec(sub);
  if (!m) {
    return null;
  }
  const slashPos = i + m[0].length - 1;
  const read = sedReadSubstField(s, slashPos + 1, '/');
  if (read.ok === false) {
    return { ok: false, stderr: read.stderr };
  }
  let pos = read.next;
  pos = sedSkipWs(s, pos);
  if (pos >= s.length || s[pos] !== 'd') {
    if (pos < s.length && s[pos] === 's') {
      return sedConsumeSubstituteCommand(s, pos);
    }
    const rest = pos < s.length ? s.slice(pos) : '';
    if (rest === '') {
      return { ok: false, stderr: "sed: missing command after `/pattern/'\n" };
    }
    return {
      ok: false,
      stderr: `sed: unsupported command \`${rest.slice(0, 40)}${
        rest.length > 40 ? '…' : ''
      }' after /pattern/\n`
    };
  }
  return { ok: true, next: pos + 1 };
}

/**
 * Find end index of one sed command in a script string (**;**-separable).
 *
 * @param {string} s
 * @param {number} start
 * @returns {{ ok: true, next: number, empty?: true } | { ok: false, stderr: string }}
 */
function sedConsumeOneCommand(s, start) {
  let i = sedSkipWs(s, start);
  if (i >= s.length) {
    return { ok: true, next: start, empty: true };
  }
  if (s[i] === 's') {
    return sedConsumeSubstituteCommand(s, start);
  }
  const lineNumSub = sedConsumeLineNumberedSubstitute(s, start);
  if (lineNumSub !== null) {
    return lineNumSub;
  }
  const linePat = sedConsumeLinePatternDelete(s, start);
  if (linePat !== null) {
    return linePat;
  }
  const slash = sedConsumeSlashDelete(s, start);
  if (slash !== null) {
    return slash;
  }
  const sub = s.slice(i);
  const mRange = /^([1-9]\d*),([1-9]\d*)d(?=\s|;|$)/.exec(sub);
  if (mRange) {
    return { ok: true, next: i + mRange[0].length };
  }
  const mRangeLast = /^([1-9]\d*),\$d(?=\s|;|$)/.exec(sub);
  if (mRangeLast) {
    return { ok: true, next: i + mRangeLast[0].length };
  }
  const mN = /^([1-9]\d*)d(?=\s|;|$)/.exec(sub);
  if (mN) {
    return { ok: true, next: i + mN[0].length };
  }
  const mDollar = /^\$d(?=\s|;|$)/.exec(sub);
  if (mDollar) {
    return { ok: true, next: i + 2 };
  }
  if (s[i] === 'd' && (i + 1 >= s.length || /[\s;]/.test(s[i + 1]))) {
    return { ok: true, next: i + 1 };
  }
  return {
    ok: false,
    stderr: `sed: unsupported command \`${sub.slice(0, 40)}${sub.length > 40 ? '…' : ''}'\n`
  };
}

/**
 * Split one **SCRIPT** string into commands separated by **;** (outside **s**-command
 * delimiter fields). Same effect as multiple **-e** fragments. Empty / whitespace-only →
 * no commands (pass-through).
 *
 * @param {string} script
 * @returns {{ ok: true, commands: string[] } | { ok: false, stderr: string }}
 */
export function splitSedScriptIntoCommands(script) {
  const s = String(script);
  if (!s.trim()) {
    return { ok: true, commands: [] };
  }
  /** @type {string[]} */
  const commands = [];
  let i = 0;
  while (i < s.length) {
    i = sedSkipWs(s, i);
    if (i >= s.length) break;
    if (s[i] === ';') {
      i++;
      continue;
    }
    const r = sedConsumeOneCommand(s, i);
    if (r.ok === false) return r;
    if (r.empty) {
      return { ok: false, stderr: 'sed: invalid script\n' };
    }
    const cmd = s.slice(i, r.next).trim();
    if (cmd.length) commands.push(cmd);
    i = r.next;
    i = sedSkipWs(s, i);
    if (i < s.length && s[i] === ';') {
      i++;
      continue;
    }
    if (i >= s.length) break;
    return { ok: false, stderr: 'sed: extra characters after command\n' };
  }
  return { ok: true, commands };
}
/**
 * Parse one jsh `sed` script: **d** (delete line(s)), line-addressed **d**, pattern **d**, pattern-range **d**, or **s///** substitute.
 *
 * @param {string} script
 * @returns {{ ok: true, kind: 'delete', address?: null | { type: 'single', n: number } | { type: 'single', last: true } | { type: 'range', start: number, end: number | 'last' } | { type: 'pattern', pattern: string } | { type: 'patternRange', start: string, end: string } | { type: 'patternToLine', pattern: string, n: number } | { type: 'lineToPattern', n: number, pattern: string } } | { ok: true, kind: 'substitute', address?: { type: 'single', n: number } | { type: 'single', last: true } | { type: 'range', start: number, end: number | 'last' } | { type: 'pattern', pattern: string } | { type: 'patternRange', start: string, end: string } | { type: 'patternToLine', pattern: string, n: number } | { type: 'lineToPattern', n: number, pattern: string }, pattern: string, replacement: string, global: boolean, printFlag: boolean, ignoreCase: boolean } | { ok: false, stderr: string }}
 */
export function parseSedScript(script) {
  const t = String(script).trim();
  if (t === 'd') {
    return { ok: true, kind: 'delete', address: null };
  }
  const addrDel = parseSedAddressedDelete(t);
  if (addrDel) {
    return addrDel;
  }
  const lineNumSub = parseSedLineNumberSubstitute(t);
  if (lineNumSub !== null) {
    return lineNumSub;
  }
  const linePatSub = parseSedLineToPatternSubstitute(t);
  if (linePatSub !== null) {
    return linePatSub;
  }
  const linePatDel = parseSedLineToPatternDelete(t);
  if (linePatDel !== null) {
    return linePatDel;
  }
  if (t.startsWith('/')) {
    const patToLineSub = parseSedSlashPatternToLineSubstitute(t);
    if (patToLineSub !== null) {
      return patToLineSub;
    }
    const patToLine = parseSedSlashPatternToLineDelete(t);
    if (patToLine !== null) {
      return patToLine;
    }
    const rangeSub = parseSedSlashPatternRangeSubstitute(t);
    if (rangeSub !== null) {
      return rangeSub;
    }
    const rangeDel = parseSedSlashPatternRangeDelete(t);
    if (rangeDel !== null) {
      return rangeDel;
    }
    const slashSub = parseSedSlashPatternSingleSubstitute(t);
    if (slashSub !== null) {
      return slashSub;
    }
    const slashDel = parseSedSlashPatternDelete(t);
    return slashDel;
  }
  const sub = parseSedSubstituteScript(script);
  if (sub.ok === false) {
    return sub;
  }
  return {
    ok: true,
    kind: 'substitute',
    pattern: sub.pattern,
    replacement: sub.replacement,
    global: sub.global,
    printFlag: sub.printFlag,
    ignoreCase: sub.ignoreCase
  };
}

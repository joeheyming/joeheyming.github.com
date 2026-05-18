import {
  awkSkipQuotedString,
  awkFindMatchingParen,
  awkFindMatchingBracket,
  awkParseArrayAccess
} from './awk-parse-expr.js';
import { awkEvalPrintExpr } from './awk-print.js';

/**
 * Coerce a string to a number (GNU awk–like for jsh: **parseFloat** leading portion, **''** → **0**).
 * @param {string} s
 * @returns {number}
 */
function awkStrToNum(s) {
  const t = String(s).trim();
  if (t === '') {
    return 0;
  }
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Format an arithmetic result for **print** output (integers without trailing **.0** when exact).
 * @param {number} n
 * @returns {string}
 */
function awkFormatArithResult(n) {
  if (Number.isNaN(n)) {
    return 'nan';
  }
  if (n === Infinity) {
    return 'inf';
  }
  if (n === -Infinity) {
    return '-inf';
  }
  if (Math.abs(n) < 1e15 && Math.abs(n - Math.round(n)) < 1e-9) {
    return String(Math.round(n));
  }
  return String(n);
}

/**
 * Recursive-descent parser for +, -, *, /, %, ^ (right-assoc), unary -, parentheses,
 * and awk primaries inside print expressions (jsh subset).
 */
class AwkArithParser {
  /**
   * @param {string} str
   * @param {{ $0: string, fields: string[], NR: number, NF: number, RSTART?: number, RLENGTH?: number, awkArrays?: Record<string, Record<string, string>> }} ctx
   */
  constructor(str, ctx) {
    this.s = str;
    this.i = 0;
    this.ctx = ctx;
  }

  skipSpaces() {
    while (this.i < this.s.length && /\s/.test(this.s[this.i])) {
      this.i++;
    }
  }

  peek() {
    return this.i < this.s.length ? this.s[this.i] : '';
  }

  parseAddSub() {
    let left = this.parseMulDiv();
    if (left === null) {
      return null;
    }
    for (;;) {
      this.skipSpaces();
      const c = this.peek();
      if (c === '+') {
        this.i++;
        const right = this.parseMulDiv();
        if (right === null) {
          return null;
        }
        left += right;
      } else if (c === '-') {
        this.i++;
        const right = this.parseMulDiv();
        if (right === null) {
          return null;
        }
        left -= right;
      } else {
        break;
      }
    }
    return left;
  }

  parseMulDiv() {
    let left = this.parseUnaryExpr();
    if (left === null) {
      return null;
    }
    for (;;) {
      this.skipSpaces();
      const op = this.peek();
      if (op === '*') {
        this.i++;
        const right = this.parseUnaryExpr();
        if (right === null) {
          return null;
        }
        left *= right;
      } else if (op === '/') {
        this.i++;
        const right = this.parseUnaryExpr();
        if (right === null) {
          return null;
        }
        left /= right;
      } else if (op === '%') {
        this.i++;
        const right = this.parseUnaryExpr();
        if (right === null) {
          return null;
        }
        if (right === 0) {
          return null;
        }
        left %= right;
      } else {
        break;
      }
    }
    return left;
  }

  /**
   * Unary plus/minus binds looser than caret (GNU awk: -2^2 is -(2^2)).
   * Non-unary path parses exponentiation / postfix.
   */
  parseUnaryExpr() {
    this.skipSpaces();
    if (this.peek() === '+') {
      this.i++;
      return this.parseUnaryExpr();
    }
    if (this.peek() === '-') {
      this.i++;
      const u = this.parseUnaryExpr();
      return u === null ? null : -u;
    }
    return this.parsePowExpr();
  }

  /** **^** is right-associative; exponent may start with unary (**2^-2**). */
  parsePowExpr() {
    let left = this.parsePrimary();
    if (left === null) {
      return null;
    }
    for (;;) {
      this.skipSpaces();
      if (this.peek() !== '^') {
        break;
      }
      this.i++;
      const right = this.parseUnaryExpr();
      if (right === null) {
        return null;
      }
      left = Math.pow(left, right);
    }
    return left;
  }

  parsePrimary() {
    this.skipSpaces();
    const c = this.peek();
    if (c === '') {
      return null;
    }
    if (c === '(') {
      this.i++;
      const inner = this.parseAddSub();
      if (inner === null) {
        return null;
      }
      this.skipSpaces();
      if (this.peek() !== ')') {
        return null;
      }
      this.i++;
      return inner;
    }
    if (c === '"' || c === "'") {
      const q = c;
      const end = awkSkipQuotedString(this.s, this.i);
      if (end <= this.i + 1 || this.s[end - 1] !== q) {
        return null;
      }
      const inner = this.s.slice(this.i + 1, end - 1);
      this.i = end;
      return awkStrToNum(inner);
    }
    if (c === '$') {
      this.i++;
      this.skipSpaces();
      const m = /^\d+/.exec(this.s.slice(this.i));
      if (!m) {
        return null;
      }
      this.i += m[0].length;
      const n = parseInt(m[0], 10);
      const fv = this.ctx.fields[n - 1];
      return awkStrToNum(fv !== undefined ? fv : '');
    }
    if (
      this.s.slice(this.i, this.i + 2) === 'NR' &&
      (this.i + 2 >= this.s.length || !/[A-Za-z0-9_]/.test(this.s[this.i + 2]))
    ) {
      this.i += 2;
      return awkStrToNum(String(this.ctx.NR));
    }
    if (
      this.s.slice(this.i, this.i + 2) === 'NF' &&
      (this.i + 2 >= this.s.length || !/[A-Za-z0-9_]/.test(this.s[this.i + 2]))
    ) {
      this.i += 2;
      return awkStrToNum(String(this.ctx.NF));
    }
    if (
      this.s.slice(this.i).startsWith('RSTART') &&
      (this.i + 6 >= this.s.length || !/[A-Za-z0-9_]/.test(this.s[this.i + 6]))
    ) {
      this.i += 6;
      return awkStrToNum(String(this.ctx.RSTART !== undefined ? this.ctx.RSTART : 0));
    }
    if (
      this.s.slice(this.i).startsWith('RLENGTH') &&
      (this.i + 7 >= this.s.length || !/[A-Za-z0-9_]/.test(this.s[this.i + 7]))
    ) {
      this.i += 7;
      return awkStrToNum(String(this.ctx.RLENGTH !== undefined ? this.ctx.RLENGTH : -1));
    }
    {
      const rest = this.s.slice(this.i);
      const mArr = /^([A-Za-z_][A-Za-z0-9_]*)\s*\[/.exec(rest);
      if (mArr) {
        const openIdx = this.i + mArr[0].length - 1;
        const closeIdx = awkFindMatchingBracket(this.s, openIdx);
        if (closeIdx >= 0) {
          const full = this.s.slice(this.i, closeIdx + 1);
          const acc = awkParseArrayAccess(full);
          if (acc) {
            const v = awkEvalPrintExpr(full, this.ctx);
            if (v === null) {
              return null;
            }
            this.i = closeIdx + 1;
            return awkStrToNum(v);
          }
        }
      }
    }
    if (this.s.slice(this.i).startsWith('length')) {
      let k = this.i + 6;
      while (k < this.s.length && /\s/.test(this.s[k])) {
        k++;
      }
      if (k >= this.s.length || this.s[k] !== '(') {
        return null;
      }
      const closeIdx = awkFindMatchingParen(this.s, k);
      if (closeIdx < 0) {
        return null;
      }
      const inner = this.s.slice(k + 1, closeIdx).trim();
      this.i = closeIdx + 1;
      if (inner === '') {
        return String(this.ctx.$0).length;
      }
      const v = awkEvalPrintExpr(inner, this.ctx);
      if (v === null) {
        return null;
      }
      return String(v).length;
    }
    const rest = this.s.slice(this.i);
    const numRe = /^(\d+\.?\d*([eE][+-]?\d+)?|\.\d+([eE][+-]?\d+)?)/;
    const nm = numRe.exec(rest);
    if (nm) {
      const n = parseFloat(nm[0]);
      if (!Number.isFinite(n)) {
        return null;
      }
      this.i += nm[0].length;
      return n;
    }
    return null;
  }
}

/**
 * Evaluate a full-string arithmetic expression for awk **print** (returns **null** if invalid).
 * @param {string} expr
 * @param {{ $0: string, fields: string[], NR: number, NF: number, RSTART?: number, RLENGTH?: number, awkArrays?: Record<string, Record<string, string>> }} ctx
 * @returns {number | null}
 */
function awkEvalArithmeticExpr(expr, ctx) {
  const p = new AwkArithParser(expr, ctx);
  const v = p.parseAddSub();
  if (v === null) {
    return null;
  }
  p.skipSpaces();
  if (p.i !== p.s.length) {
    return null;
  }
  return v;
}

export {
  awkStrToNum,
  awkFormatArithResult,
  awkEvalArithmeticExpr
};

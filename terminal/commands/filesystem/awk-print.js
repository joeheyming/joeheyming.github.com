import { awkSplitFields, awkSplitRecordLines } from './awk-fields.js';
import {
  awkParseArrayAccess,
  awkParseLengthCall,
  awkParseNamedCall
} from './awk-parse-expr.js';
import {
  awkEvalSubstrExpr,
  awkEvalIndexExpr,
  awkEvalSplitExpr,
  awkEvalGsubExpr,
  awkEvalMatchExpr
} from './awk-builtins.js';
import { awkEvalArithmeticExpr, awkFormatArithResult } from './awk-arith.js';

/**
 * @param {string} expr
 * @param {{ $0: string, fields: string[], NR: number, NF: number, RSTART?: number, RLENGTH?: number, awkArrays?: Record<string, Record<string, string>> }} ctx
 * @returns {string | null}
 */
function awkEvalPrintExpr(expr, ctx) {
  const e = expr.trim();
  const lc = awkParseLengthCall(e);
  if (lc.ok) {
    if (lc.inner === null) {
      return String(String(ctx.$0).length);
    }
    const v = awkEvalPrintExpr(lc.inner, ctx);
    if (v === null) {
      return null;
    }
    return String(String(v).length);
  }
  const subInner = awkParseNamedCall(e, 'substr');
  if (subInner !== null) {
    return awkEvalSubstrExpr(subInner, ctx);
  }
  const idxInner = awkParseNamedCall(e, 'index');
  if (idxInner !== null) {
    return awkEvalIndexExpr(idxInner, ctx);
  }
  const gsubInner = awkParseNamedCall(e, 'gsub');
  if (gsubInner !== null) {
    return awkEvalGsubExpr(gsubInner, ctx, true);
  }
  const subOnlyInner = awkParseNamedCall(e, 'sub');
  if (subOnlyInner !== null) {
    return awkEvalGsubExpr(subOnlyInner, ctx, false);
  }
  const matchInner = awkParseNamedCall(e, 'match');
  if (matchInner !== null) {
    return awkEvalMatchExpr(matchInner, ctx);
  }
  const splitInner = awkParseNamedCall(e, 'split');
  if (splitInner !== null) {
    return awkEvalSplitExpr(splitInner, ctx);
  }
  const arrAcc = awkParseArrayAccess(e);
  if (arrAcc) {
    const keyV = awkEvalPrintExpr(arrAcc.inner, ctx);
    if (keyV === null) {
      return null;
    }
    const store = ctx.awkArrays && ctx.awkArrays[arrAcc.name];
    if (!store) {
      return '';
    }
    const k = String(keyV);
    const v = store[k];
    return v !== undefined ? String(v) : '';
  }
  if (e === '$0') {
    return ctx.$0;
  }
  if (e === 'NR') {
    return String(ctx.NR);
  }
  if (e === 'NF') {
    return String(ctx.NF);
  }
  if (e === 'RSTART') {
    return String(ctx.RSTART !== undefined ? ctx.RSTART : 0);
  }
  if (e === 'RLENGTH') {
    return String(ctx.RLENGTH !== undefined ? ctx.RLENGTH : -1);
  }
  const m = /^\$(\d+)$/.exec(e);
  if (m) {
    const n = parseInt(m[1], 10);
    const v = ctx.fields[n - 1];
    return v !== undefined ? v : '';
  }
  if (e.length >= 2) {
    const q = e[0];
    if ((q === '"' || q === "'") && e[e.length - 1] === q) {
      return e.slice(1, -1);
    }
  }
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(e)) {
    return e;
  }
  const ar = awkEvalArithmeticExpr(e, ctx);
  if (ar !== null) {
    return awkFormatArithResult(ar);
  }
  return null;
}

/**
 * Awk BEGIN context (NR, NF, $0 before any input).
 * @param {string} [fieldSeparator]
 * @param {Record<string, Record<string, string>>} [awkArrays] - shared **match(..., ..., arr)** store across BEGIN / records / END
 * @returns {{ $0: string, fields: string[], NR: number, NF: number, fieldSeparator: string, RSTART: number, RLENGTH: number, awkArrays: Record<string, Record<string, string>> }}
 */
function awkBeginCtx(fieldSeparator, awkArrays) {
  const fs = fieldSeparator === undefined ? ' ' : fieldSeparator;
  return {
    $0: '',
    fields: [],
    NR: 0,
    NF: 0,
    fieldSeparator: fs,
    RSTART: 0,
    RLENGTH: -1,
    awkArrays: awkArrays === undefined ? Object.create(null) : awkArrays
  };
}

/**
 * Evaluate one `print` (single output line with trailing newline).
 * @param {string[]} exprs
 * @param {{ $0: string, fields: string[], NR: number, NF: number, RSTART?: number, RLENGTH?: number, awkArrays?: Record<string, Record<string, string>> }} ctx
 * @returns {{ ok: true, stdout: string } | { ok: false, stderr: string }}
 */
function awkRunPrintOnce(exprs, ctx) {
  const parts = [];
  for (const ex of exprs) {
    const v = awkEvalPrintExpr(ex, ctx);
    if (v === null) {
      return {
        ok: false,
        stderr: `awk: invalid print expression: ${ex.trim()}\n`
      };
    }
    parts.push(v);
  }
  return { ok: true, stdout: parts.join(' ') + '\n' };
}

/**
 * GNU-ish printf format string interpreter for awk action bodies (B11).
 * Supports %s, %d/%i, %x, %X, %o, %f/%g, %c, %%; width / precision / 0 / -
 * flags. Returns the formatted string (no trailing newline added — awk's
 * `printf` does not auto-add one, matching bash printf).
 *
 * @param {string} fmt
 * @param {string[]} args - additional argument values (already string-coerced)
 * @returns {string}
 */
function awkApplyPrintfFormat(fmt, args) {
  let i = 0;
  let ai = 0;
  let out = '';
  const re = /%(-?)(0?)(\d*)(?:\.(\d+))?([sdioxXfgeEcq%])/y;
  while (i < fmt.length) {
    if (fmt[i] !== '%') {
      // Handle \n, \t escapes (awk gives them in literal strings already; here we leave alone)
      out += fmt[i];
      i++;
      continue;
    }
    re.lastIndex = i;
    const m = re.exec(fmt);
    if (!m) {
      out += fmt[i];
      i++;
      continue;
    }
    const [whole, leftAlign, zeroPad, widthStr, precStr, conv] = m;
    i += whole.length;
    if (conv === '%') {
      out += '%';
      continue;
    }
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    const prec = precStr != null ? parseInt(precStr, 10) : null;
    const argVal = args[ai++] != null ? args[ai - 1] : '';
    let s;
    switch (conv) {
      case 's':
        s = String(argVal);
        if (prec != null) s = s.slice(0, prec);
        break;
      case 'd':
      case 'i': {
        const n = Math.trunc(Number(argVal) || 0);
        s = String(n);
        if (prec != null && prec > Math.abs(n).toString().length) {
          const sign = n < 0 ? '-' : '';
          s = sign + Math.abs(n).toString().padStart(prec, '0');
        }
        break;
      }
      case 'x':
        s = Math.trunc(Number(argVal) || 0).toString(16);
        if (prec != null) s = s.padStart(prec, '0');
        break;
      case 'X':
        s = Math.trunc(Number(argVal) || 0).toString(16).toUpperCase();
        if (prec != null) s = s.padStart(prec, '0');
        break;
      case 'o':
        s = Math.trunc(Number(argVal) || 0).toString(8);
        break;
      case 'f':
        s = (Number(argVal) || 0).toFixed(prec != null ? prec : 6);
        break;
      case 'g':
      case 'e':
      case 'E':
        s =
          conv === 'g'
            ? (Number(argVal) || 0).toPrecision(prec != null ? prec : 6)
            : (Number(argVal) || 0).toExponential(prec != null ? prec : 6);
        if (conv === 'E') s = s.toUpperCase();
        break;
      case 'c':
        s = String(argVal)[0] != null ? String(argVal)[0] : '';
        break;
      case 'q':
        s = "'" + String(argVal).replace(/'/g, `'\\''`) + "'";
        break;
      default:
        s = String(argVal);
    }
    if (width > s.length) {
      const isNumericConv = conv === 'd' || conv === 'i' || conv === 'x' ||
        conv === 'X' || conv === 'o' || conv === 'f' || conv === 'g' ||
        conv === 'e' || conv === 'E';
      if (leftAlign) s = s.padEnd(width, ' ');
      else if (zeroPad && isNumericConv) s = s.padStart(width, '0');
      else s = s.padStart(width, ' ');
    }
    out += s;
  }
  return out;
}

/**
 * Run a single `printf "fmt", arg1, arg2…` action.
 * @param {string[]} exprs - first is fmt, rest are args
 * @param {{ $0: string, fields: string[], NR: number, NF: number }} ctx
 * @returns {{ ok: true, stdout: string } | { ok: false, stderr: string }}
 */
function awkRunPrintfOnce(exprs, ctx) {
  if (!exprs || exprs.length === 0) {
    return { ok: false, stderr: 'awk: printf requires a format string\n' };
  }
  const fmtV = awkEvalPrintExpr(exprs[0], ctx);
  if (fmtV === null) {
    return { ok: false, stderr: `awk: invalid printf format: ${exprs[0]}\n` };
  }
  const args = [];
  for (let k = 1; k < exprs.length; k++) {
    const v = awkEvalPrintExpr(exprs[k], ctx);
    if (v === null) {
      return { ok: false, stderr: `awk: invalid printf arg: ${exprs[k]}\n` };
    }
    args.push(v);
  }
  return { ok: true, stdout: awkApplyPrintfFormat(String(fmtV), args) };
}

/**
 * Run main-rule `print` on each line, or scan lines only when **exprs** is **null** (for **NR**).
 * @param {string} text
 * @param {string[] | null} exprs
 * @param {string} fieldSeparator
 * @param {number} nrStart - starting NR (1-based)
 * @param {Record<string, Record<string, string>>} [awkArraysStore] - shared across lines for **match(..., ..., arr)** and **arr[i]** reads
 * @param {{ kind?: 'print'|'printf', condition?: { type: 'regex', source: string, flags: string } | null }} [opts]
 * @returns {{ ok: true, stdout: string, nextNr: number, lastReadCtx: { $0: string, fields: string[], NR: number, NF: number } | null } | { ok: false, stderr: string }}
 */
function awkRunPrintProgram(text, exprs, fieldSeparator, nrStart, awkArraysStore, opts) {
  const raw = String(text);
  const lines = awkSplitRecordLines(raw);
  const hadTrailingNl = raw.length > 0 && raw.endsWith('\n');
  const out = [];
  let nr = nrStart;
  let lastReadCtx = null;
  const arrStore = awkArraysStore === undefined ? Object.create(null) : awkArraysStore;
  const kind = opts && opts.kind ? opts.kind : 'print';
  let condRe = null;
  if (opts && opts.condition && opts.condition.type === 'regex') {
    try {
      condRe = new RegExp(opts.condition.source, opts.condition.flags || '');
    } catch (_) {
      condRe = null;
    }
  }
  let printfChunks = '';
  for (const line of lines) {
    const fields = awkSplitFields(line, fieldSeparator);
    const ctx = {
      $0: line,
      fields,
      NR: nr,
      NF: fields.length,
      fieldSeparator,
      RSTART: 0,
      RLENGTH: -1,
      awkArrays: arrStore
    };
    lastReadCtx = ctx;
    const matchCond = condRe == null || condRe.test(line);
    if (exprs !== null && exprs !== undefined && matchCond) {
      if (kind === 'printf') {
        const r = awkRunPrintfOnce(exprs, ctx);
        if (r.ok === false) return r;
        printfChunks += r.stdout;
      } else {
        const parts = [];
        for (const ex of exprs) {
          const v = awkEvalPrintExpr(ex, ctx);
          if (v === null) {
            return {
              ok: false,
              stderr: `awk: invalid print expression: ${ex.trim()}\n`
            };
          }
          parts.push(v);
        }
        out.push(parts.join(' '));
      }
    }
    nr++;
  }
  let stdout;
  if (kind === 'printf') {
    stdout = printfChunks;
  } else {
    stdout = out.join('\n');
    if (out.length > 0 && (hadTrailingNl || lines.length === 0)) {
      stdout += '\n';
    }
  }
  return { ok: true, stdout, nextNr: nr, lastReadCtx };
}

export {
  awkEvalPrintExpr,
  awkBeginCtx,
  awkRunPrintOnce,
  awkApplyPrintfFormat,
  awkRunPrintfOnce,
  awkRunPrintProgram
};

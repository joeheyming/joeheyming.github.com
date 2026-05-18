import { awkSplitTopLevelCommas } from './awk-comma.js';
import { awkSplitFields, awkRebuild0FromFields } from './awk-fields.js';
import {
  awkParseSlashDelimitedRegex,
  awkRegexGsubAll,
  awkRegexSubFirst,
  awkLiteralGsubAll,
  awkLiteralSubFirst
} from './awk-regex.js';
import { awkEvalPrintExpr } from './awk-print.js';

/**
 * @param {string} inner — comma-separated args
 * @param {{ $0: string, fields: string[], NR: number, NF: number }} ctx
 * @returns {string | null}
 */
function awkEvalSubstrExpr(inner, ctx) {
  const parts = awkSplitTopLevelCommas(inner);
  if (parts.length !== 2 && parts.length !== 3) {
    return null;
  }
  const strV = awkEvalPrintExpr(parts[0], ctx);
  if (strV === null) {
    return null;
  }
  const startV = awkEvalPrintExpr(parts[1], ctx);
  if (startV === null) {
    return null;
  }
  const s = String(strV);
  let start = Number(startV);
  if (!Number.isFinite(start)) {
    start = 0;
  }
  start = Math.floor(start);
  if (start < 1) {
    start = 1;
  }
  if (start > s.length) {
    return '';
  }
  const i0 = start - 1;
  if (parts.length === 2) {
    return s.slice(i0);
  }
  const lenV = awkEvalPrintExpr(parts[2], ctx);
  if (lenV === null) {
    return null;
  }
  let len = Number(lenV);
  if (!Number.isFinite(len)) {
    len = 0;
  }
  len = Math.floor(len);
  if (len < 0) {
    len = 0;
  }
  return s.slice(i0, i0 + len);
}

/**
 * @param {string} inner — comma-separated args (**S**, **T**)
 * @param {{ $0: string, fields: string[], NR: number, NF: number }} ctx
 * @returns {string | null}
 */
function awkEvalIndexExpr(inner, ctx) {
  const parts = awkSplitTopLevelCommas(inner);
  if (parts.length !== 2) {
    return null;
  }
  const a = awkEvalPrintExpr(parts[0], ctx);
  if (a === null) {
    return null;
  }
  const b = awkEvalPrintExpr(parts[1], ctx);
  if (b === null) {
    return null;
  }
  const s = String(a);
  const t = String(b);
  if (t === '') {
    return '1';
  }
  const idx = s.indexOf(t);
  if (idx < 0) {
    return '0';
  }
  return String(idx + 1);
}

/**
 * **split(STRING, ARRAY [, SEP])** — GNU-like: fills **ARRAY[1]**… with fields; returns field count as string.
 * **SEP** omitted uses current **-F** field separator (whitespace when **FS** is space).
 * @param {string} inner — comma-separated args
 * @param {{ $0: string, fields: string[], NR: number, NF: number, fieldSeparator?: string, awkArrays?: Record<string, Record<string, string>> }} ctx
 * @returns {string | null}
 */
function awkEvalSplitExpr(inner, ctx) {
  const parts = awkSplitTopLevelCommas(inner);
  if (parts.length < 2 || parts.length > 3) {
    return null;
  }
  const strV = awkEvalPrintExpr(parts[0], ctx);
  if (strV === null) {
    return null;
  }
  const arrTok = parts[1].trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(arrTok)) {
    return null;
  }
  let fs = ctx.fieldSeparator !== undefined ? ctx.fieldSeparator : ' ';
  if (parts.length === 3) {
    const sepV = awkEvalPrintExpr(parts[2], ctx);
    if (sepV === null) {
      return null;
    }
    fs = String(sepV);
  }
  if (!ctx.awkArrays) {
    ctx.awkArrays = Object.create(null);
  }
  let store = ctx.awkArrays[arrTok];
  if (!store) {
    store = Object.create(null);
    ctx.awkArrays[arrTok] = store;
  } else {
    for (const k of Object.keys(store)) {
      delete store[k];
    }
  }
  const fields = awkSplitFields(String(strV), fs === ' ' ? ' ' : fs);
  for (let i = 0; i < fields.length; i++) {
    store[String(i + 1)] = fields[i];
  }
  return String(fields.length);
}

/**
 * gsub and sub: literal pattern and replacement; optional third arg is $0…$N (default $0).
 * Mutates **ctx** (and returns substitution count as a string).
 * @param {string} inner
 * @param {{ $0: string, fields: string[], NR: number, NF: number, fieldSeparator?: string }} ctx
 * @param {boolean} global
 * @returns {string | null}
 */
function awkEvalGsubExpr(inner, ctx, global) {
  const parts = awkSplitTopLevelCommas(inner);
  if (parts.length !== 2 && parts.length !== 3) {
    return null;
  }
  const patV = awkEvalPrintExpr(parts[0], ctx);
  const replV = awkEvalPrintExpr(parts[1], ctx);
  if (patV === null || replV === null) {
    return null;
  }
  const pat = String(patV);
  const repl = String(replV);
  const mode = awkParseSlashDelimitedRegex(pat);
  if (mode.kind === 'bad') {
    return null;
  }
  let targetN = 0;
  if (parts.length === 3) {
    const t3 = parts[2].trim();
    const m = /^\$(\d+)$/.exec(t3);
    if (!m) {
      return null;
    }
    targetN = parseInt(m[1], 10);
  }
  const fs = ctx.fieldSeparator === undefined ? ' ' : ctx.fieldSeparator;
  const apply = (fieldStr) => {
    if (mode.kind === 'regex') {
      return global
        ? awkRegexGsubAll(fieldStr, mode.re, repl)
        : awkRegexSubFirst(fieldStr, mode.re, repl);
    }
    const replacer = global ? awkLiteralGsubAll : awkLiteralSubFirst;
    return replacer(fieldStr, pat, repl);
  };
  if (targetN === 0) {
    const r = apply(ctx.$0);
    ctx.$0 = r.result;
    ctx.fields = awkSplitFields(ctx.$0, fs);
    ctx.NF = ctx.fields.length;
    return String(r.count);
  }
  const idx = targetN - 1;
  if (idx < 0) {
    return null;
  }
  while (ctx.fields.length <= idx) {
    ctx.fields.push('');
  }
  const fieldStr = ctx.fields[idx] !== undefined ? String(ctx.fields[idx]) : '';
  const r = apply(fieldStr);
  ctx.fields[idx] = r.result;
  ctx.$0 = awkRebuild0FromFields(ctx.fields, fs);
  ctx.NF = ctx.fields.length;
  return String(r.count);
}

/**
 * match(S, P [, ARRAY]): literal substring P in S, or slash-delimited ERE with optional flags (JavaScript RegExp);
 * sets RSTART and RLENGTH (GNU-like); optional third arg clears and fills **ctx.awkArrays[ARRAY]**.
 * @param {string} inner
 * @param {{ $0: string, fields: string[], NR: number, NF: number, RSTART?: number, RLENGTH?: number, awkArrays?: Record<string, Record<string, string>> }} ctx
 * @returns {string | null}
 */
function awkEvalMatchExpr(inner, ctx) {
  const parts = awkSplitTopLevelCommas(inner);
  if (parts.length !== 2 && parts.length !== 3) {
    return null;
  }
  let arrayName = null;
  if (parts.length === 3) {
    const t = parts[2].trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(t)) {
      return null;
    }
    arrayName = t;
  }
  const a = awkEvalPrintExpr(parts[0], ctx);
  const b = awkEvalPrintExpr(parts[1], ctx);
  if (a === null || b === null) {
    return null;
  }
  const s = String(a);
  const p = String(b);
  const applyArray = (/** @type {RegExpExecArray | null} */ execResult, literalSlice) => {
    if (!arrayName) {
      return;
    }
    if (!ctx.awkArrays) {
      ctx.awkArrays = Object.create(null);
    }
    const store = Object.create(null);
    ctx.awkArrays[arrayName] = store;
    if (execResult) {
      for (let i = 0; i < execResult.length; i++) {
        if (execResult[i] !== undefined) {
          store[String(i)] = String(execResult[i]);
        }
      }
      return;
    }
    if (literalSlice !== null && literalSlice !== undefined) {
      store['0'] = String(literalSlice);
    }
  };
  if (p === '') {
    ctx.RSTART = 0;
    ctx.RLENGTH = -1;
    applyArray(null, null);
    return '0';
  }
  const mode = awkParseSlashDelimitedRegex(p);
  if (mode.kind === 'bad') {
    return null;
  }
  if (mode.kind === 'regex') {
    const re = new RegExp(mode.re.source, mode.re.flags.replace(/g/g, ''));
    const m = re.exec(s);
    if (!m) {
      ctx.RSTART = 0;
      ctx.RLENGTH = -1;
      applyArray(null, null);
      return '0';
    }
    ctx.RSTART = m.index + 1;
    ctx.RLENGTH = m[0].length;
    applyArray(m, null);
    return String(m.index + 1);
  }
  const idx = s.indexOf(p);
  if (idx < 0) {
    ctx.RSTART = 0;
    ctx.RLENGTH = -1;
    applyArray(null, null);
    return '0';
  }
  ctx.RSTART = idx + 1;
  ctx.RLENGTH = p.length;
  applyArray(null, s.slice(idx, idx + p.length));
  return String(idx + 1);
}

export {
  awkEvalSubstrExpr,
  awkEvalIndexExpr,
  awkEvalSplitExpr,
  awkEvalGsubExpr,
  awkEvalMatchExpr
};

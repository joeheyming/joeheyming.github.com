import { awkSkipQuotedString } from './awk-parse-expr.js';

/**
 * Split at top-level commas (respects quotes and **(...)** nesting). Used for
 * **`print` arg lists** and for function-call argument lists (**`substr`**, **`index`**).
 * @param {string} s
 * @returns {string[]}
 */
function awkSplitCommaListTopLevel(s) {
  const parts = [];
  let cur = '';
  let depth = 0;
  let i = 0;
  const str = String(s);
  while (i < str.length) {
    const c = str[i];
    if (c === '"' || c === "'") {
      const end = awkSkipQuotedString(str, i);
      cur += str.slice(i, end);
      i = end;
      continue;
    }
    if (c === '(') {
      depth++;
      cur += c;
      i++;
      continue;
    }
    if (c === ')') {
      depth--;
      cur += c;
      i++;
      continue;
    }
    if (c === ',' && depth === 0) {
      parts.push(cur.trim());
      cur = '';
      i++;
      continue;
    }
    cur += c;
    i++;
  }
  parts.push(cur.trim());
  return parts;
}

/**
 * Split comma-separated print arguments respecting quotes and parentheses.
 * @param {string} s
 * @returns {{ ok: true, parts: string[] }}
 */
function awkSplitPrintArgs(s) {
  const parts = awkSplitCommaListTopLevel(String(s))
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return { ok: true, parts };
}

/**
 * Split **inner** of a function call at top-level commas (same rules as **`print`** lists).
 * @param {string} s
 * @returns {string[]}
 */
function awkSplitTopLevelCommas(s) {
  return awkSplitCommaListTopLevel(s);
}

export { awkSplitCommaListTopLevel, awkSplitPrintArgs, awkSplitTopLevelCommas };

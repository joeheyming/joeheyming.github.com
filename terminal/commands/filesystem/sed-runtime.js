/**
 * Expand GNU-style `&` and `\&` in substitute replacement (single match).
 * @param {string} replacement
 * @param {string} matched
 * @returns {string}
 */
function sedExpandSubstReplacement(replacement, matched) {
  let out = '';
  let i = 0;
  while (i < replacement.length) {
    if (replacement[i] === '\\' && i + 1 < replacement.length) {
      const n = replacement[i + 1];
      if (n === '&') {
        out += '&';
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
      if (n === '\\') {
        out += '\\';
        i += 2;
        continue;
      }
    }
    if (replacement[i] === '&') {
      out += matched;
      i++;
      continue;
    }
    out += replacement[i];
    i++;
  }
  return out;
}

/**
 * Whether **lineNum** (1-based) is selected by an addressed **d** spec.
 * For **{ type: 'pattern' }**, pass **lineText** (substring match); **lineNum** /
 * **totalLines** are ignored.
 *
 * @param {{ type: 'single', n: number } | { type: 'single', last: true } | { type: 'range', start: number, end: number | 'last' } | { type: 'pattern', pattern: string }} address
 * @param {number} lineNum
 * @param {number} totalLines
 * @param {string} [lineText]
 * @returns {boolean}
 */
export function sedLineMatchesDeleteAddress(address, lineNum, totalLines, lineText) {
  if (address.type === 'pattern') {
    const pat = address.pattern;
    if (pat === '') {
      return true;
    }
    return String(lineText).indexOf(pat) >= 0;
  }
  if (address.type === 'single') {
    if ('last' in address && address.last === true) {
      return lineNum === totalLines;
    }
    if ('n' in address) {
      return lineNum === address.n;
    }
    return false;
  }
  const { start, end } = address;
  if (typeof end === 'number') {
    if (start > end) {
      return false;
    }
    return lineNum >= start && lineNum <= end;
  }
  return lineNum >= start;
}

/**
 * Apply one literal substitute to a line; returns updated line and whether a replacement occurred.
 *
 * @param {string} line
 * @param {{ pattern: string, replacement: string, global: boolean, ignoreCase: boolean }} spec
 * @returns {{ line: string, subbed: boolean }}
 */
export function sedApplySubstituteLine(line, spec) {
  const { pattern, replacement, global, ignoreCase } = spec;
  if (pattern === '') {
    return { line, subbed: false };
  }

  function oneReplace(src, pat, replFn) {
    if (!ignoreCase) {
      const idx = src.indexOf(pat);
      if (idx < 0) {
        return { out: src, subbed: false };
      }
      const matched = src.slice(idx, idx + pat.length);
      const repl = replFn(matched);
      return {
        out: src.slice(0, idx) + repl + src.slice(idx + pat.length),
        subbed: true
      };
    }
    const lower = src.toLowerCase();
    const p = pat.toLowerCase();
    const idx = lower.indexOf(p);
    if (idx < 0) {
      return { out: src, subbed: false };
    }
    const matched = src.slice(idx, idx + pattern.length);
    const repl = replFn(matched);
    return {
      out: src.slice(0, idx) + repl + src.slice(idx + pattern.length),
      subbed: true
    };
  }

  if (!global) {
    const r = oneReplace(line, pattern, (m) => sedExpandSubstReplacement(replacement, m));
    return { line: r.out, subbed: r.subbed };
  }

  let out = line;
  let any = false;
  if (!ignoreCase) {
    let pos = 0;
    while (pos <= out.length) {
      const idx = out.indexOf(pattern, pos);
      if (idx < 0) {
        break;
      }
      const matched = out.slice(idx, idx + pattern.length);
      const repl = sedExpandSubstReplacement(replacement, matched);
      out = out.slice(0, idx) + repl + out.slice(idx + pattern.length);
      pos = idx + repl.length;
      any = true;
    }
    return { line: out, subbed: any };
  }

  const esc = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(esc, 'gi');
  const newLine = out.replace(re, (m) => {
    any = true;
    return sedExpandSubstReplacement(replacement, m);
  });
  return { line: newLine, subbed: any };
}

/**
 * Narrow a parsed **substitute** command to the fields **sedApplySubstituteLine** consumes.
 * @param {{ pattern: string, replacement: string, global: boolean, ignoreCase: boolean }} cmd
 */
function sedSubstSpec(cmd) {
  return {
    pattern: cmd.pattern,
    replacement: cmd.replacement,
    global: cmd.global,
    ignoreCase: cmd.ignoreCase
  };
}
export function sedProcessContent(content, specs, quiet) {
  const trailingNl = content.endsWith('\n');
  let lines = content.split('\n');
  if (trailingNl && lines.length > 0 && lines[lines.length - 1] === '') {
    lines = lines.slice(0, -1);
  }
  /** @type {Array<{ active: boolean } | null>} */
  const patternRangeStates = specs.map((spec) =>
    spec.address && spec.address.type === 'patternRange' ? { active: false } : null
  );
  /** @type {Array<{ phase: 'idle' | 'in_range' } | null>} */
  const patternToLineStates = specs.map((spec) =>
    spec.address && spec.address.type === 'patternToLine' ? { phase: 'idle' } : null
  );
  /** @type {Array<{ phase: 'idle' | 'in_range' } | null>} */
  const lineToPatternStates = specs.map((spec) =>
    spec.address && spec.address.type === 'lineToPattern' ? { phase: 'idle' } : null
  );
  const outParts = [];
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    let cur = line;
    /** @type {string[]} */
    const pPrints = [];
    let deleted = false;
    for (let si = 0; si < specs.length; si++) {
      const spec = specs[si];
      if (spec.kind === 'delete') {
        if (spec.address == null) {
          deleted = true;
          break;
        }
        if (spec.address.type === 'patternRange') {
          const st = patternRangeStates[si];
          const { start: startPat, end: endPat } = spec.address;
          const hasStart = startPat === '' || line.indexOf(startPat) >= 0;
          const hasEnd = endPat === '' || line.indexOf(endPat) >= 0;
          if (!st.active) {
            if (hasStart) {
              st.active = true;
              deleted = true;
              break;
            }
            continue;
          }
          if (hasEnd) {
            deleted = true;
            st.active = false;
            break;
          }
          deleted = true;
          break;
        }
        if (spec.address.type === 'patternToLine') {
          const st = patternToLineStates[si];
          const { pattern: pat, n: endLine } = spec.address;
          const lineNum = li + 1;
          const lineHasPat = pat === '' || line.indexOf(pat) >= 0;
          if (st.phase === 'idle') {
            if (lineHasPat) {
              const L = lineNum;
              if (L <= endLine) {
                st.phase = 'in_range';
                deleted = true;
                break;
              }
              deleted = true;
              break;
            }
            continue;
          }
          deleted = true;
          if (lineNum === endLine) {
            st.phase = 'idle';
          }
          break;
        }
        if (spec.address.type === 'lineToPattern') {
          const st = lineToPatternStates[si];
          const { n: startLine, pattern: pat } = spec.address;
          const lineNum = li + 1;
          const lineHasPat = pat === '' || line.indexOf(pat) >= 0;
          if (st.phase === 'idle') {
            if (lineNum === startLine) {
              if (lineHasPat) {
                deleted = true;
                break;
              }
              st.phase = 'in_range';
              deleted = true;
              break;
            }
            continue;
          }
          if (lineHasPat) {
            st.phase = 'idle';
            deleted = true;
            break;
          }
          deleted = true;
          break;
        }
        const lineNum = li + 1;
        const totalLines = lines.length;
        if (spec.address.type === 'pattern') {
          if (sedLineMatchesDeleteAddress(spec.address, lineNum, totalLines, line)) {
            deleted = true;
            break;
          }
          continue;
        }
        if (sedLineMatchesDeleteAddress(spec.address, lineNum, totalLines)) {
          deleted = true;
          break;
        }
        continue;
      }
      if (spec.kind === 'substitute' && spec.address) {
        const lineNum = li + 1;
        const totalLines = lines.length;
        if (spec.address.type === 'patternRange') {
          const st = patternRangeStates[si];
          const { start: startPat, end: endPat } = spec.address;
          const hasStart = startPat === '' || line.indexOf(startPat) >= 0;
          const hasEnd = endPat === '' || line.indexOf(endPat) >= 0;
          if (!st.active) {
            if (hasStart) {
              st.active = true;
              const r = sedApplySubstituteLine(cur, sedSubstSpec(spec));
              cur = r.line;
              if (spec.printFlag && r.subbed) {
                pPrints.push(cur);
              }
              if (hasEnd) {
                st.active = false;
              }
            }
            continue;
          }
          const r = sedApplySubstituteLine(cur, sedSubstSpec(spec));
          cur = r.line;
          if (spec.printFlag && r.subbed) {
            pPrints.push(cur);
          }
          if (hasEnd) {
            st.active = false;
          }
          continue;
        }
        if (spec.address.type === 'patternToLine') {
          const st = patternToLineStates[si];
          const { pattern: pat, n: endLine } = spec.address;
          const lineHasPat = pat === '' || line.indexOf(pat) >= 0;
          if (st.phase === 'idle') {
            if (lineHasPat) {
              const L = lineNum;
              if (L <= endLine) {
                st.phase = 'in_range';
                const r = sedApplySubstituteLine(cur, sedSubstSpec(spec));
                cur = r.line;
                if (spec.printFlag && r.subbed) {
                  pPrints.push(cur);
                }
                continue;
              }
              const r = sedApplySubstituteLine(cur, sedSubstSpec(spec));
              cur = r.line;
              if (spec.printFlag && r.subbed) {
                pPrints.push(cur);
              }
              continue;
            }
            continue;
          }
          const r = sedApplySubstituteLine(cur, sedSubstSpec(spec));
          cur = r.line;
          if (spec.printFlag && r.subbed) {
            pPrints.push(cur);
          }
          if (lineNum === endLine) {
            st.phase = 'idle';
          }
          continue;
        }
        if (spec.address.type === 'lineToPattern') {
          const st = lineToPatternStates[si];
          const { n: startLine, pattern: pat } = spec.address;
          const lineHasPat = pat === '' || line.indexOf(pat) >= 0;
          if (st.phase === 'idle') {
            if (lineNum === startLine) {
              if (lineHasPat) {
                const r = sedApplySubstituteLine(cur, sedSubstSpec(spec));
                cur = r.line;
                if (spec.printFlag && r.subbed) {
                  pPrints.push(cur);
                }
                continue;
              }
              st.phase = 'in_range';
              const r = sedApplySubstituteLine(cur, sedSubstSpec(spec));
              cur = r.line;
              if (spec.printFlag && r.subbed) {
                pPrints.push(cur);
              }
              continue;
            }
            continue;
          }
          const r = sedApplySubstituteLine(cur, sedSubstSpec(spec));
          cur = r.line;
          if (spec.printFlag && r.subbed) {
            pPrints.push(cur);
          }
          if (lineHasPat) {
            st.phase = 'idle';
          }
          continue;
        }
        if (spec.address.type === 'pattern') {
          if (sedLineMatchesDeleteAddress(spec.address, lineNum, totalLines, line)) {
            const r = sedApplySubstituteLine(cur, sedSubstSpec(spec));
            cur = r.line;
            if (spec.printFlag && r.subbed) {
              pPrints.push(cur);
            }
          }
          continue;
        }
        if (sedLineMatchesDeleteAddress(spec.address, lineNum, totalLines)) {
          const r = sedApplySubstituteLine(cur, sedSubstSpec(spec));
          cur = r.line;
          if (spec.printFlag && r.subbed) {
            pPrints.push(cur);
          }
        }
        continue;
      }
      const r = sedApplySubstituteLine(cur, sedSubstSpec(spec));
      cur = r.line;
      if (spec.printFlag && r.subbed) {
        pPrints.push(cur);
      }
    }
    const addNl = li < lines.length - 1 || trailingNl;
    if (deleted) {
      // GNU: **p** before **d** on the same line still prints; **d** suppresses only the default print.
      if (quiet) {
        for (const pl of pPrints) {
          outParts.push(pl);
          if (addNl) {
            outParts.push('\n');
          }
        }
      } else {
        for (const pl of pPrints) {
          outParts.push(pl);
          outParts.push('\n');
        }
      }
      continue;
    }
    if (quiet) {
      for (const pl of pPrints) {
        outParts.push(pl);
        if (addNl) {
          outParts.push('\n');
        }
      }
      continue;
    }
    for (const pl of pPrints) {
      outParts.push(pl);
      outParts.push('\n');
    }
    outParts.push(cur);
    if (addNl) {
      outParts.push('\n');
    }
  }
  return outParts.join('');
}

import { FMT_DEFAULT_WIDTH, fmtFmtDefaultGoal } from './fmt-text.js';

/**
 * GNU-style option error for fmt (exit status 1).
 * @param {string} arg
 * @returns {string}
 */
export function fmtOptionError(arg) {
  const tryLine = "Try 'fmt --help' for more information.\n";
  if (arg.startsWith('--') && arg.length > 2) {
    return `fmt: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `fmt: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `fmt: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * @param {string} v
 * @returns {{ ok: true, width: number } | { ok: false, stderr: string, exitCode: number }}
 */
function parseFmtWidthValue(v) {
  const s = String(v);
  if (!/^\d+$/.test(s)) {
    return {
      ok: false,
      stderr: `fmt: invalid width: '${s}'\nTry 'fmt --help' for more information.\n`,
      exitCode: 1
    };
  }
  const n = parseInt(s, 10);
  if (n < 1) {
    return {
      ok: false,
      stderr: `fmt: width must be positive\nTry 'fmt --help' for more information.\n`,
      exitCode: 1
    };
  }
  if (n > 1000000) {
    return {
      ok: false,
      stderr: `fmt: width too large\nTry 'fmt --help' for more information.\n`,
      exitCode: 1
    };
  }
  return { ok: true, width: n };
}

/**
 * @param {string} v
 * @param {number} maxWidth inclusive upper bound for goal
 * @returns {{ ok: true, goal: number } | { ok: false, stderr: string, exitCode: number }}
 */
export function parseFmtGoalValue(v, maxWidth) {
  const p = parseFmtWidthValue(v);
  if (p.ok === false) {
    return p;
  }
  if (p.width > maxWidth) {
    return {
      ok: false,
      stderr: `fmt: goal width greater than maximum width\nTry 'fmt --help' for more information.\n`,
      exitCode: 1
    };
  }
  return { ok: true, goal: p.width };
}

/**
 * Parse jsh `fmt` argv (GNU subset: -c, -p, -s, -t, -u, -w, -g, --, --help, --version).
 *
 * @param {string[]} args
 * @returns {{ ok: true, width: number, goal: number, splitOnly: boolean, uniformSpacing: boolean, crownMargin: boolean, taggedParagraph: boolean, prefix: string | null, operands: string[], help?: true, version?: true } | { ok: false, stderr: string, exitCode: number }}
 */
export function parseFmtArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  let width = FMT_DEFAULT_WIDTH;
  let widthFromOption = false;
  /** @type {string | null} */
  let goalStr = null;
  let splitOnly = false;
  let uniformSpacing = false;
  let crownMargin = false;
  let taggedParagraph = false;
  let prefix = null;
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
        width,
        goal: fmtFmtDefaultGoal(width),
        splitOnly,
        uniformSpacing,
        crownMargin,
        taggedParagraph,
        prefix,
        operands: [],
        help: true
      };
    }
    if (arg === '--version') {
      return {
        ok: true,
        width,
        goal: fmtFmtDefaultGoal(width),
        splitOnly,
        uniformSpacing,
        crownMargin,
        taggedParagraph,
        prefix,
        operands: [],
        version: true
      };
    }
    if (arg === '-c' || arg === '--crown-margin') {
      crownMargin = true;
      i++;
      continue;
    }
    if (arg === '-t' || arg === '--tagged-paragraph') {
      taggedParagraph = true;
      i++;
      continue;
    }
    if (arg === '-s' || arg === '--split-only') {
      splitOnly = true;
      i++;
      continue;
    }
    if (arg === '-u' || arg === '--uniform-spacing') {
      uniformSpacing = true;
      i++;
      continue;
    }
    if (arg === '-p' || arg === '--prefix') {
      const v = argsArr[++i];
      if (v == null) {
        return {
          ok: false,
          stderr: `fmt: option requires an argument -- 'prefix'\nTry 'fmt --help' for more information.\n`,
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
    if (arg === '-w' || arg === '--width') {
      const v = argsArr[++i];
      if (v == null) {
        return {
          ok: false,
          stderr: `fmt: option requires an argument -- 'width'\nTry 'fmt --help' for more information.\n`,
          exitCode: 1
        };
      }
      const p = parseFmtWidthValue(v);
      if (p.ok === false) {
        return p;
      }
      width = p.width;
      widthFromOption = true;
      i++;
      continue;
    }
    if (arg.startsWith('--width=')) {
      const v = arg.slice('--width='.length);
      const p = parseFmtWidthValue(v);
      if (p.ok === false) {
        return p;
      }
      width = p.width;
      widthFromOption = true;
      i++;
      continue;
    }
    if (arg.startsWith('-w') && arg.length > 2) {
      const v = arg.slice(2);
      const p = parseFmtWidthValue(v);
      if (p.ok === false) {
        return p;
      }
      width = p.width;
      widthFromOption = true;
      i++;
      continue;
    }
    if (arg === '-g' || arg === '--goal') {
      const v = argsArr[++i];
      if (v == null) {
        return {
          ok: false,
          stderr: `fmt: option requires an argument -- 'goal'\nTry 'fmt --help' for more information.\n`,
          exitCode: 1
        };
      }
      goalStr = v;
      i++;
      continue;
    }
    if (arg.startsWith('--goal=')) {
      goalStr = arg.slice('--goal='.length);
      i++;
      continue;
    }
    if (arg.startsWith('-g') && arg.length > 2) {
      goalStr = arg.slice(2);
      i++;
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1 && !arg.startsWith('--')) {
      let j = 1;
      while (j < arg.length) {
        const c = arg[j];
        if (c === 'c') {
          crownMargin = true;
          j++;
          continue;
        }
        if (c === 's') {
          splitOnly = true;
          j++;
          continue;
        }
        if (c === 'u') {
          uniformSpacing = true;
          j++;
          continue;
        }
        if (c === 't') {
          taggedParagraph = true;
          j++;
          continue;
        }
        if (c === 'p') {
          const rest = arg.slice(j + 1);
          if (rest.length >= 1) {
            prefix = rest;
            j = arg.length;
            break;
          }
          const next = argsArr[i + 1];
          if (next == null) {
            return {
              ok: false,
              stderr: `fmt: option requires an argument -- 'p'\nTry 'fmt --help' for more information.\n`,
              exitCode: 1
            };
          }
          prefix = next;
          i++;
          j = arg.length;
          break;
        }
        if (c === 'h' || c === '?') {
          return {
            ok: true,
            width,
            goal: fmtFmtDefaultGoal(width),
            splitOnly,
            uniformSpacing,
            crownMargin,
            taggedParagraph,
            prefix,
            operands: [],
            help: true
          };
        }
        if (c === 'w') {
          const rest = arg.slice(j + 1);
          if (rest.length >= 1) {
            const p = parseFmtWidthValue(rest);
            if (p.ok === false) {
              return p;
            }
            width = p.width;
            widthFromOption = true;
            j = arg.length;
            break;
          }
          const next = argsArr[i + 1];
          if (next == null) {
            return {
              ok: false,
              stderr: `fmt: option requires an argument -- 'w'\nTry 'fmt --help' for more information.\n`,
              exitCode: 1
            };
          }
          const p = parseFmtWidthValue(next);
          if (p.ok === false) {
            return p;
          }
          width = p.width;
          widthFromOption = true;
          i++;
          j = arg.length;
          break;
        }
        if (c === 'g') {
          const rest = arg.slice(j + 1);
          if (rest.length >= 1) {
            goalStr = rest;
            j = arg.length;
            break;
          }
          const next = argsArr[i + 1];
          if (next == null) {
            return {
              ok: false,
              stderr: `fmt: option requires an argument -- 'g'\nTry 'fmt --help' for more information.\n`,
              exitCode: 1
            };
          }
          goalStr = next;
          i++;
          j = arg.length;
          break;
        }
        return { ok: false, stderr: fmtOptionError(`-${c}`), exitCode: 1 };
      }
      i++;
      continue;
    }
    break;
  }
  const operands = argsArr.slice(i);
  let goal;
  if (goalStr != null) {
    const maxForGoal = widthFromOption ? width : FMT_DEFAULT_WIDTH;
    const pg = parseFmtGoalValue(goalStr, maxForGoal);
    if (pg.ok === false) {
      return pg;
    }
    goal = pg.goal;
    if (!widthFromOption) {
      width = goal + 10;
    }
  } else {
    goal = fmtFmtDefaultGoal(width);
  }
  return {
    ok: true,
    width,
    goal,
    splitOnly,
    uniformSpacing,
    crownMargin,
    taggedParagraph,
    prefix,
    operands
  };
}

'use strict';

/** @type {typeof LessLib} */
const LessLibForFmt =
  typeof LessLib !== 'undefined'
    ? LessLib
    : typeof require === 'function'
    ? require('../system/less-lib.js')
    : /** @type {*} */ ({});
const { lessExpandTabsInText, LESS_DEFAULT_TAB_STOPS } = LessLibForFmt;

/** GNU **fmt** default width (columns). */
const FMT_DEFAULT_WIDTH = 75;

const FMT_VERSION_LINE = 'fmt (jsh Heyming Terminal) 1.0\n';

const FMT_HELP = `Usage: fmt [OPTION]... [FILE]...
Reformat paragraphs from each FILE; write to standard output.

With no FILE, or when FILE is -, read standard input.

  -c, --crown-margin  first output line uses the first input line's indent; continuations use the second line's indent (GNU -c)
  -p, --prefix=STRING reformat only lines beginning with STRING (after optional leading spaces); reattach prefix to output lines (GNU -p)
  -s, --split-only    split long lines only; do not join short input lines
  -t, --tagged-paragraph  indentation of first line differs from second (GNU -t); with -s, same as -c per line
  -u, --uniform-spacing   one space between words (GNU -u; default uses two spaces after .?! like GNU without -u)
  -w, --width=WIDTH   maximum line width (default ${FMT_DEFAULT_WIDTH})
  -g, --goal=WIDTH    goal width (default ${FMT_DEFAULT_WIDTH}×187/200, GNU LEEWAY 7); if only **-g** is given, maximum width becomes goal+10
  -h, --help          display this help and exit
      --version       output version information and exit
  --                  end of options

jsh:
  Paragraphs are separated by blank lines; within a paragraph, non-empty lines are merged (whitespace-separated) then word-wrapped. Unicode width counts code points (not full POSIX locale width). Piped stdin requires stdin to be supplied (empty pipe works). Symlinks are followed to a regular file (like fold). Binary files show one [binary file] line.

  **-g (goal width):** plain merge mode uses a GNU-like cost-based line fill (short lines vs raggedness) toward **goal**; **-c**/**-t**/**-p** still use greedy wrap with a proportional inner goal (full GNU crown/tagged DP not implemented).

  **-c (crown margin):** lines after the second must share the **same leading space count** as the second line (GNU paragraph rules); otherwise a new paragraph starts. **-s -c:** each non-empty line is wrapped with its own leading indent preserved (plain **-s** still trims indents in jsh).

  **-t (tagged paragraph):** when the first two lines of a paragraph have **different** leading space counts, behavior matches **-c** for that paragraph. When they are **equal** and there are multiple lines, each input line is formatted as its own paragraph (GNU: no merge). A **single** tagged paragraph line uses first-line indent then **no** indent on wrapped continuations (GNU; differs from **-c** single-line wrap).

  **-p (prefix):** only lines matching optional leading spaces + PREFIX are reformatted; other lines pass through. Consecutive matching lines with the **same** prefix column merge unless **-s** (split-only). With **-c**/**-t**, prefix is stripped and inner text is formatted with an effective width of WIDTH minus the prefix length.

  **Tabs:** input **TAB** characters are expanded to spaces at **${LESS_DEFAULT_TAB_STOPS}**-column stops (same as **less -x** / **expand -t8**) before line wrapping and indent detection; output lines use spaces only. Not full GNU fmt: sentence punctuation costs / widow-orphan bonuses from GNU **fmt** are not modeled; **-c**/**-t** goal is approximate.

Full documentation: <https://www.gnu.org/software/coreutils/fmt>
`;

/**
 * GNU-style option error for fmt (exit status 1).
 * @param {string} arg
 * @returns {string}
 */
function fmtOptionError(arg) {
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

/** GNU **fmt** LEEWAY 7 → default goal = max_width × (2×(100−7)+1) / 200. */
const FMT_FMT_GOAL_NUMERATOR = 187;
const FMT_FMT_GOAL_DENOMINATOR = 200;

/**
 * Default goal width for **fmt** (GNU **coreutils** with LEEWAY 7).
 * @param {number} maxWidth
 * @returns {number}
 */
function fmtFmtDefaultGoal(maxWidth) {
  const w = maxWidth > 0 ? maxWidth : FMT_DEFAULT_WIDTH;
  return Math.max(
    1,
    Math.min(w, Math.floor((w * FMT_FMT_GOAL_NUMERATOR) / FMT_FMT_GOAL_DENOMINATOR))
  );
}

/**
 * Scale outer **goal** to an inner width when prefix/crown reduces the fill column.
 * @param {number} outerWidth
 * @param {number} innerWidth
 * @param {number} outerGoal
 * @returns {number}
 */
function fmtInnerGoal(outerWidth, innerWidth, outerGoal) {
  const ow = outerWidth > 0 ? outerWidth : FMT_DEFAULT_WIDTH;
  const iw = Math.max(1, innerWidth);
  const g = Math.max(1, Math.min(outerGoal, ow));
  return Math.max(1, Math.min(iw, Math.floor((g * iw) / ow)));
}

/**
 * @param {string} v
 * @param {number} maxWidth inclusive upper bound for goal
 * @returns {{ ok: true, goal: number } | { ok: false, stderr: string, exitCode: number }}
 */
function parseFmtGoalValue(v, maxWidth) {
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
 * @param {string} s
 * @returns {number}
 */
function fmtLen(s) {
  return Array.from(String(s)).length;
}

/**
 * Count leading space characters. **fmtFmtText** expands tabs to spaces first (see **lessExpandTabsInText**), so paragraph logic sees space-only indents.
 * @param {string} line
 * @returns {number}
 */
function fmtLeadingSpaceCount(line) {
  let n = 0;
  for (const ch of String(line)) {
    if (ch !== ' ') break;
    n++;
  }
  return n;
}

/**
 * @param {string} s
 * @returns {string}
 */
function fmtPrefixEscapeForRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * GNU **fmt** **-p**: line begins with optional leading spaces + PREFIX; remainder is **rest**.
 * @param {string} line
 * @param {string} prefix
 * @returns {{ prefixPart: string, rest: string } | null}
 */
function fmtPrefixMatchLine(line, prefix) {
  const p = String(prefix);
  if (p === '') {
    return null;
  }
  const re = new RegExp(`^(\\s*)(${fmtPrefixEscapeForRegex(p)})(.*)$`);
  const m = String(line).match(re);
  if (!m) {
    return null;
  }
  return { prefixPart: m[1] + m[2], rest: m[3] };
}

/**
 * @param {string} text
 * @param {number} width
 * @param {boolean} splitOnly
 * @param {boolean} uniformSpacing
 * @param {boolean} crownMargin
 * @param {boolean} taggedParagraph
 * @param {string} prefix
 * @param {number} [goal]
 * @returns {string}
 */
function fmtFmtTextWithPrefix(
  text,
  width,
  splitOnly,
  uniformSpacing,
  crownMargin,
  taggedParagraph,
  prefix,
  goal
) {
  const outerW = width > 0 ? width : FMT_DEFAULT_WIDTH;
  const outerGoal = goal !== undefined ? goal : fmtFmtDefaultGoal(outerW);
  const raw = String(text);
  const hadTrailingNewline = raw.endsWith('\n');
  const rawLines = raw.split('\n');
  const outBlocks = [];
  let i = 0;
  while (i < rawLines.length) {
    const line = rawLines[i];
    if (line === '') {
      outBlocks.push('');
      i++;
      continue;
    }
    const m = fmtPrefixMatchLine(line, prefix);
    if (!m) {
      outBlocks.push(line);
      i++;
      continue;
    }
    if (splitOnly) {
      const gap = m.rest.startsWith(' ') ? 1 : 0;
      const innerW = Math.max(1, width - fmtLen(m.prefixPart) - gap);
      const innerGoal = fmtInnerGoal(outerW, innerW, outerGoal);
      const innerOut = fmtFmtText(
        m.rest,
        innerW,
        true,
        uniformSpacing,
        crownMargin,
        taggedParagraph,
        null,
        innerGoal
      );
      const lines = innerOut.split('\n');
      const leadAfterPrefix = gap ? ' ' : '';
      outBlocks.push(lines.map((l) => m.prefixPart + leadAfterPrefix + l).join('\n'));
      i++;
      continue;
    }
    const paraPrefix = m.prefixPart;
    const restLines = [m.rest];
    i++;
    while (i < rawLines.length && rawLines[i] !== '') {
      const m2 = fmtPrefixMatchLine(rawLines[i], prefix);
      if (!m2 || m2.prefixPart !== paraPrefix) {
        break;
      }
      restLines.push(m2.rest);
      i++;
    }
    const gap = restLines[0].startsWith(' ') ? 1 : 0;
    const innerW = Math.max(1, width - fmtLen(paraPrefix) - gap);
    const innerGoal = fmtInnerGoal(outerW, innerW, outerGoal);
    let innerOut;
    if (crownMargin || taggedParagraph) {
      innerOut = fmtFmtText(
        restLines.join('\n'),
        innerW,
        false,
        uniformSpacing,
        crownMargin,
        taggedParagraph,
        null,
        innerGoal
      );
    } else {
      const words = [];
      for (const r of restLines) {
        words.push(...r.trim().split(/\s+/).filter(Boolean));
      }
      innerOut = fmtWrapWords(words, innerW, uniformSpacing, innerGoal);
    }
    const mergedLines = innerOut.split('\n');
    const leadAfterPrefix = gap ? ' ' : '';
    outBlocks.push(mergedLines.map((l) => paraPrefix + leadAfterPrefix + l).join('\n'));
  }
  let body = outBlocks.join('\n');
  if (hadTrailingNewline) {
    if (body !== '' && !body.endsWith('\n')) {
      return `${body}\n`;
    }
    return body;
  }
  return body.replace(/\n$/, '');
}

/**
 * @param {string} word
 * @param {number} width
 * @returns {string[]}
 */
function fmtBreakLongWord(word, width) {
  const chars = Array.from(word);
  const lines = [];
  const w = width > 0 ? width : FMT_DEFAULT_WIDTH;
  for (let i = 0; i < chars.length; i += w) {
    lines.push(chars.slice(i, i + w).join(''));
  }
  return lines;
}

/**
 * @param {string} prevWord
 * @param {boolean} uniformSpacing
 * @returns {number}
 */
function fmtInterWordSepWidth(prevWord, uniformSpacing) {
  if (uniformSpacing) {
    return 1;
  }
  return /[.!?]$/.test(prevWord) ? 2 : 1;
}

/**
 * Split overlong words into chunks ≤ **maxLen** (same as greedy **fmt**).
 * @param {string[]} words
 * @param {number} maxLen
 * @returns {string[]}
 */
function fmtExplodeWordsForMaxWidth(words, maxLen) {
  const out = [];
  const w = maxLen > 0 ? maxLen : FMT_DEFAULT_WIDTH;
  for (const word of words) {
    if (fmtLen(word) <= w) {
      out.push(word);
    } else {
      out.push(...fmtBreakLongWord(word, w));
    }
  }
  return out;
}

/**
 * Greedy word-wrap (GNU **fmt** without goal optimization).
 * @param {string[]} words
 * @param {number} width
 * @param {boolean} uniformSpacing
 * @returns {string}
 */
function fmtWrapWordsGreedy(words, width, uniformSpacing) {
  if (words.length === 0) {
    return '';
  }
  const w = width > 0 ? width : FMT_DEFAULT_WIDTH;
  const outLines = [];
  let line = '';
  let prevWord = '';
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    let sep = '';
    if (line !== '') {
      sep = ' '.repeat(fmtInterWordSepWidth(prevWord, uniformSpacing));
    }
    const candidate = line + sep + word;
    if (fmtLen(candidate) <= w) {
      line = candidate;
      prevWord = word;
      continue;
    }
    if (line) {
      outLines.push(line);
      line = '';
    }
    if (fmtLen(word) <= w) {
      line = word;
      prevWord = word;
      continue;
    }
    const chunks = fmtBreakLongWord(word, w);
    for (let k = 0; k < chunks.length - 1; k++) {
      outLines.push(chunks[k]);
    }
    line = chunks[chunks.length - 1];
    prevWord = word;
  }
  if (line) {
    outLines.push(line);
  }
  return outLines.join('\n');
}

/**
 * GNU **fmt**-style backward DP (simplified **line_cost** / **RAGGED_COST**; no **base_cost** punctuation).
 * @param {string[]} words
 * @param {number} maxWidth
 * @param {boolean} uniformSpacing
 * @param {number} goalWidth
 * @returns {string}
 */
function fmtWrapWordsDp(words, maxWidth, uniformSpacing, goalWidth) {
  const maxLen = maxWidth > 0 ? maxWidth : FMT_DEFAULT_WIDTH;
  const goal = Math.max(1, Math.min(goalWidth, maxLen));
  const wordsExp = fmtExplodeWordsForMaxWidth(words, maxLen);
  const n = wordsExp.length;
  if (n === 0) {
    return '';
  }

  function lineLenRange(i, j) {
    let len = fmtLen(wordsExp[i]);
    for (let k = i + 1; k < j; k++) {
      len += fmtInterWordSepWidth(wordsExp[k - 1], uniformSpacing) + fmtLen(wordsExp[k]);
    }
    return len;
  }

  function lineCost(len, nextIsEnd) {
    if (nextIsEnd) {
      return 0;
    }
    const d = goal - len;
    return d * d * 100;
  }

  function raggedCost(len, nextLen) {
    const d = len - nextLen;
    return (d * d * 100) / 2;
  }

  const bestCost = new Array(n + 1);
  const nextBreak = new Array(n);
  const lineLenAt = new Array(n);
  bestCost[n] = 0;

  for (let i = n - 1; i >= 0; i--) {
    let best = Infinity;
    let bestJ = n;
    let bestLenLine = 0;
    for (let j = i + 1; j <= n; j++) {
      const len = lineLenRange(i, j);
      if (len > maxLen) {
        break;
      }
      const nextIsEnd = j === n;
      let wc = lineCost(len, nextIsEnd) + bestCost[j];
      if (!nextIsEnd) {
        wc += raggedCost(len, lineLenAt[j]);
      }
      if (wc < best) {
        best = wc;
        bestJ = j;
        bestLenLine = len;
      }
    }
    bestCost[i] = best;
    nextBreak[i] = bestJ;
    lineLenAt[i] = bestLenLine;
  }

  const outLines = [];
  let idx = 0;
  while (idx < n) {
    const nb = nextBreak[idx];
    let line = wordsExp[idx];
    for (let k = idx + 1; k < nb; k++) {
      const sep = ' '.repeat(fmtInterWordSepWidth(wordsExp[k - 1], uniformSpacing));
      line += sep + wordsExp[k];
    }
    outLines.push(line);
    idx = nb;
  }
  return outLines.join('\n');
}

/**
 * Word-wrap words to width; **uniformSpacing** uses single spaces; otherwise two spaces after sentence-ending punctuation (GNU-style) before the next word.
 * With **goalWidth** &lt; **width**, uses a GNU-like DP toward the goal (plain merge mode).
 * @param {string[]} words
 * @param {number} width
 * @param {boolean} uniformSpacing
 * @param {number} [goalWidth]
 * @returns {string}
 */
function fmtWrapWords(words, width, uniformSpacing, goalWidth) {
  if (words.length === 0) {
    return '';
  }
  const w = width > 0 ? width : FMT_DEFAULT_WIDTH;
  const g = goalWidth !== undefined ? goalWidth : fmtFmtDefaultGoal(w);
  if (g >= w) {
    return fmtWrapWordsGreedy(words, w, uniformSpacing);
  }
  return fmtWrapWordsDp(words, w, uniformSpacing, g);
}

/**
 * Word-wrap with a crown margin: first line uses **indent1** spaces, later lines **indent2** (GNU **-c** subset).
 * @param {string[]} words
 * @param {number} width
 * @param {boolean} uniformSpacing
 * @param {number} indent1
 * @param {number} indent2
 * @returns {string}
 */
function fmtWrapWordsCrown(words, width, uniformSpacing, indent1, indent2) {
  if (words.length === 0) {
    return '';
  }
  const w = width > 0 ? width : FMT_DEFAULT_WIDTH;
  const p1 = Math.max(0, Math.min(indent1, w));
  const p2 = Math.max(0, Math.min(indent2, w));
  let maxLen = Math.max(1, w - p1);
  const maxLater = Math.max(1, w - p2);
  const outLines = [];
  let line = '';
  let prevWord = '';
  let isFirstLine = true;

  function flushLine() {
    if (!line) {
      return;
    }
    outLines.push(`${' '.repeat(isFirstLine ? p1 : p2)}${line}`);
    line = '';
    isFirstLine = false;
    maxLen = maxLater;
  }

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    let sep = '';
    if (line !== '') {
      if (uniformSpacing) {
        sep = ' ';
      } else {
        sep = /[.!?]$/.test(prevWord) ? '  ' : ' ';
      }
    }
    const candidate = line + sep + word;
    if (fmtLen(candidate) <= maxLen) {
      line = candidate;
      prevWord = word;
      continue;
    }
    if (line) {
      flushLine();
      i--;
      continue;
    }
    if (fmtLen(word) <= maxLen) {
      line = word;
      prevWord = word;
      continue;
    }
    const chunks = fmtBreakLongWord(word, maxLen);
    for (let k = 0; k < chunks.length - 1; k++) {
      outLines.push(`${' '.repeat(isFirstLine ? p1 : p2)}${chunks[k]}`);
      isFirstLine = false;
      maxLen = maxLater;
    }
    line = chunks[chunks.length - 1];
    prevWord = word;
  }
  flushLine();
  return outLines.join('\n');
}

/**
 * @param {string} text
 * @param {number} width
 * @param {boolean} splitOnly
 * @param {boolean} uniformSpacing
 * @param {boolean} [crownMargin=false]
 * @param {boolean} [taggedParagraph=false]
 * @param {string | null} [prefix=null]
 * @param {number} [goal]
 * @returns {string}
 */
function fmtFmtText(
  text,
  width,
  splitOnly,
  uniformSpacing,
  crownMargin = false,
  taggedParagraph = false,
  prefix = null,
  goal = undefined
) {
  const w = width > 0 ? width : FMT_DEFAULT_WIDTH;
  const resolvedGoal = goal !== undefined ? goal : fmtFmtDefaultGoal(w);
  const expandedInput = lessExpandTabsInText(String(text), LESS_DEFAULT_TAB_STOPS);
  if (prefix != null && prefix !== '') {
    return fmtFmtTextWithPrefix(
      expandedInput,
      width,
      splitOnly,
      uniformSpacing,
      crownMargin,
      taggedParagraph,
      prefix,
      resolvedGoal
    );
  }
  const raw = expandedInput;
  const hadTrailingNewline = raw.endsWith('\n');
  let body;
  if (splitOnly) {
    const rawLines = raw.split('\n');
    const out = [];
    for (const ln of rawLines) {
      if (ln.trim() === '') {
        out.push('');
        continue;
      }
      const words = ln.trim().split(/\s+/).filter(Boolean);
      const indent = fmtLeadingSpaceCount(ln);
      if (crownMargin || taggedParagraph) {
        out.push(fmtWrapWordsCrown(words, width, uniformSpacing, indent, indent));
      } else {
        out.push(fmtWrapWords(words, width, uniformSpacing, resolvedGoal));
      }
    }
    body = out.join('\n');
  } else {
    const rawLines = raw.split('\n');
    const blocks = [];
    let i = 0;
    while (i < rawLines.length) {
      if (rawLines[i] === '') {
        blocks.push({ type: 'blank' });
        i++;
        continue;
      }
      if (crownMargin) {
        const L1 = rawLines[i];
        i++;
        if (i >= rawLines.length || rawLines[i] === '') {
          blocks.push({ type: 'para', lines: [L1] });
          continue;
        }
        const L2 = rawLines[i];
        i++;
        const bodyIndent = fmtLeadingSpaceCount(L2);
        const paraLines = [L1, L2];
        while (i < rawLines.length && rawLines[i] !== '') {
          if (fmtLeadingSpaceCount(rawLines[i]) !== bodyIndent) {
            break;
          }
          paraLines.push(rawLines[i]);
          i++;
        }
        blocks.push({ type: 'para', lines: paraLines });
        continue;
      }
      if (taggedParagraph) {
        const L1 = rawLines[i];
        i++;
        if (i >= rawLines.length || rawLines[i] === '') {
          blocks.push({ type: 'para', lines: [L1], taggedSingle: true });
          continue;
        }
        const L2 = rawLines[i];
        if (fmtLeadingSpaceCount(L1) !== fmtLeadingSpaceCount(L2)) {
          i++;
          const bodyIndent = fmtLeadingSpaceCount(L2);
          const paraLines = [L1, L2];
          while (i < rawLines.length && rawLines[i] !== '') {
            if (fmtLeadingSpaceCount(rawLines[i]) !== bodyIndent) {
              break;
            }
            paraLines.push(rawLines[i]);
            i++;
          }
          blocks.push({ type: 'para', lines: paraLines, taggedMerge: true });
          continue;
        }
        blocks.push({ type: 'para', lines: [L1], taggedSingle: true });
        continue;
      }
      const paraLines = [];
      while (i < rawLines.length && rawLines[i] !== '') {
        paraLines.push(rawLines[i]);
        i++;
      }
      blocks.push({ type: 'para', lines: paraLines });
    }
    const outParts = [];
    for (const b of blocks) {
      if (b.type === 'blank') {
        outParts.push('');
      } else {
        const words = [];
        for (const pl of b.lines) {
          words.push(...pl.trim().split(/\s+/).filter(Boolean));
        }
        const indent1 = fmtLeadingSpaceCount(b.lines[0]);
        const indent2 = b.lines.length > 1 ? fmtLeadingSpaceCount(b.lines[1]) : indent1;
        if (crownMargin) {
          outParts.push(fmtWrapWordsCrown(words, width, uniformSpacing, indent1, indent2));
        } else if (taggedParagraph) {
          if (b.taggedMerge) {
            outParts.push(fmtWrapWordsCrown(words, width, uniformSpacing, indent1, indent2));
          } else {
            outParts.push(fmtWrapWordsCrown(words, width, uniformSpacing, indent1, 0));
          }
        } else {
          outParts.push(fmtWrapWords(words, width, uniformSpacing, resolvedGoal));
        }
      }
    }
    body = outParts.join('\n');
  }
  if (hadTrailingNewline) {
    if (body !== '' && !body.endsWith('\n')) {
      return `${body}\n`;
    }
    return body;
  }
  return body.replace(/\n$/, '');
}

/**
 * Parse jsh `fmt` argv (GNU subset: -c, -p, -s, -t, -u, -w, -g, --, --help, --version).
 *
 * @param {string[]} args
 * @returns {{ ok: true, width: number, goal: number, splitOnly: boolean, uniformSpacing: boolean, crownMargin: boolean, taggedParagraph: boolean, prefix: string | null, operands: string[], help?: true, version?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseFmtArgv(args) {
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

const FmtLib = {
  FMT_HELP,
  FMT_VERSION_LINE,
  FMT_DEFAULT_WIDTH,
  FMT_FMT_GOAL_NUMERATOR,
  FMT_FMT_GOAL_DENOMINATOR,
  fmtFmtDefaultGoal,
  parseFmtGoalValue,
  fmtInnerGoal,
  parseFmtArgv,
  fmtFmtText,
  fmtPrefixMatchLine,
  fmtLeadingSpaceCount,
  fmtWrapWordsCrown,
  fmtOptionError
};
if (typeof globalThis !== 'undefined') {
  /** @type {*} */ (globalThis).FmtLib = FmtLib;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = FmtLib;
}

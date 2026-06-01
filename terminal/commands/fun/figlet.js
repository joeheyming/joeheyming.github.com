// figlet — print TEXT as ASCII-art banner.
//
// Bundles a single small block font (5 rows × 5 cols per glyph). Real figlet
// supports many .flf fonts, kerning, colors, and right-to-left scripts; we
// don't. Lowercase input is auto-uppercased to keep the bundled font tiny.

const FIGLET_HELP = `Usage: figlet [OPTION]... [TEXT]
Print TEXT as ASCII-art banner using a small bundled block font.

  -c                center each line on the screen
  -k                kerning: trim shared spaces between adjacent letters
  -w WIDTH          target width for centering (default: 80)
      --gap N       extra spaces between glyphs (default: 1)
      --help        this help

If TEXT is omitted, figlet reads stdin (one banner per line of input).

Examples:
  figlet hello
  figlet -c -w 120 'joe heyming'
  echo 'BUILD ME' | figlet -k
`;

/** 5-row glyph height for the bundled font. */
const FONT_HEIGHT = 5;

/**
 * Bundled block font. Each entry is FONT_HEIGHT rows separated by \n; rows
 * are equal width within a glyph. `█` = filled, ` ` = empty.
 *
 * Hand-rolled — wide enough to be readable, narrow enough to stay compact.
 */
const FONT = {
  ' ': '   \n   \n   \n   \n   ',
  A: ' ███ \n█   █\n█████\n█   █\n█   █',
  B: '████ \n█   █\n████ \n█   █\n████ ',
  C: ' ████\n█    \n█    \n█    \n ████',
  D: '████ \n█   █\n█   █\n█   █\n████ ',
  E: '█████\n█    \n████ \n█    \n█████',
  F: '█████\n█    \n████ \n█    \n█    ',
  G: ' ████\n█    \n█  ██\n█   █\n ████',
  H: '█   █\n█   █\n█████\n█   █\n█   █',
  I: '█████\n  █  \n  █  \n  █  \n█████',
  J: '█████\n   █ \n   █ \n█  █ \n ██  ',
  K: '█   █\n█  █ \n███  \n█  █ \n█   █',
  L: '█    \n█    \n█    \n█    \n█████',
  M: '█   █\n██ ██\n█ █ █\n█   █\n█   █',
  N: '█   █\n██  █\n█ █ █\n█  ██\n█   █',
  O: ' ███ \n█   █\n█   █\n█   █\n ███ ',
  P: '████ \n█   █\n████ \n█    \n█    ',
  Q: ' ███ \n█   █\n█   █\n█  ██\n ████',
  R: '████ \n█   █\n████ \n█  █ \n█   █',
  S: ' ████\n█    \n ███ \n    █\n████ ',
  T: '█████\n  █  \n  █  \n  █  \n  █  ',
  U: '█   █\n█   █\n█   █\n█   █\n ███ ',
  V: '█   █\n█   █\n█   █\n █ █ \n  █  ',
  W: '█   █\n█   █\n█ █ █\n██ ██\n█   █',
  X: '█   █\n █ █ \n  █  \n █ █ \n█   █',
  Y: '█   █\n █ █ \n  █  \n  █  \n  █  ',
  Z: '█████\n   █ \n  █  \n █   \n█████',
  0: ' ███ \n█  ██\n█ █ █\n██  █\n ███ ',
  1: '  █  \n ██  \n  █  \n  █  \n █████',
  2: ' ███ \n█   █\n   █ \n  █  \n █████',
  3: ' ███ \n█   █\n  ██ \n█   █\n ███ ',
  4: '   █ \n  ██ \n █ █ \n█████\n   █ ',
  5: '█████\n█    \n████ \n    █\n████ ',
  6: ' ███ \n█    \n████ \n█   █\n ███ ',
  7: '█████\n   █ \n  █  \n █   \n█    ',
  8: ' ███ \n█   █\n ███ \n█   █\n ███ ',
  9: ' ███ \n█   █\n ████\n    █\n ███ ',
  '!': '  █  \n  █  \n  █  \n     \n  █  ',
  '?': ' ███ \n█   █\n   █ \n     \n  █  ',
  '.': '     \n     \n     \n     \n  █  ',
  ',': '     \n     \n     \n  █  \n █   ',
  "'": '  █  \n  █  \n     \n     \n     ',
  '-': '     \n     \n █████\n     \n     ',
  ':': '     \n  █  \n     \n  █  \n     ',
  ';': '     \n  █  \n     \n  █  \n █   '
};

const FALLBACK_GLYPH = '?????\n?   ?\n?   ?\n?   ?\n?????';

function getGlyphRows(ch) {
  const upper = ch.toUpperCase();
  const raw = FONT[upper] || FONT[ch] || FALLBACK_GLYPH;
  return raw.split('\n');
}

/**
 * Trim shared trailing/leading whitespace columns between two adjacent glyphs
 * to mimic figlet's "kerning". For each row, count how many spaces are on the
 * right of `left` and the left of `right`; remove min of those from each pair
 * of rows. Returns the kerned `right` glyph rows.
 */
function kernGlyphs(leftRows, rightRows) {
  let minOverlap = Infinity;
  for (let i = 0; i < FONT_HEIGHT; i++) {
    const lTrail = leftRows[i].length - leftRows[i].replace(/\s+$/, '').length;
    const rLead = rightRows[i].length - rightRows[i].replace(/^\s+/, '').length;
    minOverlap = Math.min(minOverlap, lTrail + rLead);
  }
  if (!Number.isFinite(minOverlap) || minOverlap <= 1) return rightRows;
  // Conservative: leave one space between glyphs.
  const trim = minOverlap - 1;
  return rightRows.map((row) =>
    row.slice(Math.min(trim, row.length - row.replace(/^\s+/, '').length))
  );
}

function renderText(text, opts) {
  const { kern, gap } = opts;
  const rows = Array.from({ length: FONT_HEIGHT }, () => '');
  let prev = null;
  for (const ch of text) {
    const glyph = getGlyphRows(ch);
    let toAppend = glyph;
    if (prev) {
      if (kern) {
        toAppend = kernGlyphs(
          rows.map((r) => r.slice(-FONT_HEIGHT * 2)),
          glyph
        );
      } else if (gap > 0) {
        for (let i = 0; i < FONT_HEIGHT; i++) rows[i] += ' '.repeat(gap);
      }
    }
    for (let i = 0; i < FONT_HEIGHT; i++) {
      rows[i] += toAppend[i] || '';
    }
    prev = glyph;
  }
  return rows;
}

function centerRows(rows, width) {
  const out = [];
  for (const row of rows) {
    const pad = Math.max(0, Math.floor((width - row.length) / 2));
    out.push(' '.repeat(pad) + row);
  }
  return out;
}

function figletHandler(terminal, args) {
  let center = false;
  let kern = false;
  let width = 80;
  let gap = 1;
  const textParts = [];
  let endOfOpts = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (endOfOpts) {
      textParts.push(a);
      continue;
    }
    if (a === '--help' || a === '-h') return { stdout: FIGLET_HELP, stderr: '', exitCode: 0 };
    if (a === '--') {
      endOfOpts = true;
      continue;
    }
    if (a === '-c') {
      center = true;
      continue;
    }
    if (a === '-k') {
      kern = true;
      continue;
    }
    if (a === '-w' || a === '--width') {
      const n = parseInt(args[++i], 10);
      if (!Number.isFinite(n) || n < 1) {
        return { stdout: '', stderr: `figlet: invalid width: ${args[i]}\n`, exitCode: 2 };
      }
      width = n;
      continue;
    }
    if (a === '--gap') {
      const n = parseInt(args[++i], 10);
      if (!Number.isFinite(n) || n < 0) {
        return { stdout: '', stderr: `figlet: invalid gap: ${args[i]}\n`, exitCode: 2 };
      }
      gap = n;
      continue;
    }
    if (a.startsWith('-') && a.length > 1) {
      return { stdout: '', stderr: `figlet: unrecognized option: ${a}\n`, exitCode: 2 };
    }
    textParts.push(a);
  }

  const stdinAvailable =
    terminal.stdinSupplied === true || (terminal.hasStdin && terminal.stdin != null);
  const stdinText = stdinAvailable ? (terminal.stdin != null ? String(terminal.stdin) : '') : '';

  /** @type {string[]} */
  let inputs;
  if (textParts.length > 0) {
    inputs = [textParts.join(' ')];
  } else if (stdinAvailable && stdinText.trim() !== '') {
    inputs = stdinText.split('\n').filter((l) => l.length > 0);
  } else {
    return { stdout: '', stderr: 'figlet: no input\n', exitCode: 1 };
  }

  const blocks = [];
  for (const input of inputs) {
    let rows = renderText(input, { kern, gap });
    if (center) rows = centerRows(rows, width);
    blocks.push(rows.join('\n'));
  }
  return { stdout: blocks.join('\n\n') + '\n', stderr: '', exitCode: 0 };
}

export default {
  name: 'figlet',
  handler: figletHandler,
  description: 'print TEXT as a block-letter banner (-c center, -k kern, -w width, --gap N)',
  category: 'Fun Stuff'
};

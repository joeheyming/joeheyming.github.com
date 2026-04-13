/** GNU **fold** default wrap width (columns or bytes). */
const FOLD_DEFAULT_WIDTH = 80;

const FOLD_VERSION_LINE = 'fold (jsh Heyming Terminal) 1.0\n';

const FOLD_HELP = `Usage: fold [OPTION]... [FILE]...
Wrap each input line to fit in WIDTH columns (or bytes); write to standard output.

With no FILE, or when FILE is -, read standard input.

  -b, --bytes         count bytes rather than columns (UTF-8)
  -s, --spaces        break at spaces (GNU-style)
  -w, --width=WIDTH   use WIDTH columns instead of 80 (also: -w WIDTH)
  -h, --help          display this help and exit
      --version       output version information and exit
  --                  end of options

jsh:
  Column mode counts Unicode code points (not full POSIX locale width). Byte mode (-b) splits UTF-8 octets and may break inside multibyte characters (GNU-style). Piped stdin requires stdin to be supplied (empty pipe works). Symlinks are followed to a regular file (like expand). Binary files show one [binary file] line.

Full documentation: <https://www.gnu.org/software/coreutils/fold>
`;

/**
 * GNU-style option error for fold (exit status 1).
 * @param {string} arg
 * @returns {string}
 */
function foldOptionError(arg) {
  const tryLine = "Try 'fold --help' for more information.\n";
  if (arg.startsWith('--') && arg.length > 2) {
    return `fold: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `fold: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `fold: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * @param {string} v
 * @returns {{ ok: true, width: number } | { ok: false, stderr: string, exitCode: number }}
 */
function parseFoldWidthValue(v) {
  const s = String(v);
  if (!/^\d+$/.test(s)) {
    return {
      ok: false,
      stderr: `fold: invalid number of columns: '${s}'\nTry 'fold --help' for more information.\n`,
      exitCode: 1
    };
  }
  const n = parseInt(s, 10);
  if (n < 1) {
    return {
      ok: false,
      stderr: `fold: column number must be a positive integer\nTry 'fold --help' for more information.\n`,
      exitCode: 1
    };
  }
  if (n > 1000000) {
    return {
      ok: false,
      stderr: `fold: column width too large\nTry 'fold --help' for more information.\n`,
      exitCode: 1
    };
  }
  return { ok: true, width: n };
}

/**
 * Fold one logical line (no embedded newline) using Unicode code points.
 * @param {string} line
 * @param {number} width
 * @param {boolean} breakAtSpaces **-s**
 * @returns {string}
 */
function foldFoldLineChars(line, width, breakAtSpaces) {
  const w = width > 0 ? width : FOLD_DEFAULT_WIDTH;
  const chars = Array.from(line);
  if (chars.length === 0) {
    return '';
  }
  if (!breakAtSpaces) {
    const parts = [];
    for (let i = 0; i < chars.length; i += w) {
      parts.push(chars.slice(i, i + w).join(''));
    }
    return parts.join('\n');
  }
  const parts = [];
  let start = 0;
  while (start < chars.length) {
    if (chars.length - start <= w) {
      parts.push(chars.slice(start).join(''));
      break;
    }
    const slice = chars.slice(start, start + w);
    const s = slice.join('');
    const lastSpace = s.lastIndexOf(' ');
    if (lastSpace > 0) {
      parts.push(chars.slice(start, start + lastSpace).join(''));
      start += lastSpace + 1;
      continue;
    }
    if (lastSpace === 0) {
      parts.push(' ');
      start += 1;
      continue;
    }
    parts.push(chars.slice(start, start + w).join(''));
    start += w;
  }
  return parts.join('\n');
}

/**
 * Fold one logical line in UTF-8 byte mode.
 * @param {string} line
 * @param {number} width
 * @param {boolean} breakAtSpaces **-s**
 * @returns {string}
 */
function foldFoldLineBytes(line, width, breakAtSpaces) {
  const w = width > 0 ? width : FOLD_DEFAULT_WIDTH;
  const enc = new TextEncoder();
  const bytes = enc.encode(line);
  const dec = new TextDecoder('utf-8', { fatal: false });
  if (bytes.length === 0) {
    return '';
  }
  if (!breakAtSpaces) {
    const parts = [];
    for (let i = 0; i < bytes.length; i += w) {
      parts.push(dec.decode(bytes.slice(i, i + w)));
    }
    return parts.join('\n');
  }
  const parts = [];
  let start = 0;
  while (start < bytes.length) {
    if (bytes.length - start <= w) {
      parts.push(dec.decode(bytes.slice(start)));
      break;
    }
    const chunk = bytes.slice(start, start + w);
    let lastSpace = -1;
    for (let j = chunk.length - 1; j >= 0; j--) {
      if (chunk[j] === 0x20) {
        lastSpace = j;
        break;
      }
    }
    if (lastSpace > 0) {
      parts.push(dec.decode(bytes.slice(start, start + lastSpace)));
      start += lastSpace + 1;
      continue;
    }
    if (lastSpace === 0) {
      parts.push(' ');
      start += 1;
      continue;
    }
    parts.push(dec.decode(bytes.slice(start, start + w)));
    start += w;
  }
  return parts.join('\n');
}

/**
 * @param {string} text
 * @param {number} width
 * @param {boolean} bytesMode **-b**
 * @param {boolean} breakAtSpaces **-s**
 * @returns {string}
 */
function foldFoldText(text, width, bytesMode, breakAtSpaces) {
  const w = width > 0 ? width : FOLD_DEFAULT_WIDTH;
  const foldLine = bytesMode ? foldFoldLineBytes : foldFoldLineChars;
  return String(text)
    .split('\n')
    .map((line) => foldLine(line, w, breakAtSpaces))
    .join('\n');
}

/**
 * Parse jsh `fold` argv (GNU subset: -b, -s, -w, --, --help, --version).
 *
 * @param {string[]} args
 * @returns {{ ok: true, width: number, bytesMode: boolean, breakAtSpaces: boolean, operands: string[], help?: true, version?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseFoldArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  let width = FOLD_DEFAULT_WIDTH;
  let bytesMode = false;
  let breakAtSpaces = false;
  let i = 0;
  while (i < argsArr.length) {
    const arg = argsArr[i];
    if (arg === '--') {
      i++;
      break;
    }
    if (arg === '--help' || arg === '-h' || arg === '-?') {
      return { ok: true, width, bytesMode, breakAtSpaces, operands: [], help: true };
    }
    if (arg === '--version') {
      return { ok: true, width, bytesMode, breakAtSpaces, operands: [], version: true };
    }
    if (arg === '-b' || arg === '--bytes') {
      bytesMode = true;
      i++;
      continue;
    }
    if (arg === '-s' || arg === '--spaces') {
      breakAtSpaces = true;
      i++;
      continue;
    }
    if (arg === '-w' || arg === '--width') {
      const v = argsArr[++i];
      if (v == null) {
        return {
          ok: false,
          stderr: `fold: option requires an argument -- 'width'\nTry 'fold --help' for more information.\n`,
          exitCode: 1
        };
      }
      const p = parseFoldWidthValue(v);
      if (p.ok === false) {
        return p;
      }
      width = p.width;
      i++;
      continue;
    }
    if (arg.startsWith('--width=')) {
      const v = arg.slice('--width='.length);
      const p = parseFoldWidthValue(v);
      if (p.ok === false) {
        return p;
      }
      width = p.width;
      i++;
      continue;
    }
    if (arg.startsWith('-w') && arg.length > 2) {
      const v = arg.slice(2);
      const p = parseFoldWidthValue(v);
      if (p.ok === false) {
        return p;
      }
      width = p.width;
      i++;
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1 && !arg.startsWith('--')) {
      let j = 1;
      while (j < arg.length) {
        const c = arg[j];
        if (c === 'b') {
          bytesMode = true;
          j++;
          continue;
        }
        if (c === 's') {
          breakAtSpaces = true;
          j++;
          continue;
        }
        if (c === 'h' || c === '?') {
          return { ok: true, width, bytesMode, breakAtSpaces, operands: [], help: true };
        }
        if (c === 'w') {
          const rest = arg.slice(j + 1);
          if (rest.length >= 1) {
            const p = parseFoldWidthValue(rest);
            if (p.ok === false) {
              return p;
            }
            width = p.width;
            j = arg.length;
            break;
          }
          const next = argsArr[i + 1];
          if (next == null) {
            return {
              ok: false,
              stderr: `fold: option requires an argument -- 'w'\nTry 'fold --help' for more information.\n`,
              exitCode: 1
            };
          }
          const p = parseFoldWidthValue(next);
          if (p.ok === false) {
            return p;
          }
          width = p.width;
          i++;
          j = arg.length;
          break;
        }
        return { ok: false, stderr: foldOptionError(`-${c}`), exitCode: 1 };
      }
      i++;
      continue;
    }
    break;
  }
  const operands = argsArr.slice(i);
  return { ok: true, width, bytesMode, breakAtSpaces, operands };
}

export const FoldLib = {
  FOLD_HELP,
  FOLD_VERSION_LINE,
  FOLD_DEFAULT_WIDTH,
  parseFoldArgv,
  foldFoldText,
  foldFoldLineChars,
  foldFoldLineBytes,
  foldOptionError
};

'use strict';

const SPLIT_VERSION_LINE = 'split (jsh Heyming Terminal) 1.0\n';

const SPLIT_HELP = `Usage: split [OPTION]... [INPUT [PREFIX]]
Output fixed-size pieces of INPUT to PREFIXaa, PREFIXab, ...; default PREFIX is 'x'.

With no INPUT, or when INPUT is -, read standard input. Output files are created in
the current working directory using PREFIX + suffix (same path rules as other jsh commands).

  -l, --lines=NUMBER  put NUMBER lines per output file (default 1000)
  -b, --bytes=SIZE    put SIZE bytes per output file (suffix: b=512, k/K=1024, KB=1000, M/MB, …)
  -a, --suffix-length=N   generate suffixes of length N (default 2)
      --additional-suffix=SUFFIX  append SUFFIX after the generated suffix
  -d, --numeric-suffixes  use numeric suffixes (00, 01, …) instead of alphabetic
  -x, --hex-suffixes    use hex suffixes instead of alphabetic
  -h, --help            display this help and exit
      --version         output version information and exit
  --                    end of options

jsh:
  Line mode is the default (1000 lines per chunk unless -l is set). -b and -l are mutually exclusive.
  Piped stdin requires stdin to be supplied (empty pipe works). Symlinks are followed to a regular file.
  Binary files split by newline bytes in line mode; byte mode uses raw file bytes.
  Not implemented vs GNU: -C/--line-bytes, --filter, -n, numeric suffix FROM, verbose, or full SIZE parsing.

Full documentation: <https://www.gnu.org/software/coreutils/split>
`;

/**
 * GNU-style option error for split (exit status 1).
 * @param {string} arg
 * @returns {string}
 */
function splitOptionError(arg) {
  const tryLine = "Try 'split --help' for more information.\n";
  if (arg.startsWith('--') && arg.length > 2) {
    return `split: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `split: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `split: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * Split text into lines, each element is a line segment including its trailing \\n when present.
 * @param {string} text
 * @returns {string[]}
 */
function splitLinesWithSeparators(text) {
  const t = String(text);
  const lines = [];
  let start = 0;
  for (let i = 0; i < t.length; i++) {
    if (t.charCodeAt(i) === 10) {
      lines.push(t.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < t.length) {
    lines.push(t.slice(start));
  }
  return lines;
}

/**
 * Split UTF-8 bytes into lines (newline = 0x0a); each segment includes trailing \\n when present.
 * @param {Uint8Array} u8
 * @returns {Uint8Array[]}
 */
function splitLinesBytes(u8) {
  const lines = [];
  let start = 0;
  for (let i = 0; i < u8.length; i++) {
    if (u8[i] === 0x0a) {
      lines.push(u8.subarray(start, i + 1));
      start = i + 1;
    }
  }
  if (start < u8.length) {
    lines.push(u8.subarray(start));
  }
  return lines;
}

/**
 * @param {number} index
 * @param {number} width
 * @returns {string|null}
 */
function splitAlphabeticSuffix(index, width) {
  const w = width > 0 ? width : 2;
  let n = index;
  const chars = new Array(w);
  for (let i = w - 1; i >= 0; i--) {
    chars[i] = String.fromCharCode(97 + (n % 26));
    n = Math.floor(n / 26);
  }
  if (n > 0) {
    return null;
  }
  return chars.join('');
}

/**
 * @param {number} index
 * @param {'digit'|'hex'} mode
 * @param {number} width
 * @returns {string|null}
 */
function splitNumericOrHexSuffix(index, mode, width) {
  const w = width > 0 ? width : 2;
  const base = mode === 'hex' ? 16 : 10;
  const max = Math.pow(base, w);
  if (index < 0 || index >= max) {
    return null;
  }
  const s = index.toString(base);
  return s.padStart(w, '0');
}

/**
 * @param {number} index
 * @param {{ suffixMode: 'alpha'|'digit'|'hex', suffixWidth: number }} cfg
 * @returns {string|null}
 */
function splitGenerateSuffix(index, cfg) {
  const { suffixMode, suffixWidth } = cfg;
  if (suffixMode === 'alpha') {
    return splitAlphabeticSuffix(index, suffixWidth);
  }
  return splitNumericOrHexSuffix(index, suffixMode === 'hex' ? 'hex' : 'digit', suffixWidth);
}

/**
 * Max output file index (inclusive) for suffix config.
 * @param {{ suffixMode: 'alpha'|'digit'|'hex', suffixWidth: number }} cfg
 * @returns {number}
 */
function splitMaxSuffixIndex(cfg) {
  const w = cfg.suffixWidth > 0 ? cfg.suffixWidth : 2;
  if (cfg.suffixMode === 'alpha') {
    return Math.pow(26, w) - 1;
  }
  if (cfg.suffixMode === 'hex') {
    return Math.pow(16, w) - 1;
  }
  return Math.pow(10, w) - 1;
}

/**
 * Parse GNU-style SIZE for **split -b** (subset: digits + b/k/K/M/G/T + KB/MB decimal SI).
 * @param {string} raw
 * @returns {{ ok: true, bytes: number } | { ok: false, stderr: string, exitCode: number }}
 */
function parseSplitByteSize(raw) {
  const s = String(raw).trim();
  if (!s) {
    return {
      ok: false,
      stderr: `split: invalid byte count: '${raw}'\nTry 'split --help' for more information.\n`,
      exitCode: 1
    };
  }
  const m = /^(\d+)([a-zA-Z]*)$/.exec(s);
  if (!m) {
    return {
      ok: false,
      stderr: `split: invalid byte count: '${s}'\nTry 'split --help' for more information.\n`,
      exitCode: 1
    };
  }
  let n = parseInt(m[1], 10);
  const suf = m[2] || '';
  if (!suf) {
    if (n < 1) {
      return {
        ok: false,
        stderr: `split: invalid byte count: '${s}'\nTry 'split --help' for more information.\n`,
        exitCode: 1
      };
    }
    return { ok: true, bytes: n };
  }
  const sl = suf.toLowerCase();
  if (suf.length === 1 && sl === 'b') {
    n *= 512;
  } else if (sl === 'k' || sl === 'kb' || sl === 'kib') {
    n *= 1024;
  } else if (sl === 'm' || sl === 'mb' || sl === 'mib') {
    n *= 1024 * 1024;
  } else if (sl === 'g' || sl === 'gb' || sl === 'gib') {
    n *= 1024 * 1024 * 1024;
  } else if (sl === 't' || sl === 'tb' || sl === 'tib') {
    n *= Math.pow(1024, 4);
  } else if (sl === 'p' || sl === 'pb' || sl === 'pib') {
    n *= Math.pow(1024, 5);
  } else if (sl === 'e' || sl === 'eb' || sl === 'eib') {
    n *= Math.pow(1024, 6);
  } else if (suf === 'KB' || suf === 'kB') {
    n *= 1000;
  } else if (suf === 'MB' || suf === 'mB') {
    n *= 1000 * 1000;
  } else if (suf === 'GB' || suf === 'gB') {
    n *= 1000 * 1000 * 1000;
  } else {
    return {
      ok: false,
      stderr: `split: invalid byte count: '${s}'\nTry 'split --help' for more information.\n`,
      exitCode: 1
    };
  }
  if (n < 1 || !Number.isFinite(n)) {
    return {
      ok: false,
      stderr: `split: invalid byte count: '${s}'\nTry 'split --help' for more information.\n`,
      exitCode: 1
    };
  }
  return { ok: true, bytes: n };
}

/**
 * Parse jsh `split` argv (GNU subset).
 *
 * @param {string[]} args
 * @returns {{ ok: true, byteMode: boolean, linesPerChunk: number, bytesPerChunk: number, suffixWidth: number, additionalSuffix: string, suffixMode: 'alpha'|'digit'|'hex', operands: string[], help?: true, version?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseSplitArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  let byteMode = false;
  let linesPerChunk = 1000;
  let bytesPerChunk = 0;
  let suffixWidth = 2;
  let additionalSuffix = '';
  /** @type {'alpha'|'digit'|'hex'} */
  let suffixMode = 'alpha';
  let linesOptionSeen = false;
  let bytesOptionSeen = false;
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
        byteMode,
        linesPerChunk,
        bytesPerChunk,
        suffixWidth,
        additionalSuffix,
        suffixMode,
        operands: [],
        help: true
      };
    }
    if (arg === '--version') {
      return {
        ok: true,
        byteMode,
        linesPerChunk,
        bytesPerChunk,
        suffixWidth,
        additionalSuffix,
        suffixMode,
        operands: [],
        version: true
      };
    }
    if (arg === '-l' || arg === '--lines') {
      const v = argsArr[++i];
      if (v == null) {
        return {
          ok: false,
          stderr: `split: option requires an argument -- 'lines'\nTry 'split --help' for more information.\n`,
          exitCode: 1
        };
      }
      if (!/^\d+$/.test(v)) {
        return {
          ok: false,
          stderr: `split: invalid number of lines: '${v}'\nTry 'split --help' for more information.\n`,
          exitCode: 1
        };
      }
      const n = parseInt(v, 10);
      if (n < 1) {
        return {
          ok: false,
          stderr: `split: invalid number of lines: '${v}'\nTry 'split --help' for more information.\n`,
          exitCode: 1
        };
      }
      linesPerChunk = n;
      linesOptionSeen = true;
      byteMode = false;
      i++;
      continue;
    }
    if (arg.startsWith('--lines=')) {
      const v = arg.slice('--lines='.length);
      if (!/^\d+$/.test(v)) {
        return {
          ok: false,
          stderr: `split: invalid number of lines: '${v}'\nTry 'split --help' for more information.\n`,
          exitCode: 1
        };
      }
      const n = parseInt(v, 10);
      if (n < 1) {
        return {
          ok: false,
          stderr: `split: invalid number of lines: '${v}'\nTry 'split --help' for more information.\n`,
          exitCode: 1
        };
      }
      linesPerChunk = n;
      linesOptionSeen = true;
      byteMode = false;
      i++;
      continue;
    }
    if (arg === '-b' || arg === '--bytes') {
      const v = argsArr[++i];
      if (v == null) {
        return {
          ok: false,
          stderr: `split: option requires an argument -- 'bytes'\nTry 'split --help' for more information.\n`,
          exitCode: 1
        };
      }
      const p = parseSplitByteSize(v);
      if (p.ok === false) {
        return p;
      }
      bytesPerChunk = p.bytes;
      bytesOptionSeen = true;
      byteMode = true;
      i++;
      continue;
    }
    if (arg.startsWith('--bytes=')) {
      const v = arg.slice('--bytes='.length);
      const p = parseSplitByteSize(v);
      if (p.ok === false) {
        return p;
      }
      bytesPerChunk = p.bytes;
      bytesOptionSeen = true;
      byteMode = true;
      i++;
      continue;
    }
    if (arg === '-a' || arg === '--suffix-length') {
      const v = argsArr[++i];
      if (v == null) {
        return {
          ok: false,
          stderr: `split: option requires an argument -- 'suffix-length'\nTry 'split --help' for more information.\n`,
          exitCode: 1
        };
      }
      if (!/^\d+$/.test(v)) {
        return {
          ok: false,
          stderr: `split: invalid suffix length: '${v}'\nTry 'split --help' for more information.\n`,
          exitCode: 1
        };
      }
      const n = parseInt(v, 10);
      if (n < 1 || n > 64) {
        return {
          ok: false,
          stderr: `split: invalid suffix length: '${v}'\nTry 'split --help' for more information.\n`,
          exitCode: 1
        };
      }
      suffixWidth = n;
      i++;
      continue;
    }
    if (arg.startsWith('--suffix-length=')) {
      const v = arg.slice('--suffix-length='.length);
      if (!/^\d+$/.test(v)) {
        return {
          ok: false,
          stderr: `split: invalid suffix length: '${v}'\nTry 'split --help' for more information.\n`,
          exitCode: 1
        };
      }
      const n = parseInt(v, 10);
      if (n < 1 || n > 64) {
        return {
          ok: false,
          stderr: `split: invalid suffix length: '${v}'\nTry 'split --help' for more information.\n`,
          exitCode: 1
        };
      }
      suffixWidth = n;
      i++;
      continue;
    }
    if (arg.startsWith('--additional-suffix=')) {
      additionalSuffix = arg.slice('--additional-suffix='.length);
      i++;
      continue;
    }
    if (arg === '--additional-suffix') {
      const v = argsArr[++i];
      if (v == null) {
        return {
          ok: false,
          stderr: `split: option '--additional-suffix' requires an argument\nTry 'split --help' for more information.\n`,
          exitCode: 1
        };
      }
      additionalSuffix = v;
      i++;
      continue;
    }
    if (arg === '-d' || arg === '--numeric-suffixes') {
      suffixMode = 'digit';
      i++;
      continue;
    }
    if (arg === '-x' || arg === '--hex-suffixes') {
      suffixMode = 'hex';
      i++;
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1 && !arg.startsWith('--')) {
      let j = 1;
      while (j < arg.length) {
        const c = arg[j];
        if (c === 'l') {
          const rest = arg.slice(j + 1);
          if (rest.length >= 1 && /^\d+$/.test(rest)) {
            const n = parseInt(rest, 10);
            if (n < 1) {
              return {
                ok: false,
                stderr: `split: invalid number of lines: '${rest}'\nTry 'split --help' for more information.\n`,
                exitCode: 1
              };
            }
            linesPerChunk = n;
            linesOptionSeen = true;
            byteMode = false;
            j = arg.length;
            break;
          }
          const next = argsArr[i + 1];
          if (next == null) {
            return {
              ok: false,
              stderr: `split: option requires an argument -- 'l'\nTry 'split --help' for more information.\n`,
              exitCode: 1
            };
          }
          if (!/^\d+$/.test(next)) {
            return {
              ok: false,
              stderr: `split: invalid number of lines: '${next}'\nTry 'split --help' for more information.\n`,
              exitCode: 1
            };
          }
          const n = parseInt(next, 10);
          if (n < 1) {
            return {
              ok: false,
              stderr: `split: invalid number of lines: '${next}'\nTry 'split --help' for more information.\n`,
              exitCode: 1
            };
          }
          linesPerChunk = n;
          linesOptionSeen = true;
          byteMode = false;
          i++;
          j = arg.length;
          break;
        }
        if (c === 'b') {
          const rest = arg.slice(j + 1);
          if (rest.length >= 1) {
            const p = parseSplitByteSize(rest);
            if (p.ok === false) {
              return p;
            }
            bytesPerChunk = p.bytes;
            bytesOptionSeen = true;
            byteMode = true;
            j = arg.length;
            break;
          }
          const next = argsArr[i + 1];
          if (next == null) {
            return {
              ok: false,
              stderr: `split: option requires an argument -- 'b'\nTry 'split --help' for more information.\n`,
              exitCode: 1
            };
          }
          const p = parseSplitByteSize(next);
          if (p.ok === false) {
            return p;
          }
          bytesPerChunk = p.bytes;
          bytesOptionSeen = true;
          byteMode = true;
          i++;
          j = arg.length;
          break;
        }
        if (c === 'a') {
          const rest = arg.slice(j + 1);
          if (rest.length >= 1 && /^\d+$/.test(rest)) {
            const n = parseInt(rest, 10);
            if (n < 1 || n > 64) {
              return {
                ok: false,
                stderr: `split: invalid suffix length: '${rest}'\nTry 'split --help' for more information.\n`,
                exitCode: 1
              };
            }
            suffixWidth = n;
            j = arg.length;
            break;
          }
          const next = argsArr[i + 1];
          if (next == null) {
            return {
              ok: false,
              stderr: `split: option requires an argument -- 'a'\nTry 'split --help' for more information.\n`,
              exitCode: 1
            };
          }
          if (!/^\d+$/.test(next)) {
            return {
              ok: false,
              stderr: `split: invalid suffix length: '${next}'\nTry 'split --help' for more information.\n`,
              exitCode: 1
            };
          }
          const n = parseInt(next, 10);
          if (n < 1 || n > 64) {
            return {
              ok: false,
              stderr: `split: invalid suffix length: '${next}'\nTry 'split --help' for more information.\n`,
              exitCode: 1
            };
          }
          suffixWidth = n;
          i++;
          j = arg.length;
          break;
        }
        if (c === 'd') {
          suffixMode = 'digit';
          j++;
          continue;
        }
        if (c === 'x') {
          suffixMode = 'hex';
          j++;
          continue;
        }
        return { ok: false, stderr: splitOptionError(`-${c}`), exitCode: 1 };
      }
      i++;
      continue;
    }
    if (arg.startsWith('--') && arg.length > 2) {
      return { ok: false, stderr: splitOptionError(arg), exitCode: 1 };
    }
    break;
  }
  const operands = argsArr.slice(i);
  if (linesOptionSeen && bytesOptionSeen) {
    return {
      ok: false,
      stderr: `split: cannot split in more than one way\nTry 'split --help' for more information.\n`,
      exitCode: 1
    };
  }
  return {
    ok: true,
    byteMode,
    linesPerChunk,
    bytesPerChunk,
    suffixWidth,
    additionalSuffix,
    suffixMode,
    operands
  };
}

const SplitLib = {
  SPLIT_VERSION_LINE,
  SPLIT_HELP,
  splitOptionError,
  splitLinesWithSeparators,
  splitLinesBytes,
  splitAlphabeticSuffix,
  splitNumericOrHexSuffix,
  splitGenerateSuffix,
  splitMaxSuffixIndex,
  parseSplitByteSize,
  parseSplitArgv
};
if (typeof globalThis !== 'undefined') { /** @type {*} */ (globalThis).SplitLib = SplitLib; }
if (typeof module !== 'undefined' && module.exports) { module.exports = SplitLib; }

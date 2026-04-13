const SEQ_HELP = `Usage: seq [OPTION]... LAST
  or:  seq [OPTION]... FIRST LAST
  or:  seq [OPTION]... FIRST INCREMENT LAST

Print a sequence of numbers to standard output.

  -s, --separator=STRING   use STRING to separate numbers (default: newline)
  -w, --equal-width          equalize width with leading zeros (GNU-like; see jsh notes)
  -h, --help                 display this help and exit
      --version              output version information and exit
      --                     end of options

jsh:
  **LAST** only: **FIRST** is **1**; **INCREMENT** is **1** or **-1** by range direction (GNU-style).
  **FIRST LAST**: **INCREMENT** is **1** or **-1** by direction. **FIRST INCREMENT LAST** rejects
  a zero increment (**exit 1**). At most **1000000** values per run.
  Not implemented vs GNU: **-f** / **--format**, **-t** / **--terminator**.

Full documentation: <https://www.gnu.org/software/coreutils/manual/html_node/seq-invocation.html>
`;

const SEQ_VERSION_LINE = 'seq (jsh Heyming Terminal) 1.0\n';

/** Maximum sequence length (inclusive) for jsh \`seq\`. */
const SEQ_MAX_VALUES = 1_000_000;

/**
 * GNU-style option error for seq (exit status 2).
 * @param {string} arg
 * @returns {string}
 */
function seqOptionError(arg) {
  const tryLine = "Try 'seq --help' for more information.\n";
  if (arg.startsWith('--') && arg.length > 2) {
    return `seq: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `seq: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `seq: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * @param {string} s
 * @returns {{ ok: true, value: number } | { ok: false }}
 */
function parseSeqNum(s) {
  const t = String(s).trim();
  if (t === '') {
    return { ok: false };
  }
  const n = Number(t);
  if (!Number.isFinite(n)) {
    return { ok: false };
  }
  return { ok: true, value: n };
}

/**
 * @param {number} first
 * @param {number} incr
 * @param {number} last
 * @returns {{ ok: true, values: number[] } | { ok: false, stderr: string, exitCode: number }}
 */
function genSeqSequence(first, incr, last) {
  if (incr === 0) {
    return { ok: false, stderr: 'seq: zero increment\n', exitCode: 1 };
  }
  const out = [];
  for (let n = 0; ; n++) {
    if (n >= SEQ_MAX_VALUES) {
      return { ok: false, stderr: 'seq: result too large\n', exitCode: 1 };
    }
    const x = first + n * incr;
    if (incr > 0 && x > last) {
      break;
    }
    if (incr < 0 && x < last) {
      break;
    }
    out.push(x);
  }
  return { ok: true, values: out };
}

/**
 * @param {number[]} values
 * @param {string} separator
 * @param {boolean} equalWidth
 * @returns {string}
 */
function formatSeqOutput(values, separator, equalWidth) {
  if (values.length === 0) {
    return '';
  }
  let strs = values.map((v) => String(v));
  if (equalWidth) {
    const w = Math.max(...strs.map((s) => s.length));
    strs = strs.map((s) => {
      if (s.startsWith('-')) {
        const rest = s.slice(1);
        return `-${rest.padStart(Math.max(0, w - 1), '0')}`;
      }
      return s.padStart(w, '0');
    });
  }
  return strs.join(separator) + '\n';
}

/**
 * Parse jsh `seq` argv: -s, -w, --help/--version/--, GNU-style operands.
 *
 * @param {string[]} args
 * @returns {{ ok: true, first: number, incr: number, last: number, separator: string, equalWidth: boolean, help?: true, version?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseSeqArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  let separator = '\n';
  let equalWidth = false;
  let i = 0;
  while (i < argsArr.length) {
    const a = argsArr[i];
    if (a === '--') {
      i++;
      break;
    }
    if (a === '--help' || a === '-h') {
      return { ok: true, first: 1, incr: 1, last: 1, separator, equalWidth, help: true };
    }
    if (a === '--version') {
      return { ok: true, first: 1, incr: 1, last: 1, separator, equalWidth, version: true };
    }
    if (a === '-w' || a === '--equal-width') {
      equalWidth = true;
      i++;
      continue;
    }
    if (a === '-s') {
      const sep = argsArr[i + 1];
      if (sep === undefined) {
        return {
          ok: false,
          stderr: `seq: option requires an argument -- 's'\n`,
          exitCode: 2
        };
      }
      separator = sep;
      i += 2;
      continue;
    }
    if (a.startsWith('--separator=')) {
      separator = a.slice('--separator='.length);
      i++;
      continue;
    }
    if (a === '--separator') {
      const sep = argsArr[i + 1];
      if (sep === undefined) {
        return {
          ok: false,
          stderr: `seq: option requires an argument -- 'separator'\n`,
          exitCode: 2
        };
      }
      separator = sep;
      i += 2;
      continue;
    }
    const asNum = parseSeqNum(a);
    if (asNum.ok) {
      break;
    }
    if (a.startsWith('-') && a.length > 1) {
      return { ok: false, stderr: seqOptionError(a), exitCode: 2 };
    }
    break;
  }
  const operands = argsArr.slice(i);
  if (operands.length === 0) {
    return { ok: false, stderr: 'seq: missing operand\n', exitCode: 1 };
  }
  if (operands.length > 3) {
    return {
      ok: false,
      stderr: `seq: extra operand '${operands[3]}'\nTry 'seq --help' for more information.\n`,
      exitCode: 1
    };
  }
  const numbers = [];
  for (const op of operands) {
    const p = parseSeqNum(op);
    if (p.ok === false) {
      return {
        ok: false,
        stderr: `seq: invalid floating point argument: '${op}'\n`,
        exitCode: 1
      };
    }
    numbers.push(p.value);
  }
  let first;
  let incr;
  let last;
  if (numbers.length === 1) {
    last = numbers[0];
    first = 1;
    incr = last >= first ? 1 : -1;
  } else if (numbers.length === 2) {
    first = numbers[0];
    last = numbers[1];
    incr = first <= last ? 1 : -1;
  } else {
    first = numbers[0];
    incr = numbers[1];
    last = numbers[2];
  }
  return { ok: true, first, incr, last, separator, equalWidth };
}

export const SeqLib = {
  SEQ_HELP,
  SEQ_VERSION_LINE,
  SEQ_MAX_VALUES,
  seqOptionError,
  parseSeqNum,
  genSeqSequence,
  formatSeqOutput,
  parseSeqArgv
};

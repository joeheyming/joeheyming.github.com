'use strict';

const BASENAME_HELP = `Usage: basename NAME [SUFFIX]
  or:  basename OPTION... NAME...

Print NAME with any leading directory components removed.
If specified, also remove a trailing SUFFIX.

  -a, --multiple       support more than one NAME argument
  -s, --suffix=SUFFIX  remove a trailing SUFFIX (replaces optional SUFFIX operand)
  -z, --zero            end each output line with NUL, not newline
      --help            display this help and exit
      --version         output version information and exit

jsh: \`-h\` is an alias for \`--help\`. Paths are resolved against the virtual cwd (see \`pwd\`).

Full documentation: <https://www.gnu.org/software/coreutils/manual/html_node/basename-invocation.html>
`;

const BASENAME_VERSION_LINE = 'basename (jsh Heyming Terminal) 1.0\n';

function basenameStripTrailingSlashes(p) {
  if (!p || p === '/') return p;
  return p.replace(/\/+$/, '') || '/';
}

/**
 * GNU-style basename: strip trailing slashes, last path component, optional suffix.
 * @param {string} path
 * @param {string|null|undefined} suffix
 * @returns {string}
 */
function basenameCompute(path, suffix) {
  const s = basenameStripTrailingSlashes(path);
  if (!s) return '';
  if (s === '/') return '/';
  const i = s.lastIndexOf('/');
  let name = i === -1 ? s : s.slice(i + 1);
  if (name === '') name = '/';
  if (suffix != null && suffix !== '' && name.endsWith(suffix)) {
    name = name.slice(0, -suffix.length);
  }
  return name;
}

function basenameTryLine() {
  return "Try 'basename --help' for more information.\n";
}

/**
 * Parse GNU-style basename argv.
 * @param {string[]} args
 * @returns {{ ok: true, names: string[], suffix: string|null, zero: boolean, help?: true, version?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseBasenameArgv(args) {
  const prog = 'basename';
  const argsArr = Array.isArray(args) ? args : [];
  let i = 0;
  let suffixFromOpt = null;
  let zero = false;
  let sawHelp = false;
  let sawVersion = false;
  let multiple = false;

  while (i < argsArr.length) {
    const a = argsArr[i];
    if (a === '--') {
      i++;
      break;
    }
    if (a === '--help' || a === '-h') {
      sawHelp = true;
      i++;
      continue;
    }
    if (a === '--version') {
      sawVersion = true;
      i++;
      continue;
    }
    if (a === '-a' || a === '--multiple') {
      multiple = true;
      i++;
      continue;
    }
    if (a === '-z' || a === '--zero') {
      zero = true;
      i++;
      continue;
    }
    if (a.startsWith('--suffix=')) {
      const v = a.slice('--suffix='.length);
      if (v === '') {
        return {
          ok: false,
          stderr: `${prog}: option '--suffix' requires an argument\n${basenameTryLine()}`,
          exitCode: 2
        };
      }
      suffixFromOpt = v;
      i++;
      continue;
    }
    if (a === '-s') {
      const next = argsArr[i + 1];
      if (next == null) {
        return {
          ok: false,
          stderr: `${prog}: option '-s' requires an argument\n${basenameTryLine()}`,
          exitCode: 2
        };
      }
      suffixFromOpt = next;
      i += 2;
      continue;
    }
    if (a.startsWith('-s') && a.length > 2) {
      suffixFromOpt = a.slice(2);
      i++;
      continue;
    }
    if (a === '-') {
      break;
    }
    if (a.startsWith('-')) {
      if (a.startsWith('--') && a.length > 2) {
        return {
          ok: false,
          stderr: `${prog}: unrecognized option '${a}'\n${basenameTryLine()}`,
          exitCode: 2
        };
      }
      if (a.length === 2) {
        return {
          ok: false,
          stderr: `${prog}: invalid option -- '${a[1]}'\n${basenameTryLine()}`,
          exitCode: 2
        };
      }
      return {
        ok: false,
        stderr: `${prog}: unrecognized option '${a}'\n${basenameTryLine()}`,
        exitCode: 2
      };
    }
    break;
  }

  if (sawHelp) {
    return { ok: true, names: [], suffix: '', zero: false, help: true };
  }
  if (sawVersion) {
    return { ok: true, names: [], suffix: '', zero: false, version: true };
  }

  const operands = argsArr.slice(i);
  if (multiple) {
    if (operands.length === 0) {
      return { ok: false, stderr: `${prog}: missing operand\n`, exitCode: 1 };
    }
    return { ok: true, names: operands, suffix: suffixFromOpt, zero };
  }

  if (operands.length === 0) {
    return { ok: false, stderr: `${prog}: missing operand\n`, exitCode: 1 };
  }

  if (suffixFromOpt != null) {
    if (operands.length > 1) {
      const extra = operands[1];
      return {
        ok: false,
        stderr: `${prog}: extra operand '${extra}'\n${basenameTryLine()}`,
        exitCode: 1
      };
    }
    return { ok: true, names: [operands[0]], suffix: suffixFromOpt, zero };
  }

  if (operands.length === 1) {
    return { ok: true, names: [operands[0]], suffix: null, zero };
  }
  if (operands.length === 2) {
    return { ok: true, names: [operands[0]], suffix: operands[1], zero };
  }
  const extra = operands[2];
  return {
    ok: false,
    stderr: `${prog}: extra operand '${extra}'\n${basenameTryLine()}`,
    exitCode: 1
  };
}

const DIRNAME_HELP = `Usage: dirname [OPTION] NAME...
  -z, --zero            end each output line with NUL, not newline
      --help            display this help and exit
      --version         output version information and exit

jsh: \`-h\` is an alias for \`--help\`. Paths are resolved against the virtual cwd (see \`pwd\`).

Full documentation: <https://www.gnu.org/software/coreutils/manual/html_node/dirname-invocation.html>
`;

const DIRNAME_VERSION_LINE = 'dirname (jsh Heyming Terminal) 1.0\n';

function dirnameTryLine() {
  return "Try 'dirname --help' for more information.\n";
}

/**
 * GNU-style option error for dirname.
 * @param {string} arg
 * @returns {string}
 */
function dirnameOptionError(arg) {
  const tryLine = dirnameTryLine();
  if (arg.startsWith('--') && arg.length > 2) {
    return `dirname: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `dirname: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `dirname: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * POSIX/GNU dirname: parent path of NAME (last non-slash component removed).
 * @param {string} path
 * @returns {string}
 */
function dirnameCompute(path) {
  if (path == null || path === '') return '.';
  let s = path.replace(/\/+$/, '');
  if (s === '') return '/';
  const i = s.lastIndexOf('/');
  if (i === -1) return '.';
  if (i === 0) return '/';
  return s.slice(0, i) || '/';
}

/**
 * Parse GNU-style dirname argv.
 * @param {string[]} args
 * @returns {{ ok: true, names: string[], zero: boolean, help?: true, version?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseDirnameArgv(args) {
  const prog = 'dirname';
  const argsArr = Array.isArray(args) ? args : [];
  let i = 0;
  let zero = false;
  let sawHelp = false;
  let sawVersion = false;

  while (i < argsArr.length) {
    const a = argsArr[i];
    if (a === '--') {
      i++;
      break;
    }
    if (a === '--help' || a === '-h') {
      sawHelp = true;
      i++;
      continue;
    }
    if (a === '--version') {
      sawVersion = true;
      i++;
      continue;
    }
    if (a === '-z' || a === '--zero') {
      zero = true;
      i++;
      continue;
    }
    if (a.startsWith('-')) {
      return { ok: false, stderr: dirnameOptionError(a), exitCode: 2 };
    }
    break;
  }

  if (sawHelp) {
    return { ok: true, names: [], zero: false, help: true };
  }
  if (sawVersion) {
    return { ok: true, names: [], zero: false, version: true };
  }

  const operands = argsArr.slice(i);
  if (operands.length === 0) {
    return { ok: false, stderr: `${prog}: missing operand\n`, exitCode: 1 };
  }
  return { ok: true, names: operands, zero };
}

const BasenameLib = {
  BASENAME_HELP,
  BASENAME_VERSION_LINE,
  basenameCompute,
  parseBasenameArgv,
  DIRNAME_HELP,
  DIRNAME_VERSION_LINE,
  dirnameCompute,
  parseDirnameArgv
};
if (typeof globalThis !== 'undefined') {
  /** @type {*} */ (globalThis).BasenameLib = BasenameLib;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = BasenameLib;
}

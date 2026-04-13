'use strict';

const CP_HELP = `Usage: cp [OPTION]... SOURCE DEST
Copy SOURCE to DEST.

  -r, -R, --recursive    copy directories recursively
  -h, --help             display this help and exit

jsh:
  Two operands only (no DIRECTORY multi-source form). Use -- before paths
  that start with '-'.

Full documentation: <https://www.gnu.org/software/coreutils/manual/html_node/cp-invocation.html>
`;

const MV_HELP = `Usage: mv [OPTION]... SOURCE DEST
Rename SOURCE to DEST, or move SOURCE to DEST.

  -f, --force            ignored (jsh does not overwrite existing DEST)
  -i, --interactive      ignored
  -n, --no-clobber       ignored
  -v, --verbose          ignored
  -h, --help             display this help and exit

jsh:
  Two operands only. Use -- before paths that start with '-'.

Full documentation: <https://www.gnu.org/software/coreutils/manual/html_node/mv-invocation.html>
`;

/**
 * GNU-style option error for cp.
 * @param {string} arg
 * @returns {string}
 */
function cpOptionError(arg) {
  const tryLine = "Try 'cp --help' for more information.\n";
  if (arg.startsWith('--') && arg.length > 2) {
    return `cp: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `cp: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `cp: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * GNU-style option error for mv.
 * @param {string} arg
 * @returns {string}
 */
function mvOptionError(arg) {
  const tryLine = "Try 'mv --help' for more information.\n";
  if (arg.startsWith('--') && arg.length > 2) {
    return `mv: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `mv: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `mv: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * Parse jsh `cp` argv: -r/-R/--recursive, -h/--help, --, operands (two-operand handler).
 *
 * @param {string[]} args
 * @returns {{ ok: true, recursive: boolean, operands: string[], help?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseCpArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  let recursive = false;
  const operands = [];
  let i = 0;
  while (i < argsArr.length) {
    const arg = argsArr[i];
    if (arg === '--help' || arg === '-h') {
      return { ok: true, help: true, recursive, operands: [] };
    }
    if (arg === '--') {
      operands.push(...argsArr.slice(i + 1));
      break;
    }
    if (arg === '--recursive') {
      recursive = true;
      i++;
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1 && !arg.startsWith('--')) {
      for (let j = 1; j < arg.length; j++) {
        const c = arg[j];
        if (c === 'r' || c === 'R') {
          recursive = true;
        } else {
          return { ok: false, stderr: cpOptionError(`-${c}`), exitCode: 1 };
        }
      }
      i++;
      continue;
    }
    if (arg.startsWith('--') && arg.length > 2) {
      return { ok: false, stderr: cpOptionError(arg), exitCode: 1 };
    }
    operands.push(arg, ...argsArr.slice(i + 1));
    break;
  }
  return { ok: true, recursive, operands };
}

/**
 * Parse jsh `mv` argv: GNU-ish no-op flags, -h/--help, --, operands (two-operand handler).
 *
 * @param {string[]} args
 * @returns {{ ok: true, operands: string[], help?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseMvArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  const operands = [];
  let i = 0;
  while (i < argsArr.length) {
    const arg = argsArr[i];
    if (arg === '--help' || arg === '-h') {
      return { ok: true, help: true, operands: [] };
    }
    if (arg === '--') {
      operands.push(...argsArr.slice(i + 1));
      break;
    }
    if (
      arg === '--force' ||
      arg === '-f' ||
      arg === '--interactive' ||
      arg === '-i' ||
      arg === '--no-clobber' ||
      arg === '-n' ||
      arg === '--verbose' ||
      arg === '-v'
    ) {
      i++;
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1 && !arg.startsWith('--')) {
      for (let j = 1; j < arg.length; j++) {
        const c = arg[j];
        if (c === 'f' || c === 'i' || c === 'n' || c === 'v') {
          /* GNU no-ops in jsh */
        } else {
          return { ok: false, stderr: mvOptionError(`-${c}`), exitCode: 1 };
        }
      }
      i++;
      continue;
    }
    if (arg.startsWith('--') && arg.length > 2) {
      return { ok: false, stderr: mvOptionError(arg), exitCode: 1 };
    }
    operands.push(arg, ...argsArr.slice(i + 1));
    break;
  }
  return { ok: true, operands };
}

const RM_HELP = `Usage: rm [OPTION]... [FILE]...
Remove (unlink) the FILE(s).

  -f, --force           ignore nonexistent files and arguments, never prompt
  -i, --interactive     prompt before every removal (ignored in jsh)
  -I                    prompt once when removing many files (ignored in jsh)
  -r, -R, --recursive   remove directories and their contents recursively
  -d, --dir             remove empty directories (ignored in jsh; use -r for trees)
  -v, --verbose         explain what is being done (ignored in jsh)
  -h, --help             display this help and exit

jsh:
  No interactive prompts; -i/-I/-v are accepted as no-ops. Use -- before paths
  that start with '-'.

Full documentation: <https://www.gnu.org/software/coreutils/manual/html_node/rm-invocation.html>
`;

/**
 * GNU-style option error for rm.
 * @param {string} arg
 * @returns {string}
 */
function rmOptionError(arg) {
  const tryLine = "Try 'rm --help' for more information.\n";
  if (arg.startsWith('--') && arg.length > 2) {
    return `rm: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `rm: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `rm: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * Parse jsh `rm` argv: -f/-r/-R, GNU no-op flags, -h/--help, --, operands.
 *
 * @param {string[]} args
 * @returns {{ ok: true, recursive: boolean, force: boolean, operands: string[], help?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseRmArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  let recursive = false;
  let force = false;
  const operands = [];
  let i = 0;
  while (i < argsArr.length) {
    const arg = argsArr[i];
    if (arg === '--help' || arg === '-h') {
      return { ok: true, help: true, recursive, force, operands: [] };
    }
    if (arg === '--') {
      operands.push(...argsArr.slice(i + 1));
      break;
    }
    if (arg === '--recursive') {
      recursive = true;
      i++;
      continue;
    }
    if (arg === '--force') {
      force = true;
      i++;
      continue;
    }
    if (arg === '--verbose') {
      i++;
      continue;
    }
    if (arg === '--dir') {
      i++;
      continue;
    }
    if (arg === '--interactive') {
      i++;
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1 && !arg.startsWith('--')) {
      for (let j = 1; j < arg.length; j++) {
        const c = arg[j];
        if (c === 'r' || c === 'R') {
          recursive = true;
        } else if (c === 'f') {
          force = true;
        } else if (c === 'i' || c === 'I' || c === 'v' || c === 'd') {
          /* GNU no-ops in jsh */
        } else {
          return { ok: false, stderr: rmOptionError(`-${c}`), exitCode: 1 };
        }
      }
      i++;
      continue;
    }
    if (arg.startsWith('--') && arg.length > 2) {
      return { ok: false, stderr: rmOptionError(arg), exitCode: 1 };
    }
    operands.push(arg, ...argsArr.slice(i + 1));
    break;
  }
  return { ok: true, recursive, force, operands };
}

const RMDIR_HELP = `Usage: rmdir [OPTION]... DIRECTORY...
Remove the DIRECTORY(ies), if they are empty.

  -p, --parents       remove DIRECTORY, then each non-root parent directory
                      component as long as each is empty
  -v, --verbose       no-op (accepted for GNU compatibility)
  -h, --help          display this help and exit

jsh:
  Operands are resolved like other file commands; symlinks are not dereferenced
  (removing a symlink path is not supported — use rm).

Full documentation: <https://www.gnu.org/software/coreutils/manual/html_node/rmdir-invocation.html>
`;

/**
 * GNU-style option error for rmdir.
 * @param {string} arg
 * @returns {string}
 */
function rmdirOptionError(arg) {
  const tryLine = "Try 'rmdir --help' for more information.\n";
  if (arg.startsWith('--') && arg.length > 2) {
    return `rmdir: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `rmdir: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `rmdir: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * Parse jsh `rmdir` argv: -p/--parents, -v/--verbose (no-op), -h/--help, --, operands.
 *
 * @param {string[]} args
 * @returns {{ ok: true, parents: boolean, operands: string[], help?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseRmdirArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  let parents = false;
  const operands = [];
  let i = 0;
  while (i < argsArr.length) {
    const arg = argsArr[i];
    if (arg === '--help' || arg === '-h') {
      return { ok: true, help: true, parents, operands: [] };
    }
    if (arg === '--') {
      operands.push(...argsArr.slice(i + 1));
      break;
    }
    if (arg === '--parents') {
      parents = true;
      i++;
      continue;
    }
    if (arg === '--verbose') {
      i++;
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1 && !arg.startsWith('--')) {
      for (let j = 1; j < arg.length; j++) {
        const c = arg[j];
        if (c === 'p') {
          parents = true;
        } else if (c === 'v') {
          /* GNU no-op */
        } else {
          return { ok: false, stderr: rmdirOptionError(`-${c}`), exitCode: 1 };
        }
      }
      i++;
      continue;
    }
    if (arg.startsWith('--') && arg.length > 2) {
      return { ok: false, stderr: rmdirOptionError(arg), exitCode: 1 };
    }
    operands.push(arg, ...argsArr.slice(i + 1));
    break;
  }
  return { ok: true, parents, operands };
}

const UNLINK_HELP = `Usage: unlink FILE
Call unlink(2) on FILE: remove one regular file or symlink (same IndexedDB VFS as rm/rmdir).

  -h, --help          display this help and exit

jsh:
  Exactly one FILE operand (GNU-style). Use -- before paths that start with '-'.
  Not implemented vs GNU: --version.

Full documentation: <https://www.gnu.org/software/coreutils/manual/html_node/unlink-invocation.html>
`;

/**
 * GNU-style option error for unlink.
 * @param {string} arg
 * @returns {string}
 */
function unlinkOptionError(arg) {
  const tryLine = "Try 'unlink --help' for more information.\n";
  if (arg.startsWith('--') && arg.length > 2) {
    return `unlink: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `unlink: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `unlink: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * Parse jsh `unlink` argv: -h/--help, --, exactly one FILE operand expected by handler.
 *
 * @param {string[]} args
 * @returns {{ ok: true, operands: string[], help?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseUnlinkArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  const operands = [];
  let i = 0;
  while (i < argsArr.length) {
    const arg = argsArr[i];
    if (arg === '--help' || arg === '-h') {
      return { ok: true, help: true, operands: [] };
    }
    if (arg === '--') {
      operands.push(...argsArr.slice(i + 1));
      break;
    }
    if (arg.startsWith('-') && arg.length > 1 && !arg.startsWith('--')) {
      for (let j = 1; j < arg.length; j++) {
        const c = arg[j];
        if (c === 'h') {
          return { ok: true, help: true, operands: [] };
        }
        return { ok: false, stderr: unlinkOptionError(`-${c}`), exitCode: 1 };
      }
      i++;
      continue;
    }
    if (arg.startsWith('--') && arg.length > 2) {
      return { ok: false, stderr: unlinkOptionError(arg), exitCode: 1 };
    }
    operands.push(arg, ...argsArr.slice(i + 1));
    break;
  }
  return { ok: true, operands };
}

const FileopsLib = {
  CP_HELP,
  cpOptionError,
  parseCpArgv,
  MV_HELP,
  mvOptionError,
  parseMvArgv,
  RM_HELP,
  rmOptionError,
  parseRmArgv,
  RMDIR_HELP,
  rmdirOptionError,
  parseRmdirArgv,
  UNLINK_HELP,
  unlinkOptionError,
  parseUnlinkArgv
};
if (typeof globalThis !== 'undefined') {
  /** @type {*} */ (globalThis).FileopsLib = FileopsLib;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = FileopsLib;
}

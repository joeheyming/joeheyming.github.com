'use strict';

const LN_HELP = `Usage: ln [OPTION]... [-T] TARGET LINK_NAME
  or:    ln [OPTION]... TARGET
Create links. jsh supports symbolic links only (GNU-style subset).

  -s, --symbolic              make symbolic links instead of hard links (required in jsh)
  -f, --force                 remove existing destination files (files/symlinks only)
  -h, --help                  display this help and exit (jsh: -h is alias)
  --                          end of options

jsh:
  With one TARGET after -s, the link is created in the current directory with the same
  basename as TARGET (GNU behavior). Hard links are not implemented; use -s.

  Not implemented vs GNU: hard links, multi-target DIRECTORY form, -L/-P/-n/-r/-t/-T,
  relative prefix options, --verbose, --backup.

Full documentation: <https://www.gnu.org/software/coreutils/ln>
`;

/**
 * GNU-style option error for ln.
 * @param {string} arg
 * @returns {string}
 */
function lnOptionError(arg) {
  const tryLine = `Try 'ln --help' for more information.\n`;
  if (arg.startsWith('--') && arg.length > 2) {
    return `ln: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `ln: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `ln: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * Basename for ln -s TARGET (single-operand form), GNU-style.
 * @param {string} target
 * @returns {string}
 */
function symlinkBasenameForLn(target) {
  const t = String(target).replace(/\/+$/, '');
  const parts = t.split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : t || '.';
}

/**
 * Parse jsh `ln` argv: -s/--symbolic, -f/--force, --, --help/-h; symlink mode only is useful.
 *
 * @param {string[]} args
 * @returns {{ ok: true, help: true } | { ok: true, symbolic: false, operands: string[] } | { ok: true, symbolic: true, force: boolean, target: string, linkName: string | null } | { ok: false, stderr: string, exitCode: number }}
 */
function parseLnArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  let symbolic = false;
  let force = false;
  const operands = [];
  let i = 0;
  while (i < argsArr.length) {
    const arg = argsArr[i];
    if (arg === '--help' || arg === '-h') {
      return { ok: true, help: true };
    }
    if (arg === '--') {
      operands.push(...argsArr.slice(i + 1));
      break;
    }
    if (arg === '-s' || arg === '--symbolic') {
      symbolic = true;
      i++;
      continue;
    }
    if (arg === '-f' || arg === '--force') {
      force = true;
      i++;
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1 && !arg.startsWith('--')) {
      const rest = arg.slice(1);
      for (const c of rest) {
        if (c === 's') symbolic = true;
        else if (c === 'f') force = true;
        else {
          return { ok: false, stderr: lnOptionError(`-${c}`), exitCode: 1 };
        }
      }
      i++;
      continue;
    }
    if (arg.startsWith('--') && arg.length > 2) {
      return { ok: false, stderr: lnOptionError(arg), exitCode: 1 };
    }
    operands.push(arg, ...argsArr.slice(i + 1));
    break;
  }

  if (!symbolic) {
    return { ok: true, symbolic: false, operands };
  }

  if (operands.length === 0) {
    return {
      ok: false,
      stderr: "ln: missing file operand\nTry 'ln --help' for more information.\n",
      exitCode: 1
    };
  }
  if (operands.length === 1) {
    return { ok: true, symbolic: true, force, target: operands[0], linkName: null };
  }
  if (operands.length === 2) {
    return {
      ok: true,
      symbolic: true,
      force,
      target: operands[0],
      linkName: operands[1]
    };
  }
  const extra = operands[2];
  return {
    ok: false,
    stderr: `ln: extra operand '${extra}'\nTry 'ln --help' for more information.\n`,
    exitCode: 1
  };
}

const LnLib = {
  LN_HELP,
  lnOptionError,
  symlinkBasenameForLn,
  parseLnArgv
};
if (typeof globalThis !== 'undefined') {
  /** @type {*} */ (globalThis).LnLib = LnLib;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = LnLib;
}

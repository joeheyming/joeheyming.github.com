'use strict';

const TYPE_HELP = `Usage: type [-a] [--help] [--] name [name ...]
Display how each NAME would be interpreted as a command.

  -a              display all locations containing an executable named NAME
  -h, --help      display this help and exit

jsh:
  Registered commands are shown as "NAME is /bin/NAME" (same path story as which).
  Aliases use bash-style backticks around the replacement text.
  Not implemented vs bash: -t, -p, -P, -f, keywords, functions, hashed paths.
`;

/**
 * GNU-style option error for type.
 * @param {string} arg
 * @returns {string}
 */
function typeOptionError(arg) {
  const tryLine = "Try 'type --help' for more information.\n";
  if (arg.startsWith('--') && arg.length > 2) {
    return `type: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `type: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `type: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * Parse jsh `type` argv (bash-like subset: -a, -h/--help, --).
 *
 * @param {string[]} args
 * @returns {{ ok: true, showAll: boolean, names: string[], help?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseTypeArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  let showAll = false;
  let i = 0;
  for (; i < argsArr.length; i++) {
    const a = argsArr[i];
    if (a === '--') {
      i++;
      break;
    }
    if (a === '--help' || a === '-h') {
      return { ok: true, showAll: false, names: [], help: true };
    }
    if (a === '-a') {
      showAll = true;
      continue;
    }
    if (a.startsWith('-') && a.length > 1) {
      return { ok: false, stderr: typeOptionError(a), exitCode: 2 };
    }
    break;
  }
  const names = argsArr.slice(i).filter((n) => n !== '');
  if (!names.length) {
    const usage = 'type: usage: type [-a] [--] name [name ...]\n';
    return { ok: false, stderr: usage, exitCode: 2 };
  }
  return { ok: true, showAll, names };
}

const WHICH_HELP = `Usage: which [options] [--] name [name ...]
Locate a command in PATH.

  -a, --all         print all matching pathnames (alias line and /bin/NAME when both exist)
  -h, --help        display this help and exit

jsh:
  Registered builtins are listed as /bin/NAME (same path story as type).
  Aliases use "NAME: aliased to REPLACEMENT" (unquoted; not bash \`…\` like type).
  Not implemented vs GNU debianutils which: -s/--skip-alias, -v/--read-alias, external executables in PATH.
`;

/**
 * GNU-style option error for which.
 * @param {string} arg
 * @returns {string}
 */
function whichOptionError(arg) {
  const tryLine = "Try 'which --help' for more information.\n";
  if (arg.startsWith('--') && arg.length > 2) {
    return `which: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `which: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `which: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * Parse jsh `which` argv (GNU-like subset: -a/--all, -h/--help, --).
 *
 * @param {string[]} args
 * @returns {{ ok: true, showAll: boolean, names: string[], help?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseWhichArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  let showAll = false;
  let i = 0;
  for (; i < argsArr.length; i++) {
    const a = argsArr[i];
    if (a === '--') {
      i++;
      break;
    }
    if (a === '--help' || a === '-h') {
      return { ok: true, showAll: false, names: [], help: true };
    }
    if (a === '-a' || a === '--all') {
      showAll = true;
      continue;
    }
    if (a.startsWith('-') && a.length > 1) {
      return { ok: false, stderr: whichOptionError(a), exitCode: 2 };
    }
    break;
  }
  const names = argsArr.slice(i).filter((n) => n !== '');
  if (!names.length) {
    return { ok: false, stderr: 'which: missing operand\n', exitCode: 1 };
  }
  return { ok: true, showAll, names };
}

const ALIAS_HELP = `Usage: alias [-p] [--help] [--] [name[=value] ...]
Define or display command aliases.

  -p              print all aliases in a reusable form (same output lines as bare alias)
  -h, --help      display this help and exit (jsh; bash alias has no --help)
      --          end of options (define an alias whose name starts with -)

jsh:
  Aliases expand when the command line is parsed (see terminal README). Names must match
  [A-Za-z_][A-Za-z0-9_-]*. Not implemented vs bash: trailing space in value for next-word alias expansion.
`;

/**
 * GNU-style option error for alias (exit status 2).
 * @param {string} arg
 * @returns {string}
 */
function aliasOptionError(arg) {
  const tryLine = "Try 'alias --help' for more information.\n";
  if (arg.startsWith('--') && arg.length > 2) {
    return `alias: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `alias: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `alias: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * Parse jsh `alias` argv: optional `-p`, `--help`/`-h`, `--`, operands (name[=value] or name).
 *
 * @param {string[]} args
 * @returns {{ ok: true, printReusable: boolean, operands: string[], help?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseAliasArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  let printReusable = false;
  let i = 0;
  for (; i < argsArr.length; i++) {
    const a = argsArr[i];
    if (a === '--') {
      i++;
      break;
    }
    if (a === '--help' || a === '-h') {
      return { ok: true, printReusable: false, operands: [], help: true };
    }
    if (a === '-p') {
      printReusable = true;
      continue;
    }
    if (a.startsWith('-') && a.length > 1) {
      return { ok: false, stderr: aliasOptionError(a), exitCode: 2 };
    }
    break;
  }
  const operands = argsArr.slice(i).filter((n) => n !== '');
  return { ok: true, printReusable, operands };
}

const BuiltinsLib = {
  TYPE_HELP,
  typeOptionError,
  parseTypeArgv,
  WHICH_HELP,
  whichOptionError,
  parseWhichArgv,
  ALIAS_HELP,
  aliasOptionError,
  parseAliasArgv
};
if (typeof globalThis !== 'undefined') {
  /** @type {*} */ (globalThis).BuiltinsLib = BuiltinsLib;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = BuiltinsLib;
}

// set builtin — bash-style shell option toggles (jsh subset)
//
// Supported:
//   set -e / +e         errexit  (abort list on non-zero pipeline)
//   set -u / +u         nounset  (unset $VAR expansion errors)
//   set -o pipefail     pipefail (rightmost non-zero stage becomes $?)
//   set +o pipefail     turn pipefail off
//   set -x / +x         xtrace   (echo each command before running)
//   set                 list current option states + env (bash-ish)
//   set --help          help text
//
// Not implemented: positional params ($1..), set -- args, set -o nounset etc.
// (only -e, -u, -o pipefail, -x are wired into the runner today).

import { registerCommand } from '../../commands.js';

const SET_HELP = `Usage: set [-e|+e] [-u|+u] [-x|+x] [-o option] [+o option] [--help]
Set or unset shell options.

  -e             same as -o errexit (abort list on non-zero exit)
  +e             unset errexit
  -u             same as -o nounset (error on unset $VAR expansion)
  +u             unset nounset
  -x             same as -o xtrace (echo each command before running)
  +x             unset xtrace
  -o OPTION      set OPTION (errexit, nounset, pipefail, xtrace)
  +o OPTION      unset OPTION
      --help     display this help and exit

jsh:
  Only the four shell options above are supported. Not implemented: full
  bash 'set' (positional params, +H, +B, etc.).
`;

const OPTIONS = ['errexit', 'nounset', 'pipefail', 'xtrace'];
const SHORT_TO_LONG = { e: 'errexit', u: 'nounset', x: 'xtrace' };

/**
 * @param {string[]} args
 * @returns {{ ok: true, changes: Array<{name:string, value:boolean}>, list: boolean, help?: true } | { ok: false, stderr: string, exitCode: number }}
 */
export function parseSetArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  if (argsArr.length === 0) return { ok: true, changes: [], list: true };
  const changes = [];
  for (let i = 0; i < argsArr.length; i++) {
    const a = argsArr[i];
    if (a === '--help' || a === '-h') {
      return { ok: true, changes: [], list: false, help: true };
    }
    if (a === '-o' || a === '+o') {
      const value = a === '-o';
      const name = argsArr[i + 1];
      if (!name) {
        return {
          ok: false,
          stderr: "set: usage: set [-o option] [+o option]\n",
          exitCode: 2
        };
      }
      if (!OPTIONS.includes(name)) {
        return {
          ok: false,
          stderr: `set: ${name}: invalid option name\n`,
          exitCode: 2
        };
      }
      changes.push({ name, value });
      i++;
      continue;
    }
    if (
      (a.startsWith('-') || a.startsWith('+')) &&
      a.length > 1 &&
      !a.startsWith('--') &&
      !a.startsWith('++')
    ) {
      const value = a[0] === '-';
      for (let j = 1; j < a.length; j++) {
        const c = a[j];
        const long = SHORT_TO_LONG[c];
        if (!long) {
          return {
            ok: false,
            stderr: `set: -${c}: invalid option\n`,
            exitCode: 2
          };
        }
        changes.push({ name: long, value });
      }
      continue;
    }
    return {
      ok: false,
      stderr: `set: ${a}: invalid option\n`,
      exitCode: 2
    };
  }
  return { ok: true, changes, list: false };
}

async function setHandler(terminal, args) {
  const parsed = parseSetArgv(args);
  if (parsed.ok === false) {
    return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
  }
  if (parsed.help) {
    return { stdout: SET_HELP, stderr: '', exitCode: 0 };
  }
  if (!terminal.shellOptions) {
    terminal.shellOptions = { errexit: false, nounset: false, pipefail: false, xtrace: false };
  }
  if (parsed.list) {
    const lines = [];
    for (const name of OPTIONS) {
      lines.push(`${name.padEnd(13)} ${terminal.shellOptions[name] ? 'on' : 'off'}`);
    }
    return { stdout: lines.join('\n') + '\n', stderr: '', exitCode: 0 };
  }
  for (const change of parsed.changes) {
    terminal.shellOptions[change.name] = change.value;
  }
  return { stdout: '', stderr: '', exitCode: 0 };
}

registerCommand('set', setHandler, 'set or unset shell options (-e, -u, -o pipefail, -x)', 'System');

export default {
  name: 'set',
  handler: setHandler,
  description: 'set or unset shell options (-e, -u, -o pipefail, -x)',
  category: 'System'
};

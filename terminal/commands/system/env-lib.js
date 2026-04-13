'use strict';

const ENV_HELP = `Usage: env [OPTION]... [-] [NAME=VALUE]...
Print the environment. NAME=VALUE merges into the displayed environment.

  -i, --ignore-environment   start with an empty environment
  -u, --unset=NAME          remove NAME from the inherited environment
      --help                 display this help and exit

jsh:
  Running a command via env is not supported.
`;

/**
 * Parse jsh `env` argv: GNU-like **-i** / **--ignore-environment**, **-u** / **--unset**,
 * **--**, lone **-**, then **NAME=VALUE** operands (no command execution).
 *
 * @param {string[]} args - argv after the command name
 * @returns {{ ok: true, help?: true, ignore: boolean, unset: string[], rest: string[] } | { ok: false, stderr: string, exitCode: number }}
 */
function parseEnvArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  /** @type {string[]} */
  const unset = [];
  let ignore = false;
  let i = 0;
  while (i < argsArr.length) {
    const a = argsArr[i];
    if (a === '--') {
      i++;
      break;
    }
    if (a === '-') {
      i++;
      break;
    }
    if (!a.startsWith('-')) {
      break;
    }
    if (a === '--help') {
      return { ok: true, help: true, ignore: false, unset: [], rest: [] };
    }
    if (a === '--ignore-environment') {
      ignore = true;
      i++;
      continue;
    }
    if (a.startsWith('--unset=')) {
      const name = a.slice('--unset='.length);
      if (name === '') {
        return {
          ok: false,
          stderr: "env: option '--unset' requires an argument\n",
          exitCode: 2
        };
      }
      unset.push(name);
      i++;
      continue;
    }
    if (a === '--unset') {
      if (i + 1 >= argsArr.length) {
        return {
          ok: false,
          stderr: "env: option '--unset' requires an argument\n",
          exitCode: 2
        };
      }
      unset.push(argsArr[i + 1]);
      i += 2;
      continue;
    }
    if (a.startsWith('--')) {
      return {
        ok: false,
        stderr: `env: unrecognized option '${a}'\n`,
        exitCode: 2
      };
    }
    if (a === '-i') {
      ignore = true;
      i++;
      continue;
    }
    if (a.length > 1) {
      let j = 1;
      let consumedUArg = false;
      while (j < a.length) {
        const c = a[j];
        if (c === 'i') {
          ignore = true;
          j++;
          continue;
        }
        if (c === 'u') {
          if (j !== a.length - 1) {
            return {
              ok: false,
              stderr: `env: invalid option -- '${a}'\n`,
              exitCode: 2
            };
          }
          if (i + 1 >= argsArr.length) {
            return {
              ok: false,
              stderr: "env: option requires an argument -- 'u'\n",
              exitCode: 2
            };
          }
          unset.push(argsArr[i + 1]);
          i += 2;
          consumedUArg = true;
          break;
        }
        return {
          ok: false,
          stderr: `env: invalid option -- '${c}'\n`,
          exitCode: 2
        };
      }
      if (!consumedUArg) {
        i++;
      }
      continue;
    }
    return {
      ok: false,
      stderr: `env: invalid option -- '${a}'\n`,
      exitCode: 2
    };
  }
  return { ok: true, ignore, unset, rest: argsArr.slice(i) };
}

const EnvLib = {
  ENV_HELP,
  parseEnvArgv
};
if (typeof globalThis !== 'undefined') {
  /** @type {*} */ (globalThis).EnvLib = EnvLib;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = EnvLib;
}

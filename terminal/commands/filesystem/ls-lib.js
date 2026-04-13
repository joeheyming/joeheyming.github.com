'use strict';

/** Short help text for `ls -h` / `--help`. */
const LS_HELP = `Usage: ls [OPTION]... [FILE]...
List directory contents.  -l long format  -a all (include dotfiles)`;

/**
 * GNU-like `ls` flags used by jsh: `-l` / `--long`, `-a` / `--all`, combined `-la`,
 * plus `-h` / `--help` and invalid-option errors (exit code 2).
 *
 * @param {string[]} args - argv after the command name
 * @returns {{ showDetails: boolean, showAll: boolean, help?: boolean, error?: { exitCode: number, stderr: string } }}
 */
function parseLsDisplayFlags(args) {
  let showDetails = false;
  let showAll = false;
  if (!args || !args.length) {
    return { showDetails, showAll };
  }
  for (const arg of args) {
    if (arg === '--') {
      break;
    }
    if (arg === '--help') {
      return { showDetails: false, showAll: false, help: true };
    }
    if (arg === '-h') {
      return { showDetails: false, showAll: false, help: true };
    }
    if (arg === '--long') {
      showDetails = true;
      continue;
    }
    if (arg === '--all') {
      showAll = true;
      continue;
    }
    if (arg.startsWith('--')) {
      return {
        showDetails: false,
        showAll: false,
        error: { exitCode: 2, stderr: `ls: unrecognized option '${arg}'\n` }
      };
    }
    if (arg.startsWith('-') && arg.length > 1) {
      for (let i = 1; i < arg.length; i++) {
        const c = arg[i];
        if (c === 'l') {
          showDetails = true;
        } else if (c === 'a') {
          showAll = true;
        } else {
          return {
            showDetails: false,
            showAll: false,
            error: { exitCode: 2, stderr: `ls: invalid option -- '${c}'\n` }
          };
        }
      }
    }
  }
  return { showDetails, showAll };
}

const LsLib = {
  LS_HELP,
  parseLsDisplayFlags
};
if (typeof globalThis !== 'undefined') {
  /** @type {*} */ (globalThis).LsLib = LsLib;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = LsLib;
}

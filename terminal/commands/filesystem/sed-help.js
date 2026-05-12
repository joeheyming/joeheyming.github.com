export const SED_HELP = `Usage: sed [OPTION]... SCRIPT [FILE]...
  or:  sed [OPTION]... -e SCRIPT ... [FILE]...

Stream-edit lines from FILEs or standard input.

  -n, --quiet, --silent    suppress automatic printing of pattern space
  -e SCRIPT, --expression=SCRIPT   add SCRIPT to the commands to be executed
      --help               display this help and exit
  -h                       same as --help (jsh; GNU sed uses -h differently)

jsh:
  SCRIPT is **d** (delete every line, like GNU **d** with no address), **Nd** /
  **$d** / **N,Md** / **N,$d** (delete matching line(s) by 1-based input line
  number; **$** is the last line), **/PATTERN/d** (delete lines whose text
  contains the **literal** substring **PATTERN**; **\\\\** and **\\\\/** escape
  backslash and slash inside **PATTERN**), **/PAT1/,/PAT2/d** (delete from the
  first line containing **PAT1** through the first line after that containing
  **PAT2**, inclusive; if **PAT2** never appears, delete through end of input;
  the end pattern is not tested on the line where **PAT1** matched, GNU-style),
  or a single **s** command (with the same **literal** address forms as **d**):
  **Ns** / **N,Ms** / **N,$s** / **/PAT/s** / **/PAT1/,/PAT2/s** / **/PAT/,Ns** /
  **N,/PAT/s** then **sDELIMpatDELIMreplDELIM[flags]** (DELIM is any char except
  newline; **\\\\** and **\\\\DELIM** escape backslash and delimiter). Pattern and
  replacement are **literal** text (not POSIX regex). Flags: **g** (global per line),
  **i** (ignore case), **p** (print line when substitution happens; with **-n** only
  **p** lines print; without **-n**, **p** prints an extra copy like GNU). In
  replacement, **&** is the matched text; **\\\\&** is a literal **&**. Multiple **-e**
  scripts and **;**-separated commands in one script run in order on each line (**d**
  ends the line cycle like GNU). Mixed addresses (GNU-style): **/PAT/,Nd** deletes
  from the first line containing **PAT** through line **N** (inclusive); if that first
  match is on line **L** with **L > N**, only line **L** is deleted. **N,/PAT/d**
  deletes from line **N** through the first line containing **PAT** (inclusive). The
  same address rules apply to **s** (substitute on selected lines only).
  Operand **-** reads standard input. No **-f** or **-i** in-place.

Full documentation: <https://www.gnu.org/software/sed/manual/html_node/sed-invocation.html>
`;

/**
 * GNU-style option error for sed (exit status 2).
 * @param {string} arg
 * @returns {string}
 */
export function sedOptionError(arg) {
  const tryLine = "Try 'sed --help' for more information.\n";
  if (arg.startsWith('--') && arg.length > 2) {
    return `sed: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `sed: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `sed: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * Parse jsh `sed` argv: -n, -e/--expression, --help/-h, --, then script + FILEs.
 *
 * @param {string[]} args
 * @returns {{ ok: true, quiet: boolean, scripts: string[], fileOperands: string[], help?: true } | { ok: false, stderr: string, exitCode: number }}
 */
export function parseSedArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  let quiet = false;
  /** @type {string[]} */
  const scripts = [];
  let i = 0;
  while (i < argsArr.length) {
    const arg = argsArr[i];
    if (arg === '--') {
      const rest = argsArr.slice(i + 1);
      return { ok: true, quiet, scripts, fileOperands: rest };
    }
    if (arg === '--help' || arg === '-h') {
      return { ok: true, help: true, quiet, scripts: [], fileOperands: [] };
    }
    if (arg === '-n' || arg === '--quiet' || arg === '--silent') {
      quiet = true;
      i++;
      continue;
    }
    if (arg === '-e' || arg === '--expression') {
      if (i + 1 >= argsArr.length) {
        return {
          ok: false,
          stderr: "sed: option requires an argument -- 'e'\n",
          exitCode: 2
        };
      }
      scripts.push(argsArr[i + 1]);
      i += 2;
      continue;
    }
    if (arg.startsWith('--expression=')) {
      const rest = arg.slice('--expression='.length);
      if (rest === '') {
        return {
          ok: false,
          stderr: "sed: option requires an argument -- 'expression'\n",
          exitCode: 2
        };
      }
      scripts.push(rest);
      i++;
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1 && !arg.startsWith('--')) {
      return { ok: false, stderr: sedOptionError(arg), exitCode: 2 };
    }
    if (arg.startsWith('--') && arg.length > 2) {
      return { ok: false, stderr: sedOptionError(arg), exitCode: 2 };
    }
    if (scripts.length === 0) {
      scripts.push(arg);
      i++;
      return { ok: true, quiet, scripts, fileOperands: argsArr.slice(i) };
    }
    return { ok: true, quiet, scripts, fileOperands: argsArr.slice(i) };
  }
  if (scripts.length === 0) {
    return { ok: false, stderr: 'sed: missing operand\n', exitCode: 2 };
  }
  return { ok: true, quiet, scripts, fileOperands: [] };
}

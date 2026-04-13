const ECHO_HELP = `Usage: echo [SHORT-OPTION]... [STRING]...
  or:  echo LONG-OPTION
Echo the STRING(s) to standard output.

  -n             do not output the trailing newline
  -e             enable interpretation of backslash escapes
  -E             disable interpretation of backslash escapes (default)
  -h, --help     display this help and exit (jsh: **-h** is help; GNU has no **-h**)
      --version  display version information and exit

jsh:
  Options are parsed only from leading arguments; after the first STRING, every
  argument is printed literally (GNU-style). **--** ends option parsing.
  **$VAR** / **$?** expansion is applied to the joined STRINGs (jsh extension).
  Not full GNU: no **printf**-style formats; octal/hex escapes follow common **echo -e** rules.

Full documentation: <https://www.gnu.org/software/coreutils/echo>
`;

const ECHO_VERSION_LINE = 'echo (jsh Heyming Terminal) 1.0\n';

/**
 * GNU-style option error for echo (exit status 2).
 * @param {string} arg
 * @returns {string}
 */
function echoOptionError(arg) {
  const tryLine = "Try 'echo --help' for more information.\n";
  if (arg.startsWith('--') && arg.length > 2) {
    return `echo: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `echo: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `echo: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * Parse a single `-` token (e.g. `-ne`, `-n`) for GNU echo flags.
 * @param {string} token
 * @returns {{ ok: true, noNewline: boolean, escapes: boolean, hasEscapeFlag: boolean } | { ok: false }}
 */
function parseEchoShortFlagToken(token) {
  if (token == null || token.length < 2 || token[0] !== '-') {
    return { ok: false };
  }
  let noNewline = false;
  let escapes = false;
  let hasEscapeFlag = false;
  for (let j = 1; j < token.length; j++) {
    const c = token[j];
    if (c === 'n') {
      noNewline = true;
    } else if (c === 'e') {
      escapes = true;
      hasEscapeFlag = true;
    } else if (c === 'E') {
      escapes = false;
      hasEscapeFlag = true;
    } else {
      return { ok: false };
    }
  }
  return { ok: true, noNewline, escapes, hasEscapeFlag };
}

/**
 * Parse jsh `echo` argv (GNU-ish: leading `-n`/`-e`/`-E`, `--`, operands).
 *
 * @param {string[]} args
 * @returns {{ ok: true, operands: string[], noNewline: boolean, escapes: boolean, help?: true, version?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseEchoArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  const operands = [];
  let noNewline = false;
  let escapes = false;
  let i = 0;
  let parsingOptions = true;

  while (i < argsArr.length) {
    const a = argsArr[i];
    if (!parsingOptions) {
      operands.push(a);
      i++;
      continue;
    }
    if (a === '--') {
      operands.push(...argsArr.slice(i + 1));
      break;
    }
    if (a === '--help' || a === '-h') {
      return { ok: true, operands: [], noNewline: false, escapes: false, help: true };
    }
    if (a === '--version') {
      return { ok: true, operands: [], noNewline: false, escapes: false, version: true };
    }
    if (a.startsWith('--') && a.length > 2) {
      return { ok: false, stderr: echoOptionError(a), exitCode: 2 };
    }
    if (a === '-') {
      operands.push('-');
      i++;
      parsingOptions = false;
      continue;
    }
    if (a.startsWith('-') && a.length > 1) {
      const r = parseEchoShortFlagToken(a);
      if (r.ok) {
        if (r.noNewline) {
          noNewline = true;
        }
        if (r.hasEscapeFlag) {
          escapes = r.escapes;
        }
        i++;
        continue;
      }
      return { ok: false, stderr: echoOptionError(a), exitCode: 2 };
    }
    parsingOptions = false;
    operands.push(a);
    i++;
  }

  return { ok: true, operands, noNewline, escapes };
}

/**
 * Apply GNU `echo -e` backslash escapes (subset aligned with common coreutils behavior).
 * @param {string} str
 * @returns {string}
 */
function echoApplyBackslashEscapes(str) {
  const s = String(str);
  let out = '';
  let i = 0;
  while (i < s.length) {
    if (s[i] !== '\\') {
      out += s[i];
      i++;
      continue;
    }
    i++;
    if (i >= s.length) {
      out += '\\';
      break;
    }
    const c = s[i];
    switch (c) {
      case 'a':
        out += '\x07';
        i++;
        break;
      case 'b':
        out += '\b';
        i++;
        break;
      case 'c':
        return out;
      case 'e':
      case 'E':
        out += '\x1b';
        i++;
        break;
      case 'f':
        out += '\f';
        i++;
        break;
      case 'n':
        out += '\n';
        i++;
        break;
      case 'r':
        out += '\r';
        i++;
        break;
      case 't':
        out += '\t';
        i++;
        break;
      case 'v':
        out += '\v';
        i++;
        break;
      case '\\':
        out += '\\';
        i++;
        break;
      case '0':
      case '1':
      case '2':
      case '3':
      case '4':
      case '5':
      case '6':
      case '7': {
        let val = 0;
        let count = 0;
        while (count < 3 && i < s.length) {
          const ch = s[i];
          if (ch < '0' || ch > '7') {
            break;
          }
          val = val * 8 + (ch.charCodeAt(0) - 48);
          i++;
          count++;
        }
        out += String.fromCharCode(val & 0xff);
        break;
      }
      case 'x': {
        i++;
        let hex = '';
        while (hex.length < 2 && i < s.length && /[0-9a-fA-F]/.test(s[i])) {
          hex += s[i];
          i++;
        }
        if (hex.length > 0) {
          out += String.fromCharCode(parseInt(hex, 16) & 0xff);
        } else {
          out += 'x';
        }
        break;
      }
      default:
        out += c;
        i++;
    }
  }
  return out;
}

export const EchoLib = {
  ECHO_HELP,
  ECHO_VERSION_LINE,
  echoOptionError,
  parseEchoShortFlagToken,
  parseEchoArgv,
  echoApplyBackslashEscapes
};

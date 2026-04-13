const CHMOD_HELP = `Usage: chmod [OPTION]... MODE FILE...
  or:  chmod [OPTION]... OCTAL-MODE FILE...

Change file mode bits (jsh).

jsh does not model Unix permission bits; MODE and options like -R are accepted for
script compatibility but are not applied. Exit status is 0 when the invocation
is well-formed.

Options:
  -R, --recursive   no-op (accepted for compatibility)
  -v, --verbose     no-op
      --help        display this help and exit
  -h                same as --help

Try 'man chmod' on a real system for POSIX/GNU semantics.
`;

/**
 * Parse `chmod` argv (jsh fake: mode not applied).
 * @param {string[]} args
 * @returns {{ ok: true, help: true } | { ok: true, flags: { recursive: boolean, verbose: boolean }, mode: string, files: string[] } | { ok: false, stderr: string }}
 */
function parseChmodArgv(args) {
  const arr = Array.isArray(args) ? args : [];
  const flags = { recursive: false, verbose: false };
  let i = 0;
  while (i < arr.length) {
    const a = arr[i];
    if (a === '--') {
      i++;
      break;
    }
    if (a === '--help') {
      return { ok: true, help: true };
    }
    if (a === '--recursive') {
      flags.recursive = true;
      i++;
      continue;
    }
    if (a === '--verbose') {
      flags.verbose = true;
      i++;
      continue;
    }
    if (a.startsWith('-') && a.length > 1) {
      if (a.startsWith('--')) {
        return { ok: false, stderr: `chmod: unrecognized option '${a}'` };
      }
      for (let j = 1; j < a.length; j++) {
        const c = a[j];
        if (c === 'R') {
          flags.recursive = true;
        } else if (c === 'v') {
          flags.verbose = true;
        } else if (c === 'h') {
          return { ok: true, help: true };
        } else {
          return { ok: false, stderr: `chmod: invalid option -- '${c}'` };
        }
      }
      i++;
      continue;
    }
    break;
  }
  const rest = arr.slice(i);
  if (rest.length < 2) {
    if (rest.length === 0) {
      return { ok: false, stderr: 'chmod: missing operand' };
    }
    return { ok: false, stderr: `chmod: missing operand after '${rest[0]}'` };
  }
  const mode = rest[0];
  const files = rest.slice(1);
  return { ok: true, flags, mode, files };
}

export const ChmodLib = {
  CHMOD_HELP,
  parseChmodArgv
};

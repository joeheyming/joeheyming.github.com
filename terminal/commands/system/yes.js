// yes — repeatedly print STRING (or 'y'), capped because the browser is not a real Unix pipeline.
//
// Real GNU yes prints until the pipe closes; in our static-site terminal stdout
// is captured fully into a string, so an unbounded loop would freeze the tab.
// We default to a large-but-sane cap and let `-n N` override.

const YES_HELP = `Usage: yes [STRING]...
       yes -n COUNT [STRING]...
Repeatedly output a line with all specified STRING(s), or 'y'.

      -n, --count N      produce N lines (default ${10000}, max ${1000000})
      --help             display this help and exit

Note: this is a browser shell; output is capped to keep the tab responsive.
`;

const DEFAULT_COUNT = 10000;
const MAX_COUNT = 1000000;

function parseCount(raw) {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return null;
  return Math.min(n, MAX_COUNT);
}

function yesHandler(_terminal, args) {
  let count = DEFAULT_COUNT;
  const operands = [];
  let endOfOpts = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (endOfOpts) {
      operands.push(a);
      continue;
    }
    if (a === '--help' || a === '-h') {
      return { stdout: YES_HELP, stderr: '', exitCode: 0 };
    }
    if (a === '--') {
      endOfOpts = true;
      continue;
    }
    if (a === '-n' || a === '--count') {
      const parsed = parseCount(args[++i]);
      if (parsed === null) {
        return { stdout: '', stderr: `yes: invalid count: ${args[i]}\n`, exitCode: 1 };
      }
      count = parsed;
      continue;
    }
    if (a.startsWith('--count=')) {
      const parsed = parseCount(a.slice('--count='.length));
      if (parsed === null) {
        return {
          stdout: '',
          stderr: `yes: invalid count: ${a.slice('--count='.length)}\n`,
          exitCode: 1
        };
      }
      count = parsed;
      continue;
    }
    operands.push(a);
  }

  const line = operands.length > 0 ? operands.join(' ') : 'y';
  if (count === 0) return { stdout: '', stderr: '', exitCode: 0 };
  return { stdout: (line + '\n').repeat(count), stderr: '', exitCode: 0 };
}

export default {
  name: 'yes',
  handler: yesHandler,
  description: "print 'y' (or STRING) repeatedly (-n N / --count=N; capped for browser)",
  category: 'System'
};

// free — show simulated memory information.
//
// Sources, in order: performance.memory (Chrome/Edge only), then a documented
// stub that reports zeros so scripts that just look for the "Mem:" line still
// work. This is a best-effort visualization of the JS heap, not real RAM.

const FREE_HELP = `Usage: free [OPTION]...
Display amount of free and used memory in the system.

  -b      show output in bytes
  -k      show output in kibibytes (default)
  -m      show output in mebibytes
  -g      show output in gibibytes
  -h      show in human readable format
  --help  display this help and exit

jsh notes:
  - We can only see the JS heap (performance.memory in Chromium). totalJSHeapSize
    is shown as total, usedJSHeapSize as used, jsHeapSizeLimit as the upper limit.
  - On browsers without performance.memory, everything is reported as 0 and a
    note is appended to stderr.
`;

function parseFreeArgv(args) {
  let scale = 1024; // kibibytes
  let humanReadable = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--help') return { ok: true, help: true };
    if (a === '-b') scale = 1;
    else if (a === '-k') scale = 1024;
    else if (a === '-m') scale = 1024 * 1024;
    else if (a === '-g') scale = 1024 * 1024 * 1024;
    else if (a === '-h') humanReadable = true;
    else if (a.startsWith('-') && a.length > 1 && !a.startsWith('--')) {
      for (let j = 1; j < a.length; j++) {
        const c = a[j];
        if (c === 'b') scale = 1;
        else if (c === 'k') scale = 1024;
        else if (c === 'm') scale = 1024 * 1024;
        else if (c === 'g') scale = 1024 * 1024 * 1024;
        else if (c === 'h') humanReadable = true;
        else return { ok: false, stderr: `free: invalid option -- '${c}'\n`, exitCode: 2 };
      }
    } else {
      return { ok: false, stderr: `free: unrecognized option '${a}'\n`, exitCode: 2 };
    }
  }
  return { ok: true, scale, humanReadable };
}

function humanSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '-';
  const units = ['B', 'K', 'M', 'G', 'T'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  if (i === 0) return `${Math.round(n)}`;
  return n >= 10 ? `${Math.round(n)}${units[i]}` : `${n.toFixed(1)}${units[i]}`;
}

function fmt(bytes, parsed) {
  if (parsed.humanReadable) return humanSize(bytes);
  return String(Math.round(bytes / parsed.scale));
}

async function freeHandler(terminal, args) {
  const parsed = parseFreeArgv(args || []);
  if (parsed.ok === false) return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
  if (parsed.help) return { stdout: FREE_HELP, stderr: '', exitCode: 0 };

  let total = 0;
  let used = 0;
  let free = 0;
  let stderr = '';
  let haveData = false;
  try {
    if (typeof performance !== 'undefined' && /** @type {any} */ (performance).memory) {
      const m = /** @type {any} */ (performance).memory;
      total = m.jsHeapSizeLimit || 0;
      used = m.usedJSHeapSize || 0;
      free = Math.max(0, total - used);
      haveData = true;
    }
  } catch (_) {
    /* ignore */
  }
  if (!haveData) {
    stderr =
      'free: performance.memory unavailable (Chromium-only). Showing zeros.\n';
  }
  const t = fmt(total, parsed);
  const u = fmt(used, parsed);
  const f = fmt(free, parsed);
  const zero = fmt(0, parsed);
  const header =
    '               total        used        free      shared  buff/cache   available';
  const memRow =
    `Mem:     ${t.padStart(12)} ${u.padStart(11)} ${f.padStart(11)} ${zero.padStart(11)} ${zero.padStart(11)} ${f.padStart(11)}`;
  const swapRow =
    `Swap:    ${zero.padStart(12)} ${zero.padStart(11)} ${zero.padStart(11)}`;
  return {
    stdout: header + '\n' + memRow + '\n' + swapRow + '\n',
    stderr,
    exitCode: 0
  };
}

export default {
  name: 'free',
  handler: freeHandler,
  description: 'show JS heap memory information (-b -k -m -g -h)',
  category: 'System'
};

export { parseFreeArgv, humanSize };

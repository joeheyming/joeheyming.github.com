// journalctl — tail / filter system logs.
//
// jsh maps the journal to /var/log/messages, augmented by service logs that
// services voluntarily append. Supports:
//   journalctl                 print everything
//   journalctl -n N            last N lines
//   journalctl -u UNIT         filter by tag (matches the `<unit>:` prefix)
//   journalctl --since EXPR    ISO-ish prefix match on the timestamp column
//   journalctl --follow / -f   periodically re-read and append new lines
//   journalctl --no-pager      ignored; jsh never pages
//   journalctl --help

const JOURNALCTL_HELP = `Usage: journalctl [OPTION]...
Query the simulated system journal (/var/log/messages).

  -n, --lines=N        show the last N lines (default: all)
  -u, --unit=UNIT      filter to messages tagged with UNIT
  --since=EXPR         show lines whose timestamp starts with EXPR
  -f, --follow         keep reading (one extra snapshot, then exit; jsh
                       has no cooperative tail loop yet)
  --no-pager           ignored (jsh never pages)
  --help               display this help and exit

jsh: not a real journald; reads /var/log/messages (and per-unit log files
under /var/log/units/<UNIT>.log when present).
`;

function parseJournalctlArgv(args) {
  let lines = null;
  let unit = null;
  let since = null;
  let follow = false;
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (a === '--help' || a === '-h') return { ok: true, help: true };
    if (a === '--no-pager') {
      i++;
      continue;
    }
    if (a === '-f' || a === '--follow') {
      follow = true;
      i++;
      continue;
    }
    if (a === '-n' || a === '--lines') {
      const n = parseInt(args[i + 1], 10);
      if (!Number.isFinite(n) || n < 0) return { ok: false, stderr: 'journalctl: invalid -n\n', exitCode: 2 };
      lines = n;
      i += 2;
      continue;
    }
    if (a.startsWith('--lines=')) {
      const n = parseInt(a.slice('--lines='.length), 10);
      if (!Number.isFinite(n) || n < 0) return { ok: false, stderr: 'journalctl: invalid --lines\n', exitCode: 2 };
      lines = n;
      i++;
      continue;
    }
    if (a === '-u' || a === '--unit') {
      unit = args[i + 1];
      i += 2;
      continue;
    }
    if (a.startsWith('--unit=')) {
      unit = a.slice('--unit='.length);
      i++;
      continue;
    }
    if (a === '--since') {
      since = args[i + 1];
      i += 2;
      continue;
    }
    if (a.startsWith('--since=')) {
      since = a.slice('--since='.length);
      i++;
      continue;
    }
    return { ok: false, stderr: `journalctl: unrecognized option '${a}'\n`, exitCode: 2 };
  }
  return { ok: true, lines, unit, since, follow };
}

async function readLog(terminal, path) {
  try {
    const item = await terminal.getFileSystemItem(path);
    if (!item || item.type !== 'file') return '';
    return String(item.content ?? '');
  } catch (_) {
    return '';
  }
}

async function journalctlHandler(terminal, args) {
  const parsed = parseJournalctlArgv(args || []);
  if (parsed.ok === false) return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
  if (parsed.help) return { stdout: JOURNALCTL_HELP, stderr: '', exitCode: 0 };

  const baseLog = await readLog(terminal, '/var/log/messages');
  let unitLog = '';
  if (parsed.unit) {
    unitLog = await readLog(terminal, `/var/log/units/${parsed.unit}.log`);
  }
  const combined = (baseLog + (unitLog ? '\n' + unitLog : '')).split(/\r?\n/);
  let filtered = combined;
  if (parsed.unit) {
    const tag = parsed.unit;
    filtered = filtered.filter((l) => l.includes(`${tag}:`) || l.includes(`${tag}[`));
  }
  if (parsed.since) {
    filtered = filtered.filter((l) => l.startsWith(parsed.since));
  }
  filtered = filtered.filter(Boolean);
  if (parsed.lines != null) filtered = filtered.slice(-parsed.lines);
  // -f is documented as a single re-read; honest about no cooperative tail.
  let stdout = filtered.join('\n') + (filtered.length ? '\n' : '');
  if (parsed.follow) stdout += '-- (jsh: --follow performed a single snapshot)\n';
  return { stdout, stderr: '', exitCode: 0 };
}

export default {
  name: 'journalctl',
  handler: journalctlHandler,
  description: 'tail / filter /var/log/messages and per-unit logs (-n -u --since -f)',
  category: 'System'
};

export { parseJournalctlArgv };

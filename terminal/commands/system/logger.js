// logger — append a message to /var/log/messages (subset of util-linux logger).
//
// Supports:
//   logger MESSAGE...
//   logger -t TAG MESSAGE...
//   logger -p facility.level MESSAGE...   (recorded as text only)
//   logger -s                              also echo to stderr
//   logger -f FILE                         use FILE as the message source
//   logger -i                              include simulated pid
//
// jsh: writes to the VFS-backed log; not a real syslog daemon.

const LOGGER_HELP = `Usage: logger [OPTION]... [MESSAGE]
Write a MESSAGE to the system log (/var/log/messages).

  -t, --tag TAG          mark every line to be logged with the specified TAG
  -p, --priority PRI     mark given message with the specified priority (e.g. user.notice)
  -s, --stderr           also echo to stderr
  -i                     log the simulated PID with each line
  -f, --file FILE        read the messages from FILE instead of the command line
  -h, --help             display this help and exit

jsh: not a real syslog daemon; messages append to /var/log/messages.
`;

function parseLoggerArgv(args) {
  let tag = null;
  let priority = null;
  let stderr = false;
  let inclPid = false;
  let file = null;
  const messageParts = [];
  let i = 0;
  while (i < args.length) {
    const a = args[i++];
    if (a === '-h' || a === '--help') return { ok: true, help: true };
    if (a === '--') {
      while (i < args.length) messageParts.push(args[i++]);
      break;
    }
    if (a === '-t' || a === '--tag') {
      if (i >= args.length) return { ok: false, stderr: "logger: -t requires an argument\n", exitCode: 2 };
      tag = args[i++];
      continue;
    }
    if (a === '-p' || a === '--priority') {
      if (i >= args.length) return { ok: false, stderr: "logger: -p requires an argument\n", exitCode: 2 };
      priority = args[i++];
      continue;
    }
    if (a === '-s' || a === '--stderr') {
      stderr = true;
      continue;
    }
    if (a === '-i') {
      inclPid = true;
      continue;
    }
    if (a === '-f' || a === '--file') {
      if (i >= args.length) return { ok: false, stderr: "logger: -f requires an argument\n", exitCode: 2 };
      file = args[i++];
      continue;
    }
    messageParts.push(a);
  }
  return { ok: true, tag, priority, stderr, inclPid, file, message: messageParts.join(' ') };
}

function tryGetCurrentPid() {
  try {
    if (typeof globalThis !== 'undefined' && /** @type {any} */ (globalThis).heymingOS) {
      const os = /** @type {any} */ (globalThis).heymingOS;
      if (os.kernel && os.kernel.processManager) {
        const cur = os.kernel.processManager.getCurrentProcess?.();
        if (cur && cur.pid != null) return cur.pid;
      }
    }
  } catch (_) {
    /* ignore */
  }
  return null;
}

async function loggerHandler(terminal, args) {
  const parsed = parseLoggerArgv(args || []);
  if (parsed.ok === false) return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
  if (parsed.help) return { stdout: LOGGER_HELP, stderr: '', exitCode: 0 };

  let body = parsed.message;
  if (parsed.file) {
    try {
      const item = await terminal.getFileSystemItem(terminal.resolvePath(parsed.file));
      if (!item || item.type !== 'file') {
        return { stdout: '', stderr: `logger: cannot read ${parsed.file}\n`, exitCode: 1 };
      }
      body = String(item.content ?? '');
    } catch (e) {
      return { stdout: '', stderr: `logger: ${e.message}\n`, exitCode: 1 };
    }
  }
  // If no message and no file, read stdin (or empty).
  if (!body && terminal.stdin != null) body = String(terminal.stdin);

  const tag = parsed.tag || (terminal.env?.USER || 'user');
  const host = terminal.env?.HOSTNAME || 'heyming-os';
  const ts = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
  const lines = String(body).split(/\r?\n/).filter((s) => s.length > 0);
  if (lines.length === 0) lines.push('');
  const pid = parsed.inclPid ? tryGetCurrentPid() : null;
  const prefix = pid != null ? `${tag}[${pid}]` : tag;

  let toAppend = '';
  let toStderr = '';
  for (const line of lines) {
    const priPart = parsed.priority ? `<${parsed.priority}> ` : '';
    const formatted = `${ts} ${host} ${prefix}: ${priPart}${line}\n`;
    toAppend += formatted;
    if (parsed.stderr) toStderr += formatted;
  }

  const logPath = '/var/log/messages';
  try {
    const existing = await terminal.getFileSystemItem(logPath);
    const oldContent = existing && existing.content ? String(existing.content) : '';
    await terminal.fileSystemDB.createFile(logPath, oldContent + toAppend, true);
  } catch (e) {
    return { stdout: '', stderr: `logger: ${e.message}\n`, exitCode: 1 };
  }
  return { stdout: '', stderr: toStderr, exitCode: 0 };
}

export default {
  name: 'logger',
  handler: loggerHandler,
  description: 'append a message to /var/log/messages (subset of util-linux logger)',
  category: 'System'
};

export { parseLoggerArgv };

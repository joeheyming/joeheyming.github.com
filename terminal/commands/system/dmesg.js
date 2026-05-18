// dmesg — print kernel ring buffer (jsh: reads /var/log/dmesg).
//
// Subset of util-linux dmesg:
//   dmesg                  print the buffer
//   dmesg -c               print, then clear (truncate /var/log/dmesg)
//   dmesg -H | --human     pretty-printed timestamps (we already store them human)
//   dmesg -T | --ctime     same as -H here
//   dmesg --clear / -C     clear without printing
//   dmesg --help

const DMESG_HELP = `Usage: dmesg [OPTION]...
Display or control the kernel ring buffer (jsh: /var/log/dmesg).

  -c, --read-clear       read and clear the log
  -C, --clear            clear the log without printing it
  -H, --human            human readable output
  -T, --ctime            human readable timestamps
  -h, --help             display this help and exit
`;

function parseDmesgArgv(args) {
  let readClear = false;
  let clearOnly = false;
  let human = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-h' || a === '--help') return { ok: true, help: true };
    if (a === '-c' || a === '--read-clear') readClear = true;
    else if (a === '-C' || a === '--clear') clearOnly = true;
    else if (a === '-H' || a === '--human' || a === '-T' || a === '--ctime') human = true;
    else return { ok: false, stderr: `dmesg: unrecognized option '${a}'\n`, exitCode: 2 };
  }
  return { ok: true, readClear, clearOnly, human };
}

async function dmesgHandler(terminal, args) {
  const parsed = parseDmesgArgv(args || []);
  if (parsed.ok === false) return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
  if (parsed.help) return { stdout: DMESG_HELP, stderr: '', exitCode: 0 };

  const path = '/var/log/dmesg';
  let content = '';
  try {
    const item = await terminal.getFileSystemItem(path);
    if (item) content = String(item.content ?? '');
  } catch (_) {
    content = '';
  }

  if (parsed.clearOnly) {
    try {
      await terminal.fileSystemDB.createFile(path, '', true);
    } catch (_) {
      /* ignore */
    }
    return { stdout: '', stderr: '', exitCode: 0 };
  }

  let stdout = content;
  if (parsed.readClear) {
    try {
      await terminal.fileSystemDB.createFile(path, '', true);
    } catch (_) {
      /* ignore */
    }
  }
  if (!stdout.endsWith('\n') && stdout.length > 0) stdout += '\n';
  return { stdout, stderr: '', exitCode: 0 };
}

export default {
  name: 'dmesg',
  handler: dmesgHandler,
  description: 'print or control the simulated kernel ring buffer (/var/log/dmesg)',
  category: 'System'
};

export { parseDmesgArgv };

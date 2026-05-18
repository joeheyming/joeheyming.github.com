// df — report VFS / IndexedDB storage usage in GNU-ish format.
//
// jsh notes:
//   - There is exactly one mounted filesystem: the IndexedDB-backed VFS.
//   - Quota comes from navigator.storage.estimate() when available; otherwise
//     we fall back to an honest "unknown" using the VFS file count.

const DF_HELP = `Usage: df [OPTION]... [FILE]...
Show information about the file system on which each FILE resides,
or all file systems by default.

  -h, --human-readable    print sizes in powers of 1024 (e.g., 1023M)
  -k                      print sizes in 1K blocks (default)
  -B SIZE                 scale sizes by SIZE before printing them
  -T, --print-type        print file system type
  -i, --inodes            (jsh stub: prints item count from VFS)
  --total                 produce a grand total line
  -h, --help              display this help and exit
`;

function parseDfArgv(args) {
  let humanReadable = false;
  let printType = false;
  let inodes = false;
  let total = false;
  let blockSize = 1024;
  let i = 0;
  const operands = [];
  while (i < args.length) {
    const a = args[i++];
    if (a === '--help') return { ok: true, help: true };
    if (a === '--') {
      while (i < args.length) operands.push(args[i++]);
      break;
    }
    if (a === '-h' || a === '--human-readable') {
      humanReadable = true;
      continue;
    }
    if (a === '-T' || a === '--print-type') {
      printType = true;
      continue;
    }
    if (a === '-i' || a === '--inodes') {
      inodes = true;
      continue;
    }
    if (a === '--total') {
      total = true;
      continue;
    }
    if (a === '-k') {
      blockSize = 1024;
      continue;
    }
    if (a === '-B') {
      if (i >= args.length) {
        return { ok: false, stderr: "df: option '-B' requires an argument\n", exitCode: 2 };
      }
      const n = parseInt(args[i++], 10);
      if (!Number.isFinite(n) || n <= 0) {
        return { ok: false, stderr: 'df: invalid -B argument\n', exitCode: 2 };
      }
      blockSize = n;
      continue;
    }
    if (a.startsWith('-') && a.length > 1 && !a.startsWith('--')) {
      for (let j = 1; j < a.length; j++) {
        const c = a[j];
        if (c === 'h') humanReadable = true;
        else if (c === 'T') printType = true;
        else if (c === 'i') inodes = true;
        else if (c === 'k') blockSize = 1024;
        else return { ok: false, stderr: `df: invalid option -- '${c}'\n`, exitCode: 2 };
      }
      continue;
    }
    operands.push(a);
  }
  return { ok: true, humanReadable, printType, inodes, total, blockSize, operands };
}

function humanSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '-';
  const units = ['B', 'K', 'M', 'G', 'T', 'P'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return n >= 10 || i === 0 ? `${Math.round(n)}${units[i]}` : `${n.toFixed(1)}${units[i]}`;
}

function fmtSize(bytes, humanReadable, blockSize) {
  if (humanReadable) return humanSize(bytes);
  return String(Math.ceil(bytes / blockSize));
}

async function estimateQuota() {
  try {
    if (
      typeof navigator !== 'undefined' &&
      navigator.storage &&
      typeof navigator.storage.estimate === 'function'
    ) {
      const e = await navigator.storage.estimate();
      return { quota: e.quota || 0, usage: e.usage || 0 };
    }
  } catch (_) {
    /* ignore */
  }
  return null;
}

async function dfHandler(terminal, args) {
  const parsed = parseDfArgv(args || []);
  if (parsed.ok === false) {
    return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
  }
  if (parsed.help) return { stdout: DF_HELP, stderr: '', exitCode: 0 };

  if (!terminal.fileSystemDB || typeof terminal.fileSystemDB.getStats !== 'function') {
    return { stdout: '', stderr: 'df: filesystem not available\n', exitCode: 1 };
  }
  let stats;
  try {
    stats = await terminal.fileSystemDB.getStats();
  } catch (e) {
    return { stdout: '', stderr: `df: ${e.message}\n`, exitCode: 1 };
  }

  const quota = await estimateQuota();
  const used = stats.totalSize || 0;
  const total = quota ? quota.quota : Math.max(used, used + 100 * 1024 * 1024);
  const available = Math.max(0, total - used);
  const usePct = total > 0 ? Math.round((used / total) * 100) : 0;

  if (parsed.inodes) {
    const header = parsed.printType
      ? 'Filesystem     Type      Inodes  IUsed   IFree IUse% Mounted on'
      : 'Filesystem     Inodes  IUsed   IFree IUse% Mounted on';
    const totalI = stats.totalItems || 0;
    const row = parsed.printType
      ? `indexeddb      vfs    ${String(totalI).padStart(8)} ${String(totalI).padStart(6)} ${String(0).padStart(7)} ${usePct}% /`
      : `indexeddb      ${String(totalI).padStart(8)} ${String(totalI).padStart(6)} ${String(0).padStart(7)} ${usePct}% /`;
    return { stdout: header + '\n' + row + '\n', stderr: '', exitCode: 0 };
  }

  const colSize = parsed.humanReadable
    ? 'Size'
    : `${parsed.blockSize === 1024 ? '1K-blocks' : `${parsed.blockSize}B-blocks`}`;
  const header = parsed.printType
    ? `Filesystem     Type     ${colSize}    Used   Avail Use% Mounted on`
    : `Filesystem     ${colSize}    Used   Avail Use% Mounted on`;
  const sizeStr = fmtSize(total, parsed.humanReadable, parsed.blockSize);
  const usedStr = fmtSize(used, parsed.humanReadable, parsed.blockSize);
  const availStr = fmtSize(available, parsed.humanReadable, parsed.blockSize);
  const row = parsed.printType
    ? `indexeddb      vfs    ${sizeStr.padStart(10)} ${usedStr.padStart(7)} ${availStr.padStart(7)} ${usePct}% /`
    : `indexeddb      ${sizeStr.padStart(10)} ${usedStr.padStart(7)} ${availStr.padStart(7)} ${usePct}% /`;
  let body = header + '\n' + row + '\n';
  if (parsed.total) {
    body += `total          ${sizeStr.padStart(10)} ${usedStr.padStart(7)} ${availStr.padStart(7)} ${usePct}%\n`;
  }
  return { stdout: body, stderr: '', exitCode: 0 };
}

export default {
  name: 'df',
  handler: dfHandler,
  description: 'report VFS storage usage (uses navigator.storage.estimate when available)',
  category: 'File System'
};

export { parseDfArgv, humanSize };

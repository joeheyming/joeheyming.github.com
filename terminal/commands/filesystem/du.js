// du — summarize disk usage of files / directories over the VFS.
//
// Subset of GNU du: -h human, -s summary, -a all files, -c grand total,
// --max-depth N, -B SIZE, -k (1K, default), -b (bytes).

const DU_HELP = `Usage: du [OPTION]... [FILE]...
Summarize disk usage of the set of FILEs, recursively for directories.

  -a, --all              write counts for all files, not just directories
  -B SIZE                scale sizes by SIZE before printing them
  -b, --bytes            equivalent to '-B 1'
  -c, --total            produce a grand total
  -h, --human-readable   print sizes in human readable format (e.g., 1K 234M 2G)
  -k                     like --block-size=1024 (default)
  -s, --summarize        display only a total for each argument
  -d N, --max-depth=N    print the total for a directory only if it is N or
                         fewer levels below the command-line argument
  --help                 display this help and exit
`;

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

function parseDuArgv(args) {
  let humanReadable = false;
  let all = false;
  let summarize = false;
  let total = false;
  let blockSize = 1024;
  let maxDepth = null;
  const operands = [];
  let i = 0;
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
    if (a === '-a' || a === '--all') {
      all = true;
      continue;
    }
    if (a === '-s' || a === '--summarize') {
      summarize = true;
      continue;
    }
    if (a === '-c' || a === '--total') {
      total = true;
      continue;
    }
    if (a === '-k') {
      blockSize = 1024;
      continue;
    }
    if (a === '-b' || a === '--bytes') {
      blockSize = 1;
      continue;
    }
    if (a === '-B') {
      if (i >= args.length) return { ok: false, stderr: "du: option '-B' requires an argument\n", exitCode: 2 };
      const n = parseInt(args[i++], 10);
      if (!Number.isFinite(n) || n <= 0) return { ok: false, stderr: 'du: invalid -B argument\n', exitCode: 2 };
      blockSize = n;
      continue;
    }
    if (a === '-d') {
      if (i >= args.length) return { ok: false, stderr: "du: option '-d' requires an argument\n", exitCode: 2 };
      const n = parseInt(args[i++], 10);
      if (!Number.isFinite(n) || n < 0) return { ok: false, stderr: 'du: invalid -d argument\n', exitCode: 2 };
      maxDepth = n;
      continue;
    }
    if (a.startsWith('--max-depth=')) {
      const n = parseInt(a.slice('--max-depth='.length), 10);
      if (!Number.isFinite(n) || n < 0) return { ok: false, stderr: 'du: invalid --max-depth\n', exitCode: 2 };
      maxDepth = n;
      continue;
    }
    if (a.startsWith('-') && a.length > 1 && !a.startsWith('--')) {
      for (let j = 1; j < a.length; j++) {
        const c = a[j];
        if (c === 'h') humanReadable = true;
        else if (c === 'a') all = true;
        else if (c === 's') summarize = true;
        else if (c === 'c') total = true;
        else if (c === 'b') blockSize = 1;
        else if (c === 'k') blockSize = 1024;
        else return { ok: false, stderr: `du: invalid option -- '${c}'\n`, exitCode: 2 };
      }
      continue;
    }
    operands.push(a);
  }
  if (operands.length === 0) operands.push('.');
  return { ok: true, humanReadable, all, summarize, total, blockSize, maxDepth, operands };
}

async function computeUsage(terminal, absPath, parsed, baseDepth, lines, displayPath) {
  const item = await terminal.getFileSystemItem(absPath);
  if (!item) {
    return { size: 0, missing: true };
  }
  if (item.type !== 'directory') {
    const size = item.size != null ? item.size : 0;
    if (parsed.all || displayPath != null) {
      const allowed = parsed.summarize ? displayPath != null : (parsed.maxDepth == null || baseDepth <= parsed.maxDepth);
      if (allowed && parsed.all) {
        lines.push(fmtLine(size, displayPath ?? absPath, parsed));
      }
    }
    return { size };
  }
  let total = 0;
  const children = await terminal.listDirectoryContents(absPath);
  for (const c of children) {
    const childName = terminal.fileSystemDB.getFileName(c.path);
    const r = await computeUsage(
      terminal,
      c.path,
      parsed,
      baseDepth + 1,
      lines,
      displayPath ? `${displayPath}/${childName}` : c.path
    );
    total += r.size;
  }
  if (displayPath != null) {
    const withinDepth = parsed.maxDepth == null || baseDepth <= parsed.maxDepth;
    if (!parsed.summarize && withinDepth) {
      lines.push(fmtLine(total, displayPath, parsed));
    }
  }
  return { size: total };
}

function fmtLine(bytes, name, parsed) {
  const sizeStr = parsed.humanReadable ? humanSize(bytes) : String(Math.ceil(bytes / parsed.blockSize));
  return `${sizeStr}\t${name}`;
}

async function duHandler(terminal, args) {
  const parsed = parseDuArgv(args || []);
  if (parsed.ok === false) return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
  if (parsed.help) return { stdout: DU_HELP, stderr: '', exitCode: 0 };

  const lines = [];
  let grandTotal = 0;
  let exitCode = 0;
  let stderr = '';
  for (const op of parsed.operands) {
    const abs = terminal.resolvePath(op);
    const startLines = lines.length;
    const r = await computeUsage(terminal, abs, parsed, 0, lines, op);
    if (r.missing) {
      stderr += `du: cannot access '${op}': No such file or directory\n`;
      exitCode = 1;
      continue;
    }
    // The top-level summary line always appears (either via the recursion or here).
    if (parsed.summarize) {
      lines.length = startLines;
      lines.push(fmtLine(r.size, op, parsed));
    } else if (lines.length === startLines) {
      lines.push(fmtLine(r.size, op, parsed));
    }
    grandTotal += r.size;
  }
  if (parsed.total) lines.push(fmtLine(grandTotal, 'total', parsed));
  return { stdout: lines.length ? lines.join('\n') + '\n' : '', stderr, exitCode };
}

export default {
  name: 'du',
  handler: duHandler,
  description: 'estimate file space usage (-h -s -a -c -d -B)',
  category: 'File System'
};

export { parseDuArgv, humanSize };

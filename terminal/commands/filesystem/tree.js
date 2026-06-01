// tree — recursive directory listing with box-drawing connectors.
//
// Modeled on the classic `tree` utility. Walks the VFS via the same
// getFileSystemItem / listDirectoryContents APIs that `find` uses.

const TREE_HELP = `Usage: tree [OPTION]... [PATH]
List PATH (default: current directory) recursively, with branch connectors.

  -a               include hidden files (starting with '.')
  -d               list directories only
  -L LEVEL         descend at most LEVEL directories deep
  -f               print full path prefix on each entry
  --noreport       omit the trailing summary
  --dirsfirst      list directories before files in each level (default)
  --no-dirsfirst   sort dirs and files together
  --help           this help

Exit status: 0 on success, 1 on read errors, 2 on usage errors.
`;

const PIPE = '│   ';
const BRANCH = '├── ';
const LAST = '└── ';
const SPACE = '    ';

function compareEntries(a, b, dirsFirst) {
  if (dirsFirst) {
    const ad = a.type === 'directory' ? 0 : 1;
    const bd = b.type === 'directory' ? 0 : 1;
    if (ad !== bd) return ad - bd;
  }
  return a.basename.localeCompare(b.basename, undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * @param {object} terminal
 * @param {string} path
 * @returns {Promise<Array<{ path: string, basename: string, type: string }>>}
 */
async function listChildren(terminal, path) {
  const raw = await terminal.listDirectoryContents(path);
  return raw.map((entry) => ({
    path: entry.path,
    basename: terminal.fileSystemDB.getFileName(entry.path) || entry.path,
    type: entry.type
  }));
}

async function treeHandler(terminal, args) {
  let showHidden = false;
  let dirsOnly = false;
  let fullPaths = false;
  let dirsFirst = true;
  let report = true;
  let maxDepth = Infinity;
  let target = '.';

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--help') return { stdout: TREE_HELP, stderr: '', exitCode: 0 };
    if (a === '-a') {
      showHidden = true;
      continue;
    }
    if (a === '-d') {
      dirsOnly = true;
      continue;
    }
    if (a === '-f') {
      fullPaths = true;
      continue;
    }
    if (a === '--noreport') {
      report = false;
      continue;
    }
    if (a === '--dirsfirst') {
      dirsFirst = true;
      continue;
    }
    if (a === '--no-dirsfirst') {
      dirsFirst = false;
      continue;
    }
    if (a === '-L') {
      const n = parseInt(args[++i], 10);
      if (!Number.isFinite(n) || n < 1) {
        return { stdout: '', stderr: `tree: invalid level: ${args[i]}\n`, exitCode: 2 };
      }
      maxDepth = n;
      continue;
    }
    if (a.startsWith('-')) {
      return {
        stdout: '',
        stderr: `tree: invalid option ${a}\nTry 'tree --help' for more information.\n`,
        exitCode: 2
      };
    }
    target = a;
  }

  const rootPath = terminal.resolvePath(target);
  const rootItem = await terminal.getFileSystemItem(rootPath);
  if (!rootItem) {
    return {
      stdout: '',
      stderr: `tree: ${target}: No such file or directory\n`,
      exitCode: 1
    };
  }

  const lines = [];
  // tree prints the path you asked for (not the resolved one), like the real CLI.
  lines.push(target);

  let dirCount = 0;
  let fileCount = 0;

  if (rootItem.type !== 'directory') {
    fileCount = 1;
    if (report) {
      lines.push('');
      lines.push('0 directories, 1 file');
    }
    return { stdout: lines.join('\n') + '\n', stderr: '', exitCode: 0 };
  }

  /**
   * @param {string} path
   * @param {string} prefix
   * @param {number} depth current depth (1-based; root is 0)
   */
  async function walk(path, prefix, depth) {
    let entries;
    try {
      entries = await listChildren(terminal, path);
    } catch (err) {
      lines.push(`${prefix}${LAST}[error: ${err.message}]`);
      return;
    }

    if (!showHidden) {
      entries = entries.filter((e) => !e.basename.startsWith('.'));
    }
    entries.sort((a, b) => compareEntries(a, b, dirsFirst));

    const visible = dirsOnly ? entries.filter((e) => e.type === 'directory') : entries;

    for (let i = 0; i < visible.length; i++) {
      const entry = visible[i];
      const isLast = i === visible.length - 1;
      const connector = isLast ? LAST : BRANCH;
      const label = fullPaths ? entry.path : entry.basename;
      lines.push(`${prefix}${connector}${label}`);

      if (entry.type === 'directory') dirCount++;
      else fileCount++;

      if (entry.type === 'directory' && depth < maxDepth) {
        const nextPrefix = prefix + (isLast ? SPACE : PIPE);
        await walk(entry.path, nextPrefix, depth + 1);
      }
    }
  }

  await walk(rootPath, '', 1);

  if (report) {
    lines.push('');
    lines.push(
      `${dirCount} director${dirCount === 1 ? 'y' : 'ies'}, ${fileCount} file${
        fileCount === 1 ? '' : 's'
      }`
    );
  }

  return { stdout: lines.join('\n') + '\n', stderr: '', exitCode: 0 };
}

export default {
  name: 'tree',
  handler: treeHandler,
  description: 'list directory contents recursively as a tree (-a, -d, -L, -f, --noreport)',
  category: 'File System'
};

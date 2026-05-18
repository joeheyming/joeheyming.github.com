// grep command — JS regex by default, -E/-F/-w/-r/-l/-L/--color (B9)
import { GrepLib } from './grep-lib.js';
import { VfsUtils } from '../../lib/vfs-utils.js';

async function collectFilesRecursive(terminal, startPath) {
  const out = [];
  async function walk(p) {
    const item = await terminal.getFileSystemItem(p);
    if (!item) return;
    if (item.type === 'file') {
      out.push(p);
      return;
    }
    if (item.type !== 'directory') return;
    const entries = await terminal.listDirectoryContents(p);
    for (const e of entries || []) {
      await walk(e.path);
    }
  }
  await walk(startPath);
  return out;
}

async function grepHandler(terminal, args) {
  const parsed = GrepLib.parseGrepArgv(args);
  if (parsed.ok === false) {
    return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
  }
  if (parsed.help) {
    return { stdout: GrepLib.GREP_HELP, stderr: '', exitCode: 0 };
  }

  const {
    caseInsensitive,
    lineNumbers,
    invertMatch,
    noFilename,
    fixedStrings,
    extended,
    wholeWord,
    recursive,
    filesWithMatches,
    filesWithoutMatch,
    color,
    pattern,
    fileOperands
  } = parsed;

  const reOrErr = GrepLib.buildGrepRegex({
    pattern,
    caseInsensitive,
    extended,
    fixedStrings,
    wholeWord
  });
  if (reOrErr && reOrErr.ok === false) {
    return { stdout: '', stderr: reOrErr.stderr, exitCode: 2 };
  }
  const re = /** @type {RegExp} */ (reOrErr);
  // For colorization, build a global version
  const reGlobal = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');

  const stdinAvailable =
    terminal.stdinSupplied === true || (terminal.hasStdin && terminal.stdin != null);
  const stdinText = stdinAvailable ? (terminal.stdin != null ? String(terminal.stdin) : '') : '';

  /** @type {{ name: string, content: string }[]} */
  const searchFiles = [];
  const stderrLines = [];

  if (fileOperands.length === 0 && !recursive) {
    if (!stdinAvailable) {
      return {
        stdout: '',
        stderr: 'grep: no input (use a pipe or specify file operands)\n',
        exitCode: 2
      };
    }
    searchFiles.push({ name: '(standard input)', content: stdinText });
  } else if (recursive) {
    const roots = fileOperands.length > 0 ? fileOperands : ['.'];
    for (const root of roots) {
      const resolved = terminal.resolvePath(root);
      const files = await collectFilesRecursive(terminal, resolved);
      for (const fp of files) {
        const item = await terminal.getFileSystemItem(fp);
        if (!item) continue;
        const d = VfsUtils.fileItemUtf8ForDisplay(item);
        if (d.isBinary) continue;
        searchFiles.push({ name: fp, content: d.text });
      }
    }
  } else {
    for (const op of fileOperands) {
      if (op === '-') {
        if (!stdinAvailable) {
          stderrLines.push('grep: -: No such file or directory');
          continue;
        }
        searchFiles.push({ name: '(standard input)', content: stdinText });
        continue;
      }
      const res = await VfsUtils.vfsFollowSymlinksToFile(terminal, op, 'grep');
      if (res.ok === false) {
        stderrLines.push(res.stderr.trimEnd());
        continue;
      }
      const d = VfsUtils.fileItemUtf8ForDisplay(res.file);
      searchFiles.push({ name: op, content: d.isBinary ? '' : d.text });
    }
  }

  const showPrefix = !noFilename && (recursive || searchFiles.length > 1);
  const results = [];
  const filesMatched = [];
  const filesUnmatched = [];

  const RED = '\x1b[1;31m';
  const RESET = '\x1b[0m';
  const useColor = color === 'always';

  for (const file of searchFiles) {
    const lines = file.content.split('\n');
    let anyMatch = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const matched = re.test(line);
      const include = (matched && !invertMatch) || (!matched && invertMatch);
      if (!include) continue;
      anyMatch = true;
      if (filesWithMatches || filesWithoutMatch) break;
      const renderLine = useColor ? line.replace(reGlobal, (m) => `${RED}${m}${RESET}`) : line;
      const prefix = showPrefix ? `${file.name}:` : '';
      const lineNum = lineNumbers ? `${i + 1}:` : '';
      results.push(`${prefix}${lineNum}${renderLine}`);
    }
    if (anyMatch) filesMatched.push(file.name);
    else filesUnmatched.push(file.name);
  }

  if (filesWithMatches) {
    const stdout = filesMatched.length > 0 ? filesMatched.join('\n') : '';
    return {
      stdout,
      stderr: stderrLines.length > 0 ? stderrLines.join('\n') + '\n' : '',
      exitCode:
        stderrLines.length > 0 ? 2 : filesMatched.length === 0 ? 1 : 0
    };
  }
  if (filesWithoutMatch) {
    const stdout = filesUnmatched.length > 0 ? filesUnmatched.join('\n') : '';
    return {
      stdout,
      stderr: stderrLines.length > 0 ? stderrLines.join('\n') + '\n' : '',
      exitCode:
        stderrLines.length > 0 ? 2 : filesUnmatched.length === 0 ? 1 : 0
    };
  }

  const stdout = results.length > 0 ? results.join('\n') : '';
  let exitCode;
  if (stderrLines.length > 0) exitCode = 2;
  else if (results.length === 0) exitCode = 1;
  else exitCode = 0;

  return {
    stdout,
    stderr: stderrLines.length > 0 ? stderrLines.join('\n') + '\n' : '',
    exitCode
  };
}

export default {
  name: 'grep',
  handler: grepHandler,
  description: 'search PATTERN (regex by default; -E -F -w -r -l -L -i -n -v -h --color)',
  category: 'File System'
};

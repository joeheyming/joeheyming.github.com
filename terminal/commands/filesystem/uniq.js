// uniq — report or omit repeated lines (GNU-style subset)
import { VfsUtils } from '../../lib/vfs-utils.js';
import { UniqLib } from './uniq-lib.js';

/** @param {string} text */
function splitLinesPreservingBlanks(text) {
  const t = String(text);
  if (t === '') return [];
  const lines = t.split('\n');
  if (t.endsWith('\n')) {
    lines.pop();
  }
  return lines;
}

/**
 * @param {string[]} lines
 * @param {{ count: boolean, repeatedOnly: boolean, uniqueOnly: boolean }} opts
 */
function uniqLines(lines, opts) {
  let { count, repeatedOnly, uniqueOnly } = opts;
  if (repeatedOnly && uniqueOnly) {
    uniqueOnly = false;
  }

  const groups = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    let j = i + 1;
    while (j < lines.length && lines[j] === line) j++;
    groups.push({ line, cnt: j - i });
    i = j;
  }

  const out = [];
  for (const g of groups) {
    if (repeatedOnly && g.cnt < 2) continue;
    if (uniqueOnly && g.cnt !== 1) continue;
    if (count) {
      out.push(`${String(g.cnt).padStart(7)} ${g.line}`);
    } else {
      out.push(g.line);
    }
  }
  return out;
}

/**
 * @param {Error} error
 * @param {string} arg
 */
function uniqStderrFromError(error, arg) {
  const msg = error && error.message ? String(error.message) : String(error);
  if (msg.startsWith('Parent directory does not exist:')) {
    return {
      stderr: `uniq: ${arg}: No such file or directory`,
      exitCode: 1
    };
  }
  return { stderr: `uniq: ${arg}: ${msg}`, exitCode: 1 };
}

async function uniqHandler(terminal, args) {
  const parsed = UniqLib.parseUniqArgv(args);
  if (parsed.ok === false) {
    return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
  }
  if (parsed.help) {
    return { stdout: UniqLib.UNIQ_HELP.trim() + '\n', stderr: '', exitCode: 0 };
  }

  const { count, repeatedOnly, uniqueOnly, operands } = parsed;

  let input = '';
  let inputEndsWithNewline = true;

  const op0 = operands[0];
  const op1 = operands[1];

  if (operands.length === 0) {
    if (terminal.stdinSupplied !== true && !(terminal.hasStdin && terminal.stdin != null)) {
      return { stdout: '', stderr: 'uniq: missing operand\n', exitCode: 1 };
    }
    input = terminal.stdin != null ? String(terminal.stdin) : '';
    inputEndsWithNewline = input === '' || input.endsWith('\n');
  } else if (op0 === '-') {
    if (terminal.stdinSupplied !== true && !(terminal.hasStdin && terminal.stdin != null)) {
      return { stdout: '', stderr: 'uniq: missing operand\n', exitCode: 1 };
    }
    input = terminal.stdin != null ? String(terminal.stdin) : '';
    inputEndsWithNewline = input === '' || input.endsWith('\n');
  } else {
    const res = await VfsUtils.vfsFollowSymlinksToFile(terminal, op0, 'uniq');
    if (res.ok === false) {
      return { stdout: '', stderr: res.stderr.trimEnd() + '\n', exitCode: 1 };
    }
    const d = VfsUtils.fileItemUtf8ForDisplay(res.file);
    input = d.isBinary ? '' : d.text;
    inputEndsWithNewline = input === '' || input.endsWith('\n');
  }

  const lines = splitLinesPreservingBlanks(input);
  const outLines = uniqLines(lines, { count, repeatedOnly, uniqueOnly });
  let textOut = outLines.join('\n');
  if (outLines.length > 0 && inputEndsWithNewline) {
    textOut += '\n';
  }

  if (op1 !== undefined) {
    const outPath = terminal.resolvePath(op1);
    const existing = await terminal.getFileSystemItem(outPath);
    if (existing && existing.type === 'directory') {
      return { stdout: '', stderr: `uniq: ${op1}: Is a directory\n`, exitCode: 1 };
    }
    if (existing && existing.type === 'symlink') {
      return { stdout: '', stderr: `uniq: ${op1}: Is a symbolic link\n`, exitCode: 1 };
    }
    try {
      await terminal.fileSystemDB.createFile(outPath, textOut, true);
    } catch (error) {
      const { stderr, exitCode } = uniqStderrFromError(error, op1);
      return { stdout: '', stderr: stderr + '\n', exitCode };
    }
    return { stdout: '', stderr: '', exitCode: 0 };
  }

  return { stdout: textOut, stderr: '', exitCode: 0 };
}

export default {
  name: 'uniq',
  handler: uniqHandler,
  description: 'report or omit repeated lines (-c -d -u; INPUT [OUTPUT]; symlink input; --help)',
  category: 'File System'
};

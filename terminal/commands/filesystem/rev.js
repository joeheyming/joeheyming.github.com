// rev — reverse the characters of each line (FILE / stdin)

import { VfsUtils } from '../../lib/vfs-utils.js';

const REV_HELP = `Usage: rev [FILE]...
Reverse the characters of each line.

With no FILE, or when FILE is -, read standard input.

      --help    display this help and exit
`;

/** Reverse a single line, preserving multi-byte UTF-16 surrogate pairs. */
function reverseLine(line) {
  return Array.from(line).reverse().join('');
}

/** Reverse each line in `text`, preserving a trailing newline if present. */
function reverseChunk(text) {
  if (text === '') return '';
  const hasTrailingNL = text.endsWith('\n');
  const body = hasTrailingNL ? text.slice(0, -1) : text;
  const reversed = body.split('\n').map(reverseLine).join('\n');
  return hasTrailingNL ? reversed + '\n' : reversed;
}

async function revHandler(terminal, args) {
  if (args.includes('--help') || args.includes('-h')) {
    return { stdout: REV_HELP, stderr: '', exitCode: 0 };
  }

  // Treat `--` as end-of-options; everything after is a file operand.
  const operands = [];
  let endOfOpts = false;
  for (const a of args) {
    if (!endOfOpts && a === '--') {
      endOfOpts = true;
      continue;
    }
    operands.push(a);
  }

  const stdinAvailable =
    terminal.stdinSupplied === true || (terminal.hasStdin && terminal.stdin != null);
  const stdinText = stdinAvailable ? (terminal.stdin != null ? String(terminal.stdin) : '') : '';

  if (operands.length === 0) {
    if (!stdinAvailable) {
      return { stdout: '', stderr: 'rev: missing operand\n', exitCode: 1 };
    }
    return { stdout: reverseChunk(stdinText), stderr: '', exitCode: 0 };
  }

  const chunks = [];
  const stderrLines = [];
  for (const op of operands) {
    if (op === '-') {
      chunks.push(reverseChunk(stdinText));
      continue;
    }
    const res = await VfsUtils.vfsFollowSymlinksToFile(terminal, op, 'rev');
    if (res.ok === false) {
      stderrLines.push(res.stderr.trimEnd());
      continue;
    }
    const d = VfsUtils.fileItemUtf8ForDisplay(res.file);
    if (d.isBinary) {
      stderrLines.push(`rev: ${op}: binary file (skipped)`);
      continue;
    }
    chunks.push(reverseChunk(d.text));
  }

  return {
    stdout: chunks.join(''),
    stderr: stderrLines.length ? stderrLines.join('\n') + '\n' : '',
    exitCode: stderrLines.length > 0 ? 1 : 0
  };
}

export default {
  name: 'rev',
  handler: revHandler,
  description: 'reverse the characters of each line (FILE or -, stdin if no FILE)',
  category: 'File System'
};

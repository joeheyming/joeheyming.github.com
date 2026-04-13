// paste — merge lines of files (GNU-style subset: -d -s -z, - for stdin, symlink follow)
import { VfsUtils } from '../../lib/vfs-utils.js';
import { PasteLib } from './paste-lib.js';

async function pasteHandler(terminal, args) {
  const parsed = PasteLib.parsePasteArgv(args);
  if (parsed.ok === false) {
    return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
  }
  if (parsed.help) {
    return { stdout: PasteLib.PASTE_HELP, stderr: '', exitCode: 0 };
  }

  const { delimiterList, serial, nullTerminated, operands } = parsed;
  const stdinAvailable =
    terminal.stdinSupplied === true || (terminal.hasStdin && terminal.stdin != null);
  const stdinText = stdinAvailable ? (terminal.stdin != null ? String(terminal.stdin) : '') : '';

  async function linesForOperand(op) {
    if (op === '-') {
      return { lines: PasteLib.pasteSplitLines(stdinText, nullTerminated) };
    }
    const res = await VfsUtils.vfsFollowSymlinksToFile(terminal, op, 'paste');
    if (res.ok === false) {
      return { err: res.stderr.trimEnd() };
    }
    const d = VfsUtils.fileItemUtf8ForDisplay(res.file);
    const text = d.isBinary ? '[binary file]' : d.text;
    return { lines: PasteLib.pasteSplitLines(text, nullTerminated) };
  }

  if (operands.length === 0) {
    if (!stdinAvailable) {
      return { stdout: '', stderr: 'paste: missing operand\n', exitCode: 1 };
    }
    const lines = PasteLib.pasteSplitLines(stdinText, nullTerminated);
    const outLines = serial
      ? PasteLib.pasteJoinSerialRows([lines], delimiterList)
      : PasteLib.pasteJoinParallelRows([lines], delimiterList);
    return {
      stdout: PasteLib.pasteFormatOutputLines(outLines, nullTerminated),
      stderr: '',
      exitCode: 0
    };
  }

  const stderrLines = [];
  const columnData = [];

  for (const op of operands) {
    const got = await linesForOperand(op);
    if (got.err) {
      stderrLines.push(got.err);
    } else {
      columnData.push(got.lines);
    }
  }

  if (stderrLines.length > 0) {
    return {
      stdout: '',
      stderr: stderrLines.join('\n') + '\n',
      exitCode: 1
    };
  }

  let outLines;
  if (serial) {
    outLines = PasteLib.pasteJoinSerialRows(columnData, delimiterList);
  } else {
    outLines = PasteLib.pasteJoinParallelRows(columnData, delimiterList);
  }

  const stdout = PasteLib.pasteFormatOutputLines(outLines, nullTerminated);
  return { stdout, stderr: '', exitCode: 0 };
}

export default {
  name: 'paste',
  handler: pasteHandler,
  description: 'merge lines of files (-d -s -z, - for stdin, --)',
  category: 'File System'
};

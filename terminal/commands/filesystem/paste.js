// paste — merge lines of files (GNU-style subset: -d -s -z, - for stdin, symlink follow)
(function () {
  'use strict';

  registerCommand(
    'paste',
    async (terminal, args) => {
      const parsed = ShellUtils.parsePasteArgv(args);
      if (!parsed.ok) {
        return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
      }
      if (parsed.help) {
        return { stdout: ShellUtils.PASTE_HELP, stderr: '', exitCode: 0 };
      }

      const { delimiterList, serial, nullTerminated, operands } = parsed;
      const stdinAvailable =
        terminal.stdinSupplied === true || (terminal.hasStdin && terminal.stdin != null);
      const stdinText = stdinAvailable
        ? terminal.stdin != null
          ? String(terminal.stdin)
          : ''
        : '';

      async function linesForOperand(op) {
        if (op === '-') {
          return { lines: ShellUtils.pasteSplitLines(stdinText, nullTerminated) };
        }
        const res = await ShellUtils.vfsFollowSymlinksToFile(terminal, op, 'paste');
        if (!res.ok) {
          return { err: res.stderr.trimEnd() };
        }
        const d = ShellUtils.fileItemUtf8ForDisplay(res.file);
        const text = d.isBinary ? '[binary file]' : d.text;
        return { lines: ShellUtils.pasteSplitLines(text, nullTerminated) };
      }

      if (operands.length === 0) {
        if (!stdinAvailable) {
          return { stdout: '', stderr: 'paste: missing operand\n', exitCode: 1 };
        }
        const lines = ShellUtils.pasteSplitLines(stdinText, nullTerminated);
        const outLines = serial
          ? ShellUtils.pasteJoinSerialRows([lines], delimiterList)
          : ShellUtils.pasteJoinParallelRows([lines], delimiterList);
        return {
          stdout: ShellUtils.pasteFormatOutputLines(outLines, nullTerminated),
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
        outLines = ShellUtils.pasteJoinSerialRows(columnData, delimiterList);
      } else {
        outLines = ShellUtils.pasteJoinParallelRows(columnData, delimiterList);
      }

      const stdout = ShellUtils.pasteFormatOutputLines(outLines, nullTerminated);
      return { stdout, stderr: '', exitCode: 0 };
    },
    'merge lines of files (-d -s -z, - for stdin, --)',
    'File System'
  );
})();

// fold — wrap lines to a fixed width (GNU-style subset: -b -s -w, multiple FILEs, - for stdin, --)
(function () {
  'use strict';

  registerCommand(
    'fold',
    async (terminal, args) => {
      const parsed = ShellUtils.parseFoldArgv(args);
      if (!parsed.ok) {
        return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
      }
      if (parsed.help) {
        return { stdout: ShellUtils.FOLD_HELP, stderr: '', exitCode: 0 };
      }
      if (parsed.version) {
        return { stdout: ShellUtils.FOLD_VERSION_LINE, stderr: '', exitCode: 0 };
      }

      const { operands, width, bytesMode, breakAtSpaces } = parsed;
      const stdinAvailable =
        terminal.stdinSupplied === true || (terminal.hasStdin && terminal.stdin != null);
      const stdinText = stdinAvailable
        ? terminal.stdin != null
          ? String(terminal.stdin)
          : ''
        : '';

      if (operands.length === 0) {
        if (!stdinAvailable) {
          return { stdout: '', stderr: 'fold: missing operand\n', exitCode: 1 };
        }
        return {
          stdout: ShellUtils.foldFoldText(stdinText, width, bytesMode, breakAtSpaces),
          stderr: '',
          exitCode: 0
        };
      }

      const chunks = [];
      const stderrLines = [];
      for (const op of operands) {
        if (op === '-') {
          chunks.push(ShellUtils.foldFoldText(stdinText, width, bytesMode, breakAtSpaces));
          continue;
        }
        const res = await ShellUtils.vfsFollowSymlinksToFile(terminal, op, 'fold');
        if (!res.ok) {
          stderrLines.push(res.stderr.trimEnd());
          continue;
        }
        const d = ShellUtils.fileItemUtf8ForDisplay(res.file);
        const text = d.isBinary ? '[binary file]\n' : d.text;
        chunks.push(ShellUtils.foldFoldText(text, width, bytesMode, breakAtSpaces));
      }

      const stdout = chunks.join('');
      const stderr = stderrLines.length ? stderrLines.join('\n') + '\n' : '';
      const exitCode = stderrLines.length > 0 ? 1 : 0;
      return { stdout, stderr, exitCode };
    },
    'wrap lines to a fixed width (GNU-style -b/-s/-w, multiple FILEs, - for stdin, --)',
    'File System'
  );
})();

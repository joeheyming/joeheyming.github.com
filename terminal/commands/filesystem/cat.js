// cat command — concatenate files to stdout (GNU-style multi-file, - for stdin, --, symlink follow)
(function () {
  'use strict';

  registerCommand(
    'cat',
    async (terminal, args) => {
      const parsed = ShellUtils.parseCatArgv(args);
      if (!parsed.ok) {
        return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
      }
      if (parsed.help) {
        return { stdout: ShellUtils.CAT_HELP, stderr: '', exitCode: 0 };
      }

      const { operands } = parsed;
      const stdinAvailable =
        terminal.stdinSupplied === true || (terminal.hasStdin && terminal.stdin != null);
      const stdinText = stdinAvailable
        ? terminal.stdin != null
          ? String(terminal.stdin)
          : ''
        : '';

      if (operands.length === 0) {
        if (!stdinAvailable) {
          return { stdout: '', stderr: 'cat: missing operand\n', exitCode: 1 };
        }
        return { stdout: stdinText, stderr: '', exitCode: 0 };
      }

      const chunks = [];
      const stderrLines = [];
      for (const op of operands) {
        if (op === '-') {
          chunks.push(stdinText);
          continue;
        }
        const res = await ShellUtils.vfsFollowSymlinksToFile(terminal, op, 'cat');
        if (!res.ok) {
          stderrLines.push(res.stderr.trimEnd());
          continue;
        }
        const d = ShellUtils.fileItemUtf8ForDisplay(res.file);
        chunks.push(d.isBinary ? '[binary file]\n' : d.text);
      }

      const stdout = chunks.join('');
      const stderr = stderrLines.length ? stderrLines.join('\n') + '\n' : '';
      const exitCode = stderrLines.length > 0 ? 1 : 0;
      return { stdout, stderr, exitCode };
    },
    'concatenate files to standard output (multiple FILEs, - for stdin, --)',
    'File System'
  );
})();

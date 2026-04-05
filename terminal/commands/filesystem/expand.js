// expand — convert tabs to spaces (GNU-style subset: -i -t, - for stdin, symlink follow)
(function () {
  'use strict';

  registerCommand(
    'expand',
    async (terminal, args) => {
      const parsed = ShellUtils.parseExpandArgv(args);
      if (!parsed.ok) {
        return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
      }
      if (parsed.help) {
        return { stdout: ShellUtils.EXPAND_HELP, stderr: '', exitCode: 0 };
      }
      if (parsed.version) {
        return { stdout: ShellUtils.EXPAND_VERSION_LINE, stderr: '', exitCode: 0 };
      }

      const { operands, tabSpec, initialOnly } = parsed;
      const stdinAvailable =
        terminal.stdinSupplied === true || (terminal.hasStdin && terminal.stdin != null);
      const stdinText = stdinAvailable
        ? terminal.stdin != null
          ? String(terminal.stdin)
          : ''
        : '';

      if (operands.length === 0) {
        if (!stdinAvailable) {
          return { stdout: '', stderr: 'expand: missing operand\n', exitCode: 1 };
        }
        return {
          stdout: ShellUtils.expandExpandText(stdinText, tabSpec, initialOnly),
          stderr: '',
          exitCode: 0
        };
      }

      const chunks = [];
      const stderrLines = [];
      for (const op of operands) {
        if (op === '-') {
          chunks.push(ShellUtils.expandExpandText(stdinText, tabSpec, initialOnly));
          continue;
        }
        const res = await ShellUtils.vfsFollowSymlinksToFile(terminal, op, 'expand');
        if (!res.ok) {
          stderrLines.push(res.stderr.trimEnd());
          continue;
        }
        const d = ShellUtils.fileItemUtf8ForDisplay(res.file);
        const text = d.isBinary ? '[binary file]\n' : d.text;
        chunks.push(ShellUtils.expandExpandText(text, tabSpec, initialOnly));
      }

      const stdout = chunks.join('');
      const stderr = stderrLines.length ? stderrLines.join('\n') + '\n' : '';
      const exitCode = stderrLines.length > 0 ? 1 : 0;
      return { stdout, stderr, exitCode };
    },
    'convert tabs to spaces (GNU-style -i/-t, multiple FILEs, - for stdin, --)',
    'File System'
  );
})();

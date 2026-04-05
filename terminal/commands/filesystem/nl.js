// nl — number lines (GNU-style subset: multi-file, - for stdin, symlink follow)
(function () {
  'use strict';

  registerCommand(
    'nl',
    async (terminal, args) => {
      const parsed = ShellUtils.parseNlArgv(args);
      if (!parsed.ok) {
        return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
      }
      if (parsed.help) {
        return { stdout: ShellUtils.NL_HELP, stderr: '', exitCode: 0 };
      }

      const { bodyNumbering, numberFormat, numberWidth, separator, operands } = parsed;
      const nlOpts = { bodyNumbering, numberFormat, numberWidth, separator };

      const stdinAvailable =
        terminal.stdinSupplied === true || (terminal.hasStdin && terminal.stdin != null);
      const stdinText = stdinAvailable
        ? terminal.stdin != null
          ? String(terminal.stdin)
          : ''
        : '';

      if (operands.length === 0) {
        if (!stdinAvailable) {
          return { stdout: '', stderr: 'nl: missing operand\n', exitCode: 1 };
        }
        const out = ShellUtils.formatNlNumberedText(stdinText, nlOpts);
        return { stdout: out, stderr: '', exitCode: 0 };
      }

      const chunks = [];
      const stderrLines = [];
      const multi = operands.length > 1;

      for (const op of operands) {
        let text = '';
        let label = op;
        if (op === '-') {
          label = '-';
          text = stdinText;
        } else {
          const res = await ShellUtils.vfsFollowSymlinksToFile(terminal, op, 'nl');
          if (!res.ok) {
            stderrLines.push(res.stderr.trimEnd());
            continue;
          }
          const d = ShellUtils.fileItemUtf8ForDisplay(res.file);
          text = d.isBinary ? '[binary file]' : d.text;
        }
        const block = ShellUtils.formatNlNumberedText(text, nlOpts);
        if (multi) {
          chunks.push(`==> ${label} <==\n${block}`);
        } else {
          chunks.push(block);
        }
      }

      if (chunks.length === 0) {
        const stderr = stderrLines.length ? stderrLines.join('\n') + '\n' : '';
        return { stdout: '', stderr, exitCode: 1 };
      }

      const stdout = chunks.join('');
      const stderr = stderrLines.length ? stderrLines.join('\n') + '\n' : '';
      const exitCode = stderrLines.length > 0 ? 1 : 0;
      return { stdout, stderr, exitCode };
    },
    'number lines of files (-b -n -w -s, multiple FILEs, - for stdin, --)',
    'File System'
  );
})();

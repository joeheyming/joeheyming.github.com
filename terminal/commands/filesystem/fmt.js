// fmt — reformat paragraphs (GNU-style subset: -s -u -w, multiple FILEs, - for stdin, --)
(function () {
  'use strict';

  registerCommand(
    'fmt',
    async (terminal, args) => {
      const parsed = ShellUtils.parseFmtArgv(args);
      if (!parsed.ok) {
        return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
      }
      if (parsed.help) {
        return { stdout: ShellUtils.FMT_HELP, stderr: '', exitCode: 0 };
      }
      if (parsed.version) {
        return { stdout: ShellUtils.FMT_VERSION_LINE, stderr: '', exitCode: 0 };
      }

      const {
        operands,
        width,
        goal,
        splitOnly,
        uniformSpacing,
        crownMargin,
        taggedParagraph,
        prefix
      } = parsed;
      const stdinAvailable =
        terminal.stdinSupplied === true || (terminal.hasStdin && terminal.stdin != null);
      const stdinText = stdinAvailable
        ? terminal.stdin != null
          ? String(terminal.stdin)
          : ''
        : '';

      if (operands.length === 0) {
        if (!stdinAvailable) {
          return { stdout: '', stderr: 'fmt: missing operand\n', exitCode: 1 };
        }
        return {
          stdout: ShellUtils.fmtFmtText(
            stdinText,
            width,
            splitOnly,
            uniformSpacing,
            crownMargin,
            taggedParagraph,
            prefix,
            goal
          ),
          stderr: '',
          exitCode: 0
        };
      }

      const chunks = [];
      const stderrLines = [];
      for (const op of operands) {
        if (op === '-') {
          chunks.push(
            ShellUtils.fmtFmtText(
              stdinText,
              width,
              splitOnly,
              uniformSpacing,
              crownMargin,
              taggedParagraph,
              prefix,
              goal
            )
          );
          continue;
        }
        const res = await ShellUtils.vfsFollowSymlinksToFile(terminal, op, 'fmt');
        if (!res.ok) {
          stderrLines.push(res.stderr.trimEnd());
          continue;
        }
        const d = ShellUtils.fileItemUtf8ForDisplay(res.file);
        const text = d.isBinary ? '[binary file]\n' : d.text;
        chunks.push(
          ShellUtils.fmtFmtText(
            text,
            width,
            splitOnly,
            uniformSpacing,
            crownMargin,
            taggedParagraph,
            prefix,
            goal
          )
        );
      }

      const stdout = chunks.join('');
      const stderr = stderrLines.length ? stderrLines.join('\n') + '\n' : '';
      const exitCode = stderrLines.length > 0 ? 1 : 0;
      return { stdout, stderr, exitCode };
    },
    'reformat paragraphs (GNU-style -c/-p/-s/-t/-u/-w, multiple FILEs, - for stdin, --)',
    'File System'
  );
})();

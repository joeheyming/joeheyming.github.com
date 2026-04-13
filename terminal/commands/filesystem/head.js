// head command - output first lines of files or input
(function () {
  'use strict';

  function linesFromText(text) {
    if (text === '') {
      return [];
    }
    return String(text).split('\n');
  }

  registerCommand(
    'head',
    async (terminal, args) => {
      const parsed = LinesLib.parseLinesFilterArgv(args, 'head', 10);
      if (parsed.ok === false) {
        return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
      }
      if (parsed.help) {
        return { stdout: LinesLib.HEAD_HELP, stderr: '', exitCode: 0 };
      }

      const { lines, operands } = parsed;
      const stdinText = terminal.hasStdin && terminal.stdin != null ? String(terminal.stdin) : '';

      if (operands.length === 0) {
        if (!terminal.hasStdin || terminal.stdin == null) {
          return { stdout: '', stderr: 'head: missing operand\n', exitCode: 1 };
        }
        const out = linesFromText(stdinText).slice(0, lines).join('\n');
        return { stdout: out, stderr: '', exitCode: 0 };
      }

      const sections = [];
      const stderrLines = [];
      const showHeaders = operands.length > 1;

      for (const op of operands) {
        let label = op;
        let content = '';
        if (op === '-') {
          label = 'standard input';
          content = stdinText;
        } else {
          const res = await VfsUtils.vfsFollowSymlinksToFile(terminal, op, 'head');
          if (res.ok === false) {
            stderrLines.push(res.stderr);
            continue;
          }
          const d = VfsUtils.fileItemUtf8ForDisplay(res.file);
          content = d.isBinary ? '' : d.text;
        }
        const slice = linesFromText(content).slice(0, lines).join('\n');
        if (showHeaders) {
          sections.push(`==> ${label} <==\n${slice}`);
        } else {
          sections.push(slice);
        }
      }

      const stdout = sections.join('\n');
      const stderr = stderrLines.length
        ? stderrLines.join('\n') + (stderrLines.length ? '\n' : '')
        : '';
      const exitCode = stderrLines.length > 0 ? 1 : 0;
      return { stdout, stderr, exitCode };
    },
    'output first lines of files or stdin (-n NUM, -NUM, multiple FILEs, --)',
    'File System'
  );
})();

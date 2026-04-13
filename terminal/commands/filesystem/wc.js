// wc command — count lines, words, bytes (GNU-style multi-file, - for stdin, --)
(function () {
  'use strict';

  function countText(text) {
    const lines = (String(text).match(/\n/g) || []).length;
    const words = (String(text).match(/\S+/g) || []).length;
    const bytes = new TextEncoder().encode(String(text)).length;
    return { lines, words, bytes };
  }

  function formatRow(showAll, showLines, showWords, showBytes, counts, name) {
    const sl = showAll || showLines;
    const sw = showAll || showWords;
    const sb = showAll || showBytes;
    const parts = [];
    if (sl) parts.push(counts.lines);
    if (sw) parts.push(counts.words);
    if (sb) parts.push(counts.bytes);
    const nums = parts.map((n) => String(n).padStart(8));
    const line = nums.join('');
    return name !== undefined && name !== null ? `${line} ${name}` : line;
  }

  registerCommand(
    'wc',
    async (terminal, args) => {
      const parsed = WcLib.parseWcArgv(args);
      if (parsed.ok === false) {
        return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
      }
      if (parsed.help) {
        return { stdout: WcLib.WC_HELP, stderr: '', exitCode: 0 };
      }

      const { showLines, showWords, showBytes, showAll, operands } = parsed;
      const stdinText = terminal.hasStdin && terminal.stdin != null ? String(terminal.stdin) : '';

      if (operands.length === 0) {
        if (!terminal.hasStdin || terminal.stdin == null) {
          return { stdout: '', stderr: 'wc: missing operand\n', exitCode: 1 };
        }
        const c = countText(stdinText);
        const row = formatRow(showAll, showLines, showWords, showBytes, c, undefined);
        return { stdout: row + '\n', stderr: '', exitCode: 0 };
      }

      const stderrLines = [];
      const rows = [];
      let sumL = 0;
      let sumW = 0;
      let sumB = 0;

      for (const op of operands) {
        let text = '';
        let label = op;
        if (op === '-') {
          label = '-';
          text = stdinText;
        } else {
          const res = await VfsUtils.vfsFollowSymlinksToFile(terminal, op, 'wc');
          if (res.ok === false) {
            stderrLines.push(res.stderr.trimEnd());
            continue;
          }
          const d = VfsUtils.fileItemUtf8ForDisplay(res.file);
          text = d.isBinary ? '' : d.text;
        }
        const c = countText(text);
        sumL += c.lines;
        sumW += c.words;
        sumB += c.bytes;
        rows.push(formatRow(showAll, showLines, showWords, showBytes, c, label));
      }

      if (rows.length === 0) {
        const stderr = stderrLines.length ? stderrLines.join('\n') + '\n' : '';
        return { stdout: '', stderr, exitCode: 1 };
      }

      let out = rows.join('\n') + '\n';
      if (operands.length > 1 && rows.length > 1) {
        const total = formatRow(
          showAll,
          showLines,
          showWords,
          showBytes,
          {
            lines: sumL,
            words: sumW,
            bytes: sumB
          },
          'total'
        );
        out += total + '\n';
      }

      const stderr = stderrLines.length ? stderrLines.join('\n') + '\n' : '';
      const exitCode = stderrLines.length > 0 ? 1 : 0;
      return { stdout: out, stderr, exitCode };
    },
    'count lines, words, bytes (-l -w -c, multiple FILEs, - for stdin, --)',
    'File System'
  );
})();

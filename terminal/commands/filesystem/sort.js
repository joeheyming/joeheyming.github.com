// sort command — sort lines (GNU-style multi-file, - for stdin, --)
(function () {
  'use strict';

  /** Split text into lines; preserve blank lines; empty file → 0 lines. */
  function splitLinesPreservingBlanks(text) {
    const t = String(text);
    if (t === '') return [];
    const lines = t.split('\n');
    if (t.endsWith('\n')) {
      lines.pop();
    }
    return lines;
  }

  function sortLines(lines, reverse, numeric, unique) {
    let result = lines.slice();
    if (numeric) {
      result.sort((a, b) => {
        const numA = parseFloat(a) || 0;
        const numB = parseFloat(b) || 0;
        if (numA !== numB) {
          return reverse ? numB - numA : numA - numB;
        }
        return reverse ? b.localeCompare(a) : a.localeCompare(b);
      });
    } else {
      result.sort((a, b) => (reverse ? b.localeCompare(a) : a.localeCompare(b)));
    }
    if (unique) {
      const seen = new Set();
      const out = [];
      for (const line of result) {
        if (!seen.has(line)) {
          seen.add(line);
          out.push(line);
        }
      }
      result = out;
    }
    return result;
  }

  registerCommand(
    'sort',
    async (terminal, args) => {
      const parsed = SortLib.parseSortArgv(args);
      if (parsed.ok === false) {
        return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
      }
      if (parsed.help) {
        return { stdout: SortLib.SORT_HELP, stderr: '', exitCode: 0 };
      }

      const { reverse, numeric, unique, operands } = parsed;
      const stdinText = terminal.hasStdin && terminal.stdin != null ? String(terminal.stdin) : '';

      if (operands.length === 0) {
        if (!terminal.hasStdin || terminal.stdin == null) {
          return { stdout: '', stderr: 'sort: missing operand\n', exitCode: 1 };
        }
        const lines = splitLinesPreservingBlanks(stdinText);
        const sorted = sortLines(lines, reverse, numeric, unique);
        const out = sorted.length ? sorted.join('\n') + '\n' : '';
        return { stdout: out, stderr: '', exitCode: 0 };
      }

      const stderrLines = [];
      const parts = [];
      for (const op of operands) {
        if (op === '-') {
          parts.push(stdinText);
          continue;
        }
        const res = await VfsUtils.vfsFollowSymlinksToFile(terminal, op, 'sort');
        if (res.ok === false) {
          stderrLines.push(res.stderr.trimEnd());
          continue;
        }
        const d = VfsUtils.fileItemUtf8ForDisplay(res.file);
        parts.push(d.isBinary ? '' : d.text);
      }

      if (parts.length === 0) {
        const stderr = stderrLines.length ? stderrLines.join('\n') + '\n' : '';
        return { stdout: '', stderr, exitCode: 1 };
      }

      const input = parts.join('');
      const lines = splitLinesPreservingBlanks(input);
      const sorted = sortLines(lines, reverse, numeric, unique);
      const out = sorted.length ? sorted.join('\n') + '\n' : '';
      const stderr = stderrLines.length ? stderrLines.join('\n') + '\n' : '';
      const exitCode = stderrLines.length > 0 ? 1 : 0;
      return { stdout: out, stderr, exitCode };
    },
    'sort lines (-r -n -u, multiple FILEs, - for stdin, --)',
    'File System'
  );
})();

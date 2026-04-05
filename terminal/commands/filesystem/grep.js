// grep command — search for a literal substring (GNU-style argv, multi-file, - for stdin)
(function () {
  'use strict';

  registerCommand(
    'grep',
    async (terminal, args) => {
      const parsed = ShellUtils.parseGrepArgv(args);
      if (!parsed.ok) {
        return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
      }
      if (parsed.help) {
        return { stdout: ShellUtils.GREP_HELP, stderr: '', exitCode: 0 };
      }

      const { caseInsensitive, lineNumbers, invertMatch, noFilename, pattern, fileOperands } =
        parsed;

      const stdinAvailable =
        terminal.stdinSupplied === true || (terminal.hasStdin && terminal.stdin != null);
      const stdinText = stdinAvailable
        ? terminal.stdin != null
          ? String(terminal.stdin)
          : ''
        : '';

      /** @type {{ name: string, content: string }[]} */
      const searchFiles = [];
      const stderrLines = [];

      if (fileOperands.length === 0) {
        if (!stdinAvailable) {
          return {
            stdout: '',
            stderr: 'grep: no input (use a pipe or specify file operands)\n',
            exitCode: 2
          };
        }
        searchFiles.push({ name: '(standard input)', content: stdinText });
      } else {
        for (const op of fileOperands) {
          if (op === '-') {
            if (!stdinAvailable) {
              stderrLines.push('grep: -: No such file or directory');
              continue;
            }
            searchFiles.push({ name: '(standard input)', content: stdinText });
            continue;
          }
          const res = await ShellUtils.vfsFollowSymlinksToFile(terminal, op, 'grep');
          if (!res.ok) {
            stderrLines.push(res.stderr.trimEnd());
            continue;
          }
          const d = ShellUtils.fileItemUtf8ForDisplay(res.file);
          searchFiles.push({ name: op, content: d.isBinary ? '' : d.text });
        }
      }

      const showPrefix = !noFilename && searchFiles.length > 1;
      const results = [];

      function lineMatches(line) {
        const searchLine = caseInsensitive ? line.toLowerCase() : line;
        const p = caseInsensitive ? pattern.toLowerCase() : pattern;
        const matches = searchLine.includes(p);
        return (matches && !invertMatch) || (!matches && invertMatch);
      }

      for (const file of searchFiles) {
        const lines = file.content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (!lineMatches(line)) {
            continue;
          }
          const prefix = showPrefix ? `${file.name}:` : '';
          const lineNum = lineNumbers ? `${i + 1}:` : '';
          results.push(`${prefix}${lineNum}${line}`);
        }
      }

      const stdout = results.length > 0 ? results.join('\n') : '';
      let exitCode;
      if (stderrLines.length > 0) {
        exitCode = 2;
      } else if (results.length === 0) {
        exitCode = 1;
      } else {
        exitCode = 0;
      }

      return {
        stdout,
        stderr: stderrLines.length > 0 ? stderrLines.join('\n') + '\n' : '',
        exitCode
      };
    },
    'search for literal PATTERN in FILEs or stdin (-i -n -v -h, --, - for stdin)',
    'File System'
  );
})();

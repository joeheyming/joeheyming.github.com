// sed — stream editor (GNU-style subset: literal s///, -n, -e, FILEs / stdin)
(function () {
  'use strict';

  registerCommand(
    'sed',
    async (terminal, args) => {
      const parsed = SedLib.parseSedArgv(args);
      if (parsed.ok === false) {
        return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
      }
      if (parsed.help) {
        return { stdout: SedLib.SED_HELP, stderr: '', exitCode: 0 };
      }

      /** @type {Array<{ kind: 'delete', address?: null | { type: 'single', n: number } | { type: 'single', last: true } | { type: 'range', start: number, end: number | 'last' } | { type: 'pattern', pattern: string } | { type: 'patternRange', start: string, end: string } } | { kind: 'substitute', pattern: string, replacement: string, global: boolean, printFlag: boolean, ignoreCase: boolean }>} */
      const specs = [];
      for (const sc of parsed.scripts) {
        const pieces = SedLib.splitSedScriptIntoCommands(sc);
        if (pieces.ok === false) {
          return { stdout: '', stderr: pieces.stderr, exitCode: 2 };
        }
        for (const fragment of pieces.commands) {
          const p = SedLib.parseSedScript(fragment);
          if (p.ok === false) {
            return { stdout: '', stderr: p.stderr, exitCode: 2 };
          }
          specs.push(/** @type {(typeof specs)[number]} */ (p));
        }
      }

      const stdinAvailable =
        terminal.stdinSupplied === true || (terminal.hasStdin && terminal.stdin != null);
      const stdinText = stdinAvailable
        ? terminal.stdin != null
          ? String(terminal.stdin)
          : ''
        : '';

      const operands = parsed.fileOperands;
      const stderrLines = [];
      const chunks = [];

      if (operands.length === 0) {
        if (!stdinAvailable) {
          return {
            stdout: '',
            stderr: 'sed: no input (use a pipe or specify file operands)\n',
            exitCode: 2
          };
        }
        chunks.push(SedLib.sedProcessContent(stdinText, specs, parsed.quiet));
      } else {
        for (const op of operands) {
          if (op === '-') {
            if (!stdinAvailable) {
              stderrLines.push('sed: -: No such file or directory');
              continue;
            }
            chunks.push(SedLib.sedProcessContent(stdinText, specs, parsed.quiet));
            continue;
          }
          const res = await VfsUtils.vfsFollowSymlinksToFile(terminal, op, 'sed');
          if (res.ok === false) {
            stderrLines.push(res.stderr.trimEnd());
            continue;
          }
          const d = VfsUtils.fileItemUtf8ForDisplay(res.file);
          const text = d.isBinary ? '' : d.text;
          chunks.push(SedLib.sedProcessContent(text, specs, parsed.quiet));
        }
      }

      const stdout = chunks.join('');
      const stderr = stderrLines.length ? stderrLines.join('\n') + '\n' : '';
      const exitCode = stderrLines.length > 0 ? 1 : 0;
      return { stdout, stderr, exitCode };
    },
    'stream editor (literal s///, d with optional line addresses, -n, -e, FILEs or stdin, --)',
    'File System'
  );
})();

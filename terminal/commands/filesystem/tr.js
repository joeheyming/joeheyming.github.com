// tr — translate, squeeze, or delete characters (GNU-style subset, stdin only)
(function () {
  'use strict';

  registerCommand(
    'tr',
    async (terminal, args) => {
      const parsed = ShellUtils.parseTrArgv(args);
      if (!parsed.ok) {
        return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
      }
      if (parsed.help) {
        return { stdout: ShellUtils.TR_HELP.trim() + '\n', stderr: '', exitCode: 0 };
      }

      const stdinAvailable =
        terminal.stdinSupplied === true || (terminal.hasStdin && terminal.stdin != null);
      if (!stdinAvailable) {
        return {
          stdout: '',
          stderr: 'tr: no stdin (use a pipe or redirect for standard input)\n',
          exitCode: 2
        };
      }

      const stdinText = terminal.stdin != null ? String(terminal.stdin) : '';
      const operands = parsed.operands;
      const set1 = ShellUtils.expandTrSetString(operands[0]);
      const set2 = operands.length > 1 ? ShellUtils.expandTrSetString(operands[1]) : [];

      const out = ShellUtils.runTr(stdinText, {
        complement: parsed.complement,
        delete: parsed.delete,
        squeeze: parsed.squeeze,
        squeezeOnly: parsed.squeezeOnly,
        set1,
        set2
      });
      return { stdout: out, stderr: '', exitCode: 0 };
    },
    'translate, squeeze, or delete characters from stdin (SET1 [SET2], -d -s -c)',
    'File System'
  );
})();

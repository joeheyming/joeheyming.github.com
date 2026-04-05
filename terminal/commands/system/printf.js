// printf — format and print data (POSIX/GNU subset; jsh)
(function () {
  'use strict';

  registerCommand(
    'printf',
    async (terminal, args) => {
      const parsed = ShellUtils.parsePrintfArgv(args);
      if (!parsed.ok) {
        return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
      }
      if (parsed.help) {
        return { stdout: ShellUtils.PRINTF_HELP, stderr: '', exitCode: 0 };
      }
      if (parsed.version) {
        return { stdout: ShellUtils.PRINTF_VERSION_LINE, stderr: '', exitCode: 0 };
      }
      const expandedFormat = terminal.expandVariables(parsed.format);
      const expandedOperands = parsed.operands.map((o) => terminal.expandVariables(o));
      const result = ShellUtils.runPrintfFormat(expandedFormat, expandedOperands);
      if (!result.ok) {
        return { stdout: '', stderr: result.stderr, exitCode: result.exitCode };
      }
      return { stdout: result.stdout, stderr: result.stderr || '', exitCode: 0 };
    },
    'format strings (%% %s %d …; FORMAT reuse; --help)',
    'System'
  );
})();

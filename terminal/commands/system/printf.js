// printf — format and print data (POSIX/GNU subset; jsh)
(function () {
  'use strict';

  registerCommand(
    'printf',
    async (terminal, args) => {
      const parsed = PrintfLib.parsePrintfArgv(args);
      if (parsed.ok === false) {
        return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
      }
      if (parsed.help) {
        return { stdout: PrintfLib.PRINTF_HELP, stderr: '', exitCode: 0 };
      }
      if (parsed.version) {
        return { stdout: PrintfLib.PRINTF_VERSION_LINE, stderr: '', exitCode: 0 };
      }
      const expandedFormat = terminal.expandVariables(parsed.format);
      const expandedOperands = parsed.operands.map((o) => terminal.expandVariables(o));
      const result = PrintfLib.runPrintfFormat(expandedFormat, expandedOperands);
      if (result.ok === false) {
        return { stdout: '', stderr: result.stderr, exitCode: result.exitCode };
      }
      return { stdout: result.stdout, stderr: result.stderr || '', exitCode: 0 };
    },
    'format strings (%% %s %d …; FORMAT reuse; --help)',
    'System'
  );
})();

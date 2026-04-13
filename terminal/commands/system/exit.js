// exit command - leave jsh with a status (bash-like)
(function () {
  'use strict';

  const USAGE = `exit: usage: exit [n]
Exit jsh with status N (0–255, wrapping like bash). With no N, use the
status of the last command ($? before exit).

  --help    Show this help (jsh extension; bash has no exit --help)
`;

  registerCommand(
    'exit',
    (terminal, args) => {
      const parsed = ShellCore.parseExitStatus(args, terminal.lastExitCode);
      if (parsed.ok && parsed.help) {
        return { stdout: `${USAGE}\n`, stderr: '', exitCode: 0 };
      }
      if (parsed.ok === false) {
        return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
      }
      return { stdout: '', stderr: '', exitCode: parsed.status };
    },
    'exit shell with optional status',
    'System'
  );
})();

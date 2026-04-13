// true / false / : — POSIX-style exit status helpers and null command
(function () {
  'use strict';

  const VERSION_LINE =
    'Heyming OS jsh 2.0.0 — in-browser userland (virtual FS, simulated kernel). Does not report host OS version.\n';

  function runTrueFalse(_terminal, args, progName) {
    const parsed = TestLib.parseTrueFalseArgv(args, progName);
    if (parsed.ok === false) {
      return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
    }
    if (parsed.help) {
      const help = progName === 'true' ? TestLib.TRUE_HELP : TestLib.FALSE_HELP;
      return { stdout: `${help}\n`, stderr: '', exitCode: 0 };
    }
    if (parsed.version) {
      return { stdout: VERSION_LINE, stderr: '', exitCode: 0 };
    }
    const exitCode = progName === 'true' ? 0 : 1;
    return { stdout: '', stderr: '', exitCode };
  }

  registerCommand(
    'true',
    (terminal, args) => runTrueFalse(terminal, args, 'true'),
    'exit 0 (GNU-style true)',
    'System'
  );
  registerCommand(
    'false',
    (terminal, args) => runTrueFalse(terminal, args, 'false'),
    'exit 1 (GNU-style false)',
    'System'
  );
  registerCommand(
    ':',
    (_terminal, _args) => {
      return { stdout: '', stderr: '', exitCode: 0 };
    },
    'null command (POSIX :)',
    'System'
  );
})();

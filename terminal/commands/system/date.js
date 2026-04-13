// date — display current date/time (GNU-ish argv; jsh)
(function () {
  'use strict';

  registerCommand(
    'date',
    (terminal, args) => {
      const parsed = DateLib.parseDateArgv(args);
      if (parsed.ok === false) {
        return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
      }
      if (parsed.help) {
        return { stdout: DateLib.DATE_HELP, stderr: '', exitCode: 0 };
      }
      if (parsed.version) {
        return { stdout: DateLib.DATE_VERSION_LINE, stderr: '', exitCode: 0 };
      }
      const line = DateLib.formatDateOutput(new Date(), {
        utc: parsed.utc,
        iso: parsed.iso
      });
      const out = line.endsWith('\n') ? line : line + '\n';
      return { stdout: out, stderr: '', exitCode: 0 };
    },
    'display current date and time (-u, -I, --help)',
    'System'
  );
})();

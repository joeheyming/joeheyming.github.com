// basename - strip directory and optional suffix (GNU-ish)
(function () {
  'use strict';

  registerCommand(
    'basename',
    (terminal, args) => {
      const parsed = ShellUtils.parseBasenameArgv(args);
      if (!parsed.ok) {
        return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
      }
      if (parsed.help) {
        return { stdout: ShellUtils.BASENAME_HELP, stderr: '', exitCode: 0 };
      }
      if (parsed.version) {
        return { stdout: ShellUtils.BASENAME_VERSION_LINE, stderr: '', exitCode: 0 };
      }

      const lines = [];
      for (const path of parsed.names) {
        const logical = terminal.resolvePath(path);
        lines.push(ShellUtils.basenameCompute(logical, parsed.suffix));
      }
      if (parsed.zero) {
        return {
          stdout: lines.map((l) => l + '\0').join(''),
          stderr: '',
          exitCode: 0
        };
      }
      return { stdout: lines.join('\n') + '\n', stderr: '', exitCode: 0 };
    },
    'strip path to filename',
    'File System'
  );
})();

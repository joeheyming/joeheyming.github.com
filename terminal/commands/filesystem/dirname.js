// dirname - strip last path component (GNU-ish)
(function () {
  'use strict';

  registerCommand(
    'dirname',
    (terminal, args) => {
      const parsed = ShellUtils.parseDirnameArgv(args);
      if (!parsed.ok) {
        return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
      }
      if (parsed.help) {
        return { stdout: ShellUtils.DIRNAME_HELP, stderr: '', exitCode: 0 };
      }
      if (parsed.version) {
        return { stdout: ShellUtils.DIRNAME_VERSION_LINE, stderr: '', exitCode: 0 };
      }

      const lines = [];
      for (const path of parsed.names) {
        const logical = terminal.resolvePath(path);
        lines.push(ShellUtils.dirnameCompute(logical));
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
    'strip filename from path',
    'File System'
  );
})();

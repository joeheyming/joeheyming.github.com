// pwd command - print working directory (GNU-style -L / -P)
(function () {
  'use strict';

  registerCommand(
    'pwd',
    async (terminal, args) => {
      const parsed = PwdLib.parsePwdArgv(args);
      if (parsed.ok === false) {
        return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
      }
      if (parsed.help) {
        return { stdout: PwdLib.PWD_HELP.trim() + '\n', stderr: '', exitCode: 0 };
      }

      const cwd = terminal.currentDirectory;
      if (cwd == null || cwd === '') {
        return {
          stdout: '',
          stderr: 'pwd: error retrieving current directory',
          exitCode: 1
        };
      }

      if (!parsed.physical) {
        return { stdout: cwd, stderr: '', exitCode: 0 };
      }

      const res = await VfsUtils.vfsReadlinkCanonical(terminal, cwd, 'e', 'pwd');
      if (res.ok === false) {
        return { stdout: '', stderr: `${res.stderr}\n`, exitCode: 1 };
      }
      return { stdout: res.path, stderr: '', exitCode: 0 };
    },
    'print working directory',
    'File System'
  );
})();

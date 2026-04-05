// cd command - change directory
(function () {
  'use strict';

  registerCommand(
    'cd',
    async (terminal, args) => {
      if (args.length === 0) {
        terminal.updatePWD(terminal.env.HOME);
        return { stdout: '', stderr: '', exitCode: 0 };
      }

      if (args.length > 1) {
        return { stdout: '', stderr: 'cd: too many arguments', exitCode: 1 };
      }

      const targetDir = terminal.expandVariables(args[0]);
      const newPath = terminal.resolvePath(targetDir);
      const item = await terminal.getFileSystemItem(newPath);

      if (!item) {
        return {
          stdout: '',
          stderr: `cd: no such file or directory: ${targetDir}`,
          exitCode: 1
        };
      }

      if (item.type !== 'directory') {
        return {
          stdout: '',
          stderr: `cd: not a directory: ${targetDir}`,
          exitCode: 1
        };
      }

      terminal.updatePWD(newPath);
      return { stdout: '', stderr: '', exitCode: 0 };
    },
    'change directory',
    'File System'
  );
})();

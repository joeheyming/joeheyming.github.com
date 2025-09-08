// cd command - change directory
(function () {
  'use strict';

  registerCommand('cd', async (terminal, args) => {
    if (args.length === 0) {
      terminal.updatePWD(terminal.env.HOME);
      return '';
    }

    const targetDir = terminal.expandVariables(args[0]);
    const newPath = terminal.resolvePath(targetDir);
    const item = await terminal.getFileSystemItem(newPath);

    if (!item) {
      return `cd: no such file or directory: ${targetDir}`;
    }

    if (item.type !== 'directory') {
      return `cd: not a directory: ${targetDir}`;
    }

    terminal.updatePWD(newPath);
    return '';
  }, 'change directory', 'File System');
})();

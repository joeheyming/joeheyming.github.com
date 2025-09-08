// mv command - move/rename files and directories
(function () {
  'use strict';

  registerCommand('mv', async (terminal, args) => {
    if (args.length < 2) {
      return 'mv: missing destination file operand';
    }

    const sourcePath = terminal.resolvePath(args[0]);
    const destPath = terminal.resolvePath(args[1]);

    try {
      await terminal.fileSystemDB.moveItem(sourcePath, destPath);
      return `📦 Moved '${args[0]}' -> '${args[1]}'`;
    } catch (error) {
      return `mv: cannot move '${args[0]}' to '${args[1]}': ${error.message}`;
    }
  }, 'move/rename files and directories', 'File System');
})();

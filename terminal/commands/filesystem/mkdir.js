// mkdir command - create directory
(function () {
  'use strict';

  registerCommand(
    'mkdir',
    async (terminal, args) => {
      if (args.length === 0) {
        return 'mkdir: missing operand';
      }

      const dirPath = terminal.resolvePath(args[0]);

      try {
        await terminal.fileSystemDB.createDirectory(dirPath);
        return `📁 Directory created: ${args[0]}`;
      } catch (error) {
        return `mkdir: cannot create directory '${args[0]}': ${error.message}`;
      }
    },
    'create directory',
    'File System'
  );
})();

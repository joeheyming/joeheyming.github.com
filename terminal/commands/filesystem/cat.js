// cat command - display file contents
(function () {
  'use strict';

  registerCommand(
    'cat',
    async (terminal, args) => {
      if (args.length === 0) {
        return 'cat: missing file operand';
      }

      const filePath = terminal.resolvePath(args[0]);
      const item = await terminal.getFileSystemItem(filePath);

      if (!item) {
        return `cat: ${args[0]}: No such file or directory`;
      }

      if (item.type !== 'file') {
        return `cat: ${args[0]}: Is a directory`;
      }

      return item.content || '[binary file]';
    },
    'display file contents',
    'File System'
  );
})();

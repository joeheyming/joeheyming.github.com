// touch command - create empty file or update timestamp
(function () {
  'use strict';

  registerCommand('touch', async (terminal, args) => {
    if (args.length === 0) {
      return 'touch: missing file operand';
    }

    const filePath = terminal.resolvePath(args[0]);

    try {
      // Check if file already exists
      const existing = await terminal.getFileSystemItem(filePath);
      if (existing) {
        // Update modification time
        await terminal.fileSystemDB.createFile(filePath, existing.content || '', true);
        return `📄 File touched: ${args[0]}`;
      } else {
        // Create new empty file
        await terminal.fileSystemDB.createFile(filePath, '');
        return `📄 File created: ${args[0]}`;
      }
    } catch (error) {
      return `touch: cannot touch '${args[0]}': ${error.message}`;
    }
  }, 'create empty file or update timestamp', 'File System');
})();

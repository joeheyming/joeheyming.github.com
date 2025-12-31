// find command - find files by name pattern
(function () {
  'use strict';

  // Helper function for recursive file search
  async function searchRecursively(terminal, path, pattern, results) {
    const item = await terminal.getFileSystemItem(path);
    if (!item) return;

    if (item.type === 'directory') {
      const entries = await terminal.listDirectoryContents(path);
      for (const entry of entries) {
        if (entry.name.includes(pattern)) {
          results.push(entry.path);
        }
        if (entry.type === 'directory') {
          await searchRecursively(terminal, entry.path, pattern, results);
        }
      }
    } else if (item.path && terminal.fileSystemDB.getFileName(item.path).includes(pattern)) {
      results.push(item.path);
    }
  }

  registerCommand(
    'find',
    async (terminal, args) => {
      if (args.length === 0) {
        return 'find: missing file name';
      }

      const pattern = args[0];
      const startPath = args[1] || terminal.currentDirectory;
      const fullStartPath = terminal.resolvePath(startPath);

      try {
        const results = [];
        await searchRecursively(terminal, fullStartPath, pattern, results);

        if (results.length === 0) {
          return `find: no files matching '${pattern}' found`;
        }

        return results.join('\n');
      } catch (error) {
        return `find: ${error.message}`;
      }
    },
    'find files by name pattern',
    'File System'
  );
})();

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
        return { stderr: 'find: missing operand', exitCode: 1 };
      }

      const pattern = args[0];
      const startPathArg = args[1];
      const startPathForResolve = startPathArg === undefined ? '.' : startPathArg;
      const fullStartPath = terminal.resolvePath(startPathForResolve);
      const displayPath = startPathArg === undefined ? '.' : startPathArg;

      const rootItem = await terminal.getFileSystemItem(fullStartPath);
      if (!rootItem) {
        return {
          stderr: `find: '${displayPath}': No such file or directory`,
          exitCode: 1
        };
      }

      try {
        const results = [];
        await searchRecursively(terminal, fullStartPath, pattern, results);

        if (results.length === 0) {
          return { stdout: '', stderr: '', exitCode: 0 };
        }

        return { stdout: results.join('\n'), stderr: '', exitCode: 0 };
      } catch (error) {
        return { stderr: `find: ${error.message}`, exitCode: 1 };
      }
    },
    'find files by name pattern',
    'File System'
  );
})();

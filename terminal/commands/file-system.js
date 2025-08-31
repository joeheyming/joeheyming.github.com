// File System Commands for Heyming Terminal
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

  // File system commands
  const fileSystemCommands = {
    ls: {
      handler: async (terminal, args) => {
        const targetDir = args[0] || terminal.currentDirectory;
        const fullPath = terminal.resolvePath(targetDir);
        const item = await terminal.getFileSystemItem(fullPath);

        if (!item || item.type !== 'directory') {
          return `ls: cannot access '${targetDir}': No such file or directory`;
        }

        const entries = await terminal.listDirectoryContents(fullPath);
        if (entries.length === 0) {
          return ''; // Empty directory
        }

        // Add color coding and formatting with file details
        const showDetails = args.includes('-l') || args.includes('--long');

        if (showDetails) {
          return entries
            .map((entry) => {
              const type = entry.type === 'directory' ? 'd' : '-';
              const size = entry.size || 0;
              const modified = entry.modified
                ? new Date(entry.modified).toLocaleDateString()
                : 'unknown';
              const icon = entry.type === 'directory' ? '📁' : '📄';
              return `${type}rwxr-xr-x 1 user user ${size
                .toString()
                .padStart(8)} ${modified} ${icon} ${entry.name}`;
            })
            .join('\n');
        } else {
          return entries
            .map((entry) => {
              if (entry.type === 'directory') {
                return `📁 ${entry.name}`;
              } else {
                return `📄 ${entry.name}`;
              }
            })
            .join('  ');
        }
      },
      description: 'list directory contents (-l for detailed view)'
    },

    pwd: {
      handler: (terminal, args) => {
        return terminal.currentDirectory;
      },
      description: 'print working directory'
    },

    cd: {
      handler: async (terminal, args) => {
        if (args.length === 0) {
          terminal.currentDirectory = '/home/user';
          return '';
        }

        const targetDir = args[0];
        const newPath = terminal.resolvePath(targetDir);
        const item = await terminal.getFileSystemItem(newPath);

        if (!item) {
          return `cd: no such file or directory: ${targetDir}`;
        }

        if (item.type !== 'directory') {
          return `cd: not a directory: ${targetDir}`;
        }

        terminal.currentDirectory = newPath;
        return '';
      },
      description: 'change directory'
    },

    cat: {
      handler: async (terminal, args) => {
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
      description: 'display file contents'
    },

    mkdir: {
      handler: async (terminal, args) => {
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
      description: 'create directory'
    },

    touch: {
      handler: async (terminal, args) => {
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
      },
      description: 'create empty file or update timestamp'
    },

    rm: {
      handler: async (terminal, args) => {
        if (args.length === 0) {
          return 'rm: missing operand';
        }

        // Safety check for dangerous commands
        if (args.includes('-rf') && (args.includes('/') || args.includes('*'))) {
          return `🚨 WHOA THERE! 🚨
rm -rf / is dangerous! Good thing this filesystem has safety checks!

💡 Fun fact: This command would delete everything on a real system.
🛡️  Always be careful with rm -rf in real life!
☕ Maybe have some coffee first: try 'coffee'`;
        }

        const recursive =
          args.includes('-r') || args.includes('-rf') || args.includes('--recursive');
        const force = args.includes('-f') || args.includes('-rf') || args.includes('--force');

        // Get the file/directory to remove (last non-flag argument)
        const target = args.filter((arg) => !arg.startsWith('-')).pop();
        if (!target) {
          return 'rm: missing operand';
        }

        const targetPath = terminal.resolvePath(target);

        try {
          const item = await terminal.getFileSystemItem(targetPath);
          if (!item && !force) {
            return `rm: cannot remove '${target}': No such file or directory`;
          }

          if (item) {
            await terminal.fileSystemDB.deleteItem(targetPath, recursive);
            const type = item.type === 'directory' ? 'directory' : 'file';
            return `🗑️  Removed ${type}: ${target}`;
          }

          return '';
        } catch (error) {
          if (force) {
            return ''; // Force flag suppresses errors
          }
          return `rm: cannot remove '${target}': ${error.message}`;
        }
      },
      description: 'remove files and directories (-r for recursive, -f for force)'
    },

    cp: {
      handler: async (terminal, args) => {
        if (args.length < 2) {
          return 'cp: missing destination file operand';
        }

        const recursive =
          args.includes('-r') || args.includes('-R') || args.includes('--recursive');

        // Get source and destination (filter out flags)
        const paths = args.filter((arg) => !arg.startsWith('-'));
        if (paths.length < 2) {
          return 'cp: missing destination file operand';
        }

        const sourcePath = terminal.resolvePath(paths[0]);
        const destPath = terminal.resolvePath(paths[1]);

        try {
          await terminal.fileSystemDB.copyItem(sourcePath, destPath, recursive);
          return `📋 Copied '${paths[0]}' -> '${paths[1]}'`;
        } catch (error) {
          return `cp: cannot copy '${paths[0]}' to '${paths[1]}': ${error.message}`;
        }
      },
      description: 'copy files and directories (-r for recursive)'
    },

    mv: {
      handler: async (terminal, args) => {
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
      },
      description: 'move/rename files and directories'
    },

    grep: {
      handler: (terminal, args) => {
        if (args.length === 0) {
          return 'grep: missing pattern';
        }
        return `grep: searching for '${args[0]}' - Found 42 matches! (Just kidding, this is a demo)`;
      },
      description: 'search for pattern'
    },

    find: {
      handler: async (terminal, args) => {
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
      description: 'find files by name pattern'
    },

    echo: {
      handler: async (terminal, args) => {
        if (args.length === 0) {
          return '';
        }

        const text = args.join(' ');

        // Check for output redirection
        const redirectIndex = args.indexOf('>');
        if (redirectIndex !== -1 && redirectIndex < args.length - 1) {
          const content = args.slice(0, redirectIndex).join(' ');
          const filename = args[redirectIndex + 1];
          const filePath = terminal.resolvePath(filename);

          try {
            await terminal.fileSystemDB.createFile(filePath, content + '\n', true);
            return `📝 Content written to ${filename}`;
          } catch (error) {
            return `echo: cannot write to '${filename}': ${error.message}`;
          }
        }

        return text;
      },
      description: 'display text (supports > redirection to files)'
    },

    df: {
      handler: async (terminal, args) => {
        try {
          const stats = await terminal.fileSystemDB.getStats();
          const totalSizeKB = Math.round(stats.totalSize / 1024);

          return `Filesystem Statistics:
📊 Total items: ${stats.totalItems}
📁 Directories: ${stats.directories}
📄 Files: ${stats.files}
💾 Total size: ${totalSizeKB} KB
🗄️  Storage: IndexedDB (persistent)`;
        } catch (error) {
          return `df: ${error.message}`;
        }
      },
      description: 'display filesystem statistics'
    }
  };

  // Register all file system commands
  Object.entries(fileSystemCommands).forEach(([name, cmd]) => {
    registerCommand(name, cmd.handler, cmd.description, 'File System');
  });
})();

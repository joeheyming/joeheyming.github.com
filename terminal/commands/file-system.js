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

    hexdump: {
      handler: async (terminal, args) => {
        if (args.length === 0) {
          return 'hexdump: missing file operand';
        }

        const filePath = terminal.resolvePath(args[0]);
        const item = await terminal.getFileSystemItem(filePath);

        if (!item) {
          return `hexdump: ${args[0]}: No such file or directory`;
        }

        if (item.type !== 'file') {
          return `hexdump: ${args[0]}: Is a directory`;
        }

        const content = item.content || '';
        let result = `File: ${args[0]} (${content.length} bytes)\n`;
        result += `Raw content: "${content}"\n`;
        result += `Escaped: ${JSON.stringify(content)}\n`;
        result += `Char codes: [${Array.from(content)
          .map((c) => c.charCodeAt(0))
          .join(', ')}]`;

        return result;
      },
      description: 'debug file contents showing raw bytes and escape sequences'
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
      handler: async (terminal, args) => {
        if (args.length === 0) {
          return 'grep: missing pattern';
        }

        const pattern = args[0];
        const flags = args.filter((arg) => arg.startsWith('-'));
        const files = args.filter((arg) => !arg.startsWith('-')).slice(1);

        const caseInsensitive = flags.includes('-i');
        const showLineNumbers = flags.includes('-n');
        const invertMatch = flags.includes('-v');

        let searchText = '';
        let searchFiles = [];

        // Check if we have piped input
        if (terminal.hasStdin && terminal.stdin) {
          searchText = terminal.stdin;
        } else if (files.length > 0) {
          // Search in specified files
          for (const filename of files) {
            const filePath = terminal.resolvePath(filename);
            const file = await terminal.getFileSystemItem(filePath);
            if (file && file.type === 'file') {
              searchFiles.push({ name: filename, content: file.content || '' });
            }
          }
        } else {
          return 'grep: no input provided (use pipes or specify files)';
        }

        const results = [];

        if (searchText) {
          // Search in piped input
          const lines = searchText.split('\n');
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const searchLine = caseInsensitive ? line.toLowerCase() : line;
            const searchPattern = caseInsensitive ? pattern.toLowerCase() : pattern;

            const matches = searchLine.includes(searchPattern);
            if ((matches && !invertMatch) || (!matches && invertMatch)) {
              if (showLineNumbers) {
                results.push(`${i + 1}:${line}`);
              } else {
                results.push(line);
              }
            }
          }
        } else {
          // Search in files
          for (const file of searchFiles) {
            const lines = file.content.split('\n');
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i];
              const searchLine = caseInsensitive ? line.toLowerCase() : line;
              const searchPattern = caseInsensitive ? pattern.toLowerCase() : pattern;

              const matches = searchLine.includes(searchPattern);
              if ((matches && !invertMatch) || (!matches && invertMatch)) {
                const prefix = searchFiles.length > 1 ? `${file.name}:` : '';
                const lineNum = showLineNumbers ? `${i + 1}:` : '';
                results.push(`${prefix}${lineNum}${line}`);
              }
            }
          }
        }

        return results.length > 0 ? results.join('\n') : '';
      },
      description:
        'search for pattern in files or piped input (-i case insensitive, -n line numbers, -v invert)'
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
          return '\n'; // Even empty echo should have newline
        }

        const flags = args.filter((arg) => arg.startsWith('-'));
        const textArgs = args.filter((arg) => !arg.startsWith('-'));

        // -n flag suppresses the trailing newline
        const suppressNewline = flags.includes('-n');

        const text = textArgs.join(' ');
        // Expand environment variables
        const expandedText = terminal.expandVariables(text);
        const result = suppressNewline ? expandedText : expandedText + '\n';

        // Return text with newline unless -n flag is used
        return result;
      },
      description: 'display text (-n to suppress newline, supports $VAR expansion)'
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
    },

    head: {
      handler: async (terminal, args) => {
        let lines = 10; // default
        let input = '';
        let files = [];

        // Parse arguments
        for (let i = 0; i < args.length; i++) {
          if (args[i] === '-n' && i + 1 < args.length) {
            lines = parseInt(args[i + 1]);
            i++; // skip next arg
          } else if (args[i].startsWith('-') && /^\-\d+$/.test(args[i])) {
            lines = parseInt(args[i].substring(1));
          } else {
            files.push(args[i]);
          }
        }

        // Get input
        if (terminal.hasStdin && terminal.stdin) {
          input = terminal.stdin;
        } else if (files.length > 0) {
          const filePath = terminal.resolvePath(files[0]);
          const file = await terminal.getFileSystemItem(filePath);
          if (!file || file.type !== 'file') {
            return `head: cannot open '${files[0]}' for reading: No such file or directory`;
          }
          input = file.content || '';
        } else {
          return 'head: no input provided';
        }

        const inputLines = input.split('\n');
        return inputLines.slice(0, lines).join('\n');
      },
      description: 'output first lines of files or input (-n NUM or -NUM for line count)'
    },

    tail: {
      handler: async (terminal, args) => {
        let lines = 10; // default
        let input = '';
        let files = [];

        // Parse arguments
        for (let i = 0; i < args.length; i++) {
          if (args[i] === '-n' && i + 1 < args.length) {
            lines = parseInt(args[i + 1]);
            i++; // skip next arg
          } else if (args[i].startsWith('-') && /^\-\d+$/.test(args[i])) {
            lines = parseInt(args[i].substring(1));
          } else {
            files.push(args[i]);
          }
        }

        // Get input
        if (terminal.hasStdin && terminal.stdin) {
          input = terminal.stdin;
        } else if (files.length > 0) {
          const filePath = terminal.resolvePath(files[0]);
          const file = await terminal.getFileSystemItem(filePath);
          if (!file || file.type !== 'file') {
            return `tail: cannot open '${files[0]}' for reading: No such file or directory`;
          }
          input = file.content || '';
        } else {
          return 'tail: no input provided';
        }

        const inputLines = input.split('\n');
        return inputLines.slice(-lines).join('\n');
      },
      description: 'output last lines of files or input (-n NUM or -NUM for line count)'
    },

    wc: {
      handler: async (terminal, args) => {
        let input = '';
        let files = [];
        const flags = args.filter((arg) => arg.startsWith('-'));

        // Parse file arguments
        files = args.filter((arg) => !arg.startsWith('-'));

        // Get input
        if (terminal.hasStdin && terminal.stdin) {
          input = terminal.stdin;
        } else if (files.length > 0) {
          const filePath = terminal.resolvePath(files[0]);
          const file = await terminal.getFileSystemItem(filePath);
          if (!file || file.type !== 'file') {
            return `wc: ${files[0]}: No such file or directory`;
          }
          input = file.content || '';
        } else {
          return 'wc: no input provided';
        }

        const lines = input.split('\n').length;
        const words = input.trim() ? input.trim().split(/\s+/).length : 0;
        const chars = input.length;

        const showLines = flags.includes('-l');
        const showWords = flags.includes('-w');
        const showChars = flags.includes('-c');
        const showAll = !showLines && !showWords && !showChars;

        let result = '';
        if (showAll || showLines) result += lines.toString().padStart(8);
        if (showAll || showWords) result += words.toString().padStart(8);
        if (showAll || showChars) result += chars.toString().padStart(8);

        if (files.length > 0) {
          result += ` ${files[0]}`;
        }

        return result.trim();
      },
      description: 'count lines, words, and characters (-l lines, -w words, -c chars)'
    },

    sort: {
      handler: async (terminal, args) => {
        let input = '';
        let files = [];
        const flags = args.filter((arg) => arg.startsWith('-'));

        const reverse = flags.includes('-r');
        const numeric = flags.includes('-n');
        const unique = flags.includes('-u');

        // Parse file arguments
        files = args.filter((arg) => !arg.startsWith('-'));

        // Get input
        if (terminal.hasStdin && terminal.stdin) {
          input = terminal.stdin;
        } else if (files.length > 0) {
          const filePath = terminal.resolvePath(files[0]);
          const file = await terminal.getFileSystemItem(filePath);
          if (!file || file.type !== 'file') {
            return `sort: cannot read: ${files[0]}: No such file or directory`;
          }
          input = file.content || '';
        } else {
          return 'sort: no input provided';
        }

        let lines = input.split('\n').filter((line) => line !== '');

        // Sort lines
        if (numeric) {
          lines.sort((a, b) => {
            const numA = parseFloat(a) || 0;
            const numB = parseFloat(b) || 0;
            return reverse ? numB - numA : numA - numB;
          });
        } else {
          lines.sort((a, b) => {
            return reverse ? b.localeCompare(a) : a.localeCompare(b);
          });
        }

        // Remove duplicates if requested
        if (unique) {
          lines = [...new Set(lines)];
        }

        return lines.join('\n');
      },
      description: 'sort lines of text (-r reverse, -n numeric, -u unique)'
    },

    uniq: {
      handler: async (terminal, args) => {
        let input = '';
        let files = [];
        const flags = args.filter((arg) => arg.startsWith('-'));

        const countDuplicates = flags.includes('-c');

        // Parse file arguments
        files = args.filter((arg) => !arg.startsWith('-'));

        // Get input
        if (terminal.hasStdin && terminal.stdin) {
          input = terminal.stdin;
        } else if (files.length > 0) {
          const filePath = terminal.resolvePath(files[0]);
          const file = await terminal.getFileSystemItem(filePath);
          if (!file || file.type !== 'file') {
            return `uniq: cannot read: ${files[0]}: No such file or directory`;
          }
          input = file.content || '';
        } else {
          return 'uniq: no input provided';
        }

        const lines = input.split('\n');
        const result = [];
        let currentLine = '';
        let count = 0;

        for (const line of lines) {
          if (line === currentLine) {
            count++;
          } else {
            if (currentLine !== '') {
              if (countDuplicates) {
                result.push(`${count.toString().padStart(7)} ${currentLine}`);
              } else {
                result.push(currentLine);
              }
            }
            currentLine = line;
            count = 1;
          }
        }

        // Add the last line
        if (currentLine !== '') {
          if (countDuplicates) {
            result.push(`${count.toString().padStart(7)} ${currentLine}`);
          } else {
            result.push(currentLine);
          }
        }

        return result.join('\n');
      },
      description: 'report or omit repeated lines (-c show counts)'
    }
  };

  // Register all file system commands
  Object.entries(fileSystemCommands).forEach(([name, cmd]) => {
    registerCommand(name, cmd.handler, cmd.description, 'File System');
  });
})();

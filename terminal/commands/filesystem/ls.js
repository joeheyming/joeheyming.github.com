// ls command - list directory contents
(function () {
  'use strict';

  registerCommand(
    'ls',
    async (terminal, args) => {
      const { showDetails, showAll } = ShellUtils.parseLsDisplayFlags(args);

      // Filter out flags to find the target directory
      const nonFlagArgs = args.filter((arg) => !arg.startsWith('-'));
      const targetDir = nonFlagArgs[0] || terminal.currentDirectory;
      const fullPath = terminal.resolvePath(targetDir);

      try {
        // Use system call in OS mode, fallback to legacy
        const stats = await terminal.syscall('stat', fullPath);

        if (!stats) {
          return {
            stderr: `ls: cannot access '${targetDir}': No such file or directory`,
            exitCode: 1
          };
        }

        // If it's a file, show the file itself
        if (stats.type === 'file') {
          if (showDetails) {
            const size = stats.size || 0;
            const modified = stats.modified
              ? new Date(stats.modified).toISOString().slice(0, 16).replace('T', ' ')
              : 'unknown';
            return {
              stdout: `-rw-r--r-- 1 ${terminal.env.USER} ${terminal.env.USER} ${size
                .toString()
                .padStart(8)} ${modified} ${targetDir.split('/').pop()}`,
              stderr: '',
              exitCode: 0
            };
          }
          return {
            stdout: targetDir.split('/').pop(),
            stderr: '',
            exitCode: 0
          };
        }

        // If it's a directory, list its contents
        if (stats.type === 'directory') {
          const raw = await terminal.listDirectoryContents(fullPath);
          let entries = ShellUtils.sortDirectoryEntriesByName(raw);
          if (!showAll) {
            entries = entries.filter((e) => !String(e.name).startsWith('.'));
          }
          if (entries.length === 0) {
            return { stdout: '', stderr: '', exitCode: 0 };
          }

          // Format directory entries
          if (showDetails) {
            return {
              stdout: entries
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
                .join('\n'),
              stderr: '',
              exitCode: 0
            };
          }
          return {
            stdout: entries
              .map((entry) => {
                if (entry.type === 'directory') {
                  return `📁 ${entry.name}`;
                }
                return `📄 ${entry.name}`;
              })
              .join('  '),
            stderr: '',
            exitCode: 0
          };
        }

        return {
          stderr: `ls: cannot access '${targetDir}': Not a file or directory`,
          exitCode: 1
        };
      } catch (error) {
        // Handle permission errors or other OS-level errors
        console.error('ls command error:', error);
        if (error.message.includes('Permission denied')) {
          return {
            stderr: `ls: cannot access '${targetDir}': Permission denied`,
            exitCode: 1
          };
        }
        if (error.message.includes('is not a function')) {
          return {
            stderr: `ls: cannot access '${targetDir}': ${error.message}\nTry running 'osinfo' to check system status`,
            exitCode: 1
          };
        }
        return {
          stderr: `ls: cannot access '${targetDir}': ${error.message}`,
          exitCode: 1
        };
      }
    },
    'list directory contents (-l long, -a include dotfiles)',
    'File System'
  );
})();

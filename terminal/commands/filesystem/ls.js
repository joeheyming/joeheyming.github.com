// ls command - list directory contents
(function () {
  'use strict';

  registerCommand(
    'ls',
    async (terminal, args) => {
      // Check if we want detailed output
      const showDetails = args.includes('-l') || args.includes('--long');

      // Filter out flags to find the target directory
      const nonFlagArgs = args.filter((arg) => !arg.startsWith('-'));
      const targetDir = nonFlagArgs[0] || terminal.currentDirectory;
      const fullPath = terminal.resolvePath(targetDir);

      try {
        // Use system call in OS mode, fallback to legacy
        const stats = await terminal.syscall('stat', fullPath);

        if (!stats) {
          return `ls: cannot access '${targetDir}': No such file or directory`;
        }

        // If it's a file, show the file itself
        if (stats.type === 'file') {
          if (showDetails) {
            const size = stats.size || 0;
            const modified = stats.modified
              ? new Date(stats.modified).toISOString().slice(0, 16).replace('T', ' ')
              : 'unknown';
            return `-rw-r--r-- 1 ${terminal.env.USER} ${terminal.env.USER} ${size
              .toString()
              .padStart(8)} ${modified} ${targetDir.split('/').pop()}`;
          } else {
            return targetDir.split('/').pop(); // Just show filename
          }
        }

        // If it's a directory, list its contents
        if (stats.type === 'directory') {
          const entries = await terminal.listDirectoryContents(fullPath);
          if (entries.length === 0) {
            return ''; // Empty directory
          }

          // Format directory entries
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
        }

        return `ls: cannot access '${targetDir}': Not a file or directory`;
      } catch (error) {
        // Handle permission errors or other OS-level errors
        console.error('ls command error:', error);
        if (error.message.includes('Permission denied')) {
          return `ls: cannot access '${targetDir}': Permission denied`;
        }
        if (error.message.includes('is not a function')) {
          return `ls: cannot access '${targetDir}': ${error.message}\nTry running 'osinfo' to check system status`;
        }
        return `ls: cannot access '${targetDir}': ${error.message}`;
      }
    },
    'list directory contents (-l for detailed view)',
    'File System'
  );
})();

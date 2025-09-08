// cp command - copy files and directories
(function () {
  'use strict';

  registerCommand('cp', async (terminal, args) => {
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
  }, 'copy files and directories (-r for recursive)', 'File System');
})();

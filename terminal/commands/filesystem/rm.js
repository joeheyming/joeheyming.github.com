// rm command - remove files and directories
(function () {
  'use strict';

  registerCommand('rm', async (terminal, args) => {
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
  }, 'remove files and directories (-r for recursive, -f for force)', 'File System');
})();

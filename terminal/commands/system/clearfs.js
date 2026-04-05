// clearfs command - clear filesystem data
(function () {
  'use strict';

  registerCommand(
    'clearfs',
    async (terminal, args) => {
      const flags = {
        force: args.includes('-f') || args.includes('--force'),
        help: args.includes('-h') || args.includes('--help')
      };

      if (flags.help) {
        return `clearfs - clear filesystem data

Usage: clearfs [options]

Options:
  -f, --force     Force clear without confirmation
  -h, --help      Show this help message

Description:
  Clears all filesystem data including files, directories, and metadata.
  This is a destructive operation that cannot be undone.

Examples:
  clearfs         Clear filesystem (with confirmation)
  clearfs -f      Force clear without confirmation`;
      }

      if (!flags.force) {
        return `⚠️  WARNING: This will permanently delete ALL filesystem data!
        
Use 'clearfs -f' to force the operation.
Alternatively, use 'fsck --reset' for a more comprehensive filesystem reset.`;
      }

      let output = 'Clearing filesystem data...\n\n';
      let clearedCount = 0;

      try {
        // Clear FilesystemDB if available
        if (typeof window !== 'undefined' && window.FilesystemDB) {
          await window.FilesystemDB.clear();
          output += '✅ Cleared FilesystemDB\n';
          clearedCount++;
        }

        // Clear localStorage filesystem entries
        const fsKeys = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (
            key &&
            (key.startsWith('fs_') || key.startsWith('filesystem_') || key.startsWith('file_'))
          ) {
            fsKeys.push(key);
          }
        }

        fsKeys.forEach((key) => localStorage.removeItem(key));
        if (fsKeys.length > 0) {
          output += `✅ Cleared ${fsKeys.length} localStorage entries\n`;
          clearedCount += fsKeys.length;
        }

        // Reset current directory
        if (terminal.currentDirectory) {
          terminal.updatePWD('/');
          output += '✅ Reset current directory to /\n';
        }

        // Clear any cached file data
        if (typeof window !== 'undefined' && window.fileCache) {
          window.fileCache.clear();
          output += '✅ Cleared file cache\n';
          clearedCount++;
        }

        output += `\n🧹 Filesystem cleared successfully!\n`;
        output += `📊 Total items cleared: ${clearedCount}\n`;
        output += `💡 Refresh the page to ensure all changes take effect\n`;
      } catch (error) {
        output += `❌ Error clearing filesystem: ${error.message}\n`;
      }

      return output;
    },
    'clear filesystem data',
    'System'
  );
})();

// df command - display filesystem statistics
(function () {
  'use strict';

  registerCommand(
    'df',
    async (terminal, args) => {
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
    'display filesystem statistics',
    'File System'
  );
})();

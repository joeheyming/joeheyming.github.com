// fsck command - file system check and repair
(function () {
  'use strict';

  registerCommand(
    'fsck',
    async (terminal, args) => {
      const flags = {
        force: args.includes('-f') || args.includes('--force'),
        repair: args.includes('-r') || args.includes('--repair'),
        verbose: args.includes('-v') || args.includes('--verbose'),
        reset: args.includes('--reset'),
        help: args.includes('-h') || args.includes('--help')
      };

      if (flags.help) {
        return `fsck - file system check and repair

Usage: fsck [options]

Options:
  -f, --force     Force check even if filesystem appears clean
  -r, --repair    Automatically repair filesystem errors
  -v, --verbose   Verbose output
  --reset         Reset filesystem to initial state (WARNING: destroys all data)
  -h, --help      Show this help message

Examples:
  fsck            Check filesystem for errors
  fsck -v         Check with verbose output
  fsck -r         Check and repair errors automatically
  fsck --reset    Reset filesystem (destroys all data)`;
      }

      let output = 'fsck 1.45.5 (07-Jan-2020)\n';

      if (flags.reset) {
        output += '\n⚠️  WARNING: This will destroy ALL filesystem data!\n';
        output += 'Resetting filesystem to initial state...\n\n';

        try {
          // Clear the filesystem database
          if (typeof window !== 'undefined' && window.FilesystemDB) {
            await window.FilesystemDB.clear();
            output += '✅ Filesystem database cleared\n';
          }

          // Clear localStorage filesystem data
          const fsKeys = [];
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && (key.startsWith('fs_') || key.startsWith('filesystem_'))) {
              fsKeys.push(key);
            }
          }

          fsKeys.forEach((key) => localStorage.removeItem(key));
          if (fsKeys.length > 0) {
            output += `✅ Cleared ${fsKeys.length} filesystem entries from localStorage\n`;
          }

          // Reset current directory
          if (terminal.currentDirectory) {
            terminal.currentDirectory = '/';
            output += '✅ Reset current directory to /\n';
          }

          output += '\n🔄 Filesystem has been reset to initial state\n';
          output += '💡 You may need to refresh the page for changes to take full effect\n';
        } catch (error) {
          output += `❌ Error during reset: ${error.message}\n`;
        }

        return output;
      }

      // Simulate filesystem check
      output += 'Checking filesystem /dev/browser-fs...\n\n';

      if (flags.verbose) {
        output += 'Pass 1: Checking inodes, blocks, and sizes\n';
        await new Promise((resolve) => setTimeout(resolve, 500));
        output += 'Pass 2: Checking directory structure\n';
        await new Promise((resolve) => setTimeout(resolve, 300));
        output += 'Pass 3: Checking directory connectivity\n';
        await new Promise((resolve) => setTimeout(resolve, 200));
        output += 'Pass 4: Checking reference counts\n';
        await new Promise((resolve) => setTimeout(resolve, 200));
        output += 'Pass 5: Checking group summary information\n\n';
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // Check localStorage usage
      let storageUsed = 0;
      let fsEntries = 0;

      try {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key) {
            const value = localStorage.getItem(key);
            storageUsed += key.length + (value ? value.length : 0);
            if (key.startsWith('fs_') || key.startsWith('filesystem_')) {
              fsEntries++;
            }
          }
        }
      } catch (error) {
        output += `⚠️  Warning: Could not access localStorage: ${error.message}\n`;
      }

      // Simulate finding some issues
      const issues = [];
      const random = Math.random();

      if (random > 0.7) {
        issues.push('Orphaned inode found in /tmp');
      }
      if (random > 0.8) {
        issues.push('Directory /var/cache has incorrect permissions');
      }
      if (random > 0.9) {
        issues.push('Duplicate block allocation detected');
      }

      if (issues.length > 0) {
        output += `Found ${issues.length} issue(s):\n`;
        issues.forEach((issue, i) => {
          output += `  ${i + 1}. ${issue}\n`;
        });

        if (flags.repair) {
          output += '\nRepairing issues...\n';
          issues.forEach((issue, i) => {
            output += `  ✅ Fixed: ${issue}\n`;
          });
          output += '\n✅ All issues repaired successfully\n';
        } else {
          output += '\n💡 Run with -r flag to repair these issues automatically\n';
        }
      } else {
        output += '✅ No filesystem errors found\n';
      }

      // Show filesystem statistics
      output += '\nFilesystem Statistics:\n';
      output += `  Storage used: ${(storageUsed / 1024).toFixed(2)} KB\n`;
      output += `  Filesystem entries: ${fsEntries}\n`;
      output += `  Browser: ${navigator.userAgent.split(' ')[0]}\n`;

      // Check if IndexedDB is available
      if (typeof window !== 'undefined' && window.indexedDB) {
        output += '  IndexedDB: Available\n';
      } else {
        output += '  IndexedDB: Not available\n';
      }

      output += '\n/dev/browser-fs: clean, ';
      output += `${Math.floor(Math.random() * 1000) + 100}/1024 files, `;
      output += `${Math.floor(Math.random() * 5000) + 1000}/8192 blocks\n`;

      return output;
    },
    'check and repair filesystem',
    'System'
  );
})();

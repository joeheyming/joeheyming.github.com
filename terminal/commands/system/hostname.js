// hostname - display or set the system hostname
(function () {
  'use strict';

  registerCommand(
    'hostname',
    async (terminal, args) => {
      if (args.length === 0) {
        return terminal.env.HOSTNAME;
      }

      if (args[0] === '--help') {
        return 'Usage: hostname [NAME]\n\nWith no arguments, print the current hostname.\nWith NAME, set the hostname.\n';
      }

      const newName = args[0]
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '');
      if (!newName) return 'hostname: invalid hostname';

      terminal.env.HOSTNAME = newName;
      if (terminal.process) terminal.process.env.HOSTNAME = newName;

      try {
        localStorage.setItem('heymingOS_hostname', newName);
      } catch {
        // storage unavailable
      }

      if (terminal.fileSystemDB) {
        try {
          await terminal.fileSystemDB.createFile('/etc/hostname', newName + '\n', true);
        } catch {
          // ignore
        }
      }

      const sm = terminal.os?.kernel?.securityManager;
      if (sm) await sm.syncEtcFiles(terminal.fileSystemDB);

      terminal.syncStandaloneDocumentTitle?.();
      return '';
    },
    'display or set the system hostname',
    'System'
  );
})();

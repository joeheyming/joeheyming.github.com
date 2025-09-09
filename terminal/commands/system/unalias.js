// unalias command - remove command shortcuts
(function () {
  'use strict';

  registerCommand(
    'unalias',
    (terminal, args) => {
      if (args.length === 0) {
        return 'unalias: usage: unalias [-a] name [name ...]';
      }

      // Handle -a flag to remove all aliases
      if (args.includes('-a')) {
        const count = Object.keys(terminal.aliases).length;
        terminal.aliases = {};
        return `Removed ${count} aliases`;
      }

      const results = [];
      for (const aliasName of args) {
        if (terminal.aliases[aliasName]) {
          delete terminal.aliases[aliasName];
          results.push(`unalias ${aliasName}`);
        } else {
          results.push(`unalias: ${aliasName}: not found`);
        }
      }

      return results.join('\n');
    },
    'remove command shortcuts',
    'System'
  );
})();

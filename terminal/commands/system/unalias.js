// unalias command - remove command shortcuts
(function () {
  'use strict';

  const USAGE = 'unalias: usage: unalias [-a] name [name ...]';

  registerCommand(
    'unalias',
    (terminal, args) => {
      if (args.length === 0) {
        return { stdout: '', stderr: USAGE, exitCode: 2 };
      }

      let i = 0;
      let clearAll = false;
      while (i < args.length) {
        const a = args[i];
        if (a === '--') {
          i++;
          break;
        }
        if (a === '-a') {
          clearAll = true;
          i++;
          continue;
        }
        if (a.startsWith('-')) {
          return {
            stdout: '',
            stderr: `unalias: ${a}: invalid option\n${USAGE}`,
            exitCode: 2
          };
        }
        break;
      }
      const names = args.slice(i);

      if (!clearAll && names.length === 0) {
        return { stdout: '', stderr: USAGE, exitCode: 2 };
      }

      if (clearAll) {
        terminal.aliases = {};
      }

      const stderrLines = [];
      for (const aliasName of names) {
        if (terminal.aliases[aliasName]) {
          delete terminal.aliases[aliasName];
        } else {
          stderrLines.push(`unalias: ${aliasName}: not found`);
        }
      }

      return {
        stdout: '',
        stderr: stderrLines.join('\n'),
        exitCode: stderrLines.length > 0 ? 1 : 0
      };
    },
    'remove command shortcuts',
    'System'
  );
})();

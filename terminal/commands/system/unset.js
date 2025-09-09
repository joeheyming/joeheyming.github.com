// unset command - remove environment variables
(function () {
  'use strict';

  registerCommand(
    'unset',
    (terminal, args) => {
      if (args.length === 0) {
        return 'unset: usage: unset [-v] [name ...]';
      }

      const results = [];
      for (const varName of args) {
        if (!varName.match(/^[A-Za-z_][A-Za-z0-9_]*$/)) {
          results.push(`unset: '${varName}': not a valid identifier`);
          continue;
        }

        const currentValue = terminal.getEnv(varName);
        if (currentValue !== undefined) {
          // Don't allow unsetting critical system variables
          const protectedVars = ['USER', 'HOME', 'SHELL', 'TERM', 'HOSTNAME'];
          if (protectedVars.includes(varName)) {
            results.push(`unset: ${varName}: cannot unset system variable`);
          } else {
            terminal.setEnv(varName, undefined);
            results.push(`unset ${varName}`);
          }
        } else {
          results.push(`unset: ${varName}: not set`);
        }
      }

      return results.join('\n');
    },
    'remove environment variables',
    'System'
  );
})();

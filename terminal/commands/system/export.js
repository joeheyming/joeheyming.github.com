// export command - set environment variables
(function () {
  'use strict';

  registerCommand(
    'export',
    (terminal, args) => {
      if (args.length === 0) {
        // Show all exported variables
        const envVars = terminal.getAllEnv();
        return Object.entries(envVars)
          .map(([key, value]) => `export ${key}="${value}"`)
          .join('\n');
      }

      // Parse variable assignments
      const results = [];
      for (const arg of args) {
        if (arg.includes('=')) {
          const [key, ...valueParts] = arg.split('=');
          const value = valueParts.join('='); // Handle values with = in them

          if (!key.match(/^[A-Za-z_][A-Za-z0-9_]*$/)) {
            results.push(`export: '${key}': not a valid identifier`);
            continue;
          }

          // Remove quotes if present
          const cleanValue = value.replace(/^["']|["']$/g, '');
          terminal.setEnv(key, cleanValue);
          results.push(`export ${key}="${cleanValue}"`);
        } else {
          // Just export existing variable (make it available to child processes)
          const value = terminal.getEnv(arg);
          if (value !== undefined) {
            results.push(`export ${arg}="${value}"`);
          } else {
            results.push(`export: ${arg}: not found`);
          }
        }
      }

      return results.join('\n');
    },
    'set environment variables',
    'System'
  );
})();

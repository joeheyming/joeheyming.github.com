// env command - display environment variables
(function () {
  'use strict';

  registerCommand(
    'env',
    (terminal, args) => {
      const envVars = terminal.getAllEnv();
      return Object.entries(envVars)
        .map(([key, value]) => `${key}=${value}`)
        .sort()
        .join('\n');
    },
    'display environment variables',
    'System'
  );
})();

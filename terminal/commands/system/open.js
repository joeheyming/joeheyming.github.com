// Open command - Alias for 'launch' (mimics macOS 'open' behavior)

(function () {
  'use strict';

  registerCommand(
    'open',
    async (terminal, args) => {
      const launchCmd = await window.commandRegistry.get('launch');
      if (launchCmd) {
        return await launchCmd(terminal, args);
      }
      return {
        stdout: '',
        stderr: 'open: launch command not available',
        exitCode: 1
      };
    },
    'Open files or apps (alias for launch)',
    'System'
  );
})();

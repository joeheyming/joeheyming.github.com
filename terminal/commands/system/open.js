// Open command - Alias for 'launch' (mimics macOS 'open' behavior)

(function () {
  'use strict';

  registerCommand(
    'open',
    async (terminal, args) => {
      // Just delegate to launch command
      const launchCmd = window.commandRegistry.get('launch');
      if (launchCmd) {
        return await launchCmd(terminal, args);
      }
      return '❌ launch command not available';
    },
    'Open files or apps (alias for launch)',
    'System'
  );
})();

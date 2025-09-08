// history command - show command history
(function () {
  'use strict';

  registerCommand('history', (terminal, args) => {
    if (terminal.commandHistory.length === 0) {
      return '';
    }

    return terminal.commandHistory
      .map((cmd, index) => `${(index + 1).toString().padStart(4)} ${cmd}`)
      .join('\n');
  }, 'show command history', 'System');
})();

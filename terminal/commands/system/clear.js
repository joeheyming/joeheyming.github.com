// clear command - clear terminal
(function () {
  'use strict';

  registerCommand('clear', (terminal, _args) => {
    terminal.clearScreen();
    return '';
  }, 'clear terminal', 'System');
})();

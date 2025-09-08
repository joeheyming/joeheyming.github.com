// exit command - exit terminal
(function () {
  'use strict';

  registerCommand('exit', (terminal, args) => {
    return 'Goodbye! (Window will close)';
  }, 'exit terminal', 'System');
})();

// whoami command - display username
(function () {
  'use strict';

  registerCommand('whoami', (terminal, args) => {
    return terminal.env.USER;
  }, 'display current username', 'System');
})();

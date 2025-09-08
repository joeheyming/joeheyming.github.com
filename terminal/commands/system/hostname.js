// hostname command - display system hostname
(function () {
  'use strict';

  registerCommand('hostname', (terminal, args) => {
    return terminal.env.HOSTNAME;
  }, 'display system hostname', 'System');
})();

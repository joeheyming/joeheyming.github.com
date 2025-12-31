// uptime command - system uptime
(function () {
  'use strict';

  registerCommand(
    'uptime',
    (terminal, args) => {
      return 'System has been running for ' + Math.floor(Math.random() * 100) + ' hours';
    },
    'system uptime',
    'System'
  );
})();

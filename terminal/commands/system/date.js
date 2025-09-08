// date command - display current date and time
(function () {
  'use strict';

  registerCommand('date', (terminal, args) => {
    const now = new Date();

    // Basic date formats
    if (args.includes('-u')) {
      return now.toUTCString();
    } else if (args.includes('-I')) {
      return now.toISOString().split('T')[0];
    } else {
      return now.toString();
    }
  }, 'display current date and time (-u for UTC, -I for ISO)', 'System');
})();

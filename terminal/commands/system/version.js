// version command - show terminal version
(function () {
  'use strict';

  registerCommand(
    'version',
    (terminal, args) => {
      return 'Heyming OS Terminal v2.0 - Now with 100% more jokes! 🎉';
    },
    'show terminal version',
    'System'
  );
})();

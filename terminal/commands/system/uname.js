// uname command - show system info
(function () {
  'use strict';

  registerCommand('uname', (terminal, args) => {
    return 'Linux heyming-os 5.15.0-generic #1 SMP PREEMPT';
  }, 'show system info', 'System');
})();

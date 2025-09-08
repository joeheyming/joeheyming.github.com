// which command - locate a command
(function () {
  'use strict';

  registerCommand('which', (terminal, args) => {
    if (args.length === 0) {
      return 'which: usage: which command';
    }

    const cmdName = args[0];

    // Check if it's an alias
    if (terminal.aliases[cmdName]) {
      return `${cmdName}: aliased to ${terminal.aliases[cmdName]}`;
    }

    // Check if it's a built-in command
    if (window.commandRegistry.has(cmdName)) {
      return `/bin/${cmdName}`;
    }

    return `which: no ${cmdName} in (${terminal.env.PATH})`;
  }, 'locate a command', 'System');
})();

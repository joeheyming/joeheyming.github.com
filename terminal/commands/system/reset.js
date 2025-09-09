// reset command - reset terminal to initial state
(function () {
  'use strict';

  registerCommand(
    'reset',
    (terminal, args) => {
      // Clear the screen
      terminal.clearScreen();

      // Reset aliases
      terminal.aliases = {};

      // Reset environment to defaults (keep core system vars)
      const coreVars = {
        USER: 'jheyming',
        HOME: '/home/jheyming',
        PWD: '/home/jheyming',
        SHELL: '/bin/jsh',
        TERM: 'heyming-terminal',
        PATH: '/bin:/usr/bin:/usr/local/bin',
        HOSTNAME: 'heyming-os',
        LANG: 'en_US.UTF-8',
        EDITOR: 'nano',
        PAGER: 'less'
      };

      terminal.env = { ...coreVars };
      terminal.currentDirectory = terminal.env.HOME;

      // Clear command history if -h flag is provided
      if (args.includes('-h')) {
        terminal.commandHistory = [];
        terminal.historyIndex = -1;
      }

      return `Terminal reset to initial state
${
  args.includes('-h') ? 'Command history cleared' : 'Use "reset -h" to also clear command history'
}`;
    },
    'reset terminal to initial state',
    'System'
  );
})();

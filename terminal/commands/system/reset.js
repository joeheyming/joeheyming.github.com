// reset command - reset terminal to initial state
(function () {
  'use strict';

  const USAGE = `reset: usage: reset [--help] [-h]

  --help        Show this help
  -h            Also clear command history (jsh extension; not GNU reset)`;

  registerCommand(
    'reset',
    (terminal, args) => {
      let historyClear = false;
      let i = 0;
      while (i < args.length) {
        const a = args[i];
        if (a === '--') {
          i++;
          break;
        }
        if (a === '--help') {
          return { stdout: `${USAGE}\n`, stderr: '', exitCode: 0 };
        }
        if (a === '-h') {
          historyClear = true;
          i++;
          continue;
        }
        if (a.startsWith('-')) {
          return {
            stdout: '',
            stderr: `reset: invalid option -- '${a.replace(/^-/, '')}'\n${USAGE}`,
            exitCode: 2
          };
        }
        break;
      }
      const rest = args.slice(i);
      if (rest.length > 0) {
        return {
          stdout: '',
          stderr: `reset: extra operand '${rest[0]}'`,
          exitCode: 1
        };
      }

      terminal.clearScreen();

      terminal.aliases = {};

      const coreVars = {
        USER: window.parent?.HeymingOS?.Config?.USER || 'jheyming',
        HOME: window.parent?.HeymingOS?.Config?.HOME || '/home/jheyming',
        PWD: window.parent?.HeymingOS?.Config?.HOME || '/home/jheyming',
        SHELL: '/bin/jsh',
        TERM: 'heyming-terminal',
        PATH: '/bin:/usr/bin:/usr/local/bin',
        HOSTNAME: 'heyming-os',
        LANG: 'en_US.UTF-8',
        EDITOR: 'nano',
        PAGER: 'less'
      };

      terminal.env = { ...coreVars };
      terminal.updatePWD(terminal.env.HOME);

      if (historyClear) {
        terminal.commandHistory = [];
        terminal.historyIndex = -1;
      }

      return { stdout: '', stderr: '', exitCode: 0 };
    },
    'reset terminal to initial state',
    'System'
  );
})();

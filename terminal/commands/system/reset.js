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

      const _su = () => {
        try {
          return localStorage.getItem('heymingOS_username');
        } catch {
          return null;
        }
      };
      const _sh = () => {
        try {
          return localStorage.getItem('heymingOS_hostname');
        } catch {
          return null;
        }
      };
      const _u = window.parent?.HeymingOS?.Config?.USER || _su() || 'user';
      const _h = window.parent?.HeymingOS?.Config?.HOME || `/home/${_u}`;
      const coreVars = {
        USER: _u,
        HOME: _h,
        PWD: _h,
        SHELL: '/bin/jsh',
        TERM: 'heyming-terminal',
        PATH: '/bin:/usr/bin:/usr/local/bin',
        HOSTNAME: window.parent?.HeymingOS?.Config?.HOSTNAME || _sh() || 'heyming-os',
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

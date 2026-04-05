// clear command - clear terminal
(function () {
  'use strict';

  const USAGE = `clear: usage: clear [-h | --help]

  -h, --help    Show this help`;

  registerCommand(
    'clear',
    (terminal, args) => {
      let i = 0;
      while (i < args.length) {
        const a = args[i];
        if (a === '--') {
          i++;
          break;
        }
        if (a === '--help' || a === '-h') {
          return { stdout: `${USAGE}\n`, stderr: '', exitCode: 0 };
        }
        if (a.startsWith('-')) {
          return {
            stdout: '',
            stderr: `clear: invalid option -- '${a.replace(/^-/, '')}'\n${USAGE}`,
            exitCode: 2
          };
        }
        break;
      }
      const rest = args.slice(i);
      if (rest.length > 0) {
        return {
          stdout: '',
          stderr: `clear: extra operand '${rest[0]}'`,
          exitCode: 1
        };
      }

      terminal.clearScreen();
      return { stdout: '', stderr: '', exitCode: 0 };
    },
    'clear terminal',
    'System'
  );
})();

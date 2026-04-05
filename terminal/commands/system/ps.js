// ps command - show running processes
(function () {
  'use strict';

  const PS_HELP = `Usage: ps [option]
  -h, --help   Show this help

Displays processes from the simulated process manager (browser; not POSIX ps).`;

  registerCommand(
    'ps',
    (terminal, args) => {
      if (args.includes('-h') || args.includes('--help')) {
        return { stdout: PS_HELP + '\n', stderr: '', exitCode: 0 };
      }

      const pm = terminal.os?.kernel?.processManager;
      if (!pm) {
        return {
          stdout: '',
          stderr: 'ps: process manager not available\n',
          exitCode: 1
        };
      }

      const processes = pm.getAllProcesses();
      let output = `  PID  PPID USER     STAT  ISOLATED COMMAND\n`;

      processes.forEach((proc) => {
        const isolated = proc.isolated ? 'YES' : 'NO';
        output += `${proc.pid.toString().padStart(5)} ${proc.parentPID
          .toString()
          .padStart(5)} ${String(proc.uid).padStart(8)} ${proc.state.padEnd(5)} ${isolated.padEnd(
          8
        )} ${proc.name}\n`;
      });

      return { stdout: output, stderr: '', exitCode: 0 };
    },
    'show running processes with isolation status',
    'System'
  );
})();

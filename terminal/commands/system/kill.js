// kill command — terminate processes (jsh simulated process manager; not POSIX kill(1))
(function () {
  'use strict';

  const SIGNAL_LIST = `Available signals:
 1) SIGHUP       2) SIGINT       3) SIGQUIT      4) SIGILL       5) SIGTRAP
 6) SIGABRT      7) SIGBUS       8) SIGFPE       9) SIGKILL     10) SIGUSR1
11) SIGSEGV     12) SIGUSR2     13) SIGPIPE     14) SIGALRM     15) SIGTERM
16) SIGSTKFLT   17) SIGCHLD     18) SIGCONT     19) SIGSTOP     20) SIGTSTP
`;

  registerCommand(
    'kill',
    async (terminal, args) => {
      const parsed = ShellCore.parseKillArgv(args);
      if (parsed.kind === 'usage' || parsed.kind === 'error') {
        return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
      }
      if (parsed.kind === 'list') {
        return { stdout: SIGNAL_LIST, stderr: '', exitCode: 0 };
      }

      const pm = terminal.os?.kernel?.processManager;
      if (!pm) {
        return {
          stdout: '',
          stderr: 'kill: process manager not available\n',
          exitCode: 1
        };
      }

      const { pids } = parsed;
      const stderrLines = [];

      try {
        const processes = pm.getAllProcesses() || [];

        for (const pid of pids) {
          const proc = processes.find((p) => p.pid === pid);

          if (!proc) {
            stderrLines.push(`kill: (${pid}) - No such process`);
            continue;
          }

          if (pid === 1) {
            stderrLines.push(`kill: (${pid}) - Operation not permitted (cannot kill init)`);
            continue;
          }

          if (proc.uid === 0 && terminal.env.USER !== 'root') {
            stderrLines.push(`kill: (${pid}) - Operation not permitted (cannot kill root process)`);
            continue;
          }

          try {
            // Simulated kernel: map all kill signals to termination (not full signal semantics).
            await pm.terminateProcess(pid);
          } catch (error) {
            stderrLines.push(`kill: (${pid}) - ${error.message}`);
          }
        }
      } catch (error) {
        return {
          stdout: '',
          stderr: `kill: error accessing process information: ${error.message}\n`,
          exitCode: 1
        };
      }

      const stderrOut = stderrLines.length ? `${stderrLines.join('\n')}\n` : '';
      return {
        stdout: '',
        stderr: stderrOut,
        exitCode: stderrLines.length > 0 ? 1 : 0
      };
    },
    'terminate processes',
    'System'
  );
})();

// kill command - terminate processes
(function () {
  'use strict';

  registerCommand('kill', (terminal, args) => {
    if (args.length === 0) {
      return `kill: usage: kill [-s sigspec | -n signum | -sigspec] pid | jobspec ... or kill -l [sigspec]`;
    }

    // Handle -l flag to list signals
    if (args.includes('-l')) {
      return `Available signals:
 1) SIGHUP       2) SIGINT       3) SIGQUIT      4) SIGILL       5) SIGTRAP
 6) SIGABRT      7) SIGBUS       8) SIGFPE       9) SIGKILL     10) SIGUSR1
11) SIGSEGV     12) SIGUSR2     13) SIGPIPE     14) SIGALRM     15) SIGTERM
16) SIGSTKFLT   17) SIGCHLD     18) SIGCONT     19) SIGSTOP     20) SIGTSTP`;
    }

    let signal = 'SIGTERM'; // Default signal
    let pids = [];
    
    // Parse arguments for signal and PIDs
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg.startsWith('-')) {
        if (arg === '-9' || arg === '-KILL') {
          signal = 'SIGKILL';
        } else if (arg === '-15' || arg === '-TERM') {
          signal = 'SIGTERM';
        } else if (arg === '-1' || arg === '-HUP') {
          signal = 'SIGHUP';
        } else if (arg === '-2' || arg === '-INT') {
          signal = 'SIGINT';
        } else {
          return `kill: invalid signal specification '${arg}'`;
        }
      } else {
        const pid = parseInt(arg);
        if (isNaN(pid)) {
          return `kill: '${arg}': arguments must be process or job IDs`;
        }
        pids.push(pid);
      }
    }

    if (pids.length === 0) {
      return 'kill: usage: kill [-s sigspec | -n signum | -sigspec] pid | jobspec ...';
    }

    const results = [];
    
    try {
      // Get processes from OS kernel if available
      const processes = terminal.os?.kernel?.processManager?.getAllProcesses() || [];
      
      for (const pid of pids) {
        // Check if PID exists
        const process = processes.find(p => p.pid === pid);
        
        if (!process) {
          results.push(`kill: (${pid}) - No such process`);
          continue;
        }
        
        // Check permissions (can't kill system processes)
        if (pid === 1) {
          results.push(`kill: (${pid}) - Operation not permitted (cannot kill init)`);
          continue;
        }
        
        if (process.uid === 0 && terminal.env.USER !== 'root') {
          results.push(`kill: (${pid}) - Operation not permitted (cannot kill root process)`);
          continue;
        }
        
        // Simulate killing the process
        try {
          if (terminal.os?.kernel?.processManager?.terminateProcess) {
            await terminal.os.kernel.processManager.terminateProcess(pid);
            results.push(`Terminated process ${pid} (${process.name}) with ${signal}`);
          } else {
            results.push(`Simulated: Terminated process ${pid} with ${signal}`);
          }
        } catch (error) {
          results.push(`kill: (${pid}) - ${error.message}`);
        }
      }
    } catch (error) {
      return `kill: error accessing process information: ${error.message}`;
    }
    
    return results.join('\n');
  }, 'terminate processes', 'System');
})();

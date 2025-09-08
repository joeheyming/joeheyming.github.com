// ps command - show running processes
(function () {
  'use strict';

  registerCommand('ps', (terminal, args) => {
    // Always use OS Mode - Real process list
    const processes = terminal.os.kernel.processManager.getAllProcesses();
    let output = `  PID  PPID USER     STAT  COMMAND\n`;
    
    processes.forEach(proc => {
      output += `${proc.pid.toString().padStart(5)} ${proc.parentPID.toString().padStart(5)} ${proc.uid.toString().padStart(8)} ${proc.state.padEnd(5)} ${proc.name}\n`;
    });
    
    return output;
  }, 'show running processes', 'System');
})();

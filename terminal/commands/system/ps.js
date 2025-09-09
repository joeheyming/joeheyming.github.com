// ps command - show running processes
(function () {
  'use strict';

  registerCommand('ps', (terminal, args) => {
    const processes = terminal.os.kernel.processManager.getAllProcesses();
    let output = `  PID  PPID USER     STAT  ISOLATED COMMAND\n`;
    
    processes.forEach(proc => {
      const isolated = proc.isolated ? 'YES' : 'NO';
      output += `${proc.pid.toString().padStart(5)} ${proc.parentPID.toString().padStart(5)} ${proc.uid.toString().padStart(8)} ${proc.state.padEnd(5)} ${isolated.padEnd(8)} ${proc.name}\n`;
    });
    
    return output;
  }, 'show running processes with isolation status', 'System');
})();

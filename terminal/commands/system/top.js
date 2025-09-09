// top command - display running processes (interactive)
(function () {
  'use strict';

  function generateTopOutput(terminal) {
    try {
      // Get processes from OS kernel if available
      const processes = terminal.os?.kernel?.processManager?.getAllProcesses() || [];

      // Generate system info
      const uptime = Math.floor(Date.now() / 1000 - (window.startTime || Date.now() / 1000));
      const hours = Math.floor(uptime / 3600);
      const minutes = Math.floor((uptime % 3600) / 60);
      const seconds = uptime % 60;

      let output = `top - ${new Date().toLocaleTimeString()} up ${hours}:${minutes
        .toString()
        .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}\n`;
      output += `Tasks: ${processes.length} total\n`;
      output += `Load average: ${(Math.random() * 2).toFixed(2)}, ${(Math.random() * 2).toFixed(
        2
      )}, ${(Math.random() * 2).toFixed(2)}\n\n`;

      // Header
      output += `  PID USER      PR  NI    VIRT    RES    SHR S  %CPU %MEM     TIME+ COMMAND\n`;

      if (processes.length === 0) {
        // Fallback to simulated processes
        const fakeProcesses = [
          {
            pid: 1,
            user: 'root',
            command: 'init',
            cpu: Math.random() * 0.5,
            mem: 0.1,
            time: '0:01.23',
            state: 'S'
          },
          {
            pid: 2,
            user: 'root',
            command: 'kthreadd',
            cpu: 0.0,
            mem: 0.0,
            time: '0:00.00',
            state: 'S'
          },
          {
            pid: terminal.process?.pid || 1337,
            user: terminal.env.USER,
            command: 'jsh',
            cpu: Math.random() * 2 + 0.5,
            mem: 2.3,
            time: '0:05.67',
            state: 'R'
          },
          {
            pid: 42,
            user: terminal.env.USER,
            command: 'heyming-os',
            cpu: Math.random() * 1 + 0.2,
            mem: 15.2,
            time: '1:23.45',
            state: 'S'
          }
        ];

        fakeProcesses.forEach((proc) => {
          output += `${proc.pid.toString().padStart(5)} ${proc.user.padEnd(8)} 20   0 ${(
            Math.random() * 100000
          )
            .toFixed(0)
            .padStart(8)} ${(Math.random() * 10000).toFixed(0).padStart(6)} ${(Math.random() * 1000)
            .toFixed(0)
            .padStart(6)} ${proc.state} ${proc.cpu.toFixed(1).padStart(5)} ${proc.mem
            .toFixed(1)
            .padStart(4)} ${proc.time.padStart(9)} ${proc.command}\n`;
        });
      } else {
        // Real processes from OS
        processes.forEach((proc) => {
          const cpu = (Math.random() * 5).toFixed(1);
          const mem = (Math.random() * 10).toFixed(1);
          const time = `${Math.floor(Math.random() * 60)}:${Math.floor(Math.random() * 60)
            .toString()
            .padStart(2, '0')}.${Math.floor(Math.random() * 100)
            .toString()
            .padStart(2, '0')}`;

          output += `${proc.pid.toString().padStart(5)} ${(proc.uid === 0
            ? 'root'
            : terminal.env.USER
          ).padEnd(8)} 20   0 ${(Math.random() * 100000).toFixed(0).padStart(8)} ${(
            Math.random() * 10000
          )
            .toFixed(0)
            .padStart(6)} ${(Math.random() * 1000).toFixed(0).padStart(6)} ${
            proc.state || 'S'
          } ${cpu.padStart(5)} ${mem.padStart(4)} ${time.padStart(9)} ${proc.name}\n`;
        });
      }

      output += `\n🔄 Refreshing every 3 seconds... Press 'q' to quit, 'r' to refresh now`;

      return output;
    } catch (error) {
      return `top: error accessing process information: ${error.message}`;
    }
  }

  registerCommand(
    'top',
    (terminal, args) => {
      // Set current process info
      terminal.setCurrentProcess({
        name: 'top',
        pid: Math.floor(Math.random() * 10000),
        command: 'top'
      });

      // Create interactive top modal
      const modal = terminal.createModal({
        className: 'top-modal',
        title: 'top - Process Monitor',
        content: `<div class="top-content">
          <pre class="top-output">${generateTopOutput(terminal)}</pre>
        </div>`,
        onKeyDown: (e) => {
          // Ctrl+C handled automatically by modal system
          if (e.key === 'q' || e.key === 'Q' || e.key === 'Escape') {
            modal.close();
            // Don't call clearCurrentProcess() here - modal.close() handles it
          } else if (e.key === 'r' || e.key === 'R') {
            // Refresh immediately
            const newOutput = generateTopOutput(terminal);
            modal.update(`<div class="top-content">
              <pre class="top-output">${newOutput}</pre>
            </div>`);
          }
        }
      });

      // Add CSS for top modal
      const topStyles = `
        .top-modal {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          background: #000;
          color: #0f0;
          font-family: 'Courier New', monospace;
          font-size: 12px;
          z-index: 1000;
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }
        .top-content {
          flex: 1;
          overflow: auto;
          padding: 10px;
        }
        .top-output {
          margin: 0;
          white-space: pre;
          font-family: 'Courier New', monospace;
          font-size: 12px;
          line-height: 1.2;
        }
      `;

      terminal.addStyles(topStyles);

      // Auto-refresh every 3 seconds
      const refreshInterval = setInterval(() => {
        if (modal.element.parentNode) {
          const newOutput = generateTopOutput(terminal);
          modal.update(`<div class="top-content">
            <pre class="top-output">${newOutput}</pre>
          </div>`);
        } else {
          // Modal was closed, stop refreshing
          clearInterval(refreshInterval);
        }
      }, 3000);

      // Register signal handler for SIGINT (Ctrl+C)
      terminal.onSignal('SIGINT', () => {
        // Clean up top process
        clearInterval(refreshInterval);
        modal.close();
        // Don't call clearCurrentProcess() here - let modal.close() handle it
      });

      // Clean up interval when modal closes
      const originalClose = modal.close;
      modal.close = () => {
        clearInterval(refreshInterval);
        terminal.clearCurrentProcess();
        originalClose();
      };

      return ''; // Don't return output since we're using modal
    },
    'display running processes (interactive)',
    'System'
  );
})();

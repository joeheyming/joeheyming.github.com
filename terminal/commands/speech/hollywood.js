// hollywood command - Hollywood terminal simulation
(function () {
  'use strict';

  registerCommand('hollywood', (terminal, args) => {
    setTimeout(() => {
      terminal.addOutput('🎬 Hollywood Terminal Simulation Starting...');
      terminal.addOutput('');
      terminal.addOutput('HOLLYWOOD TERMINAL - System Monitor v2.0');
      terminal.addOutput('═'.repeat(50));
      terminal.addOutput('');

      // Simulate multiple monitoring panels
      const panels = [
        'Network Traffic: eth0: 1.2MB/s ↑ 856KB/s ↓',
        'System Load: Load: 0.52, 0.58, 0.55',
        'Process Monitor: PID 1234: terminal (2.1% CPU)',
        'Memory Usage: Total: 16GB, Used: 8.2GB (51%)',
        'Disk I/O: sda: 45MB/s read, 23MB/s write',
        'Temperature: CPU: 42°C, GPU: 38°C',
        'Network: Packets: 1,234,567 in, 987,654 out',
        'Security: No threats detected'
      ];

      let panelIndex = 0;
      const interval = setInterval(() => {
        terminal.addOutput(
          `[${new Date().toLocaleTimeString()}] ${panels[panelIndex % panels.length]}`
        );
        panelIndex++;

        if (panelIndex >= 20) {
          clearInterval(interval);
          terminal.addOutput('');
          terminal.addOutput('🎬 Hollywood Terminal Simulation Complete!');
        }
      }, 500);
    }, 100);

    return '';
  }, 'Hollywood terminal simulation', 'Speech & Media');
})();

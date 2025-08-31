// System Commands for Heyming Terminal
(function () {
  'use strict';

  const systemCommands = {
    whoami: {
      handler: (terminal, args) => 'user',
      description: 'display username'
    },

    date: {
      handler: (terminal, args) => new Date().toString(),
      description: 'display current date/time'
    },

    clear: {
      handler: (terminal, args) => {
        if (terminal.isStandalone) {
          // Standalone mode - clear the output
          const terminalOutput = document.getElementById('terminal-output');
          terminalOutput.innerHTML = '';
        } else {
          // OS-integrated mode - original behavior
          setTimeout(() => {
            const windowElement = document.getElementById(`window-${terminal.windowId}`);
            const terminalContent = windowElement.querySelector('.terminal-content');
            terminalContent.innerHTML = `
              <div class="terminal-line">
                <span class="terminal-prompt">user@heyming-os:${terminal.getShortPath()}$</span> <input type="text" class="terminal-input" placeholder="Type a command...">
              </div>
            `;
            terminal.initialize();
          }, 100);
        }
        return '';
      },
      description: 'clear terminal'
    },

    echo: {
      handler: (terminal, args) => args.join(' '),
      description: 'print text'
    },

    version: {
      handler: (terminal, args) => 'Heyming OS Terminal v2.0 - Now with 100% more jokes! 🎉',
      description: 'show terminal version'
    },

    uptime: {
      handler: (terminal, args) =>
        'System has been running for ' + Math.floor(Math.random() * 100) + ' hours',
      description: 'system uptime'
    },

    ps: {
      handler: (terminal, args) =>
        'PID TTY TIME CMD\n1234 pts/0 00:00:01 terminal\n5678 pts/0 00:00:00 fake-process',
      description: 'list processes'
    },

    neofetch: {
      handler: (terminal, args) => {
        return `user@heyming-os
----------------
OS: Heyming OS 2.0
Kernel: Linux 5.15.0-generic
Shell: bash 5.1.16
Terminal: Heyming Terminal
CPU: Intel i7-12700K
Memory: 16GB RAM
Disk: 1TB SSD
Uptime: ${Math.floor(Math.random() * 10)} days, ${Math.floor(Math.random() * 24)} hours`;
      },
      description: 'show system information'
    },

    ping: {
      handler: (terminal, args) => {
        const host = args[0] || 'google.com';
        setTimeout(() => {
          terminal.addOutput(`PING ${host} (142.250.191.78) 56(84) bytes of data.`);
          setTimeout(() => {
            terminal.addOutput('64 bytes from 142.250.191.78: icmp_seq=1 ttl=113 time=15.2 ms');
          }, 500);
          setTimeout(() => {
            terminal.addOutput('64 bytes from 142.250.191.78: icmp_seq=2 ttl=113 time=14.8 ms');
          }, 1000);
          setTimeout(() => {
            terminal.addOutput('--- google.com ping statistics ---');
            terminal.addOutput('2 packets transmitted, 2 received, 0% packet loss, time 1001ms');
          }, 1500);
        }, 100);
        return '';
      },
      description: 'ping a host'
    },

    top: {
      handler: (terminal, args) => {
        return `top - ${new Date().toLocaleTimeString()} up 3 days,  7:15,  1 user,  load average: 0.52, 0.58, 0.55
Tasks: 245 total,   1 running, 244 sleeping,   0 stopped,   0 zombie
%Cpu(s):  2.1 us,  1.2 sy,  0.0 ni, 96.5 id,  0.2 wa,  0.0 hi,  0.0 si,  0.0 st
MiB Mem :  16384.0 total,  10240.0 free,   2048.0 used,   4096.0 buff/cache
MiB Swap:   8192.0 total,   8192.0 free,      0.0 used.  13312.0 avail Mem

  PID USER      PR  NI    VIRT    RES    SHR S  %CPU  %MEM     TIME+ COMMAND
 1234 user      20   0  1234567  12345  1234 S   2.1   0.1   0:15.23 terminal
 5678 user      20   0   987654   9876   987 S   1.8   0.1   0:12.45 browser
 9012 user      20   0   654321   6543   654 S   1.5   0.0   0:08.92 editor`;
      },
      description: 'show system processes'
    },

    kill: {
      handler: (terminal, args) => {
        if (!args[0]) {
          return 'kill: usage: kill [-s sigspec | -n signum | -sigspec] pid | jobspec ... or kill -l [sigspec]';
        }
        return `Process ${args[0]} killed`;
      },
      description: 'kill a process'
    },

    uname: {
      handler: (terminal, args) => 'Linux heyming-os 5.15.0-generic #1 SMP PREEMPT',
      description: 'show system info'
    },

    history: {
      handler: (terminal, args) => {
        let output = '';
        terminal.commandHistory.forEach((cmd, index) => {
          output += `${index + 1}  ${cmd}\n`;
        });
        return output || 'No command history available.';
      },
      description: 'show command history'
    },

    exit: {
      handler: (terminal, args) => 'Goodbye! (Window will close)',
      description: 'exit terminal'
    }
  };

  // if in an iframe, add the launch command
  if (window.self !== window.top) {
    systemCommands.launch = {
      handler: (terminal, args) => {
        console.log('Launching app:', args[0]);
        window.parent.postMessage(
          { type: 'iframe-message', message: { type: 'launch', app: args[0] } },
          '*'
        );
        return `Launching ${args[0]}...`;
      },
      description: 'launch an app'
    };
  }

  // Define which commands are apps vs system utilities
  const appCommands = ['exit'];

  // Register all system commands with appropriate categories
  Object.entries(systemCommands).forEach(([name, cmd]) => {
    const category = appCommands.includes(name) ? 'Apps' : 'System';
    registerCommand(name, cmd.handler, cmd.description, category);
  });
})();

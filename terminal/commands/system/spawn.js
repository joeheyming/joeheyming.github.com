// spawn command - create isolated processes with Web Workers
(function () {
  'use strict';

  registerCommand(
    'spawn',
    async (terminal, args) => {
      if (!terminal.os?.kernel?.processManager) {
        return 'Error: Process manager not available';
      }

      const flags = {
        help: args.includes('-h') || args.includes('--help'),
        isolated: !args.includes('--no-isolation'),
        memory: getArgValue(args, '--memory') || '16M',
        cpu: getArgValue(args, '--cpu-time') || '5s',
        list: args.includes('-l') || args.includes('--list'),
        kill: getArgValue(args, '--kill'),
        info: getArgValue(args, '--info')
      };

      if (flags.help) {
        return `spawn - create and manage isolated processes

Usage: spawn [options] [command] [args...]

Options:
  -l, --list              List all processes
  --info PID              Show detailed info for process PID
  --kill PID              Kill process PID
  --memory SIZE           Set memory limit (default: 16M)
  --cpu-time TIME         Set CPU time limit (default: 5s)
  --no-isolation          Run in main thread (not isolated)
  -h, --help              Show this help

Examples:
  spawn echo "Hello from worker!"    # Run echo in isolated worker
  spawn --memory 32M --cpu-time 10s long-running-task
  spawn -l                           # List all processes
  spawn --info 1234                  # Show info for process 1234
  spawn --kill 1234                  # Kill process 1234

Description:
  Creates new processes with proper isolation using Web Workers.
  Each isolated process runs in its own thread with resource limits.`;
      }

      const processManager = terminal.os.kernel.processManager;

      // List processes
      if (flags.list) {
        const processes = processManager.getAllProcesses();
        if (processes.length === 0) {
          return 'No processes running';
        }

        let output = '  PID  PPID USER     STAT  ISOLATED MEMORY    CPU     COMMAND\n';
        processes.forEach((proc) => {
          const memUsage = formatBytes(proc.memoryUsage || 0);
          const cpuTime = formatTime(proc.cpuTime || 0);
          const isolated = proc.isolated ? 'YES' : 'NO';

          output += `${proc.pid.toString().padStart(5)} `;
          output += `${proc.parentPID.toString().padStart(5)} `;
          output += `${(proc.uid || 'user').toString().padEnd(8)} `;
          output += `${proc.state.padEnd(5)} `;
          output += `${isolated.padEnd(8)} `;
          output += `${memUsage.padEnd(9)} `;
          output += `${cpuTime.padEnd(7)} `;
          output += `${proc.name}\n`;
        });
        return output;
      }

      // Show process info
      if (flags.info) {
        const pid = parseInt(flags.info);
        const process = processManager.getProcess(pid);

        if (!process) {
          return `Process ${pid} not found`;
        }

        let output = `Process Information (PID ${pid}):\n`;
        output += `  Name: ${process.name}\n`;
        output += `  State: ${process.state}\n`;
        output += `  Parent PID: ${process.parentPID}\n`;
        output += `  User ID: ${process.uid}\n`;
        output += `  Group ID: ${process.gid}\n`;
        output += `  Isolated: ${process.isolated ? 'Yes' : 'No'}\n`;
        output += `  Start Time: ${new Date(process.startTime).toLocaleString()}\n`;
        output += `  CPU Time: ${formatTime(process.cpuTime || 0)}\n`;
        output += `  Memory Usage: ${formatBytes(process.memoryUsage || 0)}\n`;
        output += `  Memory Limit: ${formatBytes(process.limits?.memory || 0)}\n`;
        output += `  CPU Time Limit: ${formatTime(process.limits?.cpuTime || 0)}\n`;
        output += `  Working Directory: ${process.cwd}\n`;
        output += `  Children: ${Array.from(process.children || []).join(', ') || 'None'}\n`;

        // Get real-time resource usage if isolated
        if (process.isolated && process.state !== 'TERMINATED') {
          try {
            const resourceUsage = await processManager.getProcessResourceUsage(pid);
            output += `\nReal-time Resource Usage:\n`;
            output += `  Memory Used: ${formatBytes(resourceUsage.memoryUsed)}\n`;
            output += `  CPU Time Used: ${formatTime(resourceUsage.cpuTimeUsed)}\n`;
          } catch (error) {
            output += `\nCould not get real-time resource usage: ${error.message}\n`;
          }
        }

        return output;
      }

      // Kill process
      if (flags.kill) {
        const pid = parseInt(flags.kill);
        try {
          await processManager.sendSignal(pid, processManager.SIGNALS.SIGTERM);
          return `Sent SIGTERM to process ${pid}`;
        } catch (error) {
          return `Failed to kill process ${pid}: ${error.message}`;
        }
      }

      // Create new process
      if (args.length === 0 || args.every((arg) => arg.startsWith('-'))) {
        return 'Error: No command specified. Use --help for usage information.';
      }

      // Parse command and arguments
      const commandArgs = args.filter((arg) => !arg.startsWith('-'));
      const command = commandArgs[0];
      const commandArguments = commandArgs.slice(1);

      // Parse resource limits
      const memoryLimit = parseMemorySize(flags.memory);
      const cpuTimeLimit = parseTimeLimit(flags.cpu);

      try {
        // Create the process
        const process = await processManager.createProcess({
          name: command,
          executable: `/bin/${command}`,
          args: commandArguments,
          parentPID: terminal.process?.pid || 1,
          uid: terminal.env.USER || 'user',
          gid: terminal.env.USER || 'user',
          env: terminal.env,
          cwd: terminal.currentDirectory,
          isolated: flags.isolated,
          limits: {
            memory: memoryLimit,
            cpuTime: cpuTimeLimit
          }
        });

        let output = `Process created: ${process.name} (PID ${process.pid})\n`;
        output += `Isolation: ${process.isolated ? 'Enabled' : 'Disabled'}\n`;
        output += `Memory limit: ${formatBytes(memoryLimit)}\n`;
        output += `CPU time limit: ${formatTime(cpuTimeLimit)}\n`;

        // Execute the command in the process
        try {
          output += `\nExecuting command...\n`;
          const result = await processManager.executeCommand(
            process.pid,
            command,
            commandArguments,
            terminal.stdin || ''
          );

          if (result.stdout) {
            output += `\nSTDOUT:\n${result.stdout}`;
          }
          if (result.stderr) {
            output += `\nSTDERR:\n${result.stderr}`;
          }
          output += `\nProcess exited with code: ${result.exitCode}`;
        } catch (execError) {
          output += `\nExecution failed: ${execError.message}`;
        }

        return output;
      } catch (error) {
        return `Failed to create process: ${error.message}`;
      }
    },
    'create and manage isolated processes with Web Workers',
    'System'
  );

  // Helper functions
  function getArgValue(args, flag) {
    const index = args.indexOf(flag);
    return index !== -1 && index + 1 < args.length ? args[index + 1] : null;
  }

  function parseMemorySize(sizeStr) {
    const match = sizeStr.match(/^(\d+)([KMGT]?)$/i);
    if (!match) return 16 * 1024 * 1024; // Default 16MB

    const size = parseInt(match[1]);
    const unit = match[2].toUpperCase();

    switch (unit) {
      case 'K':
        return size * 1024;
      case 'M':
        return size * 1024 * 1024;
      case 'G':
        return size * 1024 * 1024 * 1024;
      case 'T':
        return size * 1024 * 1024 * 1024 * 1024;
      default:
        return size;
    }
  }

  function parseTimeLimit(timeStr) {
    const match = timeStr.match(/^(\d+)([smh]?)$/i);
    if (!match) return 5000; // Default 5 seconds

    const time = parseInt(match[1]);
    const unit = match[2].toLowerCase();

    switch (unit) {
      case 's':
        return time * 1000;
      case 'm':
        return time * 60 * 1000;
      case 'h':
        return time * 60 * 60 * 1000;
      default:
        return time; // Assume milliseconds
    }
  }

  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function formatTime(ms) {
    if (ms < 1000) return ms + 'ms';
    if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
    if (ms < 3600000) return (ms / 60000).toFixed(1) + 'm';
    return (ms / 3600000).toFixed(1) + 'h';
  }
})();

// Process Worker - Isolated execution environment for Heyming OS processes
// This runs in a separate thread with its own memory space

class ProcessWorker {
  constructor() {
    this.pid = null;
    this.name = null;
    this.env = {};
    this.cwd = '/';
    this.memoryUsed = 0;
    this.memoryLimit = 16 * 1024 * 1024; // 16MB default
    this.cpuTimeUsed = 0;
    this.cpuTimeLimit = 5000; // 5 seconds default
    this.startTime = Date.now();
    this.state = 'CREATED';

    // File descriptors (simulated)
    this.fileDescriptors = new Map();
    this.nextFD = 3; // 0=stdin, 1=stdout, 2=stderr

    // Signal handlers
    this.signalHandlers = new Map();

    // Command execution context
    this.commandRegistry = new Map();

    this.setupStandardStreams();
    this.setupMessageHandling();
    this.setupResourceMonitoring();
  }

  setupStandardStreams() {
    // Standard file descriptors
    this.fileDescriptors.set(0, { type: 'stdin', buffer: '' });
    this.fileDescriptors.set(1, { type: 'stdout', buffer: '' });
    this.fileDescriptors.set(2, { type: 'stderr', buffer: '' });
  }

  setupMessageHandling() {
    self.addEventListener('message', (event) => {
      const { type, data, id } = event.data;

      try {
        switch (type) {
          case 'INIT':
            this.handleInit(data);
            break;
          case 'EXEC':
            this.handleExec(data, id);
            break;
          case 'SIGNAL':
            this.handleSignal(data);
            break;
          case 'SYSCALL':
            this.handleSyscall(data, id);
            break;
          case 'RESOURCE_CHECK':
            this.handleResourceCheck(id);
            break;
          case 'TERMINATE':
            this.handleTerminate();
            break;
          default:
            this.sendError(id, `Unknown message type: ${type}`);
        }
      } catch (error) {
        this.sendError(id, error.message);
      }
    });
  }

  setupResourceMonitoring() {
    // Monitor memory usage every 100ms
    setInterval(() => {
      this.updateMemoryUsage();
      if (this.memoryUsed > this.memoryLimit) {
        this.sendMessage('RESOURCE_VIOLATION', {
          type: 'MEMORY',
          used: this.memoryUsed,
          limit: this.memoryLimit
        });
      }
    }, 100);

    // Monitor CPU time
    setInterval(() => {
      this.cpuTimeUsed = Date.now() - this.startTime;
      if (this.cpuTimeUsed > this.cpuTimeLimit) {
        this.sendMessage('RESOURCE_VIOLATION', {
          type: 'CPU',
          used: this.cpuTimeUsed,
          limit: this.cpuTimeLimit
        });
      }
    }, 1000);
  }

  handleInit(data) {
    this.pid = data.pid;
    this.name = data.name;
    this.env = data.env || {};
    this.cwd = data.cwd || '/';
    this.memoryLimit = data.memoryLimit || this.memoryLimit;
    this.cpuTimeLimit = data.cpuTimeLimit || this.cpuTimeLimit;

    this.state = 'READY';

    this.sendMessage('INIT_COMPLETE', {
      pid: this.pid,
      state: this.state
    });
  }

  async handleExec(data, id) {
    const { command, args, stdin } = data;

    this.state = 'RUNNING';

    try {
      // Set up stdin if provided
      if (stdin) {
        this.fileDescriptors.get(0).buffer = stdin;
      }

      // Execute the command
      const result = await this.executeCommand(command, args);

      // Get stdout/stderr
      const stdout = this.fileDescriptors.get(1).buffer;
      const stderr = this.fileDescriptors.get(2).buffer;

      // Clear buffers
      this.fileDescriptors.get(1).buffer = '';
      this.fileDescriptors.get(2).buffer = '';

      this.state = 'READY';

      this.sendMessage(
        'EXEC_COMPLETE',
        {
          stdout,
          stderr,
          exitCode: result.exitCode || 0
        },
        id
      );
    } catch (error) {
      this.state = 'READY';
      this.sendError(id, `Command execution failed: ${error.message}`);
    }
  }

  async executeCommand(command, args) {
    // Load and execute command in isolated context
    const commandHandler = this.commandRegistry.get(command);

    if (!commandHandler) {
      // Try to load command dynamically
      try {
        await this.loadCommand(command);
        return await this.executeCommand(command, args);
      } catch (loadError) {
        throw new Error(`Command not found: ${command}`);
      }
    }

    // Create execution context
    const context = {
      args,
      env: this.env,
      cwd: this.cwd,
      pid: this.pid,
      stdin: this.fileDescriptors.get(0).buffer,
      stdout: (data) => this.write(1, data),
      stderr: (data) => this.write(2, data),
      syscall: (name, ...args) => this.syscall(name, ...args)
    };

    // Execute with resource monitoring
    const startTime = Date.now();
    const result = await commandHandler(context);
    const executionTime = Date.now() - startTime;

    // Update CPU time
    this.cpuTimeUsed += executionTime;

    return result;
  }

  async loadCommand(command) {
    // Request command code from main thread
    const response = await this.sendSyncMessage('LOAD_COMMAND', { command });

    if (response.error) {
      throw new Error(response.error);
    }

    // Execute command code in worker context
    const commandFunction = new Function('context', response.code);
    this.commandRegistry.set(command, commandFunction);
  }

  write(fd, data) {
    const stream = this.fileDescriptors.get(fd);
    if (stream) {
      stream.buffer += data;
      this.updateMemoryUsage();
    }
  }

  async syscall(name, ...args) {
    // Forward syscall to main thread kernel
    const response = await this.sendSyncMessage('SYSCALL', {
      name,
      args,
      pid: this.pid
    });

    if (response.error) {
      throw new Error(response.error);
    }

    return response.result;
  }

  handleSignal(data) {
    const { signal } = data;

    // Handle built-in signals
    switch (signal) {
      case 'SIGTERM':
      case 'SIGKILL':
        this.handleTerminate();
        break;
      case 'SIGSTOP':
        this.state = 'STOPPED';
        break;
      case 'SIGCONT':
        this.state = 'RUNNING';
        break;
      default: {
        // Check for custom signal handlers
        const handler = this.signalHandlers.get(signal);
        if (handler) {
          handler(signal);
        }
      }
    }
  }

  handleSyscall(data, id) {
    // Forward to main thread
    this.sendMessage('SYSCALL_REQUEST', data, id);
  }

  handleResourceCheck(id) {
    this.sendMessage(
      'RESOURCE_STATUS',
      {
        memoryUsed: this.memoryUsed,
        memoryLimit: this.memoryLimit,
        cpuTimeUsed: this.cpuTimeUsed,
        cpuTimeLimit: this.cpuTimeLimit,
        state: this.state
      },
      id
    );
  }

  handleTerminate() {
    this.state = 'TERMINATED';
    this.sendMessage('PROCESS_EXIT', {
      pid: this.pid,
      exitCode: 0
    });

    // Clean up and terminate worker
    self.close();
  }

  updateMemoryUsage() {
    // Estimate memory usage (rough approximation)
    let usage = 0;

    // Count buffer sizes
    this.fileDescriptors.forEach((fd) => {
      if (fd.buffer) {
        usage += fd.buffer.length * 2; // Assume UTF-16
      }
    });

    // Count environment variables
    usage += JSON.stringify(this.env).length * 2;

    // Add base overhead
    usage += 1024 * 1024; // 1MB base

    this.memoryUsed = usage;
  }

  sendMessage(type, data, id = null) {
    self.postMessage({
      type,
      data,
      id,
      pid: this.pid
    });
  }

  sendError(id, message) {
    self.postMessage({
      type: 'ERROR',
      data: { message },
      id,
      pid: this.pid
    });
  }

  async sendSyncMessage(type, data) {
    return new Promise((resolve) => {
      const id = Math.random().toString(36).substr(2, 9);

      const handler = (event) => {
        if (event.data.id === id) {
          self.removeEventListener('message', handler);
          resolve(event.data.data);
        }
      };

      self.addEventListener('message', handler);
      this.sendMessage(type, data, id);
    });
  }
}

// Initialize the worker
const processWorker = new ProcessWorker();

// Export for testing (if needed)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ProcessWorker;
}

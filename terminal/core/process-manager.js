// Process Manager - Uses Web Workers for actual process isolation
import { commandRegistry } from '../commands.js';
import { ShellCore } from '../lib/shell-core.js';

export class ProcessManager {
  constructor(kernel) {
    this.kernel = kernel;
    this.processes = new Map();
    this.workers = new Map();
    this.nextPID = 1;
    this.currentProcess = null;
    this.processGroups = new Map();
    this.nextPGID = 1;

    // Process states
    this.PROCESS_STATES = {
      CREATED: 'created',
      READY: 'ready',
      RUNNING: 'running',
      BLOCKED: 'blocked',
      STOPPED: 'stopped',
      TERMINATED: 'terminated',
      ZOMBIE: 'zombie'
    };

    // Signal names (strings match process-worker.js handleSignal switch cases)
    this.SIGNALS = {
      SIGTERM: 'SIGTERM',
      SIGKILL: 'SIGKILL',
      SIGINT: 'SIGINT',
      SIGSTOP: 'SIGSTOP',
      SIGCONT: 'SIGCONT',
      SIGCHLD: 'SIGCHLD'
    };

    // Numeric signal values for exit-code arithmetic (128 + signum)
    this.SIGNAL_NUMBERS = {
      SIGTERM: 15,
      SIGKILL: 9,
      SIGINT: 2,
      SIGSTOP: 19,
      SIGCONT: 18,
      SIGCHLD: 17
    };

    // Resource limits
    this.DEFAULT_LIMITS = {
      memory: 16 * 1024 * 1024, // 16MB
      cpuTime: 5000, // 5 seconds
      fileDescriptors: 256,
      processes: 32
    };

    // Message handling
    this.pendingMessages = new Map();
    this.messageId = 0;

    // POSIX errno constants
    this.ERRNO = {
      EPERM: 1,
      ENOENT: 2,
      ESRCH: 3,
      EINTR: 4,
      EIO: 5,
      ENOEXEC: 8,
      EBADF: 9,
      ECHILD: 10,
      EAGAIN: 11,
      ENOMEM: 12,
      EACCES: 13,
      EEXIST: 17,
      ENOTDIR: 20,
      EISDIR: 21,
      EINVAL: 22,
      EMFILE: 24,
      ENOSPC: 28,
      EROFS: 30,
      EPIPE: 32,
      ENOSYS: 38,
      ENOTEMPTY: 39,
      ELOOP: 40
    };
  }

  async initialize() {
    this.kernel.log('Real Process Manager initializing with Web Worker isolation');

    // Create init process (PID 1) - runs in main thread
    const initProcess = await this.createProcess({
      name: 'init',
      executable: '/sbin/init',
      args: [],
      parentPID: 0,
      uid: 0,
      gid: 0,
      isolated: false // Init runs in main thread
    });

    this.currentProcess = initProcess;
    this.kernel.log(`Init process created with PID ${initProcess.pid}`);
  }

  // Create a new process with optional Web Worker isolation
  async createProcess(options = {}) {
    const pid = this.nextPID++;
    const pgid = options.pgid || this.nextPGID++;

    const processInfo = {
      pid,
      pgid,
      name: options.name || 'unnamed',
      executable: options.executable || null,
      args: options.args || [],
      env: options.env || { ...(this.currentProcess?.env || {}) },
      cwd: options.cwd || this.currentProcess?.cwd || '/',
      parentPID: options.parentPID || this.currentProcess?.pid || 0,
      uid: options.uid || this.currentProcess?.uid || 1000,
      gid: options.gid || this.currentProcess?.gid || 1000,
      priority: options.priority || 0,
      state: this.PROCESS_STATES.CREATED,
      startTime: Date.now(),
      cpuTime: 0,
      memoryUsage: 0,
      limits: {
        ...this.DEFAULT_LIMITS,
        ...(options.limits || {})
      },
      isolated: options.isolated !== false, // Default to isolated
      children: new Set(),
      fileDescriptors: new Map()
    };

    this.processes.set(pid, processInfo);

    // Add to process group
    if (!this.processGroups.has(pgid)) {
      this.processGroups.set(pgid, new Set());
    }
    this.processGroups.get(pgid).add(pid);

    // Set up parent-child relationship
    if (processInfo.parentPID > 0) {
      const parent = this.processes.get(processInfo.parentPID);
      if (parent) {
        parent.children.add(pid);
      }
    }

    // Create Web Worker if isolated
    if (processInfo.isolated) {
      await this.createWorker(processInfo);
    }

    processInfo.state = this.PROCESS_STATES.READY;

    this.kernel.emit('process:created', processInfo);
    this.kernel.log(
      `Process ${processInfo.name} (PID ${pid}) created ${
        processInfo.isolated ? 'with isolation' : 'in main thread'
      }`
    );

    // Set up standard file descriptors (0=stdin, 1=stdout, 2=stderr)
    processInfo.fileDescriptors.set(0, { type: 'stdin', buffer: '' });
    processInfo.fileDescriptors.set(1, { type: 'stdout', buffer: '' });
    processInfo.fileDescriptors.set(2, { type: 'stderr', buffer: '' });
    processInfo._nextFD = 3;

    return processInfo;
  }

  /**
   * Allocate the next available file descriptor for a process.
   * @param {number} pid
   * @param {object} entry - FD entry describing the resource
   * @returns {number} the allocated fd
   */
  allocateFD(pid, entry) {
    const proc = typeof pid === 'number' ? this.processes.get(pid) : pid;
    if (!proc) {
      const err = new Error('No such process');
      err.code = 'ESRCH';
      throw err;
    }
    const fd = proc._nextFD || 3;
    proc.fileDescriptors.set(fd, entry);
    proc._nextFD = fd + 1;
    return fd;
  }

  /**
   * Allocate a specific fd number (for dup2).
   * Closes the existing fd if occupied.
   * @param {number} pid
   * @param {number} fd
   * @param {object} entry
   */
  allocateSpecificFD(pid, fd, entry) {
    const proc = typeof pid === 'number' ? this.processes.get(pid) : pid;
    if (!proc) {
      const err = new Error('No such process');
      err.code = 'ESRCH';
      throw err;
    }
    proc.fileDescriptors.set(fd, entry);
    if (fd >= (proc._nextFD || 3)) {
      proc._nextFD = fd + 1;
    }
  }

  // POSIX process identity helpers
  getpid() {
    return this.currentProcess ? this.currentProcess.pid : 0;
  }

  getppid() {
    return this.currentProcess ? this.currentProcess.parentPID : 0;
  }

  getuid() {
    return this.currentProcess ? this.currentProcess.uid : 0;
  }

  getgid() {
    return this.currentProcess ? this.currentProcess.gid : 0;
  }

  async createWorker(processInfo) {
    try {
      // Create Web Worker
      const worker = new Worker('/terminal/core/process-worker.js');
      this.workers.set(processInfo.pid, worker);

      // Set up message handling
      worker.addEventListener('message', (event) => {
        this.handleWorkerMessage(processInfo.pid, event.data);
      });

      worker.addEventListener('error', (error) => {
        this.kernel.log(`Worker error for PID ${processInfo.pid}: ${error.message}`, 'error');
        this.handleProcessError(processInfo.pid, error);
      });

      // Initialize worker
      await this.sendWorkerMessage(processInfo.pid, 'INIT', {
        pid: processInfo.pid,
        name: processInfo.name,
        env: processInfo.env,
        cwd: processInfo.cwd,
        memoryLimit: processInfo.limits.memory,
        cpuTimeLimit: processInfo.limits.cpuTime
      });

      this.kernel.log(`Worker created for process ${processInfo.name} (PID ${processInfo.pid})`);
    } catch (error) {
      this.kernel.log(
        `Failed to create worker for PID ${processInfo.pid}: ${error.message}`,
        'error'
      );
      throw error;
    }
  }

  // Execute a command in a process
  async executeCommand(pid, command, args = [], stdin = '') {
    const process = this.processes.get(pid);
    if (!process) {
      throw new Error(`Process ${pid} not found`);
    }

    if (process.state !== this.PROCESS_STATES.READY) {
      throw new Error(`Process ${pid} is not ready (state: ${process.state})`);
    }

    process.state = this.PROCESS_STATES.RUNNING;

    try {
      if (process.isolated) {
        // Execute in Web Worker
        const result = await this.sendWorkerMessage(pid, 'EXEC', {
          command,
          args,
          stdin
        });

        process.state = this.PROCESS_STATES.READY;
        return result;
      } else {
        // Execute in main thread (for init and system processes)
        const result = await this.executeInMainThread(process, command, args, stdin);
        process.state = this.PROCESS_STATES.READY;
        return result;
      }
    } catch (error) {
      process.state = this.PROCESS_STATES.READY;
      throw error;
    }
  }

  async executeInMainThread(process, command, args, stdin) {
    // For non-isolated processes, use the existing command system
    // This is a fallback for system processes that need main thread access

    const commandHandler = await commandRegistry.get(command);
    if (!commandHandler) {
      throw new Error(`Command not found: ${command}`);
    }

    // Create a mock terminal context for the command
    const mockTerminal = {
      env: process.env,
      currentDirectory: process.cwd,
      stdin,
      hasStdin: stdin.length > 0,
      stdinSupplied: stdin.length > 0,
      syscall: (name, ...args) => this.kernel.syscall(name, ...args),
      // Add other necessary terminal methods
      resolvePath: (path) => ShellCore.resolveVirtualPath(path, process.cwd)
    };

    const output = await commandHandler(mockTerminal, args);
    const n = ShellCore.normalizeHandlerResult(output);
    return ShellCore.normalizeCommandResult(n.stdout, n.stderr, n.exitCode);
  }

  // Send signal to process
  async sendSignal(pid, signal) {
    const process = this.processes.get(pid);
    if (!process) {
      throw new Error(`Process ${pid} not found`);
    }

    this.kernel.log(`Sending signal ${signal} to process ${pid}`);

    if (process.isolated) {
      await this.sendWorkerMessage(pid, 'SIGNAL', { signal });
    } else {
      // Handle signal in main thread
      this.handleMainThreadSignal(process, signal);
    }
  }

  handleMainThreadSignal(process, signal) {
    switch (signal) {
      case this.SIGNALS.SIGTERM:
      case this.SIGNALS.SIGKILL:
        this.terminateProcess(process.pid);
        break;
      case this.SIGNALS.SIGSTOP:
        process.state = this.PROCESS_STATES.STOPPED;
        break;
      case this.SIGNALS.SIGCONT:
        if (process.state === this.PROCESS_STATES.STOPPED) {
          process.state = this.PROCESS_STATES.READY;
        }
        break;
    }
  }

  // Terminate a process
  async terminateProcess(pid, exitCode = 0) {
    const process = this.processes.get(pid);
    if (!process) {
      return;
    }

    this.kernel.log(`Terminating process ${process.name} (PID ${pid})`);

    // Terminate worker if isolated
    if (process.isolated) {
      const worker = this.workers.get(pid);
      if (worker) {
        worker.terminate();
        this.workers.delete(pid);
      }
    }

    // Update process state
    process.state = this.PROCESS_STATES.TERMINATED;
    process.exitCode = exitCode;
    process.exitTime = Date.now();

    // Handle children
    for (const childPID of process.children) {
      const child = this.processes.get(childPID);
      if (child) {
        child.parentPID = 1; // Reparent to init
        const init = this.processes.get(1);
        if (init) {
          init.children.add(childPID);
        }
      }
    }

    // Remove from parent's children
    if (process.parentPID > 0) {
      const parent = this.processes.get(process.parentPID);
      if (parent) {
        parent.children.delete(pid);
        // Send SIGCHLD to parent
        this.sendSignal(process.parentPID, this.SIGNALS.SIGCHLD);
      }
    }

    // Remove from process group
    const processGroup = this.processGroups.get(process.pgid);
    if (processGroup) {
      processGroup.delete(pid);
      if (processGroup.size === 0) {
        this.processGroups.delete(process.pgid);
      }
    }

    this.kernel.emit('process:exit', process);

    // Clean up after a delay (zombie reaping)
    setTimeout(() => {
      this.processes.delete(pid);
    }, 1000);
  }

  /** Kernel interrupt hook (reserved; may clear workers or reap zombies). */
  handleProcessExit(processData) {
    void processData;
  }

  getProcessCount() {
    return this.processes.size;
  }

  async terminateAllProcesses() {
    for (const pid of Array.from(this.processes.keys())) {
      await this.terminateProcess(pid, 1);
    }
  }

  // Handle messages from Web Workers
  handleWorkerMessage(pid, message) {
    const { type, data, id } = message;

    switch (type) {
      case 'INIT_COMPLETE':
        this.kernel.log(`Worker initialized for PID ${pid}`);
        break;

      case 'EXEC_COMPLETE':
        this.resolveMessage(id, data);
        break;

      case 'PROCESS_EXIT':
        this.terminateProcess(pid, data.exitCode);
        break;

      case 'RESOURCE_VIOLATION':
        this.handleResourceViolation(pid, data);
        break;

      case 'SYSCALL_REQUEST':
        this.handleWorkerSyscall(pid, data, id);
        break;

      case 'LOAD_COMMAND':
        this.handleCommandLoad(pid, data, id);
        break;

      case 'ERROR':
        this.rejectMessage(id, new Error(data.message));
        break;

      default:
        this.kernel.log(`Unknown message type from worker ${pid}: ${type}`, 'warn');
    }
  }

  async handleWorkerSyscall(pid, data, id) {
    try {
      const result = await this.kernel.syscall(data.name, ...data.args);
      this.sendWorkerResponse(pid, id, { result });
    } catch (error) {
      this.sendWorkerResponse(pid, id, { error: error.message });
    }
  }

  async handleCommandLoad(pid, data, id) {
    try {
      // Load command from the command registry
      const commandHandler = await commandRegistry.get(data.command);
      if (!commandHandler) {
        throw new Error(`Command not found: ${data.command}`);
      }

      // Convert command handler to string for worker execution
      // This is a simplified approach - in production, you'd want more sophisticated code serialization
      const commandCode = `
        return async function(context) {
          // Command implementation would be injected here
          // For now, return a placeholder
          context.stdout('Command ${data.command} executed in worker');
          return { exitCode: 0 };
        };
      `;

      this.sendWorkerResponse(pid, id, { code: commandCode });
    } catch (error) {
      this.sendWorkerResponse(pid, id, { error: error.message });
    }
  }

  handleResourceViolation(pid, data) {
    const process = this.processes.get(pid);
    if (!process) return;

    this.kernel.log(
      `Resource violation in process ${pid}: ${data.type} (${data.used}/${data.limit})`,
      'warn'
    );

    // Take action based on violation type
    switch (data.type) {
      case 'MEMORY':
        // Kill process immediately for memory violations
        this.kernel.log(`Killing process ${pid} due to memory limit violation`);
        this.terminateProcess(pid, 137); // SIGKILL exit code
        break;

      case 'CPU':
        // For CPU violations, forcibly terminate the worker
        // Don't try to send signals - the worker might be stuck in a tight loop
        this.kernel.log(`Process ${pid} exceeded CPU time limit, forcibly terminating`);
        this.terminateProcess(pid, 137); // SIGKILL exit code
        break;
    }
  }

  handleProcessError(pid, error) {
    this.kernel.log(`Process ${pid} encountered an error: ${error.message}`, 'error');
    this.terminateProcess(pid, 1);
  }

  // Send message to worker and wait for response
  async sendWorkerMessage(pid, type, data) {
    const worker = this.workers.get(pid);
    if (!worker) {
      throw new Error(`No worker found for process ${pid}`);
    }

    return new Promise((resolve, reject) => {
      const id = ++this.messageId;

      this.pendingMessages.set(id, { resolve, reject });

      worker.postMessage({
        type,
        data,
        id
      });

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingMessages.has(id)) {
          this.pendingMessages.delete(id);
          reject(new Error(`Worker message timeout for PID ${pid}`));
        }
      }, 30000);
    });
  }

  sendWorkerResponse(pid, id, data) {
    const worker = this.workers.get(pid);
    if (worker) {
      worker.postMessage({
        type: 'RESPONSE',
        data,
        id
      });
    }
  }

  resolveMessage(id, data) {
    const pending = this.pendingMessages.get(id);
    if (pending) {
      this.pendingMessages.delete(id);
      pending.resolve(data);
    }
  }

  rejectMessage(id, error) {
    const pending = this.pendingMessages.get(id);
    if (pending) {
      this.pendingMessages.delete(id);
      pending.reject(error);
    }
  }

  // Get all processes
  getAllProcesses() {
    return Array.from(this.processes.values());
  }

  // Get process by PID
  getProcess(pid) {
    return this.processes.get(pid);
  }

  // Set current process (for scheduler)
  setCurrentProcess(process) {
    this.currentProcess = process;
  }

  // Get current process
  getCurrentProcess() {
    return this.currentProcess;
  }

  // Get processes by state
  getProcessesByState(state) {
    return Array.from(this.processes.values()).filter((p) => p.state === state);
  }

  // Get resource usage for a process
  async getProcessResourceUsage(pid) {
    const process = this.processes.get(pid);
    if (!process) {
      throw new Error(`Process ${pid} not found`);
    }

    if (process.isolated) {
      return await this.sendWorkerMessage(pid, 'RESOURCE_CHECK', {});
    } else {
      return {
        memoryUsed: process.memoryUsage,
        memoryLimit: process.limits.memory,
        cpuTimeUsed: process.cpuTime,
        cpuTimeLimit: process.limits.cpuTime,
        state: process.state
      };
    }
  }

  // Clean up on shutdown
  async shutdown() {
    this.kernel.log('Shutting down Real Process Manager');

    // Terminate all workers
    for (const [pid, worker] of this.workers) {
      worker.terminate();
    }

    this.workers.clear();
    this.processes.clear();
    this.pendingMessages.clear();
  }
}

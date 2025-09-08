// Process Management System for Heyming OS
class ProcessManager {
  constructor(kernel) {
    this.kernel = kernel;
    this.processes = new Map();
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
      TERMINATED: 'terminated',
      ZOMBIE: 'zombie'
    };
    
    // Signal types
    this.SIGNALS = {
      SIGTERM: 15,
      SIGKILL: 9,
      SIGINT: 2,
      SIGSTOP: 19,
      SIGCONT: 18,
      SIGCHLD: 17
    };
  }

  async initialize() {
    this.kernel.log('Process Manager initializing');
    
    // Create init process (PID 1)
    const initProcess = await this.createProcess({
      name: 'init',
      executable: '/sbin/init',
      args: [],
      parentPID: 0,
      uid: 0,
      gid: 0
    });
    
    this.currentProcess = initProcess;
    this.kernel.log(`Init process created with PID ${initProcess.pid}`);
  }

  // Create a new process
  async createProcess(options = {}) {
    const pid = this.nextPID++;
    const pgid = options.pgid || this.nextPGID++;
    
    const process = new Process({
      pid,
      pgid,
      name: options.name || 'unnamed',
      executable: options.executable || null,
      args: options.args || [],
      env: options.env || {...(this.currentProcess?.env || {})},
      cwd: options.cwd || (this.currentProcess?.cwd || '/'),
      parentPID: options.parentPID || (this.currentProcess?.pid || 0),
      uid: options.uid || (this.currentProcess?.uid || 1000),
      gid: options.gid || (this.currentProcess?.gid || 1000),
      priority: options.priority || 0,
      kernel: this.kernel
    });

    this.processes.set(pid, process);
    
    // Add to process group
    if (!this.processGroups.has(pgid)) {
      this.processGroups.set(pgid, new Set());
    }
    this.processGroups.get(pgid).add(pid);
    
    // Set up parent-child relationship
    if (process.parentPID > 0) {
      const parent = this.processes.get(process.parentPID);
      if (parent) {
        parent.children.add(pid);
      }
    }

    this.kernel.log(`Process created: PID ${pid}, Name: ${process.name}`);
    this.kernel.emit('process:created', process);
    
    return process;
  }

  // Fork current process
  async fork() {
    if (!this.currentProcess) {
      throw new Error('No current process to fork');
    }

    const childProcess = await this.createProcess({
      name: this.currentProcess.name,
      executable: this.currentProcess.executable,
      args: [...this.currentProcess.args],
      env: {...this.currentProcess.env},
      cwd: this.currentProcess.cwd,
      parentPID: this.currentProcess.pid,
      uid: this.currentProcess.uid,
      gid: this.currentProcess.gid,
      pgid: this.currentProcess.pgid
    });

    // Copy file descriptors
    childProcess.fileDescriptors = new Map(this.currentProcess.fileDescriptors);
    
    return childProcess.pid;
  }

  // Execute a new program in current process
  async exec(executable, args = [], env = null) {
    if (!this.currentProcess) {
      throw new Error('No current process for exec');
    }

    const process = this.currentProcess;
    
    // Update process information
    process.executable = executable;
    process.args = args;
    if (env) {
      process.env = env;
    }
    
    // Reset process state for new program
    process.state = this.PROCESS_STATES.READY;
    process.exitCode = null;
    
    this.kernel.log(`Process ${process.pid} exec: ${executable}`);
    this.kernel.emit('process:exec', process);
    
    return 0;
  }

  // Terminate a process
  async exit(exitCode = 0) {
    if (!this.currentProcess) {
      throw new Error('No current process to exit');
    }

    const process = this.currentProcess;
    process.exitCode = exitCode;
    process.state = this.PROCESS_STATES.TERMINATED;
    process.endTime = Date.now();

    // Close all file descriptors
    for (const [fd, file] of process.fileDescriptors) {
      await this.kernel.syscall('close', fd);
    }

    // Handle child processes
    for (const childPID of process.children) {
      const child = this.processes.get(childPID);
      if (child && child.state !== this.PROCESS_STATES.TERMINATED) {
        // Orphan children get adopted by init
        child.parentPID = 1;
        const init = this.processes.get(1);
        if (init) {
          init.children.add(childPID);
        }
      }
    }

    // Notify parent of termination
    if (process.parentPID > 0) {
      const parent = this.processes.get(process.parentPID);
      if (parent) {
        parent.children.delete(process.pid);
        this.sendSignal(parent.pid, this.SIGNALS.SIGCHLD);
      }
    }

    // Remove from process group
    const processGroup = this.processGroups.get(process.pgid);
    if (processGroup) {
      processGroup.delete(process.pid);
      if (processGroup.size === 0) {
        this.processGroups.delete(process.pgid);
      }
    }

    this.kernel.log(`Process ${process.pid} exited with code ${exitCode}`);
    this.kernel.emit('process:exit', process);

    // If this was the current process, we need to schedule another
    if (this.currentProcess === process) {
      this.currentProcess = null;
      this.kernel.schedulerManager.schedule();
    }

    return exitCode;
  }

  // Wait for child process to terminate
  async wait(pid = -1) {
    const currentProcess = this.currentProcess;
    if (!currentProcess) {
      throw new Error('No current process for wait');
    }

    return new Promise((resolve) => {
      const checkChildren = () => {
        // Wait for any child if pid is -1
        if (pid === -1) {
          for (const childPID of currentProcess.children) {
            const child = this.processes.get(childPID);
            if (child && child.state === this.PROCESS_STATES.TERMINATED) {
              currentProcess.children.delete(childPID);
              this.processes.delete(childPID);
              resolve({ pid: childPID, exitCode: child.exitCode });
              return;
            }
          }
        } else {
          // Wait for specific child
          const child = this.processes.get(pid);
          if (child && child.parentPID === currentProcess.pid && 
              child.state === this.PROCESS_STATES.TERMINATED) {
            currentProcess.children.delete(pid);
            this.processes.delete(pid);
            resolve({ pid, exitCode: child.exitCode });
            return;
          }
        }

        // No terminated children found, wait for signal
        const signalHandler = (signal) => {
          if (signal === this.SIGNALS.SIGCHLD) {
            setTimeout(checkChildren, 0);
          }
        };

        currentProcess.signalHandlers.set(this.SIGNALS.SIGCHLD, signalHandler);
      };

      checkChildren();
    });
  }

  // Send signal to process
  sendSignal(pid, signal) {
    const process = this.processes.get(pid);
    if (!process) {
      throw new Error(`Process ${pid} not found`);
    }

    // Handle built-in signals
    switch (signal) {
      case this.SIGNALS.SIGKILL:
        process.state = this.PROCESS_STATES.TERMINATED;
        process.exitCode = -1;
        this.kernel.emit('process:killed', process);
        break;
        
      case this.SIGNALS.SIGTERM:
        // Graceful termination request
        if (process.signalHandlers.has(signal)) {
          process.signalHandlers.get(signal)(signal);
        } else {
          process.state = this.PROCESS_STATES.TERMINATED;
          process.exitCode = 0;
        }
        break;
        
      case this.SIGNALS.SIGSTOP:
        process.state = this.PROCESS_STATES.BLOCKED;
        break;
        
      case this.SIGNALS.SIGCONT:
        if (process.state === this.PROCESS_STATES.BLOCKED) {
          process.state = this.PROCESS_STATES.READY;
        }
        break;
        
      default:
        // Custom signal handling
        if (process.signalHandlers.has(signal)) {
          process.signalHandlers.get(signal)(signal);
        }
    }

    this.kernel.log(`Signal ${signal} sent to process ${pid}`);
  }

  // Kill process (convenience method)
  async kill(pid, signal = this.SIGNALS.SIGTERM) {
    // Check permissions
    const currentProcess = this.currentProcess;
    const targetProcess = this.processes.get(pid);
    
    if (!targetProcess) {
      throw new Error(`Process ${pid} not found`);
    }

    // Root can kill any process, others can only kill their own
    if (currentProcess && currentProcess.uid !== 0 && 
        currentProcess.uid !== targetProcess.uid) {
      throw new Error('Permission denied');
    }

    this.sendSignal(pid, signal);
    return 0;
  }

  // Get current process ID
  getpid() {
    return this.currentProcess ? this.currentProcess.pid : 0;
  }

  // Get parent process ID
  getppid() {
    return this.currentProcess ? this.currentProcess.parentPID : 0;
  }

  // Get process by PID
  getProcess(pid) {
    return this.processes.get(pid);
  }

  // Get all processes
  getAllProcesses() {
    return Array.from(this.processes.values());
  }

  // Get process count
  getProcessCount() {
    return this.processes.size;
  }

  // Set current process (used by scheduler)
  setCurrentProcess(process) {
    this.currentProcess = process;
    if (process) {
      process.state = this.PROCESS_STATES.RUNNING;
    }
  }

  // Handle process exit (called by interrupt handler)
  handleProcessExit(processData) {
    // Clean up any remaining resources
    const process = this.processes.get(processData.pid);
    if (process && process.state === this.PROCESS_STATES.TERMINATED) {
      // Final cleanup
      this.processes.delete(processData.pid);
    }
  }

  // Terminate all processes (for shutdown)
  async terminateAllProcesses() {
    this.kernel.log('Terminating all processes');
    
    // Send SIGTERM to all processes except init
    for (const [pid, process] of this.processes) {
      if (pid !== 1 && process.state !== this.PROCESS_STATES.TERMINATED) {
        this.sendSignal(pid, this.SIGNALS.SIGTERM);
      }
    }

    // Wait a bit for graceful shutdown
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Force kill any remaining processes
    for (const [pid, process] of this.processes) {
      if (pid !== 1 && process.state !== this.PROCESS_STATES.TERMINATED) {
        this.sendSignal(pid, this.SIGNALS.SIGKILL);
      }
    }
  }
}

// Process class representing individual processes
class Process {
  constructor(options) {
    this.pid = options.pid;
    this.pgid = options.pgid;
    this.name = options.name;
    this.executable = options.executable;
    this.args = options.args;
    this.env = options.env;
    this.cwd = options.cwd;
    this.parentPID = options.parentPID;
    this.uid = options.uid;
    this.gid = options.gid;
    this.priority = options.priority;
    this.kernel = options.kernel;
    
    // Process state
    this.state = 'created';
    this.exitCode = null;
    this.startTime = Date.now();
    this.endTime = null;
    this.cpuTime = 0;
    
    // Process relationships
    this.children = new Set();
    
    // File descriptors (fd -> file object)
    this.fileDescriptors = new Map();
    this.nextFD = 3; // 0, 1, 2 reserved for stdin, stdout, stderr
    
    // Signal handling
    this.signalHandlers = new Map();
    
    // Memory information
    this.memoryUsage = {
      heap: 0,
      stack: 0,
      data: 0
    };
    
    // Initialize standard file descriptors
    this.initializeStandardFDs();
  }

  initializeStandardFDs() {
    // These will be properly initialized by the terminal or shell
    this.fileDescriptors.set(0, { type: 'stdin', readable: true, writable: false });
    this.fileDescriptors.set(1, { type: 'stdout', readable: false, writable: true });
    this.fileDescriptors.set(2, { type: 'stderr', readable: false, writable: true });
  }

  // Allocate a new file descriptor
  allocateFD(file) {
    const fd = this.nextFD++;
    this.fileDescriptors.set(fd, file);
    return fd;
  }

  // Close a file descriptor
  closeFD(fd) {
    return this.fileDescriptors.delete(fd);
  }

  // Get file by descriptor
  getFile(fd) {
    return this.fileDescriptors.get(fd);
  }

  // Register signal handler
  onSignal(signal, handler) {
    this.signalHandlers.set(signal, handler);
  }

  // Get process information
  getInfo() {
    return {
      pid: this.pid,
      pgid: this.pgid,
      name: this.name,
      executable: this.executable,
      args: this.args,
      state: this.state,
      parentPID: this.parentPID,
      uid: this.uid,
      gid: this.gid,
      priority: this.priority,
      startTime: this.startTime,
      endTime: this.endTime,
      cpuTime: this.cpuTime,
      memoryUsage: this.memoryUsage,
      children: Array.from(this.children),
      fileDescriptors: Array.from(this.fileDescriptors.keys())
    };
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ProcessManager, Process };
} else if (typeof window !== 'undefined') {
  window.ProcessManager = ProcessManager;
  window.Process = Process;
}

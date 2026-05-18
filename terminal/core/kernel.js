// Heyming OS Kernel - Core Operating System Layer
import { MemoryManager } from './memory-manager.js';
import { FileSystemManager } from './filesystem-manager.js';
import { SecurityManager } from './security-manager.js';
import { ProcessManager } from './process-manager.js';
import { IPCManager } from './ipc-manager.js';
import { DeviceManager, NetworkManager } from './device-manager.js';
import { SchedulerManager } from './scheduler-manager.js';

export class HeymingKernel {
  constructor() {
    this.version = '0.1.0';
    this.bootTime = Date.now();
    this.isInitialized = false;

    // Core subsystems
    this.processManager = null;
    this.memoryManager = null;
    this.fileSystemManager = null;
    this.deviceManager = null;
    this.securityManager = null;
    this.ipcManager = null;
    this.networkManager = null;
    this.schedulerManager = null;

    // System state
    this.systemCalls = new Map();
    this.interruptHandlers = new Map();
    this.kernelLog = [];

    // Event system for kernel-level events
    this.eventListeners = new Map();
  }

  // Initialize the kernel and all subsystems
  async initialize() {
    if (this.isInitialized) {
      throw new Error('Kernel already initialized');
    }

    this.log('Initializing Heyming OS Kernel v' + this.version);

    try {
      // Initialize core managers in dependency order
      await this.initializeMemoryManager();
      await this.initializeFileSystemManager();
      await this.initializeSecurityManager();
      await this.initializeProcessManager();
      await this.initializeIPCManager();
      await this.initializeDeviceManager();
      await this.initializeNetworkManager();
      await this.initializeSchedulerManager();

      // Register core system calls
      this.registerSystemCalls();

      // Register interrupt handlers
      this.registerInterruptHandlers();

      this.isInitialized = true;
      this.log('Kernel initialization complete');
      this.emit('kernel:ready');

      return this;
    } catch (error) {
      this.log('Kernel initialization failed: ' + error.message, 'error');
      throw error;
    }
  }

  async initializeMemoryManager() {
    this.memoryManager = new MemoryManager(this);
    await this.memoryManager.initialize();
    this.log('Memory Manager initialized');
  }

  async initializeFileSystemManager() {
    this.fileSystemManager = new FileSystemManager(this);
    await this.fileSystemManager.initialize();
    this.log('File System Manager initialized');
  }

  async initializeSecurityManager() {
    this.securityManager = new SecurityManager(this);
    await this.securityManager.initialize();
    this.log('Security Manager initialized');
  }

  async initializeProcessManager() {
    this.processManager = new ProcessManager(this);
    await this.processManager.initialize();
    this.log('Process Manager initialized with Web Worker isolation');
  }

  async initializeIPCManager() {
    this.ipcManager = new IPCManager(this);
    await this.ipcManager.initialize();
    this.log('IPC Manager initialized');
  }

  async initializeDeviceManager() {
    this.deviceManager = new DeviceManager(this);
    await this.deviceManager.initialize();
    this.log('Device Manager initialized');
  }

  async initializeNetworkManager() {
    this.networkManager = new NetworkManager(this);
    await this.networkManager.initialize();
    this.log('Network Manager initialized');
  }

  async initializeSchedulerManager() {
    this.schedulerManager = new SchedulerManager(this);
    await this.schedulerManager.initialize();
    this.log('Scheduler Manager initialized');
  }

  // System call interface
  registerSystemCall(name, handler) {
    if (this.systemCalls.has(name)) {
      throw new Error(`System call ${name} already registered`);
    }
    this.systemCalls.set(name, handler);
    this.log(`Registered system call: ${name}`);
  }

  // Execute a system call
  async syscall(name, ...args) {
    const handler = this.systemCalls.get(name);
    if (!handler) {
      throw new Error(`Unknown system call: ${name}`);
    }

    try {
      return await handler.call(this, ...args);
    } catch (error) {
      this.log(`System call ${name} failed: ${error.message}`, 'error');
      throw error;
    }
  }

  // Register core system calls — POSIX-aligned naming
  registerSystemCalls() {
    // File system (already implemented in FileSystemManager)
    this.registerSystemCall('open', this.fileSystemManager.open.bind(this.fileSystemManager));
    this.registerSystemCall('close', this.fileSystemManager.close.bind(this.fileSystemManager));
    this.registerSystemCall('read', this.fileSystemManager.read.bind(this.fileSystemManager));
    this.registerSystemCall('write', this.fileSystemManager.write.bind(this.fileSystemManager));
    this.registerSystemCall('stat', this.fileSystemManager.stat.bind(this.fileSystemManager));
    this.registerSystemCall('readdir', this.fileSystemManager.readdir.bind(this.fileSystemManager));
    this.registerSystemCall('mkdir', this.fileSystemManager.mkdir.bind(this.fileSystemManager));
    this.registerSystemCall('rmdir', this.fileSystemManager.rmdir.bind(this.fileSystemManager));
    this.registerSystemCall('unlink', this.fileSystemManager.unlink.bind(this.fileSystemManager));
    this.registerSystemCall('sendSignal', this.processManager.sendSignal.bind(this.processManager));

    // POSIX file metadata (stubs for unimplemented ones)
    this.registerSystemCall('lstat', this.fileSystemManager.stat.bind(this.fileSystemManager));
    this.registerSystemCall('fstat', async (fd) => {
      const file = this.fileSystemManager.openFiles.get(fd);
      if (!file) throw this._enosys('fstat');
      return this.fileSystemManager.stat(file.path);
    });
    this.registerSystemCall('access', async (path, mode) => {
      try {
        await this.fileSystemManager.stat(path);
        return 0;
      } catch (_) {
        const err = new Error(`No such file or directory: ${path}`);
        err.code = 'ENOENT';
        throw err;
      }
    });
    this.registerSystemCall('chmod', async () => 0);
    this.registerSystemCall('chown', async () => 0);

    // POSIX file manipulation
    this.registerSystemCall('rename', async (oldpath, newpath) => {
      const fsdb = this.fileSystemManager.fileSystemDB;
      if (!fsdb) throw this._enosys('rename');
      const item = await fsdb.getItem(oldpath);
      if (!item) {
        const err = new Error(`No such file or directory: ${oldpath}`);
        err.code = 'ENOENT';
        throw err;
      }
      await fsdb.moveItem(oldpath, newpath);
      return 0;
    });
    this.registerSystemCall('link', async () => {
      throw this._enosys('link');
    });
    this.registerSystemCall('symlink', async (target, linkpath) => {
      const fsdb = this.fileSystemManager.fileSystemDB;
      if (!fsdb) throw this._enosys('symlink');
      await fsdb.createSymlink(linkpath, target);
      return 0;
    });
    this.registerSystemCall('readlink', async (path) => {
      const fsdb = this.fileSystemManager.fileSystemDB;
      if (!fsdb) throw this._enosys('readlink');
      const item = await fsdb.getItem(path);
      if (!item || item.type !== 'symlink') {
        const err = new Error(`Not a symlink: ${path}`);
        err.code = 'EINVAL';
        throw err;
      }
      return item.target || item.linkTarget || '';
    });
    this.registerSystemCall('lseek', async () => {
      throw this._enosys('lseek');
    });
    this.registerSystemCall('fcntl', async () => {
      throw this._enosys('fcntl');
    });

    // POSIX fd duplication
    this.registerSystemCall('dup', (oldfd) => {
      const file = this.fileSystemManager.openFiles.get(oldfd);
      if (!file) {
        const err = new Error(`Bad file descriptor: ${oldfd}`);
        err.code = 'EBADF';
        throw err;
      }
      const proc = this.processManager.currentProcess;
      return this.processManager.allocateFD(proc, { ...file });
    });
    this.registerSystemCall('dup2', (oldfd, newfd) => {
      const file = this.fileSystemManager.openFiles.get(oldfd);
      if (!file) {
        const err = new Error(`Bad file descriptor: ${oldfd}`);
        err.code = 'EBADF';
        throw err;
      }
      const proc = this.processManager.currentProcess;
      this.processManager.allocateSpecificFD(proc, newfd, { ...file });
      return newfd;
    });

    // IPC
    if (this.ipcManager.createPipe) {
      this.registerSystemCall('pipe', this.ipcManager.createPipe.bind(this.ipcManager));
    }
    if (this.ipcManager.sendMessage) {
      this.registerSystemCall('sendMessage', this.ipcManager.sendMessage.bind(this.ipcManager));
    }

    // Process identity
    this.registerSystemCall('getpid', this.processManager.getpid.bind(this.processManager));
    this.registerSystemCall('getppid', this.processManager.getppid.bind(this.processManager));
    this.registerSystemCall('getuid', this.processManager.getuid.bind(this.processManager));
    this.registerSystemCall('getgid', this.processManager.getgid.bind(this.processManager));

    // Process control stubs
    this.registerSystemCall('fork', async () => {
      throw this._enosys('fork');
    });
    this.registerSystemCall('execve', async () => {
      throw this._enosys('execve');
    });
    this.registerSystemCall('waitpid', async () => {
      throw this._enosys('waitpid');
    });
    this.registerSystemCall('_exit', (status) => {
      if (this.processManager.currentProcess) {
        this.processManager.terminateProcess(this.processManager.currentProcess.pid, status);
      }
    });
    this.registerSystemCall('kill', this.processManager.sendSignal.bind(this.processManager));
    this.registerSystemCall('setuid', async () => 0);
    this.registerSystemCall('setgid', async () => 0);

    // Higher-level convenience syscalls (libc-style)
    this.registerSystemCall('readFileContents', async (path) => {
      const fsdb = this.fileSystemManager.fileSystemDB;
      if (!fsdb) throw this._enosys('readFileContents');
      const item = await fsdb.getItem(path);
      if (!item || item.type !== 'file') return null;
      if (item.content != null) return String(item.content);
      return '';
    });
    this.registerSystemCall('writeFileContents', async (path, data) => {
      const fsdb = this.fileSystemManager.fileSystemDB;
      if (!fsdb) throw this._enosys('writeFileContents');
      await fsdb.createFile(path, data, true);
    });
    this.registerSystemCall('copyFile', async (src, dest) => {
      const fsdb = this.fileSystemManager.fileSystemDB;
      if (!fsdb) throw this._enosys('copyFile');
      await fsdb.copyItem(src, dest);
    });

    // Memory management - register only if methods exist
    if (this.memoryManager.allocateMemory) {
      this.registerSystemCall(
        'allocate',
        this.memoryManager.allocateMemory.bind(this.memoryManager)
      );
    }
    if (this.memoryManager.freeMemory) {
      this.registerSystemCall('deallocate', this.memoryManager.freeMemory.bind(this.memoryManager));
    }

    // Legacy aliases (backward compat during migration)
    this.registerSystemCall(
      'createProcess',
      this.processManager.createProcess.bind(this.processManager)
    );
    this.registerSystemCall(
      'executeCommand',
      this.processManager.executeCommand.bind(this.processManager)
    );
    this.registerSystemCall(
      'terminateProcess',
      this.processManager.terminateProcess.bind(this.processManager)
    );
    this.registerSystemCall(
      'getAllProcesses',
      this.processManager.getAllProcesses.bind(this.processManager)
    );
    this.registerSystemCall('getProcess', this.processManager.getProcess.bind(this.processManager));

    // Network - register only if methods exist
    if (this.networkManager.createSocket) {
      this.registerSystemCall(
        'createSocket',
        this.networkManager.createSocket.bind(this.networkManager)
      );
      this.registerSystemCall(
        'socket',
        this.networkManager.createSocket.bind(this.networkManager)
      );
      if (this.networkManager.connect) {
        this.registerSystemCall('connect', this.networkManager.connect.bind(this.networkManager));
      }
      if (this.networkManager.send) {
        this.registerSystemCall('send', this.networkManager.send.bind(this.networkManager));
      }
      if (this.networkManager.recv) {
        this.registerSystemCall('recv', this.networkManager.recv.bind(this.networkManager));
      }
      if (this.networkManager.bind) {
        this.registerSystemCall('bindSocket', this.networkManager.bind.bind(this.networkManager));
      }
      if (this.networkManager.close && !this.systemCalls.has('closeSocket')) {
        this.registerSystemCall('closeSocket', this.networkManager.close.bind(this.networkManager));
      }
    }
  }

  /** Create an ENOSYS error for unimplemented syscalls */
  _enosys(name) {
    const err = new Error(`${name}: Function not implemented`);
    err.code = 'ENOSYS';
    return err;
  }

  // Interrupt handling
  registerInterruptHandler(interrupt, handler) {
    if (!this.interruptHandlers.has(interrupt)) {
      this.interruptHandlers.set(interrupt, []);
    }
    this.interruptHandlers.get(interrupt).push(handler);
  }

  // Trigger an interrupt
  interrupt(type, data = null) {
    const handlers = this.interruptHandlers.get(type);
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          handler.call(this, data);
        } catch (error) {
          this.log(`Interrupt handler failed for ${type}: ${error.message}`, 'error');
        }
      });
    }
  }

  registerInterruptHandlers() {
    // Timer interrupt (for scheduling)
    this.registerInterruptHandler('timer', () => {
      this.schedulerManager.tick();
    });

    // Keyboard interrupt - just log for now, device manager already handled it
    this.registerInterruptHandler('keyboard', (keyData) => {
      // The device manager already handled the keyboard input
      // This interrupt is just for notification purposes
      // Don't call handleKeyboard again to avoid infinite recursion
    });

    // Process termination
    this.registerInterruptHandler('process_exit', (processData) => {
      this.processManager.handleProcessExit(processData);
    });
  }

  // Event system
  on(event, callback) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event).push(callback);
  }

  emit(event, data = null) {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach((callback) => {
        try {
          callback(data);
        } catch (error) {
          this.log(`Event listener failed for ${event}: ${error.message}`, 'error');
        }
      });
    }
  }

  // Logging system
  log(message, level = 'info') {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      uptime: Date.now() - this.bootTime
    };

    this.kernelLog.push(logEntry);

    // Keep log size manageable
    if (this.kernelLog.length > 1000) {
      this.kernelLog = this.kernelLog.slice(-500);
    }

    // Also log to console in development
    if (typeof console !== 'undefined') {
      const logMethod = console[level] || console.log;
      logMethod(`[KERNEL ${timestamp}] ${message}`);
    }
  }

  // Get system information
  getSystemInfo() {
    return {
      version: this.version,
      bootTime: this.bootTime,
      uptime: Date.now() - this.bootTime,
      isInitialized: this.isInitialized,
      processCount: this.processManager ? this.processManager.getProcessCount() : 0,
      memoryUsage: this.memoryManager ? this.memoryManager.getUsageStats() : null,
      fileSystemStats: this.fileSystemManager ? this.fileSystemManager.getStats() : null
    };
  }

  // Shutdown the kernel
  async shutdown() {
    this.log('Initiating kernel shutdown');

    if (this.processManager) {
      await this.processManager.terminateAllProcesses();
    }

    if (this.fileSystemManager) {
      await this.fileSystemManager.sync();
    }

    this.emit('kernel:shutdown');
    this.log('Kernel shutdown complete');
  }
}

// Heyming OS Kernel - Core Operating System Layer
class HeymingKernel {
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
    if (!window.MemoryManager) {
      throw new Error('MemoryManager not loaded');
    }
    this.memoryManager = new window.MemoryManager(this);
    await this.memoryManager.initialize();
    this.log('Memory Manager initialized');
  }

  async initializeFileSystemManager() {
    if (!window.FileSystemManager) {
      throw new Error('FileSystemManager not loaded');
    }
    this.fileSystemManager = new window.FileSystemManager(this);
    await this.fileSystemManager.initialize();
    this.log('File System Manager initialized');
  }

  async initializeSecurityManager() {
    if (!window.SecurityManager) {
      throw new Error('SecurityManager not loaded');
    }
    this.securityManager = new window.SecurityManager(this);
    await this.securityManager.initialize();
    this.log('Security Manager initialized');
  }

  async initializeProcessManager() {
    if (!window.ProcessManager) {
      throw new Error('ProcessManager not loaded');
    }
    this.processManager = new window.ProcessManager(this);
    await this.processManager.initialize();
    this.log('Process Manager initialized with Web Worker isolation');
  }

  async initializeIPCManager() {
    if (!window.IPCManager) {
      throw new Error('IPCManager not loaded');
    }
    this.ipcManager = new window.IPCManager(this);
    await this.ipcManager.initialize();
    this.log('IPC Manager initialized');
  }

  async initializeDeviceManager() {
    if (!window.DeviceManager) {
      throw new Error('DeviceManager not loaded');
    }
    this.deviceManager = new window.DeviceManager(this);
    await this.deviceManager.initialize();
    this.log('Device Manager initialized');
  }

  async initializeNetworkManager() {
    if (!window.NetworkManager) {
      throw new Error('NetworkManager not loaded');
    }
    this.networkManager = new window.NetworkManager(this);
    await this.networkManager.initialize();
    this.log('Network Manager initialized');
  }

  async initializeSchedulerManager() {
    if (!window.SchedulerManager) {
      throw new Error('SchedulerManager not loaded');
    }
    this.schedulerManager = new window.SchedulerManager(this);
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

  // Register core system calls
  registerSystemCalls() {
    // Process management - using our actual ProcessManager methods
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
    this.registerSystemCall('sendSignal', this.processManager.sendSignal.bind(this.processManager));
    this.registerSystemCall(
      'getAllProcesses',
      this.processManager.getAllProcesses.bind(this.processManager)
    );
    this.registerSystemCall('getProcess', this.processManager.getProcess.bind(this.processManager));

    // File system
    this.registerSystemCall('open', this.fileSystemManager.open.bind(this.fileSystemManager));
    this.registerSystemCall('close', this.fileSystemManager.close.bind(this.fileSystemManager));
    this.registerSystemCall('read', this.fileSystemManager.read.bind(this.fileSystemManager));
    this.registerSystemCall('write', this.fileSystemManager.write.bind(this.fileSystemManager));
    this.registerSystemCall('stat', this.fileSystemManager.stat.bind(this.fileSystemManager));
    this.registerSystemCall('readdir', this.fileSystemManager.readdir.bind(this.fileSystemManager));
    this.registerSystemCall('mkdir', this.fileSystemManager.mkdir.bind(this.fileSystemManager));
    this.registerSystemCall('rmdir', this.fileSystemManager.rmdir.bind(this.fileSystemManager));
    this.registerSystemCall('unlink', this.fileSystemManager.unlink.bind(this.fileSystemManager));

    // Memory management - register only if methods exist
    if (this.memoryManager.allocate) {
      this.registerSystemCall('allocate', this.memoryManager.allocate.bind(this.memoryManager));
    }
    if (this.memoryManager.deallocate) {
      this.registerSystemCall('deallocate', this.memoryManager.deallocate.bind(this.memoryManager));
    }

    // IPC - register only if methods exist
    if (this.ipcManager.createChannel) {
      this.registerSystemCall('createChannel', this.ipcManager.createChannel.bind(this.ipcManager));
    }
    if (this.ipcManager.sendMessage) {
      this.registerSystemCall('sendMessage', this.ipcManager.sendMessage.bind(this.ipcManager));
    }

    // Network - register only if methods exist
    if (this.networkManager.createConnection) {
      this.registerSystemCall(
        'createConnection',
        this.networkManager.createConnection.bind(this.networkManager)
      );
    }
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

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { HeymingKernel };
} else if (typeof window !== 'undefined') {
  window.HeymingKernel = HeymingKernel;
}

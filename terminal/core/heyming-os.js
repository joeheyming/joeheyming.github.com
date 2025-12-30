// Heyming OS - Main Operating System Class
class HeymingOS {
  constructor() {
    this.version = '1.0.0';
    this.kernel = null;
    this.terminals = new Map();
    this.applications = new Map();
    this.services = new Map();
    this.isInitialized = false;
    this.bootTime = Date.now();

    // OS Configuration
    this.config = {
      maxTerminals: 10,
      maxProcesses: 1000,
      memoryLimit: 512 * 1024 * 1024, // 512MB
      securityLevel: 'medium',
      schedulingAlgorithm: 'round_robin',
      timeSlice: 100,
      enableAuditLogging: true,
      enableNetworking: true
    };

    // Event system
    this.eventListeners = new Map();
  }

  // Initialize the operating system
  async initialize() {
    if (this.isInitialized) {
      throw new Error('Operating system already initialized');
    }

    console.log(`🚀 Booting Heyming OS v${this.version}...`);

    try {
      // Initialize the kernel
      await this.initializeKernel();

      // Start core services
      await this.startCoreServices();

      // Initialize applications
      await this.initializeApplications();

      // Create default terminal
      await this.createDefaultTerminal();

      this.isInitialized = true;
      const bootDuration = Date.now() - this.bootTime;

      console.log(`✅ Heyming OS initialized successfully in ${bootDuration}ms`);
      this.emit('os:ready');

      return this;
    } catch (error) {
      console.error('❌ Failed to initialize Heyming OS:', error);
      throw error;
    }
  }

  async initializeKernel() {
    console.log('🔧 Initializing kernel...');

    // Create kernel (classes are loaded globally via script tags)
    if (!window.HeymingKernel) {
      throw new Error('HeymingKernel not loaded. Make sure kernel.js is included.');
    }
    this.kernel = new window.HeymingKernel();

    // Initialize kernel subsystems
    await this.kernel.initialize();

    // Listen for kernel events
    this.kernel.on('kernel:ready', () => {
      console.log('✅ Kernel ready');
    });

    this.kernel.on('process:created', (process) => {
      this.emit('process:created', process);
    });

    this.kernel.on('process:exit', (process) => {
      this.emit('process:exit', process);
    });

    console.log('✅ Kernel initialized');
  }

  async startCoreServices() {
    console.log('🔧 Starting core services...');

    // TODO: Implement actual services when needed
    // For now, skip service creation to avoid runaway processes
    console.log('⚠️ Core services disabled - using minimal OS mode');

    console.log('✅ Core services started');
  }

  async initializeApplications() {
    console.log('🔧 Initializing applications...');

    // TODO: Implement actual applications when needed
    // For now, skip application registration
    console.log('⚠️ Applications disabled - using minimal OS mode');

    console.log('✅ Applications initialized');
  }

  async createDefaultTerminal() {
    console.log('🔧 Creating default terminal...');

    const cfg = window.parent?.HeymingOS?.Config || { USER: 'jheyming', HOME: '/home/jheyming' };
    const terminal = await this.createTerminal({
      title: 'Terminal',
      user: cfg.USER,
      cwd: cfg.HOME
    });

    console.log(`✅ Default terminal created (ID: ${terminal.id})`);
    return terminal;
  }

  // Terminal Management
  async createTerminal(options = {}) {
    if (this.terminals.size >= this.config.maxTerminals) {
      throw new Error('Maximum number of terminals reached');
    }

    const terminalId = this.generateId();

    // Create terminal process
    const defaultUser = window.parent?.HeymingOS?.Config?.USER || 'jheyming';
    const homeDir = `/home/${options.user || defaultUser}`;
    const workingDir = options.cwd || homeDir;

    const terminalProcess = await this.kernel.processManager.createProcess({
      name: 'terminal',
      executable: '/bin/terminal',
      args: [],
      cwd: workingDir,
      env: {
        USER: options.user || defaultUser,
        HOME: homeDir,
        PWD: workingDir,
        TERM: 'heyming-terminal',
        SHELL: '/bin/jsh'
      },
      uid: 1000,
      gid: 1000,
      isolated: false // Terminal should run in main thread, not Web Worker
    });

    // Create terminal (Terminal class is loaded globally)
    if (!window.Terminal) {
      throw new Error('Terminal class not loaded. Make sure terminal.js is included.');
    }
    // For the main terminal, don't use windowId (use existing DOM elements)
    // For additional terminals, use windowId for windowed mode
    const isMainTerminal = this.terminals.size === 0;
    const terminal = new window.Terminal(isMainTerminal ? null : terminalId, this);

    // Connect terminal to its process
    terminal.setProcess(terminalProcess);

    // Set the terminal process as current process for kernel
    this.kernel.processManager.setCurrentProcess(terminalProcess);

    // Store terminal reference
    this.terminals.set(terminalId, {
      id: terminalId,
      terminal: terminal,
      process: terminalProcess,
      title: options.title || 'Terminal',
      created: Date.now()
    });

    this.emit('terminal:created', { id: terminalId, terminal });

    return {
      id: terminalId,
      terminal: terminal,
      process: terminalProcess
    };
  }

  destroyTerminal(terminalId) {
    const terminalInfo = this.terminals.get(terminalId);
    if (!terminalInfo) {
      throw new Error(`Terminal ${terminalId} not found`);
    }

    // Terminate the terminal process
    this.kernel.processManager.kill(terminalInfo.process.pid);

    // Clean up terminal
    if (terminalInfo.terminal.cleanup) {
      terminalInfo.terminal.cleanup();
    }

    this.terminals.delete(terminalId);
    this.emit('terminal:destroyed', { id: terminalId });

    console.log(`Terminal ${terminalId} destroyed`);
  }

  getTerminal(terminalId) {
    const terminalInfo = this.terminals.get(terminalId);
    return terminalInfo ? terminalInfo.terminal : null;
  }

  listTerminals() {
    return Array.from(this.terminals.values()).map((info) => ({
      id: info.id,
      title: info.title,
      pid: info.process.pid,
      created: info.created
    }));
  }

  // Application Management
  registerApplication(name, applicationClass) {
    this.applications.set(name, applicationClass);
    console.log(`Application registered: ${name}`);
  }

  async launchApplication(name, options = {}) {
    const ApplicationClass = this.applications.get(name);
    if (!ApplicationClass) {
      throw new Error(`Application not found: ${name}`);
    }

    // Create process for application
    const appProcess = await this.kernel.processManager.createProcess({
      name: name,
      executable: `/usr/bin/${name}`,
      args: options.args || [],
      env: options.env || {},
      uid: options.uid || 1000,
      gid: options.gid || 1000
    });

    // Create application instance
    const app = new ApplicationClass(this, appProcess, options);

    // Initialize application
    if (app.initialize) {
      await app.initialize();
    }

    this.emit('application:launched', { name, process: appProcess, app });

    return {
      name: name,
      process: appProcess,
      app: app
    };
  }

  // Service Management
  async startService(name, ServiceClass) {
    if (this.services.has(name)) {
      throw new Error(`Service ${name} already running`);
    }

    // Create service process
    const serviceProcess = await this.kernel.processManager.createProcess({
      name: `${name}-service`,
      executable: `/usr/sbin/${name}`,
      args: [],
      uid: 0, // Services run as root
      gid: 0
    });

    // Create service instance
    const service = new ServiceClass(this, serviceProcess);

    // Initialize and start service
    if (service.initialize) {
      await service.initialize();
    }

    if (service.start) {
      await service.start();
    }

    this.services.set(name, {
      name: name,
      service: service,
      process: serviceProcess,
      started: Date.now()
    });

    console.log(`Service started: ${name} (PID: ${serviceProcess.pid})`);
    this.emit('service:started', { name, service, process: serviceProcess });
  }

  async stopService(name) {
    const serviceInfo = this.services.get(name);
    if (!serviceInfo) {
      throw new Error(`Service ${name} not found`);
    }

    // Stop service
    if (serviceInfo.service.stop) {
      await serviceInfo.service.stop();
    }

    // Terminate service process
    await this.kernel.processManager.kill(serviceInfo.process.pid);

    this.services.delete(name);
    console.log(`Service stopped: ${name}`);
    this.emit('service:stopped', { name });
  }

  getService(name) {
    const serviceInfo = this.services.get(name);
    return serviceInfo ? serviceInfo.service : null;
  }

  listServices() {
    return Array.from(this.services.values()).map((info) => ({
      name: info.name,
      pid: info.process.pid,
      started: info.started,
      uptime: Date.now() - info.started
    }));
  }

  // System Information
  getSystemInfo() {
    const kernelInfo = this.kernel.getSystemInfo();
    const memoryStats = this.kernel.memoryManager.getUsageStats();
    const schedulerStats = this.kernel.schedulerManager.getStats();
    const securityStats = this.kernel.securityManager.getSecurityStats();
    const deviceStats = this.kernel.deviceManager.getDeviceStats();

    return {
      os: {
        name: 'Heyming OS',
        version: this.version,
        bootTime: this.bootTime,
        uptime: Date.now() - this.bootTime,
        isInitialized: this.isInitialized
      },
      kernel: kernelInfo,
      memory: memoryStats,
      scheduler: schedulerStats,
      security: securityStats,
      devices: deviceStats,
      terminals: this.terminals.size,
      services: this.services.size,
      applications: this.applications.size,
      config: this.config
    };
  }

  // Configuration Management
  setConfig(key, value) {
    if (!(key in this.config)) {
      throw new Error(`Unknown configuration key: ${key}`);
    }

    const oldValue = this.config[key];
    this.config[key] = value;

    // Apply configuration changes
    this.applyConfigChange(key, value, oldValue);

    this.emit('config:changed', { key, value, oldValue });
    console.log(`Configuration changed: ${key} = ${value}`);
  }

  applyConfigChange(key, newValue, oldValue) {
    switch (key) {
      case 'securityLevel':
        this.kernel.securityManager.setSecurityLevel(newValue);
        break;
      case 'schedulingAlgorithm':
        this.kernel.schedulerManager.setSchedulingAlgorithm(newValue);
        break;
      case 'timeSlice':
        this.kernel.schedulerManager.setTimeSlice(newValue);
        break;
    }
  }

  getConfig(key) {
    return key ? this.config[key] : { ...this.config };
  }

  // Event System
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
          console.error(`Event listener failed for ${event}:`, error);
        }
      });
    }
  }

  // Utility Methods
  generateId() {
    return Math.random().toString(36).substr(2, 9);
  }

  // Shutdown
  async shutdown() {
    console.log('🔄 Shutting down Heyming OS...');

    // Stop all services
    for (const serviceName of this.services.keys()) {
      try {
        await this.stopService(serviceName);
      } catch (error) {
        console.error(`Failed to stop service ${serviceName}:`, error);
      }
    }

    // Destroy all terminals
    for (const terminalId of this.terminals.keys()) {
      try {
        this.destroyTerminal(terminalId);
      } catch (error) {
        console.error(`Failed to destroy terminal ${terminalId}:`, error);
      }
    }

    // Shutdown kernel
    if (this.kernel) {
      await this.kernel.shutdown();
    }

    this.isInitialized = false;
    this.emit('os:shutdown');

    console.log('✅ Heyming OS shutdown complete');
  }
}

// Base Service Class
class Service {
  constructor(os, process) {
    this.os = os;
    this.process = process;
    this.isRunning = false;
  }

  async initialize() {
    // Override in subclasses
  }

  async start() {
    this.isRunning = true;
  }

  async stop() {
    this.isRunning = false;
  }
}

// Core Services
class InitService extends Service {
  async initialize() {
    this.os.kernel.log('Init service initializing');
  }
}

class LoggerService extends Service {
  async initialize() {
    this.logBuffer = [];
    this.maxLogSize = 10000;
  }

  log(level, message, source = 'system') {
    const entry = {
      timestamp: Date.now(),
      level: level,
      message: message,
      source: source
    };

    this.logBuffer.push(entry);

    if (this.logBuffer.length > this.maxLogSize) {
      this.logBuffer = this.logBuffer.slice(-this.maxLogSize / 2);
    }
  }

  getLogs(limit = 100) {
    return this.logBuffer.slice(-limit);
  }
}

class CronService extends Service {
  async initialize() {
    this.jobs = new Map();
    this.nextJobId = 1;
  }

  async start() {
    await super.start();
    this.cronTimer = setInterval(() => {
      this.processCronJobs();
    }, 60000); // Check every minute
  }

  async stop() {
    await super.stop();
    if (this.cronTimer) {
      clearInterval(this.cronTimer);
    }
  }

  processCronJobs() {
    // Process scheduled jobs
    const now = new Date();
    for (const [jobId, job] of this.jobs) {
      if (this.shouldRunJob(job, now)) {
        this.executeJob(job);
      }
    }
  }

  shouldRunJob(job, now) {
    // Simplified cron logic
    return now.getTime() - job.lastRun >= job.interval;
  }

  async executeJob(job) {
    try {
      await job.handler();
      job.lastRun = Date.now();
    } catch (error) {
      console.error(`Cron job ${job.id} failed:`, error);
    }
  }
}

class NetworkService extends Service {
  async initialize() {
    this.connections = new Map();
    this.servers = new Map();
  }
}

class DNSService extends Service {
  async initialize() {
    this.dnsCache = new Map();
    this.dnsServers = ['8.8.8.8', '1.1.1.1'];
  }
}

// Base Application Class
class Application {
  constructor(os, process, options = {}) {
    this.os = os;
    this.process = process;
    this.options = options;
    this.isRunning = false;
  }

  async initialize() {
    // Override in subclasses
  }

  async start() {
    this.isRunning = true;
  }

  async stop() {
    this.isRunning = false;
  }
}

// Built-in Applications
class TerminalApplication extends Application {
  async initialize() {
    // Terminal application logic
  }
}

class FileManagerApplication extends Application {
  async initialize() {
    // File manager logic
  }
}

class TextEditorApplication extends Application {
  async initialize() {
    // Text editor logic
  }
}

class CalculatorApplication extends Application {
  async initialize() {
    // Calculator logic
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { HeymingOS };
} else if (typeof window !== 'undefined') {
  window.HeymingOS = HeymingOS;
}

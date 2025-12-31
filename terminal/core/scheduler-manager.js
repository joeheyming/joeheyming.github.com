// Scheduler Manager for Heyming OS
class SchedulerManager {
  constructor(kernel) {
    this.kernel = kernel;
    this.readyQueue = [];
    this.blockedProcesses = new Map();
    this.currentProcess = null;
    this.timeSlice = 1000; // 1000ms time slice (reduced frequency)
    this.schedulerTimer = null;
    this.schedulingAlgorithm = 'round_robin';
    this.debugLogging = false; // Disable verbose logging by default

    // Scheduling algorithms
    this.ALGORITHMS = {
      ROUND_ROBIN: 'round_robin',
      PRIORITY: 'priority',
      SHORTEST_JOB_FIRST: 'sjf',
      COMPLETELY_FAIR: 'cfs'
    };

    // Process priorities (lower number = higher priority)
    this.PRIORITIES = {
      REAL_TIME: 0,
      HIGH: 1,
      NORMAL: 2,
      LOW: 3,
      IDLE: 4
    };

    // Statistics
    this.stats = {
      contextSwitches: 0,
      totalCpuTime: 0,
      idleTime: 0,
      lastSchedule: Date.now()
    };
  }

  async initialize() {
    this.kernel.log('Scheduler Manager initializing');

    // Start the scheduler timer
    this.startScheduler();

    // Listen for process events
    this.kernel.on('process:created', (process) => {
      this.addProcess(process);
    });

    this.kernel.on('process:exit', (process) => {
      this.removeProcess(process);
    });

    this.kernel.on('process:block', (process) => {
      this.blockProcess(process);
    });

    this.kernel.on('process:unblock', (process) => {
      this.unblockProcess(process);
    });
  }

  startScheduler() {
    if (this.schedulerTimer) {
      clearInterval(this.schedulerTimer);
    }

    this.schedulerTimer = setInterval(() => {
      this.tick();
    }, this.timeSlice);

    this.kernel.log(`Scheduler started with ${this.timeSlice}ms time slice`);
  }

  stopScheduler() {
    if (this.schedulerTimer) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }

    this.kernel.log('Scheduler stopped');
  }

  // Main scheduling tick
  tick() {
    const now = Date.now();
    const timeSinceLastSchedule = now - this.stats.lastSchedule;

    // Update CPU time for current process
    if (this.currentProcess) {
      this.currentProcess.cpuTime += timeSinceLastSchedule;
      this.stats.totalCpuTime += timeSinceLastSchedule;
    } else {
      this.stats.idleTime += timeSinceLastSchedule;
    }

    // Schedule next process
    this.schedule();

    this.stats.lastSchedule = now;
  }

  // Main scheduling function
  schedule() {
    let nextProcess = null;

    switch (this.schedulingAlgorithm) {
      case this.ALGORITHMS.ROUND_ROBIN:
        nextProcess = this.scheduleRoundRobin();
        break;
      case this.ALGORITHMS.PRIORITY:
        nextProcess = this.schedulePriority();
        break;
      case this.ALGORITHMS.SHORTEST_JOB_FIRST:
        nextProcess = this.scheduleSJF();
        break;
      case this.ALGORITHMS.COMPLETELY_FAIR:
        nextProcess = this.scheduleCFS();
        break;
      default:
        nextProcess = this.scheduleRoundRobin();
    }

    // Context switch if needed
    if (nextProcess !== this.currentProcess) {
      this.contextSwitch(nextProcess);
    }
  }

  // Round Robin scheduling
  scheduleRoundRobin() {
    if (this.readyQueue.length === 0) {
      return null;
    }

    // If current process is still ready, move it to end of queue
    if (this.currentProcess && this.currentProcess.state === 'running') {
      this.currentProcess.state = 'ready';
      this.readyQueue.push(this.currentProcess);
    }

    // Get next process from front of queue
    return this.readyQueue.shift();
  }

  // Priority scheduling
  schedulePriority() {
    if (this.readyQueue.length === 0) {
      return null;
    }

    // Sort by priority (lower number = higher priority)
    this.readyQueue.sort((a, b) => a.priority - b.priority);

    // If current process has highest priority and is still ready, keep it
    if (
      this.currentProcess &&
      this.currentProcess.state === 'running' &&
      this.readyQueue.length > 0 &&
      this.currentProcess.priority <= this.readyQueue[0].priority
    ) {
      return this.currentProcess;
    }

    // Switch to highest priority process
    if (this.currentProcess && this.currentProcess.state === 'running') {
      this.currentProcess.state = 'ready';
      this.readyQueue.push(this.currentProcess);
      this.readyQueue.sort((a, b) => a.priority - b.priority);
    }

    return this.readyQueue.shift();
  }

  // Shortest Job First scheduling
  scheduleSJF() {
    if (this.readyQueue.length === 0) {
      return null;
    }

    // Sort by estimated remaining time
    this.readyQueue.sort((a, b) => {
      const aRemaining = this.estimateRemainingTime(a);
      const bRemaining = this.estimateRemainingTime(b);
      return aRemaining - bRemaining;
    });

    // If current process is shortest, keep it
    if (
      this.currentProcess &&
      this.currentProcess.state === 'running' &&
      this.readyQueue.length > 0
    ) {
      const currentRemaining = this.estimateRemainingTime(this.currentProcess);
      const nextRemaining = this.estimateRemainingTime(this.readyQueue[0]);

      if (currentRemaining <= nextRemaining) {
        return this.currentProcess;
      }
    }

    // Switch to shortest job
    if (this.currentProcess && this.currentProcess.state === 'running') {
      this.currentProcess.state = 'ready';
      this.readyQueue.push(this.currentProcess);
      this.readyQueue.sort((a, b) => {
        const aRemaining = this.estimateRemainingTime(a);
        const bRemaining = this.estimateRemainingTime(b);
        return aRemaining - bRemaining;
      });
    }

    return this.readyQueue.shift();
  }

  // Completely Fair Scheduler (simplified)
  scheduleCFS() {
    if (this.readyQueue.length === 0) {
      return null;
    }

    // Calculate virtual runtime for each process
    const processesWithVruntime = this.readyQueue.map((process) => ({
      process,
      vruntime: this.calculateVirtualRuntime(process)
    }));

    // Sort by virtual runtime (lowest first)
    processesWithVruntime.sort((a, b) => a.vruntime - b.vruntime);

    // If current process has lowest vruntime, keep it
    if (this.currentProcess && this.currentProcess.state === 'running') {
      const currentVruntime = this.calculateVirtualRuntime(this.currentProcess);
      const nextVruntime = processesWithVruntime[0].vruntime;

      if (currentVruntime <= nextVruntime) {
        return this.currentProcess;
      }

      // Add current process back to queue
      this.currentProcess.state = 'ready';
      this.readyQueue.push(this.currentProcess);
    }

    // Remove the selected process from ready queue
    const selectedProcess = processesWithVruntime[0].process;
    const index = this.readyQueue.indexOf(selectedProcess);
    if (index > -1) {
      this.readyQueue.splice(index, 1);
    }

    return selectedProcess;
  }

  // Context switch between processes
  contextSwitch(newProcess) {
    const oldProcess = this.currentProcess;

    // Save state of old process
    if (oldProcess && oldProcess.state === 'running') {
      oldProcess.state = 'ready';
      // In a real system, we'd save CPU registers, stack pointer, etc.
    }

    // Load state of new process
    this.currentProcess = newProcess;
    if (newProcess) {
      newProcess.state = 'running';
      this.kernel.processManager.setCurrentProcess(newProcess);
    } else {
      this.kernel.processManager.setCurrentProcess(null);
    }

    this.stats.contextSwitches++;

    // Only log context switches in debug mode
    if (this.debugLogging) {
      if (oldProcess && newProcess) {
        this.kernel.log(`Context switch: PID ${oldProcess.pid} -> PID ${newProcess.pid}`);
      } else if (newProcess) {
        this.kernel.log(`Context switch: idle -> PID ${newProcess.pid}`);
      } else if (oldProcess) {
        this.kernel.log(`Context switch: PID ${oldProcess.pid} -> idle`);
      }
    }

    this.kernel.emit('scheduler:context_switch', {
      oldProcess: oldProcess ? oldProcess.pid : null,
      newProcess: newProcess ? newProcess.pid : null
    });
  }

  // Add process to scheduler
  addProcess(process) {
    if (process.state === 'created') {
      process.state = 'ready';
    }

    if (process.state === 'ready') {
      this.readyQueue.push(process);
      if (this.debugLogging) {
        this.kernel.log(`Process ${process.pid} added to ready queue`);
      }
    }
  }

  // Remove process from scheduler
  removeProcess(process) {
    // Remove from ready queue
    const index = this.readyQueue.indexOf(process);
    if (index > -1) {
      this.readyQueue.splice(index, 1);
    }

    // Remove from blocked processes
    this.blockedProcesses.delete(process.pid);

    // If this was the current process, schedule next
    if (this.currentProcess === process) {
      this.currentProcess = null;
      this.schedule();
    }

    if (this.debugLogging) {
      this.kernel.log(`Process ${process.pid} removed from scheduler`);
    }
  }

  // Block a process
  blockProcess(process, reason = 'unknown') {
    // Remove from ready queue
    const index = this.readyQueue.indexOf(process);
    if (index > -1) {
      this.readyQueue.splice(index, 1);
    }

    // Add to blocked processes
    this.blockedProcesses.set(process.pid, {
      process: process,
      reason: reason,
      blockedTime: Date.now()
    });

    process.state = 'blocked';

    // If this was the current process, schedule next
    if (this.currentProcess === process) {
      this.currentProcess = null;
      this.schedule();
    }

    if (this.debugLogging) {
      this.kernel.log(`Process ${process.pid} blocked: ${reason}`);
    }
  }

  // Unblock a process
  unblockProcess(process) {
    const blockedInfo = this.blockedProcesses.get(process.pid);
    if (blockedInfo) {
      this.blockedProcesses.delete(process.pid);

      process.state = 'ready';
      this.readyQueue.push(process);

      const blockedDuration = Date.now() - blockedInfo.blockedTime;
      if (this.debugLogging) {
        this.kernel.log(`Process ${process.pid} unblocked after ${blockedDuration}ms`);
      }
    }
  }

  // Estimate remaining time for a process (simplified)
  estimateRemainingTime(process) {
    // In a real system, this would use historical data and heuristics
    // For simulation, use a simple estimate based on process type
    const baseTime = 1000; // 1 second base estimate

    if (process.name === 'init') return Infinity; // Init never terminates
    if (process.executable && process.executable.includes('daemon')) return baseTime * 10;
    if (process.args && process.args.length > 0) return baseTime * process.args.length;

    return baseTime;
  }

  // Calculate virtual runtime for CFS
  calculateVirtualRuntime(process) {
    // Simplified virtual runtime calculation
    const niceFactor = Math.pow(1.25, process.priority - this.PRIORITIES.NORMAL);
    return process.cpuTime / niceFactor;
  }

  // Change scheduling algorithm
  setSchedulingAlgorithm(algorithm) {
    if (!Object.values(this.ALGORITHMS).includes(algorithm)) {
      throw new Error(`Invalid scheduling algorithm: ${algorithm}`);
    }

    this.schedulingAlgorithm = algorithm;
    this.kernel.log(`Scheduling algorithm changed to: ${algorithm}`);
  }

  // Change time slice
  setTimeSlice(timeSlice) {
    if (timeSlice < 1 || timeSlice > 1000) {
      throw new Error('Time slice must be between 1 and 1000 ms');
    }

    this.timeSlice = timeSlice;

    // Restart scheduler with new time slice
    this.startScheduler();

    this.kernel.log(`Time slice changed to: ${timeSlice}ms`);
  }

  // Get scheduler statistics
  getStats() {
    const now = Date.now();
    const totalTime = this.stats.totalCpuTime + this.stats.idleTime;

    return {
      algorithm: this.schedulingAlgorithm,
      timeSlice: this.timeSlice,
      contextSwitches: this.stats.contextSwitches,
      totalCpuTime: this.stats.totalCpuTime,
      idleTime: this.stats.idleTime,
      cpuUtilization: totalTime > 0 ? (this.stats.totalCpuTime / totalTime) * 100 : 0,
      readyProcesses: this.readyQueue.length,
      blockedProcesses: this.blockedProcesses.size,
      currentProcess: this.currentProcess ? this.currentProcess.pid : null,
      averageContextSwitchTime:
        this.stats.contextSwitches > 0 ? this.stats.totalCpuTime / this.stats.contextSwitches : 0
    };
  }

  // Get process queue information
  getQueueInfo() {
    return {
      ready: this.readyQueue.map((p) => ({
        pid: p.pid,
        name: p.name,
        priority: p.priority,
        cpuTime: p.cpuTime,
        state: p.state
      })),
      blocked: Array.from(this.blockedProcesses.values()).map((info) => ({
        pid: info.process.pid,
        name: info.process.name,
        reason: info.reason,
        blockedTime: Date.now() - info.blockedTime,
        state: info.process.state
      })),
      current: this.currentProcess
        ? {
            pid: this.currentProcess.pid,
            name: this.currentProcess.name,
            priority: this.currentProcess.priority,
            cpuTime: this.currentProcess.cpuTime,
            state: this.currentProcess.state
          }
        : null
    };
  }

  // Enable/disable debug logging
  setDebugLogging(enabled) {
    this.debugLogging = enabled;
    this.kernel.log(`Scheduler debug logging ${enabled ? 'enabled' : 'disabled'}`);
  }

  // Force schedule (for debugging/testing)
  forceSchedule() {
    this.schedule();
  }

  // Yield current process (voluntary context switch)
  yield() {
    if (this.currentProcess) {
      this.currentProcess.state = 'ready';
      this.readyQueue.push(this.currentProcess);
      this.schedule();
    }
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SchedulerManager };
} else if (typeof window !== 'undefined') {
  window.SchedulerManager = SchedulerManager;
}

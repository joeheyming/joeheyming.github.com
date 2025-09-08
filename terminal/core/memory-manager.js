// Memory Manager for Heyming OS
class MemoryManager {
  constructor(kernel) {
    this.kernel = kernel;
    this.totalMemory = 512 * 1024 * 1024; // 512MB virtual memory
    this.pageSize = 4096; // 4KB pages
    this.totalPages = this.totalMemory / this.pageSize;
    
    // Memory allocation tracking
    this.allocatedPages = new Map(); // pid -> Set of page numbers
    this.freePages = new Set();
    this.processMemory = new Map(); // pid -> memory info
    
    // Memory mapping
    this.memoryMappings = new Map(); // address -> mapping info
    
    // Initialize free pages
    for (let i = 0; i < this.totalPages; i++) {
      this.freePages.add(i);
    }
  }

  async initialize() {
    this.kernel.log('Memory Manager initializing');
    
    // Reserve kernel memory (first 16MB)
    const kernelPages = (16 * 1024 * 1024) / this.pageSize;
    for (let i = 0; i < kernelPages; i++) {
      this.freePages.delete(i);
    }
    
    this.kernel.log(`Memory initialized: ${this.totalMemory / (1024 * 1024)}MB total, ${kernelPages} pages reserved for kernel`);
  }

  // Allocate memory for a process
  allocateMemory(pid, size, type = 'heap') {
    const pagesNeeded = Math.ceil(size / this.pageSize);
    
    if (pagesNeeded > this.freePages.size) {
      throw new Error('Out of memory');
    }

    // Check process memory limits
    const process = this.kernel.processManager.getProcess(pid);
    if (process && !this.kernel.securityManager.checkResourceLimit('memory', size, process)) {
      throw new Error('Process memory limit exceeded');
    }

    // Allocate pages
    const allocatedPages = new Set();
    const freePageArray = Array.from(this.freePages);
    
    for (let i = 0; i < pagesNeeded; i++) {
      const pageNum = freePageArray[i];
      allocatedPages.add(pageNum);
      this.freePages.delete(pageNum);
    }

    // Track allocation
    if (!this.allocatedPages.has(pid)) {
      this.allocatedPages.set(pid, new Set());
    }
    
    for (const pageNum of allocatedPages) {
      this.allocatedPages.get(pid).add(pageNum);
    }

    // Update process memory info
    if (!this.processMemory.has(pid)) {
      this.processMemory.set(pid, {
        heap: 0,
        stack: 0,
        data: 0,
        mappings: new Map()
      });
    }

    const memInfo = this.processMemory.get(pid);
    memInfo[type] += size;

    // Calculate virtual address
    const baseAddress = Math.min(...allocatedPages) * this.pageSize;
    
    this.kernel.log(`Allocated ${size} bytes (${pagesNeeded} pages) for PID ${pid}, type: ${type}`);
    
    return {
      address: baseAddress,
      size: size,
      pages: allocatedPages,
      type: type
    };
  }

  // Free memory for a process
  freeMemory(pid, address, size) {
    const processPages = this.allocatedPages.get(pid);
    if (!processPages) {
      throw new Error(`No memory allocated for process ${pid}`);
    }

    const startPage = Math.floor(address / this.pageSize);
    const pagesNeeded = Math.ceil(size / this.pageSize);
    
    // Free the pages
    for (let i = 0; i < pagesNeeded; i++) {
      const pageNum = startPage + i;
      if (processPages.has(pageNum)) {
        processPages.delete(pageNum);
        this.freePages.add(pageNum);
      }
    }

    // Update process memory info
    const memInfo = this.processMemory.get(pid);
    if (memInfo) {
      // Find which type this allocation belongs to
      for (const [type, amount] of Object.entries(memInfo)) {
        if (typeof amount === 'number' && amount >= size) {
          memInfo[type] -= size;
          break;
        }
      }
    }

    this.kernel.log(`Freed ${size} bytes for PID ${pid}`);
  }

  // Memory mapping (mmap system call)
  mmap(address, length, protection, flags, fd = -1, offset = 0) {
    const currentProcess = this.kernel.processManager.currentProcess;
    if (!currentProcess) {
      throw new Error('No current process for mmap');
    }

    const pid = currentProcess.pid;
    const pagesNeeded = Math.ceil(length / this.pageSize);
    
    // Check if we have enough free pages
    if (pagesNeeded > this.freePages.size) {
      throw new Error('Cannot map memory: insufficient free pages');
    }

    // Allocate pages for mapping
    const allocation = this.allocateMemory(pid, length, 'mapping');
    
    // Create mapping info
    const mapping = {
      address: allocation.address,
      length: length,
      protection: protection,
      flags: flags,
      fd: fd,
      offset: offset,
      pid: pid,
      pages: allocation.pages
    };

    this.memoryMappings.set(allocation.address, mapping);
    
    // Add to process memory info
    const memInfo = this.processMemory.get(pid);
    if (memInfo) {
      memInfo.mappings.set(allocation.address, mapping);
    }

    this.kernel.log(`Memory mapped: PID ${pid}, address 0x${allocation.address.toString(16)}, length ${length}`);
    
    return allocation.address;
  }

  // Unmap memory (munmap system call)
  munmap(address, length) {
    const mapping = this.memoryMappings.get(address);
    if (!mapping) {
      throw new Error('Invalid memory mapping address');
    }

    const currentProcess = this.kernel.processManager.currentProcess;
    if (!currentProcess || mapping.pid !== currentProcess.pid) {
      throw new Error('Permission denied: cannot unmap memory from another process');
    }

    // Free the memory
    this.freeMemory(mapping.pid, address, length);
    
    // Remove mapping
    this.memoryMappings.delete(address);
    
    const memInfo = this.processMemory.get(mapping.pid);
    if (memInfo) {
      memInfo.mappings.delete(address);
    }

    this.kernel.log(`Memory unmapped: PID ${mapping.pid}, address 0x${address.toString(16)}`);
    
    return 0;
  }

  // Change program break (brk system call)
  brk(address) {
    const currentProcess = this.kernel.processManager.currentProcess;
    if (!currentProcess) {
      throw new Error('No current process for brk');
    }

    const pid = currentProcess.pid;
    const memInfo = this.processMemory.get(pid);
    
    if (!memInfo) {
      // Initialize process memory
      this.processMemory.set(pid, {
        heap: 0,
        stack: 0,
        data: 0,
        mappings: new Map(),
        heapStart: address,
        heapEnd: address
      });
      return address;
    }

    const currentHeapEnd = memInfo.heapEnd || memInfo.heapStart || address;
    
    if (address > currentHeapEnd) {
      // Expand heap
      const expansion = address - currentHeapEnd;
      try {
        this.allocateMemory(pid, expansion, 'heap');
        memInfo.heapEnd = address;
      } catch (error) {
        // Return current break on failure
        return currentHeapEnd;
      }
    } else if (address < currentHeapEnd) {
      // Shrink heap
      const reduction = currentHeapEnd - address;
      this.freeMemory(pid, address, reduction);
      memInfo.heapEnd = address;
    }

    return address;
  }

  // Clean up memory for terminated process
  cleanupProcess(pid) {
    const processPages = this.allocatedPages.get(pid);
    if (processPages) {
      // Free all pages allocated to this process
      for (const pageNum of processPages) {
        this.freePages.add(pageNum);
      }
      this.allocatedPages.delete(pid);
    }

    // Remove memory mappings
    const memInfo = this.processMemory.get(pid);
    if (memInfo) {
      for (const [address, mapping] of memInfo.mappings) {
        this.memoryMappings.delete(address);
      }
    }

    this.processMemory.delete(pid);
    
    this.kernel.log(`Memory cleaned up for terminated process ${pid}`);
  }

  // Get memory usage statistics
  getUsageStats() {
    const usedPages = this.totalPages - this.freePages.size;
    const usedMemory = usedPages * this.pageSize;
    const freeMemory = this.freePages.size * this.pageSize;
    
    return {
      total: this.totalMemory,
      used: usedMemory,
      free: freeMemory,
      usedPages: usedPages,
      freePages: this.freePages.size,
      totalPages: this.totalPages,
      pageSize: this.pageSize,
      processes: this.processMemory.size,
      mappings: this.memoryMappings.size
    };
  }

  // Get memory usage for specific process
  getProcessMemory(pid) {
    const memInfo = this.processMemory.get(pid);
    if (!memInfo) {
      return null;
    }

    const processPages = this.allocatedPages.get(pid);
    const totalPages = processPages ? processPages.size : 0;
    const totalMemory = totalPages * this.pageSize;

    return {
      pid: pid,
      totalMemory: totalMemory,
      totalPages: totalPages,
      heap: memInfo.heap,
      stack: memInfo.stack,
      data: memInfo.data,
      mappings: memInfo.mappings.size,
      heapStart: memInfo.heapStart,
      heapEnd: memInfo.heapEnd
    };
  }

  // Get all process memory usage
  getAllProcessMemory() {
    const result = [];
    for (const pid of this.processMemory.keys()) {
      const memInfo = this.getProcessMemory(pid);
      if (memInfo) {
        result.push(memInfo);
      }
    }
    return result;
  }

  // Memory pressure detection
  isMemoryPressure() {
    const stats = this.getUsageStats();
    const usagePercent = (stats.used / stats.total) * 100;
    
    return {
      pressure: usagePercent > 80,
      level: usagePercent > 95 ? 'critical' : 
             usagePercent > 90 ? 'high' : 
             usagePercent > 80 ? 'medium' : 'low',
      usagePercent: usagePercent,
      availableMemory: stats.free
    };
  }

  // Garbage collection (simplified)
  garbageCollect() {
    let freedPages = 0;
    
    // Clean up any orphaned pages
    for (const pid of this.allocatedPages.keys()) {
      const process = this.kernel.processManager.getProcess(pid);
      if (!process || process.state === 'terminated') {
        this.cleanupProcess(pid);
        freedPages++;
      }
    }

    // Clean up orphaned mappings
    for (const [address, mapping] of this.memoryMappings) {
      const process = this.kernel.processManager.getProcess(mapping.pid);
      if (!process || process.state === 'terminated') {
        this.memoryMappings.delete(address);
      }
    }

    if (freedPages > 0) {
      this.kernel.log(`Garbage collection freed ${freedPages} pages`);
    }

    return freedPages;
  }

  // Memory defragmentation (simplified)
  defragment() {
    // In a real system, this would compact memory and reduce fragmentation
    // For our simulation, we'll just report current fragmentation
    const stats = this.getUsageStats();
    const fragmentation = this.calculateFragmentation();
    
    this.kernel.log(`Memory defragmentation: ${fragmentation.toFixed(2)}% fragmented`);
    
    return {
      fragmentationPercent: fragmentation,
      compactedPages: 0, // Would be non-zero in real implementation
      freedMemory: 0
    };
  }

  calculateFragmentation() {
    // Simple fragmentation calculation based on free page distribution
    const freePageArray = Array.from(this.freePages).sort((a, b) => a - b);
    let fragments = 0;
    
    for (let i = 1; i < freePageArray.length; i++) {
      if (freePageArray[i] !== freePageArray[i-1] + 1) {
        fragments++;
      }
    }
    
    return freePageArray.length > 0 ? (fragments / freePageArray.length) * 100 : 0;
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MemoryManager };
} else if (typeof window !== 'undefined') {
  window.MemoryManager = MemoryManager;
}

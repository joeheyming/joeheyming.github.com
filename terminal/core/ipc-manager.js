// Inter-Process Communication Manager for Heyming OS
export class IPCManager {
  constructor(kernel) {
    this.kernel = kernel;
    this.pipes = new Map();
    this.messageQueues = new Map();
    this.sharedMemory = new Map();
    this.sockets = new Map();
    this.nextPipeId = 1;
    this.nextQueueId = 1;
    this.nextSocketId = 1;
  }

  async initialize() {
    this.kernel.log('IPC Manager initializing');
  }

  // Create a pipe for process communication (POSIX pipe())
  createPipe() {
    const pipeId = this.nextPipeId++;
    const pipe = new Pipe(pipeId);
    this.pipes.set(pipeId, pipe);

    const proc = this.kernel.processManager.currentProcess;
    const readFD = this.kernel.processManager.allocateFD(proc, {
      type: 'pipe_read',
      pipeId: pipeId
    });

    const writeFD = this.kernel.processManager.allocateFD(proc, {
      type: 'pipe_write',
      pipeId: pipeId
    });

    this.kernel.log(`Pipe created: ID ${pipeId}, Read FD ${readFD}, Write FD ${writeFD}`);
    return [readFD, writeFD];
  }

  // Create a message queue
  createMessageQueue(key = null) {
    const queueId = this.nextQueueId++;
    const queue = new MessageQueue(queueId, key);
    this.messageQueues.set(queueId, queue);

    this.kernel.log(`Message queue created: ID ${queueId}`);
    return queueId;
  }

  // Send message to queue
  async sendMessage(queueId, message, type = 1) {
    const queue = this.messageQueues.get(queueId);
    if (!queue) {
      throw new Error(`Message queue ${queueId} not found`);
    }

    const currentProcess = this.kernel.processManager.currentProcess;
    if (!currentProcess) {
      throw new Error('No current process for message send');
    }

    // Check permissions
    if (!queue.canWrite(currentProcess.uid, currentProcess.gid)) {
      throw new Error('Permission denied for message queue write');
    }

    const msg = {
      type: type,
      sender: currentProcess.pid,
      timestamp: Date.now(),
      data: message
    };

    queue.enqueue(msg);
    this.kernel.log(`Message sent to queue ${queueId} from PID ${currentProcess.pid}`);

    // Notify waiting processes
    this.notifyQueueWaiters(queueId);

    return 0;
  }

  // Receive message from queue
  async receiveMessage(queueId, messageType = 0, flags = 0) {
    const queue = this.messageQueues.get(queueId);
    if (!queue) {
      throw new Error(`Message queue ${queueId} not found`);
    }

    const currentProcess = this.kernel.processManager.currentProcess;
    if (!currentProcess) {
      throw new Error('No current process for message receive');
    }

    // Check permissions
    if (!queue.canRead(currentProcess.uid, currentProcess.gid)) {
      throw new Error('Permission denied for message queue read');
    }

    const message = queue.dequeue(messageType);
    if (message) {
      this.kernel.log(`Message received from queue ${queueId} by PID ${currentProcess.pid}`);
      return message;
    }

    // No message available
    if (flags & 0x800) {
      // IPC_NOWAIT
      throw new Error('No message available');
    }

    // Block until message arrives
    return new Promise((resolve, reject) => {
      queue.addWaiter(currentProcess.pid, messageType, resolve, reject);
      currentProcess.state = 'blocked';
    });
  }

  // Create shared memory segment
  createSharedMemory(key, size, permissions = 0o666) {
    const segment = new SharedMemorySegment(key, size, permissions);
    this.sharedMemory.set(key, segment);

    this.kernel.log(`Shared memory created: Key ${key}, Size ${size}`);
    return segment;
  }

  // Attach to shared memory
  attachSharedMemory(key) {
    const segment = this.sharedMemory.get(key);
    if (!segment) {
      throw new Error(`Shared memory segment ${key} not found`);
    }

    const currentProcess = this.kernel.processManager.currentProcess;
    if (!currentProcess) {
      throw new Error('No current process for shared memory attach');
    }

    segment.attach(currentProcess.pid);
    return segment.getBuffer();
  }

  // Detach from shared memory
  detachSharedMemory(key) {
    const segment = this.sharedMemory.get(key);
    if (!segment) {
      throw new Error(`Shared memory segment ${key} not found`);
    }

    const currentProcess = this.kernel.processManager.currentProcess;
    if (currentProcess) {
      segment.detach(currentProcess.pid);
    }
  }

  // Create a socket
  createSocket(domain = 'AF_INET', type = 'SOCK_STREAM', protocol = 0) {
    const socketId = this.nextSocketId++;
    const socket = new Socket(socketId, domain, type, protocol);
    this.sockets.set(socketId, socket);

    const currentProcess = this.kernel.processManager.currentProcess;
    if (currentProcess) {
      const fd = this.kernel.processManager.allocateFD(currentProcess, {
        type: 'socket',
        socketId: socketId,
        readable: true,
        writable: true
      });

      this.kernel.log(`Socket created: ID ${socketId}, FD ${fd}`);
      return fd;
    }

    throw new Error('No current process for socket creation');
  }

  // Write to pipe
  async writePipe(pipeId, data) {
    const pipe = this.pipes.get(pipeId);
    if (!pipe) {
      throw new Error(`Pipe ${pipeId} not found`);
    }

    pipe.write(data);
    this.notifyPipeReaders(pipeId);
  }

  // Read from pipe
  async readPipe(pipeId, size = 4096) {
    const pipe = this.pipes.get(pipeId);
    if (!pipe) {
      throw new Error(`Pipe ${pipeId} not found`);
    }

    const data = pipe.read(size);
    if (data !== null) {
      return data;
    }

    // Block until data available
    return new Promise((resolve) => {
      pipe.addReader(resolve);
    });
  }

  // Notify processes waiting on pipe
  notifyPipeReaders(pipeId) {
    const pipe = this.pipes.get(pipeId);
    if (pipe) {
      pipe.notifyReaders();
    }
  }

  // Notify processes waiting on message queue
  notifyQueueWaiters(queueId) {
    const queue = this.messageQueues.get(queueId);
    if (queue) {
      queue.notifyWaiters();
    }
  }

  // Clean up IPC resources for terminated process
  cleanupProcess(pid) {
    // Clean up pipes
    for (const [pipeId, pipe] of this.pipes) {
      pipe.removeProcess(pid);
      if (pipe.isEmpty()) {
        this.pipes.delete(pipeId);
      }
    }

    // Clean up message queues
    for (const [queueId, queue] of this.messageQueues) {
      queue.removeWaiters(pid);
    }

    // Clean up shared memory
    for (const [key, segment] of this.sharedMemory) {
      segment.detach(pid);
      if (segment.getAttachCount() === 0) {
        this.sharedMemory.delete(key);
      }
    }
  }
}

// Pipe implementation
export class Pipe {
  constructor(id) {
    this.id = id;
    this.buffer = [];
    this.readers = [];
    this.closed = false;
    this.maxSize = 65536; // 64KB buffer
  }

  write(data) {
    if (this.closed) {
      throw new Error('Pipe is closed');
    }

    if (this.buffer.length >= this.maxSize) {
      throw new Error('Pipe buffer full');
    }

    this.buffer.push(data);
  }

  read(size) {
    if (this.buffer.length === 0) {
      return null;
    }

    const data = this.buffer.shift();
    return data;
  }

  addReader(callback) {
    this.readers.push(callback);
  }

  notifyReaders() {
    while (this.readers.length > 0 && this.buffer.length > 0) {
      const reader = this.readers.shift();
      const data = this.read();
      reader(data);
    }
  }

  removeProcess(pid) {
    // Remove any waiting readers from this process
    // (In a real implementation, we'd track which readers belong to which process)
  }

  isEmpty() {
    return this.buffer.length === 0 && this.readers.length === 0;
  }

  close() {
    this.closed = true;
    // Notify all waiting readers that pipe is closed
    while (this.readers.length > 0) {
      const reader = this.readers.shift();
      reader(null); // EOF
    }
  }
}

// Message Queue implementation
export class MessageQueue {
  constructor(id, key) {
    this.id = id;
    this.key = key;
    this.messages = [];
    this.waiters = [];
    this.permissions = 0o666;
    this.owner = { uid: 0, gid: 0 };
    this.maxMessages = 100;
    this.maxMessageSize = 8192;
  }

  canRead(uid, gid) {
    // Simplified permission check
    return (this.permissions & 0o044) !== 0 || uid === this.owner.uid || uid === 0;
  }

  canWrite(uid, gid) {
    // Simplified permission check
    return (this.permissions & 0o022) !== 0 || uid === this.owner.uid || uid === 0;
  }

  enqueue(message) {
    if (this.messages.length >= this.maxMessages) {
      throw new Error('Message queue full');
    }

    this.messages.push(message);
  }

  dequeue(messageType = 0) {
    if (messageType === 0) {
      // Get first message
      return this.messages.shift();
    } else if (messageType > 0) {
      // Get first message of specific type
      const index = this.messages.findIndex((msg) => msg.type === messageType);
      if (index >= 0) {
        return this.messages.splice(index, 1)[0];
      }
    } else {
      // Get first message with type <= |messageType|
      const maxType = Math.abs(messageType);
      const index = this.messages.findIndex((msg) => msg.type <= maxType);
      if (index >= 0) {
        return this.messages.splice(index, 1)[0];
      }
    }

    return null;
  }

  addWaiter(pid, messageType, resolve, reject) {
    this.waiters.push({ pid, messageType, resolve, reject });
  }

  removeWaiters(pid) {
    this.waiters = this.waiters.filter((waiter) => waiter.pid !== pid);
  }

  notifyWaiters() {
    const notified = [];

    for (let i = this.waiters.length - 1; i >= 0; i--) {
      const waiter = this.waiters[i];
      const message = this.dequeue(waiter.messageType);

      if (message) {
        waiter.resolve(message);
        this.waiters.splice(i, 1);
        notified.push(waiter.pid);
      }
    }

    return notified;
  }
}

// Shared Memory Segment implementation
export class SharedMemorySegment {
  constructor(key, size, permissions) {
    this.key = key;
    this.size = size;
    this.permissions = permissions;
    this.buffer = new ArrayBuffer(size);
    this.attachedProcesses = new Set();
    this.owner = { uid: 0, gid: 0 };
    this.createTime = Date.now();
    this.lastAttach = null;
    this.lastDetach = null;
  }

  attach(pid) {
    this.attachedProcesses.add(pid);
    this.lastAttach = Date.now();
  }

  detach(pid) {
    this.attachedProcesses.delete(pid);
    this.lastDetach = Date.now();
  }

  getAttachCount() {
    return this.attachedProcesses.size;
  }

  getBuffer() {
    return this.buffer;
  }
}

// Socket implementation (basic)
export class Socket {
  constructor(id, domain, type, protocol) {
    this.id = id;
    this.domain = domain;
    this.type = type;
    this.protocol = protocol;
    this.state = 'CREATED';
    this.localAddress = null;
    this.remoteAddress = null;
    this.buffer = [];
    this.listeners = [];
  }

  bind(address) {
    this.localAddress = address;
    this.state = 'BOUND';
  }

  listen(backlog = 5) {
    if (this.state !== 'BOUND') {
      throw new Error('Socket must be bound before listening');
    }
    this.state = 'LISTENING';
    this.backlog = backlog;
  }

  connect(address) {
    this.remoteAddress = address;
    this.state = 'CONNECTED';
  }

  send(data) {
    if (this.state !== 'CONNECTED') {
      throw new Error('Socket not connected');
    }
    // In a real implementation, this would send over network
    this.buffer.push(data);
  }

  receive(size = 4096) {
    return this.buffer.shift() || null;
  }
}

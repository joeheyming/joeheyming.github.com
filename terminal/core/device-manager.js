// Device Manager for Heyming OS
class DeviceManager {
  constructor(kernel) {
    this.kernel = kernel;
    this.devices = new Map();
    this.deviceDrivers = new Map();
    this.deviceNodes = new Map(); // /dev entries
    this.interruptHandlers = new Map();
    
    // Device types
    this.DEVICE_TYPES = {
      BLOCK: 'block',
      CHARACTER: 'character',
      NETWORK: 'network',
      INPUT: 'input',
      OUTPUT: 'output',
      STORAGE: 'storage'
    };
    
    // Device states
    this.DEVICE_STATES = {
      OFFLINE: 'offline',
      ONLINE: 'online',
      ERROR: 'error',
      BUSY: 'busy'
    };
  }

  async initialize() {
    this.kernel.log('Device Manager initializing');
    
    // Initialize virtual devices
    await this.initializeVirtualDevices();
    
    // Initialize input devices
    await this.initializeInputDevices();
    
    // Initialize storage devices
    await this.initializeStorageDevices();
    
    // Initialize network devices
    await this.initializeNetworkDevices();
  }

  async initializeVirtualDevices() {
    // Null device
    const nullDevice = new DevNullDevice('null', this);
    this.registerDevice(nullDevice);
    this.createDeviceNode('/dev/null', nullDevice);
    
    // Zero device
    const zeroDevice = new DevZeroDevice('zero', this);
    this.registerDevice(zeroDevice);
    this.createDeviceNode('/dev/zero', zeroDevice);
    
    // Random devices
    const randomDevice = new DevRandomDevice('random', this);
    this.registerDevice(randomDevice);
    this.createDeviceNode('/dev/random', randomDevice);
    this.createDeviceNode('/dev/urandom', randomDevice);
    
    // Full device (always returns ENOSPC)
    const fullDevice = new FullDevice('full', this);
    this.registerDevice(fullDevice);
    this.createDeviceNode('/dev/full', fullDevice);
    
    this.kernel.log('Virtual devices initialized');
  }

  async initializeInputDevices() {
    // Keyboard device
    const keyboard = new KeyboardDevice('keyboard', this);
    this.registerDevice(keyboard);
    this.createDeviceNode('/dev/input/keyboard', keyboard);
    
    // Mouse device
    const mouse = new MouseDevice('mouse', this);
    this.registerDevice(mouse);
    this.createDeviceNode('/dev/input/mouse', mouse);
    
    // Set up browser event listeners
    this.setupBrowserInputHandlers();
    
    this.kernel.log('Input devices initialized');
  }

  async initializeStorageDevices() {
    // Virtual disk device
    const disk = new VirtualDiskDevice('vda', this);
    this.registerDevice(disk);
    this.createDeviceNode('/dev/vda', disk);
    
    // Memory disk (RAM disk)
    const ramdisk = new RamDiskDevice('ram0', this);
    this.registerDevice(ramdisk);
    this.createDeviceNode('/dev/ram0', ramdisk);
    
    this.kernel.log('Storage devices initialized');
  }

  async initializeNetworkDevices() {
    // Loopback interface
    const loopback = new LoopbackDevice('lo', this);
    this.registerDevice(loopback);
    
    // Virtual ethernet interface
    const ethernet = new VirtualEthernetDevice('eth0', this);
    this.registerDevice(ethernet);
    
    this.kernel.log('Network devices initialized');
  }

  setupBrowserInputHandlers() {
    // Keyboard events
    if (typeof document !== 'undefined') {
      document.addEventListener('keydown', (event) => {
        this.handleKeyboard({
          type: 'keydown',
          key: event.key,
          code: event.code,
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
          shiftKey: event.shiftKey,
          metaKey: event.metaKey,
          timestamp: Date.now()
        });
      });

      document.addEventListener('keyup', (event) => {
        this.handleKeyboard({
          type: 'keyup',
          key: event.key,
          code: event.code,
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
          shiftKey: event.shiftKey,
          metaKey: event.metaKey,
          timestamp: Date.now()
        });
      });

      // Mouse events
      document.addEventListener('mousemove', (event) => {
        this.handleMouse({
          type: 'mousemove',
          x: event.clientX,
          y: event.clientY,
          buttons: event.buttons,
          timestamp: Date.now()
        });
      });

      document.addEventListener('mousedown', (event) => {
        this.handleMouse({
          type: 'mousedown',
          x: event.clientX,
          y: event.clientY,
          button: event.button,
          buttons: event.buttons,
          timestamp: Date.now()
        });
      });

      document.addEventListener('mouseup', (event) => {
        this.handleMouse({
          type: 'mouseup',
          x: event.clientX,
          y: event.clientY,
          button: event.button,
          buttons: event.buttons,
          timestamp: Date.now()
        });
      });
    }
  }

  // Register a device
  registerDevice(device) {
    this.devices.set(device.name, device);
    device.state = this.DEVICE_STATES.ONLINE;
    
    this.kernel.log(`Device registered: ${device.name} (${device.type})`);
    this.kernel.emit('device:registered', device);
  }

  // Unregister a device
  unregisterDevice(deviceName) {
    const device = this.devices.get(deviceName);
    if (device) {
      device.state = this.DEVICE_STATES.OFFLINE;
      this.devices.delete(deviceName);
      
      // Remove device nodes
      for (const [path, dev] of this.deviceNodes) {
        if (dev === device) {
          this.deviceNodes.delete(path);
        }
      }
      
      this.kernel.log(`Device unregistered: ${deviceName}`);
      this.kernel.emit('device:unregistered', device);
    }
  }

  // Create a device node in /dev
  createDeviceNode(path, device) {
    this.deviceNodes.set(path, device);
    this.kernel.log(`Device node created: ${path} -> ${device.name}`);
  }

  // Get device by path
  getDeviceByPath(path) {
    return this.deviceNodes.get(path);
  }

  // Get device by name
  getDevice(name) {
    return this.devices.get(name);
  }

  // Handle keyboard input
  handleKeyboard(keyData) {
    const keyboard = this.getDevice('keyboard');
    if (keyboard) {
      keyboard.handleInput(keyData);
    }
    
    // Don't trigger kernel interrupt to avoid recursion
    // The browser event listeners handle keyboard input directly
  }

  // Handle mouse input
  handleMouse(mouseData) {
    const mouse = this.getDevice('mouse');
    if (mouse) {
      mouse.handleInput(mouseData);
    }
    
    // Don't trigger kernel interrupt to avoid recursion
    // The browser event listeners handle mouse input directly
  }

  // Device I/O operations
  async deviceRead(devicePath, buffer, offset, length) {
    const device = this.getDeviceByPath(devicePath);
    if (!device) {
      throw new Error(`Device not found: ${devicePath}`);
    }
    
    if (device.state !== this.DEVICE_STATES.ONLINE) {
      throw new Error(`Device not available: ${devicePath}`);
    }
    
    return await device.read(buffer, offset, length);
  }

  async deviceWrite(devicePath, buffer, offset, length) {
    const device = this.getDeviceByPath(devicePath);
    if (!device) {
      throw new Error(`Device not found: ${devicePath}`);
    }
    
    if (device.state !== this.DEVICE_STATES.ONLINE) {
      throw new Error(`Device not available: ${devicePath}`);
    }
    
    return await device.write(buffer, offset, length);
  }

  async deviceControl(devicePath, command, data) {
    const device = this.getDeviceByPath(devicePath);
    if (!device) {
      throw new Error(`Device not found: ${devicePath}`);
    }
    
    if (device.control) {
      return await device.control(command, data);
    }
    
    throw new Error(`Device does not support control operations: ${devicePath}`);
  }

  // Get device statistics
  getDeviceStats() {
    const stats = {
      totalDevices: this.devices.size,
      onlineDevices: 0,
      offlineDevices: 0,
      errorDevices: 0,
      devicesByType: {},
      deviceNodes: this.deviceNodes.size
    };
    
    for (const device of this.devices.values()) {
      switch (device.state) {
        case this.DEVICE_STATES.ONLINE:
          stats.onlineDevices++;
          break;
        case this.DEVICE_STATES.OFFLINE:
          stats.offlineDevices++;
          break;
        case this.DEVICE_STATES.ERROR:
          stats.errorDevices++;
          break;
      }
      
      if (!stats.devicesByType[device.type]) {
        stats.devicesByType[device.type] = 0;
      }
      stats.devicesByType[device.type]++;
    }
    
    return stats;
  }

  // List all devices
  listDevices() {
    return Array.from(this.devices.values()).map(device => ({
      name: device.name,
      type: device.type,
      state: device.state,
      description: device.description || 'No description'
    }));
  }

  // List device nodes
  listDeviceNodes() {
    return Array.from(this.deviceNodes.entries()).map(([path, device]) => ({
      path: path,
      device: device.name,
      type: device.type,
      state: device.state
    }));
  }
}

// Base Device class
class Device {
  constructor(name, type, deviceManager) {
    this.name = name;
    this.type = type;
    this.deviceManager = deviceManager;
    this.state = 'offline';
    this.description = '';
  }

  async read(buffer, offset, length) {
    throw new Error('Read operation not supported');
  }

  async write(buffer, offset, length) {
    throw new Error('Write operation not supported');
  }

  async control(command, data) {
    throw new Error('Control operation not supported');
  }
}

// Null Device (/dev/null)
class DevNullDevice extends Device {
  constructor(name, deviceManager) {
    super(name, 'character', deviceManager);
    this.description = 'Null device - discards all writes, returns EOF on reads';
  }

  async read(buffer, offset, length) {
    return 0; // EOF
  }

  async write(buffer, offset, length) {
    return length; // Discard all data
  }
}

// Zero Device (/dev/zero)
class DevZeroDevice extends Device {
  constructor(name, deviceManager) {
    super(name, 'character', deviceManager);
    this.description = 'Zero device - provides infinite stream of null bytes';
  }

  async read(buffer, offset, length) {
    buffer.fill(0, offset, offset + length);
    return length;
  }

  async write(buffer, offset, length) {
    return length; // Accept but ignore writes
  }
}

// Random Device (/dev/random, /dev/urandom)
class DevRandomDevice extends Device {
  constructor(name, deviceManager) {
    super(name, 'character', deviceManager);
    this.description = 'Random number generator device';
  }

  async read(buffer, offset, length) {
    for (let i = 0; i < length; i++) {
      buffer[offset + i] = Math.floor(Math.random() * 256);
    }
    return length;
  }

  async write(buffer, offset, length) {
    // In real systems, this would add entropy to the random pool
    return length;
  }
}

// Full Device (/dev/full)
class FullDevice extends Device {
  constructor(name, deviceManager) {
    super(name, 'character', deviceManager);
    this.description = 'Full device - always returns ENOSPC on writes';
  }

  async read(buffer, offset, length) {
    buffer.fill(0, offset, offset + length);
    return length;
  }

  async write(buffer, offset, length) {
    throw new Error('ENOSPC: No space left on device');
  }
}

// Keyboard Device
class KeyboardDevice extends Device {
  constructor(name, deviceManager) {
    super(name, 'input', deviceManager);
    this.description = 'Keyboard input device';
    this.inputBuffer = [];
    this.maxBufferSize = 1024;
  }

  handleInput(keyData) {
    if (this.inputBuffer.length < this.maxBufferSize) {
      this.inputBuffer.push(keyData);
    }
  }

  async read(buffer, offset, length) {
    if (this.inputBuffer.length === 0) {
      return 0; // No data available
    }
    
    const data = this.inputBuffer.shift();
    const jsonData = JSON.stringify(data);
    const bytes = new TextEncoder().encode(jsonData);
    
    const bytesToCopy = Math.min(length, bytes.length);
    buffer.set(bytes.subarray(0, bytesToCopy), offset);
    
    return bytesToCopy;
  }
}

// Mouse Device
class MouseDevice extends Device {
  constructor(name, deviceManager) {
    super(name, 'input', deviceManager);
    this.description = 'Mouse input device';
    this.inputBuffer = [];
    this.maxBufferSize = 1024;
  }

  handleInput(mouseData) {
    if (this.inputBuffer.length < this.maxBufferSize) {
      this.inputBuffer.push(mouseData);
    }
  }

  async read(buffer, offset, length) {
    if (this.inputBuffer.length === 0) {
      return 0;
    }
    
    const data = this.inputBuffer.shift();
    const jsonData = JSON.stringify(data);
    const bytes = new TextEncoder().encode(jsonData);
    
    const bytesToCopy = Math.min(length, bytes.length);
    buffer.set(bytes.subarray(0, bytesToCopy), offset);
    
    return bytesToCopy;
  }
}

// Virtual Disk Device
class VirtualDiskDevice extends Device {
  constructor(name, deviceManager) {
    super(name, 'block', deviceManager);
    this.description = 'Virtual disk device';
    this.blockSize = 512;
    this.totalBlocks = 1024 * 1024; // 512MB
    this.storage = new ArrayBuffer(this.totalBlocks * this.blockSize);
  }

  async read(buffer, offset, length) {
    const view = new Uint8Array(this.storage);
    const bytesToRead = Math.min(length, view.length - offset);
    
    if (bytesToRead > 0) {
      buffer.set(view.subarray(offset, offset + bytesToRead), 0);
    }
    
    return bytesToRead;
  }

  async write(buffer, offset, length) {
    const view = new Uint8Array(this.storage);
    const bytesToWrite = Math.min(length, view.length - offset);
    
    if (bytesToWrite > 0) {
      view.set(buffer.subarray(0, bytesToWrite), offset);
    }
    
    return bytesToWrite;
  }
}

// RAM Disk Device
class RamDiskDevice extends Device {
  constructor(name, deviceManager) {
    super(name, 'block', deviceManager);
    this.description = 'RAM disk device';
    this.storage = new Map(); // Block number -> data
    this.blockSize = 4096;
  }

  async read(buffer, offset, length) {
    const blockNum = Math.floor(offset / this.blockSize);
    const blockOffset = offset % this.blockSize;
    
    const blockData = this.storage.get(blockNum);
    if (!blockData) {
      buffer.fill(0, 0, length);
      return length;
    }
    
    const bytesToRead = Math.min(length, blockData.length - blockOffset);
    buffer.set(blockData.subarray(blockOffset, blockOffset + bytesToRead), 0);
    
    return bytesToRead;
  }

  async write(buffer, offset, length) {
    const blockNum = Math.floor(offset / this.blockSize);
    const blockOffset = offset % this.blockSize;
    
    let blockData = this.storage.get(blockNum);
    if (!blockData) {
      blockData = new Uint8Array(this.blockSize);
      this.storage.set(blockNum, blockData);
    }
    
    const bytesToWrite = Math.min(length, blockData.length - blockOffset);
    blockData.set(buffer.subarray(0, bytesToWrite), blockOffset);
    
    return bytesToWrite;
  }
}

// Loopback Network Device
class LoopbackDevice extends Device {
  constructor(name, deviceManager) {
    super(name, 'network', deviceManager);
    this.description = 'Loopback network interface';
    this.mtu = 65536;
    this.address = '127.0.0.1';
  }
}

// Virtual Ethernet Device
class VirtualEthernetDevice extends Device {
  constructor(name, deviceManager) {
    super(name, 'network', deviceManager);
    this.description = 'Virtual ethernet interface';
    this.mtu = 1500;
    this.address = '192.168.1.100';
    this.macAddress = '02:00:00:00:00:01';
  }
}

// Network Manager placeholder
class NetworkManager {
  constructor(kernel) {
    this.kernel = kernel;
  }

  async initialize() {
    this.kernel.log('Network Manager initializing');
  }

  createSocket() { return 1; }
  bind() { return 0; }
  listen() { return 0; }
  accept() { return 1; }
  connect() { return 0; }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DeviceManager, NetworkManager };
} else if (typeof window !== 'undefined') {
  window.DeviceManager = DeviceManager;
  window.NetworkManager = NetworkManager;
}

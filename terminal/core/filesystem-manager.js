// File System Manager for Heyming OS
import { ShellCore } from '../lib/shell-core.js';

export class FileSystemManager {
  constructor(kernel) {
    this.kernel = kernel;
    this.fileSystemDB = null;
    this.openFiles = new Map(); // fd -> file handle
    this.mountPoints = new Map();
    this.nextFD = 1000; // Start high to avoid conflicts with process FDs

    // File system types
    this.FS_TYPES = {
      HEYMINGFS: 'heymingfs',
      TMPFS: 'tmpfs',
      PROCFS: 'procfs',
      DEVFS: 'devfs'
    };

    // File types
    this.FILE_TYPES = {
      REGULAR: 'file',
      DIRECTORY: 'directory',
      SYMLINK: 'symlink',
      DEVICE: 'device',
      PIPE: 'pipe',
      SOCKET: 'socket'
    };

    // File permissions
    this.PERMISSIONS = {
      READ: 0o444,
      WRITE: 0o222,
      EXECUTE: 0o111,
      USER_ALL: 0o700,
      GROUP_ALL: 0o070,
      OTHER_ALL: 0o007,
      DEFAULT_FILE: 0o644,
      DEFAULT_DIR: 0o755
    };
  }

  async initialize() {
    this.kernel.log('File System Manager initializing');

    // Initialize the main file system
    if (!window.FileSystemDB) {
      throw new Error('FileSystemDB not loaded. Make sure filesystem-db.js is included.');
    }
    this.fileSystemDB = await window.FileSystemDB.getInstance();

    // Create default mount points
    await this.setupMountPoints();

    // Initialize virtual file systems
    await this.initializeVirtualFS();
  }

  async setupMountPoints() {
    // Root file system
    this.mountPoints.set('/', {
      type: this.FS_TYPES.HEYMINGFS,
      device: this.fileSystemDB,
      options: { rw: true }
    });

    // Note: /tmp is now part of the root filesystem instead of separate mount

    // Process file system
    this.mountPoints.set('/proc', {
      type: this.FS_TYPES.PROCFS,
      device: new ProcFS(this.kernel),
      options: { ro: true }
    });

    // Device file system
    this.mountPoints.set('/dev', {
      type: this.FS_TYPES.DEVFS,
      device: new DevFS(this.kernel),
      options: { rw: true }
    });

    this.kernel.log('Mount points initialized');
  }

  async initializeVirtualFS() {
    // Initialize each virtual file system
    for (const [mountPoint, mount] of this.mountPoints) {
      if (mount.device.initialize) {
        await mount.device.initialize();
      }
    }
  }

  // Resolve path to appropriate file system
  resolvePath(path) {
    // Normalize path
    path = this.normalizePath(path);

    // Find the longest matching mount point
    let bestMatch = '/';
    let bestLength = 1;

    for (const mountPoint of this.mountPoints.keys()) {
      if (path.startsWith(mountPoint) && mountPoint.length > bestLength) {
        // Ensure match is on a path boundary, not a substring
        // (e.g. /proc must not match /process, /dev must not match /device)
        const nextChar = path[mountPoint.length];
        if (mountPoint === '/' || nextChar === undefined || nextChar === '/') {
          bestMatch = mountPoint;
          bestLength = mountPoint.length;
        }
      }
    }

    const mount = this.mountPoints.get(bestMatch);
    let relativePath = path.substring(bestLength) || '/';

    // Ensure relativePath starts with / for root filesystem
    if (bestMatch === '/' && !relativePath.startsWith('/')) {
      relativePath = '/' + relativePath;
    }

    return { mount, relativePath, absolutePath: path };
  }

  // Normalize path (resolve .., ., etc.) — same semantics as Terminal.resolvePath / FileSystemDB keys
  normalizePath(path) {
    const currentProcess = this.kernel.processManager.currentProcess;
    const cwd = currentProcess ? currentProcess.cwd : '/';
    return ShellCore.resolveVirtualPath(path, cwd);
  }

  // Open a file
  async open(path, flags = 'r', mode = this.PERMISSIONS.DEFAULT_FILE) {
    const { mount, relativePath } = this.resolvePath(path);

    // Check permissions
    const currentProcess = this.kernel.processManager.currentProcess;
    if (!(await this.checkPermissions(path, flags, currentProcess))) {
      throw new Error('Permission denied');
    }

    // Open file through appropriate file system
    const fileHandle = await mount.device.open(relativePath, flags, mode);

    // Allocate system-wide file descriptor
    const fd = this.nextFD++;
    this.openFiles.set(fd, {
      handle: fileHandle,
      mount: mount,
      path: path,
      flags: flags,
      position: 0
    });

    this.kernel.log(`File opened: ${path} (FD ${fd})`);
    return fd;
  }

  // Close a file
  async close(fd) {
    const file = this.openFiles.get(fd);
    if (!file) {
      throw new Error(`Invalid file descriptor: ${fd}`);
    }

    // Close through file system
    if (file.handle.close) {
      await file.handle.close();
    }

    this.openFiles.delete(fd);
    this.kernel.log(`File closed: FD ${fd}`);
    return 0;
  }

  // Read from file
  async read(fd, buffer, offset = 0, length = buffer.length, position = null) {
    const file = this.openFiles.get(fd);
    if (!file) {
      throw new Error(`Invalid file descriptor: ${fd}`);
    }

    if (!file.flags.includes('r')) {
      throw new Error('File not open for reading');
    }

    const readPosition = position !== null ? position : file.position;
    const bytesRead = await file.handle.read(buffer, offset, length, readPosition);

    if (position === null) {
      file.position += bytesRead;
    }

    return bytesRead;
  }

  // Write to file
  async write(fd, buffer, offset = 0, length = buffer.length, position = null) {
    const file = this.openFiles.get(fd);
    if (!file) {
      throw new Error(`Invalid file descriptor: ${fd}`);
    }

    if (!file.flags.includes('w') && !file.flags.includes('a')) {
      throw new Error('File not open for writing');
    }

    const writePosition = position !== null ? position : file.position;
    const bytesWritten = await file.handle.write(buffer, offset, length, writePosition);

    if (position === null) {
      file.position += bytesWritten;
    }

    return bytesWritten;
  }

  // Get file statistics
  async stat(path) {
    const { mount, relativePath } = this.resolvePath(path);

    // Check if file exists and get stats
    const stats = await mount.device.stat(relativePath);
    if (!stats) {
      throw new Error(`File not found: ${path}`);
    }

    return {
      ...stats,
      path: path,
      mount: mount.type
    };
  }

  // Read directory contents
  async readdir(path) {
    const { mount, relativePath } = this.resolvePath(path);

    // Check if directory exists and get stats
    const stats = await mount.device.stat(relativePath);
    if (!stats) {
      throw new Error(`Directory not found: ${path}`);
    }

    if (stats.type !== 'directory') {
      throw new Error(`Not a directory: ${path}`);
    }

    // Check read permissions
    const currentProcess = this.kernel.processManager.currentProcess;
    if (!(await this.checkPermissions(path, 'r', currentProcess))) {
      throw new Error('Permission denied');
    }

    // Get directory contents from the device
    if (mount.device.readdir) {
      const entries = await mount.device.readdir(relativePath);
      return entries.map((entry) => ({
        ...entry,
        path: path === '/' ? `/${entry.name}` : `${path}/${entry.name}`
      }));
    } else {
      // Fallback for devices that don't implement readdir
      return [];
    }
  }

  // Create directory
  async mkdir(path, mode = this.PERMISSIONS.DEFAULT_DIR) {
    const { mount, relativePath } = this.resolvePath(path);

    // Check permissions
    const currentProcess = this.kernel.processManager.currentProcess;
    if (!(await this.checkPermissions(path, 'w', currentProcess))) {
      throw new Error('Permission denied');
    }

    await mount.device.mkdir(relativePath, mode);
    this.kernel.log(`Directory created: ${path}`);
    return 0;
  }

  // Remove directory
  async rmdir(path) {
    const { mount, relativePath } = this.resolvePath(path);

    // Check permissions
    const currentProcess = this.kernel.processManager.currentProcess;
    if (!(await this.checkPermissions(path, 'w', currentProcess))) {
      throw new Error('Permission denied');
    }

    await mount.device.rmdir(relativePath);
    this.kernel.log(`Directory removed: ${path}`);
    return 0;
  }

  // Remove file
  async unlink(path) {
    const { mount, relativePath } = this.resolvePath(path);

    // Check permissions
    const currentProcess = this.kernel.processManager.currentProcess;
    if (!(await this.checkPermissions(path, 'w', currentProcess))) {
      throw new Error('Permission denied');
    }

    await mount.device.unlink(relativePath);
    this.kernel.log(`File removed: ${path}`);
    return 0;
  }

  // Check file permissions
  async checkPermissions(path, operation, process) {
    if (!process) {
      return false;
    }

    // Root can do anything
    if (process.uid === 0) {
      return true;
    }

    try {
      const stats = await this.stat(path);
      const mode = stats.mode || this.PERMISSIONS.DEFAULT_FILE;

      // Check user permissions
      if (process.uid === stats.uid) {
        if (operation.includes('r') && !(mode & 0o400)) return false;
        if (operation.includes('w') && !(mode & 0o200)) return false;
        if (operation.includes('x') && !(mode & 0o100)) return false;
        return true;
      }

      // Check group permissions
      if (process.gid === stats.gid) {
        if (operation.includes('r') && !(mode & 0o040)) return false;
        if (operation.includes('w') && !(mode & 0o020)) return false;
        if (operation.includes('x') && !(mode & 0o010)) return false;
        return true;
      }

      // Check other permissions
      if (operation.includes('r') && !(mode & 0o004)) return false;
      if (operation.includes('w') && !(mode & 0o002)) return false;
      if (operation.includes('x') && !(mode & 0o001)) return false;

      return true;
    } catch (error) {
      // File doesn't exist - check parent directory permissions for creation
      const parentPath = path.substring(0, path.lastIndexOf('/')) || '/';
      return await this.checkPermissions(parentPath, 'w', process);
    }
  }

  // Sync all file systems
  async sync() {
    this.kernel.log('Syncing all file systems');

    for (const [mountPoint, mount] of this.mountPoints) {
      if (mount.device.sync) {
        await mount.device.sync();
      }
    }
  }

  // Get file system statistics
  getStats() {
    const stats = {
      mountPoints: this.mountPoints.size,
      openFiles: this.openFiles.size,
      fileSystems: {}
    };

    for (const [mountPoint, mount] of this.mountPoints) {
      if (mount.device.getStats) {
        stats.fileSystems[mountPoint] = mount.device.getStats();
      }
    }

    return stats;
  }
}

// Temporary File System (in-memory)
class TmpFS {
  constructor() {
    this.files = new Map();
    this.directories = new Set(['/']);
  }

  async initialize() {
    // Nothing to initialize for in-memory FS
  }

  async open(path, flags, mode) {
    if (!this.files.has(path) && flags.includes('w')) {
      // Create new file
      this.files.set(path, {
        content: new Uint8Array(0),
        mode: mode,
        uid: 1000,
        gid: 1000,
        atime: Date.now(),
        mtime: Date.now(),
        ctime: Date.now()
      });
    }

    const file = this.files.get(path);
    if (!file) {
      throw new Error('File not found');
    }

    return new TmpFileHandle(file, flags);
  }

  async stat(path) {
    const file = this.files.get(path);
    if (file) {
      return {
        type: 'file',
        size: file.content.length,
        mode: file.mode,
        uid: file.uid,
        gid: file.gid,
        atime: file.atime,
        mtime: file.mtime,
        ctime: file.ctime
      };
    }

    if (this.directories.has(path)) {
      return {
        type: 'directory',
        mode: 0o755,
        uid: 1000,
        gid: 1000,
        atime: Date.now(),
        mtime: Date.now(),
        ctime: Date.now()
      };
    }

    return null;
  }

  async mkdir(path, mode) {
    this.directories.add(path);
  }

  async rmdir(path) {
    this.directories.delete(path);
  }

  async unlink(path) {
    this.files.delete(path);
  }
}

// Temporary file handle
class TmpFileHandle {
  constructor(file, flags) {
    this.file = file;
    this.flags = flags;
  }

  async read(buffer, offset, length, position) {
    const start = Math.min(position, this.file.content.length);
    const end = Math.min(position + length, this.file.content.length);
    const bytesToRead = end - start;

    if (bytesToRead > 0) {
      buffer.set(this.file.content.subarray(start, end), offset);
    }

    this.file.atime = Date.now();
    return bytesToRead;
  }

  async write(buffer, offset, length, position) {
    const writeData = buffer.subarray(offset, offset + length);

    if (position + length > this.file.content.length) {
      // Expand file
      const newContent = new Uint8Array(position + length);
      newContent.set(this.file.content);
      this.file.content = newContent;
    }

    this.file.content.set(writeData, position);
    this.file.mtime = Date.now();

    return length;
  }
}

// Process File System (virtual)
class ProcFS {
  constructor(kernel) {
    this.kernel = kernel;
  }

  async initialize() {
    // Virtual FS - nothing to initialize
  }

  async open(path, flags, mode) {
    return new ProcFileHandle(this.kernel, path, flags);
  }

  async stat(path) {
    // All proc files are virtual
    return {
      type: 'file',
      size: 0,
      mode: 0o444,
      uid: 0,
      gid: 0,
      atime: Date.now(),
      mtime: Date.now(),
      ctime: Date.now()
    };
  }

  async mkdir() {
    throw new Error('Cannot create directories in /proc');
  }
  async rmdir() {
    throw new Error('Cannot remove directories in /proc');
  }
  async unlink() {
    throw new Error('Cannot remove files in /proc');
  }
}

// Process file handle
class ProcFileHandle {
  constructor(kernel, path, flags) {
    this.kernel = kernel;
    this.path = path;
    this.flags = flags;
  }

  async read(buffer, offset, length, position) {
    const content = this.generateContent();
    const data = new TextEncoder().encode(content);

    const start = Math.min(position, data.length);
    const end = Math.min(position + length, data.length);
    const bytesToRead = end - start;

    if (bytesToRead > 0) {
      buffer.set(data.subarray(start, end), offset);
    }

    return bytesToRead;
  }

  async write() {
    throw new Error('Cannot write to /proc files');
  }

  generateContent() {
    if (this.path === '/cpuinfo') {
      return 'processor\t: 0\nvendor_id\t: HeymingCorp\nmodel name\t: Heyming Virtual CPU\n';
    } else if (this.path === '/meminfo') {
      const memStats = this.kernel.memoryManager.getUsageStats();
      return `MemTotal: ${memStats.total} kB\nMemFree: ${memStats.free} kB\n`;
    } else if (this.path === '/version') {
      return `Heyming OS version ${this.kernel.version}\n`;
    }

    return 'Virtual file content\n';
  }
}

// Device File System
class DevFS {
  constructor(kernel) {
    this.kernel = kernel;
    this.devices = new Map();
  }

  async initialize() {
    // Create standard devices
    this.devices.set('/null', new NullDevice());
    this.devices.set('/zero', new ZeroDevice());
    this.devices.set('/random', new RandomDevice());
    this.devices.set('/urandom', new RandomDevice());
  }

  async open(path, flags, mode) {
    const device = this.devices.get(path);
    if (!device) {
      throw new Error('Device not found');
    }

    return device.open(flags);
  }

  async stat(path) {
    if (this.devices.has(path)) {
      return {
        type: 'device',
        mode: 0o666,
        uid: 0,
        gid: 0,
        atime: Date.now(),
        mtime: Date.now(),
        ctime: Date.now()
      };
    }
    return null;
  }

  async mkdir() {
    throw new Error('Cannot create directories in /dev');
  }
  async rmdir() {
    throw new Error('Cannot remove directories in /dev');
  }
  async unlink() {
    throw new Error('Cannot remove devices in /dev');
  }
}

// Device implementations
class NullDevice {
  open(flags) {
    return this;
  }
  async read() {
    return 0;
  }
  async write(buffer, offset, length) {
    return length;
  }
}

class ZeroDevice {
  open(flags) {
    return this;
  }
  async read(buffer, offset, length) {
    buffer.fill(0, offset, offset + length);
    return length;
  }
  async write(buffer, offset, length) {
    return length;
  }
}

class RandomDevice {
  open(flags) {
    return this;
  }
  async read(buffer, offset, length) {
    for (let i = 0; i < length; i++) {
      buffer[offset + i] = Math.floor(Math.random() * 256);
    }
    return length;
  }
  async write(buffer, offset, length) {
    return length;
  }
}

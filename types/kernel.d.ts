/**
 * Type declarations for the Heyming OS kernel subsystems.
 *
 * Classes like HeymingKernel, ProcessManager, FileSystemManager, etc. are
 * defined in the JS files themselves. This file only declares supplementary
 * interfaces and types that JS files can reference via JSDoc.
 */

// ---------------------------------------------------------------------------
// POSIX constants
// ---------------------------------------------------------------------------

interface PosixOpenFlags {
  O_RDONLY: 0;
  O_WRONLY: 1;
  O_RDWR: 2;
  O_CREAT: 64;
  O_EXCL: 128;
  O_TRUNC: 512;
  O_APPEND: 1024;
}

interface PosixAccessModes {
  F_OK: 0;
  R_OK: 4;
  W_OK: 2;
  X_OK: 1;
}

interface PosixSeekWhence {
  SEEK_SET: 0;
  SEEK_CUR: 1;
  SEEK_END: 2;
}

interface PosixExitCodes {
  EXIT_SUCCESS: 0;
  EXIT_FAILURE: 1;
  EXIT_USAGE: 2;
  EXIT_NOEXEC: 126;
  EXIT_NOTFOUND: 127;
}

interface PosixErrno {
  EPERM: 1;
  ENOENT: 2;
  ESRCH: 3;
  EINTR: 4;
  EIO: 5;
  ENOEXEC: 8;
  EBADF: 9;
  ECHILD: 10;
  EAGAIN: 11;
  ENOMEM: 12;
  EACCES: 13;
  EEXIST: 17;
  ENOTDIR: 20;
  EISDIR: 21;
  EINVAL: 22;
  EMFILE: 24;
  ENOSPC: 28;
  EROFS: 30;
  EPIPE: 32;
  ENOSYS: 38;
  ENOTEMPTY: 39;
  ELOOP: 40;
}

// ---------------------------------------------------------------------------
// POSIX stat result (returned by stat/lstat/fstat)
// ---------------------------------------------------------------------------

interface StatResult {
  dev: number;
  ino: number;
  mode: number;
  nlink: number;
  uid: number;
  gid: number;
  size: number;
  atime: number;
  mtime: number;
  ctime: number;
  type: string;
  path?: string;
  name?: string;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

// ---------------------------------------------------------------------------
// POSIX wait result (returned by waitpid)
// ---------------------------------------------------------------------------

interface WaitResult {
  pid: number;
  status: number;
  exitCode: number;
  signaled: boolean;
  signal?: string;
}

// ---------------------------------------------------------------------------
// File descriptor entry in a per-process fd table
// ---------------------------------------------------------------------------

interface FDEntry {
  type: 'file' | 'pipe_read' | 'pipe_write' | 'stdin' | 'stdout' | 'stderr' | 'device';
  handle?: FileHandle;
  mount?: MountInfo;
  path?: string;
  flags?: number;
  position?: number;
  pipeId?: number;
  buffer?: string;
}

// ---------------------------------------------------------------------------
// POSIX syscall table — the complete set of syscalls the kernel should expose.
// Unimplemented syscalls throw ENOSYS.
// ---------------------------------------------------------------------------

interface PosixSyscallTable {
  // File operations (fd-based)
  open(path: string, flags: number, mode?: number): Promise<number>;
  close(fd: number): Promise<number>;
  read(fd: number, buf: Uint8Array, offset: number, length: number, position?: number | null): Promise<number>;
  write(fd: number, buf: Uint8Array, offset: number, length: number, position?: number | null): Promise<number>;
  lseek(fd: number, offset: number, whence: number): Promise<number>;
  dup(oldfd: number): Promise<number>;
  dup2(oldfd: number, newfd: number): Promise<number>;
  pipe(): Promise<[number, number]>;
  fcntl(fd: number, cmd: number, arg?: number): Promise<number>;

  // File metadata
  stat(path: string): Promise<StatResult>;
  lstat(path: string): Promise<StatResult>;
  fstat(fd: number): Promise<StatResult>;
  access(path: string, mode: number): Promise<number>;
  chmod(path: string, mode: number): Promise<number>;
  chown(path: string, uid: number, gid: number): Promise<number>;

  // Directory
  mkdir(path: string, mode?: number): Promise<number>;
  rmdir(path: string): Promise<number>;
  readdir(path: string): Promise<DirEntry[]>;

  // File manipulation
  unlink(path: string): Promise<number>;
  link(oldpath: string, newpath: string): Promise<number>;
  symlink(target: string, linkpath: string): Promise<number>;
  rename(oldpath: string, newpath: string): Promise<number>;
  readlink(path: string): Promise<string>;

  // Process management
  getpid(): number;
  getppid(): number;
  getuid(): number;
  getgid(): number;
  setuid(uid: number): Promise<number>;
  setgid(gid: number): Promise<number>;
  fork(): Promise<number>;
  execve(path: string, argv: string[], envp: string[]): Promise<never>;
  waitpid(pid: number, options: number): Promise<WaitResult>;
  _exit(status: number): void;
  kill(pid: number, sig: number): Promise<number>;

  // Higher-level convenience (libc-style, built on the primitives above)
  readFileContents(path: string): Promise<string>;
  writeFileContents(path: string, data: string): Promise<void>;
  copyFile(src: string, dest: string): Promise<void>;
  listDirectory(path: string): Promise<Array<DirEntry & { stat: StatResult }>>;
}

// ---------------------------------------------------------------------------
// Process Manager types
// ---------------------------------------------------------------------------

interface ProcessStates {
  CREATED: 'created';
  READY: 'ready';
  RUNNING: 'running';
  BLOCKED: 'blocked';
  STOPPED: 'stopped';
  TERMINATED: 'terminated';
  ZOMBIE: 'zombie';
}

interface Signals {
  SIGTERM: 'SIGTERM';
  SIGKILL: 'SIGKILL';
  SIGINT: 'SIGINT';
  SIGSTOP: 'SIGSTOP';
  SIGCONT: 'SIGCONT';
  SIGCHLD: 'SIGCHLD';
}

interface SignalNumbers {
  SIGTERM: 15;
  SIGKILL: 9;
  SIGINT: 2;
  SIGSTOP: 19;
  SIGCONT: 18;
  SIGCHLD: 17;
}

interface ProcessLimits {
  memory: number;
  cpuTime: number;
  fileDescriptors: number;
  processes: number;
}

interface ProcessInfo {
  pid: number;
  pgid: number;
  name: string;
  executable: string | null;
  args: string[];
  env: Record<string, string>;
  cwd: string;
  parentPID: number;
  uid: number;
  gid: number;
  priority: number;
  state: string;
  startTime: number;
  cpuTime: number;
  memoryUsage: number;
  limits: ProcessLimits;
  isolated: boolean;
  children: Set<number>;
  fileDescriptors: Map<number, unknown>;
  exitCode?: number;
  exitTime?: number;
}

interface CreateProcessOptions {
  name?: string;
  executable?: string | null;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  parentPID?: number;
  uid?: number;
  gid?: number;
  pgid?: number;
  priority?: number;
  limits?: Partial<ProcessLimits>;
  isolated?: boolean;
}

interface ResourceUsage {
  memoryUsed: number;
  memoryLimit: number;
  cpuTimeUsed: number;
  cpuTimeLimit: number;
  state: string;
}

// ---------------------------------------------------------------------------
// File System Manager types
// ---------------------------------------------------------------------------

interface FSTypes {
  HEYMINGFS: 'heymingfs';
  TMPFS: 'tmpfs';
  PROCFS: 'procfs';
  DEVFS: 'devfs';
}

interface FileTypes {
  REGULAR: 'file';
  DIRECTORY: 'directory';
  SYMLINK: 'symlink';
  DEVICE: 'device';
  PIPE: 'pipe';
  SOCKET: 'socket';
}

interface FSPermissions {
  READ: number;
  WRITE: number;
  EXECUTE: number;
  USER_ALL: number;
  GROUP_ALL: number;
  OTHER_ALL: number;
  DEFAULT_FILE: number;
  DEFAULT_DIR: number;
}

interface MountInfo {
  type: string;
  device: VirtualFileSystem;
  options: Record<string, boolean>;
}

interface ResolvedPath {
  mount: MountInfo;
  relativePath: string;
  absolutePath: string;
}

interface OpenFileInfo {
  handle: FileHandle;
  mount: MountInfo;
  path: string;
  flags: string;
  position: number;
}

interface FileStat {
  type: string;
  size?: number;
  mode?: number;
  uid?: number;
  gid?: number;
  atime?: number;
  mtime?: number;
  ctime?: number;
  path?: string;
  mount?: string;
  name?: string;
  [key: string]: unknown;
}

interface DirEntry {
  name: string;
  path?: string;
  type?: string;
  [key: string]: unknown;
}

interface FSStats {
  mountPoints: number;
  openFiles: number;
  fileSystems: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Virtual file system interface (ProcFS, DevFS, TmpFS, FileSystemDB)
// ---------------------------------------------------------------------------

interface VirtualFileSystem {
  initialize?(): Promise<void>;
  open?(path: string, flags: string, mode: number): Promise<FileHandle>;
  stat?(path: string): Promise<FileStat | null>;
  readdir?(path: string): Promise<DirEntry[]>;
  mkdir?(path: string, mode?: number): Promise<void>;
  rmdir?(path: string): Promise<void>;
  unlink?(path: string): Promise<void>;
  sync?(): Promise<void>;
  getStats?(): unknown;
}

interface FileHandle {
  read?(buffer: Uint8Array, offset: number, length: number, position: number): Promise<number>;
  write?(buffer: Uint8Array, offset: number, length: number, position: number): Promise<number>;
  close?(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Memory Manager types
// ---------------------------------------------------------------------------

interface MemoryUsageStats {
  total: number;
  free: number;
  used: number;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Kernel types
// ---------------------------------------------------------------------------

interface KernelLogEntry {
  timestamp: string;
  level: string;
  message: string;
  uptime: number;
}

interface KernelSystemInfo {
  version: string;
  bootTime: number;
  uptime: number;
  isInitialized: boolean;
  processCount: number;
  memoryUsage: MemoryUsageStats | null;
  fileSystemStats: FSStats | null;
}

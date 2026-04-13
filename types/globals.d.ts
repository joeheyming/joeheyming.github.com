/**
 * Window augmentations for browser globals used throughout the codebase.
 * Classes are loaded via <script> tags and assigned to window.
 *
 * The actual class definitions live in .js files — this file only augments
 * the Window interface so TypeScript knows about the global assignments.
 */

interface HeymingOSConfig {
  USER: string;
  HOME: string;
  HOSTNAME?: string;
  DEBUG?: boolean;
  DESKTOP?: string;
  DOCUMENTS?: string;
  DOWNLOADS?: string;
  PICTURES?: string;
  MUSIC?: string;
  VIDEOS?: string;
  getQuickAccess?(): Array<{ name: string; path: string; icon: string }>;
}

interface HeymingOSNamespace {
  Config?: HeymingOSConfig;
  Constants?: unknown;
  MessageTypes?: unknown;
  IframeActions?: unknown;
  Icons?: typeof import("../os/Icons").Icons;
  InputHandler?: typeof import("../os/InputHandler").InputHandler;
  DragService?: typeof import("../os/DragService").DragService;
  ClipboardService?: typeof import("../os/ClipboardService").ClipboardService;
  FileOperationService?: typeof import("../os/FileOperationService").FileOperationService;
  QuickLookPreview?: typeof import("../os/QuickLookPreview").QuickLookPreview;
  FileSystemDB?: typeof FileSystemDB;
  WindowManager?: typeof import("../os/WindowManager").WindowManager;
  Taskbar?: typeof import("../os/Taskbar").Taskbar;
  NotificationService?: typeof import("../os/NotificationService").NotificationService;
  Launcher?: typeof import("../os/Launcher").Launcher;
  Desktop?: typeof import("../os/Desktop").Desktop;
  Clock?: typeof import("../os/Clock").Clock;
  ContextMenu?: typeof import("../os/ContextMenu").ContextMenu;
  FileDialog?: typeof import("../os/FileDialog").FileDialog;
  HeymingOS?: typeof import("../os/HeymingOS").HeymingOS;
  instance?: HeymingOS;
  debug?: (...args: unknown[]) => void;
  getConfig?: typeof import("../os/config.js").getConfig;
}

interface Window {
  // Kernel and subsystem constructors (set by script tags in terminal/index.html)
  HeymingKernel: typeof HeymingKernel;
  ProcessManager: typeof ProcessManager;
  FileSystemManager: typeof FileSystemManager;
  MemoryManager: typeof MemoryManager;
  IPCManager: typeof IPCManager;
  DeviceManager: typeof DeviceManager;
  SchedulerManager: typeof SchedulerManager;
  SecurityManager: typeof SecurityManager;
  NetworkManager: typeof NetworkManager;

  // Terminal layer
  Terminal: typeof Terminal;
  HeymingOS: HeymingOSNamespace;
  heymingOS: HeymingOS;
  commandRegistry: CommandRegistry;
  registerCommand: (name: string, handler: CommandHandler, description?: string, category?: string) => void;
  addCommandLoadPromise: (promise: Promise<unknown>) => void;

  // Shared filesystem
  FileSystemDB: typeof FileSystemDB;

  AwkLib: typeof AwkLib;
  BasenameLib: typeof BasenameLib;
  BuiltinsLib: typeof BuiltinsLib;
  CatLib: typeof CatLib;
  ChmodLib: typeof ChmodLib;
  CsplitLib: typeof CsplitLib;
  CutLib: typeof CutLib;
  DateLib: typeof DateLib;
  EchoLib: typeof EchoLib;
  EnvLib: typeof EnvLib;
  ExpandLib: typeof ExpandLib;
  FileopsLib: typeof FileopsLib;
  FoldLib: typeof FoldLib;
  FmtLib: typeof FmtLib;
  GrepLib: typeof GrepLib;
  JoinLib: typeof JoinLib;
  LessLib: typeof LessLib;
  LinesLib: typeof LinesLib;
  LnLib: typeof LnLib;
  LsLib: typeof LsLib;
  MkdirLib: typeof MkdirLib;
  NlLib: typeof NlLib;
  PasteLib: typeof PasteLib;
  PrintfLib: typeof PrintfLib;
  PwdLib: typeof PwdLib;
  ReadlinkLib: typeof ReadlinkLib;
  SedLib: typeof SedLib;
  SeqLib: typeof SeqLib;
  SleepLib: typeof SleepLib;
  SortLib: typeof SortLib;
  SplitLib: typeof SplitLib;
  StatLib: typeof StatLib;
  TeeLib: typeof TeeLib;
  TestLib: typeof TestLib;
  TouchLib: typeof TouchLib;
  TrLib: typeof TrLib;
  UniqLib: typeof UniqLib;
  WcLib: typeof WcLib;
  XargsLib: typeof XargsLib;

  // Dynamic runtime properties set by various subsystems
  npmRegistry: NpmRegistry;
  AppModule: AppModuleStatic;
  /** App list filter UI (`app.js`); has `.create()`, not `{ type, value }`. */
  AppFilter: AppFilterWidget;
  proxyService: ProxyService;
  /** In-memory VFS mirror for sync Node shims ({@link terminal/commands/system/node.js}). */
  _vfsSyncCache: { files: Map<string, string>; dirs: Map<string, string[]> };
  _fileSystemListeners: Record<string, Array<(path: string, details?: FileSystemEventDetails) => void>>;
  _fileSystemDBInstance: FileSystemDB;

  // Git integration globals (terminal/lib/jsh-git-*.js)
  __jshIsoGit: unknown;
  createBoundedGitCache: () => unknown;
  createJshGitFs: (...args: unknown[]) => unknown;
  createJshGitHttp: (...args: unknown[]) => unknown;
  clearGitCache: (cache?: unknown) => void;
  fileCache: Map<string, unknown>;
  /** Debug flag or trace function (see `jsh-git-http.js` / `git.js`). */
  jshGitTrace: boolean | ((...args: unknown[]) => void);
  JSH_GIT_CORS_PROXY: string;
  JSH_GIT_MAX_PACK_BYTES: number;
  JSH_GIT_TOKEN: string;

  // Timing
  startTime: number;
}

// ---------------------------------------------------------------------------
// Globals assigned via window.X = ... that commands reference without window.
// ---------------------------------------------------------------------------

/**
 * Global helper exposed by commands.js (window.registerCommand) for command
 * scripts to register themselves.
 */
declare function registerCommand(
  name: string,
  handler: CommandHandler,
  description?: string,
  category?: string
): void;

declare function addCommandLoadPromise(promise: Promise<unknown>): void;



/** awk helpers from terminal/commands/filesystem/awk-lib.js (browser + Node). */
declare const AwkLib: typeof import("../terminal/commands/filesystem/awk-lib");

/** basename/dirname helpers from terminal/commands/filesystem/basename-lib.js (browser + Node). */
declare const BasenameLib: typeof import("../terminal/commands/filesystem/basename-lib");

/** builtin resolution helpers from terminal/commands/system/builtins-lib.js (browser + Node). */
declare const BuiltinsLib: typeof import("../terminal/commands/system/builtins-lib");

/** cat helpers from terminal/commands/filesystem/cat-lib.js (browser + Node). */
declare const CatLib: typeof import("../terminal/commands/filesystem/cat-lib");

/** chmod helpers from terminal/commands/filesystem/chmod-lib.js (browser + Node). */
declare const ChmodLib: typeof import("../terminal/commands/filesystem/chmod-lib");

/** cut helpers from terminal/commands/filesystem/cut-lib.js (browser + Node). */
declare const CutLib: typeof import("../terminal/commands/filesystem/cut-lib");

/** date helpers from terminal/commands/system/date-lib.js (browser + Node). */
declare const DateLib: typeof import("../terminal/commands/system/date-lib");

/** echo helpers from terminal/commands/filesystem/echo-lib.js (browser + Node). */
declare const EchoLib: typeof import("../terminal/commands/filesystem/echo-lib");

/** env helpers from terminal/commands/system/env-lib.js (browser + Node). */
declare const EnvLib: typeof import("../terminal/commands/system/env-lib");

/** expand helpers from terminal/commands/filesystem/expand-lib.js (browser + Node). */
declare const ExpandLib: typeof import("../terminal/commands/filesystem/expand-lib");

/** file copy/move/rm helpers from terminal/commands/filesystem/fileops-lib.js (browser + Node). */
declare const FileopsLib: typeof import("../terminal/commands/filesystem/fileops-lib");

/** fold helpers from terminal/commands/filesystem/fold-lib.js (browser + Node). */
declare const FoldLib: typeof import("../terminal/commands/filesystem/fold-lib");

/** fmt helpers from terminal/commands/filesystem/fmt-lib.js (browser + Node). */
declare const FmtLib: typeof import("../terminal/commands/filesystem/fmt-lib");

/** grep helpers from terminal/commands/filesystem/grep-lib.js (browser + Node). */
declare const GrepLib: typeof import("../terminal/commands/filesystem/grep-lib");

/** less helpers from terminal/commands/system/less-lib.js (browser + Node). */
declare const LessLib: typeof import("../terminal/commands/system/less-lib");

/** line iteration helpers from terminal/commands/filesystem/lines-lib.js (browser + Node). */
declare const LinesLib: typeof import("../terminal/commands/filesystem/lines-lib");

/** ln helpers from terminal/commands/filesystem/ln-lib.js (browser + Node). */
declare const LnLib: typeof import("../terminal/commands/filesystem/ln-lib");

/** ls helpers from terminal/commands/filesystem/ls-lib.js (browser + Node). */
declare const LsLib: typeof import("../terminal/commands/filesystem/ls-lib");

/** mkdir helpers from terminal/commands/filesystem/mkdir-lib.js (browser + Node). */
declare const MkdirLib: typeof import("../terminal/commands/filesystem/mkdir-lib");

/** printf helpers from terminal/commands/filesystem/printf-lib.js (browser + Node). */
declare const PrintfLib: typeof import("../terminal/commands/filesystem/printf-lib");

/** pwd helpers from terminal/commands/system/pwd-lib.js (browser + Node). */
declare const PwdLib: typeof import("../terminal/commands/system/pwd-lib");

/** readlink helpers from terminal/commands/filesystem/readlink-lib.js (browser + Node). */
declare const ReadlinkLib: typeof import("../terminal/commands/filesystem/readlink-lib");

/** Sed helpers from terminal/commands/filesystem/sed-lib.js (browser + Node). */
declare const SedLib: typeof import("../terminal/commands/filesystem/sed-lib");

/** nl helpers from terminal/commands/filesystem/nl-lib.js (browser + Node). */
declare const NlLib: typeof import("../terminal/commands/filesystem/nl-lib");

/** paste helpers from terminal/commands/filesystem/paste-lib.js (browser + Node). */
declare const PasteLib: typeof import("../terminal/commands/filesystem/paste-lib");

/** join helpers from terminal/commands/filesystem/join-lib.js (browser + Node). */
declare const JoinLib: typeof import("../terminal/commands/filesystem/join-lib");

/** Split helpers from terminal/commands/filesystem/split-lib.js (browser + Node). */
declare const SplitLib: typeof import("../terminal/commands/filesystem/split-lib");

/** Csplit helpers from terminal/commands/filesystem/csplit-lib.js (browser + Node). */
declare const CsplitLib: typeof import("../terminal/commands/filesystem/csplit-lib");

/** seq helpers from terminal/commands/system/seq-lib.js (browser + Node). */
declare const SeqLib: typeof import("../terminal/commands/system/seq-lib");

/** sleep helpers from terminal/commands/system/sleep-lib.js (browser + Node). */
declare const SleepLib: typeof import("../terminal/commands/system/sleep-lib");

/** sort helpers from terminal/commands/filesystem/sort-lib.js (browser + Node). */
declare const SortLib: typeof import("../terminal/commands/filesystem/sort-lib");

/** stat helpers from terminal/commands/filesystem/stat-lib.js (browser + Node). */
declare const StatLib: typeof import("../terminal/commands/filesystem/stat-lib");

/** tee helpers from terminal/commands/filesystem/tee-lib.js (browser + Node). */
declare const TeeLib: typeof import("../terminal/commands/filesystem/tee-lib");

/** test/[ helpers from terminal/commands/system/test-lib.js (browser + Node). */
declare const TestLib: typeof import("../terminal/commands/system/test-lib");

/** touch helpers from terminal/commands/filesystem/touch-lib.js (browser + Node). */
declare const TouchLib: typeof import("../terminal/commands/filesystem/touch-lib");

/** tr helpers from terminal/commands/filesystem/tr-lib.js (browser + Node). */
declare const TrLib: typeof import("../terminal/commands/filesystem/tr-lib");

/** uniq helpers from terminal/commands/filesystem/uniq-lib.js (browser + Node). */
declare const UniqLib: typeof import("../terminal/commands/filesystem/uniq-lib");

/** wc helpers from terminal/commands/filesystem/wc-lib.js (browser + Node). */
declare const WcLib: typeof import("../terminal/commands/filesystem/wc-lib");

/** xargs helpers from terminal/commands/system/xargs-lib.js (browser + Node). */
declare const XargsLib: typeof import("../terminal/commands/system/xargs-lib");

/**
 * ShellCore — core shell infrastructure (POSIX exit codes, path resolution,
 * result normalization). From terminal/lib/shell-core.js.
 */
declare const ShellCore: typeof import("../terminal/lib/shell-core");

/**
 * VfsUtils — VFS helpers (symlink resolution, file decoding, directory sorting).
 * From terminal/lib/vfs-utils.js.
 */
declare const VfsUtils: typeof import("../terminal/lib/vfs-utils");

/**
 * NodeHelpers — utility module from terminal/lib/node-helpers.js.
 */
declare const NodeHelpers: typeof import("../terminal/lib/node-helpers");

/**
 * NpmHelpers — shared npm/npx utilities from terminal/lib/npm-helpers.js.
 */
declare const NpmHelpers: typeof import("../terminal/lib/npm-helpers");

// ---------------------------------------------------------------------------
// Stub interfaces for runtime globals that aren't part of the compilation.
// These should be fleshed out or replaced as those subsystems get modularized.
// ---------------------------------------------------------------------------

interface NpmRegistry {
  modules: Map<string, NpmPackageEntry>;
  packages?: Map<string, NpmPackageEntry>;
  /** Optional CDN base used by in-browser npm shims. */
  CDN_BASE?: string;
  UNPKG_BASE?: string;
  GLOBAL_MODULES?: string;
  search?(query: string): NpmPackageEntry[];
  getPackage?(name: string): NpmPackageEntry | undefined;
}

interface NpmPackageEntry {
  name?: string;
  version?: string;
  description?: string;
  main?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  module?: unknown;
  packageJson?: Record<string, unknown>;
  url?: string;
}

interface AppDescriptor {
  id: string;
  /** Alias used by some registry entries (e.g. open-with routing). */
  appId?: string;
  /** Short label used by launcher helpers (`launch.js`). */
  appName?: string;
  name: string;
  /** Short label for UI (launcher, desktop icons). */
  shortName?: string;
  icon: string;
  system?: boolean;
  /** Fixed placement for built-in desktop icons. */
  desktopPosition?: { x: number; y: number };
  /** MIME categories or patterns this app can open. */
  handles?: string[];
  url?: string;
  mimeTypes?: string[];
  width?: number;
  height?: number;
  minWidth?: number;
  minHeight?: number;
  category?: string;
  description?: string;
}

interface AppModuleStatic {
  load?(appId: string): Promise<unknown>;
  register?(appId: string, module: unknown): void;
  getAllApps(): AppDescriptor[];
  getDesktopApps(): AppDescriptor[];
  getSystemApps(): AppDescriptor[];
  getNonSystemApps(): AppDescriptor[];
  getAppForMimeType(mimeType: string): AppDescriptor | null;
  getAppsForMimeType(mimeType: string): AppDescriptor[];
}

interface ProxyService {
  fetch(url: string, options?: RequestInit): Promise<Response>;
  fetchWithProxy(
    url: string,
    options?: RequestInit & { timeout?: number; maxRetries?: number; skipDirect?: boolean }
  ): Promise<string>;
  fetchBinaryWithProxy(
    url: string,
    options?: RequestInit & { timeout?: number; maxRetries?: number }
  ): Promise<ArrayBuffer>;
  binaryTimeoutMs: number;
}

/** Launcher / app list filter controller exposed as `window.AppFilter` (see `app.js`). */
interface AppFilterWidget {
  create(options: Record<string, unknown>): {
    reset?(): void;
    bindKeyboardShortcuts?(options: Record<string, unknown>): void;
  };
}

/** Cached VFS entry — superset of FileSystemEntry with additional runtime metadata */
interface VFSCacheEntry extends FileSystemEntry {
  children?: string[];
  linkTarget?: string;
  isExecutable?: boolean;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// DOM / Web API augmentations for vendor-specific or non-standard APIs
// ---------------------------------------------------------------------------

interface Performance {
  /** Chrome-specific memory info */
  memory?: {
    jsHeapSizeLimit: number;
    totalJSHeapSize: number;
    usedJSHeapSize: number;
  };
}

interface Navigator {
  /** Network Information API */
  connection?: {
    effectiveType?: string;
    downlink?: number;
    rtt?: number;
    saveData?: boolean;
  };
  /** Device Memory API */
  deviceMemory?: number;
  /** Legacy getUserMedia variants */
  getUserMedia?: (constraints: MediaStreamConstraints, success: (stream: MediaStream) => void, error: (err: unknown) => void) => void;
  mozGetUserMedia?: Navigator['getUserMedia'];
  webkitGetUserMedia?: Navigator['getUserMedia'];
}

interface Error {
  /** Node.js-style error code (e.g. 'ENOENT', 'EEXIST') */
  code?: string;
}

/** NetworkManager — loaded via script tag, not yet modularized */
declare class NetworkManager {
  kernel: HeymingKernel;
  constructor(kernel: HeymingKernel);
  initialize(): Promise<void>;
  createConnection?(host: string, port: number): unknown;
  createSocket?(host: string, port: number): unknown;
}

/** `globalThis` assignments from terminal bootstrap (`shell-core.js`, `node-helpers.js`, `npm-helpers.js`, `fmt-lib.js`). */
interface GlobalThis {
  NodeHelpers: typeof import('../terminal/lib/node-helpers');
  NpmHelpers: typeof import('../terminal/lib/npm-helpers');
  LessLib?: typeof import('../terminal/commands/system/less-lib');
}

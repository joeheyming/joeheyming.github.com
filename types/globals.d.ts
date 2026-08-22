/**
 * Window augmentations for browser globals used throughout the codebase.
 * Kernel/terminal classes and command libs are ES modules.
 * Only bootstrap/runtime globals that are NOT importable live here.
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
  Icons?: typeof import('../os/Icons').Icons;
  InputHandler?: typeof import('../os/InputHandler').InputHandler;
  DragService?: typeof import('../os/DragService').DragService;
  ClipboardService?: typeof import('../os/ClipboardService').ClipboardService;
  FileOperationService?: typeof import('../os/FileOperationService').FileOperationService;
  QuickLookPreview?: typeof import('../os/QuickLookPreview').QuickLookPreview;
  FileSystemDB?: typeof FileSystemDB;
  WindowManager?: typeof import('../os/WindowManager').WindowManager;
  Taskbar?: typeof import('../os/Taskbar').Taskbar;
  NotificationService?: typeof import('../os/NotificationService').NotificationService;
  Launcher?: typeof import('../os/Launcher').Launcher;
  Desktop?: typeof import('../os/Desktop').Desktop;
  Clock?: typeof import('../os/Clock').Clock;
  ContextMenu?: typeof import('../os/ContextMenu').ContextMenu;
  FileDialog?: typeof import('../os/FileDialog').FileDialog;
  HeymingOS?: typeof import('../os/HeymingOS').HeymingOS;
  instance?: import('../terminal/core/heyming-os').HeymingOS;
  debug?: (...args: unknown[]) => void;
  getConfig?: typeof import('../os/config.js').getConfig;
}

interface Window {
  HeymingOS: HeymingOSNamespace;
  heymingOS: import('../terminal/core/heyming-os').HeymingOS;
  heymingAchievements?: HeymingAchievements;
  /** Desktop toast adapter (`achievements-toast.js`), loaded by achievements.js. */
  HeymingAchievementToasts?: {
    enqueue(definition: AchievementDefinition): void;
    wire?(): void;
  };
  /** Controller → arrow-key bridge (`gamepad-keys.js`, opt-in per page). */
  gamepadKeys?: GamepadKeysApi;

  // Shared filesystem (classic script, can't import)
  FileSystemDB: typeof FileSystemDB;

  // Exposed from main.js for classic script consumers (filesystem-db.js)
  commandRegistry: import('../terminal/commands').CommandRegistry;

  // Dynamic runtime properties set by various subsystems
  npmRegistry: NpmRegistry;
  AppModule: AppModuleStatic;
  /** App list filter UI (`app.js`); has `.create()`, not `{ type, value }`. */
  AppFilter: AppFilterWidget;
  proxyService: ProxyService;
  /** In-memory VFS mirror for sync Node shims ({@link terminal/commands/system/node.js}). */
  _vfsSyncCache: { files: Map<string, string>; dirs: Map<string, string[]> };
  _fileSystemListeners: Record<
    string,
    Array<(path: string, details?: FileSystemEventDetails) => void>
  >;
  _fileSystemDBInstance: FileSystemDB;

  // Git integration globals (runtime-only config / debug hooks, not module exports)
  __jshIsoGit: unknown;
  fileCache: Map<string, unknown>;
  /** Optional debug trace hook (see `git.js`). */
  jshGitTrace: ((...args: unknown[]) => void) | undefined;
  JSH_GIT_CORS_PROXY: string;
  JSH_GIT_MAX_PACK_BYTES: number;
  JSH_GIT_TOKEN: string;

  // Timing
  startTime: number;

  // Analytics helpers defined in analytics.js (loaded as a classic
  // <script> on every page; safe to assume present at runtime, but
  // typed as optional so guards remain meaningful in strict-checked files).
  trackEvent?: (
    eventName: string,
    eventCategory?: string,
    eventLabel?: string,
    eventValue?: number
  ) => void;
  trackProjectOpen?: (projectName: string) => void;
  trackConversion?: (conversionType: string, value?: number) => void;
  trackError?: (errorData: {
    type?: string;
    message?: string;
    context?: string;
    recoverable?: boolean;
    stack?: string;
    [k: string]: unknown;
  }) => void;
  trackPerformance?: () => void;

  /** Untangle puzzle debug/preview API (`untangle/index.js`). */
  untangleGame?: {
    startLevel: (level: number, opts?: { scrambleOnly?: boolean }) => void;
    getState: () => unknown;
    scramble: () => void;
  };
}

interface AchievementUnlockRecord {
  unlockedAt: string;
}

interface AchievementChange {
  id: string | null;
  source: 'local' | 'storage';
  unlocked: Record<string, AchievementUnlockRecord>;
}

interface AchievementDefinition {
  id: string;
  appId: string;
  title: string;
  description: string;
  icon: string;
  parentId: string | null;
  x: number;
  y: number;
  tier?: 1 | 2;
  requiresId?: string | null;
}

interface HeymingAchievements {
  ready: Promise<{ catalog: AchievementDefinition[]; currentAppId: string }>;
  unlock(id: string): Promise<boolean>;
  unlockForCurrentApp(slug: string): Promise<boolean>;
  isUnlocked(id: string): boolean;
  getUnlocked(): Record<string, AchievementUnlockRecord>;
  getCurrentAppId(): string;
  subscribe(listener: (change: AchievementChange) => void): () => void;
  storageKey: string;
}

interface GamepadKeysApi {
  start(): void;
  stop(): void;
  readonly isActive: boolean;
  readonly hasGamepad: boolean;
  /** Turn the bridge off for pages that read the Gamepad API themselves. */
  disable(): void;
  enable(): void;
}

// ---------------------------------------------------------------------------
// Stub interfaces for runtime globals that aren't part of the compilation.
// These should be fleshed out or replaced as those subsystems get modularized.
// ---------------------------------------------------------------------------

interface NpmRegistry {
  modules: Map<string, NpmPackageEntry>;
  packages?: Map<string, NpmPackageEntry>;
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
  appId?: string;
  appName?: string;
  name: string;
  shortName?: string;
  icon: string;
  system?: boolean;
  desktopPosition?: { x: number; y: number };
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

interface AppFilterWidget {
  create(options: Record<string, unknown>): {
    reset?(): void;
    bindKeyboardShortcuts?(options: Record<string, unknown>): void;
  };
}

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
  memory?: {
    jsHeapSizeLimit: number;
    totalJSHeapSize: number;
    usedJSHeapSize: number;
  };
}

interface Navigator {
  connection?: {
    effectiveType?: string;
    downlink?: number;
    rtt?: number;
    saveData?: boolean;
  };
  deviceMemory?: number;
  getUserMedia?: (
    constraints: MediaStreamConstraints,
    success: (stream: MediaStream) => void,
    error: (err: unknown) => void
  ) => void;
  mozGetUserMedia?: Navigator['getUserMedia'];
  webkitGetUserMedia?: Navigator['getUserMedia'];
}

interface Error {
  code?: string;
}

declare class NetworkManager {
  kernel: unknown;
  constructor(kernel: unknown);
  initialize(): Promise<void>;
  createConnection?(host: string, port: number): unknown;
  createSocket?(host: string, port: number): unknown;
}

/**
 * Type declarations for the Heyming Terminal layer.
 *
 * The actual Terminal, CommandRegistry, HeymingOS (terminal-side) classes are
 * defined in .js files. This file only declares supplementary interfaces that
 * JS files can reference via JSDoc or that augment the inferred types.
 */

// ---------------------------------------------------------------------------
// Command Result
// ---------------------------------------------------------------------------

interface CommandResult {
  stdout?: string;
  stderr?: string;
  exitCode: number;
}

// ---------------------------------------------------------------------------
// ProcessContext — what a POSIX-like command process sees.
// Commands interact with the OS exclusively through this interface.
// ---------------------------------------------------------------------------

interface ProcessContext {
  // Process identity
  readonly pid: number;
  readonly ppid: number;
  readonly uid: number;
  readonly gid: number;

  // Environment
  env: Record<string, string | undefined>;
  readonly cwd: string;

  // Standard I/O (populated by pipeline runner before command runs)
  readonly stdin: string;
  readonly hasStdin: boolean;
  readonly stdinSupplied: boolean;

  // Syscall interface (the only way to talk to the kernel)
  syscall(name: string, ...args: unknown[]): Promise<unknown>;

  // Convenience (libc-style wrappers over syscalls)
  resolvePath(path: string): string;
  stat(path: string): Promise<FileStat | null>;
  readFile(path: string): Promise<string | null>;
  writeFile(path: string, content: string): Promise<void>;
  readdir(path: string): Promise<DirEntry[]>;
  mkdir(path: string): Promise<void>;
  unlink(path: string): Promise<void>;
  getItem(path: string): Promise<FileSystemEntry | null>;
  getFileSystemItem(path: string): Promise<FileSystemEntry | null>;
  listDirectory(path: string): Promise<FileSystemEntry[]>;
  listDirectoryContents(path: string): Promise<FileSystemEntry[]>;
  copyItem(src: string, dest: string, recursive?: boolean): Promise<void>;
  removeItem(path: string): Promise<void>;
  updatePWD?(newDirectory: string): void;

  // Output helpers
  expandVariables(str: string): string;

  // Terminal-specific (available during migration, not part of the POSIX ideal)
  readonly fileSystemDB: FileSystemDB;
  /** Session working directory; mutable on `Terminal` (e.g. `cd`, `su`). */
  currentDirectory: string;
  /** Last pipeline exit status; builtins may update (e.g. `xargs`). */
  lastExitCode: number;
  readonly os: HeymingOS;

  /** Embedded/desktop window id for DOM lookup; absent in standalone shell. */
  windowId?: string | number | null;

  /** Kernel process record when this terminal is an OS process (`su`, etc.). */
  process?: { env: Record<string, string | undefined>; cwd: string; [key: string]: unknown };

  /** @deprecated Prefer {@link abortSignal}; kept for pipeline Ctrl+C handling. */
  runAbortSignal?: AbortSignal | null;

  /** Run a single parsed command (used by `xargs`). */
  executeSingleCommand?(
    cmd: { name: string; args: string[]; redirections: ShellCommandRedirections | RedirectionDescriptor[] },
    stdin: string
  ): Promise<{ exitCode?: number; stdout?: string; stderr?: string }>;

  syncStandaloneDocumentTitle?(): void;

  isAbortLikeError?(err: unknown): boolean;

  // Process control
  readonly abortSignal: AbortSignal | null;

  // Redirections (set by shell before command runs; starts as `[]` on Terminal, then object per command)
  readonly redirections: ShellCommandRedirections | RedirectionDescriptor[];

  // Terminal UI / session (optional on minimal contexts; present on interactive Terminal)
  addOutput(text: string): void;
  clearScreen(): void;
  aliases: Record<string, string>;
  commandHistory: string[];
  historyIndex: number;
  getAllEnv(): Record<string, string | undefined>;
  setEnv(key: string, value?: string): void;
  setCurrentProcess?(info: { name: string; pid: number; command: string }): void;
  clearCurrentProcess?(): void;
  createModal?(options: Record<string, unknown>): { close(): void; update?(html: string): void; element: HTMLElement };
  onSignal?(signal: string, handler: () => void): void;
}

// ---------------------------------------------------------------------------
// Command Handler
// ---------------------------------------------------------------------------

/**
 * A terminal command handler function.
 *
 * During migration, handlers accept either (ProcessContext, argv) or the
 * legacy (Terminal, args) signature — Terminal implements ProcessContext.
 */
type CommandHandler = (
  ctx: ProcessContext,
  argv: string[],
  flags?: Record<string, unknown>
) => CommandResult | string | void | Promise<CommandResult | string | void>;

// ---------------------------------------------------------------------------
// Command Registry types
// ---------------------------------------------------------------------------

interface CommandEntry {
  handler: CommandHandler;
  description: string;
  category: string;
}

interface CommandInfo {
  name: string;
  description: string;
  category: string;
}

// ---------------------------------------------------------------------------
// Terminal environment
// ---------------------------------------------------------------------------

interface TerminalEnv {
  USER: string;
  LOGNAME: string;
  HOME: string;
  PWD: string;
  SHELL: string;
  TERM: string;
  PATH: string;
  HOSTNAME: string;
  LANG: string;
  EDITOR: string;
  PAGER: string;
  SHLVL: string;
  OLDPWD?: string;
  [key: string]: string | undefined;
}

// ---------------------------------------------------------------------------
// Terminal OS config (terminal/core/heyming-os.js)
// ---------------------------------------------------------------------------

interface TerminalOSConfig {
  maxTerminals: number;
  maxProcesses: number;
  memoryLimit: number;
  securityLevel: string;
  schedulingAlgorithm: string;
  timeSlice: number;
  enableAuditLogging: boolean;
  enableNetworking: boolean;
}

interface TerminalInfoEntry {
  id: string;
  terminal: Terminal;
  process: ProcessInfo;
  title: string;
  created: number;
}

interface TerminalListEntry {
  id: string;
  title: string;
  pid: number;
  created: number;
}

interface ServiceInfoEntry {
  name: string;
  service: Service;
  process: ProcessInfo;
  started: number;
}

// ---------------------------------------------------------------------------
// Redirection descriptor (set on terminal by pipeline runner)
// ---------------------------------------------------------------------------

interface RedirectionDescriptor {
  type: string;
  fd?: number;
  target?: string;
  mode?: string;
}

/** Per-command redirection state from the shell parser (`terminal.js`); not a POSIX fd table. */
interface ShellCommandRedirections {
  stdout?: string;
  stderr?: string;
  stdin?: string;
  append?: boolean;
  stderrToStdout?: boolean;
}

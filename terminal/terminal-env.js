import { ShellCore } from './lib/shell-core.js';
import { VfsUtils } from './lib/vfs-utils.js';
import { _defaultHome } from './terminal-defaults.js';
export class TerminalEnvMixin {
  resolvePath(path) {
    if (path == null || path === '') {
      return ShellCore.resolveVirtualPath(path, this.currentDirectory);
    }
    let p = String(path);
    const homeRaw = this.env.HOME || _defaultHome();
    const home = homeRaw.startsWith('/') ? homeRaw.replace(/\/+$/, '') || '/' : homeRaw;
    if (p === '~') {
      p = home;
    } else if (p.startsWith('~/')) {
      p = `${home}/${p.slice(2)}`;
    }
    return ShellCore.resolveVirtualPath(p, this.currentDirectory);
  }

  async getFileSystemItem(path) {
    // Always use OS file system
    try {
      const stats = await this.syscall('stat', path);
      return stats;
    } catch (error) {
      return null;
    }
  }

  async listDirectoryContents(path) {
    // Always use OS file system
    try {
      const entries = await this.syscall('readdir', path);
      return entries;
    } catch (error) {
      return [];
    }
  }

  getShortPath() {
    if (this.currentDirectory === this.env.HOME) {
      return '~';
    }
    if (this.currentDirectory.startsWith(this.env.HOME + '/')) {
      return '~' + this.currentDirectory.substring(this.env.HOME.length);
    }
    return this.currentDirectory;
  }

  /**
   * Theme G: browser tab title matches the prompt (standalone page only; not OS iframe embed).
   */
  syncStandaloneDocumentTitle() {
    if (this.windowId) return;
    if (typeof document === 'undefined') return;
    if (document.documentElement.classList.contains('terminal-embed-os')) return;

    const line = `${this.env.USER}@${this.env.HOSTNAME}:${this.getShortPath()}`;
    const max = 100;
    const display = line.length > max ? `${line.slice(0, max - 1)}…` : line;
    document.title = `jsh — ${display}`;
  }

  // ---------------------------------------------------------------------------
  // ProcessContext interface — these getters/methods let Terminal satisfy the
  // ProcessContext type so commands can be written against the interface while
  // still receiving the full Terminal during migration.
  // ---------------------------------------------------------------------------

  /** @returns {number} */
  get pid() {
    return this.process ? this.process.pid : 0;
  }
  /** @returns {number} */
  get ppid() {
    return this.process ? this.process.parentPID : 0;
  }
  /** @returns {number} */
  get uid() {
    return this.process ? this.process.uid : 1000;
  }
  /** @returns {number} */
  get gid() {
    return this.process ? this.process.gid : 1000;
  }
  /** @returns {string} */
  get cwd() {
    return this.currentDirectory;
  }
  /** @returns {AbortSignal|null} */
  get abortSignal() {
    return this.runAbortSignal;
  }

  /** @param {string} path */
  async readFile(path) {
    const resolved = this.resolvePath(path);
    const item = await this.getFileSystemItem(resolved);
    if (!item || item.type !== 'file') return null;
    const d = VfsUtils.fileItemUtf8ForDisplay(item);
    return d.isBinary ? null : d.text;
  }

  /** @param {string} path @param {string} content */
  async writeFile(path, content) {
    const resolved = this.resolvePath(path);
    await this.fileSystemDB.createFile(resolved, content, true);
  }

  /** @param {string} path @returns {Promise<DirEntry[]>} */
  async readdir(path) {
    const resolved = this.resolvePath(path);
    return this.listDirectoryContents(resolved);
  }

  /**
   * Convert a simple glob pattern (supports * and ?) into a RegExp.
   * Only the filename portion is matched — directory separators are not
   * crossed by *.
   * @param {string} pattern
   * @returns {RegExp}
   */
  _globPatternToRegex(pattern) {
    let re = '';
    for (const ch of pattern) {
      if (ch === '*') re += '[^/]*';
      else if (ch === '?') re += '[^/]';
      else re += ch.replace(/[\\^$.|+()[\]{}]/g, '\\$&');
    }
    return new RegExp(`^${re}$`);
  }

  /**
   * Expand a single token that may contain glob metacharacters (* or ?).
   * Returns an array of matching paths, or the original token if nothing matched.
   * @param {string} token
   * @returns {Promise<string[]>}
   */
  async _expandGlobToken(token) {
    if (!token.includes('*') && !token.includes('?')) return [token];

    const lastSlash = token.lastIndexOf('/');
    let dirPart, pattern;
    if (lastSlash === -1) {
      dirPart = '.';
      pattern = token;
    } else {
      dirPart = token.substring(0, lastSlash) || '/';
      pattern = token.substring(lastSlash + 1);
    }

    const resolvedDir = this.resolvePath(dirPart);
    const entries = await this.listDirectoryContents(resolvedDir);
    if (!entries || entries.length === 0) return [token];

    const re = this._globPatternToRegex(pattern);
    const prefix = lastSlash === -1 ? '' : token.substring(0, lastSlash + 1);

    const matched = entries
      .filter((e) => re.test(e.name))
      .map((e) => prefix + e.name)
      .sort();

    return matched.length > 0 ? matched : [token];
  }

  /**
   * Expand glob patterns in a command's argument list.
   * @param {string[]} args
   * @returns {Promise<string[]>}
   */
  async expandGlobs(args) {
    const expanded = [];
    for (const arg of args) {
      const results = await this._expandGlobToken(arg);
      expanded.push(...results);
    }
    return expanded;
  }

  /** @param {string} path */
  async mkdir(path) {
    const resolved = this.resolvePath(path);
    await this.syscall('mkdir', resolved);
  }

  /** @param {string} path */
  async unlink(path) {
    const resolved = this.resolvePath(path);
    await this.syscall('unlink', resolved);
  }

  /** @param {string} path @returns {Promise<FileSystemEntry|null>} */
  async getItem(path) {
    return this.getFileSystemItem(path);
  }

  /** @param {string} src @param {string} dest @param {boolean} [recursive] */
  async copyItem(src, dest, recursive) {
    const resolvedSrc = this.resolvePath(src);
    const resolvedDest = this.resolvePath(dest);
    await this.fileSystemDB.copyItem(resolvedSrc, resolvedDest, recursive);
  }

  /** @param {string} path */
  async removeItem(path) {
    const resolved = this.resolvePath(path);
    const item = await this.getFileSystemItem(resolved);
    if (!item) return;
    if (item.type === 'directory') {
      await this.fileSystemDB.deleteItem(resolved, true);
    } else {
      await this.fileSystemDB.deleteItem(resolved, false);
    }
  }

  updatePWD(newDirectory) {
    this.env.OLDPWD = this.currentDirectory;
    this.currentDirectory = newDirectory;
    this.env.PWD = newDirectory;
    this.syncStandaloneDocumentTitle();
  }

  // Expand environment variables in a string
  expandVariables(str) {
    return ShellCore.expandVariablesInString(str, this.env, this.lastExitCode);
  }

  // Set environment variable
  setEnv(name, value) {
    this.env[name] = value;
  }

  // Get environment variable
  getEnv(name) {
    return this.env[name];
  }

  // Get all environment variables
  getAllEnv() {
    return { ...this.env };
  }
}

/**
 * git-service.js — VS-Code-like git wrapper for Code IDE.
 *
 * Delegates write operations (init / add / commit / clone / fetch / pull /
 * push / checkout / branch / login / logout / config) to the OS terminal's
 * existing `gitHandler` so we share its CORS proxy resolution, GitHub token
 * handling, OOM-safe checkout, and progress reporting. We only call
 * isomorphic-git directly for the structured reads VS Code-style UI needs
 * (statusMatrix, currentBranch, listBranches, readBlob).
 *
 * The OS terminal builds its `terminal` argument with these fields:
 *   - fileSystemDB
 *   - currentDirectory     (absolute string)
 *   - env                  (mutable object, used for GITHUB_TOKEN etc.)
 *   - resolvePath(p)       (relative→absolute)
 *   - addOutput(line)      (status messages)
 *   - runAbortSignal       (optional abort)
 *   - isAbortLikeError(e)  (optional)
 *
 * We synthesize a minimal compatible "terminal" inside this module.
 *
 * Status codes follow VS Code's letter convention:
 *   '??' untracked, 'A' added, 'M' modified, 'D' deleted.
 */

/**
 * FileSystemDB lives in the parent window. Its createFileFast / getItem use
 * `instanceof Uint8Array` and `instanceof ArrayBuffer` against the parent
 * realm's globals; objects we produce inside this iframe are a different
 * realm and silently slip through the binary fast-path, getting String()-
 * ified into garbage that breaks git's checksums. Wrap the FSDB so binary
 * payloads cross the boundary as parent-realm bytes, and binary blobs
 * coming back become iframe-realm bytes.
 *
 * @param {object} fsdb        — original parent-realm FileSystemDB
 * @param {Window} parentWin   — the parent window (provides Uint8Array/ArrayBuffer)
 */
function wrapForParentRealm(fsdb, parentWin) {
  const ParentU8 = parentWin.Uint8Array;
  const ParentAB = parentWin.ArrayBuffer;

  const toParentU8 = (data) => {
    if (data == null) return data;
    if (data instanceof ParentU8) return data;
    if (data instanceof ParentAB) return new ParentU8(data);
    if (typeof data === 'string') return data;
    if (data instanceof Uint8Array) {
      const out = new ParentU8(data.byteLength);
      out.set(data);
      return out;
    }
    if (data instanceof ArrayBuffer) {
      return new ParentU8(new ParentU8(data));
    }
    if (data && typeof data === 'object' && data.buffer instanceof ArrayBuffer) {
      const out = new ParentU8(data.byteLength);
      out.set(new Uint8Array(data.buffer, data.byteOffset || 0, data.byteLength));
      return out;
    }
    return data;
  };

  const toIframeU8 = (rawBytes) => {
    if (rawBytes == null) return rawBytes;
    if (rawBytes instanceof ArrayBuffer || rawBytes instanceof Uint8Array) return rawBytes;
    if (rawBytes instanceof ParentU8) {
      const u8 = new Uint8Array(rawBytes.byteLength);
      u8.set(rawBytes);
      return u8;
    }
    if (rawBytes instanceof ParentAB) {
      const u8 = new Uint8Array(rawBytes.byteLength);
      u8.set(new ParentU8(rawBytes));
      return u8;
    }
    if (rawBytes && typeof rawBytes === 'object' && typeof rawBytes.byteLength === 'number') {
      const len = rawBytes.byteLength;
      const u8 = new Uint8Array(len);
      try {
        u8.set(new ParentU8(rawBytes.buffer, rawBytes.byteOffset || 0, len));
        return u8;
      } catch (_) {
        return rawBytes;
      }
    }
    return rawBytes;
  };

  const unwrapItem = (item) => {
    if (!item || typeof item !== 'object' || item.contentBytes == null) return item;
    const out = Object.assign({}, item);
    out.contentBytes = toIframeU8(item.contentBytes);
    return out;
  };

  const wrapped = Object.create(fsdb);

  if (typeof fsdb.createFileFast === 'function') {
    wrapped.createFileFast = (path, content, parentPath) =>
      fsdb.createFileFast(path, toParentU8(content), parentPath);
  }
  if (typeof fsdb.createFile === 'function') {
    wrapped.createFile = (...args) => {
      const out = args.slice();
      if (out.length >= 2) out[1] = toParentU8(out[1]);
      return fsdb.createFile(...out);
    };
  }
  if (typeof fsdb.getItem === 'function') {
    wrapped.getItem = async (path) => unwrapItem(await fsdb.getItem(path));
  }
  if (typeof fsdb.listDirectory === 'function') {
    wrapped.listDirectory = async (path) => {
      const items = await fsdb.listDirectory(path);
      return Array.isArray(items) ? items.map(unwrapItem) : items;
    };
  }
  if (typeof fsdb.beginBatchWrite === 'function') {
    wrapped.beginBatchWrite = () => {
      const batch = fsdb.beginBatchWrite();
      const w = Object.create(batch);
      w.putFile = (path, content, parentPath) =>
        batch.putFile(path, toParentU8(content), parentPath);
      return w;
    };
  }

  return wrapped;
}

/**
 * Build a minimal `terminal`-shaped object accepted by gitHandler / its FS
 * adapter. We keep state for currentDirectory and env; the IDE points
 * currentDirectory at the workspace root before each call.
 */
function makeTerminalAdapter(fsdb, getCwd) {
  const adapter = {
    fileSystemDB: fsdb,
    env: {
      USER: window.parent?.HeymingOS?.Config?.USER || 'user',
      HOSTNAME: window.parent?.HeymingOS?.Config?.HOSTNAME || 'heyming-os'
    },
    addOutput(line) {
      if (line) console.log('[code-ide/git]', line);
    },
    isAbortLikeError(e) {
      return e && (e.name === 'AbortError' || /aborted/i.test(String(e.message || '')));
    }
  };
  Object.defineProperty(adapter, 'currentDirectory', {
    enumerable: true,
    get: () => getCwd()
  });
  adapter.resolvePath = (p) => {
    if (!p) return getCwd();
    if (p.startsWith('/')) return p;
    const cwd = getCwd();
    if (cwd === '/' || !cwd) return '/' + p;
    return cwd.replace(/\/+$/, '') + '/' + p;
  };
  return adapter;
}

/**
 * @param {{ kind: string, root: string }} workspaceFs   Code IDE filesystem
 *     adapter (only the OS adapter supports git today).
 */
export async function createGitService(workspaceFs) {
  if (!workspaceFs || workspaceFs.kind !== 'os') return null;
  if (!window.parent?.FileSystemDB) return null;

  // Reuse the OS terminal's git plumbing — cors proxy resolution, token
  // handling, OOM-safe checkout, etc. Importing from this iframe loads them
  // into our realm; pair with a realm-aware FSDB wrapper so binary blobs
  // round-trip correctly across the iframe ↔ parent boundary.
  const rawFsdb = await window.parent.FileSystemDB.getInstance();
  const fsdb = wrapForParentRealm(rawFsdb, window.parent);

  const [{ gitHandler }, fsMod, isoGitMod] = await Promise.all([
    import('../terminal/commands/system/git-handler.js'),
    import('../terminal/lib/jsh-git-fs.js'),
    import('../terminal/commands/system/git-iso.js')
  ]);
  const isoGit = await isoGitMod.loadIsoGit();
  const fs = fsMod.createJshGitFs({ fileSystemDB: fsdb });

  let root = null; // active repo root (absolute path)
  const terminal = makeTerminalAdapter(fsdb, () => root || workspaceFs.root);

  /** @type {Set<(s: GitState) => void>} */
  const listeners = new Set();
  let lastState = { branch: null, files: [], error: null };

  let refreshScheduled = false;
  let refreshInFlight = null;

  function emit() {
    for (const fn of listeners) {
      try {
        fn(lastState);
      } catch (err) {
        console.error('[code-ide/git] listener error', err);
      }
    }
  }

  /** Walk parents looking for a `.git` directory. Returns absolute root or null. */
  async function findRoot(startPath) {
    let cur = startPath || '/';
    if (!cur.startsWith('/')) cur = '/' + cur;
    for (let i = 0; i < 64; i++) {
      const dotGit = await fsdb.getItem(joinPath(cur, '.git'));
      if (dotGit && dotGit.type === 'directory') return cur;
      if (cur === '/' || cur === '') return null;
      const parent = fsdb.getParentPath(cur);
      if (!parent || parent === cur) return null;
      cur = parent;
    }
    return null;
  }

  function joinPath(parent, name) {
    if (!parent || parent === '/') return '/' + name;
    return parent.replace(/\/+$/, '') + '/' + name;
  }

  function absoluteFor(rootPath, rel) {
    if (!rel || rel === '.') return rootPath;
    if (rel.startsWith('/')) return rel;
    return joinPath(rootPath, rel);
  }

  /**
   * Convert isomorphic-git's [filepath, head, workdir, stage] row into the
   * VS-Code-friendly shape the SCM panel and tree decorators consume.
   */
  function rowToFile(row, rootPath) {
    const [filepath, head, workdir, stage] = row;
    const file = {
      filepath,
      abs: absoluteFor(rootPath, filepath),
      head,
      workdir,
      stage,
      staged: '',
      working: '',
      code: ''
    };
    if (head === 0 && workdir === 2 && stage === 0) file.working = '??';
    else if (head === 1 && workdir === 0) file.working = 'D';
    else if (head === 1 && workdir === 2) file.working = 'M';
    if (head === 0 && stage === 2) file.staged = 'A';
    else if (head === 1 && stage === 0) file.staged = 'D';
    else if (head === 1 && stage === 2) file.staged = 'M';
    else if (head === 1 && stage === 3) file.staged = 'M';
    file.code = file.working || file.staged;
    return file;
  }

  async function readWorkingFile(filepath) {
    const item = await fsdb.getItem(absoluteFor(root, filepath));
    if (!item || item.type !== 'file') return '';
    if (item.contentBytes instanceof ArrayBuffer && item.contentBytes.byteLength > 0) {
      return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(item.contentBytes));
    }
    if (item.contentBytes instanceof Uint8Array && item.contentBytes.byteLength > 0) {
      return new TextDecoder('utf-8', { fatal: false }).decode(item.contentBytes);
    }
    return item.content || '';
  }

  async function readHeadFile(filepath) {
    if (!root) return '';
    try {
      const head = await isoGit.resolveRef({ fs, dir: root, ref: 'HEAD' });
      const { blob } = await isoGit.readBlob({ fs, dir: root, oid: head, filepath });
      return new TextDecoder('utf-8', { fatal: false }).decode(blob);
    } catch {
      return '';
    }
  }

  /**
   * Run a `git` subcommand by delegating to the OS terminal handler. Returns
   * the same shape as `gitHandler`: { stdout, stderr, exitCode }. Throws if
   * exitCode != 0 so callers can use try/catch like a normal async API.
   */
  async function run(args) {
    const result = await gitHandler(terminal, args);
    if (result.exitCode !== 0) {
      const err = new Error((result.stderr || result.stdout || 'git failed').trim());
      err.exitCode = result.exitCode;
      err.stderr = result.stderr;
      err.stdout = result.stdout;
      throw err;
    }
    return result;
  }

  async function refreshNow() {
    if (!root) {
      lastState = { branch: null, files: [], error: null };
      emit();
      return lastState;
    }
    try {
      const [branch, matrix] = await Promise.all([
        isoGit.currentBranch({ fs, dir: root, fullname: false }).catch(() => null),
        isoGit.statusMatrix({ fs, dir: root })
      ]);
      const rows = matrix.map((row) => rowToFile(row, root));
      const files = rows.filter((f) => f.working || f.staged);
      files.sort((a, b) => {
        const aStaged = a.staged ? 0 : 1;
        const bStaged = b.staged ? 0 : 1;
        return aStaged - bStaged || a.filepath.localeCompare(b.filepath);
      });
      lastState = { branch, files, error: null };
    } catch (err) {
      lastState = { branch: null, files: [], error: err.message || String(err) };
    }
    emit();
    return lastState;
  }

  function refresh() {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = refreshNow().finally(() => {
      refreshInFlight = null;
    });
    return refreshInFlight;
  }

  function scheduleRefresh() {
    if (refreshScheduled) return;
    refreshScheduled = true;
    requestAnimationFrame(async () => {
      refreshScheduled = false;
      await refresh();
    });
  }

  // Auto-refresh on FS changes inside the active repo.
  workspaceFs.onChange?.((event) => {
    if (!root) return;
    const path = event?.path || '';
    if (path === root || path.startsWith(root + '/') || root.startsWith(path + '/')) {
      scheduleRefresh();
    }
  });

  return {
    kind: 'git',

    findRoot,

    getRoot() {
      return root;
    },

    async setRoot(path) {
      const found = await findRoot(path);
      root = found;
      await refresh();
      return root;
    },

    onChange(fn) {
      listeners.add(fn);
      try {
        fn(lastState);
      } catch (err) {
        console.error('[code-ide/git] subscribe error', err);
      }
      return () => listeners.delete(fn);
    },

    refresh,

    getState() {
      return lastState;
    },

    async init(path) {
      const dir = path || root || workspaceFs.root;
      // gitHandler's `init` doesn't recreate the workspace dir — make sure
      // it exists first so a fresh OS profile can `git init` from the IDE.
      await fs.promises.mkdir(dir, { recursive: true });
      // Point the synthetic terminal at the dir so `git init` lands there.
      root = dir;
      await run(['init']);
      await refresh();
      return dir;
    },

    async stage(filepath) {
      if (!root) throw new Error('No git repository');
      const abs = absoluteFor(root, filepath);
      const item = await fsdb.getItem(abs);
      if (!item) {
        // Working tree no longer has the file — record the deletion. Use
        // isomorphic-git directly because the CLI handler doesn't expose
        // `git rm`.
        await isoGit.remove({ fs, dir: root, filepath });
      } else {
        await run(['add', filepath]);
      }
      await refresh();
    },

    async stageAll() {
      if (!root) throw new Error('No git repository');
      // `git add -A` semantics: pick up modifications + deletions + new files.
      const matrix = await isoGit.statusMatrix({ fs, dir: root });
      for (const [filepath, head, workdir] of matrix) {
        if (workdir === 0 && head === 1) {
          await isoGit.remove({ fs, dir: root, filepath });
        } else if (workdir === 2) {
          await isoGit.add({ fs, dir: root, filepath });
        }
      }
      await refresh();
    },

    async unstage(filepath) {
      if (!root) throw new Error('No git repository');
      // Reset index entry to whatever HEAD says. The terminal handler
      // doesn't expose `git restore --staged`, so call directly.
      await isoGit.resetIndex({ fs, dir: root, filepath });
      await refresh();
    },

    async unstageAll() {
      if (!root) throw new Error('No git repository');
      const matrix = await isoGit.statusMatrix({ fs, dir: root });
      for (const [filepath, head, , stage] of matrix) {
        if (stage !== head) {
          await isoGit.resetIndex({ fs, dir: root, filepath });
        }
      }
      await refresh();
    },

    /**
     * Restore the working tree from HEAD for one path. For a tracked file
     * this is "git restore <path>"; an untracked file is just deleted.
     */
    async discard(filepath) {
      if (!root) throw new Error('No git repository');
      const abs = absoluteFor(root, filepath);
      try {
        const head = await isoGit.resolveRef({ fs, dir: root, ref: 'HEAD' });
        const { blob } = await isoGit.readBlob({ fs, dir: root, oid: head, filepath });
        const text = new TextDecoder('utf-8', { fatal: false }).decode(blob);
        await fsdb.createFileFast(abs, text);
      } catch {
        await fsdb.deleteItem?.(abs).catch(() => {});
      }
      await refresh();
    },

    async commit(message, opts = {}) {
      if (!root) throw new Error('No git repository');
      if (!message || !message.trim()) throw new Error('Commit message is required');
      const result = await run(['commit', '-m', message.trim()]);
      // gitHandler returns "[abc1234] message\n" — extract the short oid.
      const match = /^\[([0-9a-f]{4,40})\]/m.exec(result.stdout || '');
      void opts;
      await refresh();
      return match ? match[1] : null;
    },

    async listBranches() {
      if (!root) return [];
      return isoGit.listBranches({ fs, dir: root });
    },

    async currentBranch() {
      if (!root) return null;
      return isoGit.currentBranch({ fs, dir: root, fullname: false });
    },

    async createBranch(name) {
      if (!root) throw new Error('No git repository');
      await isoGit.branch({ fs, dir: root, ref: name, checkout: true });
      await refresh();
    },

    async checkout(ref) {
      if (!root) throw new Error('No git repository');
      await run(['checkout', ref]);
      await refresh();
    },

    async fetch(opts = {}) {
      if (!root) throw new Error('No git repository');
      await run(['fetch', opts.remote || 'origin']);
      await refresh();
    },

    async pull(opts = {}) {
      if (!root) throw new Error('No git repository');
      const args = ['pull'];
      if (opts.remote) args.push(opts.remote);
      if (opts.branch) args.push(opts.branch);
      await run(args);
      await refresh();
    },

    async push(opts = {}) {
      if (!root) throw new Error('No git repository');
      const args = ['push'];
      if (opts.force) args.push('--force');
      if (opts.remote) args.push(opts.remote);
      if (opts.branch) args.push(opts.branch);
      const result = await run(args);
      await refresh();
      return result;
    },

    async clone(url, dest, opts = {}) {
      const dir = dest || workspaceFs.root || '/';
      // Root the synthetic terminal at the parent of `dir` so `git clone`
      // creates the destination relative to it (matches the terminal UX).
      root = dir;
      const args = ['clone'];
      if (opts.depth != null) args.push('--depth', String(opts.depth));
      if (opts.singleBranch === false) args.push('--all-branches');
      args.push(url, dir);
      await run(args);
      root = dir;
      await refresh();
      return dir;
    },

    async diffAgainstHead(filepath) {
      if (!root) throw new Error('No git repository');
      const [head, working] = await Promise.all([
        readHeadFile(filepath),
        readWorkingFile(filepath)
      ]);
      return { head, working };
    },

    setToken(token) {
      if (token == null || token === '') {
        delete window.JSH_GIT_TOKEN;
        if (window.parent) delete window.parent.JSH_GIT_TOKEN;
        delete terminal.env.GITHUB_TOKEN;
      } else {
        window.JSH_GIT_TOKEN = token;
        if (window.parent) window.parent.JSH_GIT_TOKEN = token;
        terminal.env.GITHUB_TOKEN = token;
      }
    },

    getToken() {
      const env = terminal.env.GITHUB_TOKEN;
      const w1 = window.JSH_GIT_TOKEN;
      const w2 = window.parent?.JSH_GIT_TOKEN;
      return env || w1 || w2 || null;
    },

    /** Status-code map keyed by absolute path, used by tree decorators. */
    decorations() {
      const out = new Map();
      for (const f of lastState.files) out.set(f.abs, f.code);
      return out;
    }
  };
}

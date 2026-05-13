// Promisified fs for isomorphic-git backed by FileSystemDB (same IndexedDB as jsh / kernel).

/**
 * Collapse `.` / `..`, duplicate slashes, and trailing `/.` so paths match IndexedDB keys
 * (isomorphic-git uses `${dir}/.` for the worktree root → must become `${dir}`).
 */
function normalizeAbsPath(p) {
  if (p == null || typeof p !== 'string') return p;
  const absolute = p.startsWith('/');
  const stack = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') stack.pop();
    else stack.push(seg);
  }
  const body = stack.join('/');
  if (absolute) {
    return body ? `/${body}` : '/';
  }
  return body;
}

function hashPathToIno(pathStr) {
  let h = 1;
  for (let i = 0; i < pathStr.length; i++) {
    h = (h * 33 + pathStr.charCodeAt(i)) >>> 0;
  }
  return h || 1;
}

/**
 * isomorphic-git normalizeStats() uses ctime/mtime/dev/ino/uid/gid; omitting them yields NaN
 * or undefined.valueOf() and breaks indexPack / status / add.
 */
function toStat(item, pathForIno) {
  if (!item) {
    const e = new Error('ENOENT');
    e.code = 'ENOENT';
    throw e;
  }
  const t = item.type;
  let size = 0;
  if (t === 'file') {
    if (item.contentBytes instanceof ArrayBuffer) {
      size = item.contentBytes.byteLength;
    } else {
      size = new Blob([item.content || '']).size;
    }
  }
  let mtimeMs = item.modified ? new Date(item.modified).getTime() : Date.now();
  if (!Number.isFinite(mtimeMs)) {
    mtimeMs = Date.now();
  }
  const mtimeDate = new Date(mtimeMs);
  const ino = hashPathToIno(pathForIno || '');
  return {
    size,
    mode: item.mode || (t === 'directory' ? 0o755 : t === 'symlink' ? 0o777 : 0o644),
    mtimeMs,
    mtime: mtimeDate,
    ctimeMs: mtimeMs,
    ctime: mtimeDate,
    dev: 1,
    ino,
    uid: 0,
    gid: 0,
    isFile() {
      return t === 'file';
    },
    isDirectory() {
      return t === 'directory';
    },
    isSymbolicLink() {
      return t === 'symlink';
    }
  };
}

/**
 * Normalize isomorphic-git / Buffer polyfill payloads so we never stringify pack data.
 * @param {*} data
 * @returns {Uint8Array|null}
 */
function asBinaryPayload(data) {
  if (data == null) {
    return null;
  }
  if (typeof ArrayBuffer !== 'undefined' && data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (typeof Uint8Array !== 'undefined' && data instanceof Uint8Array) {
    return data;
  }
  // @ts-ignore Buffer is Node-only; browser builds skip this branch
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer && Buffer.isBuffer(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (
    typeof data === 'object' &&
    data.buffer instanceof ArrayBuffer &&
    typeof data.byteLength === 'number' &&
    typeof data.byteOffset === 'number'
  ) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return null;
}

/** @param {{ fileSystemDB: object }} terminal */
export function createJshGitFs(terminal) {
  const fsdb = terminal.fileSystemDB;

  // Directories confirmed to exist during this session — avoids redundant IDB
  // lookups when isomorphic-git writes hundreds of files under the same tree.
  const knownDirs = new Set(['/']);

  /** @type {ReturnType<typeof fsdb.beginBatchWrite> | null} */
  let batchWriter = null;

  const createDir = typeof fsdb.createDirectoryFast === 'function'
    ? (path, parent) => fsdb.createDirectoryFast(path, parent)
    : (path) => fsdb.createDirectory(path);

  async function mkdirp(absPath) {
    if (knownDirs.has(absPath)) return;
    const parts = absPath.split('/').filter(Boolean);
    let cur = '';
    for (const p of parts) {
      const parent = cur || '/';
      cur = cur ? `${cur}/${p}` : `/${p}`;
      if (knownDirs.has(cur)) continue;
      const ex = await fsdb.getItem(cur);
      if (!ex) {
        await createDir(cur, parent);
      } else if (ex.type !== 'directory') {
        const e = new Error('ENOTDIR');
        e.code = 'ENOTDIR';
        throw e;
      }
      knownDirs.add(cur);
    }
  }

  const promises = {
    async readFile(path, opts) {
      path = normalizeAbsPath(path);
      const item = await fsdb.getItem(path);
      if (!item || item.type === 'symlink') {
        const e = new Error('ENOENT');
        e.code = 'ENOENT';
        throw e;
      }
      if (item.type !== 'file') {
        const e = new Error('EISDIR');
        e.code = 'EISDIR';
        throw e;
      }
      let u8;
      const rawBytes = item.contentBytes;
      if (rawBytes != null) {
        if (rawBytes instanceof ArrayBuffer) {
          u8 = new Uint8Array(rawBytes.slice(0));
        } else if (typeof Uint8Array !== 'undefined' && rawBytes instanceof Uint8Array) {
          u8 = new Uint8Array(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength);
        } else if (
          typeof rawBytes === 'object' &&
          rawBytes.buffer instanceof ArrayBuffer &&
          typeof rawBytes.byteLength === 'number'
        ) {
          u8 = new Uint8Array(
            rawBytes.buffer.slice(rawBytes.byteOffset, rawBytes.byteOffset + rawBytes.byteLength)
          );
        } else {
          u8 = new TextEncoder().encode(item.content || '');
        }
      } else {
        u8 = new TextEncoder().encode(item.content || '');
      }
      if (opts && opts.encoding === 'utf8') {
        return new TextDecoder().decode(u8);
      }
      // @ts-ignore Buffer is Node-only
      if (typeof Buffer !== 'undefined' && Buffer.from) {
        // @ts-ignore Buffer is Node-only
        return Buffer.from(u8);
      }
      return u8;
    },

    async writeFile(path, data, opts) {
      path = normalizeAbsPath(path);
      const parentPath = fsdb.getParentPath(path);
      if (parentPath) {
        await mkdirp(parentPath);
      }
      const content = asBinaryPayload(data)
        || (typeof data === 'string' && (!opts || !opts.encoding || opts.encoding === 'utf8') ? data : String(data));

      if (batchWriter) {
        await batchWriter.putFile(path, content, parentPath);
      } else {
        await fsdb.createFileFast(path, content, parentPath);
      }
    },

    async mkdir(path, options) {
      path = normalizeAbsPath(path);
      if (options && options.recursive) {
        await mkdirp(path);
        return;
      }
      const parentPath = fsdb.getParentPath(path);
      if (parentPath) {
        const par = await fsdb.getItem(parentPath);
        if (!par) {
          const e = new Error('ENOENT');
          e.code = 'ENOENT';
          throw e;
        }
      }
      await fsdb.createDirectory(path);
    },

    async rmdir(path) {
      path = normalizeAbsPath(path);
      await fsdb.rmdir(path);
    },

    async unlink(path) {
      path = normalizeAbsPath(path);
      const item = await fsdb.getItem(path);
      if (!item) {
        return;
      }
      await fsdb.unlink(path);
    },

    async readdir(path) {
      path = normalizeAbsPath(path);
      // isomorphic-git calls fs.readdir hundreds of times during checkout
      // (most heavily on .git/objects/pack/). Trace evidence showed the old
      // listDirectory path consumed 54% of CPU because IDB had to deserialize
      // every record (including contentBytes ArrayBuffers) just so we could
      // throw all of that away and keep only filenames. Use the keys-only
      // index lookup when available — same result, ~100× cheaper for dirs
      // with binary contents.
      if (typeof fsdb.listDirectoryNames === 'function') {
        const paths = await fsdb.listDirectoryNames(path);
        return paths.map((p) => fsdb.getFileName(p));
      }
      const entries = await fsdb.listDirectory(path);
      return entries.map((e) => fsdb.getFileName(e.path));
    },

    async stat(path) {
      path = normalizeAbsPath(path);
      const item = await fsdb.getItem(path);
      return toStat(item, path);
    },

    async lstat(path) {
      path = normalizeAbsPath(path);
      const item = await fsdb.getItem(path);
      return toStat(item, path);
    },

    async readlink(path) {
      path = normalizeAbsPath(path);
      const item = await fsdb.getItem(path);
      if (!item || item.type !== 'symlink') {
        const e = new Error('EINVAL');
        e.code = 'EINVAL';
        throw e;
      }
      return item.target;
    },

    async symlink(target, path) {
      path = normalizeAbsPath(path);
      const parentPath = fsdb.getParentPath(path);
      if (parentPath) {
        await mkdirp(parentPath);
      }
      await fsdb.createSymlink(target, path);
    },

    async rm(path, options) {
      path = normalizeAbsPath(path);
      if (options && options.recursive) {
        const exists = await fsdb.getItem(path);
        if (!exists) {
          return;
        }
        await fsdb.deleteItem(path, true);
        return;
      }
      const item = await fsdb.getItem(path);
      if (!item) {
        return;
      }
      if (item.type === 'directory') {
        await fsdb.rmdir(path);
      } else {
        await fsdb.unlink(path);
      }
    }
  };

  return {
    promises,
    enableBatchWrites() {
      if (typeof fsdb.beginBatchWrite === 'function') {
        batchWriter = fsdb.beginBatchWrite();
      }
    },
    async flushBatchWrites() {
      if (batchWriter) {
        await batchWriter.flush();
        batchWriter = null;
      }
    },
    /**
     * Bulk-create the given absolute directories (and all of their ancestors)
     * in a single IDB transaction, then mark them in the in-memory knownDirs
     * cache so subsequent writeFile() calls skip mkdirp entirely.
     *
     * Designed for git checkout where the tree's ~hundreds of unique parent
     * directories would otherwise cost N getItem + N put transactions.
     *
     * @param {string[]} absDirs - absolute directory paths
     * @returns {Promise<number>} number of newly-recorded directories
     */
    async prewarmDirs(absDirs) {
      if (!Array.isArray(absDirs) || absDirs.length === 0) return 0;
      const allAncestors = new Set();
      for (const raw of absDirs) {
        const norm = normalizeAbsPath(raw);
        if (!norm || norm === '/') continue;
        const parts = norm.split('/').filter(Boolean);
        let cur = '';
        for (const p of parts) {
          cur = `${cur}/${p}`;
          allAncestors.add(cur);
        }
      }
      const novel = [];
      for (const d of allAncestors) {
        if (!knownDirs.has(d)) novel.push(d);
      }
      if (novel.length === 0) return 0;
      // Sort by depth so the bulk transaction writes parents before children.
      novel.sort((a, b) => {
        const da = a.split('/').length;
        const db = b.split('/').length;
        return da - db || a.length - b.length;
      });
      if (typeof fsdb.createDirectoriesBulk === 'function') {
        await fsdb.createDirectoriesBulk(novel);
      } else {
        for (const d of novel) {
          await createDir(d, fsdb.getParentPath(d));
        }
      }
      for (const d of novel) knownDirs.add(d);
      return novel.length;
    }
  };
}

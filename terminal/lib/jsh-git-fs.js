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

  async function mkdirp(absPath) {
    const parts = absPath.split('/').filter(Boolean);
    let cur = '';
    for (const p of parts) {
      cur = cur ? `${cur}/${p}` : `/${p}`;
      const ex = await fsdb.getItem(cur);
      if (!ex) {
        await fsdb.createDirectory(cur);
      } else if (ex.type !== 'directory') {
        const e = new Error('ENOTDIR');
        e.code = 'ENOTDIR';
        throw e;
      }
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
      const bin = asBinaryPayload(data);
      if (bin) {
        await fsdb.createFile(path, bin, true);
        return;
      }
      if (typeof data === 'string' && (!opts || !opts.encoding || opts.encoding === 'utf8')) {
        await fsdb.createFile(path, data, true);
        return;
      }
      await fsdb.createFile(path, String(data), true);
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

  return { promises };
}

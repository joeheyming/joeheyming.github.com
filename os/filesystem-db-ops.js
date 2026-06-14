/** @param {new () => object} FileSystemDB */
export function applyFileSystemDbOps(FileSystemDB) {
  Object.assign(FileSystemDB.prototype, {
    // Create symbolic link (target stored as metadata)
    async createSymlink(target, path) {
      if (!this.isInitialized) await this.initialize();

      const existing = await this.getItem(path);
      if (existing) {
        const e = new Error(`File already exists: ${path}`);
        e.code = 'EEXIST';
        throw e;
      }

      const parentPath = this.getParentPath(path);
      const parent = await this.getItem(parentPath);
      if (!parent || parent.type !== 'directory') {
        const e = new Error(`Parent directory does not exist: ${parentPath}`);
        e.code = 'ENOENT';
        throw e;
      }

      const link = {
        path,
        type: 'symlink',
        parentPath,
        target: String(target),
        created: new Date(),
        modified: new Date()
      };

      const transaction = await this._safeTransaction(['files'], 'readwrite');
      return new Promise((resolve, reject) => {
        const store = transaction.objectStore('files');
        const request = store.put(link);

        request.onsuccess = () => {
          FileSystemDB.emit('create', path, { type: 'symlink', parentPath });
          resolve(link);
        };
        request.onerror = () => reject(request.error);
      });
    },

    // Create file (string, Uint8Array, or ArrayBuffer — binary for e.g. git packfiles)
    /**
     * @param {string} path
     * @param {string|Uint8Array|ArrayBuffer|null|undefined} [content='']
     * @param {boolean} [overwrite=false]
     */
    async createFile(path, content = '', overwrite = false) {
      if (!this.isInitialized) await this.initialize();

      // Check if file already exists
      const existing = await this.getItem(path);
      if (existing && !overwrite) {
        const e = new Error(`File already exists: ${path}`);
        e.code = 'EEXIST';
        throw e;
      }

      const parentPath = this.getParentPath(path);
      const parent = await this.getItem(parentPath);
      if (!parent || parent.type !== 'directory') {
        const e = new Error(`Parent directory does not exist: ${parentPath}`);
        e.code = 'ENOENT';
        throw e;
      }

      let textContent = '';
      /** @type {ArrayBuffer|undefined} */
      let contentBytes;
      let size;
      // Keep extension-based type for binary files so desktop open routes to image/audio apps.
      const mimeType = FileSystemDB.getMimeType(path);

      if (content instanceof Uint8Array) {
        const u8 = content;
        const sliced = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
        contentBytes = /** @type {ArrayBuffer} */ (sliced);
        size = u8.byteLength;
      } else if (content instanceof ArrayBuffer) {
        contentBytes = content;
        size = content.byteLength;
      } else {
        textContent = content == null ? '' : String(content);
        size = new Blob([textContent]).size;
      }

      const file = {
        path,
        type: 'file',
        parentPath,
        content: textContent,
        mimeType,
        size,
        created: existing ? existing.created : new Date(),
        modified: new Date()
      };
      if (contentBytes) {
        file.contentBytes = contentBytes;
      }

      const transaction = await this._safeTransaction(['files'], 'readwrite');
      return new Promise((resolve, reject) => {
        const store = transaction.objectStore('files');
        const request = store.put(file);

        request.onsuccess = () => {
          FileSystemDB.emit('create', path, { type: 'file', parentPath });
          resolve(file);
        };
        request.onerror = () => reject(request.error);
      });
    },

    /**
     * Fast file create/overwrite — skips existence and parent-directory checks.
     * Callers (e.g. jsh-git-fs) must ensure the parent directory already exists.
     * @param {string} path
     * @param {string|Uint8Array|ArrayBuffer} content
     * @param {string|null} [parentPath] - pre-computed parent (avoids re-parsing)
     */
    async createFileFast(path, content, parentPath) {
      if (!this.isInitialized) await this.initialize();
      const pp = parentPath != null ? parentPath : this.getParentPath(path);

      let textContent = '';
      /** @type {ArrayBuffer|undefined} */
      let contentBytes;
      let size;
      const mimeType = FileSystemDB.getMimeType(path);

      if (content instanceof Uint8Array) {
        const u8 = content;
        contentBytes = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
        size = u8.byteLength;
      } else if (content instanceof ArrayBuffer) {
        contentBytes = content;
        size = content.byteLength;
      } else {
        textContent = content == null ? '' : String(content);
        size = textContent.length;
      }

      const file = {
        path,
        type: 'file',
        parentPath: pp,
        content: textContent,
        mimeType,
        size,
        created: new Date(),
        modified: new Date()
      };
      if (contentBytes) {
        file.contentBytes = contentBytes;
      }

      const transaction = await this._safeTransaction(['files'], 'readwrite');
      return new Promise((resolve, reject) => {
        const store = transaction.objectStore('files');
        const request = store.put(file);
        request.onsuccess = () => resolve(file);
        request.onerror = () => reject(request.error);
      });
    },

    /**
     * Begin a batch write session. Returns a writer that queues puts into a
     * single readwrite transaction, flushing every `batchSize` items or on
     * explicit `flush()`. Much faster than one-transaction-per-file during
     * git clone checkout.
     * @param {{ batchSize?: number }} [opts]
     */
    beginBatchWrite(opts) {
      const batchSize = (opts && opts.batchSize) || 200;
      /** @type {Array<{path: string, type: string, parentPath: string|null, content?: string, contentBytes?: ArrayBuffer, mimeType?: string, size?: number, created: Date, modified: Date}>} */
      let pending = [];
      const self = this;

      async function flush() {
        if (pending.length === 0) return;
        const batch = pending;
        pending = [];
        const tx = await self._safeTransaction(['files'], 'readwrite');
        const store = tx.objectStore('files');
        for (const item of batch) {
          store.put(item);
        }
        await new Promise((resolve, reject) => {
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
        });
        // Single coalesced change event instead of one per file
        if (batch.length > 0) {
          FileSystemDB.emit('change', batch[0].parentPath || '/', {
            type: 'batch',
            count: batch.length
          });
        }
      }

      return {
        /** @param {string} path @param {string|Uint8Array|ArrayBuffer} content @param {string|null} [parentPath] */
        async putFile(path, content, parentPath) {
          const pp = parentPath != null ? parentPath : self.getParentPath(path);
          let textContent = '';
          /** @type {ArrayBuffer|undefined} */
          let contentBytes;
          let size;
          const mimeType = FileSystemDB.getMimeType(path);
          if (content instanceof Uint8Array) {
            contentBytes = content.buffer.slice(
              content.byteOffset,
              content.byteOffset + content.byteLength
            );
            size = content.byteLength;
          } else if (content instanceof ArrayBuffer) {
            contentBytes = content;
            size = content.byteLength;
          } else {
            textContent = content == null ? '' : String(content);
            size = textContent.length;
          }
          const file = {
            path,
            type: 'file',
            parentPath: pp,
            content: textContent,
            mimeType,
            size,
            created: new Date(),
            modified: new Date()
          };
          if (contentBytes) file.contentBytes = contentBytes;
          pending.push(file);
          if (pending.length >= batchSize) await flush();
        },
        flush,
        get pendingCount() {
          return pending.length;
        }
      };
    },

    // Create directory
    async createDirectory(path) {
      if (!this.isInitialized) await this.initialize();

      // Check if directory already exists
      const existing = await this.getItem(path);
      if (existing) {
        const e = new Error(`Directory already exists: ${path}`);
        e.code = 'EEXIST';
        throw e;
      }

      const parentPath = this.getParentPath(path);
      if (parentPath !== null) {
        const parent = await this.getItem(parentPath);
        if (!parent || parent.type !== 'directory') {
          const e = new Error(`Parent directory does not exist: ${parentPath}`);
          e.code = 'ENOENT';
          throw e;
        }
      }

      const directory = {
        path,
        type: 'directory',
        parentPath,
        created: new Date(),
        modified: new Date()
      };

      const transaction = await this._safeTransaction(['files'], 'readwrite');
      return new Promise((resolve, reject) => {
        const store = transaction.objectStore('files');
        const request = store.put(directory);

        request.onsuccess = () => {
          FileSystemDB.emit('create', path, { type: 'directory', parentPath });
          resolve(directory);
        };
        request.onerror = () => reject(request.error);
      });
    },

    /**
     * Fast directory create — skips existence and parent checks.
     * Used by mkdirp after it has already verified the path.
     */
    async createDirectoryFast(path, parentPath) {
      if (!this.isInitialized) await this.initialize();
      const pp = parentPath != null ? parentPath : this.getParentPath(path);
      const directory = {
        path,
        type: 'directory',
        parentPath: pp,
        created: new Date(),
        modified: new Date()
      };
      const transaction = await this._safeTransaction(['files'], 'readwrite');
      return new Promise((resolve, reject) => {
        const store = transaction.objectStore('files');
        const request = store.put(directory);
        request.onsuccess = () => resolve(directory);
        request.onerror = () => reject(request.error);
      });
    },

    /**
     * Bulk directory creation in a single readwrite transaction. Skips
     * existence checks (idempotent put). Caller is responsible for ordering
     * (parents before children doesn't matter for IDB, but matters semantically).
     *
     * Designed for git checkout: one tree may have hundreds of unique
     * directories; doing them one-at-a-time costs N transactions × ~30 ms each.
     * This bulk path commits all of them in a single transaction.
     *
     * @param {string[]} paths - absolute directory paths to create
     * @returns {Promise<number>} number of directories written
     */
    async createDirectoriesBulk(paths) {
      if (!this.isInitialized) await this.initialize();
      if (!paths || paths.length === 0) return 0;
      const now = new Date();
      const records = paths.map((p) => ({
        path: p,
        type: 'directory',
        parentPath: this.getParentPath(p),
        created: now,
        modified: now
      }));
      const tx = await this._safeTransaction(['files'], 'readwrite');
      return new Promise((resolve, reject) => {
        const store = tx.objectStore('files');
        for (const rec of records) store.put(rec);
        tx.oncomplete = () => resolve(records.length);
        tx.onerror = () => reject(tx.error);
      });
    },

    // Delete file or directory
    async deleteItem(path, recursive = false) {
      if (!this.isInitialized) await this.initialize();

      const item = await this.getItem(path);
      if (!item) {
        throw new Error(`No such file or directory: ${path}`);
      }

      const itemType = item.type;
      const parentPath = item.parentPath;

      if (item.type === 'directory') {
        const contents = await this.listDirectory(path);
        if (contents.length > 0 && !recursive) {
          throw new Error(`Directory not empty: ${path}`);
        }

        // Delete all contents recursively
        for (const child of contents) {
          await this.deleteItem(child.path, true);
        }
      }

      const transaction = await this._safeTransaction(['files'], 'readwrite');
      return new Promise((resolve, reject) => {
        const store = transaction.objectStore('files');
        const request = store.delete(path);

        request.onsuccess = () => {
          FileSystemDB.emit('delete', path, { type: itemType, parentPath });
          resolve();
        };
        request.onerror = () => reject(request.error);
      });
    },

    // Move/rename file or directory
    async moveItem(oldPath, newPath) {
      if (!this.isInitialized) await this.initialize();

      const item = await this.getItem(oldPath);
      if (!item) {
        throw new Error(`No such file or directory: ${oldPath}`);
      }

      const newParentPath = this.getParentPath(newPath);
      const newParent = await this.getItem(newParentPath);
      if (!newParent || newParent.type !== 'directory') {
        throw new Error(`Parent directory does not exist: ${newParentPath}`);
      }

      // Check if destination already exists
      const existing = await this.getItem(newPath);
      if (existing) {
        throw new Error(`Destination already exists: ${newPath}`);
      }

      // Update the item
      const updatedItem = {
        ...item,
        path: newPath,
        parentPath: newParentPath,
        modified: new Date()
      };

      // If it's a directory, update all children paths
      if (item.type === 'directory') {
        const children = await this.getAllChildren(oldPath);
        const transaction = await this._safeTransaction(['files'], 'readwrite');
        const store = transaction.objectStore('files');

        // Update all children
        for (const child of children) {
          const newChildPath = child.path.replace(oldPath, newPath);
          const newChildParentPath = this.getParentPath(newChildPath);

          const updatedChild = {
            ...child,
            path: newChildPath,
            parentPath: newChildParentPath,
            modified: new Date()
          };

          await new Promise((resolve, reject) => {
            const putRequest = store.put(updatedChild);
            putRequest.onsuccess = () => resolve();
            putRequest.onerror = () => reject(putRequest.error);
          });

          // Delete old child
          await new Promise((resolve, reject) => {
            const deleteRequest = store.delete(child.path);
            deleteRequest.onsuccess = () => resolve();
            deleteRequest.onerror = () => reject(deleteRequest.error);
          });
        }
      }

      // Update the main item and delete old one
      const transaction = await this._safeTransaction(['files'], 'readwrite');
      return new Promise((resolve, reject) => {
        const store = transaction.objectStore('files');

        const putRequest = store.put(updatedItem);
        putRequest.onsuccess = () => {
          const deleteRequest = store.delete(oldPath);
          deleteRequest.onsuccess = () => {
            FileSystemDB.emit('move', newPath, {
              type: item.type,
              oldPath,
              oldParentPath: item.parentPath,
              newParentPath
            });
            resolve(updatedItem);
          };
          deleteRequest.onerror = () => reject(deleteRequest.error);
        };
        putRequest.onerror = () => reject(putRequest.error);
      });
    },

    // Copy file or directory
    async copyItem(sourcePath, destPath, recursive = false) {
      if (!this.isInitialized) await this.initialize();

      const source = await this.getItem(sourcePath);
      if (!source) {
        throw new Error(`No such file or directory: ${sourcePath}`);
      }

      const destParentPath = this.getParentPath(destPath);
      const destParent = await this.getItem(destParentPath);
      if (!destParent || destParent.type !== 'directory') {
        throw new Error(`Parent directory does not exist: ${destParentPath}`);
      }

      // Check if destination already exists
      const existing = await this.getItem(destPath);
      if (existing) {
        throw new Error(`Destination already exists: ${destPath}`);
      }

      if (source.type === 'file') {
        const payload =
          source.contentBytes != null ? new Uint8Array(source.contentBytes) : source.content || '';
        const result = await this.createFile(destPath, payload, false);
        FileSystemDB.emit('copy', destPath, {
          type: 'file',
          sourcePath,
          parentPath: destParentPath
        });
        return result;
      } else if (source.type === 'directory') {
        if (!recursive) {
          throw new Error(`Cannot copy directory without recursive flag: ${sourcePath}`);
        }

        // Create destination directory
        await this.createDirectory(destPath);

        // Copy all children
        const children = await this.listDirectory(sourcePath);
        for (const child of children) {
          const childName = this.getFileName(child.path);
          const newChildPath = this.joinPath(destPath, childName);
          await this.copyItem(child.path, newChildPath, true);
        }

        FileSystemDB.emit('copy', destPath, {
          type: 'directory',
          sourcePath,
          parentPath: destParentPath
        });
        return this.getItem(destPath);
      }
    },

    // Get all children recursively
    async getAllChildren(path) {
      const children = [];
      const directChildren = await this.listDirectory(path);

      for (const child of directChildren) {
        children.push(child);
        if (child.type === 'directory') {
          const grandChildren = await this.getAllChildren(child.path);
          children.push(...grandChildren);
        }
      }

      return children;
    },

    // Utility methods
    getParentPath(path) {
      if (path === '/') return null;
      const parts = path.split('/').filter((p) => p);
      if (parts.length === 0) return '/';
      if (parts.length === 1) return '/';
      return '/' + parts.slice(0, -1).join('/');
    },

    getFileName(path) {
      if (path === '/') return '';
      const parts = path.split('/').filter((p) => p);
      return parts[parts.length - 1] || '';
    },

    // Generate a unique path by appending (1), (2), etc. if path exists
    async getUniquePath(basePath) {
      // Check if path already exists
      const existing = await this.getItem(basePath);
      if (!existing) {
        return basePath;
      }

      const parentPath = this.getParentPath(basePath);
      const fileName = this.getFileName(basePath);

      // Split filename into name and extension
      const lastDot = fileName.lastIndexOf('.');
      let name, ext;
      if (lastDot > 0) {
        name = fileName.substring(0, lastDot);
        ext = fileName.substring(lastDot); // includes the dot
      } else {
        name = fileName;
        ext = '';
      }

      // Try incrementing numbers until we find a unique name
      let counter = 1;
      let newPath;
      do {
        const newName = `${name} (${counter})${ext}`;
        newPath = parentPath ? `${parentPath}/${newName}` : `/${newName}`;
        counter++;
      } while (await this.getItem(newPath));

      return newPath;
    },

    joinPath(parent, child) {
      if (parent === '/') return `/${child}`;
      return `${parent}/${child}`;
    }
  });
}

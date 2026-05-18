/** @param {new () => object} FileSystemDB */
export function applyFileSystemDbStore(FileSystemDB) {
  Object.assign(FileSystemDB.prototype, {
    // Initialize the database
    async initialize() {
      if (this.isInitialized) return;

      return new Promise((resolve, reject) => {
        const request = indexedDB.open(this.dbName, this.dbVersion);

        request.onerror = () => {
          console.error('Failed to open IndexedDB:', request.error);
          reject(request.error);
        };

        request.onsuccess = () => {
          const db = request.result;
          this.db = db;
          this.isInitialized = true;

          // Another tab opened the same DB at a newer version. If we hold
          // the connection open the upgrade hangs there and every
          // subsequent transaction on *our* side throws InvalidStateError
          // ("transaction on a closed database"). Close cleanly and drop
          // our cached handle so the next call lazily re-initializes.
          db.onversionchange = () => {
            FileSystemDB._debug('IndexedDB versionchange — closing connection');
            try {
              db.close();
            } catch (_) {
              /* already closed */
            }
            if (this.db === db) {
              this.db = null;
              this.isInitialized = false;
            }
          };

          // Fires when the connection closes abnormally (storage cleared,
          // DB deleted from devtools, OS quota hit). Same reset so the
          // next transaction re-opens instead of throwing on a dead handle.
          db.onclose = () => {
            FileSystemDB._debug('IndexedDB connection closed unexpectedly');
            if (this.db === db) {
              this.db = null;
              this.isInitialized = false;
            }
          };

          FileSystemDB._debug('IndexedDB filesystem initialized');
          // Best-effort post-open backfill for the v2 schema. Runs once per
          // process and updates rows that lack mode/uid/gid; safe to call on
          // an already-migrated DB because we no-op when the metadata flag
          // is set. Fire-and-forget so we don't block initialize.
          this.backfillModeUidGid?.().catch((e) =>
            FileSystemDB._debug(`backfillModeUidGid failed: ${e?.message || e}`)
          );
          resolve();
        };

        request.onupgradeneeded = (event) => {
          const db = /** @type {IDBOpenDBRequest} */ (event.target).result;

          // Create object stores
          if (!db.objectStoreNames.contains('files')) {
            const fileStore = db.createObjectStore('files', { keyPath: 'path' });
            fileStore.createIndex('parentPath', 'parentPath', { unique: false });
            fileStore.createIndex('type', 'type', { unique: false });
          }

          if (!db.objectStoreNames.contains('metadata')) {
            db.createObjectStore('metadata', { keyPath: 'key' });
          }
          // For older schemas (event.oldVersion < 2) we mark the v2 backfill
          // as pending. The actual mutation runs after the connection is
          // resolved in onsuccess (see backfillModeUidGid), because
          // upgradeneeded transactions don't let us await async helpers
          // cleanly.
          if (typeof event.oldVersion === 'number' && event.oldVersion < 2) {
            try {
              const t = /** @type {IDBOpenDBRequest} */ (event.target).transaction;
              if (t && db.objectStoreNames.contains('metadata')) {
                const meta = t.objectStore('metadata');
                meta.put({ key: 'fs_schema_v2_backfill_needed', value: true });
              }
            } catch (_) {
              /* the post-open backfill is idempotent */
            }
          }
        };
      });
    },

    /**
     * v2 schema backfill: ensure every row has reasonable mode / uid / gid
     * defaults. Idempotent: a metadata flag (`fs_schema_v2_backfill_done`)
     * gates further runs, and the per-row check still skips rows that
     * already carry the fields. Safe to call multiple times.
     */
    async backfillModeUidGid() {
      if (!this.isInitialized) return;
      try {
        const done = await this.getMetadata('fs_schema_v2_backfill_done');
        if (done === true) return;
      } catch (_) {
        /* ignore */
      }
      const defaultUserUid = 1000;
      const defaultUserGid = 1000;
      const fileMode = 0o644;
      const dirMode = 0o755;
      const symlinkMode = 0o777;
      let changed = 0;
      let touched = 0;

      const rows = await new Promise((resolve, reject) => {
        const tx = this.db.transaction(['files'], 'readonly');
        const store = tx.objectStore('files');
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });

      const updates = [];
      for (const row of rows) {
        let mutated = false;
        const isRoot =
          typeof row.path === 'string' &&
          (row.path === '/etc' ||
            row.path === '/etc/passwd' ||
            row.path === '/etc/shadow' ||
            row.path === '/etc/group' ||
            row.path.startsWith('/root') ||
            row.path === '/bin/jsh');
        if (row.mode == null) {
          row.mode =
            row.type === 'directory'
              ? dirMode
              : row.type === 'symlink'
              ? symlinkMode
              : fileMode;
          mutated = true;
        }
        if (row.uid == null) {
          row.uid = isRoot ? 0 : defaultUserUid;
          mutated = true;
        }
        if (row.gid == null) {
          row.gid = isRoot ? 0 : defaultUserGid;
          mutated = true;
        }
        if (mutated) {
          updates.push(row);
          changed++;
        }
        touched++;
      }

      if (updates.length > 0) {
        await new Promise((resolve, reject) => {
          const tx = this.db.transaction(['files'], 'readwrite');
          const store = tx.objectStore('files');
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          for (const row of updates) store.put(row);
        });
      }

      try {
        await this.setMetadata('fs_schema_v2_backfill_done', true);
        await this.setMetadata('fs_schema_v2_backfill_stats', {
          changed,
          touched,
          at: Date.now()
        });
      } catch (_) {
        /* ignore */
      }
      FileSystemDB._debug?.(`backfillModeUidGid: updated ${changed}/${touched} rows`);
    },

    // Check if scaffolding exists
    async hasScaffolding() {
      return (await this.getMetadata('scaffolding_created')) === true;
    },

    // Get metadata
    async getMetadata(key) {
      if (!this.isInitialized) await this.initialize();
      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction(['metadata'], 'readonly');
        const store = transaction.objectStore('metadata');
        const request = store.get(key);

        request.onsuccess = () => {
          resolve(request.result ? request.result.value : null);
        };
        request.onerror = () => reject(request.error);
      });
    },

    // Set metadata
    async setMetadata(key, value) {
      if (!this.isInitialized) await this.initialize();
      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction(['metadata'], 'readwrite');
        const store = transaction.objectStore('metadata');
        const request = store.put({ key, value });

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    },

    // Get file or directory by path
    async getItem(path) {
      if (!this.isInitialized) await this.initialize();

      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction(['files'], 'readonly');
        const store = transaction.objectStore('files');
        const request = store.get(path);

        request.onsuccess = () => {
          resolve(request.result || null);
        };
        request.onerror = () => reject(request.error);
      });
    },

    // List directory contents
    async listDirectory(path) {
      if (!this.isInitialized) await this.initialize();

      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction(['files'], 'readonly');
        const store = transaction.objectStore('files');
        const index = store.index('parentPath');
        const request = index.getAll(path);

        request.onsuccess = () => {
          resolve(request.result || []);
        };
        request.onerror = () => reject(request.error);
      });
    },

    /**
     * Names-only directory listing — returns primary keys (full child paths)
     * via `index.getAllKeys`, so IDB does NOT deserialize record values
     * (including potentially-huge `contentBytes` ArrayBuffers).
     *
     * Trace (2026-05-12T22:23) showed `listDirectory.onsuccess` consuming 54%
     * of CPU during git checkout because every readdir was inflating every
     * file's contents just to read filenames. This keys-only path is the
     * fast option for callers (e.g. fs.readdir) that only need names.
     *
     * @param {string} parentPath
     * @returns {Promise<string[]>} absolute paths of direct children
     */
    async listDirectoryNames(parentPath) {
      if (!this.isInitialized) await this.initialize();

      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction(['files'], 'readonly');
        const store = transaction.objectStore('files');
        const index = store.index('parentPath');
        const request = index.getAllKeys(parentPath);

        request.onsuccess = () => {
          resolve(request.result || []);
        };
        request.onerror = () => reject(request.error);
      });
    },

    // Read directory contents (OS-compatible interface)
    async readdir(path) {
      const entries = await this.listDirectory(path);
      return entries.map((entry) => ({
        name: this.getFileName(entry.path),
        type: entry.type,
        size: entry.size || 0,
        modified: entry.modified,
        mode: entry.mode || (entry.type === 'directory' ? 0o755 : 0o644)
      }));
    },

    // Stat file/directory (OS-compatible interface - alias for getItem)
    async stat(path) {
      return this.getItem(path);
    },

    // Open file (OS-compatible interface)
    async open(path, flags = 'r', mode = 0o644) {
      const item = await this.getItem(path);
      if (!item) {
        if (flags.includes('w') || flags.includes('a')) {
          // Create file if it doesn't exist and we're writing
          await this.createFile(path, '', true);
          return { path, flags, mode };
        } else {
          throw new Error(`No such file: ${path}`);
        }
      }
      return { path, flags, mode, item };
    },

    // Make directory (OS-compatible interface - alias for createDirectory)
    async mkdir(path, _mode = 0o755) {
      return this.createDirectory(path);
    },

    // Remove directory (OS-compatible interface)
    async rmdir(path) {
      const item = await this.getItem(path);
      if (!item) {
        throw new Error(`No such directory: ${path}`);
      }
      if (item.type !== 'directory') {
        throw new Error(`Not a directory: ${path}`);
      }
      return this.deleteItem(path);
    },

    // Remove file (OS-compatible interface)
    async unlink(path) {
      const item = await this.getItem(path);
      if (!item) {
        throw new Error(`No such file: ${path}`);
      }
      if (item.type !== 'file' && item.type !== 'symlink') {
        throw new Error(`Not a file: ${path}`);
      }
      return this.deleteItem(path);
    },

    // Get filesystem statistics
    async getStats() {
      if (!this.isInitialized) await this.initialize();

      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction(['files'], 'readonly');
        const store = transaction.objectStore('files');
        const request = store.getAll();

        request.onsuccess = () => {
          const items = request.result;
          const stats = {
            totalItems: items.length,
            files: items.filter((item) => item.type === 'file').length,
            directories: items.filter((item) => item.type === 'directory').length,
            totalSize: items
              .filter((item) => item.type === 'file')
              .reduce((sum, file) => sum + (file.size || 0), 0)
          };
          resolve(stats);
        };
        request.onerror = () => reject(request.error);
      });
    },

    // Clear the entire database
    async clearDatabase() {
      if (!this.isInitialized) await this.initialize();

      const transaction = this.db.transaction(['files', 'metadata'], 'readwrite');
      const filesStore = transaction.objectStore('files');
      const metadataStore = transaction.objectStore('metadata');

      return new Promise((resolve, reject) => {
        filesStore.clear();
        metadataStore.clear();

        transaction.oncomplete = () => {
          FileSystemDB._debug('Database cleared successfully');
          resolve();
        };

        transaction.onerror = () => {
          console.error('Error clearing database:', transaction.error);
          reject(transaction.error);
        };
      });
    }
  });
}

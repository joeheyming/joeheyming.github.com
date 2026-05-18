import { applyFileSystemDbListeners } from './filesystem-db-listeners.js';
import { applyFileSystemDbMime } from './filesystem-db-mime.js';
import { applyFileSystemDbStore } from './filesystem-db-store.js';
import { applyFileSystemDbScaffold } from './filesystem-db-scaffold.js';
import { applyFileSystemDbOps } from './filesystem-db-ops.js';
import { applyFileSystemDbProc } from './filesystem-db-proc.js';
import { applyFileSystemDbPerms } from './filesystem-db-perms.js';

export class FileSystemDB {
  constructor() {
    this.dbName = 'HeymingTerminalFS';
    // v1: original schema.
    // v2: backfill mode/uid/gid defaults on existing rows so SecurityManager
    //     enforcement (C21) doesn't lock users out of their own files when
    //     the feature flag flips on. See `backfillModeUidGid` below.
    this.dbVersion = 2;
    this.db = null;
    this.isInitialized = false;
  }

  static async getInstance() {
    const topWindow = window.top || window;

    if (!topWindow._fileSystemDBInstance) {
      topWindow._fileSystemDBInstance = new FileSystemDB();
      await topWindow._fileSystemDBInstance.initialize();
    }

    return topWindow._fileSystemDBInstance;
  }
}

applyFileSystemDbListeners(FileSystemDB);
applyFileSystemDbMime(FileSystemDB);
applyFileSystemDbStore(FileSystemDB);
applyFileSystemDbScaffold(FileSystemDB);
applyFileSystemDbOps(FileSystemDB);
applyFileSystemDbProc(FileSystemDB);
applyFileSystemDbPerms(FileSystemDB);

window.FileSystemDB = FileSystemDB;

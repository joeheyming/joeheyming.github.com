import { applyFileSystemDbListeners } from './filesystem-db-listeners.js';
import { applyFileSystemDbMime } from './filesystem-db-mime.js';
import { applyFileSystemDbStore } from './filesystem-db-store.js';
import { applyFileSystemDbScaffold } from './filesystem-db-scaffold.js';
import { applyFileSystemDbOps } from './filesystem-db-ops.js';

export class FileSystemDB {
  constructor() {
    this.dbName = 'HeymingTerminalFS';
    this.dbVersion = 1;
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

window.FileSystemDB = FileSystemDB;

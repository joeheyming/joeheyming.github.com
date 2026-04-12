// IndexedDB-based Filesystem for Heyming Terminal
// Works both as ES module (import) and as regular script (window.FileSystemDB)
class FileSystemDB {
  /**
   * Debug logging - only logs when DEBUG flag is set
   */
  static _debug(...args) {
    const debug = window.HeymingOS?.Config?.DEBUG || window.parent?.HeymingOS?.Config?.DEBUG;
    if (debug) {
      console.log('[FileSystemDB]', ...args);
    }
  }

  /**
   * Get the shared listeners object from the top window
   * This ensures all iframes share the same event bus
   */
  static _getListeners() {
    // Use window.top to share listeners across all iframes
    const topWindow = window.top || window;
    if (!topWindow._fileSystemListeners) {
      topWindow._fileSystemListeners = {
        create: [],
        delete: [],
        move: [],
        copy: [],
        change: [] // Catch-all for any change
      };
    }
    return topWindow._fileSystemListeners;
  }

  /**
   * Subscribe to filesystem events
   * @param {string} event - Event type: 'create', 'delete', 'move', 'copy', 'change'
   * @param {Function} callback - Callback function(path, details)
   * @returns {Function} Unsubscribe function
   */
  static on(event, callback) {
    const listeners = FileSystemDB._getListeners();
    if (!listeners[event]) {
      listeners[event] = [];
    }
    listeners[event].push(callback);

    // Return unsubscribe function
    return () => {
      const index = listeners[event].indexOf(callback);
      if (index > -1) {
        listeners[event].splice(index, 1);
      }
    };
  }

  /**
   * Emit a filesystem event
   * @param {string} event - Event type
   * @param {string} path - Path that changed
   * @param {Object} details - Additional details about the change
   */
  static emit(event, path, details = {}) {
    const listeners = FileSystemDB._getListeners();

    // Emit specific event
    if (listeners[event]) {
      listeners[event].forEach((cb) => {
        try {
          cb(path, { event, ...details });
        } catch (e) {
          console.error('Filesystem event handler error:', e);
        }
      });
    }

    // Always emit 'change' for any event
    if (event !== 'change' && listeners.change) {
      listeners.change.forEach((cb) => {
        try {
          cb(path, { event, ...details });
        } catch (e) {
          console.error('Filesystem event handler error:', e);
        }
      });
    }
  }

  /**
   * True if `path` is exactly `dir` or a strict descendant (path segment boundary).
   * Avoids substring bugs from `path.startsWith(dir)` when sibling names share a prefix
   * (e.g. `/home/username/a` must not match `/home/user`).
   * @param {string} path
   * @param {string} dir
   */
  static pathIsDescendantOrSelf(path, dir) {
    if (path == null || dir == null) return false;
    const strip = (p) => {
      if (p === '/' || p === '') return p;
      return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;
    };
    const p = strip(path);
    const d = strip(dir);
    if (p === d) return true;
    if (d === '/') return typeof p === 'string' && p.startsWith('/');
    return p.startsWith(d + '/');
  }

  // MIME type mappings
  static MIME_TYPES = {
    // Text
    txt: 'text/plain',
    md: 'text/markdown',
    markdown: 'text/markdown',
    html: 'text/html',
    htm: 'text/html',
    css: 'text/css',
    csv: 'text/csv',
    xml: 'text/xml',

    // Code/Scripts
    js: 'text/javascript',
    mjs: 'text/javascript',
    ts: 'text/typescript',
    json: 'application/json',
    py: 'text/x-python',
    sh: 'text/x-shellscript',
    bash: 'text/x-shellscript',
    zsh: 'text/x-shellscript',
    rb: 'text/x-ruby',
    php: 'text/x-php',
    java: 'text/x-java',
    c: 'text/x-c',
    cpp: 'text/x-c++',
    h: 'text/x-c',
    go: 'text/x-go',
    rs: 'text/x-rust',
    sql: 'text/x-sql',
    yaml: 'text/yaml',
    yml: 'text/yaml',
    toml: 'text/x-toml',
    ini: 'text/x-ini',
    conf: 'text/plain',
    log: 'text/plain',

    // Images
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    webp: 'image/webp',
    ico: 'image/x-icon',
    bmp: 'image/bmp',

    // Audio
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    flac: 'audio/flac',
    m4a: 'audio/mp4',

    // Video
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    avi: 'video/x-msvideo',
    mkv: 'video/x-matroska',

    // YouTube link
    ytlink: 'application/x-youtube',

    // Documents
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',

    // Archives
    zip: 'application/zip',
    tar: 'application/x-tar',
    gz: 'application/gzip',
    '7z': 'application/x-7z-compressed',
    rar: 'application/x-rar-compressed',

    // Fonts
    ttf: 'font/ttf',
    otf: 'font/otf',
    woff: 'font/woff',
    woff2: 'font/woff2',

    // Other
    bin: 'application/octet-stream',
    exe: 'application/x-executable'
  };

  constructor() {
    this.dbName = 'HeymingTerminalFS';
    this.dbVersion = 1;
    this.db = null;
    this.isInitialized = false;
  }

  /**
   * Get or create a shared singleton instance
   * This ensures all components use the same FileSystemDB instance
   * @returns {Promise<FileSystemDB>} Initialized FileSystemDB instance
   */
  static async getInstance() {
    // Store singleton in window.top to share across iframes
    const topWindow = window.top || window;

    if (!topWindow._fileSystemDBInstance) {
      topWindow._fileSystemDBInstance = new FileSystemDB();
      await topWindow._fileSystemDBInstance.initialize();
    }

    return topWindow._fileSystemDBInstance;
  }

  /**
   * Get MIME type from filename or extension
   * @param {string} filename - Filename or path
   * @returns {string} MIME type
   */
  static getMimeType(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    return FileSystemDB.MIME_TYPES[ext] || 'application/octet-stream';
  }

  /**
   * MIME type for routing opens to apps (Notepad, image viewer, …).
   * Prefer a stored `mimeType` when it is specific; `application/octet-stream` (and common
   * misspellings) is ignored so the path extension can supply `audio/*`, `image/*`, etc.
   * @param {string|{ path?: string, mimeType?: string }} itemOrPath - Virtual path or file item
   * @returns {string}
   */
  static mimeTypeForOpen(itemOrPath) {
    if (!itemOrPath) return 'application/octet-stream';
    const pathStr = typeof itemOrPath === 'string' ? itemOrPath : itemOrPath.path || '';
    const fromPath = pathStr ? FileSystemDB.getMimeType(pathStr) : 'application/octet-stream';

    if (typeof itemOrPath === 'object' && itemOrPath.mimeType != null) {
      const stored = String(itemOrPath.mimeType).trim();
      if (!stored) return fromPath;
      // Binary uploads used to force application/octet-stream in createFile — ignore that so
      // .mp3 / .gif / … still route to media-player / image-viewer via extension.
      const genericBinary =
        stored === 'application/octet-stream' || /^application\/octe[ct]+-stream$/i.test(stored);
      if (!genericBinary) return stored;
    }

    let result = fromPath || 'application/octet-stream';

    // Extensionless files with string content are very likely plain text (e.g. /etc/passwd,
    // Makefile, LICENSE, Dockerfile). Sniff content to upgrade from octet-stream to text/plain.
    if (result === 'application/octet-stream' && typeof itemOrPath === 'object') {
      const hasTextContent =
        typeof itemOrPath.content === 'string' && itemOrPath.content.length > 0;
      const hasBinaryContent = itemOrPath.contentBytes != null;
      if (hasTextContent && !hasBinaryContent) {
        result = 'text/plain';
      }
    }

    return result;
  }

  /**
   * Payload for postMessage to apps: string from `content`, or a copy of `contentBytes`
   * (binary files store bytes in IndexedDB with an empty string `content`).
   * For `ArrayBufferView` values, copies only `byteOffset`…`byteOffset+byteLength` so shared
   * backing buffers do not leak extra bytes to apps (`.buffer` on a view is often wider).
   * @param {{ type?: string, content?: string, contentBytes?: ArrayBuffer|ArrayBufferView }} item
   * @returns {string|ArrayBuffer}
   */
  static getContentForApp(item) {
    if (!item || item.type !== 'file') return '';
    if (item.contentBytes != null) {
      const raw = item.contentBytes;
      if (raw instanceof ArrayBuffer) {
        return raw.slice(0);
      }
      if (ArrayBuffer.isView(raw)) {
        return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
      }
    }
    return item.content == null ? '' : String(item.content);
  }

  /**
   * UTF-8 string for text previews and editors. Uses non-empty `content`, else decodes `contentBytes`.
   * Returns '' for empty files or likely binary (NUL within the first 8 KiB).
   *
   * @param {{ type?: string, content?: string, contentBytes?: ArrayBuffer|ArrayBufferView }} item
   * @returns {string}
   */
  static getUtf8TextForDisplay(item) {
    if (!item || item.type !== 'file') {
      return '';
    }
    if (item.content != null && item.content !== '') {
      return String(item.content);
    }
    const raw = item.contentBytes;
    if (raw == null) {
      return '';
    }
    let u8;
    if (raw instanceof ArrayBuffer) {
      u8 = new Uint8Array(raw);
    } else if (ArrayBuffer.isView(raw)) {
      u8 = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    } else {
      return '';
    }
    if (u8.byteLength === 0) {
      return '';
    }
    const maxSample = 8192;
    const sample = u8.byteLength > maxSample ? u8.subarray(0, maxSample) : u8;
    if (sample.indexOf(0) !== -1) {
      return '';
    }
    return new TextDecoder('utf-8', { fatal: false }).decode(u8);
  }

  /**
   * Check if a MIME type is text-based (editable in notepad)
   * @param {string} mimeType - MIME type to check
   * @returns {boolean}
   */
  static isTextMimeType(mimeType) {
    if (!mimeType) return false;
    return (
      mimeType.startsWith('text/') ||
      mimeType === 'application/json' ||
      mimeType === 'application/xml' ||
      mimeType === 'application/javascript'
    );
  }

  /**
   * Get MIME type for a file item
   * @param {Object} item - File item from filesystem
   * @returns {string} MIME type
   */
  getMimeTypeForItem(item) {
    if (item.type === 'directory') return 'inode/directory';
    return FileSystemDB.mimeTypeForOpen(item);
  }

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
        this.db = request.result;
        this.isInitialized = true;
        FileSystemDB._debug('IndexedDB filesystem initialized');
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Create object stores
        if (!db.objectStoreNames.contains('files')) {
          const fileStore = db.createObjectStore('files', { keyPath: 'path' });
          fileStore.createIndex('parentPath', 'parentPath', { unique: false });
          fileStore.createIndex('type', 'type', { unique: false });
        }

        if (!db.objectStoreNames.contains('metadata')) {
          db.createObjectStore('metadata', { keyPath: 'key' });
        }
      };
    });
  }

  // Create default filesystem structure
  async createScaffolding(username = null) {
    const _ls = (key) => {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    };
    const user = username || window.HeymingOS?.Config?.USER || _ls('heymingOS_username') || 'user';
    const host = window.HeymingOS?.Config?.HOSTNAME || _ls('heymingOS_hostname') || 'heyming-os';
    const homeDir = `/home/${user}`;
    const daysSinceEpoch = Math.floor(Date.now() / 86400000);
    const defaultStructure = [
      // Root directory
      { path: '/', type: 'directory', parentPath: null, created: new Date(), modified: new Date() },

      // Home structure
      {
        path: '/home',
        type: 'directory',
        parentPath: '/',
        created: new Date(),
        modified: new Date()
      },
      {
        path: homeDir,
        type: 'directory',
        parentPath: '/home',
        created: new Date(),
        modified: new Date()
      },
      {
        path: `${homeDir}/Desktop`,
        type: 'directory',
        parentPath: homeDir,
        created: new Date(),
        modified: new Date()
      },
      {
        path: `${homeDir}/Documents`,
        type: 'directory',
        parentPath: homeDir,
        created: new Date(),
        modified: new Date()
      },
      {
        path: `${homeDir}/Downloads`,
        type: 'directory',
        parentPath: homeDir,
        created: new Date(),
        modified: new Date()
      },
      {
        path: `${homeDir}/Pictures`,
        type: 'directory',
        parentPath: homeDir,
        created: new Date(),
        modified: new Date()
      },
      {
        path: `${homeDir}/Music`,
        type: 'directory',
        parentPath: homeDir,
        created: new Date(),
        modified: new Date()
      },
      {
        path: `${homeDir}/Videos`,
        type: 'directory',
        parentPath: homeDir,
        created: new Date(),
        modified: new Date()
      },
      {
        path: `${homeDir}/Videos/Never Gonna Give You Up.ytlink`,
        type: 'file',
        parentPath: `${homeDir}/Videos`,
        content: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        mimeType: 'application/x-youtube',
        created: new Date(),
        modified: new Date(),
        size: 43
      },
      {
        path: `${homeDir}/Videos/Keyboard Cat.ytlink`,
        type: 'file',
        parentPath: `${homeDir}/Videos`,
        content: 'https://www.youtube.com/watch?v=J---aiyznGQ',
        mimeType: 'application/x-youtube',
        created: new Date(),
        modified: new Date(),
        size: 43
      },

      // System directories
      {
        path: '/bin',
        type: 'directory',
        parentPath: '/',
        created: new Date(),
        modified: new Date()
      },
      {
        path: '/etc',
        type: 'directory',
        parentPath: '/',
        created: new Date(),
        modified: new Date()
      },
      {
        path: '/tmp',
        type: 'directory',
        parentPath: '/',
        created: new Date(),
        modified: new Date()
      },
      {
        path: '/var',
        type: 'directory',
        parentPath: '/',
        created: new Date(),
        modified: new Date()
      },

      // Default files
      {
        path: `${homeDir}/Documents/readme.txt`,
        type: 'file',
        parentPath: `${homeDir}/Documents`,
        content:
          'Welcome to Heyming OS!\n\nThis is a persistent filesystem powered by IndexedDB.\nYour files will be saved between sessions!\n\nTry creating some files with:\n- touch myfile.txt\n- echo "Hello World" > hello.txt\n- mkdir myfolder\n\nHave fun exploring!',
        created: new Date(),
        modified: new Date(),
        size: 0
      },
      {
        path: `${homeDir}/Documents/secret.txt`,
        type: 'file',
        parentPath: `${homeDir}/Documents`,
        content:
          '🤫 You found the secret file!\n\nThis file persists between browser sessions.\nTry editing it and refreshing the page!',
        created: new Date(),
        modified: new Date(),
        size: 0
      },
      {
        path: `${homeDir}/Pictures/tiger.svg`,
        type: 'file',
        parentPath: `${homeDir}/Pictures`,
        content: 'https://upload.wikimedia.org/wikipedia/commons/f/fd/Ghostscript_Tiger.svg',
        created: new Date(),
        modified: new Date(),
        size: 0
      },
      {
        path: `${homeDir}/Music/never_gonna_give_you_up.mp3`,
        type: 'file',
        parentPath: `${homeDir}/Music`,
        content:
          '🎵 Rick Astley - Never Gonna Give You Up\n[This would be audio data in a real filesystem]',
        created: new Date(),
        modified: new Date(),
        size: 0
      },
      {
        path: '/bin/jsh',
        type: 'file',
        parentPath: '/bin',
        content: '#!/bin/jsh\n# Joe Shell - jsh executable\n# This is the shell interpreter itself',
        created: new Date(),
        modified: new Date(),
        size: 0
      },
      {
        path: '/etc/passwd',
        type: 'file',
        parentPath: '/etc',
        content:
          'root:x:0:0:root:/root:/bin/jsh\n' +
          'daemon:x:1:1:daemon:/:/bin/false\n' +
          'nobody:x:65534:65534:nobody:/nonexistent:/bin/false\n' +
          `${user}:x:1000:1000:${user}:${homeDir}:/bin/jsh\n`,
        created: new Date(),
        modified: new Date(),
        size: 0
      },
      {
        path: '/etc/shadow',
        type: 'file',
        parentPath: '/etc',
        content:
          `root:*:${daysSinceEpoch}:0:99999:7:::\n` +
          `daemon:*:${daysSinceEpoch}:0:99999:7:::\n` +
          `nobody:*:${daysSinceEpoch}:0:99999:7:::\n` +
          `${user}:*:${daysSinceEpoch}:0:99999:7:::\n`,
        created: new Date(),
        modified: new Date(),
        size: 0
      },
      {
        path: '/etc/group',
        type: 'file',
        parentPath: '/etc',
        content:
          'root:x:0:root\n' +
          `${user}:x:1000:${user}\n` +
          `users:x:100:${user}\n` +
          `sudo:x:27:${user}\n`,
        created: new Date(),
        modified: new Date(),
        size: 0
      },
      {
        path: '/etc/hostname',
        type: 'file',
        parentPath: '/etc',
        content: host + '\n',
        created: new Date(),
        modified: new Date(),
        size: 0
      },
      {
        path: '/etc/hosts',
        type: 'file',
        parentPath: '/etc',
        content: `127.0.0.1 localhost\n::1 localhost\n127.0.0.1 ${host}\n`,
        created: new Date(),
        modified: new Date(),
        size: 0
      }
    ];

    // Calculate file sizes
    defaultStructure.forEach((item) => {
      if (item.type === 'file' && item.content) {
        item.size = new Blob([item.content]).size;
      }
    });

    // Store all default items
    const transaction = this.db.transaction(['files'], 'readwrite');
    const store = transaction.objectStore('files');

    for (const item of defaultStructure) {
      await new Promise((resolve, reject) => {
        const request = store.put(item);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    }

    // Set metadata to indicate scaffolding is complete
    await this.setMetadata('scaffolding_created', true);
    FileSystemDB._debug('Filesystem scaffolding created');
  }

  // Check if scaffolding exists
  async hasScaffolding() {
    return (await this.getMetadata('scaffolding_created')) === true;
  }

  // Get metadata
  async getMetadata(key) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['metadata'], 'readonly');
      const store = transaction.objectStore('metadata');
      const request = store.get(key);

      request.onsuccess = () => {
        resolve(request.result ? request.result.value : null);
      };
      request.onerror = () => reject(request.error);
    });
  }

  // Set metadata
  async setMetadata(key, value) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['metadata'], 'readwrite');
      const store = transaction.objectStore('metadata');
      const request = store.put({ key, value });

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

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
  }

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
  }

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
  }

  // Stat file/directory (OS-compatible interface - alias for getItem)
  async stat(path) {
    return this.getItem(path);
  }

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
  }

  // Make directory (OS-compatible interface - alias for createDirectory)
  async mkdir(path, _mode = 0o755) {
    return this.createDirectory(path);
  }

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
  }

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
  }

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

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['files'], 'readwrite');
      const store = transaction.objectStore('files');
      const request = store.put(link);

      request.onsuccess = () => {
        FileSystemDB.emit('create', path, { type: 'symlink', parentPath });
        resolve(link);
      };
      request.onerror = () => reject(request.error);
    });
  }

  // Create file (string, Uint8Array, or ArrayBuffer — binary for e.g. git packfiles)
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
      contentBytes = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
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

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['files'], 'readwrite');
      const store = transaction.objectStore('files');
      const request = store.put(file);

      request.onsuccess = () => {
        FileSystemDB.emit('create', path, { type: 'file', parentPath });
        resolve(file);
      };
      request.onerror = () => reject(request.error);
    });
  }

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

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['files'], 'readwrite');
      const store = transaction.objectStore('files');
      const request = store.put(directory);

      request.onsuccess = () => {
        FileSystemDB.emit('create', path, { type: 'directory', parentPath });
        resolve(directory);
      };
      request.onerror = () => reject(request.error);
    });
  }

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

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['files'], 'readwrite');
      const store = transaction.objectStore('files');
      const request = store.delete(path);

      request.onsuccess = () => {
        FileSystemDB.emit('delete', path, { type: itemType, parentPath });
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

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
      const transaction = this.db.transaction(['files'], 'readwrite');
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
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['files'], 'readwrite');
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
  }

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
  }

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
  }

  // Utility methods
  getParentPath(path) {
    if (path === '/') return null;
    const parts = path.split('/').filter((p) => p);
    if (parts.length === 0) return '/';
    if (parts.length === 1) return '/';
    return '/' + parts.slice(0, -1).join('/');
  }

  getFileName(path) {
    if (path === '/') return '';
    const parts = path.split('/').filter((p) => p);
    return parts[parts.length - 1] || '';
  }

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
  }

  joinPath(parent, child) {
    if (parent === '/') return `/${child}`;
    return `${parent}/${child}`;
  }

  // Initialize filesystem with scaffolding if needed
  async initializeWithScaffolding(username = null) {
    const _su = () => {
      try {
        return localStorage.getItem('heymingOS_username');
      } catch {
        return null;
      }
    };
    const user = username || window.HeymingOS?.Config?.USER || _su() || 'user';
    await this.initialize();

    const hasScaffolding = await this.hasScaffolding();
    FileSystemDB._debug(`Filesystem scaffolding check: ${hasScaffolding}`);

    if (!hasScaffolding) {
      FileSystemDB._debug('No filesystem found, creating scaffolding...');
      await this.createScaffolding(user);
      // Generate /bin files for all registered commands
      await this.generateBinFiles();
      FileSystemDB._debug('Filesystem scaffolding created successfully');
    } else {
      FileSystemDB._debug('Existing filesystem found');
      // Check if critical directories exist
      const homeExists = await this.getItem(`/home/${user}`);
      FileSystemDB._debug(`Home directory exists: ${!!homeExists}`);

      if (!homeExists) {
        FileSystemDB._debug('Home directory missing, recreating scaffolding...');
        await this.createScaffolding(user);
      }

      // Always regenerate /bin files to keep them up to date
      await this.generateBinFiles();
    }
  }

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
  }

  // Generate /bin files for all registered commands
  async generateBinFiles() {
    if (!window.commandRegistry) {
      FileSystemDB._debug('Command registry not available, skipping /bin file generation');
      return;
    }

    FileSystemDB._debug('Generating /bin files for registered commands...');

    // Get all registered commands
    const commands = window.commandRegistry.getCommands();
    FileSystemDB._debug(
      `Found ${commands.length} registered commands:`,
      commands.map((c) => c.name)
    );

    for (const cmd of commands) {
      const binPath = `/bin/${cmd.name}`;

      // Get the actual handler function
      const handler = window.commandRegistry.get(cmd.name);
      if (!handler) continue;

      // Generate the virtual file content
      const content = this.generateCommandFileContent(
        cmd.name,
        handler,
        cmd.description,
        cmd.category
      );

      // Create or update the /bin file
      try {
        await this.createFile(binPath, content, true); // overwrite = true
      } catch (error) {
        console.warn(`Failed to create /bin/${cmd.name}:`, error);
      }
    }

    FileSystemDB._debug(`Generated ${commands.length} /bin files`);
  }

  // Generate the content for a command's /bin file
  generateCommandFileContent(commandName, handler, description, category) {
    // Convert function to string and clean it up
    let functionStr = handler.toString();

    // Try to make the function more readable
    functionStr = functionStr
      .replace(/^\s*function\s*\(/, `function ${commandName}(`)
      .replace(/^\s*\(/, `function ${commandName}(`)
      .replace(/=>\s*{/, `function ${commandName}(terminal, args) {`)
      .replace(/=>\s*/, `function ${commandName}(terminal, args) {\n  return `);

    // If it's an arrow function without braces, add return and closing brace
    if (!functionStr.includes('{') && functionStr.includes('=>')) {
      functionStr = functionStr.replace(/=>\s*(.+)$/, '=> {\n  return $1;\n}');
    }

    return `#!/bin/jsh
// ${commandName} command implementation
// ${description}
// Category: ${category}

${functionStr}

// Command metadata
${commandName}.description = '${description}';
${commandName}.category = '${category}';

module.exports = ${commandName};`;
  }

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
}

// Export for use in other modules (and iframe access)
window.FileSystemDB = FileSystemDB;

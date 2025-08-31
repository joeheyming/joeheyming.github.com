// IndexedDB-based Filesystem for Heyming Terminal
class FileSystemDB {
  constructor() {
    this.dbName = 'HeymingTerminalFS';
    this.dbVersion = 1;
    this.db = null;
    this.isInitialized = false;
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
        console.log('IndexedDB filesystem initialized');
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
  async createScaffolding(username = 'jheyming') {
    const homeDir = `/home/${username}`;
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
        path: `${homeDir}/Pictures/selfie.jpg`,
        type: 'file',
        parentPath: `${homeDir}/Pictures`,
        content: '📸 A totally real selfie file\n[This would be binary data in a real filesystem]',
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
        content: `${username}:x:1000:1000:Joe Heyming:${homeDir}:/bin/jsh\nroot:x:0:0:Root:/root:/bin/bash`,
        created: new Date(),
        modified: new Date(),
        size: 0
      },
      {
        path: '/etc/hosts',
        type: 'file',
        parentPath: '/etc',
        content: '127.0.0.1 localhost\n::1 localhost\n127.0.0.1 heyming-os',
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
    console.log('Filesystem scaffolding created');
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

  // Create file
  async createFile(path, content = '', overwrite = false) {
    if (!this.isInitialized) await this.initialize();

    // Check if file already exists
    const existing = await this.getItem(path);
    if (existing && !overwrite) {
      throw new Error(`File already exists: ${path}`);
    }

    const parentPath = this.getParentPath(path);
    const parent = await this.getItem(parentPath);
    if (!parent || parent.type !== 'directory') {
      throw new Error(`Parent directory does not exist: ${parentPath}`);
    }

    const file = {
      path,
      type: 'file',
      parentPath,
      content,
      size: new Blob([content]).size,
      created: existing ? existing.created : new Date(),
      modified: new Date()
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['files'], 'readwrite');
      const store = transaction.objectStore('files');
      const request = store.put(file);

      request.onsuccess = () => resolve(file);
      request.onerror = () => reject(request.error);
    });
  }

  // Create directory
  async createDirectory(path) {
    if (!this.isInitialized) await this.initialize();

    // Check if directory already exists
    const existing = await this.getItem(path);
    if (existing) {
      throw new Error(`Directory already exists: ${path}`);
    }

    const parentPath = this.getParentPath(path);
    if (parentPath !== null) {
      const parent = await this.getItem(parentPath);
      if (!parent || parent.type !== 'directory') {
        throw new Error(`Parent directory does not exist: ${parentPath}`);
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

      request.onsuccess = () => resolve(directory);
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

      request.onsuccess = () => resolve();
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
        deleteRequest.onsuccess = () => resolve(updatedItem);
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
      return await this.createFile(destPath, source.content, false);
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

      return await this.getItem(destPath);
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

  joinPath(parent, child) {
    if (parent === '/') return `/${child}`;
    return `${parent}/${child}`;
  }

  // Initialize filesystem with scaffolding if needed
  async initializeWithScaffolding(username = 'jheyming') {
    await this.initialize();

    if (!(await this.hasScaffolding())) {
      console.log('No filesystem found, creating scaffolding...');
      await this.createScaffolding(username);
      // Generate /bin files for all registered commands
      await this.generateBinFiles();
    } else {
      console.log('Existing filesystem found');
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
      console.log('Command registry not available, skipping /bin file generation');
      return;
    }

    console.log('Generating /bin files for registered commands...');

    // Get all registered commands
    const commands = window.commandRegistry.getCommands();
    console.log(
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
      const fileItem = {
        path: binPath,
        type: 'file',
        parentPath: '/bin',
        content: content,
        created: new Date(),
        modified: new Date(),
        size: content.length
      };

      try {
        await this.createFile(binPath, content, true); // overwrite = true
      } catch (error) {
        console.warn(`Failed to create /bin/${cmd.name}:`, error);
      }
    }

    console.log(`Generated ${commands.length} /bin files`);
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
      const clearFiles = filesStore.clear();
      const clearMetadata = metadataStore.clear();

      transaction.oncomplete = () => {
        console.log('Database cleared successfully');
        resolve();
      };

      transaction.onerror = () => {
        console.error('Error clearing database:', transaction.error);
        reject(transaction.error);
      };
    });
  }
}

// Export for use in other modules
window.FileSystemDB = FileSystemDB;

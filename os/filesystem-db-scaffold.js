/** @param {new () => object} FileSystemDB */
export function applyFileSystemDbScaffold(FileSystemDB) {
  Object.assign(FileSystemDB.prototype, {
    // Create default filesystem structure
    async createScaffolding(username = null) {
      const _ls = (key) => {
        try {
          return localStorage.getItem(key);
        } catch {
          return null;
        }
      };
      const user =
        username || window.HeymingOS?.Config?.USER || _ls('heymingOS_username') || 'user';
      const host = window.HeymingOS?.Config?.HOSTNAME || _ls('heymingOS_hostname') || 'heyming-os';
      const homeDir = `/home/${user}`;
      const daysSinceEpoch = Math.floor(Date.now() / 86400000);
      const defaultStructure = [
        // Root directory
        {
          path: '/',
          type: 'directory',
          parentPath: null,
          created: new Date(),
          modified: new Date()
        },

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
          content: '/os/assets/never_gonna_give_you_up.mp3',
          mimeType: 'audio/mpeg',
          created: new Date(),
          modified: new Date(),
          size: 0
        },
        {
          path: '/bin/jsh',
          type: 'file',
          parentPath: '/bin',
          content:
            '#!/bin/jsh\n# Joe Shell - jsh executable\n# This is the shell interpreter itself',
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
    },

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
    },

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
    },

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
  });
}

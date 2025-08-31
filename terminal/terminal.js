// Enhanced Terminal for Heyming OS - Modular Version
class Terminal {
  constructor(windowId = null, osInstance = null) {
    this.windowId = windowId;
    this.os = osInstance;
    this.commandHistory = [];
    this.historyIndex = -1;
    this.aliases = {}; // Command aliases
    this.fileSystemDB = new FileSystemDB();
    this.isStandalone = !windowId; // Detect if running standalone
    this.commandsLoaded = false;
    this.filesystemReady = false;

    // Initialize environment variables
    this.env = {
      USER: 'jheyming',
      HOME: '/home/jheyming',
      PWD: '/home/jheyming',
      SHELL: '/bin/jsh',
      TERM: 'heyming-terminal',
      PATH: '/bin:/usr/bin:/usr/local/bin',
      HOSTNAME: 'heyming-os',
      LANG: 'en_US.UTF-8',
      EDITOR: 'nano',
      PAGER: 'less'
    };

    this.currentDirectory = this.env.HOME;

    // Load command history from session storage
    this.loadCommandHistory();

    // Load commands first, then initialize filesystem with /bin files
    this.loadCommands()
      .then(() => {
        this.commandsLoaded = true;
        return this.initializeFilesystem();
      })
      .then(() => {
        this.filesystemReady = true;
        // Initialize terminal after a brief delay
        setTimeout(() => this.initialize(), 100);
      })
      .catch((error) => {
        console.error('Failed to initialize terminal:', error);
        // Fallback to in-memory filesystem
        this.fileSystem = this.initializeFileSystem();
        this.filesystemReady = true;
        this.commandsLoaded = true;
        setTimeout(() => this.initialize(), 100);
      });
  }

  async loadCommands() {
    if (window.commandRegistry) {
      await window.commandRegistry.loadCommands();
    }
  }

  async initializeFilesystem() {
    await this.fileSystemDB.initializeWithScaffolding(this.env.USER);
  }

  initializeFileSystem() {
    return {
      '/': {
        type: 'directory',
        contents: {
          home: {
            type: 'directory',
            contents: {
              [this.env.USER]: {
                type: 'directory',
                contents: {
                  Desktop: { type: 'directory', contents: {} },
                  Documents: {
                    type: 'directory',
                    contents: {
                      'readme.txt': { type: 'file', content: 'Welcome to Heyming OS!' },
                      'secret.txt': { type: 'file', content: '🤫 You found the secret file!' }
                    }
                  },
                  Downloads: { type: 'directory', contents: {} },
                  Pictures: {
                    type: 'directory',
                    contents: {
                      'selfie.jpg': { type: 'file', content: '📸 A totally real selfie file' }
                    }
                  },
                  Music: {
                    type: 'directory',
                    contents: {
                      'never_gonna_give_you_up.mp3': {
                        type: 'file',
                        content: '🎵 Rick Astley - Never Gonna Give You Up'
                      }
                    }
                  },
                  Videos: { type: 'directory', contents: {} }
                }
              }
            }
          },
          bin: {
            type: 'directory',
            contents: {
              bash: { type: 'file', content: '#!/bin/bash' },
              ls: { type: 'file', content: '#!/bin/ls' }
            }
          },
          etc: {
            type: 'directory',
            contents: {
              passwd: {
                type: 'file',
                content: `${this.env.USER}:x:1000:1000:Joe Heyming:${this.env.HOME}:${this.env.SHELL}`
              },
              hosts: { type: 'file', content: '127.0.0.1 localhost\n::1 localhost' }
            }
          }
        }
      }
    };
  }

  initialize() {
    let terminalInput;

    if (this.isStandalone) {
      // Standalone mode - use direct element IDs
      terminalInput = document.getElementById('terminal-input');
      this.printWelcome();
      this.printPrompt();
    } else {
      // OS-integrated mode - use window-specific selectors
      const windowElement = document.getElementById(`window-${this.windowId}`);
      terminalInput = windowElement.querySelector('.terminal-input');
    }

    if (!terminalInput) return;

    terminalInput.focus();
    this.bindInputEvents(terminalInput);

    // Save command history on window unload
    window.addEventListener('beforeunload', () => {
      this.saveCommandHistory();
    });
  }

  bindInputEvents(input) {
    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        await this.handleCommand(input);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.navigateHistory(-1, input);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.navigateHistory(1, input);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        this.handleTabCompletion(input);
      } else if (e.ctrlKey) {
        e.preventDefault();
        this.handleCtrlShortcuts(e, input);
      }
    });
  }

  async handleCommand(input) {
    const command = input.value.trim();

    // Add command to history
    if (command && command !== this.commandHistory[this.commandHistory.length - 1]) {
      this.commandHistory.push(command);
    }
    this.historyIndex = -1;

    if (this.isStandalone) {
      // Standalone mode - add command to output and clear input
      this.addCommandToOutput(command);
      input.value = '';

      // Process command and get output (now async)
      try {
        const output = await this.processCommand(command);

        // Add output if any
        if (output) {
          this.addOutput(output);
        }
      } catch (error) {
        this.addOutput(`Error: ${error.message}`);
      }

      // Show new prompt
      this.printPrompt();
    } else {
      // OS-integrated mode - original behavior
      const currentLine = input.closest('.terminal-line');
      currentLine.innerHTML = `<span class="terminal-prompt">${this.env.USER}@${
        this.env.HOSTNAME
      }:${this.getShortPath()}$</span> ${command}`;

      // Process command and get output (now async)
      try {
        const output = await this.processCommand(command);

        // Add output if any
        if (output) {
          this.addOutput(output);
        }
      } catch (error) {
        this.addOutput(`Error: ${error.message}`);
      }

      // Add new input line
      this.addNewInputLine();
      this.scrollToBottom();
    }
  }

  async processCommand(command) {
    if (command.trim() === '') return '';

    // Check if commands are loaded
    if (!this.commandsLoaded) {
      return 'Terminal is still loading commands, please wait...';
    }

    // Check if filesystem is ready
    if (!this.filesystemReady) {
      return 'Filesystem is still initializing, please wait...';
    }

    // Handle history expansion
    const expandedCommand = this.expandHistory(command);
    if (expandedCommand !== command) {
      // Show the expanded command
      this.addOutput(`${expandedCommand}`);
    }

    // Parse command for pipes and redirections
    const parsedCommand = this.parseCommand(expandedCommand);

    try {
      return await this.executeCommandChain(parsedCommand);
    } catch (error) {
      return `Error: ${error.message}`;
    }
  }

  // Expand history (!!, !n, etc.)
  expandHistory(command) {
    // Handle !! (repeat last command)
    if (command.trim() === '!!') {
      if (this.commandHistory.length === 0) {
        throw new Error('jsh: !!: event not found');
      }
      return this.commandHistory[this.commandHistory.length - 1];
    }

    // Handle !n (repeat command number n)
    const historyMatch = command.match(/^!(\d+)$/);
    if (historyMatch) {
      const historyNumber = parseInt(historyMatch[1]);
      if (historyNumber < 1 || historyNumber > this.commandHistory.length) {
        throw new Error(`jsh: !${historyNumber}: event not found`);
      }
      return this.commandHistory[historyNumber - 1];
    }

    // Handle !string (repeat last command starting with string)
    const stringMatch = command.match(/^!([a-zA-Z].*)$/);
    if (stringMatch) {
      const searchString = stringMatch[1];
      for (let i = this.commandHistory.length - 1; i >= 0; i--) {
        if (this.commandHistory[i].startsWith(searchString)) {
          return this.commandHistory[i];
        }
      }
      throw new Error(`jsh: !${searchString}: event not found`);
    }

    return command;
  }

  parseCommand(command) {
    // Split by pipes first
    const pipeSegments = command.split('|').map((seg) => seg.trim());

    const commandChain = [];

    for (let segment of pipeSegments) {
      const cmd = this.parseSegment(segment);
      commandChain.push(cmd);
    }

    return commandChain;
  }

  parseSegment(segment) {
    const tokens = this.tokenize(segment);
    const cmd = {
      name: '',
      args: [],
      redirections: {
        stdout: null,
        stderr: null,
        stdin: null,
        append: false
      }
    };

    let i = 0;
    while (i < tokens.length) {
      const token = tokens[i];

      if (token === '>') {
        // Stdout redirection
        if (i + 1 < tokens.length) {
          cmd.redirections.stdout = tokens[i + 1];
          cmd.redirections.append = false;
          i += 2;
        } else {
          throw new Error('Syntax error: expected filename after >');
        }
      } else if (token === '>>') {
        // Stdout append redirection
        if (i + 1 < tokens.length) {
          cmd.redirections.stdout = tokens[i + 1];
          cmd.redirections.append = true;
          i += 2;
        } else {
          throw new Error('Syntax error: expected filename after >>');
        }
      } else if (token === '2>') {
        // Stderr redirection
        if (i + 1 < tokens.length) {
          cmd.redirections.stderr = tokens[i + 1];
          i += 2;
        } else {
          throw new Error('Syntax error: expected filename after 2>');
        }
      } else if (token === '<') {
        // Stdin redirection
        if (i + 1 < tokens.length) {
          cmd.redirections.stdin = tokens[i + 1];
          i += 2;
        } else {
          throw new Error('Syntax error: expected filename after <');
        }
      } else {
        // Regular argument
        if (cmd.name === '') {
          cmd.name = token;
        } else {
          cmd.args.push(token);
        }
        i++;
      }
    }

    return cmd;
  }

  tokenize(segment) {
    const tokens = [];
    let current = '';
    let inQuotes = false;
    let quoteChar = '';

    for (let i = 0; i < segment.length; i++) {
      const char = segment[i];

      if ((char === '"' || char === "'") && !inQuotes) {
        inQuotes = true;
        quoteChar = char;
      } else if (char === quoteChar && inQuotes) {
        inQuotes = false;
        quoteChar = '';
      } else if (!inQuotes && /\s/.test(char)) {
        if (current) {
          tokens.push(current);
          current = '';
        }
      } else if (!inQuotes && (char === '>' || char === '<')) {
        if (current) {
          tokens.push(current);
          current = '';
        }

        // Handle >> and 2>
        if (char === '>' && i + 1 < segment.length && segment[i + 1] === '>') {
          tokens.push('>>');
          i++;
        } else if (char === '>' && i > 0 && segment[i - 1] === '2') {
          // Remove the '2' from the last token and add '2>'
          if (tokens.length > 0 && tokens[tokens.length - 1].endsWith('2')) {
            const lastToken = tokens.pop();
            if (lastToken.length > 1) {
              tokens.push(lastToken.slice(0, -1));
            }
          }
          tokens.push('2>');
        } else {
          tokens.push(char);
        }
      } else {
        current += char;
      }
    }

    if (current) {
      tokens.push(current);
    }

    return tokens;
  }

  async executeCommandChain(commandChain) {
    let input = '';
    let output = '';

    for (let i = 0; i < commandChain.length; i++) {
      const cmd = commandChain[i];
      const isLastCommand = i === commandChain.length - 1;

      try {
        // Handle stdin redirection
        if (cmd.redirections.stdin) {
          const filePath = this.resolvePath(cmd.redirections.stdin);
          const file = await this.getFileSystemItem(filePath);
          if (!file || file.type !== 'file') {
            throw new Error(
              `cannot read from '${cmd.redirections.stdin}': No such file or directory`
            );
          }
          input = file.content || '';
        }

        // Execute the command
        const result = await this.executeSingleCommand(cmd, input);

        // Handle stdout/stderr redirection
        if (cmd.redirections.stdout) {
          await this.redirectToFile(
            cmd.redirections.stdout,
            result.stdout,
            cmd.redirections.append
          );
          if (isLastCommand) {
            output = result.stderr || '';
          }
        } else if (cmd.redirections.stderr) {
          await this.redirectToFile(cmd.redirections.stderr, result.stderr, false);
          if (isLastCommand) {
            output = result.stdout || '';
          }
        } else {
          // No redirection, pass output to next command or return it
          if (isLastCommand) {
            output = result.stdout || '';
            if (result.stderr) {
              output += (output ? '\n' : '') + result.stderr;
            }
          } else {
            input = result.stdout || '';
          }
        }
      } catch (error) {
        throw new Error(`${cmd.name}: ${error.message}`);
      }
    }

    return output;
  }

  async executeSingleCommand(cmd, stdin = '') {
    let cmdName = cmd.name.toLowerCase();

    // Check for aliases first
    if (this.aliases[cmdName]) {
      const aliasCommand = this.aliases[cmdName];
      // Simple alias expansion - replace command name with alias value
      const expandedArgs = aliasCommand.split(' ').concat(cmd.args);
      cmdName = expandedArgs[0].toLowerCase();
      cmd.args = expandedArgs.slice(1);
    }

    // Special case for help command
    if (cmdName === 'help') {
      return { stdout: this.helpCommand(), stderr: '' };
    }

    // Try to get command from registry
    const commandHandler = window.commandRegistry.get(cmdName);
    if (commandHandler) {
      try {
        // Create a modified terminal context for piped commands
        // For commands that modify terminal state (like cd), use the original terminal
        const terminalContext = this;
        terminalContext.stdin = stdin;
        terminalContext.hasStdin = stdin.length > 0;

        const result = commandHandler(terminalContext, cmd.args);
        const output = result instanceof Promise ? await result : result;

        // Clean up temporary properties
        delete terminalContext.stdin;
        delete terminalContext.hasStdin;

        // Separate stdout and stderr (for now, everything goes to stdout)
        return {
          stdout: output || '',
          stderr: ''
        };
      } catch (error) {
        return {
          stdout: '',
          stderr: `Error executing ${cmdName}: ${error.message}`
        };
      }
    }

    return {
      stdout: '',
      stderr: `bash: ${cmdName}: command not found\nTry 'help' for available commands or 'sudo apt install ${cmdName}' to pretend to install it! 😄`
    };
  }

  async redirectToFile(filename, content, append = false) {
    const filePath = this.resolvePath(filename);

    try {
      if (append) {
        // Read existing content and append
        const existingFile = await this.getFileSystemItem(filePath);
        const existingContent =
          existingFile && existingFile.type === 'file' ? existingFile.content || '' : '';

        await this.fileSystemDB.createFile(filePath, existingContent + content, true);
      } else {
        // Overwrite file
        await this.fileSystemDB.createFile(filePath, content, true);
      }
    } catch (error) {
      throw new Error(`cannot redirect to '${filename}': ${error.message}`);
    }
  }

  helpCommand() {
    const commandsByCategory = window.commandRegistry.getCommandsByCategory();

    // Define category emojis and preferred order
    const categoryEmojis = {
      'File System': '📁',
      System: '📊',
      Apps: '🚀',
      'Fun Stuff': '🎪',
      'Speech & Media': '🔊',
      Other: '🔧'
    };

    // Preferred category order
    const categoryOrder = ['File System', 'System', 'Apps', 'Fun Stuff', 'Speech & Media', 'Other'];

    let helpText = 'Available commands:\n\n';

    // Sort categories by preferred order, then alphabetically for any extras
    const sortedCategories = Object.keys(commandsByCategory).sort((a, b) => {
      const aIndex = categoryOrder.indexOf(a);
      const bIndex = categoryOrder.indexOf(b);

      if (aIndex !== -1 && bIndex !== -1) {
        return aIndex - bIndex;
      } else if (aIndex !== -1) {
        return -1;
      } else if (bIndex !== -1) {
        return 1;
      } else {
        return a.localeCompare(b);
      }
    });

    sortedCategories.forEach((category) => {
      const commands = commandsByCategory[category];
      const emoji = categoryEmojis[category] || '🔧';

      helpText += `${emoji} ${category}:\n`;

      commands.forEach((cmd) => {
        helpText += `  ${cmd.name.padEnd(12)} - ${cmd.description}\n`;
      });
      helpText += '\n';
    });

    helpText += `💡 Pro Tips:
  - Use arrow keys to navigate command history
  - Tab completion works for commands
  - clear/Ctrl+L to clear screen
  - Ctrl+W to delete word backwards
  - Ctrl+U to delete line backwards
  - Ctrl+K to delete line forwards
  - Ctrl+A/E to move to beginning/end of line
  - Ctrl+R for reverse search

🔧 Pipes & Redirection:
  - Use | to pipe output: ls | grep txt
  - Redirect output: echo "hello" > file.txt
  - Append to file: echo "world" >> file.txt
  - Redirect stderr: command 2> error.log
  - Read from file: sort < data.txt`;

    return helpText;
  }

  // Helper methods
  resolvePath(path) {
    let resolvedPath;

    if (path.startsWith('/')) {
      resolvedPath = path;
    } else if (path === '..') {
      const parts = this.currentDirectory.split('/').filter((p) => p);
      parts.pop();
      resolvedPath = parts.length === 0 ? '/' : '/' + parts.join('/');
    } else if (path === '.') {
      resolvedPath = this.currentDirectory;
    } else {
      resolvedPath =
        this.currentDirectory === '/' ? `/${path}` : `${this.currentDirectory}/${path}`;
    }

    // Normalize trailing slashes (except for root directory)
    if (resolvedPath !== '/' && resolvedPath.endsWith('/')) {
      resolvedPath = resolvedPath.slice(0, -1);
    }

    return resolvedPath;
  }

  async getFileSystemItem(path) {
    if (!this.filesystemReady) {
      // Fallback to in-memory filesystem if IndexedDB not ready
      if (this.fileSystem) {
        const parts = path.split('/').filter((p) => p);
        let current = this.fileSystem['/'];

        for (const part of parts) {
          if (current.type !== 'directory' || !current.contents[part]) {
            return null;
          }
          current = current.contents[part];
        }

        return current;
      }
      return null;
    }

    try {
      const item = await this.fileSystemDB.getItem(path);
      return item;
    } catch (error) {
      console.error('Error accessing filesystem:', error);
      return null;
    }
  }

  async listDirectoryContents(path) {
    if (!this.filesystemReady) {
      // Fallback to in-memory filesystem
      if (this.fileSystem) {
        const item = await this.getFileSystemItem(path);
        if (item && item.type === 'directory' && item.contents) {
          return Object.entries(item.contents).map(([name, item]) => ({
            name,
            type: item.type,
            path: path === '/' ? `/${name}` : `${path}/${name}`
          }));
        }
      }
      return [];
    }

    try {
      const items = await this.fileSystemDB.listDirectory(path);
      return items.map((item) => ({
        name: this.fileSystemDB.getFileName(item.path),
        type: item.type,
        path: item.path,
        size: item.size,
        created: item.created,
        modified: item.modified
      }));
    } catch (error) {
      console.error('Error listing directory:', error);
      return [];
    }
  }

  getShortPath() {
    if (this.currentDirectory === this.env.HOME) {
      return '~';
    }
    if (this.currentDirectory.startsWith(this.env.HOME + '/')) {
      return '~' + this.currentDirectory.substring(this.env.HOME.length);
    }
    return this.currentDirectory;
  }

  // Update PWD environment variable when directory changes
  updatePWD(newDirectory) {
    this.currentDirectory = newDirectory;
    this.env.PWD = newDirectory;
  }

  // Expand environment variables in a string
  expandVariables(str) {
    return str
      .replace(/\$([A-Z_][A-Z0-9_]*)/g, (match, varName) => {
        return this.env[varName] || '';
      })
      .replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (match, varName) => {
        return this.env[varName] || '';
      });
  }

  // Set environment variable
  setEnv(name, value) {
    this.env[name] = value;
  }

  // Get environment variable
  getEnv(name) {
    return this.env[name];
  }

  // Get all environment variables
  getAllEnv() {
    return { ...this.env };
  }

  navigateHistory(direction, input) {
    if (this.commandHistory.length === 0) return;

    if (direction === -1) {
      // Go back in history
      if (this.historyIndex === -1) {
        this.historyIndex = this.commandHistory.length - 1;
      } else if (this.historyIndex > 0) {
        this.historyIndex--;
      }
    } else {
      // Go forward in history
      if (this.historyIndex < this.commandHistory.length - 1) {
        this.historyIndex++;
      } else {
        this.historyIndex = -1;
        input.value = '';
        return;
      }
    }

    input.value = this.commandHistory[this.historyIndex] || '';
  }

  async handleTabCompletion(input) {
    const value = input.value;
    const parts = value.split(' ');
    const lastPart = parts[parts.length - 1];

    // Check for environment variable completion
    if (lastPart.startsWith('$')) {
      await this.handleEnvVarCompletion(input, parts, lastPart);
      return;
    }

    // Command completion (first word)
    if (parts.length === 1) {
      const commands = window.commandRegistry.getCommandNames();
      const matches = commands.filter((cmd) => cmd.startsWith(lastPart));

      if (matches.length === 1) {
        input.value = matches[0] + ' ';
      } else if (matches.length > 1) {
        // Show multiple matches
        const commonPrefix = this.findCommonPrefix(matches);
        if (commonPrefix.length > lastPart.length) {
          input.value = commonPrefix;
        } else {
          // Show all matches
          this.addOutput(`\nAvailable commands: ${matches.join('  ')}`);
          this.addCommandToOutput(value);
        }
      }
    } else {
      // Path completion (arguments to commands)
      await this.handlePathCompletion(input, parts, lastPart);
    }
  }

  async handleEnvVarCompletion(input, parts, lastPart) {
    const varPrefix = lastPart.substring(1); // Remove the $
    const envVars = Object.keys(this.env);
    const matches = envVars.filter((varName) => varName.startsWith(varPrefix));

    if (matches.length === 1) {
      // Single match - complete it
      const beforeLastPart = parts.slice(0, -1).join(' ');
      input.value = beforeLastPart + (beforeLastPart ? ' ' : '') + '$' + matches[0] + ' ';
    } else if (matches.length > 1) {
      // Multiple matches
      const commonPrefix = this.findCommonPrefix(matches);

      if (commonPrefix.length > varPrefix.length) {
        // Complete to common prefix
        const beforeLastPart = parts.slice(0, -1).join(' ');
        input.value = beforeLastPart + (beforeLastPart ? ' ' : '') + '$' + commonPrefix;
      } else {
        // Show all matches with their values
        const matchDisplay = matches
          .map((varName) => `$${varName}="${this.env[varName]}"`)
          .join('  ');
        this.addOutput(`\nEnvironment variables: ${matchDisplay}`);
        this.addCommandToOutput(input.value);
      }
    }
  }

  async handlePathCompletion(input, parts, lastPart) {
    // Determine the directory to search in
    let searchDir = this.currentDirectory;
    let searchPattern = lastPart;

    // Handle absolute paths
    if (lastPart.startsWith('/')) {
      const lastSlash = lastPart.lastIndexOf('/');
      if (lastSlash === 0) {
        // Root directory
        searchDir = '/';
        searchPattern = lastPart.substring(1);
      } else if (lastSlash > 0) {
        // Subdirectory
        searchDir = lastPart.substring(0, lastSlash);
        searchPattern = lastPart.substring(lastSlash + 1);
      }
    } else if (lastPart.includes('/')) {
      // Relative path with subdirectories
      const lastSlash = lastPart.lastIndexOf('/');
      const relativePath = lastPart.substring(0, lastSlash);
      searchDir = this.resolvePath(relativePath);
      searchPattern = lastPart.substring(lastSlash + 1);
    }

    // Get directory contents
    try {
      const entries = await this.listDirectoryContents(searchDir);
      const matches = entries
        .filter((entry) => entry.name.startsWith(searchPattern))
        .map((entry) => {
          const isDir = entry.type === 'directory';
          const basePath = lastPart.substring(0, lastPart.lastIndexOf('/') + 1);
          return {
            name: entry.name,
            fullPath: basePath + entry.name + (isDir ? '/' : ''),
            isDirectory: isDir
          };
        });

      if (matches.length === 1) {
        // Single match - complete it
        const beforeLastPart = parts.slice(0, -1).join(' ');
        input.value = beforeLastPart + (beforeLastPart ? ' ' : '') + matches[0].fullPath;

        // If it's a directory, don't add a space (user might want to continue the path)
        if (!matches[0].isDirectory) {
          input.value += ' ';
        }
      } else if (matches.length > 1) {
        // Multiple matches
        const matchNames = matches.map((m) => m.name);
        const commonPrefix = this.findCommonPrefix(matchNames);

        if (commonPrefix.length > searchPattern.length) {
          // Complete to common prefix
          const beforeLastPart = parts.slice(0, -1).join(' ');
          const basePath = lastPart.substring(0, lastPart.lastIndexOf('/') + 1);
          input.value = beforeLastPart + (beforeLastPart ? ' ' : '') + basePath + commonPrefix;
        } else {
          // Show all matches
          const matchDisplay = matches
            .map((m) => (m.isDirectory ? `📁 ${m.name}` : `📄 ${m.name}`))
            .join('  ');
          this.addOutput(`\n${matchDisplay}`);
          this.addCommandToOutput(input.value);
        }
      }
    } catch (error) {
      // Directory doesn't exist or can't be read - no completion
      console.log('Tab completion error:', error);
    }
  }

  findCommonPrefix(strings) {
    if (strings.length === 0) return '';
    if (strings.length === 1) return strings[0];

    let prefix = strings[0];
    for (let i = 1; i < strings.length; i++) {
      while (prefix.length > 0 && !strings[i].startsWith(prefix)) {
        prefix = prefix.substring(0, prefix.length - 1);
      }
      if (prefix.length === 0) break;
    }
    return prefix;
  }

  // Advanced Ctrl shortcuts
  handleCtrlShortcuts(event, input) {
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const value = input.value;

    switch (event.key) {
      case 'w': // Ctrl+W: Delete word backwards
        const beforeCursor = value.substring(0, start);
        let lastWordStart = beforeCursor.length;
        let foundSpace = false;

        for (let i = beforeCursor.length - 1; i >= 0; i--) {
          if (beforeCursor[i] === ' ') {
            if (!foundSpace) {
              foundSpace = true;
            }
          } else {
            if (foundSpace) {
              lastWordStart = i + 1;
              break;
            }
            lastWordStart = i;
          }
        }

        const newValue = value.substring(0, lastWordStart) + value.substring(end);
        input.value = newValue;
        input.setSelectionRange(lastWordStart, lastWordStart);
        break;

      case 'u': // Ctrl+U: Delete line backwards
        input.value = value.substring(end);
        input.setSelectionRange(0, 0);
        break;

      case 'k': // Ctrl+K: Delete line forwards
        input.value = value.substring(0, start);
        input.setSelectionRange(start, start);
        break;

      case 'a': // Ctrl+A: Move to beginning of line
        input.setSelectionRange(0, 0);
        break;

      case 'e': // Ctrl+E: Move to end of line
        input.setSelectionRange(value.length, value.length);
        break;

      case 'l': // Ctrl+L: Clear screen
        const clearHandler = window.commandRegistry.get('clear');
        if (clearHandler) {
          clearHandler(this, []);
        }
        break;

      case 'c': // Ctrl+C: Interrupt (clear current line)
        input.value = '';
        this.addOutput('^C');
        break;

      case 'd': // Ctrl+D: EOF (exit if line is empty)
        if (value.length === 0) {
          this.addOutput('exit');
        }
        break;

      case 'r': // Ctrl+R: Reverse search
        const searchTerm = prompt('Enter search term:');
        if (searchTerm) {
          const foundCommand = [...this.commandHistory]
            .reverse()
            .find((cmd) => cmd.includes(searchTerm));
          if (foundCommand) {
            input.value = foundCommand;
          } else {
            this.addOutput(`No matching command found for: ${searchTerm}`);
          }
        }
        break;

      case 't': // Ctrl+T: Transpose characters
        if (start > 0 && start < value.length) {
          const before = value.substring(0, start - 1);
          const char1 = value.charAt(start - 1);
          const char2 = value.charAt(start);
          const after = value.substring(start + 1);
          input.value = before + char2 + char1 + after;
          input.setSelectionRange(start, start);
        }
        break;

      case 'f': // Ctrl+F: Forward character
        if (end < value.length) {
          input.setSelectionRange(end + 1, end + 1);
        }
        break;

      case 'b': // Ctrl+B: Backward character
        if (start > 0) {
          input.setSelectionRange(start - 1, start - 1);
        }
        break;
    }
  }

  addOutput(output) {
    if (this.isStandalone) {
      // Standalone mode - use terminal-output element
      const terminalOutput = document.getElementById('terminal-output');
      const outputLines = output.split('\n');
      outputLines.forEach((line) => {
        const outputElement = document.createElement('div');
        outputElement.className = 'terminal-output';
        outputElement.textContent = line;
        terminalOutput.appendChild(outputElement);
      });
      terminalOutput.scrollTop = terminalOutput.scrollHeight;
    } else {
      // OS-integrated mode - original behavior
      const windowElement = document.getElementById(`window-${this.windowId}`);
      const terminalContent = windowElement.querySelector('.terminal-content');

      const outputLines = output.split('\n');
      outputLines.forEach((line) => {
        const outputElement = document.createElement('div');
        outputElement.className = 'terminal-line';
        outputElement.textContent = line;
        terminalContent.appendChild(outputElement);
      });
    }
  }

  addNewInputLine() {
    const windowElement = document.getElementById(`window-${this.windowId}`);
    const terminalContent = windowElement.querySelector('.terminal-content');

    const newLine = document.createElement('div');
    newLine.className = 'terminal-line';
    newLine.innerHTML = `<span class="terminal-prompt">${this.env.USER}@${
      this.env.HOSTNAME
    }:${this.getShortPath()}$</span> <input type="text" class="terminal-input" placeholder="Type a command...">`;
    terminalContent.appendChild(newLine);

    const newInput = newLine.querySelector('.terminal-input');
    newInput.focus();
    this.bindInputEvents(newInput);
  }

  scrollToBottom() {
    const windowElement = document.getElementById(`window-${this.windowId}`);
    const terminalContent = windowElement.querySelector('.terminal-content');
    terminalContent.scrollTop = terminalContent.scrollHeight;
  }

  // Command history persistence
  saveCommandHistory() {
    try {
      sessionStorage.setItem('heymingTerminalHistory', JSON.stringify(this.commandHistory));
    } catch (e) {
      // Ignore storage errors
    }
  }

  loadCommandHistory() {
    try {
      const savedHistory = sessionStorage.getItem('heymingTerminalHistory');
      if (savedHistory) {
        this.commandHistory = JSON.parse(savedHistory);
        this.historyIndex = this.commandHistory.length;
      }
    } catch (e) {
      // Ignore storage errors
    }
  }

  // Standalone mode specific methods
  printWelcome() {
    if (!this.isStandalone) return;

    const welcome = `
╔══════════════════════════════════════════════════════════════╗
║                    Welcome to jsh (Joe Shell) v1.0          ║
║                                                              ║
║  Type 'help' for available commands                          ║
║  Try: history, !!, alias ll='ls -l', echo $USER             ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
        `;
    this.addOutput(welcome);
  }

  printPrompt() {
    if (!this.isStandalone) return;

    const promptText = document.getElementById('prompt-text');
    promptText.innerHTML = `${this.env.USER}@${this.env.HOSTNAME}:${this.getShortPath()}$ `;
    const terminalInput = document.getElementById('terminal-input');
    terminalInput.focus();
  }

  addCommandToOutput(command) {
    if (!this.isStandalone) return;

    const terminalOutput = document.getElementById('terminal-output');
    const commandLine = document.createElement('div');
    commandLine.className = 'terminal-line';
    commandLine.innerHTML = `<span class="prompt">${this.env.USER}@${
      this.env.HOSTNAME
    }:${this.getShortPath()}$</span> ${command}`;
    terminalOutput.appendChild(commandLine);
  }
}

// Export for use in os.js
window.Terminal = Terminal;

// Initialize standalone terminal if not in OS mode
document.addEventListener('DOMContentLoaded', () => {
  // Check if we're in standalone mode (not in an OS window)
  if (document.getElementById('terminal-container')) {
    window.terminal = new Terminal();
  }
});

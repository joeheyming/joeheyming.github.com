// Enhanced Terminal for Heyming OS - Modular Version
class Terminal {
  constructor(windowId = null, osInstance = null) {
    this.windowId = windowId;
    this.os = osInstance;
    this.process = null; // Will be set by OS when terminal becomes a process
    this.commandHistory = [];
    this.historyIndex = -1;
    this.aliases = {}; // Command aliases
    this.fileSystemDB = new FileSystemDB();
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
        // Always initialize filesystem (required for OS operation)
        return this.initializeFilesystem().then(() => {
          this.filesystemReady = true;
        });
      })
      .then(() => {
        this.filesystemReady = true;
        // Initialize terminal after a brief delay
        setTimeout(() => this.initialize(), 100);
      })
      .catch((error) => {
        console.error('❌ Failed to initialize terminal:', error);
        throw new Error('Terminal initialization failed - OS layer required');
      });
  }

  // OS Integration Methods
  setProcess(process) {
    this.process = process;
    // Update environment from process
    if (process) {
      this.env = { ...this.env, ...process.env };
      this.currentDirectory = process.cwd;
    }
  }

  // System call wrapper - always use OS kernel
  async syscall(name, ...args) {
    if (!this.os || !this.os.kernel) {
      throw new Error('OS kernel not available - system cannot function without OS layer');
    }
    return await this.os.kernel.syscall(name, ...args);
  }


  // Get current process info
  getCurrentProcess() {
    if (!this.process) {
      throw new Error('Process not available - terminal must be running as an OS process');
    }
    return this.process;
  }

  async loadCommands() {
    if (window.commandRegistry) {
      await window.commandRegistry.loadCommands();
    }
  }

  async initializeFilesystem() {
    await this.fileSystemDB.initializeWithScaffolding(this.env.USER);
  }


  initialize() {
    let terminalInput;

    // Check if we're in a windowed mode or using main terminal
    const windowElement = this.windowId ? document.getElementById(`window-${this.windowId}`) : null;
    if (windowElement) {
      // Windowed mode - use window-specific selectors
      terminalInput = windowElement.querySelector('.terminal-input');
    } else {
      // Main terminal - only print welcome if not already shown
      terminalInput = document.getElementById('terminal-input');
      const terminalOutput = document.getElementById('terminal-output');
      if (!terminalOutput || !terminalOutput.textContent.includes('Welcome to jsh')) {
        this.printWelcome();
        this.printPrompt();
      }
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

    if (!this.windowId) {
      // Main terminal mode - add command to output and clear input
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
      if (currentLine) {
        currentLine.innerHTML = `<span class="terminal-prompt">${this.env.USER}@${
          this.env.HOSTNAME
        }:${this.getShortPath()}$</span> ${command}`;
      } else {
        // Fallback if no terminal-line found
        console.warn('No terminal-line found, using standalone mode behavior');
        this.addOutput(`${this.env.USER}@${this.env.HOSTNAME}:${this.getShortPath()}$ ${command}`);
      }

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
        terminalContext.redirections = cmd.redirections; // Pass redirection info

        const result = commandHandler(terminalContext, cmd.args);
        const output = result instanceof Promise ? await result : result;

        // Clean up temporary properties
        delete terminalContext.stdin;
        delete terminalContext.hasStdin;
        delete terminalContext.redirections;

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
    // Always use OS file system
    try {
      const stats = await this.syscall('stat', path);
      return stats;
    } catch (error) {
      return null;
    }
  }

  async listDirectoryContents(path) {
    // Always use OS file system
    try {
      const entries = await this.syscall('readdir', path);
      return entries;
    } catch (error) {
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

  // Process ANSI escape sequences and convert to HTML
  processAnsiSequences(text) {
    // ANSI color codes mapping
    const ansiColors = {
      '30': 'black', '31': 'red', '32': 'green', '33': 'yellow',
      '34': 'blue', '35': 'magenta', '36': 'cyan', '37': 'white',
      '90': 'gray', '91': 'lightred', '92': 'lightgreen', '93': 'lightyellow',
      '94': 'lightblue', '95': 'lightmagenta', '96': 'lightcyan', '97': 'lightwhite'
    };

    const ansiBgColors = {
      '40': 'black', '41': 'red', '42': 'green', '43': 'yellow',
      '44': 'blue', '45': 'magenta', '46': 'cyan', '47': 'white',
      '100': 'gray', '101': 'lightred', '102': 'lightgreen', '103': 'lightyellow',
      '104': 'lightblue', '105': 'lightmagenta', '106': 'lightcyan', '107': 'lightwhite'
    };

    let result = text;
    let currentStyles = [];

    // Handle clear screen sequences
    result = result.replace(/\x1b\[2J/g, ''); // Clear entire screen
    result = result.replace(/\x1b\[H/g, ''); // Move cursor to home position
    result = result.replace(/\x1b\[1;1H/g, ''); // Move cursor to 1,1
    
    // Handle cursor movement (simplified - just remove for now)
    result = result.replace(/\x1b\[\d+;\d+H/g, ''); // Move cursor to specific position
    result = result.replace(/\x1b\[\d+A/g, ''); // Move cursor up
    result = result.replace(/\x1b\[\d+B/g, ''); // Move cursor down
    result = result.replace(/\x1b\[\d+C/g, ''); // Move cursor right
    result = result.replace(/\x1b\[\d+D/g, ''); // Move cursor left

    // Handle color and style sequences
    result = result.replace(/\x1b\[([0-9;]+)m/g, (match, codes) => {
      const codeList = codes.split(';');
      let html = '';
      
      codeList.forEach(code => {
        switch (code) {
          case '0': // Reset
            if (currentStyles.length > 0) {
              html += '</span>';
              currentStyles = [];
            }
            break;
          case '1': // Bold
            html += '<span style="font-weight: bold;">';
            currentStyles.push('bold');
            break;
          case '4': // Underline
            html += '<span style="text-decoration: underline;">';
            currentStyles.push('underline');
            break;
          default:
            if (ansiColors[code]) {
              html += `<span style="color: ${ansiColors[code]};">`;
              currentStyles.push('color');
            } else if (ansiBgColors[code]) {
              html += `<span style="background-color: ${ansiBgColors[code]};">`;
              currentStyles.push('bgcolor');
            }
        }
      });
      
      return html;
    });

    return result;
  }

  addOutput(output, options = {}) {
    const { preserveAnsi = false, streaming = false } = options;
    
    // Check if we're in a windowed mode or using main terminal
    const windowElement = this.windowId ? document.getElementById(`window-${this.windowId}`) : null;
    
    if (windowElement) {
      // Windowed mode - use window-specific elements
      const terminalContent = windowElement.querySelector('.terminal-content');

      if (streaming) {
        // Clear previous streaming content
        const existingStreaming = terminalContent.querySelector('.streaming-output');
        if (existingStreaming) {
          existingStreaming.remove();
        }
      }

      if (preserveAnsi) {
        // Process ANSI sequences
        const processedOutput = this.processAnsiSequences(output);
        const outputElement = document.createElement('div');
        outputElement.className = streaming ? 'terminal-line streaming-output ansi-output' : 'terminal-line ansi-output';
        outputElement.innerHTML = processedOutput;
        terminalContent.appendChild(outputElement);
      } else {
        // Regular text output
        const outputLines = output.split('\n');
        outputLines.forEach((line) => {
          const outputElement = document.createElement('div');
          outputElement.className = 'terminal-line';
          outputElement.textContent = line;
          terminalContent.appendChild(outputElement);
        });
      }
    } else {
      // Main terminal mode - use terminal-output element
      const terminalOutput = document.getElementById('terminal-output');
      
      if (!terminalOutput) {
        console.error('Terminal output element not found');
        return;
      }
      
      if (streaming) {
        // For streaming content, clear previous content and add new
        terminalOutput.innerHTML = '';
      }
      
      if (preserveAnsi) {
        // Process ANSI sequences for animations
        const processedOutput = this.processAnsiSequences(output);
        const outputElement = document.createElement('div');
        outputElement.className = 'terminal-output ansi-output';
        outputElement.innerHTML = processedOutput;
        terminalOutput.appendChild(outputElement);
      } else {
        // Regular text output
        const outputLines = output.split('\n');
        outputLines.forEach((line) => {
          const outputElement = document.createElement('div');
          outputElement.className = 'terminal-output';
          outputElement.textContent = line;
          terminalOutput.appendChild(outputElement);
        });
      }
      
      terminalOutput.scrollTop = terminalOutput.scrollHeight;
    }
  }

  addNewInputLine() {
    // Check if we're in windowed mode
    const windowElement = this.windowId ? document.getElementById(`window-${this.windowId}`) : null;
    
    if (windowElement) {
      // Windowed mode
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
    } else {
      // Main terminal mode - the input is already there, just focus it
      const terminalInput = document.getElementById('terminal-input');
      if (terminalInput) {
        terminalInput.focus();
      }
    }
  }

  scrollToBottom() {
    // Check if we're in windowed mode
    const windowElement = this.windowId ? document.getElementById(`window-${this.windowId}`) : null;
    
    if (windowElement) {
      // Windowed mode
      const terminalContent = windowElement.querySelector('.terminal-content');
      if (terminalContent) {
        terminalContent.scrollTop = terminalContent.scrollHeight;
      }
    } else {
      // Main terminal mode
      const terminalOutput = document.getElementById('terminal-output');
      if (terminalOutput) {
        terminalOutput.scrollTop = terminalOutput.scrollHeight;
      }
    }
  }

  // Less viewer implementation
  showLessViewer(content, filename = '', options = {}) {
    const { renderHtml = false } = options;
    const lines = content.split('\n');
    let currentLine = 0;
    const linesPerPage = 20;
    let searchTerm = '';
    let searchResults = [];
    let currentSearchIndex = -1;
    let lastSearchTerm = ''; // Remember last search for repeat searches

    // Create less viewer modal
    const modal = document.createElement('div');
    modal.className = 'less-viewer-modal';
    modal.innerHTML = `
      <div class="less-viewer">
        <div class="less-header">
          <span class="less-filename">${filename ? filename : '(stdin)'}${renderHtml ? ' [HTML]' : ''}</span>
          <span class="less-position">lines 1-${Math.min(linesPerPage, lines.length)} of ${lines.length}</span>
        </div>
        <div class="less-content" id="less-content"></div>
        <div class="less-footer">
          <span class="less-help">Press 'h' for help, 'q' to quit, '/' to search</span>
          <span class="less-search" id="less-search" style="display: none;">
            <span>Search: </span>
            <input type="text" id="less-search-input" />
          </span>
        </div>
      </div>
    `;

    // Add CSS styles
    const style = document.createElement('style');
    style.textContent = `
      .less-viewer-modal {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.9);
        z-index: 1000;
        display: flex;
        justify-content: center;
        align-items: center;
      }
      .less-viewer {
        width: 90%;
        height: 90%;
        background: #000;
        color: #fff;
        font-family: 'Courier New', monospace;
        border: 1px solid #333;
        display: flex;
        flex-direction: column;
      }
      .less-header {
        background: #333;
        padding: 5px 10px;
        display: flex;
        justify-content: space-between;
        font-size: 12px;
      }
      .less-content {
        flex: 1;
        padding: 10px;
        overflow: hidden;
        white-space: pre;
        line-height: 1.4;
      }
      .html-content {
        white-space: normal;
        font-family: Arial, sans-serif;
        background: white;
        color: black;
        padding: 10px;
        border-radius: 4px;
        max-height: 100%;
        overflow: auto;
      }
      .less-footer {
        background: #333;
        padding: 5px 10px;
        font-size: 12px;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .less-search input {
        background: #000;
        color: #fff;
        border: 1px solid #666;
        padding: 2px 5px;
        font-family: 'Courier New', monospace;
      }
      .less-highlight {
        background: yellow;
        color: black;
      }
      .less-current-match {
        background: orange;
        color: black;
      }
    `;
    document.head.appendChild(style);

    const updateDisplay = () => {
      const contentDiv = modal.querySelector('#less-content');
      const positionSpan = modal.querySelector('.less-position');
      
      const endLine = Math.min(currentLine + linesPerPage, lines.length);
      let displayLines = lines.slice(currentLine, endLine);
      
      if (renderHtml) {
        // HTML rendering mode - render HTML content
        const htmlContent = displayLines.join('\n');
        
        // For HTML rendering, we need to handle it differently
        // Create a wrapper div to contain the rendered HTML
        contentDiv.innerHTML = `<div class="html-content">${htmlContent}</div>`;
        
        // Apply search highlighting after HTML rendering if needed
        if (searchTerm && searchResults.length > 0) {
          // Note: Search highlighting in HTML mode is complex because we need to avoid
          // highlighting inside HTML tags. For now, we'll skip search in HTML mode.
          // This could be enhanced later with proper HTML-aware search.
        }
      } else {
        // Text mode - escape HTML entities first
        displayLines = displayLines.map(line => 
          line.replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#39;')
        );
        
        // Apply search highlighting after HTML escaping
        if (searchTerm && searchResults.length > 0) {
          displayLines = displayLines.map((line, index) => {
            const globalIndex = currentLine + index;
            if (searchResults.includes(globalIndex)) {
              const escapedSearchTerm = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                                                 .replace(/&/g, '&amp;')
                                                 .replace(/</g, '&lt;')
                                                 .replace(/>/g, '&gt;')
                                                 .replace(/"/g, '&quot;')
                                                 .replace(/'/g, '&#39;');
              const regex = new RegExp(`(${escapedSearchTerm})`, 'gi');
              const isCurrentMatch = globalIndex === searchResults[currentSearchIndex];
              return line.replace(regex, (match) => 
                `<span class="${isCurrentMatch ? 'less-current-match' : 'less-highlight'}">${match}</span>`
              );
            }
            return line;
          });
        }
        contentDiv.innerHTML = displayLines.join('\n');
      }
      positionSpan.textContent = `lines ${currentLine + 1}-${endLine} of ${lines.length}`;
      
      if (searchTerm) {
        const searchCount = searchResults.length;
        const currentPos = currentSearchIndex >= 0 ? currentSearchIndex + 1 : 0;
        positionSpan.textContent += ` | Search: ${currentPos}/${searchCount}`;
      }
    };

    const performSearch = (term, isRepeatSearch = false) => {
      // If no term provided and we have a last search, repeat it
      if (!term && lastSearchTerm) {
        term = lastSearchTerm;
        isRepeatSearch = true;
      }
      
      if (!term) {
        return; // No search term available
      }
      
      // Only rebuild search results if it's a new search term
      if (term !== searchTerm) {
        searchTerm = term;
        lastSearchTerm = term;
        searchResults = [];
        currentSearchIndex = -1;
        
        // Search in the original unescaped content
        const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        lines.forEach((line, index) => {
          if (regex.test(line)) {
            searchResults.push(index);
          }
        });
      }
      
      if (searchResults.length > 0) {
        if (isRepeatSearch || term !== searchTerm) {
          // For repeat searches or new searches, find next match after current position
          let nextIndex = searchResults.findIndex(lineNum => lineNum > currentLine + Math.floor(linesPerPage / 2));
          if (nextIndex === -1) {
            // Wrap around to beginning
            nextIndex = 0;
          }
          currentSearchIndex = nextIndex;
        } else {
          // For first search, find first match at or after current line
          currentSearchIndex = searchResults.findIndex(lineNum => lineNum >= currentLine);
          if (currentSearchIndex === -1) {
            currentSearchIndex = 0; // Wrap to first match
          }
        }
        
        currentLine = Math.max(0, searchResults[currentSearchIndex] - Math.floor(linesPerPage / 2));
      }
      
      updateDisplay();
    };

    const handleKeyPress = (e) => {
      const searchDiv = modal.querySelector('#less-search');
      const searchInput = modal.querySelector('#less-search-input');
      
      if (searchDiv.style.display !== 'none') {
        // In search mode
        if (e.key === 'Enter') {
          const inputValue = searchInput.value.trim();
          if (inputValue === '' && lastSearchTerm) {
            // Empty search with previous term - repeat last search
            performSearch(lastSearchTerm, true);
          } else if (inputValue !== '') {
            // New search term
            performSearch(inputValue);
          }
          searchDiv.style.display = 'none';
          e.preventDefault();
        } else if (e.key === 'Escape') {
          searchDiv.style.display = 'none';
          e.preventDefault();
        }
        return;
      }
      
      // Normal navigation mode
      switch (e.key) {
        case 'q':
        case 'Q':
          document.body.removeChild(modal);
          document.head.removeChild(style);
          document.removeEventListener('keydown', handleKeyPress);
          break;
        case 'j':
        case 'ArrowDown':
          if (currentLine < lines.length - linesPerPage) {
            currentLine++;
            updateDisplay();
          }
          e.preventDefault();
          break;
        case 'k':
        case 'ArrowUp':
          if (currentLine > 0) {
            currentLine--;
            updateDisplay();
          }
          e.preventDefault();
          break;
        case ' ':
        case 'f':
        case 'PageDown':
          currentLine = Math.min(currentLine + linesPerPage, lines.length - linesPerPage);
          updateDisplay();
          e.preventDefault();
          break;
        case 'b':
        case 'PageUp':
          currentLine = Math.max(currentLine - linesPerPage, 0);
          updateDisplay();
          e.preventDefault();
          break;
        case 'g':
          currentLine = 0;
          updateDisplay();
          e.preventDefault();
          break;
        case 'G':
          currentLine = Math.max(lines.length - linesPerPage, 0);
          updateDisplay();
          e.preventDefault();
          break;
        case '/':
          searchDiv.style.display = 'flex';
          searchInput.value = '';
          searchInput.placeholder = lastSearchTerm ? `Press Enter to repeat: ${lastSearchTerm}` : 'Enter search term';
          searchInput.focus();
          e.preventDefault();
          break;
        case 'n':
          if (searchResults.length > 0) {
            currentSearchIndex = (currentSearchIndex + 1) % searchResults.length;
            currentLine = Math.max(0, searchResults[currentSearchIndex] - Math.floor(linesPerPage / 2));
            updateDisplay();
          }
          e.preventDefault();
          break;
        case 'N':
          if (searchResults.length > 0) {
            currentSearchIndex = currentSearchIndex <= 0 ? searchResults.length - 1 : currentSearchIndex - 1;
            currentLine = Math.max(0, searchResults[currentSearchIndex] - Math.floor(linesPerPage / 2));
            updateDisplay();
          }
          e.preventDefault();
          break;
        case 'h':
        case '?':
          alert(`Less Viewer Help:
          
Navigation:
  j, ↓     - Move down one line
  k, ↑     - Move up one line  
  Space, f - Move down one page
  b        - Move up one page
  g        - Go to beginning
  G        - Go to end
  
Search:
  /        - Start search (or repeat last search if empty)
  n        - Next search result
  N        - Previous search result
  
Other:
  q        - Quit
  h, ?     - Show this help`);
          break;
      }
    };

    document.addEventListener('keydown', handleKeyPress);
    document.body.appendChild(modal);
    updateDisplay();
    
    return ''; // Don't return any output to terminal
  }

  // HTML escape utility
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Vi editor implementation
  showViEditor(content, filename, filePath) {
    const lines = content.split('\n');
    if (lines.length === 0 || (lines.length === 1 && lines[0] === '')) {
      lines[0] = ''; // Ensure at least one empty line
    }
    
    let cursorRow = 0;
    let cursorCol = 0;
    let mode = 'normal'; // 'normal', 'insert', or 'search'
    let hasChanges = false;
    let commandBuffer = '';
    let pendingCommand = ''; // For multi-key commands like 'dd'
    let searchTerm = '';
    let searchResults = [];
    let currentSearchIndex = -1;

    // Create vi editor modal
    const modal = document.createElement('div');
    modal.className = 'vi-editor-modal';
    modal.innerHTML = `
      <div class="vi-editor">
        <div class="vi-header">
          <span class="vi-filename">"${filename}" ${lines.length} lines</span>
          <span class="vi-mode">${mode.toUpperCase()}</span>
        </div>
        <div class="vi-content" id="vi-content"></div>
        <div class="vi-footer">
          <span class="vi-status" id="vi-status">Press 'i' for insert mode, ':' for commands</span>
          <span class="vi-position">${cursorRow + 1},${cursorCol + 1}</span>
        </div>
      </div>
    `;

    // Add CSS styles
    const style = document.createElement('style');
    style.textContent = `
      .vi-editor-modal {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.9);
        z-index: 1000;
        display: flex;
        justify-content: center;
        align-items: center;
      }
      .vi-editor {
        width: 90%;
        height: 90%;
        background: #000;
        color: #fff;
        font-family: 'Courier New', monospace;
        border: 1px solid #333;
        display: flex;
        flex-direction: column;
      }
      .vi-header {
        background: #333;
        padding: 5px 10px;
        display: flex;
        justify-content: space-between;
        font-size: 12px;
      }
      .vi-content {
        flex: 1;
        padding: 10px;
        overflow: auto;
        white-space: pre;
        line-height: 1.4;
        position: relative;
      }
      .vi-footer {
        background: #333;
        padding: 5px 10px;
        font-size: 12px;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .vi-cursor {
        background: #fff;
        color: #000;
        animation: blink 1s infinite;
      }
      .vi-cursor.insert {
        background: #0f0;
      }
      @keyframes blink {
        0%, 50% { opacity: 1; }
        51%, 100% { opacity: 0; }
      }
      .vi-line {
        min-height: 1.4em;
      }
    `;
    document.head.appendChild(style);

    const updateDisplay = () => {
      const contentDiv = modal.querySelector('#vi-content');
      const modeSpan = modal.querySelector('.vi-mode');
      const positionSpan = modal.querySelector('.vi-position');
      const statusSpan = modal.querySelector('#vi-status');
      
      // Ensure cursor is within bounds
      cursorRow = Math.max(0, Math.min(cursorRow, lines.length - 1));
      cursorCol = Math.max(0, Math.min(cursorCol, lines[cursorRow].length));
      
      // Build display with cursor - escape HTML to show raw text
      let displayContent = '';
      lines.forEach((line, rowIndex) => {
        if (rowIndex === cursorRow) {
          // Add cursor to current line
          const beforeCursor = this.escapeHtml(line.substring(0, cursorCol));
          const atCursor = cursorCol < line.length ? this.escapeHtml(line[cursorCol]) : ' ';
          const afterCursor = this.escapeHtml(line.substring(cursorCol + 1));
          displayContent += beforeCursor + 
            `<span class="vi-cursor ${mode}">${atCursor}</span>` + 
            afterCursor + '\n';
        } else {
          displayContent += this.escapeHtml(line) + '\n';
        }
      });
      
      contentDiv.innerHTML = displayContent;
      modeSpan.textContent = mode.toUpperCase() + (hasChanges ? ' [+]' : '');
      positionSpan.textContent = `${cursorRow + 1},${cursorCol + 1}`;
      
      if (commandBuffer) {
        statusSpan.textContent = commandBuffer;
      } else {
        statusSpan.textContent = mode === 'normal' ? 
          "Press 'i' for insert mode, ':' for commands" : 
          "Press Esc to return to normal mode";
      }
    };

    const saveFile = async () => {
      try {
        const content = lines.join('\n');
        await this.fileSystemDB.createFile(filePath, content, true);
        hasChanges = false;
        modal.querySelector('#vi-status').textContent = `"${filename}" written`;
        setTimeout(() => updateDisplay(), 1000);
        return true;
      } catch (error) {
        modal.querySelector('#vi-status').textContent = `Error: ${error.message}`;
        setTimeout(() => updateDisplay(), 2000);
        return false;
      }
    };

    const handleKeyPress = async (e) => {
      if (mode === 'normal') {
        // Command mode handling
        if (commandBuffer.startsWith(':')) {
          if (e.key === 'Enter') {
            const command = commandBuffer.substring(1);
            commandBuffer = '';
            
            switch (command) {
              case 'w':
                await saveFile();
                break;
              case 'q':
                if (hasChanges) {
                  modal.querySelector('#vi-status').textContent = 'No write since last change (use :q! to override)';
                  setTimeout(() => updateDisplay(), 2000);
                } else {
                  document.body.removeChild(modal);
                  document.head.removeChild(style);
                  document.removeEventListener('keydown', handleKeyPress);
                }
                break;
              case 'wq':
                if (await saveFile()) {
                  setTimeout(() => {
                    document.body.removeChild(modal);
                    document.head.removeChild(style);
                    document.removeEventListener('keydown', handleKeyPress);
                  }, 500);
                }
                break;
              case 'q!':
                document.body.removeChild(modal);
                document.head.removeChild(style);
                document.removeEventListener('keydown', handleKeyPress);
                break;
              default:
                modal.querySelector('#vi-status').textContent = `Unknown command: ${command}`;
                setTimeout(() => updateDisplay(), 2000);
            }
            updateDisplay();
            e.preventDefault();
            return;
          } else if (e.key === 'Escape') {
            commandBuffer = '';
            updateDisplay();
            e.preventDefault();
            return;
          } else if (e.key.length === 1) {
            commandBuffer += e.key;
            updateDisplay();
            e.preventDefault();
            return;
          }
        }
        
        // Normal mode navigation and commands
        switch (e.key) {
          case ':':
            commandBuffer = ':';
            updateDisplay();
            e.preventDefault();
            break;
          case 'i':
            mode = 'insert';
            updateDisplay();
            e.preventDefault();
            break;
          case 'o':
            lines.splice(cursorRow + 1, 0, '');
            cursorRow++;
            cursorCol = 0;
            mode = 'insert';
            hasChanges = true;
            updateDisplay();
            e.preventDefault();
            break;
          case 'x':
            if (cursorCol < lines[cursorRow].length) {
              lines[cursorRow] = lines[cursorRow].substring(0, cursorCol) + 
                                lines[cursorRow].substring(cursorCol + 1);
              hasChanges = true;
            }
            updateDisplay();
            e.preventDefault();
            break;
          case 'h':
          case 'ArrowLeft':
            cursorCol = Math.max(0, cursorCol - 1);
            updateDisplay();
            e.preventDefault();
            break;
          case 'l':
          case 'ArrowRight':
            cursorCol = Math.min(lines[cursorRow].length, cursorCol + 1);
            updateDisplay();
            e.preventDefault();
            break;
          case 'j':
          case 'ArrowDown':
            if (cursorRow < lines.length - 1) {
              cursorRow++;
              cursorCol = Math.min(cursorCol, lines[cursorRow].length);
            }
            updateDisplay();
            e.preventDefault();
            break;
          case 'k':
          case 'ArrowUp':
            if (cursorRow > 0) {
              cursorRow--;
              cursorCol = Math.min(cursorCol, lines[cursorRow].length);
            }
            updateDisplay();
            e.preventDefault();
            break;
        }
      } else if (mode === 'insert') {
        // Insert mode handling
        if (e.key === 'Escape') {
          mode = 'normal';
          cursorCol = Math.max(0, cursorCol - 1);
          updateDisplay();
          e.preventDefault();
        } else if (e.key === 'Enter') {
          const currentLine = lines[cursorRow];
          const beforeCursor = currentLine.substring(0, cursorCol);
          const afterCursor = currentLine.substring(cursorCol);
          lines[cursorRow] = beforeCursor;
          lines.splice(cursorRow + 1, 0, afterCursor);
          cursorRow++;
          cursorCol = 0;
          hasChanges = true;
          updateDisplay();
          e.preventDefault();
        } else if (e.key === 'Backspace') {
          if (cursorCol > 0) {
            lines[cursorRow] = lines[cursorRow].substring(0, cursorCol - 1) + 
                              lines[cursorRow].substring(cursorCol);
            cursorCol--;
            hasChanges = true;
          } else if (cursorRow > 0) {
            // Join with previous line
            const currentLine = lines[cursorRow];
            cursorCol = lines[cursorRow - 1].length;
            lines[cursorRow - 1] += currentLine;
            lines.splice(cursorRow, 1);
            cursorRow--;
            hasChanges = true;
          }
          updateDisplay();
          e.preventDefault();
        } else if (e.key.length === 1) {
          // Insert character
          lines[cursorRow] = lines[cursorRow].substring(0, cursorCol) + 
                            e.key + 
                            lines[cursorRow].substring(cursorCol);
          cursorCol++;
          hasChanges = true;
          updateDisplay();
          e.preventDefault();
        }
      }
    };

    document.addEventListener('keydown', handleKeyPress);
    document.body.appendChild(modal);
    updateDisplay();
    
    return ''; // Don't return any output to terminal
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
    if (this.windowId) return; // Only print welcome in main terminal mode

    const welcome = `
╔══════════════════════════════════════════════════════════════╗
║                    Welcome to jsh (Joe Shell) v1.0           ║
║                                                              ║
║  Type 'help' for available commands                          ║
║  Try: history, !!, alias ll='ls -l', echo $USER              ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
        `;
    this.addOutput(welcome);
  }

  printPrompt() {
    if (this.windowId) return; // Only print prompt in main terminal mode

    const promptText = document.getElementById('prompt-text');
    promptText.innerHTML = `${this.env.USER}@${this.env.HOSTNAME}:${this.getShortPath()}$ `;
    const terminalInput = document.getElementById('terminal-input');
    terminalInput.focus();
  }

  addCommandToOutput(command) {
    if (this.windowId) return; // Only add command to output in main terminal mode

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

// Terminal is now always initialized by the OS layer
// No standalone initialization needed

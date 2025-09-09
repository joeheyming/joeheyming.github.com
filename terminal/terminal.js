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

    // Signal handling system (like Unix signals)
    this.signalHandlers = {}; // Map of signal -> handler function
    this.currentProcess = null; // Currently running interactive process

    // Heredoc state management
    this.heredocMode = false;
    this.heredocDelimiter = null;
    this.heredocContent = [];
    this.heredocCommand = null;

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

    // Ensure this terminal's process is set as current for permission checks
    const originalCurrentProcess = this.os.kernel.processManager.currentProcess;
    if (this.process) {
      this.os.kernel.processManager.setCurrentProcess(this.process);
    }

    try {
      return await this.os.kernel.syscall(name, ...args);
    } finally {
      // Restore original current process
      this.os.kernel.processManager.setCurrentProcess(originalCurrentProcess);
    }
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

    // Handle heredoc mode
    if (this.heredocMode) {
      if (command === this.heredocDelimiter) {
        // End of heredoc - show the delimiter and execute the command
        this.addHeredocLineToOutput(command);
        await this.executeHeredocCommand();
        input.value = '';
        return;
      } else {
        // Add line to heredoc content
        this.heredocContent.push(command);
        this.addHeredocLineToOutput(command);
        input.value = '';
        this.printHeredocPrompt();
        return;
      }
    }

    // Check for heredoc start (e.g., "node << EOF" or "js << END")
    const heredocMatch = command.match(/^(.+?)\s*<<\s*(\w+)$/);
    if (heredocMatch) {
      this.heredocCommand = heredocMatch[1].trim();
      this.heredocDelimiter = heredocMatch[2];
      this.heredocMode = true;
      this.heredocContent = [];

      // Check if this is a recalled heredoc from history
      if (this.historyIndex >= 0 && this.historyIndex < this.commandHistory.length) {
        const fullHistoryCommand = this.commandHistory[this.historyIndex];
        if (fullHistoryCommand.includes('\n')) {
          // This is a recalled heredoc - populate the content
          const lines = fullHistoryCommand.split('\n');
          // Skip first line (heredoc start) and last line (delimiter)
          this.heredocContent = lines.slice(1, -1);

          this.addCommandToOutput(command);

          // Show all the heredoc content lines
          for (const line of this.heredocContent) {
            this.addHeredocLineToOutput(line);
          }

          // Show the delimiter and execute immediately
          this.addHeredocLineToOutput(this.heredocDelimiter);
          await this.executeHeredocCommand();
          input.value = '';
          return;
        }
      }

      this.addCommandToOutput(command);
      input.value = '';
      this.printHeredocPrompt();
      return;
    }

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

    // Handle path-based command execution (e.g., /bin/top, ./script.js)
    if (cmdName.includes('/')) {
      try {
        const filePath = this.resolvePath(cmdName);
        const file = await this.getFileSystemItem(filePath);

        if (file && file.type === 'file') {
          // Extract the actual command name from the path
          const actualCmd = cmdName.split('/').pop().toLowerCase();

          // Check if it's an executable file in /bin/
          if (filePath.startsWith('/bin/')) {
            const commandHandler = await window.commandRegistry.get(actualCmd);
            if (commandHandler) {
              try {
                const terminalContext = this;
                terminalContext.stdin = stdin;
                terminalContext.hasStdin = stdin.length > 0;
                terminalContext.redirections = cmd.redirections;

                const result = commandHandler(terminalContext, cmd.args);
                const output = result instanceof Promise ? await result : result;

                // Clean up temporary properties
                delete terminalContext.stdin;
                delete terminalContext.hasStdin;
                delete terminalContext.redirections;

                return {
                  stdout: output || '',
                  stderr: ''
                };
              } catch (error) {
                return {
                  stdout: '',
                  stderr: `Error executing ${filePath}: ${error.message}`
                };
              }
            }
          }

          // Handle script files (e.g., ./script.js, /path/to/script.sh)
          if (actualCmd.endsWith('.js') || actualCmd.endsWith('.sh') || file.executable) {
            if (actualCmd.endsWith('.js')) {
              // Execute JavaScript files using the node command
              const nodeCommand = await this.commandRegistry.get('node');
              if (nodeCommand) {
                return {
                  stdout: await nodeCommand(this, [filePath, ...cmd.args]),
                  stderr: ''
                };
              } else {
                return {
                  stdout: '',
                  stderr: 'JavaScript execution not available. Node command not loaded.'
                };
              }
            } else {
              // For shell scripts and other executables, show content for now
              return {
                stdout: `Executing ${filePath}:\n${file.content || 'File is empty'}`,
                stderr: ''
              };
            }
          }

          // File exists but is not executable
          return {
            stdout: '',
            stderr: `bash: ${filePath}: Permission denied`
          };
        } else {
          // File doesn't exist
          return {
            stdout: '',
            stderr: `bash: ${cmdName}: No such file or directory`
          };
        }
      } catch (error) {
        return {
          stdout: '',
          stderr: `bash: ${cmdName}: ${error.message}`
        };
      }
    }

    // Try to get command from registry (now async)
    const commandHandler = await window.commandRegistry.get(cmdName);
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

  async executeHeredocCommand() {
    try {
      const content = this.heredocContent.join('\n');
      const command = this.heredocCommand.toLowerCase();

      // Build complete heredoc command for history
      const completeHeredoc = `${this.heredocCommand} << ${this.heredocDelimiter}\n${content}\n${this.heredocDelimiter}`;

      // Add complete heredoc to command history
      if (
        completeHeredoc &&
        completeHeredoc !== this.commandHistory[this.commandHistory.length - 1]
      ) {
        this.commandHistory.push(completeHeredoc);
      }

      // Reset heredoc state
      this.heredocMode = false;
      const originalCommand = this.heredocCommand;
      const originalDelimiter = this.heredocDelimiter;
      this.heredocCommand = null;
      this.heredocDelimiter = null;
      this.heredocContent = [];

      // Handle different heredoc commands
      if (command === 'js' || command === 'node' || command === 'javascript') {
        // Execute JavaScript heredoc
        const result = await this.executeJavaScriptContent(content);
        if (result.stdout) {
          this.addOutput(result.stdout);
        }
        if (result.stderr) {
          this.addOutput(result.stderr);
        }
      } else if (command === 'cat') {
        // Just output the content (like cat << EOF)
        this.addOutput(content);
      } else if (command === 'echo') {
        // Echo the content
        this.addOutput(content);
      } else {
        // Try to execute as a regular command with the content as stdin
        const result = await this.executeSingleCommand(
          { name: command, args: [], redirections: {} },
          content
        );
        if (result.stdout) {
          this.addOutput(result.stdout);
        }
        if (result.stderr) {
          this.addOutput(result.stderr);
        }
      }
    } catch (error) {
      this.addOutput(`Error executing heredoc: ${error.message}`);
    }

    // Show new prompt
    this.printPrompt();
  }

  async executeJavaScriptContent(content) {
    // Simple JavaScript execution for heredoc content
    try {
      let output = '';
      let errorOutput = '';

      // Override console to capture output
      const originalConsole = console.log;
      const originalError = console.error;
      const originalWarn = console.warn;

      console.log = (...args) => {
        output += args.join(' ') + '\n';
      };

      console.error = (...args) => {
        errorOutput += args.join(' ') + '\n';
      };

      console.warn = (...args) => {
        errorOutput += args.join(' ') + '\n';
      };

      try {
        // Execute the JavaScript content
        const func = new Function(content);
        func();
      } finally {
        // Restore original console
        console.log = originalConsole;
        console.error = originalError;
        console.warn = originalWarn;
      }

      return {
        stdout: output.trim(),
        stderr: errorOutput.trim()
      };
    } catch (error) {
      return {
        stdout: '',
        stderr: `Error: ${error.message}`
      };
    }
  }

  printHeredocPrompt() {
    if (this.windowId) return; // Only print prompt in main terminal mode

    const promptText = document.getElementById('prompt-text');
    promptText.innerHTML = `> `;
    const terminalInput = document.getElementById('terminal-input');
    terminalInput.focus();
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

    const historyCommand = this.commandHistory[this.historyIndex] || '';

    // Check if this is a multi-line heredoc command
    if (historyCommand.includes('\n')) {
      // For heredocs, only show the first line (the heredoc start command)
      const lines = historyCommand.split('\n');
      input.value = lines[0];
    } else {
      input.value = historyCommand;
    }
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
      let matches = [];

      // If the input starts with a path, handle path-based completion
      if (lastPart.includes('/')) {
        await this.handlePathCompletion(input, parts, lastPart);
        return;
      }

      // Get regular command names
      const commands = window.commandRegistry.getCommandNames();
      matches = commands.filter((cmd) => cmd.startsWith(lastPart));

      // Also add /bin/ versions of commands if user is typing /bin/
      if (lastPart.startsWith('/bin/')) {
        const binPrefix = lastPart.substring(5); // Remove '/bin/'
        const binMatches = commands
          .filter((cmd) => cmd.startsWith(binPrefix))
          .map((cmd) => `/bin/${cmd}`);
        matches = matches.concat(binMatches);
      } else if (lastPart === '/bin' || lastPart === '/bin/') {
        // Show all /bin/ commands
        const binCommands = commands.map((cmd) => `/bin/${cmd}`);
        matches = matches.concat(binCommands);
      }

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
        const clearHandler = window.commandRegistry.getSync('clear');
        if (clearHandler) {
          clearHandler(this, []);
        }
        break;

      case 'c': // Ctrl+C: Send SIGINT signal
        input.value = '';
        this.addOutput('^C');

        // Exit heredoc mode if active
        if (this.heredocMode) {
          this.heredocMode = false;
          this.heredocCommand = null;
          this.heredocDelimiter = null;
          this.heredocContent = [];
          this.printPrompt();
        } else {
          this.sendSignal('SIGINT');
        }
        break;

      case 'd': // Ctrl+D: EOF (exit if line is empty)
        if (value.length === 0) {
          this.addOutput('exit');
        }
        break;

      case 'r': // Ctrl+R: Reverse search (interactive)
        this.startReverseSearch(input);
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
      30: 'black',
      31: 'red',
      32: 'green',
      33: 'yellow',
      34: 'blue',
      35: 'magenta',
      36: 'cyan',
      37: 'white',
      90: 'gray',
      91: 'lightred',
      92: 'lightgreen',
      93: 'lightyellow',
      94: 'lightblue',
      95: 'lightmagenta',
      96: 'lightcyan',
      97: 'lightwhite'
    };

    const ansiBgColors = {
      40: 'black',
      41: 'red',
      42: 'green',
      43: 'yellow',
      44: 'blue',
      45: 'magenta',
      46: 'cyan',
      47: 'white',
      100: 'gray',
      101: 'lightred',
      102: 'lightgreen',
      103: 'lightyellow',
      104: 'lightblue',
      105: 'lightmagenta',
      106: 'lightcyan',
      107: 'lightwhite'
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

      codeList.forEach((code) => {
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
        outputElement.className = streaming
          ? 'terminal-line streaming-output ansi-output'
          : 'terminal-line ansi-output';
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
      }:${this.getShortPath()}$</span> <input type="text" class="terminal-input" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="Type a command...">`;
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

  // HTML escape utility
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Vi editor implementation

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

  // ============================================================================
  // TERMINAL API METHODS - Commands should use these instead of direct DOM manipulation
  // ============================================================================

  /**
   * Terminal I/O API - Standard input/output interface for commands
   */

  // Write output to terminal (replaces direct DOM manipulation)
  writeOutput(text, options = {}) {
    return this.addOutput(text, options);
  }

  // Write error to terminal
  writeError(text) {
    return this.addOutput(`Error: ${text}`);
  }

  // Clear terminal screen (proper way for commands to clear)
  clearScreen() {
    if (this.windowId) {
      // OS-integrated mode
      const windowElement = document.getElementById(`window-${this.windowId}`);
      const terminalContent = windowElement.querySelector('.terminal-content');
      terminalContent.innerHTML = `
        <div class="terminal-line">
          <span class="terminal-prompt">${this.env.USER}@${
        this.env.HOSTNAME
      }:${this.getShortPath()}$</span> <input type="text" class="terminal-input" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="Type a command...">
        </div>
      `;
      this.initialize();
    } else {
      // Standalone mode
      const terminalOutput = document.getElementById('terminal-output');
      if (terminalOutput) {
        terminalOutput.innerHTML = '';
      }
    }
  }

  /**
   * Modal/Fullscreen API - For commands that need full-screen interfaces
   */

  // Create a modal interface (for commands like less, vi)
  createModal(options = {}) {
    const {
      className = 'terminal-modal',
      title = '',
      content = '',
      onKeyDown = null,
      onClose = null
    } = options;

    // Disable terminal input while modal is active
    this.disableTerminalInput();

    // Create modal
    const modal = document.createElement('div');
    modal.className = className;
    modal.innerHTML = content;
    modal.tabIndex = -1; // Make focusable for keyboard events

    // Add to DOM
    document.body.appendChild(modal);
    modal.focus();

    // Enhanced keyboard event handler with automatic Ctrl+C support
    const enhancedKeyHandler = (e) => {
      // Handle Ctrl+C automatically for all modals (like a real terminal)
      if (e.ctrlKey && e.key === 'c') {
        e.preventDefault();
        e.stopPropagation();
        this.addOutput('^C');
        this.sendSignal('SIGINT');
        return;
      }

      // Call custom onKeyDown handler if provided
      if (onKeyDown) {
        onKeyDown(e);
      }
    };

    modal.addEventListener('keydown', enhancedKeyHandler);

    // Return modal interface
    return {
      element: modal,
      update: (newContent) => {
        modal.innerHTML = newContent;
      },
      close: () => {
        document.body.removeChild(modal);
        this.enableTerminalInput();
        if (onClose) onClose();
      },
      focus: () => modal.focus()
    };
  }

  // Add CSS styles to document (utility for commands)
  addStyles(cssText) {
    const style = document.createElement('style');
    style.textContent = cssText;
    document.head.appendChild(style);
    return style; // Return so commands can remove it later
  }

  /**
   * Display Control API - For commands that need display control
   */

  // Disable terminal input (for modal commands)
  disableTerminalInput() {
    const terminalInput = document.getElementById('terminal-input');
    if (terminalInput) {
      terminalInput.disabled = true;
      terminalInput.blur();
    }
    // Also disable any other terminal inputs in multi-line mode
    const allInputs = document.querySelectorAll('.terminal-input');
    allInputs.forEach((input) => {
      input.disabled = true;
      input.blur();
    });
  }

  // Re-enable terminal input
  enableTerminalInput() {
    const terminalInput = document.getElementById('terminal-input');
    if (terminalInput) {
      terminalInput.disabled = false;
      terminalInput.focus();
    }
    // Also re-enable any other terminal inputs
    const allInputs = document.querySelectorAll('.terminal-input');
    allInputs.forEach((input) => {
      input.disabled = false;
    });
    // Focus the most recent input
    const lastInput = document.querySelector('.terminal-input:last-of-type');
    if (lastInput) {
      lastInput.focus();
    }
  }

  /**
   * Input API - For modal commands that need user input
   */

  // Create an input prompt within a modal (replaces prompt())
  createInputPrompt(modal, options = {}) {
    const {
      prompt = 'Input: ',
      placeholder = '',
      onEnter = null,
      onEscape = null,
      onInput = null
    } = options;

    // Create input overlay within the modal
    const inputOverlay = document.createElement('div');
    inputOverlay.className = 'terminal-input-overlay';
    inputOverlay.innerHTML = `
      <div class="terminal-input-prompt">
        <span class="prompt-text">${this.escapeHtml(prompt)}</span>
        <input type="text" class="prompt-input" placeholder="${this.escapeHtml(placeholder)}" />
      </div>
    `;

    // Add CSS for the input overlay
    const overlayStyle = `
      .terminal-input-overlay {
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        background: #333;
        border-top: 1px solid #555;
        padding: 5px 10px;
        z-index: 1001;
      }
      .terminal-input-prompt {
        display: flex;
        align-items: center;
        font-family: 'Courier New', monospace;
        font-size: 12px;
      }
      .prompt-text {
        color: #0f0;
        margin-right: 5px;
      }
      .prompt-input {
        flex: 1;
        background: #000;
        color: #0f0;
        border: none;
        padding: 2px 5px;
        font-family: 'Courier New', monospace;
        font-size: 12px;
        outline: none;
      }
    `;

    // Add styles if not already present
    if (!document.querySelector('#terminal-input-overlay-styles')) {
      const style = document.createElement('style');
      style.id = 'terminal-input-overlay-styles';
      style.textContent = overlayStyle;
      document.head.appendChild(style);
    }

    // Add overlay to modal
    modal.element.appendChild(inputOverlay);
    const input = inputOverlay.querySelector('.prompt-input');

    // Focus the input with a slight delay to ensure it's rendered
    setTimeout(() => input.focus(), 10);

    // Handle input events
    const handleKeyDown = (e) => {
      e.stopPropagation(); // Prevent modal from handling this event

      if (e.key === 'Enter') {
        const value = input.value;
        cleanup();
        if (onEnter) onEnter(value);
      } else if (e.key === 'Escape') {
        cleanup();
        if (onEscape) onEscape();
      }
    };

    const handleInput = (e) => {
      if (onInput) onInput(e.target.value);
    };

    input.addEventListener('keydown', handleKeyDown);
    input.addEventListener('input', handleInput);

    const cleanup = () => {
      input.removeEventListener('keydown', handleKeyDown);
      input.removeEventListener('input', handleInput);
      modal.element.removeChild(inputOverlay);
      // Use setTimeout to ensure proper focus after DOM changes
      setTimeout(() => modal.focus(), 10);
    };

    return {
      focus: () => input.focus(),
      getValue: () => input.value,
      setValue: (value) => {
        input.value = value;
      },
      close: cleanup
    };
  }

  /**
   * Utility API - Helper methods for commands
   */

  // HTML escape utility (safer than commands doing it themselves)
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Get terminal dimensions (useful for fullscreen commands)
  getTerminalDimensions() {
    if (this.windowId) {
      const windowElement = document.getElementById(`window-${this.windowId}`);
      const terminalContent = windowElement.querySelector('.terminal-content');
      return {
        width: terminalContent.clientWidth,
        height: terminalContent.clientHeight
      };
    } else {
      const terminalOutput = document.getElementById('terminal-output');
      return {
        width: terminalOutput.clientWidth,
        height: terminalOutput.clientHeight
      };
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

  addHeredocLineToOutput(command) {
    if (this.windowId) return; // Only add command to output in main terminal mode

    const terminalOutput = document.getElementById('terminal-output');
    const commandLine = document.createElement('div');
    commandLine.className = 'terminal-line';
    commandLine.innerHTML = `<span class="prompt">></span> ${command}`;
    terminalOutput.appendChild(commandLine);
  }

  /**
   * Interactive Reverse Search - Like bash Ctrl+R
   */

  startReverseSearch(input) {
    // Save original input state
    const originalValue = input.value;

    // Find the prompt element - handle different terminal contexts
    let promptElement = input.parentElement.querySelector('.terminal-prompt');
    if (!promptElement) {
      // Try main terminal prompt
      promptElement = document.getElementById('prompt-text');
    }
    if (!promptElement) {
      // Try generic prompt class
      promptElement = input.parentElement.querySelector('.prompt');
    }

    if (!promptElement) {
      console.error('Could not find prompt element for reverse search');
      return;
    }

    const originalPrompt = promptElement.textContent;

    // Set up reverse search state
    let searchTerm = '';
    let currentMatch = '';
    let matchIndex = -1;

    // Update prompt to show reverse search mode
    const updatePrompt = () => {
      if (currentMatch) {
        promptElement.textContent = `(reverse-i-search)\`${searchTerm}': `;
        input.value = currentMatch;
      } else {
        promptElement.textContent = `(reverse-i-search)\`${searchTerm}': `;
        input.value = '';
      }
    };

    // Search function
    const performSearch = () => {
      if (searchTerm === '') {
        currentMatch = '';
        matchIndex = -1;
        updatePrompt();
        return;
      }

      const matches = [...this.commandHistory]
        .reverse()
        .filter((cmd) => cmd.toLowerCase().includes(searchTerm.toLowerCase()));

      if (matches.length > 0) {
        matchIndex = 0;
        currentMatch = matches[0];
      } else {
        currentMatch = '';
        matchIndex = -1;
      }
      updatePrompt();
    };

    // Exit reverse search
    const exitSearch = (accept = false) => {
      promptElement.textContent = originalPrompt;
      if (accept && currentMatch) {
        input.value = currentMatch;
      } else {
        input.value = originalValue;
      }

      // Remove event listeners
      input.removeEventListener('keydown', reverseSearchHandler);
      input.removeEventListener('input', inputHandler);
    };

    // Handle input changes - we need to track the search term manually
    const inputHandler = (e) => {
      // Prevent default input handling since we're managing the search term manually
      e.preventDefault();
    };

    // Handle special keys during reverse search
    const reverseSearchHandler = (e) => {
      switch (e.key) {
        case 'Enter':
          e.preventDefault();
          exitSearch(true);
          // Trigger command execution
          this.handleCommand(input);
          break;

        case 'Escape':
          e.preventDefault();
          exitSearch(false);
          break;

        case 'ArrowUp':
        case 'ArrowDown':
          e.preventDefault();
          // Navigate through matches
          if (searchTerm && currentMatch) {
            const matches = [...this.commandHistory]
              .reverse()
              .filter((cmd) => cmd.toLowerCase().includes(searchTerm.toLowerCase()));

            if (matches.length > 1) {
              if (e.key === 'ArrowUp') {
                matchIndex = (matchIndex + 1) % matches.length;
              } else {
                matchIndex = matchIndex > 0 ? matchIndex - 1 : matches.length - 1;
              }
              currentMatch = matches[matchIndex];
              updatePrompt();
            }
          }
          break;

        case 'Backspace':
          e.preventDefault();
          if (searchTerm.length > 0) {
            searchTerm = searchTerm.slice(0, -1);
            performSearch();
          }
          break;

        default:
          if (e.ctrlKey && e.key === 'r') {
            // Ctrl+R again - find next match
            e.preventDefault();
            if (searchTerm && currentMatch) {
              const matches = [...this.commandHistory]
                .reverse()
                .filter((cmd) => cmd.toLowerCase().includes(searchTerm.toLowerCase()));

              if (matches.length > 1) {
                matchIndex = (matchIndex + 1) % matches.length;
                currentMatch = matches[matchIndex];
                updatePrompt();
              }
            }
          } else if (e.ctrlKey && e.key === 'c') {
            // Ctrl+C - cancel search
            e.preventDefault();
            exitSearch(false);
          } else if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
            // Regular character input
            e.preventDefault();
            searchTerm += e.key;
            performSearch();
          }
          break;
      }
    };

    // Set up event listeners
    input.addEventListener('keydown', reverseSearchHandler);
    input.addEventListener('input', inputHandler);

    // Initialize
    input.value = '';
    updatePrompt();
  }

  /**
   * Signal System API - Unix-like signal handling for commands
   */

  // Register a signal handler (like signal() or sigaction() in Unix)
  onSignal(signalName, handler) {
    // Create a unique event listener for this terminal instance
    const eventType = `terminal-signal-${signalName}-${this.windowId || 'main'}`;

    // Store the handler and event type for cleanup
    if (!this.signalHandlers[signalName]) {
      this.signalHandlers[signalName] = [];
    }

    const eventHandler = (event) => {
      try {
        handler(event.detail.signalName, event.detail);
      } catch (error) {
        console.error(`Error in signal handler for ${signalName}:`, error);
      }
    };

    this.signalHandlers[signalName].push({
      handler: eventHandler,
      eventType: eventType
    });

    window.addEventListener(eventType, eventHandler);
  }

  // Remove a signal handler
  offSignal(signalName) {
    if (this.signalHandlers[signalName]) {
      // Remove all event listeners for this signal
      this.signalHandlers[signalName].forEach(({ handler, eventType }) => {
        window.removeEventListener(eventType, handler);
      });
      delete this.signalHandlers[signalName];
    }
  }

  // Send a signal to the current process (like kill() in Unix)
  sendSignal(signalName, data = {}) {
    const eventType = `terminal-signal-${signalName}-${this.windowId || 'main'}`;

    // Create and dispatch custom event
    const signalEvent = new CustomEvent(eventType, {
      detail: {
        signalName: signalName,
        timestamp: Date.now(),
        terminalId: this.windowId || 'main',
        ...data
      }
    });

    // Dispatch asynchronously to avoid issues with handlers modifying the signal registry
    setTimeout(() => {
      window.dispatchEvent(signalEvent);
    }, 0);
  }

  // Set the current running process (for signal targeting)
  setCurrentProcess(processInfo) {
    this.currentProcess = processInfo;
  }

  // Clear the current process
  clearCurrentProcess() {
    this.currentProcess = null;
    // Clear all signal handlers when process ends
    Object.keys(this.signalHandlers).forEach((signalName) => {
      this.offSignal(signalName);
    });
  }
}

// Export for use in os.js
window.Terminal = Terminal;

// Terminal is now always initialized by the OS layer
// No standalone initialization needed

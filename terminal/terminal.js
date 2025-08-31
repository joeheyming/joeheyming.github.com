// Enhanced Terminal for Heyming OS - Modular Version
class Terminal {
  constructor(windowId = null, osInstance = null) {
    this.windowId = windowId;
    this.os = osInstance;
    this.currentDirectory = '/home/user';
    this.commandHistory = [];
    this.historyIndex = -1;
    this.fileSystemDB = new FileSystemDB();
    this.isStandalone = !windowId; // Detect if running standalone
    this.commandsLoaded = false;
    this.filesystemReady = false;

    // Load command history from session storage
    this.loadCommandHistory();

    // Initialize filesystem and load commands
    this.initializeFilesystem()
      .then(() => {
        this.filesystemReady = true;
        return this.loadCommands();
      })
      .then(() => {
        this.commandsLoaded = true;
        // Initialize terminal after a brief delay
        setTimeout(() => this.initialize(), 100);
      })
      .catch((error) => {
        console.error('Failed to initialize terminal:', error);
        // Fallback to in-memory filesystem
        this.fileSystem = this.initializeFileSystem();
        this.filesystemReady = true;
        this.loadCommands().then(() => {
          this.commandsLoaded = true;
          setTimeout(() => this.initialize(), 100);
        });
      });
  }

  async loadCommands() {
    if (window.commandRegistry) {
      await window.commandRegistry.loadCommands();
    }
  }

  async initializeFilesystem() {
    await this.fileSystemDB.initializeWithScaffolding();
  }

  initializeFileSystem() {
    return {
      '/': {
        type: 'directory',
        contents: {
          home: {
            type: 'directory',
            contents: {
              user: {
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
              passwd: { type: 'file', content: 'user:x:1000:1000:User:/home/user:/bin/bash' },
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
      currentLine.innerHTML = `<span class="terminal-prompt">user@heyming-os:${this.getShortPath()}$</span> ${command}`;

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
    const parts = command.trim().split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);

    if (cmd === '') return '';

    // Check if commands are loaded
    if (!this.commandsLoaded) {
      return 'Terminal is still loading commands, please wait...';
    }

    // Check if filesystem is ready
    if (!this.filesystemReady) {
      return 'Filesystem is still initializing, please wait...';
    }

    // Special case for help command
    if (cmd === 'help') {
      return this.helpCommand();
    }

    // Try to get command from registry
    const commandHandler = window.commandRegistry.get(cmd);
    if (commandHandler) {
      try {
        const result = commandHandler(this, args);
        // Handle both sync and async command handlers
        return result instanceof Promise ? await result : result;
      } catch (error) {
        return `Error executing ${cmd}: ${error.message}`;
      }
    }

    return `bash: ${cmd}: command not found\nTry 'help' for available commands or 'sudo apt install ${cmd}' to pretend to install it! 😄`;
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
  - Ctrl+R for reverse search`;

    return helpText;
  }

  // Helper methods
  resolvePath(path) {
    if (path.startsWith('/')) {
      return path;
    }

    if (path === '..') {
      const parts = this.currentDirectory.split('/').filter((p) => p);
      parts.pop();
      return parts.length === 0 ? '/' : '/' + parts.join('/');
    }

    if (path === '.') {
      return this.currentDirectory;
    }

    return this.currentDirectory === '/' ? `/${path}` : `${this.currentDirectory}/${path}`;
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
    if (this.currentDirectory === '/home/user') {
      return '~';
    }
    if (this.currentDirectory.startsWith('/home/user/')) {
      return '~' + this.currentDirectory.substring(10);
    }
    return this.currentDirectory;
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

  handleTabCompletion(input) {
    const value = input.value;
    const parts = value.split(' ');
    const lastPart = parts[parts.length - 1];

    // Command completion
    if (parts.length === 1) {
      const commands = window.commandRegistry.getCommandNames();
      const matches = commands.filter((cmd) => cmd.startsWith(lastPart));

      if (matches.length === 1) {
        input.value = matches[0] + ' ';
      }
    }
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
    newLine.innerHTML = `<span class="terminal-prompt">user@heyming-os:${this.getShortPath()}$</span> <input type="text" class="terminal-input" placeholder="Type a command...">`;
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
║                    Welcome to Heyming Terminal v2.0          ║
║                                                              ║
║  Type 'help' for available commands                          ║
║  Type 'matrix' for a special surprise!                       ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
        `;
    this.addOutput(welcome);
  }

  printPrompt() {
    if (!this.isStandalone) return;

    const promptText = document.getElementById('prompt-text');
    promptText.innerHTML = `user@heyming-os:${this.getShortPath()}$ `;
    const terminalInput = document.getElementById('terminal-input');
    terminalInput.focus();
  }

  addCommandToOutput(command) {
    if (!this.isStandalone) return;

    const terminalOutput = document.getElementById('terminal-output');
    const commandLine = document.createElement('div');
    commandLine.className = 'terminal-line';
    commandLine.innerHTML = `<span class="prompt">user@heyming-os:${this.getShortPath()}$</span> ${command}`;
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

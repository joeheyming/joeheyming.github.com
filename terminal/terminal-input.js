import { commandRegistry } from './commands.js';
export class TerminalInputMixin {
bindInputEvents(input) {
  if (input._jshBound) return;
  input._jshBound = true;
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

  // Expand history references (!! / !n / !string) before adding to history,
  // so the expanded form is stored rather than the raw "!!" token.
  let expanded = command;
  try {
    expanded = this.expandHistory(command);
  } catch (e) {
    // History expansion error (e.g. event not found) — show error and bail
    this.addCommandToOutput(command);
    input.value = '';
    this.historyIndex = -1;
    this.lastExitCode = 1;
    this.addOutput(e.message, { outputClass: 'stderr' });
    if (!this.windowId) {
      this.printPrompt();
    } else {
      this.addNewInputLine();
      this.scrollToBottom();
    }
    return;
  }

  if (expanded !== command) {
    this.addOutput(expanded);
  }

  // Add expanded command to history
  if (expanded && expanded !== this.commandHistory[this.commandHistory.length - 1]) {
    this.commandHistory.push(expanded);
  }
  this.historyIndex = -1;

  if (!this.windowId) {
    // Main terminal mode - add command to output and clear input
    const commandLineEl = this.addCommandToOutput(command);
    input.value = '';

    const useBlock = expanded.trim() !== '';
    if (useBlock) this.beginBlockingCommandRun();
    try {
      try {
        const output = await this.processCommand(expanded);
        if (output) {
          this.addOutput(output);
        }
      } catch (error) {
        if (this.isAbortLikeError(error)) {
          this.lastExitCode = 130;
          this.addOutput('^C');
        } else {
          this.lastExitCode = 1;
          this.addOutput(`Error: ${error.message}`, { outputClass: 'stderr' });
        }
      }
    } finally {
      if (useBlock) this.endBlockingCommandRun();
    }

    if (expanded.trim() !== '') {
      this.annotateCommandLineWithExit(commandLineEl, this.lastExitCode);
    }

    this.printPrompt();
  } else {
    // OS-integrated mode - original behavior
    const currentLine = input.closest('.terminal-line');
    if (currentLine) {
      currentLine.classList.add('command-echo-line');
      currentLine.replaceChildren();
      const promptSpan = document.createElement('span');
      promptSpan.className = 'terminal-prompt';
      promptSpan.textContent = `${this.env.USER}@${this.env.HOSTNAME}:${this.getShortPath()}$`;
      currentLine.appendChild(promptSpan);
      currentLine.appendChild(document.createTextNode(` ${command}`));
    } else {
      // Fallback if no terminal-line found
      console.warn('No terminal-line found, using standalone mode behavior');
      this.addOutput(`${this.env.USER}@${this.env.HOSTNAME}:${this.getShortPath()}$ ${command}`);
    }

    const useBlock = expanded.trim() !== '';
    if (useBlock) this.beginBlockingCommandRun();
    try {
      try {
        const output = await this.processCommand(expanded);
        if (output) {
          this.addOutput(output);
        }
      } catch (error) {
        if (this.isAbortLikeError(error)) {
          this.lastExitCode = 130;
          this.addOutput('^C');
        } else {
          this.lastExitCode = 1;
          this.addOutput(`Error: ${error.message}`, { outputClass: 'stderr' });
        }
      }
    } finally {
      if (useBlock) this.endBlockingCommandRun();
    }

    if (expanded.trim() !== '' && currentLine) {
      this.annotateCommandLineWithExit(currentLine, this.lastExitCode);
    }

    this.addNewInputLine();
    this.scrollToBottom();
  }
}
handleCtrlShortcuts(event, input) {
  const start = input.selectionStart;
  const end = input.selectionEnd;
  const value = input.value;

  switch (event.key) {
    case 'w': {
      // Ctrl+W: Delete word backwards
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
    }

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

    case 'l': {
      // Ctrl+L: Clear screen
      const clearHandler = commandRegistry.getSync('clear');
      if (clearHandler) {
        clearHandler(this, []);
      }
      break;
    }

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
        input.value = 'exit';
        this.handleCommand(input);
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
  const reverseSearchHandler = async (e) => {
    switch (e.key) {
      case 'Enter':
        e.preventDefault();
        exitSearch(true);
        await this.handleCommand(input);
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
}

import { ShellCore } from './lib/shell-core.js';
export class TerminalOutputMixin {
  printHeredocPrompt() {
    if (this.windowId) return; // Only print prompt in main terminal mode

    const promptText = document.getElementById('prompt-text');
    promptText.innerHTML = `> `;
    const terminalInput = document.getElementById('terminal-input');
    terminalInput.focus();
  }
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

    /* eslint-disable no-control-regex -- strip literal ANSI ESC (\x1b) sequences */
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
    /* eslint-enable no-control-regex */

    return result;
  }

  addOutput(output, options = {}) {
    const {
      preserveAnsi = false,
      streaming = false,
      outputClass = '',
      block = false,
      welcomeAriaSummary = ''
    } = options;
    const text = ShellCore.coerceShellString(output);

    // Auto-engage ANSI processing when escape sequences are present. Otherwise
    // the plain-text path (textContent) would strip the invisible \x1b but
    // leave the bracket codes visible — e.g. `[33m` showing up in stdout. The
    // .ansi-output CSS already maps the literal color names to themed palette
    // variables, so this is strictly an upgrade for any colored stdout.
    // eslint-disable-next-line no-control-regex
    const effectiveAnsi = preserveAnsi || /\x1b\[/.test(text);

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

      if (block && !effectiveAnsi && !streaming) {
        const outputElement = this._createBlockOutputElement(
          text,
          outputClass,
          welcomeAriaSummary,
          {
            withTerminalLine: true
          }
        );
        terminalContent.appendChild(outputElement);
        terminalContent.scrollTop = terminalContent.scrollHeight;
        return;
      }

      if (effectiveAnsi) {
        // Process ANSI sequences
        const processedOutput = this.processAnsiSequences(text);
        const outputElement = document.createElement('div');
        outputElement.className = streaming
          ? 'terminal-line streaming-output ansi-output'
          : 'terminal-line ansi-output';
        outputElement.innerHTML = processedOutput;
        terminalContent.appendChild(outputElement);
      } else {
        // Regular text output
        const outputLines = text.split('\n');
        outputLines.forEach((line) => {
          const outputElement = document.createElement('div');
          outputElement.className = outputClass
            ? ['terminal-line', 'terminal-output', outputClass].filter(Boolean).join(' ')
            : 'terminal-line';
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

      if (block && !effectiveAnsi && !streaming) {
        const outputElement = this._createBlockOutputElement(
          text,
          outputClass,
          welcomeAriaSummary,
          {
            withTerminalLine: false
          }
        );
        terminalOutput.appendChild(outputElement);
        terminalOutput.scrollTop = terminalOutput.scrollHeight;
        return;
      }

      if (effectiveAnsi) {
        // Process ANSI sequences for animations
        const processedOutput = this.processAnsiSequences(text);
        const outputElement = document.createElement('div');
        outputElement.className = 'terminal-output ansi-output';
        outputElement.innerHTML = processedOutput;
        terminalOutput.appendChild(outputElement);
      } else {
        // Regular text output
        const outputLines = text.split('\n');
        outputLines.forEach((line) => {
          const outputElement = document.createElement('div');
          outputElement.className = ['terminal-output', outputClass].filter(Boolean).join(' ');
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
      if (newInput instanceof HTMLInputElement) newInput.focus();
      this.bindInputEvents(newInput);
    } else {
      // Main terminal mode - the input is already there, just focus it
      const terminalInput = document.getElementById('terminal-input');
      if (terminalInput instanceof HTMLInputElement) {
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
      // Main terminal mode — scroll the wrapper so prompt + output move together
      const scrollEl = document.getElementById('terminal-scroll');
      if (scrollEl) {
        scrollEl.scrollTop = scrollEl.scrollHeight;
      } else {
        const terminalOutput = document.getElementById('terminal-output');
        if (terminalOutput) terminalOutput.scrollTop = terminalOutput.scrollHeight;
      }
    }
  }

  /**
   * Theme G: floating "Jump to latest" when the transcript is scrolled away from the bottom (standalone).
   */
  _bindTerminalClickToFocus(fallbackInput) {
    const container = this.windowId
      ? document.getElementById(`window-${this.windowId}`)
      : document.getElementById('terminal-container');
    if (!container) return;
    container.addEventListener('click', (e) => {
      if (window.getSelection().toString()) return;
      const tgt = e.target;
      if (tgt instanceof HTMLElement) {
        if (tgt.tagName === 'INPUT' || tgt.tagName === 'BUTTON') return;
        if (tgt.closest('.terminal-modal, .top-modal, .less-modal, .vi-editor-modal')) return;
      }
      const activeInput = container.querySelector('.terminal-input:last-of-type') || fallbackInput;
      if (activeInput instanceof HTMLInputElement && !activeInput.disabled) activeInput.focus();
    });
  }

  _bindScrollLatestAffordance() {
    if (this.windowId) return;
    const btn = document.getElementById('terminal-scroll-latest');
    const scrollEl = document.getElementById('terminal-scroll');
    const terminalOutput = document.getElementById('terminal-output');
    if (!btn || !scrollEl) return;

    const thresholdPx = 48;
    const update = () => {
      const gap = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
      const atBottom = gap <= thresholdPx;
      if (atBottom) {
        btn.setAttribute('hidden', '');
      } else {
        btn.removeAttribute('hidden');
      }
    };

    scrollEl.addEventListener('scroll', update, { passive: true });
    if (terminalOutput && typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => update());
      ro.observe(terminalOutput);
    }

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.scrollToBottom();
      const input = document.getElementById('terminal-input');
      if (input) input.focus();
      requestAnimationFrame(update);
    });

    requestAnimationFrame(update);
  }

  // Less viewer implementation

  // HTML escape utility
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  writeOutput(text, options = {}) {
    return this.addOutput(text, options);
  }

  // Write error to terminal
  writeError(text) {
    return this.addOutput(`Error: ${text}`, { outputClass: 'stderr' });
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
      onClose = null,
      /** Optional CSS selector inside `modal` to receive initial focus (e.g. `[role="dialog"]`). */
      focusSelector = null
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
    const focusEl = focusSelector ? modal.querySelector(focusSelector) : null;
    if (focusEl && typeof focusEl.focus === 'function') {
      focusEl.focus();
    } else {
      modal.focus();
    }

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
    if (terminalInput instanceof HTMLInputElement) {
      terminalInput.disabled = true;
      terminalInput.blur();
    }
    // Also disable any other terminal inputs in multi-line mode
    const allInputs = document.querySelectorAll('.terminal-input');
    allInputs.forEach((input) => {
      if (input instanceof HTMLInputElement) {
        input.disabled = true;
        input.blur();
      }
    });
  }

  // Re-enable terminal input
  enableTerminalInput() {
    const terminalInput = document.getElementById('terminal-input');
    if (terminalInput instanceof HTMLInputElement) {
      terminalInput.disabled = false;
      terminalInput.focus();
    }
    // Also re-enable any other terminal inputs
    const allInputs = document.querySelectorAll('.terminal-input');
    allInputs.forEach((input) => {
      if (input instanceof HTMLInputElement) input.disabled = false;
    });
    // Focus the most recent input
    const lastInput = document.querySelector('.terminal-input:last-of-type');
    if (lastInput instanceof HTMLInputElement) {
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
    if (!(input instanceof HTMLInputElement)) {
      throw new Error('createInputPrompt: .prompt-input not found');
    }

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

  /**
   * Block output: plain div, or welcome region + aria-hidden ASCII art when `welcomeAriaSummary` is set.
   * @param {object} [opts]
   * @param {boolean} [opts.withTerminalLine] - windowed terminal lines use `.terminal-line`.
   */
  _createBlockOutputElement(text, outputClass, welcomeAriaSummary, opts = {}) {
    const { withTerminalLine = false } = opts;
    if (outputClass === 'welcome' && welcomeAriaSummary) {
      const outputElement = document.createElement('div');
      outputElement.className = [
        withTerminalLine ? 'terminal-line' : '',
        'terminal-output',
        outputClass
      ]
        .filter(Boolean)
        .join(' ');
      outputElement.setAttribute('role', 'region');
      outputElement.setAttribute('aria-label', welcomeAriaSummary);
      const art = document.createElement('pre');
      art.className = 'welcome-banner-art';
      art.setAttribute('aria-hidden', 'true');
      art.textContent = text;
      outputElement.appendChild(art);
      return outputElement;
    }
    const outputElement = document.createElement('div');
    outputElement.className = [
      withTerminalLine ? 'terminal-line' : '',
      'terminal-output',
      outputClass
    ]
      .filter(Boolean)
      .join(' ');
    if (outputClass === 'man-page') {
      outputElement.setAttribute('role', 'region');
      outputElement.setAttribute('aria-label', 'Manual page');
    }
    if (outputClass === 'debug-dump') {
      outputElement.setAttribute('role', 'region');
      outputElement.setAttribute('aria-label', 'Debug output');
    }
    if (outputClass === 'hex-dump') {
      outputElement.setAttribute('role', 'region');
      outputElement.setAttribute('aria-label', 'Hex dump');
    }
    if (outputClass === 'ping-log') {
      outputElement.setAttribute('role', 'region');
      outputElement.setAttribute('aria-label', 'HTTP ping output');
    }
    if (
      outputClass === 'tabular' ||
      outputClass === 'man-page' ||
      outputClass === 'debug-dump' ||
      outputClass === 'hex-dump' ||
      outputClass === 'ping-log'
    ) {
      outputElement.style.whiteSpace = 'pre';
      outputElement.style.overflowX = 'auto';
    } else {
      outputElement.style.whiteSpace = 'pre-wrap';
    }
    outputElement.textContent = text;
    return outputElement;
  }

  // Standalone mode specific methods
  printWelcome() {
    if (this.windowId) return; // Only print welcome in main terminal mode

    const welcome = `
╔══════════════════════════════════════════════════════════════╗
║                 Welcome to jsh (Joe Shell) v1.0              ║
║                                                              ║
║  Type 'help' for available commands                          ║
║  Try: history, !!, alias ll='ls -l', echo $USER              ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`.trim();
    const welcomeAriaSummary =
      'Welcome to jsh, Joe Shell version 1. Type help for commands. Try history, double bang, alias ll to list files, and echo USER.';
    this.addOutput(welcome, { outputClass: 'welcome', block: true, welcomeAriaSummary });
  }

  printPrompt() {
    if (this.windowId) return; // Only print prompt in main terminal mode

    const promptText = document.getElementById('prompt-text');
    promptText.innerHTML = `${this.env.USER}@${this.env.HOSTNAME}:${this.getShortPath()}$ `;
    const terminalInput = document.getElementById('terminal-input');
    // Fullscreen command modals keep keyboard focus; do not pull focus back to the (disabled) input.
    if (document.querySelector('.top-modal, .less-modal, .vi-editor-modal, .terminal-modal')) {
      return;
    }
    terminalInput.focus();
  }

  // Theme G: muted exit hint on echoed command lines (same value as `$?` after the run).
  annotateCommandLineWithExit(lineEl, exitCode) {
    if (!lineEl) return;
    const existing = lineEl.querySelector('.command-exit-code');
    if (existing) existing.remove();
    const span = document.createElement('span');
    span.className = 'command-exit-code';
    span.setAttribute('data-exit', String(exitCode));
    span.setAttribute('aria-label', `exit ${exitCode}`);
    span.textContent = ` · ${exitCode}`;
    lineEl.appendChild(span);
  }

  addCommandToOutput(command) {
    if (this.windowId) return null; // Only add command to output in main terminal mode

    const terminalOutput = document.getElementById('terminal-output');
    const commandLine = document.createElement('div');
    const isFirstEcho = !terminalOutput.querySelector('.command-echo-line');
    commandLine.className = [
      'terminal-line',
      'command-echo-line',
      isFirstEcho ? 'command-echo-first' : ''
    ]
      .filter(Boolean)
      .join(' ');
    const promptSpan = document.createElement('span');
    promptSpan.className = 'prompt';
    promptSpan.textContent = `${this.env.USER}@${this.env.HOSTNAME}:${this.getShortPath()}$`;
    commandLine.appendChild(promptSpan);
    commandLine.appendChild(document.createTextNode(` ${command}`));
    terminalOutput.appendChild(commandLine);
    return commandLine;
  }

  addHeredocLineToOutput(command) {
    if (this.windowId) return; // Only add command to output in main terminal mode

    const terminalOutput = document.getElementById('terminal-output');
    const commandLine = document.createElement('div');
    commandLine.className = 'terminal-line';
    commandLine.innerHTML = `<span class="prompt">></span> ${command}`;
    terminalOutput.appendChild(commandLine);
  }
}

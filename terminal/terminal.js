// Enhanced Terminal for Heyming OS - Modular Version
import { _defaultUser, _defaultHome, _defaultHostname } from './terminal-defaults.js';
import { TerminalPipelineMixin } from './terminal-pipeline.js';
import { TerminalEnvMixin } from './terminal-env.js';
import { TerminalHistoryMixin } from './terminal-history.js';
import { TerminalCompletionMixin } from './terminal-completion.js';
import { TerminalInputMixin } from './terminal-input.js';
import { TerminalOutputMixin } from './terminal-output.js';
import { TerminalSignalMixin } from './terminal-signals.js';
import { FileSystemDB } from '../os/filesystem-db.js';

export class Terminal {
  constructor(windowId = null, osInstance = null) {
    this.windowId = windowId;
    this.os = osInstance;
    this.process = null; // Will be set by OS when terminal becomes a process
    this.commandHistory = [];
    this.historyIndex = -1;
    this.aliases = {}; // Command aliases
    /** Shared IndexedDB FS (same instance as kernel FileSystemManager — see FileSystemDB.getInstance). */
    this.fileSystemDB = null;
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

    /** Exit status of the last completed command line (pipelines: last segment), for `$?` / Unix parity */
    this.lastExitCode = 0;

    /**
     * Shell options (bash `set` builtin). `errexit` (-e) aborts a list on first
     * non-zero, `nounset` (-u) errors on unset $VAR, `pipefail` (-o pipefail)
     * makes a pipeline's $? the rightmost non-zero stage.
     */
    this.shellOptions = {
      errexit: false,
      nounset: false,
      pipefail: false,
      xtrace: false
    };

    /** Shell functions defined via `name() { body }` (A7). */
    this.shellFunctions = {};

    /**
     * Background job table (A5). Each entry: { jobId, pgid, pids, command,
     * state: 'Running'|'Done'|'Stopped', exitCode?, startTime, promise }.
     */
    this.jobs = [];
    this._nextJobId = 1;

    /** Set while a command line is running: inputs disabled, Ctrl+C aborts `runAbortSignal` (capture phase). */
    this.commandRunning = false;
    this.runAbortSignal = null;
    this._runAbortController = null;
    this._interruptCaptureHandler = null;

    /** @type {string} Set by the pipeline runner before a command is invoked with piped stdin. */
    this.stdin = '';
    /** @type {boolean} True when stdin data was piped into this command. */
    this.hasStdin = false;
    /** @type {boolean} True when stdin was explicitly supplied (pipe or heredoc). */
    this.stdinSupplied = false;
    /** @type {Array<{type: string, fd?: number, target?: string, mode?: string}>} Active redirections for the current command. */
    this.redirections = [];

    // Initialize environment variables
    this.env = {
      USER: _defaultUser(),
      LOGNAME: _defaultUser(),
      HOME: _defaultHome(),
      PWD: _defaultHome(),
      SHELL: '/bin/jsh',
      TERM: 'heyming-terminal',
      PATH: '/bin:/usr/bin:/usr/local/bin',
      HOSTNAME: _defaultHostname(),
      LANG: 'en_US.UTF-8',
      EDITOR: 'nano',
      PAGER: 'less',
      SHLVL: '1'
    };

    this.currentDirectory = this.env.HOME;

    // Load command history from session storage
    this.loadCommandHistory();

    // Load commands first, then initialize filesystem with /bin files (HeymingOS awaits this).
    this._filesystemReadyPromise = this.loadCommands()
      .then(() => {
        this.commandsLoaded = true;
        return this.initializeFilesystem();
      })
      .then(() => {
        this.filesystemReady = true;
        setTimeout(() => this.initialize(), 100);
      })
      .catch((error) => {
        console.error('❌ Failed to initialize terminal:', error);
        throw new Error('Terminal initialization failed - OS layer required');
      });
  }

  /** Wait until FileSystemDB singleton + scaffolding are ready (avoids racing git before terminal.fileSystemDB is set). */
  whenFilesystemReady() {
    return this._filesystemReadyPromise;
  }

  setTerminalInputsDisabled(disabled) {
    if (this.windowId) {
      const el = document.getElementById(`window-${this.windowId}`);
      if (el) {
        el.querySelectorAll('.terminal-input').forEach((inp) => {
          if (inp instanceof HTMLInputElement) inp.disabled = disabled;
        });
      }
    } else {
      const inp = document.getElementById('terminal-input');
      if (inp instanceof HTMLInputElement) inp.disabled = disabled;
    }
  }

  /** Theme G: shell root + output region reflect a blocking command (class + aria-busy). */
  setCommandRunningUi(running) {
    const root = !this.windowId
      ? document.getElementById('terminal-container')
      : document.getElementById(`window-${this.windowId}`);
    if (root) root.classList.toggle('terminal-command-running', running);

    const outRegion = !this.windowId
      ? document.getElementById('terminal-scroll') || document.getElementById('terminal-output')
      : root?.querySelector?.('.terminal-content');
    if (outRegion) {
      if (running) outRegion.setAttribute('aria-busy', 'true');
      else outRegion.removeAttribute('aria-busy');
    }
  }

  beginBlockingCommandRun() {
    if (this.commandRunning) return;
    const ac = new AbortController();
    this._runAbortController = ac;
    this.runAbortSignal = ac.signal;
    this.commandRunning = true;
    this.setCommandRunningUi(true);
    this.setTerminalInputsDisabled(true);
    const handler = (e) => {
      if (!this.commandRunning || !this._runAbortController) return;
      if (e.ctrlKey && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        this._runAbortController.abort();
      }
    };
    this._interruptCaptureHandler = handler;
    document.addEventListener('keydown', handler, true);
  }

  endBlockingCommandRun() {
    if (this._interruptCaptureHandler) {
      document.removeEventListener('keydown', this._interruptCaptureHandler, true);
      this._interruptCaptureHandler = null;
    }
    this._runAbortController = null;
    this.runAbortSignal = null;
    this.commandRunning = false;
    this.setTerminalInputsDisabled(false);
    this.setCommandRunningUi(false);
  }

  isAbortLikeError(err) {
    if (!err) return false;
    if (err.name === 'AbortError') return true;
    const m = String(err.message || err);
    return /\babort(ed)?\b|AbortSignal|The operation was aborted/i.test(m);
  }

  // OS Integration Methods
  setProcess(process) {
    this.process = process;
    // Update environment from process
    if (process) {
      this.env = { ...this.env, ...process.env };
      this.currentDirectory = process.cwd;
      this.syncStandaloneDocumentTitle();
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
    await commandRegistry.loadCommands();
  }

  async initializeFilesystem() {
    this.fileSystemDB = await FileSystemDB.getInstance();
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
      // Main terminal — check for first-run setup (standalone only, not OS embed)
      terminalInput = document.getElementById('terminal-input');
      if (this._needsFirstRunSetup()) {
        this._showFirstRunSetup();
        return;
      }
      const terminalOutput = document.getElementById('terminal-output');
      if (!terminalOutput || !terminalOutput.textContent.includes('Welcome to jsh')) {
        this.printWelcome();
        this.printPrompt();
      }
    }

    if (!(terminalInput instanceof HTMLInputElement)) return;

    this.syncStandaloneDocumentTitle();
    terminalInput.focus();
    this.bindInputEvents(terminalInput);

    // Click anywhere in terminal to focus input
    this._bindTerminalClickToFocus(terminalInput);

    this._bindScrollLatestAffordance();

    // Save command history on window unload
    window.addEventListener('beforeunload', () => {
      this.saveCommandHistory();
    });
  }

  _needsFirstRunSetup() {
    if (this.windowId) return false;
    if (document.documentElement.classList.contains('terminal-embed-os')) return false;
    try {
      return !localStorage.getItem('heymingOS_username');
    } catch {
      return false;
    }
  }

  _showFirstRunSetup() {
    const terminalOutput = document.getElementById('terminal-output');
    const terminalInput = document.getElementById('terminal-input');
    const promptText = document.getElementById('prompt-text');
    if (!terminalOutput || !(terminalInput instanceof HTMLInputElement) || !promptText) return;

    const addPre = (lines) => {
      const pre = document.createElement('pre');
      pre.className = 'setup-wizard';
      pre.textContent = lines.join('\n');
      terminalOutput.appendChild(pre);
    };

    const echoPrompt = (label, value) => {
      const el = document.createElement('div');
      el.innerHTML = `<span class="prompt">  ${label}</span>${value}`;
      terminalOutput.appendChild(el);
    };

    const showError = (msg) => {
      const err = document.createElement('div');
      err.className = 'setup-error';
      err.textContent = `  ⚠  ${msg}`;
      terminalOutput.appendChild(err);
    };

    const askInput = (label, placeholder, validate) => {
      return new Promise((resolve) => {
        promptText.textContent = `  ${label}`;
        terminalInput.placeholder = placeholder;
        terminalInput.value = '';
        terminalInput.disabled = false;
        terminalInput.focus();
        const handler = (e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          const result = validate(terminalInput.value);
          if (result.error) {
            showError(result.error);
            terminalInput.value = '';
            return;
          }
          terminalInput.removeEventListener('keydown', handler);
          terminalInput.disabled = true;
          echoPrompt(label, result.value);
          resolve(result.value);
        };
        terminalInput.addEventListener('keydown', handler);
      });
    };

    const finishSetup = () => {
      terminalOutput.innerHTML = '';
      terminalInput.disabled = false;
      terminalInput.placeholder = 'Type a command...';
      this.printWelcome();
      this.printPrompt();
      this.syncStandaloneDocumentTitle();
      terminalInput.focus();
      this.bindInputEvents(terminalInput);
      this._bindTerminalClickToFocus(terminalInput);
      this._bindScrollLatestAffordance();
      window.addEventListener('beforeunload', () => {
        this.saveCommandHistory();
      });
    };

    const run = async () => {
      addPre([
        '',
        '  ┌──────────────────────────────────────────────────────────────┐',
        '  │                                                              │',
        '  │             Heyming OS — First Time Setup                    │',
        '  │                                                              │',
        "  │   Detected first boot. Let's configure your system.         │",
        '  │                                                              │',
        '  └──────────────────────────────────────────────────────────────┘',
        '',
        '  [  1 / 3  ]  User Account',
        ''
      ]);

      const username = await askInput('Enter your username: ', 'e.g. alice', (raw) => {
        const v = raw
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9._-]/g, '');
        if (!v) return { error: 'Username must contain at least one character (a-z, 0-9, . _ -)' };
        return { value: v };
      });

      addPre(['', '  [  2 / 3  ]  Computer Name', '']);

      const hostname = await askInput('Enter hostname: ', 'e.g. my-laptop', (raw) => {
        const v = raw
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, '');
        if (!v) return { error: 'Hostname must contain at least one character (a-z, 0-9, -)' };
        return { value: v };
      });

      addPre([
        '',
        '  [  3 / 3  ]  Confirm',
        '',
        `  Username:   ${username}`,
        `  Hostname:   ${hostname}`,
        `  Home:       /home/${username}`,
        `  Shell:      /bin/jsh`,
        ''
      ]);

      const answer = await askInput('Is this correct? [Y/n]: ', '', (raw) => {
        return { value: raw.trim().toLowerCase() || 'y' };
      });

      if (answer === 'n' || answer === 'no') {
        terminalOutput.innerHTML = '';
        run();
        return;
      }

      this._applyFirstRunSettings(username, hostname);

      addPre([
        '',
        '  ✓  User account created.',
        `  ✓  Home directory /home/${username} initialized.`,
        `  ✓  Hostname set to ${hostname}.`,
        '  ✓  System configuration saved.',
        '',
        '  Setup complete. Booting jsh...',
        ''
      ]);

      await new Promise((r) => setTimeout(r, 600));
      finishSetup();
    };

    run();
  }

  _applyFirstRunSettings(username, hostname) {
    try {
      localStorage.setItem('heymingOS_username', username);
      localStorage.setItem('heymingOS_hostname', hostname);
    } catch {
      // storage unavailable
    }
    this.env.USER = username;
    this.env.HOME = `/home/${username}`;
    this.env.PWD = `/home/${username}`;
    this.env.HOSTNAME = hostname;
    this.currentDirectory = this.env.HOME;
    if (this.process) {
      this.process.env.USER = username;
      this.process.env.HOME = this.env.HOME;
      this.process.env.PWD = this.env.PWD;
      this.process.env.HOSTNAME = hostname;
      this.process.cwd = this.env.HOME;
    }
    if (this.fileSystemDB) {
      this.fileSystemDB.initializeWithScaffolding(username).catch(() => {});
    }
  }
}

function mixinPrototype(Target, Source) {
  const d = Object.getOwnPropertyDescriptors(Source.prototype);
  delete d.constructor;
  Object.defineProperties(Target.prototype, d);
}

mixinPrototype(Terminal, TerminalPipelineMixin);
mixinPrototype(Terminal, TerminalEnvMixin);
mixinPrototype(Terminal, TerminalHistoryMixin);
mixinPrototype(Terminal, TerminalCompletionMixin);
mixinPrototype(Terminal, TerminalInputMixin);
mixinPrototype(Terminal, TerminalOutputMixin);
mixinPrototype(Terminal, TerminalSignalMixin);

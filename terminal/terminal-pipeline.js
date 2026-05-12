import { commandRegistry } from './commands.js';
import { ShellCore } from './lib/shell-core.js';
import { VfsUtils } from './lib/vfs-utils.js';
export class TerminalPipelineMixin {
  async processCommand(command) {
    if (command.trim() === '') return '';

    // Check if commands are loaded
    if (!this.commandsLoaded) {
      this.lastExitCode = 1;
      this.addOutput('Terminal is still loading commands, please wait...', {
        outputClass: 'stderr'
      });
      return '';
    }

    // Check if filesystem is ready
    if (!this.filesystemReady) {
      this.lastExitCode = 1;
      this.addOutput('Filesystem is still initializing, please wait...', { outputClass: 'stderr' });
      return '';
    }

    // Handle history expansion
    const expandedCommand = this.expandHistory(command);
    if (expandedCommand !== command) {
      // Show the expanded command
      this.addOutput(`${expandedCommand}`);
    }

    // Parse command lists (`&&` / `||` / `;`), then pipes + redirections per segment
    const split = ShellCore.splitShellList(expandedCommand);
    if (split.ok === false) {
      this.lastExitCode = 2;
      this.addOutput(split.error, { outputClass: 'stderr' });
      return '';
    }

    let lastExit = 0;
    const { pipelines, ops } = split;

    try {
      for (let i = 0; i < pipelines.length; i++) {
        const segment = pipelines[i];
        if (i > 0) {
          const op = ops[i - 1];
          if (op === '&&' && lastExit !== 0) continue;
          if (op === '||' && lastExit === 0) continue;
        }
        if (segment.trim() === '') {
          lastExit = 0;
          continue;
        }
        const parsedCommand = this.parseCommand(segment);
        const {
          stdout: out,
          stderr: err,
          stdoutOutputClass
        } = await this.executeCommandChain(parsedCommand);
        lastExit = this.lastExitCode;
        if (out) {
          const addOpts =
            stdoutOutputClass === 'tabular' ||
            stdoutOutputClass === 'man-page' ||
            stdoutOutputClass === 'debug-dump' ||
            stdoutOutputClass === 'hex-dump' ||
            stdoutOutputClass === 'ping-log'
              ? { outputClass: stdoutOutputClass, block: true }
              : {};
          this.addOutput(out, addOpts);
        }
        if (err) {
          this.addOutput(err, { outputClass: 'stderr' });
        }
      }
      this.lastExitCode = lastExit;
      return '';
    } catch (error) {
      if (this.isAbortLikeError(error)) {
        throw error;
      }
      this.lastExitCode = 1;
      this.addOutput(`Error: ${error.message}`, { outputClass: 'stderr' });
      return '';
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
    const tokens = ShellCore.mergeRedirectDupStderrTokens(this.tokenize(segment));
    const cmd = {
      name: '',
      args: [],
      redirections: {
        stdout: null,
        stderr: null,
        stdin: null,
        append: false,
        stderrToStdout: false
      }
    };

    let i = 0;
    while (i < tokens.length) {
      const token = tokens[i];

      if (token === '>') {
        if (i + 1 < tokens.length) {
          const raw = tokens[i + 1];
          if (ShellCore.isEmptyRedirectTarget(raw)) {
            throw new Error('Syntax error: empty redirect target');
          }
          cmd.redirections.stdout = ShellCore.normalizeRedirectFilename(raw);
          cmd.redirections.append = false;
          i += 2;
        } else {
          throw new Error('Syntax error: expected filename after >');
        }
      } else if (token === '>>') {
        if (i + 1 < tokens.length) {
          const raw = tokens[i + 1];
          if (ShellCore.isEmptyRedirectTarget(raw)) {
            throw new Error('Syntax error: empty redirect target');
          }
          cmd.redirections.stdout = ShellCore.normalizeRedirectFilename(raw);
          cmd.redirections.append = true;
          i += 2;
        } else {
          throw new Error('Syntax error: expected filename after >>');
        }
      } else if (token === '2>') {
        if (i + 1 < tokens.length) {
          const raw = tokens[i + 1];
          if (ShellCore.isEmptyRedirectTarget(raw)) {
            throw new Error('Syntax error: empty redirect target');
          }
          cmd.redirections.stderr = ShellCore.normalizeRedirectFilename(raw);
          i += 2;
        } else {
          throw new Error('Syntax error: expected filename after 2>');
        }
      } else if (token === '2>&1') {
        cmd.redirections.stderrToStdout = true;
        i += 1;
      } else if (token === '<') {
        if (i + 1 < tokens.length) {
          const raw = tokens[i + 1];
          if (ShellCore.isEmptyRedirectTarget(raw)) {
            throw new Error('Syntax error: empty redirect target');
          }
          cmd.redirections.stdin = ShellCore.normalizeRedirectFilename(raw);
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
    let displayStdout = '';
    let displayStderr = '';
    let chainLastExit = 0;

    for (let i = 0; i < commandChain.length; i++) {
      const cmd = commandChain[i];
      const isLastCommand = i === commandChain.length - 1;

      try {
        // Handle stdin redirection (follow symlinks to regular files)
        if (cmd.redirections.stdin) {
          const resolved = await VfsUtils.vfsFollowSymlinksToFile(
            this,
            cmd.redirections.stdin,
            cmd.name || 'jsh'
          );
          if (resolved.ok === false) {
            throw new Error(
              `cannot read from '${cmd.redirections.stdin}': No such file or directory`
            );
          }
          input = VfsUtils.fileItemUtf8ForDisplay(resolved.file).text;
        }

        // Execute the command
        const result = await this.executeSingleCommand(cmd, input, { stdinFromPipe: i > 0 });
        chainLastExit = result.exitCode ?? 0;

        const mergeErr = cmd.redirections.stderrToStdout;
        const out = ShellCore.coerceShellString(result.stdout);
        const err = ShellCore.coerceShellString(result.stderr);
        const combined =
          mergeErr && (out || err) ? (out && err ? `${out}\n${err}` : `${out}${err}`) : out;

        // Handle stdout/stderr redirection (2>&1 merges stderr into the stdout stream)
        if (cmd.redirections.stdout) {
          await this.redirectToFile(
            cmd.redirections.stdout,
            mergeErr ? combined : out,
            cmd.redirections.append
          );
          if (isLastCommand) {
            if (mergeErr) {
              displayStdout = '';
              displayStderr = '';
            } else {
              displayStdout = '';
              displayStderr = err;
            }
          }
        } else if (cmd.redirections.stderr && !mergeErr) {
          await this.redirectToFile(cmd.redirections.stderr, err, false);
          if (isLastCommand) {
            displayStdout = out;
            displayStderr = '';
          }
        } else {
          if (isLastCommand) {
            if (mergeErr) {
              displayStdout = combined;
              displayStderr = '';
            } else {
              displayStdout = out;
              displayStderr = err;
            }
          } else {
            input = mergeErr ? combined : out;
          }
        }
      } catch (error) {
        if (this.isAbortLikeError(error)) {
          throw error;
        }
        this.lastExitCode = 1;
        throw new Error(`${cmd.name}: ${error.message}`);
      }
    }

    this.lastExitCode = chainLastExit;
    const lastCmd = commandChain.length ? commandChain[commandChain.length - 1] : null;
    const lastName = (lastCmd?.name || '').toLowerCase();
    let stdoutOutputClass;
    if (lastName === 'ps') stdoutOutputClass = 'tabular';
    else if (lastName === 'man' && displayStdout) stdoutOutputClass = 'man-page';
    else if (lastName === 'debug' && displayStdout) stdoutOutputClass = 'debug-dump';
    else if (lastName === 'hexdump' && displayStdout) stdoutOutputClass = 'hex-dump';
    else if (lastName === 'ping' && displayStdout) {
      const head = displayStdout.trimStart();
      if (!head.startsWith('Usage:')) stdoutOutputClass = 'ping-log';
    }
    return { stdout: displayStdout, stderr: displayStderr, stdoutOutputClass };
  }

  /**
   * Normalized command result for pipelines and `$?` (see lib/shell-core.js + tests).
   */
  commandResult(stdout = '', stderr = '', exitCode) {
    return ShellCore.normalizeCommandResult(stdout, stderr, exitCode);
  }

  async executeSingleCommand(cmd, stdin = '', options = {}) {
    const stdinFromPipe = options.stdinFromPipe === true;
    const stdinSupplied =
      stdin.length > 0 || stdinFromPipe || !!(cmd.redirections && cmd.redirections.stdin);

    let cmdName = cmd.name.toLowerCase();

    // Check for aliases first
    if (this.aliases[cmdName]) {
      const aliasCommand = this.aliases[cmdName];
      // Simple alias expansion - replace command name with alias value
      const expandedArgs = aliasCommand.split(' ').concat(cmd.args);
      cmdName = expandedArgs[0].toLowerCase();
      cmd.args = expandedArgs.slice(1);
    }

    // Expand glob patterns (* and ?) in arguments
    cmd.args = await this.expandGlobs(cmd.args);

    // Special case for help command
    if (cmdName === 'help') {
      const h = this.helpCommand(cmd.args);
      return this.commandResult(h.stdout, h.stderr, h.exitCode);
    }

    // Handle path-based command execution (e.g., /bin/top, ./script.js)
    if (cmdName.includes('/')) {
      try {
        const filePath = this.resolvePath(cmdName);
        let file = await this.getFileSystemItem(filePath);

        // Follow symlink chains so /path/to/symlink resolves to the target
        if (file && file.type === 'symlink') {
          const resolved = await VfsUtils.vfsFollowSymlinksToAny(this, filePath);
          file = resolved.ok ? resolved.item : null;
        }

        if (file && file.type === 'file') {
          const actualCmd = cmdName.split('/').pop().toLowerCase();

          // Check if it's an executable file in /bin/
          if (filePath.startsWith('/bin/')) {
            const commandHandler = await commandRegistry.get(actualCmd);
            if (commandHandler) {
              const terminalContext = this;
              try {
                terminalContext.stdin = stdin;
                terminalContext.hasStdin = stdin.length > 0;
                terminalContext.stdinSupplied = stdinSupplied;
                terminalContext.redirections = cmd.redirections;

                const result = commandHandler(terminalContext, cmd.args);
                const output = result instanceof Promise ? await result : result;

                // Clean up temporary properties
                delete terminalContext.stdin;
                delete terminalContext.hasStdin;
                delete terminalContext.stdinSupplied;
                delete terminalContext.redirections;

                const n = ShellCore.normalizeHandlerResult(output);
                return this.commandResult(n.stdout, n.stderr, n.exitCode);
              } catch (error) {
                delete terminalContext.stdin;
                delete terminalContext.hasStdin;
                delete terminalContext.stdinSupplied;
                delete terminalContext.redirections;
                if (this.isAbortLikeError(error)) throw error;
                console.error('[terminal] command error (' + filePath + '):', error);
                return this.commandResult('', `Error executing ${filePath}: ${error.message}`, 1);
              }
            }
          }

          // Handle script files (e.g., ./script.js, /path/to/script.sh)
          if (actualCmd.endsWith('.js') || actualCmd.endsWith('.sh') || file.executable) {
            if (actualCmd.endsWith('.js')) {
              const nodeCommand = await commandRegistry.get('node');
              if (nodeCommand) {
                const result = nodeCommand(this, [filePath, ...cmd.args]);
                const output = result instanceof Promise ? await result : result;
                const n = ShellCore.normalizeHandlerResult(output);
                return this.commandResult(n.stdout, n.stderr, n.exitCode);
              } else {
                return this.commandResult(
                  '',
                  'JavaScript execution not available. Node command not loaded.',
                  1
                );
              }
            } else {
              // For shell scripts and other executables, show content for now
              const { text, isBinary } = VfsUtils.fileItemUtf8ForDisplay(file);
              const body = isBinary ? '[binary file]' : text || 'File is empty';
              return this.commandResult(`Executing ${filePath}:\n${body}`, '', 0);
            }
          }

          // File exists but is not executable
          return this.commandResult('', `jsh: ${filePath}: Permission denied`, 126);
        } else {
          // File doesn't exist
          return this.commandResult('', `jsh: ${cmdName}: No such file or directory`, 127);
        }
      } catch (error) {
        console.error('[terminal] file execution error (' + cmdName + '):', error);
        return this.commandResult('', `jsh: ${cmdName}: ${error.message}`, 1);
      }
    }

    // Try to get command from registry (now async)
    const commandHandler = await commandRegistry.get(cmdName);
    if (commandHandler) {
      const terminalContext = this;
      try {
        terminalContext.stdin = stdin;
        terminalContext.hasStdin = stdin.length > 0;
        terminalContext.stdinSupplied = stdinSupplied;
        terminalContext.redirections = cmd.redirections;

        const result = commandHandler(terminalContext, cmd.args);
        const output = result instanceof Promise ? await result : result;

        // Clean up temporary properties
        delete terminalContext.stdin;
        delete terminalContext.hasStdin;
        delete terminalContext.stdinSupplied;
        delete terminalContext.redirections;

        const n = ShellCore.normalizeHandlerResult(output);
        return this.commandResult(n.stdout, n.stderr, n.exitCode);
      } catch (error) {
        delete terminalContext.stdin;
        delete terminalContext.hasStdin;
        delete terminalContext.stdinSupplied;
        delete terminalContext.redirections;
        if (this.isAbortLikeError(error)) throw error;
        console.error('[terminal] command error (' + cmdName + '):', error);
        return this.commandResult('', `Error executing ${cmdName}: ${error.message}`, 1);
      }
    }

    return this.commandResult(
      '',
      `jsh: ${cmdName}: command not found\nTry 'help' for available commands or 'sudo apt install ${cmdName}' to pretend to install it! 😄`,
      127
    );
  }

  async executeHeredocCommand() {
    this.beginBlockingCommandRun();
    try {
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
        this.heredocCommand = null;
        this.heredocDelimiter = null;
        this.heredocContent = [];

        // Handle different heredoc commands
        if (command === 'js' || command === 'node' || command === 'javascript') {
          const result = await this.executeJavaScriptContent(content);
          if (result.stdout) {
            this.addOutput(result.stdout);
          }
          if (result.stderr) {
            this.addOutput(result.stderr, { outputClass: 'stderr' });
          }
          this.lastExitCode = result.stderr ? 1 : 0;
        } else if (command === 'cat') {
          this.addOutput(content);
          this.lastExitCode = 0;
        } else if (command === 'echo') {
          this.addOutput(content);
          this.lastExitCode = 0;
        } else {
          const result = await this.executeSingleCommand(
            { name: command, args: [], redirections: {} },
            content
          );
          if (result.stdout) {
            this.addOutput(result.stdout);
          }
          if (result.stderr) {
            this.addOutput(result.stderr, { outputClass: 'stderr' });
          }
          this.lastExitCode = result.exitCode ?? 0;
        }
      } catch (error) {
        if (this.isAbortLikeError(error)) {
          this.lastExitCode = 130;
          this.addOutput('^C');
        } else {
          this.lastExitCode = 1;
          this.addOutput(`Error executing heredoc: ${error.message}`, { outputClass: 'stderr' });
        }
      }
    } finally {
      this.endBlockingCommandRun();
    }

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
  async redirectToFile(filename, content, append = false) {
    const filePath = this.resolvePath(filename);

    try {
      if (append) {
        // Read existing content and append
        const existingFile = await this.getFileSystemItem(filePath);
        const existingContent =
          existingFile && existingFile.type === 'file'
            ? (() => {
                const d = VfsUtils.fileItemUtf8ForDisplay(existingFile);
                return d.isBinary ? '' : d.text;
              })()
            : '';

        await this.fileSystemDB.createFile(filePath, existingContent + content, true);
      } else {
        // Overwrite file
        await this.fileSystemDB.createFile(filePath, content, true);
      }
    } catch (error) {
      throw new Error(`cannot redirect to '${filename}': ${error.message}`);
    }
  }
  helpCommand(args = []) {
    const parsed = ShellCore.parseHelpArgs(args);
    if (parsed.ok === false) {
      return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
    }
    if (parsed.sawHelpFlag) {
      return { stdout: ShellCore.HELP_USAGE.trim() + '\n', stderr: '', exitCode: 0 };
    }
    const rest = parsed.rest;
    if (rest.length === 1) {
      const topic = rest[0];
      const line = this.lookupHelpTopicLine(topic);
      if (!line) {
        return {
          stdout: '',
          stderr: `help: no help topics match '${topic}'\n`,
          exitCode: 1
        };
      }
      return { stdout: line.endsWith('\n') ? line : line + '\n', stderr: '', exitCode: 0 };
    }
    return { stdout: this.buildFullHelpCatalog(), stderr: '', exitCode: 0 };
  }

  /**
   * One-line or short description for `help TOPIC` (includes built-in `help` itself).
   * @param {string} topic - Operand as typed (preserved for display)
   * @returns {string|null}
   */
  lookupHelpTopicLine(topic) {
    const key = topic.toLowerCase();
    if (key === 'help') {
      return `${ShellCore.HELP_USAGE.trim()}\n\n  (builtin) List all commands or describe one command by name.`;
    }
    const all = commandRegistry.getAllCommands();
    const found = all.find((c) => c.name.toLowerCase() === key);
    if (!found) {
      return null;
    }
    return `${found.name}: ${found.description}`;
  }

  buildFullHelpCatalog() {
    const commandsByCategory = commandRegistry.getCommandsByCategory();

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
    helpText += `🧭 Shell:\n  ${'help'.padEnd(
      12
    )} - List commands or describe one topic (try "help help")\n\n`;

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
- Lists: cmd1 && cmd2 (if first succeeds), cmd1 || cmd2 (if first fails), a; b (always run both)
- Redirect output: echo "hello" > file.txt
- Append to file: echo "world" >> file.txt
- Redirect stderr: command 2> error.log
- Read from file: sort < data.txt`;

    return helpText;
  }
}

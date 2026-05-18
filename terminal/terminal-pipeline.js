/**
 * Top-level pipeline orchestrator for jsh.
 *
 * Owns the public `processCommand` entry point and the close cohort that
 * lives next to it: shell-function invocation, `$(...)` substitution,
 * inner-pipeline capture (used by both substitution and subshells), the
 * pipe-stage executor, and the single-command dispatcher.
 *
 * Less central concerns are split into sibling method bags and mixed
 * onto this class at the bottom of the file:
 *   - **terminal-parser.js**   — history expansion, tokenizer, segment parser
 *   - **terminal-redirect.js** — `>`/`>>`/`<` redirection, heredoc, `js` eval, background jobs
 *   - **terminal-help.js**     — `help` builtin and the catalog renderer
 *
 * `terminal.js` mixes this class onto `Terminal.prototype` once via
 * `mixinPrototype`, which carries the sibling methods along for the ride.
 */

import { commandRegistry } from './commands.js';
import { ShellCore } from './lib/shell-core.js';
import { VfsUtils } from './lib/vfs-utils.js';
import { parserMethods } from './terminal-parser.js';
import { redirectMethods } from './terminal-redirect.js';
import { helpMethods } from './terminal-help.js';

export class TerminalPipelineMixin {
  async processCommand(command) {
    if (command.trim() === '') return '';

    if (!this.commandsLoaded) {
      this.lastExitCode = 1;
      this.addOutput('Terminal is still loading commands, please wait...', {
        outputClass: 'stderr'
      });
      return '';
    }

    if (!this.filesystemReady) {
      this.lastExitCode = 1;
      this.addOutput('Filesystem is still initializing, please wait...', { outputClass: 'stderr' });
      return '';
    }

    const expandedCommand = this.expandHistory(command);
    if (expandedCommand !== command) {
      this.addOutput(`${expandedCommand}`);
    }

    // Function definition: `name() { body }` (single-line bodies) → register
    // and return immediately. Multi-line function bodies are not supported in
    // jsh (no continuation reader yet).
    const fnDef = ShellCore.parseFunctionDefinition(expandedCommand);
    if (fnDef.ok) {
      if (!this.shellFunctions) this.shellFunctions = {};
      this.shellFunctions[fnDef.name] = fnDef.body;
      this.lastExitCode = 0;
      return '';
    }

    // Resolve `$(...)` / backtick command substitutions before list parsing.
    // Each inner span is captured (no display, no `$?` leak to parent).
    let substituted;
    try {
      substituted = await this.resolveCommandSubstitutions(expandedCommand);
    } catch (substErr) {
      if (this.isAbortLikeError(substErr)) throw substErr;
      this.lastExitCode = 1;
      this.addOutput(`jsh: ${substErr.message}`, { outputClass: 'stderr' });
      return '';
    }

    const split = ShellCore.splitShellList(substituted);
    if (split.ok === false) {
      this.lastExitCode = 2;
      this.addOutput(split.error, { outputClass: 'stderr' });
      return '';
    }

    let lastExit = 0;
    const { pipelines, ops } = split;
    const opts = this.shellOptions || {
      errexit: false,
      nounset: false,
      pipefail: false,
      xtrace: false
    };

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
        // Trailing `&` after this segment: queue as background job and
        // continue without waiting. Bash sets $? to 0 for backgrounded.
        const nextOpAfter = i < pipelines.length - 1 ? ops[i] : null;
        if (nextOpAfter === '&') {
          this.launchBackgroundJob(segment);
          lastExit = 0;
          continue;
        }
        if (opts.xtrace) {
          this.addOutput(`+ ${segment}`, { outputClass: 'stderr' });
        }

        // Subshell `(...)`: run with snapshot/restore of env, cwd, lastExit,
        // shellOptions, and shellFunctions so mutations don't escape.
        const subTrim = segment.trim();
        if (subTrim.startsWith('(') && subTrim.endsWith(')')) {
          const inner = subTrim.slice(1, -1).trim();
          const snapEnv = { ...this.env };
          const snapCwd = this.currentDirectory;
          const snapExit = this.lastExitCode;
          const snapOpts = { ...this.shellOptions };
          const snapFns = { ...this.shellFunctions };
          try {
            const captured = await this.captureInnerPipeline(inner);
            if (captured) this.addOutput(captured);
            lastExit = this.lastExitCode;
          } finally {
            this.env = snapEnv;
            this.currentDirectory = snapCwd;
            this.env.PWD = snapCwd;
            this.shellOptions = snapOpts;
            this.shellFunctions = snapFns;
            // Preserve subshell's exit, but don't leak option/function changes.
            void snapExit;
          }
          if (opts.errexit && lastExit !== 0) {
            const nextOp = i + 1 < pipelines.length ? ops[i] : null;
            if (nextOp !== '||' && nextOp !== '&&') {
              this.lastExitCode = lastExit;
              return '';
            }
          }
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
        // errexit: abort on first non-zero pipeline (unless suppressed by &&/||)
        if (opts.errexit && lastExit !== 0) {
          const nextOp = i + 1 < pipelines.length ? ops[i] : null;
          if (nextOp !== '||' && nextOp !== '&&') {
            this.lastExitCode = lastExit;
            return '';
          }
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

  /**
   * Invoke a shell function defined via `name() { body }`. Body runs as a
   * sub-pipeline with positional params $1..$9, $@, $#, $0 mapped on env.
   * On return, env positional params and $0 are restored. $? leaks (bash-like).
   *
   * @param {string} name
   * @param {string} body
   * @param {string[]} args
   * @param {string} stdin
   * @param {object} options
   */
  async invokeShellFunction(name, body, args, stdin, options) {
    const savedPositional = {};
    for (let i = 0; i <= 9; i++) savedPositional[i] = this.env[String(i)];
    const savedAt = this.env['@'];
    const savedHash = this.env['#'];
    const savedZero = this.env['0'];
    this.env['0'] = name;
    for (let i = 1; i <= 9; i++) this.env[String(i)] = args[i - 1] != null ? args[i - 1] : '';
    this.env['@'] = args.join(' ');
    this.env['#'] = String(args.length);

    try {
      const captured = await this.captureInnerPipeline(body);
      // Inner pipeline already wrote stderr lines; here we hand back as stdout
      // so the function call participates in pipes naturally. Honor stdin via
      // standard piped-in mechanism (handled by inner exec already).
      void stdin;
      void options;
      return this.commandResult(captured, '', this.lastExitCode);
    } finally {
      for (let i = 0; i <= 9; i++) {
        if (savedPositional[i] === undefined) delete this.env[String(i)];
        else this.env[String(i)] = savedPositional[i];
      }
      if (savedAt === undefined) delete this.env['@'];
      else this.env['@'] = savedAt;
      if (savedHash === undefined) delete this.env['#'];
      else this.env['#'] = savedHash;
      if (savedZero === undefined) delete this.env['0'];
      else this.env['0'] = savedZero;
    }
  }

  /**
   * Resolve `$(...)` and backtick command substitutions inside a command line.
   * Each substitution runs as an isolated inner pipeline; its captured stdout
   * (trailing newlines stripped, bash-style) is spliced back into the line.
   * `$?` for the parent is preserved; inner exit codes are not propagated.
   *
   * @param {string} line
   * @returns {Promise<string>}
   */
  async resolveCommandSubstitutions(line) {
    const parts = ShellCore.extractCommandSubstitutions(line);
    const hasAny = parts.some((p) => p.type === 'subst');
    if (!hasAny) return line;

    const savedExit = this.lastExitCode;
    const results = [];
    for (const p of parts) {
      if (p.type !== 'subst') continue;
      // Recurse: inner pipeline may itself contain $(...)
      const innerLine = await this.resolveCommandSubstitutions(p.inner);
      const captured = await this.captureInnerPipeline(innerLine);
      results.push(captured);
    }
    this.lastExitCode = savedExit;
    return ShellCore.spliceCommandSubstitutions(parts, results);
  }

  /**
   * Run an inner pipeline (no UI side-effects) and return captured stdout.
   * Trailing newlines are stripped to match bash command substitution.
   *
   * @param {string} line
   * @returns {Promise<string>}
   */
  async captureInnerPipeline(line) {
    const split = ShellCore.splitShellList(line);
    if (split.ok === false) {
      throw new Error(split.error);
    }
    let captured = '';
    const { pipelines, ops } = split;
    let innerExit = 0;
    for (let i = 0; i < pipelines.length; i++) {
      const segment = pipelines[i];
      if (i > 0) {
        const op = ops[i - 1];
        if (op === '&&' && innerExit !== 0) continue;
        if (op === '||' && innerExit === 0) continue;
      }
      if (segment.trim() === '') {
        innerExit = 0;
        continue;
      }
      const parsedCommand = this.parseCommand(segment);
      const { stdout: out, stderr: err } = await this.executeCommandChain(parsedCommand);
      innerExit = this.lastExitCode;
      if (out) captured += (captured ? '\n' : '') + out;
      if (err) {
        // Surface inner stderr like bash does
        this.addOutput(err, { outputClass: 'stderr' });
      }
    }
    // Bash strips trailing newlines from substitution output
    return String(captured).replace(/\n+$/, '');
  }

  async executeCommandChain(commandChain) {
    let input = '';
    let displayStdout = '';
    let displayStderr = '';
    let chainLastExit = 0;
    /** Rightmost non-zero stage exit (for `set -o pipefail`). */
    let pipefailExit = 0;
    const opts = this.shellOptions || {};

    for (let i = 0; i < commandChain.length; i++) {
      const cmd = commandChain[i];
      const isLastCommand = i === commandChain.length - 1;

      try {
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

        const result = await this.executeSingleCommand(cmd, input, { stdinFromPipe: i > 0 });
        chainLastExit = result.exitCode ?? 0;
        if (chainLastExit !== 0) pipefailExit = chainLastExit;

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

    this.lastExitCode = opts.pipefail && pipefailExit !== 0 ? pipefailExit : chainLastExit;
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

    // Shell function dispatch (A7) — case-sensitive, runs body with positional
    // params $1..$9, $@, $#. Body runs as a sub-pipeline; $? leaks to caller.
    const fnBody = this.shellFunctions ? this.shellFunctions[cmd.name] : null;
    if (fnBody != null) {
      return await this.invokeShellFunction(cmd.name, fnBody, cmd.args || [], stdin, options);
    }

    if (this.aliases[cmdName]) {
      const aliasCommand = this.aliases[cmdName];
      const expandedArgs = aliasCommand.split(' ').concat(cmd.args);
      cmdName = expandedArgs[0].toLowerCase();
      cmd.args = expandedArgs.slice(1);
    }

    cmd.args = await this.expandGlobs(cmd.args);

    if (cmdName === 'help') {
      const h = this.helpCommand(cmd.args);
      return this.commandResult(h.stdout, h.stderr, h.exitCode);
    }

    // Handle path-based command execution (e.g., /bin/top, ./script.js)
    if (cmdName.includes('/')) {
      try {
        const filePath = this.resolvePath(cmdName);
        let file = await this.getFileSystemItem(filePath);

        if (file && file.type === 'symlink') {
          const resolved = await VfsUtils.vfsFollowSymlinksToAny(this, filePath);
          file = resolved.ok ? resolved.item : null;
        }

        if (file && file.type === 'file') {
          const actualCmd = cmdName.split('/').pop().toLowerCase();

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
              const { text, isBinary } = VfsUtils.fileItemUtf8ForDisplay(file);
              const body = isBinary ? '[binary file]' : text || 'File is empty';
              return this.commandResult(`Executing ${filePath}:\n${body}`, '', 0);
            }
          }

          return this.commandResult('', `jsh: ${filePath}: Permission denied`, 126);
        } else {
          return this.commandResult('', `jsh: ${cmdName}: No such file or directory`, 127);
        }
      } catch (error) {
        console.error('[terminal] file execution error (' + cmdName + '):', error);
        return this.commandResult('', `jsh: ${cmdName}: ${error.message}`, 1);
      }
    }

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
}

// Mix in the methods that live in sibling files. They use `this` like
// regular class methods, but live separately so this file stays focused
// on the pipeline orchestration. `terminal.js` carries the whole bundle
// onto `Terminal.prototype` via its existing `mixinPrototype` call.
Object.assign(TerminalPipelineMixin.prototype, parserMethods, redirectMethods, helpMethods);

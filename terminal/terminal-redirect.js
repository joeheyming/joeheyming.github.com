/**
 * Terminal redirect, heredoc, JS-eval and background-job mixin.
 *
 * Owns side-effects that write to the VFS (`redirectToFile`), the
 * heredoc state machine and its inline `js`/`node` evaluator, and the
 * detached background-job launcher (queues into `this.jobs` and the
 * simulated process table). Mixed into `TerminalPipelineMixin.prototype`.
 */

import { ShellCore } from './lib/shell-core.js';
import { VfsUtils } from './lib/vfs-utils.js';

export const redirectMethods = {
  async executeHeredocCommand() {
    this.beginBlockingCommandRun();
    try {
      try {
        const content = this.heredocContent.join('\n');
        const command = this.heredocCommand.toLowerCase();

        const completeHeredoc = `${this.heredocCommand} << ${this.heredocDelimiter}\n${content}\n${this.heredocDelimiter}`;

        if (
          completeHeredoc &&
          completeHeredoc !== this.commandHistory[this.commandHistory.length - 1]
        ) {
          this.commandHistory.push(completeHeredoc);
        }

        this.heredocMode = false;
        this.heredocCommand = null;
        this.heredocDelimiter = null;
        this.heredocContent = [];

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
  },

  async executeJavaScriptContent(content) {
    try {
      let output = '';
      let errorOutput = '';

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
        const func = new Function(content);
        func();
      } finally {
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
  },

  async redirectToFile(filename, content, append = false) {
    const filePath = this.resolvePath(filename);

    try {
      if (append) {
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
        await this.fileSystemDB.createFile(filePath, content, true);
      }
    } catch (error) {
      throw new Error(`cannot redirect to '${filename}': ${error.message}`);
    }
  },

  /**
   * Background job launcher (A5). Runs `segment` as a detached pipeline,
   * appends an entry to `this.jobs`, and prints `[jobId] PID` to stderr like
   * bash. State transitions to 'Done' on resolve, 'Error' on reject. The
   * shell does not block.
   *
   * Cooperative only — JS has no preemption, so a tight `while(true)` in a
   * background job still freezes the tab.
   *
   * @param {string} segment
   */
  launchBackgroundJob(segment) {
    if (!this.jobs) this.jobs = [];
    if (!this._nextJobId) this._nextJobId = 1;
    const jobId = this._nextJobId++;
    const startTime = Date.now();
    /** @type {{jobId:number, command:string, state:string, startTime:number, exitCode?:number, promise:Promise<void>, pid?:number}} */
    const job = {
      jobId,
      command: segment,
      state: 'Running',
      startTime,
      promise: Promise.resolve()
    };
    // Register this job in the simulated process table (C20) so `ps`, `top`,
    // and `kill %pid` can see it. The "process" is a placeholder — its real
    // work runs cooperatively on the main thread; isolation:false avoids
    // spinning up a Web Worker.
    if (this.os && this.os.kernel && this.os.kernel.processManager) {
      try {
        const pm = this.os.kernel.processManager;
        const parentPID = this.process ? this.process.pid : 1;
        // createProcess is async; for jobs we synchronously claim a PID and
        // attach the real registration as a follow-up.
        job.pid = pm.nextPID;
        const cmdName = String(segment).split(/\s+/)[0] || 'job';
        pm.createProcess({
          name: cmdName,
          executable: '/bin/' + cmdName,
          args: [],
          parentPID,
          uid: this.process ? this.process.uid : 1000,
          gid: this.process ? this.process.gid : 1000,
          isolated: false,
          env: { ...this.env },
          cwd: this.currentDirectory
        })
          .then((proc) => {
            job.pid = proc.pid;
            proc._jobId = jobId;
          })
          .catch(() => {
            /* registration best-effort; the job still runs */
          });
      } catch (_) {
        /* ignore */
      }
    }
    this.jobs.push(job);
    const summary = segment.length > 60 ? segment.slice(0, 57) + '...' : segment;
    this.addOutput(`[${jobId}] ${job.pid || ''} ${summary}`.trim(), { outputClass: 'stderr' });
    job.promise = (async () => {
      try {
        const split = ShellCore.splitShellList(segment);
        if (split.ok === false) {
          throw new Error(split.error);
        }
        let innerExit = 0;
        const { pipelines, ops } = split;
        let captured = '';
        for (let i = 0; i < pipelines.length; i++) {
          const seg = pipelines[i];
          if (i > 0) {
            const op = ops[i - 1];
            if (op === '&&' && innerExit !== 0) continue;
            if (op === '||' && innerExit === 0) continue;
          }
          if (seg.trim() === '') continue;
          const parsed = this.parseCommand(seg);
          const { stdout, stderr } = await this.executeCommandChain(parsed);
          innerExit = this.lastExitCode;
          if (stdout) captured += (captured ? '\n' : '') + stdout;
          if (stderr) this.addOutput(stderr, { outputClass: 'stderr' });
        }
        if (captured) this.addOutput(captured);
        job.state = 'Done';
        job.exitCode = innerExit;
      } catch (err) {
        job.state = 'Error';
        job.exitCode = 1;
        this.addOutput(`jsh: job [${jobId}] error: ${err.message}`, { outputClass: 'stderr' });
      } finally {
        this.addOutput(`[${jobId}]+ ${job.state}\t\t${segment}`, { outputClass: 'stderr' });
        // Reap the simulated process entry (C20).
        if (this.os && this.os.kernel && this.os.kernel.processManager && job.pid) {
          try {
            await this.os.kernel.processManager.terminateProcess(job.pid, job.exitCode || 0);
          } catch (_) {
            /* already gone */
          }
        }
      }
    })();
  }
};

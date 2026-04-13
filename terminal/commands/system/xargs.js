// xargs — build and execute commands from stdin (GNU-style subset)
(function () {
  'use strict';

  registerCommand(
    'xargs',
    async (terminal, args) => {
      const parsed = XargsLib.parseXargsArgv(args);
      if (parsed.ok === false) {
        return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
      }
      if (parsed.help) {
        return { stdout: XargsLib.XARGS_HELP.trim() + '\n', stderr: '', exitCode: 0 };
      }

      const stdinAvailable =
        terminal.stdinSupplied === true || (terminal.hasStdin && terminal.stdin != null);
      if (!stdinAvailable) {
        return {
          stdout: '',
          stderr: 'xargs: no stdin (use a pipe or redirect for standard input)\n',
          exitCode: 2
        };
      }

      if (typeof terminal.executeSingleCommand !== 'function') {
        return {
          stdout: '',
          stderr: 'xargs: shell cannot run child commands (internal error)\n',
          exitCode: 1
        };
      }

      const stdinText = terminal.stdin != null ? String(terminal.stdin) : '';
      const cmd = parsed.command;
      const cmdName = cmd[0];
      const initialArgs = cmd.slice(1);
      const replaceStr = parsed.replaceStr;
      const nullDelim = parsed.nullDelim;
      const maxArgs = parsed.maxArgs;
      const verbose = parsed.verbose;

      /** @type {string[][]} */
      let invocations = [];

      if (replaceStr != null) {
        const records = nullDelim
          ? XargsLib.xargsSplitNullRecords(stdinText)
          : XargsLib.xargsSplitLines(stdinText);
        for (const rec of records) {
          const subst = XargsLib.xargsSubstituteInArgs(initialArgs, replaceStr, rec);
          invocations.push([cmdName, ...subst]);
        }
      } else {
        const words = nullDelim
          ? XargsLib.xargsSplitNullRecords(stdinText)
          : XargsLib.xargsSplitWhitespaceWords(stdinText);
        if (words.length === 0) {
          if (maxArgs == null) {
            invocations.push([cmdName, ...initialArgs]);
          }
        } else if (maxArgs == null) {
          invocations.push([cmdName, ...initialArgs, ...words]);
        } else {
          const n = maxArgs;
          for (let i = 0; i < words.length; i += n) {
            invocations.push([cmdName, ...initialArgs, ...words.slice(i, i + n)]);
          }
        }
      }

      let stdout = '';
      let stderr = '';
      let anyFail = false;
      const sig = terminal.runAbortSignal;

      for (const argv of invocations) {
        if (sig?.aborted) {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          throw err;
        }
        const name = argv[0];
        const rest = argv.slice(1);
        if (verbose) {
          stderr += XargsLib.xargsFormatVerboseCommandLine(name, rest) + '\n';
        }
        const prevExit = terminal.lastExitCode;
        let res;
        try {
          res = await terminal.executeSingleCommand({ name, args: rest, redirections: {} }, '');
        } finally {
          terminal.lastExitCode = prevExit;
        }
        const code = res.exitCode ?? 0;
        if (code !== 0) {
          anyFail = true;
        }
        stdout += ShellCore.coerceShellString(res.stdout);
        if (res.stderr) {
          stderr += ShellCore.coerceShellString(res.stderr);
        }
      }

      return {
        stdout,
        stderr,
        exitCode: anyFail ? 1 : 0
      };
    },
    'build and execute COMMAND lines from stdin (-0 -I -n -t)',
    'System'
  );
})();

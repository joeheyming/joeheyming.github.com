// unlink — remove a single file or symlink (GNU-style single operand)
(function () {
  'use strict';

  /**
   * @param {Error} error
   * @param {string} operand — user operand for stderr
   * @returns {{ stderr: string, exitCode: number }}
   */
  function unlinkStderrFromError(error, operand) {
    const msg = error && error.message ? String(error.message) : String(error);
    if (msg.startsWith('No such file:')) {
      return {
        stderr: `unlink: cannot unlink '${operand}': No such file or directory`,
        exitCode: 1
      };
    }
    if (msg.startsWith('Not a file:')) {
      return {
        stderr: `unlink: cannot unlink '${operand}': Is a directory`,
        exitCode: 1
      };
    }
    return { stderr: `unlink: cannot unlink '${operand}': ${msg}`, exitCode: 1 };
  }

  registerCommand(
    'unlink',
    async (terminal, args) => {
      const parsed = ShellUtils.parseUnlinkArgv(args);
      if (!parsed.ok) {
        return { stderr: parsed.stderr, exitCode: parsed.exitCode };
      }
      if (parsed.help) {
        return { stdout: `${ShellUtils.UNLINK_HELP}\n`, stderr: '', exitCode: 0 };
      }

      const { operands } = parsed;
      if (operands.length === 0) {
        return {
          stderr: "unlink: missing file operand\nTry 'unlink --help' for more information.\n",
          exitCode: 1
        };
      }
      if (operands.length > 1) {
        return {
          stderr: `unlink: extra operand '${operands[1]}'\nTry 'unlink --help' for more information.\n`,
          exitCode: 1
        };
      }

      const name = operands[0];
      const absPath = terminal.resolvePath(name);
      const fs = terminal.fileSystemDB;

      try {
        await fs.unlink(absPath);
      } catch (error) {
        const { stderr, exitCode } = unlinkStderrFromError(error, name);
        return { stdout: '', stderr, exitCode };
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    },
    'remove a single file or symlink',
    'File System'
  );
})();

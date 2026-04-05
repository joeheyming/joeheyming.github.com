// cp command - copy files and directories
(function () {
  'use strict';

  /**
   * Map FileSystemDB.copyItem errors to coreutils-style stderr (user args, not resolved keys).
   * @param {Error} error
   * @param {string} srcArg
   * @param {string} destArg
   * @returns {{ stderr: string, exitCode: number }}
   */
  function cpStderrFromCopyError(error, srcArg, destArg) {
    const msg = error && error.message ? String(error.message) : String(error);
    if (msg.startsWith('No such file or directory:')) {
      return {
        stderr: `cp: cannot stat '${srcArg}': No such file or directory`,
        exitCode: 1
      };
    }
    if (msg.startsWith('Parent directory does not exist:')) {
      return {
        stderr: `cp: cannot create regular file '${destArg}': No such file or directory`,
        exitCode: 1
      };
    }
    if (msg.startsWith('Destination already exists:')) {
      return { stderr: `cp: '${destArg}': File exists`, exitCode: 1 };
    }
    if (msg.startsWith('Cannot copy directory without recursive flag:')) {
      return {
        stderr: `cp: -r not specified; omitting directory '${srcArg}'`,
        exitCode: 1
      };
    }
    return { stderr: `cp: cannot copy '${srcArg}' to '${destArg}': ${msg}`, exitCode: 1 };
  }

  registerCommand(
    'cp',
    async (terminal, args) => {
      const parsed = ShellUtils.parseCpArgv(args);
      if (!parsed.ok) {
        return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
      }
      if (parsed.help) {
        return { stdout: ShellUtils.CP_HELP, stderr: '', exitCode: 0 };
      }

      const { recursive, operands } = parsed;
      if (operands.length < 2) {
        return {
          stderr: "cp: missing file operand\nTry 'cp --help' for more information.\n",
          exitCode: 1
        };
      }
      if (operands.length > 2) {
        const extra = operands[2];
        return {
          stderr: `cp: extra operand '${extra}'\nTry 'cp --help' for more information.\n`,
          exitCode: 1
        };
      }

      const sourcePath = terminal.resolvePath(operands[0]);
      const destPath = terminal.resolvePath(operands[1]);

      try {
        await terminal.fileSystemDB.copyItem(sourcePath, destPath, recursive);
        return { stdout: '', stderr: '', exitCode: 0 };
      } catch (error) {
        const { stderr, exitCode } = cpStderrFromCopyError(error, operands[0], operands[1]);
        return { stdout: '', stderr, exitCode };
      }
    },
    'copy files and directories (-r for recursive, -- for operands starting with -)',
    'File System'
  );
})();

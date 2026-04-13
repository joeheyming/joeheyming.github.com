// mv command - move/rename files and directories
(function () {
  'use strict';

  /**
   * Map FileSystemDB.moveItem errors to coreutils-style stderr (user args, not resolved keys).
   * @param {Error} error
   * @param {string} srcArg
   * @param {string} destArg
   * @returns {{ stderr: string, exitCode: number }}
   */
  function mvStderrFromMoveError(error, srcArg, destArg) {
    const msg = error && error.message ? String(error.message) : String(error);
    if (msg.startsWith('No such file or directory:')) {
      return {
        stderr: `mv: cannot stat '${srcArg}': No such file or directory`,
        exitCode: 1
      };
    }
    if (msg.startsWith('Parent directory does not exist:')) {
      return {
        stderr: `mv: cannot move '${srcArg}' to '${destArg}': No such file or directory`,
        exitCode: 1
      };
    }
    if (msg.startsWith('Destination already exists:')) {
      return { stderr: `mv: cannot move '${srcArg}' to '${destArg}': File exists`, exitCode: 1 };
    }
    return { stderr: `mv: cannot move '${srcArg}' to '${destArg}': ${msg}`, exitCode: 1 };
  }

  registerCommand(
    'mv',
    async (terminal, args) => {
      const parsed = FileopsLib.parseMvArgv(args);
      if (parsed.ok === false) {
        return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
      }
      if (parsed.help) {
        return { stdout: FileopsLib.MV_HELP, stderr: '', exitCode: 0 };
      }

      const { operands } = parsed;
      if (operands.length === 0) {
        return {
          stderr: "mv: missing file operand\nTry 'mv --help' for more information.\n",
          exitCode: 1
        };
      }
      if (operands.length === 1) {
        return {
          stderr: `mv: missing destination file operand after '${operands[0]}'\nTry 'mv --help' for more information.\n`,
          exitCode: 1
        };
      }
      if (operands.length > 2) {
        const extra = operands[2];
        return {
          stderr: `mv: extra operand '${extra}'\nTry 'mv --help' for more information.\n`,
          exitCode: 1
        };
      }

      const sourcePath = terminal.resolvePath(operands[0]);
      const destPath = terminal.resolvePath(operands[1]);

      try {
        await terminal.fileSystemDB.moveItem(sourcePath, destPath);
        return { stdout: '', stderr: '', exitCode: 0 };
      } catch (error) {
        const { stderr, exitCode } = mvStderrFromMoveError(error, operands[0], operands[1]);
        return { stdout: '', stderr, exitCode };
      }
    },
    'move/rename files and directories (-f/-i/-n/-v no-ops, -- for operands starting with -)',
    'File System'
  );
})();

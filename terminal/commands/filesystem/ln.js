// ln — create links (symbolic links; GNU-style subset)
(function () {
  'use strict';

  /**
   * @param {Error} error
   * @param {string} linkArg — operand used in messages (as typed or basename)
   * @returns {{ stderr: string, exitCode: number }}
   */
  function lnCreateSymlinkError(error, linkArg) {
    const msg = error && error.message ? String(error.message) : String(error);
    if (msg.startsWith('Parent directory does not exist:')) {
      return {
        stderr: `ln: failed to create symbolic link '${linkArg}': No such file or directory\n`,
        exitCode: 1
      };
    }
    if (msg.startsWith('File already exists:')) {
      return {
        stderr: `ln: failed to create symbolic link '${linkArg}': File exists\n`,
        exitCode: 1
      };
    }
    return { stderr: `ln: failed to create symbolic link '${linkArg}': ${msg}\n`, exitCode: 1 };
  }

  registerCommand(
    'ln',
    async (terminal, args) => {
      const parsed = LnLib.parseLnArgv(args);
      if (parsed.ok === false) {
        return { stderr: parsed.stderr, exitCode: parsed.exitCode };
      }
      if ('help' in parsed && parsed.help) {
        return { stdout: LnLib.LN_HELP, stderr: '', exitCode: 0 };
      }
      if ('symbolic' in parsed && parsed.symbolic === false) {
        if (parsed.operands.length === 0) {
          return {
            stderr: "ln: missing file operand\nTry 'ln --help' for more information.\n",
            exitCode: 1
          };
        }
        return {
          stdout: '',
          stderr: 'ln: hard links are not supported in jsh; use ln -s\n',
          exitCode: 1
        };
      }

      if (!('symbolic' in parsed) || parsed.symbolic !== true) {
        return { stderr: 'ln: internal parse error\n', exitCode: 2 };
      }
      const { force, target, linkName } = parsed;
      const linkNameArg = linkName === null ? LnLib.symlinkBasenameForLn(target) : linkName;
      const absLink = terminal.resolvePath(linkNameArg);
      const fs = terminal.fileSystemDB;

      const existing = await terminal.getFileSystemItem(absLink);
      if (existing) {
        if (!force) {
          return {
            stdout: '',
            stderr: `ln: failed to create symbolic link '${linkNameArg}': File exists\n`,
            exitCode: 1
          };
        }
        if (existing.type === 'directory') {
          return {
            stdout: '',
            stderr: `ln: cannot overwrite directory '${linkNameArg}'\n`,
            exitCode: 1
          };
        }
        try {
          await fs.unlink(absLink);
        } catch (err) {
          const msg = err && err.message ? String(err.message) : String(err);
          return {
            stdout: '',
            stderr: `ln: failed to remove '${linkNameArg}': ${msg}\n`,
            exitCode: 1
          };
        }
      }

      try {
        await fs.createSymlink(String(target), absLink);
      } catch (error) {
        const e = lnCreateSymlinkError(error, linkNameArg);
        return { stdout: '', stderr: e.stderr, exitCode: e.exitCode };
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    },
    'create links (symbolic links)',
    'File System'
  );
})();

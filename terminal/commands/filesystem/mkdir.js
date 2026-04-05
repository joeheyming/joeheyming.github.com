// mkdir command - create directory
(function () {
  'use strict';

  /**
   * @param {Error} error
   * @param {string} arg — user operand
   * @returns {{ stderr: string, exitCode: number }}
   */
  function mkdirStderrFromError(error, arg) {
    const msg = error && error.message ? String(error.message) : String(error);
    if (msg.startsWith('Directory already exists:')) {
      return {
        stderr: `mkdir: cannot create directory '${arg}': File exists`,
        exitCode: 1
      };
    }
    if (msg.startsWith('Parent directory does not exist:')) {
      return {
        stderr: `mkdir: cannot create directory '${arg}': No such file or directory`,
        exitCode: 1
      };
    }
    return { stderr: `mkdir: cannot create directory '${arg}': ${msg}`, exitCode: 1 };
  }

  /**
   * GNU `mkdir -p`: create intermediate directories; succeed if leaf already exists as a directory.
   * @param {object} terminal
   * @param {string} userArg — operand as typed (for error messages)
   * @param {string} absPath — resolved absolute path
   * @returns {{ ok: true } | { ok: false, stderr: string, exitCode: number }}
   */
  async function mkdirParents(terminal, userArg, absPath) {
    const fs = terminal.fileSystemDB;
    if (absPath === '/' || absPath === '') {
      return { ok: true };
    }
    const parts = absPath.split('/').filter((p) => p);
    let cur = '';
    for (const seg of parts) {
      cur = cur === '/' ? `/${seg}` : `${cur}/${seg}`;
      const item = await fs.getItem(cur);
      if (item) {
        if (item.type !== 'directory') {
          return {
            ok: false,
            stderr: `mkdir: cannot create directory '${userArg}': File exists`,
            exitCode: 1
          };
        }
        continue;
      }
      try {
        await fs.createDirectory(cur);
      } catch (error) {
        const e = mkdirStderrFromError(error, userArg);
        return { ok: false, stderr: e.stderr, exitCode: e.exitCode };
      }
    }
    return { ok: true };
  }

  registerCommand(
    'mkdir',
    async (terminal, args) => {
      const parsed = ShellUtils.parseMkdirArgv(args);
      if (!parsed.ok) {
        return { stderr: parsed.stderr, exitCode: 1 };
      }
      const { parents, operands } = parsed;
      if (operands.length === 0) {
        return { stderr: 'mkdir: missing operand', exitCode: 1 };
      }

      let hadError = false;
      const stderrLines = [];

      for (const name of operands) {
        const dirPath = terminal.resolvePath(name);
        if (parents) {
          const r = await mkdirParents(terminal, name, dirPath);
          if (!r.ok) {
            stderrLines.push(r.stderr);
            hadError = true;
          }
          continue;
        }
        try {
          await terminal.fileSystemDB.createDirectory(dirPath);
        } catch (error) {
          const { stderr } = mkdirStderrFromError(error, name);
          stderrLines.push(stderr);
          hadError = true;
        }
      }

      if (hadError) {
        return { stdout: '', stderr: stderrLines.join('\n'), exitCode: 1 };
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    },
    'create directory',
    'File System'
  );
})();

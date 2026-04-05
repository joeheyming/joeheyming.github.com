// readlink — print symlink value or canonical path (GNU-style subset)
(function () {
  'use strict';

  registerCommand(
    'readlink',
    async (terminal, args) => {
      const parsed = ShellUtils.parseReadlinkArgv(args);
      if (!parsed.ok) {
        return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
      }
      if (parsed.help) {
        return { stdout: ShellUtils.READLINK_HELP, stderr: '', exitCode: 0 };
      }

      const { noNewline, canonMode, operand } = parsed;

      if (canonMode !== 'none') {
        const res = await ShellUtils.vfsReadlinkCanonical(terminal, operand, canonMode);
        if (!res.ok) {
          return { stdout: '', stderr: res.stderr + '\n', exitCode: 1 };
        }
        return {
          stdout: res.path + (noNewline ? '' : '\n'),
          stderr: '',
          exitCode: 0
        };
      }

      const fullPath = terminal.resolvePath(operand);
      const item = await terminal.getFileSystemItem(fullPath);
      if (!item) {
        return {
          stdout: '',
          stderr: `readlink: cannot access '${operand}': No such file or directory\n`,
          exitCode: 1
        };
      }
      if (item.type !== 'symlink') {
        return {
          stdout: '',
          stderr: `readlink: ${operand}: Invalid argument\n`,
          exitCode: 1
        };
      }
      const val = String(item.target ?? '');
      return {
        stdout: val + (noNewline ? '' : '\n'),
        stderr: '',
        exitCode: 0
      };
    },
    'print symlink target or canonical path',
    'File System'
  );
})();

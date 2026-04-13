// cd command - change directory
import { VfsUtils } from '../../lib/vfs-utils.js';

async function cdHandler(terminal, args) {
  if (args.length === 0) {
    terminal.updatePWD(terminal.env.HOME);
    return { stdout: '', stderr: '', exitCode: 0 };
  }

  if (args.length > 1) {
    return { stdout: '', stderr: 'cd: too many arguments', exitCode: 1 };
  }

  let targetDir = terminal.expandVariables(args[0]);
  let stdoutMsg = '';

  // cd - : swap to OLDPWD (bash behavior: print the new directory)
  if (targetDir === '-') {
    if (!terminal.env.OLDPWD) {
      return { stdout: '', stderr: 'cd: OLDPWD not set', exitCode: 1 };
    }
    targetDir = terminal.env.OLDPWD;
    stdoutMsg = targetDir;
  }

  const newPath = terminal.resolvePath(targetDir);
  const item = await terminal.getFileSystemItem(newPath);

  if (!item) {
    return {
      stdout: '',
      stderr: `cd: no such file or directory: ${targetDir}`,
      exitCode: 1
    };
  }

  // Follow symlink chains to a directory
  if (item.type === 'symlink') {
    const resolved = await VfsUtils.vfsFollowSymlinksToDir(terminal, targetDir, 'cd');
    if (resolved.ok === false) {
      return { stdout: '', stderr: resolved.stderr, exitCode: 1 };
    }
    terminal.updatePWD(resolved.resolvedPath);
    return { stdout: stdoutMsg, stderr: '', exitCode: 0 };
  }

  if (item.type !== 'directory') {
    return {
      stdout: '',
      stderr: `cd: not a directory: ${targetDir}`,
      exitCode: 1
    };
  }

  terminal.updatePWD(newPath);
  return { stdout: stdoutMsg, stderr: '', exitCode: 0 };
}

export default {
  name: 'cd',
  handler: cdHandler,
  description: 'change directory',
  category: 'File System'
};

// readlink — print symlink value or canonical path (GNU-style subset)
import { VfsUtils } from '../../lib/vfs-utils.js';
import { ReadlinkLib } from './readlink-lib.js';

async function readlinkHandler(terminal, args) {
  const parsed = ReadlinkLib.parseReadlinkArgv(args);
  if (parsed.ok === false) {
    return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
  }
  if (parsed.help) {
    return { stdout: ReadlinkLib.READLINK_HELP, stderr: '', exitCode: 0 };
  }

  const { noNewline, canonMode, operand } = parsed;

  if (canonMode !== 'none') {
    const res = await VfsUtils.vfsReadlinkCanonical(terminal, operand, canonMode);
    if (res.ok === false) {
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
}

export default {
  name: 'readlink',
  handler: readlinkHandler,
  description: 'print symlink target or canonical path',
  category: 'File System'
};

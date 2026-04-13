// pwd command - print working directory (GNU-style -L / -P)
import { VfsUtils } from '../../lib/vfs-utils.js';
import { PwdLib } from '../system/pwd-lib.js';

async function pwdHandler(terminal, args) {
  const parsed = PwdLib.parsePwdArgv(args);
  if (parsed.ok === false) {
    return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
  }
  if (parsed.help) {
    return { stdout: PwdLib.PWD_HELP.trim() + '\n', stderr: '', exitCode: 0 };
  }

  const cwd = terminal.currentDirectory;
  if (cwd == null || cwd === '') {
    return {
      stdout: '',
      stderr: 'pwd: error retrieving current directory',
      exitCode: 1
    };
  }

  if (!parsed.physical) {
    return { stdout: cwd, stderr: '', exitCode: 0 };
  }

  const res = await VfsUtils.vfsReadlinkCanonical(terminal, cwd, 'e', 'pwd');
  if (res.ok === false) {
    return { stdout: '', stderr: `${res.stderr}\n`, exitCode: 1 };
  }
  return { stdout: res.path, stderr: '', exitCode: 0 };
}

export default {
  name: 'pwd',
  handler: pwdHandler,
  description: 'print working directory',
  category: 'File System'
};

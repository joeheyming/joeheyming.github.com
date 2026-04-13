// tee — copy stdin to stdout and to FILE(s) (GNU-ish subset)
import { VfsUtils } from '../../lib/vfs-utils.js';
import { TeeLib } from './tee-lib.js';

/**
 * @param {Error} error
 * @param {string} arg — user operand
 * @returns {{ stderr: string, exitCode: number }}
 */
function teeStderrFromError(error, arg) {
  const msg = error && error.message ? String(error.message) : String(error);
  if (msg.startsWith('Parent directory does not exist:')) {
    return {
      stderr: `tee: ${arg}: No such file or directory`,
      exitCode: 1
    };
  }
  return { stderr: `tee: ${arg}: ${msg}`, exitCode: 1 };
}

async function teeHandler(terminal, args) {
  const parsed = TeeLib.parseTeeArgv(args);
  if (parsed.ok === false) {
    return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
  }
  if (parsed.help) {
    return { stdout: TeeLib.TEE_HELP.trim() + '\n', stderr: '', exitCode: 0 };
  }

  if (terminal.stdinSupplied !== true) {
    return { stdout: '', stderr: 'tee: no input\n', exitCode: 1 };
  }

  const input = terminal.stdin != null ? String(terminal.stdin) : '';
  const append = parsed.append;
  const files = parsed.files;

  const dashExtra = files.filter((f) => f === '-').length;
  const pathOperands = files.filter((f) => f !== '-');

  const outParts = new Array(1 + dashExtra).fill(input);
  const stdout = outParts.join('');

  const stderrLines = [];
  for (const name of pathOperands) {
    const filePath = terminal.resolvePath(name);
    const existing = await terminal.getFileSystemItem(filePath);
    if (existing && existing.type === 'directory') {
      stderrLines.push(`tee: ${name}: Is a directory`);
      continue;
    }
    if (existing && existing.type === 'symlink') {
      stderrLines.push(`tee: ${name}: Is a symbolic link`);
      continue;
    }
    try {
      if (append) {
        const prev =
          existing && existing.type === 'file'
            ? VfsUtils.fileItemUtf8ForDisplay(existing).text
            : '';
        await terminal.fileSystemDB.createFile(filePath, prev + input, true);
      } else {
        await terminal.fileSystemDB.createFile(filePath, input, true);
      }
    } catch (error) {
      const { stderr } = teeStderrFromError(error, name);
      stderrLines.push(stderr);
    }
  }

  if (stderrLines.length > 0) {
    return {
      stdout,
      stderr: stderrLines.join('\n') + '\n',
      exitCode: 1
    };
  }
  return { stdout, stderr: '', exitCode: 0 };
}

export default {
  name: 'tee',
  handler: teeHandler,
  description:
    'copy stdin to stdout and files (GNU-style -a/--append, --help; -h alias; operand - duplicates stdout)',
  category: 'File System'
};

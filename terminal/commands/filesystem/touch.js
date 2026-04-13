// touch command - create empty file or update timestamp
import { TouchLib } from './touch-lib.js';

/**
 * @param {Error} error
 * @param {string} arg — user operand
 * @returns {{ stderr: string, exitCode: number }}
 */
function touchStderrFromError(error, arg) {
  const msg = error && error.message ? String(error.message) : String(error);
  if (msg.startsWith('Parent directory does not exist:')) {
    return {
      stderr: `touch: cannot touch '${arg}': No such file or directory`,
      exitCode: 1
    };
  }
  if (msg.startsWith('File already exists:')) {
    return { stderr: `touch: cannot touch '${arg}': File exists`, exitCode: 1 };
  }
  return { stderr: `touch: cannot touch '${arg}': ${msg}`, exitCode: 1 };
}

async function touchHandler(terminal, args) {
  const parsed = TouchLib.parseTouchArgv(args);
  if (parsed.ok === false) {
    return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
  }
  if (parsed.help) {
    return { stdout: TouchLib.TOUCH_HELP, stderr: '', exitCode: 0 };
  }

  const { noCreate, operands } = parsed;
  let hadError = false;
  const stderrLines = [];

  for (const name of operands) {
    const filePath = terminal.resolvePath(name);
    try {
      const existing = await terminal.getFileSystemItem(filePath);
      if (!existing) {
        if (noCreate) {
          continue;
        }
        await terminal.fileSystemDB.createFile(filePath, '');
      } else {
        await terminal.fileSystemDB.createFile(filePath, existing.content || '', true);
      }
    } catch (error) {
      const { stderr } = touchStderrFromError(error, name);
      stderrLines.push(stderr);
      hadError = true;
    }
  }

  if (hadError) {
    return { stdout: '', stderr: stderrLines.join('\n'), exitCode: 1 };
  }
  return { stdout: '', stderr: '', exitCode: 0 };
}

export default {
  name: 'touch',
  handler: touchHandler,
  description: 'create empty file or update timestamp',
  category: 'File System'
};

// rm command - remove files and directories
import { FileopsLib } from './fileops-lib.js';

/**
 * @param {Error} error
 * @param {string} targetArg — user operand (not resolved path)
 * @returns {{ stderr: string, exitCode: number }}
 */
function rmStderrFromDeleteError(error, targetArg) {
  const msg = error && error.message ? String(error.message) : String(error);
  if (msg.startsWith('No such file or directory:')) {
    return {
      stderr: `rm: cannot remove '${targetArg}': No such file or directory`,
      exitCode: 1
    };
  }
  if (msg.startsWith('Directory not empty:')) {
    return {
      stderr: `rm: cannot remove '${targetArg}': Directory not empty`,
      exitCode: 1
    };
  }
  return { stderr: `rm: cannot remove '${targetArg}': ${msg}`, exitCode: 1 };
}

async function rmHandler(terminal, args) {
  const parsed = FileopsLib.parseRmArgv(args);
  if (parsed.ok === false) {
    return { stderr: parsed.stderr, exitCode: parsed.exitCode };
  }
  if (parsed.help) {
    return { stdout: `${FileopsLib.RM_HELP}\n`, stderr: '', exitCode: 0 };
  }

  const { recursive, force, operands } = parsed;

  if (operands.length === 0) {
    return {
      stderr: "rm: missing operand\nTry 'rm --help' for more information.\n",
      exitCode: 1
    };
  }

  if (recursive && force && operands.includes('/')) {
    return {
      stderr: `🚨 WHOA THERE! 🚨
rm -rf / is dangerous! Good thing this filesystem has safety checks!

💡 Fun fact: This command would delete everything on a real system.
🛡️  Always be careful with rm -rf in real life!
☕ Maybe have some coffee first: try 'coffee'`,
      exitCode: 1
    };
  }

  let hadError = false;
  const stderrLines = [];

  for (const target of operands) {
    const targetPath = terminal.resolvePath(target);

    try {
      const item = await terminal.getFileSystemItem(targetPath);

      if (!item) {
        if (!force) {
          const { stderr } = rmStderrFromDeleteError(
            new Error(`No such file or directory: ${targetPath}`),
            target
          );
          stderrLines.push(stderr);
          hadError = true;
        }
        continue;
      }

      if (item.type === 'directory' && !recursive) {
        stderrLines.push(`rm: cannot remove '${target}': Is a directory`);
        hadError = true;
        continue;
      }

      await terminal.fileSystemDB.deleteItem(targetPath, recursive);
    } catch (error) {
      if (force && String(error.message || error).startsWith('No such file or directory:')) {
        continue;
      }
      const { stderr } = rmStderrFromDeleteError(error, target);
      stderrLines.push(stderr);
      hadError = true;
    }
  }

  if (hadError) {
    return {
      stdout: '',
      stderr: stderrLines.join('\n'),
      exitCode: 1
    };
  }
  return { stdout: '', stderr: '', exitCode: 0 };
}

export default {
  name: 'rm',
  handler: rmHandler,
  description: 'remove files and directories (GNU-style flags; see rm --help)',
  category: 'File System'
};

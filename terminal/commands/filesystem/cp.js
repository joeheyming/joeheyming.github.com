// cp command - copy files and directories
import { FileopsLib } from './fileops-lib.js';

/**
 * Map FileSystemDB.copyItem errors to coreutils-style stderr (user args, not resolved keys).
 * @param {Error} error
 * @param {string} srcArg
 * @param {string} destArg
 * @returns {{ stderr: string, exitCode: number }}
 */
function cpStderrFromCopyError(error, srcArg, destArg) {
  const msg = error && error.message ? String(error.message) : String(error);
  if (msg.startsWith('No such file or directory:')) {
    return {
      stderr: `cp: cannot stat '${srcArg}': No such file or directory`,
      exitCode: 1
    };
  }
  if (msg.startsWith('Parent directory does not exist:')) {
    return {
      stderr: `cp: cannot create regular file '${destArg}': No such file or directory`,
      exitCode: 1
    };
  }
  if (msg.startsWith('Destination already exists:')) {
    return { stderr: `cp: '${destArg}': File exists`, exitCode: 1 };
  }
  if (msg.startsWith('Cannot copy directory without recursive flag:')) {
    return {
      stderr: `cp: -r not specified; omitting directory '${srcArg}'`,
      exitCode: 1
    };
  }
  return { stderr: `cp: cannot copy '${srcArg}' to '${destArg}': ${msg}`, exitCode: 1 };
}

async function cpHandler(terminal, args) {
  const parsed = FileopsLib.parseCpArgv(args);
  if (parsed.ok === false) {
    return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
  }
  if (parsed.help) {
    return { stdout: FileopsLib.CP_HELP, stderr: '', exitCode: 0 };
  }

  const { recursive, operands } = parsed;
  if (operands.length < 2) {
    return {
      stderr: "cp: missing file operand\nTry 'cp --help' for more information.\n",
      exitCode: 1
    };
  }

  // Multi-source form (B12): `cp a b c destdir/` — last operand must be a dir.
  if (operands.length > 2) {
    const destOperand = operands[operands.length - 1];
    const destPath = terminal.resolvePath(destOperand);
    const destItem = await terminal.getFileSystemItem(destPath);
    if (!destItem || destItem.type !== 'directory') {
      return {
        stderr: `cp: target '${destOperand}' is not a directory\n`,
        exitCode: 1
      };
    }
    const stderrLines = [];
    let failed = 0;
    for (let i = 0; i < operands.length - 1; i++) {
      const srcOperand = operands[i];
      const srcPath = terminal.resolvePath(srcOperand);
      const name = terminal.fileSystemDB.getFileName(srcPath);
      const finalDest = terminal.fileSystemDB.joinPath(destPath, name);
      try {
        await terminal.fileSystemDB.copyItem(srcPath, finalDest, recursive);
      } catch (error) {
        const { stderr } = cpStderrFromCopyError(error, srcOperand, finalDest);
        stderrLines.push(stderr.replace(/\n$/, ''));
        failed++;
      }
    }
    return {
      stdout: '',
      stderr: stderrLines.length ? stderrLines.join('\n') + '\n' : '',
      exitCode: failed > 0 ? 1 : 0
    };
  }

  // Two-operand form: existing behavior.
  const sourcePath = terminal.resolvePath(operands[0]);
  let destPath = terminal.resolvePath(operands[1]);

  // GNU cp: if dest is an existing directory, copy SOURCE inside it.
  try {
    const destItem = await terminal.getFileSystemItem(destPath);
    if (destItem && destItem.type === 'directory') {
      const name = terminal.fileSystemDB.getFileName(sourcePath);
      destPath = terminal.fileSystemDB.joinPath(destPath, name);
    }
  } catch (_) {
    /* getItem failure handled below */
  }

  try {
    await terminal.fileSystemDB.copyItem(sourcePath, destPath, recursive);
    return { stdout: '', stderr: '', exitCode: 0 };
  } catch (error) {
    const { stderr, exitCode } = cpStderrFromCopyError(error, operands[0], operands[1]);
    return { stdout: '', stderr, exitCode };
  }
}

export default {
  name: 'cp',
  handler: cpHandler,
  description: 'copy files and directories (-r for recursive, -- for operands starting with -)',
  category: 'File System'
};

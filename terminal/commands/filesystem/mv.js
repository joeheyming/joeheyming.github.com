// mv command - move/rename files and directories
import { FileopsLib } from './fileops-lib.js';

/**
 * Map FileSystemDB.moveItem errors to coreutils-style stderr (user args, not resolved keys).
 * @param {Error} error
 * @param {string} srcArg
 * @param {string} destArg
 * @returns {{ stderr: string, exitCode: number }}
 */
function mvStderrFromMoveError(error, srcArg, destArg) {
  const msg = error && error.message ? String(error.message) : String(error);
  if (msg.startsWith('No such file or directory:')) {
    return {
      stderr: `mv: cannot stat '${srcArg}': No such file or directory`,
      exitCode: 1
    };
  }
  if (msg.startsWith('Parent directory does not exist:')) {
    return {
      stderr: `mv: cannot move '${srcArg}' to '${destArg}': No such file or directory`,
      exitCode: 1
    };
  }
  if (msg.startsWith('Destination already exists:')) {
    return { stderr: `mv: cannot move '${srcArg}' to '${destArg}': File exists`, exitCode: 1 };
  }
  return { stderr: `mv: cannot move '${srcArg}' to '${destArg}': ${msg}`, exitCode: 1 };
}

async function mvHandler(terminal, args) {
  const parsed = FileopsLib.parseMvArgv(args);
  if (parsed.ok === false) {
    return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
  }
  if (parsed.help) {
    return { stdout: FileopsLib.MV_HELP, stderr: '', exitCode: 0 };
  }

  const { operands } = parsed;
  if (operands.length === 0) {
    return {
      stderr: "mv: missing file operand\nTry 'mv --help' for more information.\n",
      exitCode: 1
    };
  }
  if (operands.length === 1) {
    return {
      stderr: `mv: missing destination file operand after '${operands[0]}'\nTry 'mv --help' for more information.\n`,
      exitCode: 1
    };
  }
  // Multi-source form (B12): `mv a b c destdir/` — last operand must be a dir.
  if (operands.length > 2) {
    const destOperand = operands[operands.length - 1];
    const destPath = terminal.resolvePath(destOperand);
    const destItem = await terminal.getFileSystemItem(destPath);
    if (!destItem || destItem.type !== 'directory') {
      return {
        stderr: `mv: target '${destOperand}' is not a directory\n`,
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
        await terminal.fileSystemDB.moveItem(srcPath, finalDest);
      } catch (error) {
        const { stderr } = mvStderrFromMoveError(error, srcOperand, finalDest);
        stderrLines.push(stderr);
        failed++;
      }
    }
    return {
      stdout: '',
      stderr: stderrLines.length ? stderrLines.join('\n') + '\n' : '',
      exitCode: failed > 0 ? 1 : 0
    };
  }

  const sourcePath = terminal.resolvePath(operands[0]);
  let destPath = terminal.resolvePath(operands[1]);

  // GNU mv: if dest is an existing directory, move SOURCE inside it.
  try {
    const destItem = await terminal.getFileSystemItem(destPath);
    if (destItem && destItem.type === 'directory') {
      const name = terminal.fileSystemDB.getFileName(sourcePath);
      destPath = terminal.fileSystemDB.joinPath(destPath, name);
    }
  } catch (_) {
    /* handled below */
  }

  try {
    await terminal.fileSystemDB.moveItem(sourcePath, destPath);
    return { stdout: '', stderr: '', exitCode: 0 };
  } catch (error) {
    const { stderr, exitCode } = mvStderrFromMoveError(error, operands[0], operands[1]);
    return { stdout: '', stderr, exitCode };
  }
}

export default {
  name: 'mv',
  handler: mvHandler,
  description:
    'move/rename files and directories (-f/-i/-n/-v no-ops, -- for operands starting with -)',
  category: 'File System'
};

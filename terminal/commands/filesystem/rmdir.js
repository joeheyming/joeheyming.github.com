// rmdir — remove empty directories
import { FileopsLib } from './fileops-lib.js';

/**
 * @param {string} absPath
 * @returns {string}
 */
function pathBasenameForError(absPath) {
  const p = absPath.replace(/\/+$/, '') || '/';
  if (p === '/') {
    return '/';
  }
  const i = p.lastIndexOf('/');
  return i === -1 ? p : p.slice(i + 1);
}

/**
 * @param {Error} error
 * @param {string} displayName — path segment or operand for stderr
 * @returns {{ stderr: string, exitCode: number }}
 */
function rmdirStderrFromError(error, displayName) {
  const msg = error && error.message ? String(error.message) : String(error);
  if (msg.startsWith('No such directory:') || msg.startsWith('No such file or directory:')) {
    return {
      stderr: `rmdir: failed to remove '${displayName}': No such file or directory`,
      exitCode: 1
    };
  }
  if (msg.startsWith('Not a directory:')) {
    return {
      stderr: `rmdir: failed to remove '${displayName}': Not a directory`,
      exitCode: 1
    };
  }
  if (msg.startsWith('Directory not empty:')) {
    return {
      stderr: `rmdir: failed to remove '${displayName}': Directory not empty`,
      exitCode: 1
    };
  }
  return { stderr: `rmdir: failed to remove '${displayName}': ${msg}`, exitCode: 1 };
}

/**
 * @param {string} absPath — normalized absolute path (no trailing slash except root)
 * @returns {string} parent directory or '' if none (at or above root)
 */
function parentDir(absPath) {
  const p = absPath.replace(/\/+$/, '') || '/';
  if (p === '/') {
    return '';
  }
  const idx = p.lastIndexOf('/');
  if (idx <= 0) {
    return '/';
  }
  return p.slice(0, idx) || '/';
}

async function rmdirHandler(terminal, args) {
  const parsed = FileopsLib.parseRmdirArgv(args);
  if (parsed.ok === false) {
    return { stderr: parsed.stderr, exitCode: parsed.exitCode };
  }
  if (parsed.help) {
    return { stdout: `${FileopsLib.RMDIR_HELP}\n`, stderr: '', exitCode: 0 };
  }

  const { parents, operands } = parsed;
  if (operands.length === 0) {
    return {
      stderr: "rmdir: missing operand\nTry 'rmdir --help' for more information.\n",
      exitCode: 1
    };
  }

  const fs = terminal.fileSystemDB;
  let hadError = false;
  const stderrLines = [];

  for (const name of operands) {
    const absPath = terminal.resolvePath(name);
    const normalized = absPath.replace(/\/+$/, '') || '/';

    if (!parents) {
      try {
        await fs.rmdir(normalized);
      } catch (error) {
        const d = pathBasenameForError(normalized);
        const { stderr } = rmdirStderrFromError(error, d);
        stderrLines.push(stderr);
        hadError = true;
      }
      continue;
    }

    let cur = normalized;
    if (cur === '/') {
      stderrLines.push(`rmdir: failed to remove '/': Invalid argument`);
      hadError = true;
      continue;
    }

    while (cur && cur !== '/') {
      try {
        await fs.rmdir(cur);
      } catch (error) {
        const d = pathBasenameForError(cur);
        const { stderr } = rmdirStderrFromError(error, d);
        stderrLines.push(stderr);
        hadError = true;
        break;
      }
      cur = parentDir(cur);
    }
  }

  if (hadError) {
    return { stdout: '', stderr: stderrLines.join('\n'), exitCode: 1 };
  }
  return { stdout: '', stderr: '', exitCode: 0 };
}

export default {
  name: 'rmdir',
  handler: rmdirHandler,
  description: 'remove empty directories',
  category: 'File System'
};

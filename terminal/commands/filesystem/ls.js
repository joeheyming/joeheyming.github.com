// ls command - list directory contents
import { LsLib } from './ls-lib.js';
import { VfsUtils } from '../../lib/vfs-utils.js';

async function lsHandler(terminal, args) {
  const parsed = LsLib.parseLsDisplayFlags(args);
  if (parsed.error) {
    return { stdout: '', stderr: parsed.error.stderr, exitCode: parsed.error.exitCode };
  }
  if (parsed.help) {
    return { stdout: LsLib.LS_HELP, stderr: '', exitCode: 0 };
  }
  const { showDetails, showAll } = parsed;

  // Filter out flags to find the target directory
  let pastDashDash = false;
  const nonFlagArgs = args.filter((arg) => {
    if (pastDashDash) return true;
    if (arg === '--') {
      pastDashDash = true;
      return false;
    }
    return !arg.startsWith('-');
  });
  const targetDir = nonFlagArgs[0] || terminal.currentDirectory;
  const fullPath = terminal.resolvePath(targetDir);

  try {
    let stats = /** @type {{ type?: string, size?: number, modified?: number } | null} */ (
      await terminal.syscall('stat', fullPath)
    );

    if (!stats) {
      return {
        stderr: `ls: cannot access '${targetDir}': No such file or directory`,
        exitCode: 1
      };
    }

    // Follow symlink operands to the target (GNU ls default without -d)
    if (stats.type === 'symlink') {
      const resolved = await VfsUtils.vfsFollowSymlinksToAny(terminal, fullPath);
      if (resolved.ok === true) {
        stats = /** @type {typeof stats} */ (resolved.item);
      } else {
        return {
          stderr: `ls: cannot access '${targetDir}': Too many levels of symbolic links`,
          exitCode: 1
        };
      }
    }

    if (stats.type === 'file') {
      if (showDetails) {
        const size = stats.size || 0;
        const modified = stats.modified
          ? new Date(stats.modified).toISOString().slice(0, 16).replace('T', ' ')
          : 'unknown';
        return {
          stdout: `-rw-r--r-- 1 ${terminal.env.USER} ${terminal.env.USER} ${size
            .toString()
            .padStart(8)} ${modified} ${targetDir.split('/').pop()}`,
          stderr: '',
          exitCode: 0
        };
      }
      return {
        stdout: targetDir.split('/').pop(),
        stderr: '',
        exitCode: 0
      };
    }

    // If it's a directory, list its contents
    if (stats.type === 'directory') {
      const raw = await terminal.listDirectoryContents(fullPath);
      let entries = VfsUtils.sortDirectoryEntriesByName(raw);
      if (!showAll) {
        entries = entries.filter((e) => !String(e.name).startsWith('.'));
      }
      if (entries.length === 0) {
        return { stdout: '', stderr: '', exitCode: 0 };
      }

      // Format directory entries
      if (showDetails) {
        return {
          stdout: entries
            .map((entry) => {
              const typeChar =
                entry.type === 'directory' ? 'd' : entry.type === 'symlink' ? 'l' : '-';
              const size = entry.size || 0;
              const modified = entry.modified
                ? new Date(entry.modified).toLocaleDateString()
                : 'unknown';
              const icon =
                entry.type === 'directory' ? '📁' : entry.type === 'symlink' ? '🔗' : '📄';
              const suffix = entry.type === 'symlink' && entry.target ? ` -> ${entry.target}` : '';
              return `${typeChar}rwxr-xr-x 1 user user ${size
                .toString()
                .padStart(8)} ${modified} ${icon} ${entry.name}${suffix}`;
            })
            .join('\n'),
          stderr: '',
          exitCode: 0
        };
      }
      return {
        stdout: entries
          .map((entry) => {
            if (entry.type === 'directory') {
              return `📁 ${entry.name}`;
            }
            if (entry.type === 'symlink') {
              return `🔗 ${entry.name}`;
            }
            return `📄 ${entry.name}`;
          })
          .join('  '),
        stderr: '',
        exitCode: 0
      };
    }

    return {
      stderr: `ls: cannot access '${targetDir}': Not a file or directory`,
      exitCode: 1
    };
  } catch (error) {
    // Handle permission errors or other OS-level errors
    console.error('ls command error:', error);
    if (error.message.includes('Permission denied')) {
      return {
        stderr: `ls: cannot access '${targetDir}': Permission denied`,
        exitCode: 1
      };
    }
    if (error.message.includes('is not a function')) {
      return {
        stderr: `ls: cannot access '${targetDir}': ${error.message}\nTry running 'osinfo' to check system status`,
        exitCode: 1
      };
    }
    return {
      stderr: `ls: cannot access '${targetDir}': ${error.message}`,
      exitCode: 1
    };
  }
}

export default {
  name: 'ls',
  handler: lsHandler,
  description: 'list directory contents (-l long, -a include dotfiles)',
  category: 'File System'
};

// df command - display filesystem statistics (browser VFS; not block-device df)
(function () {
  'use strict';

  /**
   * @param {string[]} args
   * @returns {{ ok: true } | { ok: false, stderr: string, exitCode: number } | { ok: true, help: true }}
   */
  function parseDfArgs(args) {
    let i = 0;
    while (i < args.length) {
      const a = args[i];
      if (a === '--') {
        i++;
        break;
      }
      if (!a.startsWith('-')) {
        i++;
        continue;
      }
      if (a === '-h' || a === '--human-readable') {
        i++;
        continue;
      }
      if (a === '--help') {
        return { ok: true, help: true };
      }
      if (a.startsWith('--')) {
        return {
          ok: false,
          stderr: `df: unrecognized option '${a}'`,
          exitCode: 2
        };
      }
      for (let j = 1; j < a.length; j++) {
        const c = a[j];
        if (c === 'h') {
          continue;
        }
        return {
          ok: false,
          stderr: `df: invalid option -- '${c}'`,
          exitCode: 2
        };
      }
      i++;
    }
    return { ok: true };
  }

  registerCommand(
    'df',
    async (terminal, args) => {
      const parsed = parseDfArgs(args);
      if (parsed.ok === false) {
        return { stderr: parsed.stderr, exitCode: parsed.exitCode };
      }
      if ('help' in parsed && parsed.help) {
        return {
          stdout: 'Usage: df [-h] [--human-readable]\n',
          stderr: '',
          exitCode: 0
        };
      }

      if (!terminal.fileSystemDB || typeof terminal.fileSystemDB.getStats !== 'function') {
        return {
          stderr: 'df: filesystem not available',
          exitCode: 1
        };
      }

      try {
        const stats = await terminal.fileSystemDB.getStats();
        const totalSizeKB = Math.round(stats.totalSize / 1024);

        const out = `Filesystem Statistics:
📊 Total items: ${stats.totalItems}
📁 Directories: ${stats.directories}
📄 Files: ${stats.files}
💾 Total size: ${totalSizeKB} KB
🗄️  Storage: IndexedDB (persistent)`;

        return { stdout: out, stderr: '', exitCode: 0 };
      } catch (error) {
        const msg = error && error.message ? String(error.message) : String(error);
        return { stdout: '', stderr: `df: ${msg}`, exitCode: 1 };
      }
    },
    'display filesystem statistics',
    'File System'
  );
})();

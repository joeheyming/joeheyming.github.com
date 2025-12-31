// head command - output first lines of files or input
(function () {
  'use strict';

  registerCommand(
    'head',
    async (terminal, args) => {
      let lines = 10; // default
      let input = '';
      let files = [];

      // Parse arguments
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '-n' && i + 1 < args.length) {
          lines = parseInt(args[i + 1]);
          i++; // skip next arg
        } else if (args[i].startsWith('-') && /^\-\d+$/.test(args[i])) {
          lines = parseInt(args[i].substring(1));
        } else {
          files.push(args[i]);
        }
      }

      // Get input
      if (terminal.hasStdin && terminal.stdin) {
        input = terminal.stdin;
      } else if (files.length > 0) {
        const filePath = terminal.resolvePath(files[0]);
        const file = await terminal.getFileSystemItem(filePath);
        if (!file || file.type !== 'file') {
          return `head: cannot open '${files[0]}' for reading: No such file or directory`;
        }
        input = file.content || '';
      } else {
        return 'head: no input provided';
      }

      const inputLines = input.split('\n');
      return inputLines.slice(0, lines).join('\n');
    },
    'output first lines of files or input (-n NUM or -NUM for line count)',
    'File System'
  );
})();

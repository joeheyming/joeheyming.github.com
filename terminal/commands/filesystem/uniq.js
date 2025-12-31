// uniq command - report or omit repeated lines
(function () {
  'use strict';

  registerCommand(
    'uniq',
    async (terminal, args) => {
      let input = '';
      let files = [];
      const flags = args.filter((arg) => arg.startsWith('-'));

      const countDuplicates = flags.includes('-c');

      // Parse file arguments
      files = args.filter((arg) => !arg.startsWith('-'));

      // Get input
      if (terminal.hasStdin && terminal.stdin) {
        input = terminal.stdin;
      } else if (files.length > 0) {
        const filePath = terminal.resolvePath(files[0]);
        const file = await terminal.getFileSystemItem(filePath);
        if (!file || file.type !== 'file') {
          return `uniq: cannot read: ${files[0]}: No such file or directory`;
        }
        input = file.content || '';
      } else {
        return 'uniq: no input provided';
      }

      const lines = input.split('\n');
      const result = [];
      let currentLine = '';
      let count = 0;

      for (const line of lines) {
        if (line === currentLine) {
          count++;
        } else {
          if (currentLine !== '') {
            if (countDuplicates) {
              result.push(`${count.toString().padStart(7)} ${currentLine}`);
            } else {
              result.push(currentLine);
            }
          }
          currentLine = line;
          count = 1;
        }
      }

      // Add the last line
      if (currentLine !== '') {
        if (countDuplicates) {
          result.push(`${count.toString().padStart(7)} ${currentLine}`);
        } else {
          result.push(currentLine);
        }
      }

      return result.join('\n');
    },
    'report or omit repeated lines (-c show counts)',
    'File System'
  );
})();

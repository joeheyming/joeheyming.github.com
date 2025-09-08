// sort command - sort lines of text
(function () {
  'use strict';

  registerCommand('sort', async (terminal, args) => {
    let input = '';
    let files = [];
    const flags = args.filter((arg) => arg.startsWith('-'));

    const reverse = flags.includes('-r');
    const numeric = flags.includes('-n');
    const unique = flags.includes('-u');

    // Parse file arguments
    files = args.filter((arg) => !arg.startsWith('-'));

    // Get input
    if (terminal.hasStdin && terminal.stdin) {
      input = terminal.stdin;
    } else if (files.length > 0) {
      const filePath = terminal.resolvePath(files[0]);
      const file = await terminal.getFileSystemItem(filePath);
      if (!file || file.type !== 'file') {
        return `sort: cannot read: ${files[0]}: No such file or directory`;
      }
      input = file.content || '';
    } else {
      return 'sort: no input provided';
    }

    let lines = input.split('\n').filter((line) => line !== '');

    // Sort lines
    if (numeric) {
      lines.sort((a, b) => {
        const numA = parseFloat(a) || 0;
        const numB = parseFloat(b) || 0;
        return reverse ? numB - numA : numA - numB;
      });
    } else {
      lines.sort((a, b) => {
        return reverse ? b.localeCompare(a) : a.localeCompare(b);
      });
    }

    // Remove duplicates if requested
    if (unique) {
      lines = [...new Set(lines)];
    }

    return lines.join('\n');
  }, 'sort lines of text (-r reverse, -n numeric, -u unique)', 'File System');
})();

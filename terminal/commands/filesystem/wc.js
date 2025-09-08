// wc command - count lines, words, and characters
(function () {
  'use strict';

  registerCommand('wc', async (terminal, args) => {
    let input = '';
    let files = [];
    const flags = args.filter((arg) => arg.startsWith('-'));

    // Parse file arguments
    files = args.filter((arg) => !arg.startsWith('-'));

    // Get input
    if (terminal.hasStdin && terminal.stdin) {
      input = terminal.stdin;
    } else if (files.length > 0) {
      const filePath = terminal.resolvePath(files[0]);
      const file = await terminal.getFileSystemItem(filePath);
      if (!file || file.type !== 'file') {
        return `wc: ${files[0]}: No such file or directory`;
      }
      input = file.content || '';
    } else {
      return 'wc: no input provided';
    }

    const lines = input.split('\n').length;
    const words = input.trim() ? input.trim().split(/\s+/).length : 0;
    const chars = input.length;

    const showLines = flags.includes('-l');
    const showWords = flags.includes('-w');
    const showChars = flags.includes('-c');
    const showAll = !showLines && !showWords && !showChars;

    let result = '';
    if (showAll || showLines) result += lines.toString().padStart(8);
    if (showAll || showWords) result += words.toString().padStart(8);
    if (showAll || showChars) result += chars.toString().padStart(8);

    if (files.length > 0) {
      result += ` ${files[0]}`;
    }

    return result.trim();
  }, 'count lines, words, and characters (-l lines, -w words, -c chars)', 'File System');
})();

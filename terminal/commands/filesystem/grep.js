// grep command - search for pattern in files or piped input
(function () {
  'use strict';

  registerCommand('grep', async (terminal, args) => {
    if (args.length === 0) {
      return 'grep: missing pattern';
    }

    const pattern = args[0];
    const flags = args.filter((arg) => arg.startsWith('-'));
    const files = args.filter((arg) => !arg.startsWith('-')).slice(1);

    const caseInsensitive = flags.includes('-i');
    const showLineNumbers = flags.includes('-n');
    const invertMatch = flags.includes('-v');

    let searchText = '';
    let searchFiles = [];

    // Check if we have piped input
    if (terminal.hasStdin && terminal.stdin) {
      searchText = terminal.stdin;
    } else if (files.length > 0) {
      // Search in specified files
      for (const filename of files) {
        const filePath = terminal.resolvePath(filename);
        const file = await terminal.getFileSystemItem(filePath);
        if (file && file.type === 'file') {
          searchFiles.push({ name: filename, content: file.content || '' });
        }
      }
    } else {
      return 'grep: no input provided (use pipes or specify files)';
    }

    const results = [];

    if (searchText) {
      // Search in piped input
      const lines = searchText.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const searchLine = caseInsensitive ? line.toLowerCase() : line;
        const searchPattern = caseInsensitive ? pattern.toLowerCase() : pattern;

        const matches = searchLine.includes(searchPattern);
        if ((matches && !invertMatch) || (!matches && invertMatch)) {
          if (showLineNumbers) {
            results.push(`${i + 1}:${line}`);
          } else {
            results.push(line);
          }
        }
      }
    } else {
      // Search in files
      for (const file of searchFiles) {
        const lines = file.content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const searchLine = caseInsensitive ? line.toLowerCase() : line;
          const searchPattern = caseInsensitive ? pattern.toLowerCase() : pattern;

          const matches = searchLine.includes(searchPattern);
          if ((matches && !invertMatch) || (!matches && invertMatch)) {
            const prefix = searchFiles.length > 1 ? `${file.name}:` : '';
            const lineNum = showLineNumbers ? `${i + 1}:` : '';
            results.push(`${prefix}${lineNum}${line}`);
          }
        }
      }
    }

    return results.length > 0 ? results.join('\n') : '';
  }, 'search for pattern in files or piped input (-i case insensitive, -n line numbers, -v invert)', 'File System');
})();

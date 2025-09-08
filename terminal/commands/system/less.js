// less command - view file contents with paging and search
(function () {
  'use strict';

  registerCommand('less', async (terminal, args) => {
    let filename = '';
    let renderHtml = false;
    let argIndex = 0;

    // Parse flags
    while (argIndex < args.length) {
      const arg = args[argIndex];
      
      if (arg === '--help' || arg === '-h') {
        return `less - view file contents with paging and search

Usage: less [options] <file>

Options:
  --html, -H    Render HTML content instead of escaping it
  -h, --help    Show this help

Navigation:
  j, ↓          Move down one line
  k, ↑          Move up one line  
  Space, f      Move down one page
  b             Move up one page
  g             Go to beginning
  G             Go to end
  /             Start search
  n             Next search result
  N             Previous search result
  q             Quit
  h, ?          Show help in viewer

Examples:
  less file.txt         # View text file
  less --html page.html # Render HTML file
  cat file | less       # View piped content`;
      } else if (arg === '--html' || arg === '-H') {
        renderHtml = true;
        argIndex++;
      } else if (!arg.startsWith('-')) {
        filename = arg;
        argIndex++;
      } else {
        return `less: unknown option '${arg}'. Try 'less --help' for more information.`;
      }
    }

    if (!filename) {
      // Read from stdin if available
      if (terminal.hasStdin) {
        return terminal.showLessViewer(terminal.stdin, '(stdin)', { renderHtml });
      } else {
        return 'less: usage: less [options] <filename> or pipe content to less';
      }
    }

    const filePath = terminal.resolvePath(filename);
    
    try {
      const file = await terminal.getFileSystemItem(filePath);
      if (!file) {
        return `less: ${filename}: No such file or directory`;
      }
      
      if (file.type !== 'file') {
        return `less: ${filename}: Is a directory`;
      }
      
      const content = file.content || '';
      return terminal.showLessViewer(content, filename, { renderHtml });
    } catch (error) {
      return `less: ${filename}: ${error.message}`;
    }
  }, 'view file contents with paging and search (less [--html] <file>)', 'System');
})();

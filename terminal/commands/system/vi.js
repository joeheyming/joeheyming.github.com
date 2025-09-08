// vi command - simple text editor
(function () {
  'use strict';

  registerCommand('vi', async (terminal, args) => {
    if (args.length === 0) {
      return 'vi: usage: vi <filename>';
    }

    if (args[0] === '--help' || args[0] === '-h') {
      return `vi - simple text editor

Usage: vi <filename>

Basic Commands:
  Normal Mode:
    h,j,k,l or arrows - Move cursor
    i               - Enter insert mode
    x               - Delete character
    o               - New line below and insert
    :w              - Save file
    :q              - Quit (if no changes)
    :wq             - Save and quit
    :q!             - Quit without saving
  
  Insert Mode:
    Esc             - Return to normal mode
    Type normally   - Insert text`;
    }

    const filename = args[0];
    const filePath = terminal.resolvePath(filename);
    
    try {
      // Try to read existing file
      let content = '';
      const file = await terminal.getFileSystemItem(filePath);
      if (file && file.type === 'file') {
        content = file.content || '';
      }
      
      return terminal.showViEditor(content, filename, filePath);
    } catch (error) {
      return `vi: ${filename}: ${error.message}`;
    }
  }, 'simple text editor (vi <file>)', 'System');
})();

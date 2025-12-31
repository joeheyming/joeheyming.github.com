// hexdump command - debug file contents showing raw bytes and escape sequences
(function () {
  'use strict';

  registerCommand(
    'hexdump',
    async (terminal, args) => {
      if (args.length === 0) {
        return 'hexdump: missing file operand';
      }

      const filePath = terminal.resolvePath(args[0]);
      const item = await terminal.getFileSystemItem(filePath);

      if (!item) {
        return `hexdump: ${args[0]}: No such file or directory`;
      }

      if (item.type !== 'file') {
        return `hexdump: ${args[0]}: Is a directory`;
      }

      const content = item.content || '';
      let result = `File: ${args[0]} (${content.length} bytes)\n`;
      result += `Raw content: "${content}"\n`;
      result += `Escaped: ${JSON.stringify(content)}\n`;
      result += `Char codes: [${Array.from(content)
        .map((c) => c.charCodeAt(0))
        .join(', ')}]`;

      return result;
    },
    'debug file contents showing raw bytes and escape sequences',
    'File System'
  );
})();

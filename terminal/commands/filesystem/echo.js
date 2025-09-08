// echo command - display text
(function () {
  'use strict';

  registerCommand('echo', async (terminal, args) => {
    if (args.length === 0) {
      return '\n'; // Even empty echo should have newline
    }

    const flags = args.filter((arg) => arg.startsWith('-'));
    const textArgs = args.filter((arg) => !arg.startsWith('-'));

    // -n flag suppresses the trailing newline
    const suppressNewline = flags.includes('-n');

    const text = textArgs.join(' ');
    // Expand environment variables
    const expandedText = terminal.expandVariables(text);
    const result = suppressNewline ? expandedText : expandedText + '\n';

    // Return text with newline unless -n flag is used
    return result;
  }, 'display text (-n to suppress newline, supports $VAR expansion)', 'File System');
})();

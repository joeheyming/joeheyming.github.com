// pwd command - print working directory
(function () {
  'use strict';

  registerCommand('pwd', (terminal, args) => {
    return terminal.currentDirectory;
  }, 'print working directory', 'File System');
})();

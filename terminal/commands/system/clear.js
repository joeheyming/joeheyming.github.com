// clear command - clear terminal
(function () {
  'use strict';

  registerCommand('clear', (terminal, args) => {
    if (terminal.isStandalone) {
      // Standalone mode - clear the output
      const terminalOutput = document.getElementById('terminal-output');
      terminalOutput.innerHTML = '';
    } else {
      // OS-integrated mode - original behavior
      setTimeout(() => {
        const windowElement = document.getElementById(`window-${terminal.windowId}`);
        const terminalContent = windowElement.querySelector('.terminal-content');
        terminalContent.innerHTML = `
          <div class="terminal-line">
            <span class="terminal-prompt">user@heyming-os:${terminal.getShortPath()}$</span> <input type="text" class="terminal-input" placeholder="Type a command...">
          </div>
        `;
        terminal.initialize();
      }, 100);
    }
    return '';
  }, 'clear terminal', 'System');
})();

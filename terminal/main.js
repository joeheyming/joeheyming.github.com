// Terminal module entry point — imports the full stack and boots the OS.
import './lib/shell-core.js';
import './lib/vfs-utils.js';
import './core/memory-manager.js';
import './core/security-manager.js';
import './core/filesystem-manager.js';
import './core/ipc-manager.js';
import './core/process-manager.js';
import './core/device-manager.js';
import './core/scheduler-manager.js';
import './core/kernel.js';
import { commandRegistry } from './commands.js';
import './terminal.js';
import { HeymingOS } from './core/heyming-os.js';

// Expose to classic scripts (filesystem-db.js uses window.commandRegistry)
window.commandRegistry = commandRegistry;

try {
  window.heymingOS = new HeymingOS();
  await window.heymingOS.initialize();
  console.log('Heyming OS is ready!');
} catch (error) {
  console.error('Failed to initialize Heyming OS:', error);

  const terminalOutput = document.getElementById('terminal-output');
  if (terminalOutput) {
    terminalOutput.innerHTML = `
      <div class="terminal-init-error" role="alert">
        <strong class="terminal-init-error-title">System initialization failed</strong>
        <p class="terminal-init-error-line">Cannot start the terminal without the OS layer.</p>
        <p class="terminal-init-error-line">Check the browser console for details.</p>
        <p class="terminal-init-error-line terminal-init-error-hint">Refresh the page to retry.</p>
      </div>
    `;
  }
}

const shareBtn = document.querySelector('share-button');
if (shareBtn) {
  /** @type {*} */ (shareBtn).textGenerator = function () {
    if (window.heymingOS && /** @type {*} */ (window.heymingOS).filesystem) {
      try {
        const cwd = /** @type {*} */ (window.heymingOS).filesystem.getCurrentDirectory();
        if (cwd && cwd !== '/') {
          return "I'm exploring " + cwd + ' in the Heyming OS Web Terminal!';
        }
      } catch (e) {
        /* ignore */
      }
    }
    return 'Check out this interactive Web Terminal with a full file system!';
  };
}

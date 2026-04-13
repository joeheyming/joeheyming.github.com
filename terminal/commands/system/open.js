// Open command - Alias for 'launch' (mimics macOS 'open' behavior)

import { commandRegistry } from '../../commands.js';

async function openHandler(terminal, args) {
  const launchCmd = await commandRegistry.get('launch');
  if (launchCmd) {
    return await launchCmd(terminal, args);
  }
  return {
    stdout: '',
    stderr: 'open: launch command not available',
    exitCode: 1
  };
}

export default {
  name: 'open',
  handler: openHandler,
  description: 'Open files or apps (alias for launch)',
  category: 'System'
};

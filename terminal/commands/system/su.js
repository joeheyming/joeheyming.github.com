// su - switch user

async function suHandler(terminal, args) {
  const sm = terminal.os?.kernel?.securityManager;
  if (!sm) return 'su: security subsystem not available';

  if (args.length === 0 || args[0] === '--help') {
    return 'Usage: su USERNAME\n\nSwitch the active user for this terminal session.\n';
  }

  const targetName = args[0] === '-' ? args[1] || 'root' : args[0];
  const user = sm.getUserByName(targetName);
  if (!user) return `su: user '${targetName}' does not exist`;

  if (user.locked) return `su: user '${targetName}' account is locked`;

  // If target user has a password, prompt for it
  if (user.passwordHash) {
    const password = await new Promise((resolve) => {
      const input =
        document.getElementById('terminal-input') ||
        document.getElementById(`window-${terminal.windowId}`)?.querySelector('.terminal-input');
      const promptEl = document.getElementById('prompt-text');
      if (!(input instanceof HTMLInputElement)) return resolve(null);

      const origType = input.type;
      if (promptEl) promptEl.textContent = `Password for ${targetName}: `;
      input.type = 'password';
      input.value = '';
      input.disabled = false;
      input.focus();

      const handler = (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        input.removeEventListener('keydown', handler);
        const val = input.value;
        input.value = '';
        input.type = origType;
        resolve(val);
      };
      input.addEventListener('keydown', handler);
    });

    if (!(await sm.verifyPassword(password, user.passwordHash))) {
      return 'su: authentication failure';
    }
  }

  terminal.env.USER = user.username;
  terminal.env.HOME = user.home;
  terminal.env.PWD = user.home;
  terminal.currentDirectory = user.home;

  if (terminal.process) {
    terminal.process.env.USER = user.username;
    terminal.process.env.HOME = user.home;
    terminal.process.env.PWD = user.home;
    terminal.process.cwd = user.home;
  }

  // Scaffold home if needed
  if (terminal.fileSystemDB) {
    try {
      await terminal.fileSystemDB.createDirectory(user.home);
    } catch {
      // may already exist
    }
  }

  terminal.syncStandaloneDocumentTitle?.();
  return '';
}

export default {
  name: 'su',
  handler: suHandler,
  description: 'switch user',
  category: 'System'
};

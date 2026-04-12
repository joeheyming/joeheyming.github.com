// passwd - change user password
(function () {
  'use strict';

  registerCommand(
    'passwd',
    async (terminal, args) => {
      const sm = terminal.os?.kernel?.securityManager;
      if (!sm) return 'passwd: security subsystem not available';

      const targetName = args[0] || terminal.env.USER;
      const user = sm.getUserByName(targetName);
      if (!user) return `passwd: user '${targetName}' does not exist`;

      // Use a simple prompt-based approach via the terminal modal
      return new Promise((resolve) => {
        const output =
          document.getElementById('terminal-output') ||
          document
            .getElementById(`window-${terminal.windowId}`)
            ?.querySelector('.terminal-content');
        const input =
          document.getElementById('terminal-input') ||
          document.getElementById(`window-${terminal.windowId}`)?.querySelector('.terminal-input');
        const promptEl = document.getElementById('prompt-text');
        if (!output || !input) return resolve('passwd: terminal not available');

        const origType = input.type;
        const origPlaceholder = input.placeholder;

        const askPassword = (label) => {
          return new Promise((res) => {
            if (promptEl) promptEl.textContent = label;
            input.type = 'password';
            input.value = '';
            input.placeholder = '';
            input.disabled = false;
            input.focus();
            const handler = (e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              input.removeEventListener('keydown', handler);
              const val = input.value;
              input.value = '';
              const echo = document.createElement('div');
              echo.textContent = label;
              output.appendChild(echo);
              res(val);
            };
            input.addEventListener('keydown', handler);
          });
        };

        const run = async () => {
          const newPass = await askPassword(`New password for ${targetName}: `);
          if (!newPass) {
            input.type = origType;
            input.placeholder = origPlaceholder;
            return resolve('passwd: password unchanged (empty)');
          }

          const confirm = await askPassword('Retype new password: ');
          input.type = origType;
          input.placeholder = origPlaceholder;

          if (newPass !== confirm) {
            return resolve('passwd: passwords do not match');
          }

          const hash = sm.hashPassword(newPass);
          sm.modifyUser(user.uid, { passwordHash: hash });
          await sm.syncEtcFiles(terminal.fileSystemDB);
          resolve(`passwd: password updated successfully for ${targetName}`);
        };

        run();
      });
    },
    'change user password',
    'System'
  );
})();

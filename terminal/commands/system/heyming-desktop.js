// heyming-desktop command - Launch Heyming Desktop Environment
(function () {
  'use strict';

  registerCommand(
    'heyming-desktop',
    (terminal, args) => {
      // Check if we're already in the desktop environment
      const isInDesktop = window.self !== window.top;

      if (isInDesktop) {
        return `✅ You are already inside Heyming Desktop Environment!
💡 Try using the 'launch' command to open applications.`;
      }

      // Redirect to desktop
      try {
        window.location.href = '/os/';
        return `🖥️ Launching Heyming Desktop Environment...`;
      } catch (error) {
        return `❌ Failed to launch Heyming Desktop: ${error.message}`;
      }
    },
    'Launch Heyming Desktop Environment',
    'System'
  );
})();

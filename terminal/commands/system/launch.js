// Launch command - Launch applications from terminal
// Only available when running inside the OS (iframe context)

(function () {
  'use strict';

  registerCommand(
    'launch',
    (terminal, args) => {
      // Check if we're running inside the OS (iframe context)
      const isInOS = window.self !== window.top;

      if (!isInOS) {
        return `❌ Launch command is only available when running inside Heyming OS.
💡 To access the OS and use launch functionality:
   1. Use the 'heyming-desktop' command to launch the desktop environment
   2. Click the "🚀 Launch OS" button on the main page
   3. Or visit ${window.location.origin}/#os
   4. Then open Terminal from the OS and use the launch command`;
      }

      // Check if app name was provided
      if (args.length === 0) {
        return `Usage: launch [app-name]

Available applications:
${getAvailableApps()
  .map((app) => `  ${app.id.padEnd(15)} - ${app.description}`)
  .join('\n')}

Examples:
  launch doom        # Launch Doom game
  launch notepad     # Launch text editor
  launch awesome     # Launch Everything is Awesome
  launch farm        # Launch Farm Adventures

💡 Tip: You can also launch apps by clicking desktop icons or using the Apps launcher (🚀)`;
      }

      const appName = args[0].toLowerCase();

      // Get available apps
      const availableApps = getAvailableApps();
      const app = availableApps.find((a) => a.id.toLowerCase() === appName);

      if (!app) {
        const suggestions = availableApps
          .filter(
            (a) =>
              a.id.toLowerCase().includes(appName) || a.shortName.toLowerCase().includes(appName)
          )
          .slice(0, 3);

        let output = `❌ Application "${appName}" not found.

Available applications:
${availableApps.map((app) => `  ${app.id.padEnd(15)} - ${app.description}`).join('\n')}`;

        if (suggestions.length > 0) {
          output += `\n\n💡 Did you mean one of these?
${suggestions.map((s) => `  ${s.id}`).join('\n')}`;
        }

        return output;
      }

      // Send launch message to parent OS
      try {
        window.parent.postMessage(
          {
            type: 'iframe-message',
            message: {
              type: 'launch',
              app: app.id
            }
          },
          '*'
        );

        return `🚀 Launching ${app.name}...`;
      } catch (error) {
        return `❌ Failed to launch ${app.name}: ${error.message}`;
      }
    },
    'Launch applications from the terminal',
    'Apps'
  );

  // Helper function to get available apps
  function getAvailableApps() {
    // Try to get apps from the parent window's app registry
    try {
      if (window.parent && window.parent.AppModule) {
        return window.parent.AppModule.getAllApps();
      }
    } catch (error) {
      // Fallback to a basic list if we can't access parent
    }
    return [];
  }
})();

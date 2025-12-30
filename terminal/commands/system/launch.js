// Launch command - Launch applications or open files from terminal
// Only available when running inside the OS (iframe context)

(function () {
  'use strict';

  registerCommand(
    'launch',
    async (terminal, args) => {
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
        return `Usage: launch [app-name | file-path]

Available applications:
${getAvailableApps()
  .map((app) => `  ${app.id.padEnd(15)} - ${app.description}`)
  .join('\n')}

Examples:
  launch doom              # Launch Doom game
  launch notepad           # Launch text editor
  launch ~/Pictures/cat.jpg  # Open image in Image Viewer
  launch ~/Music/song.mp3    # Open audio in Media Player
  launch ~/readme.txt        # Open text file in Notepad

💡 Tip: You can also launch apps by clicking desktop icons or using the Apps launcher (🚀)`;
      }

      const target = args[0];

      // Check if it looks like a file path
      if (target.includes('/') || target.includes('.')) {
        return await openFile(terminal, target);
      }

      // Otherwise treat as app name
      const appName = target.toLowerCase();

      // Get available apps
      const availableApps = getAvailableApps();
      const app = availableApps.find((a) => a.id.toLowerCase() === appName);

      if (!app) {
        // Maybe it's a file without path - check current directory
        const possibleFile = await checkIfFile(terminal, target);
        if (possibleFile) {
          return await openFile(terminal, possibleFile);
        }

        const suggestions = availableApps
          .filter(
            (a) =>
              a.id.toLowerCase().includes(appName) || a.shortName.toLowerCase().includes(appName)
          )
          .slice(0, 3);

        let output = `❌ Application or file "${appName}" not found.

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
    'Launch applications or open files from the terminal',
    'Apps'
  );

  // Get config from parent OS
  function getConfig() {
    return window.parent?.HeymingOS?.Config || { HOME: '/home/jheyming', USER: 'jheyming' };
  }

  // Get app for MIME type from app registry
  function getAppForMimeType(mimeType) {
    return window.parent?.AppModule?.getAppForMimeType?.(mimeType) || null;
  }

  // Check if a name could be a file in the current directory
  async function checkIfFile(terminal, name) {
    try {
      const fs = await window.FileSystemDB.getInstance();
      const cfg = getConfig();
      const cwd = terminal.currentPath || cfg.HOME;
      const fullPath = `${cwd}/${name}`;
      const item = await fs.getItem(fullPath);
      if (item && item.type === 'file') {
        return fullPath;
      }
    } catch (e) {
      // Not a file
    }
    return null;
  }

  // Open a file with the appropriate application
  async function openFile(terminal, filePath) {
    try {
      const fs = await window.FileSystemDB.getInstance();
      const cfg = getConfig();

      // Resolve path (handle ~, relative paths)
      let resolvedPath = filePath;
      if (filePath.startsWith('~/')) {
        resolvedPath = cfg.HOME + filePath.slice(1);
      } else if (!filePath.startsWith('/')) {
        const cwd = terminal.currentPath || cfg.HOME;
        resolvedPath = `${cwd}/${filePath}`;
      }

      // Normalize path (remove .. and .)
      resolvedPath = normalizePath(resolvedPath);

      // Get file from filesystem
      const item = await fs.getItem(resolvedPath);

      if (!item) {
        return `❌ File not found: ${filePath}`;
      }

      if (item.type === 'directory') {
        return `❌ "${filePath}" is a directory. Use 'cd' to navigate to it.`;
      }

      // Get MIME type and determine app using centralized utility
      const mimeType = window.FileSystemDB.getMimeType(resolvedPath);
      const fileName = resolvedPath.split('/').pop();
      const appInfo = getAppForMimeType(mimeType);

      if (!appInfo) {
        return `❌ No application available to open: ${fileName} (${mimeType})`;
      }

      // Send open file message to OS
      window.parent.postMessage(
        {
          type: 'iframe-message',
          message: {
            type: 'openDesktopFile',
            file: {
              path: resolvedPath,
              content: item.content
            }
          }
        },
        '*'
      );

      return `📂 Opening ${fileName} with ${appInfo.appName}...`;
    } catch (error) {
      return `❌ Failed to open file: ${error.message}`;
    }
  }

  // Normalize a path (resolve . and ..)
  function normalizePath(path) {
    const parts = path.split('/').filter((p) => p && p !== '.');
    const result = [];
    for (const part of parts) {
      if (part === '..') {
        result.pop();
      } else {
        result.push(part);
      }
    }
    return '/' + result.join('/');
  }

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

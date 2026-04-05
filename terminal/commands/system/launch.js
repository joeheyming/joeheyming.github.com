// Launch command - Launch applications or open files from terminal
// Only available when running inside the OS (iframe context)

(function () {
  'use strict';

  registerCommand(
    'launch',
    async (terminal, args) => {
      const isInOS = window.self !== window.top;

      if (!isInOS) {
        return {
          stdout: '',
          stderr: `launch: Heyming OS is required for this command
To use launch:
   1. Use the 'heyming-desktop' command to launch the desktop environment
   2. Click the "🚀 Launch OS" button on the main page
   3. Or visit ${window.location.origin}/os/
   4. Then open Terminal from the OS and use the launch command`,
          exitCode: 1
        };
      }

      if (args.length === 0) {
        const usageBody = `Usage: launch [app-name | file-path]

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

Tip: You can also launch apps from desktop icons or the Apps launcher (🚀)`;
        return {
          stdout: usageBody,
          stderr: 'launch: missing operand',
          exitCode: 1
        };
      }

      const target = args[0];

      if (target.includes('/') || target.includes('.')) {
        return await openFile(terminal, target);
      }

      const appName = target.toLowerCase();
      const availableApps = getAvailableApps();
      const app = availableApps.find((a) => a.id.toLowerCase() === appName);

      if (!app) {
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

        let output = `Application or file "${appName}" not found.

Available applications:
${availableApps.map((app) => `  ${app.id.padEnd(15)} - ${app.description}`).join('\n')}`;

        if (suggestions.length > 0) {
          output += `\n\nDid you mean one of these?
${suggestions.map((s) => `  ${s.id}`).join('\n')}`;
        }

        return { stdout: output, stderr: '', exitCode: 1 };
      }

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

        return { stdout: `🚀 Launching ${app.name}...`, stderr: '', exitCode: 0 };
      } catch (error) {
        return {
          stdout: '',
          stderr: `launch: ${app.name}: ${error.message}`,
          exitCode: 1
        };
      }
    },
    'Launch applications or open files from the terminal',
    'Apps'
  );

  function getConfig() {
    return window.parent?.HeymingOS?.Config || { HOME: '/home/jheyming', USER: 'jheyming' };
  }

  function getAppForMimeType(mimeType) {
    return window.parent?.AppModule?.getAppForMimeType?.(mimeType) || null;
  }

  async function checkIfFile(terminal, name) {
    try {
      const fs = await window.FileSystemDB.getInstance();
      const cfg = getConfig();
      const cwd = terminal.currentDirectory || cfg.HOME;
      const fullPath = ShellUtils.resolveVirtualPath(name, cwd);
      const item = await fs.getItem(fullPath);
      if (item && item.type === 'file') {
        return fullPath;
      }
    } catch (e) {
      // Not a file
    }
    return null;
  }

  async function openFile(terminal, filePath) {
    try {
      const fs = await window.FileSystemDB.getInstance();
      const cfg = getConfig();

      let logical = filePath;
      if (filePath.startsWith('~/')) {
        logical = cfg.HOME + filePath.slice(1);
      }
      const cwd = terminal.currentDirectory || cfg.HOME;
      const resolvedPath = ShellUtils.resolveVirtualPath(logical, cwd);

      const item = await fs.getItem(resolvedPath);

      if (!item) {
        return {
          stdout: '',
          stderr: `launch: ${filePath}: No such file or directory`,
          exitCode: 1
        };
      }

      if (item.type === 'directory') {
        return {
          stdout: '',
          stderr: `launch: ${filePath}: Is a directory`,
          exitCode: 1
        };
      }

      const mimeType = window.FileSystemDB.mimeTypeForOpen(item);
      const fileName = resolvedPath.split('/').pop();
      const appInfo = getAppForMimeType(mimeType);

      if (!appInfo) {
        return {
          stdout: '',
          stderr: `launch: no application to open ${fileName} (${mimeType})`,
          exitCode: 1
        };
      }

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

      return {
        stdout: `📂 Opening ${fileName} with ${appInfo.appName}...`,
        stderr: '',
        exitCode: 0
      };
    } catch (error) {
      return {
        stdout: '',
        stderr: `launch: ${error.message}`,
        exitCode: 1
      };
    }
  }

  function getAvailableApps() {
    try {
      if (window.parent && window.parent.AppModule) {
        return window.parent.AppModule.getAllApps();
      }
    } catch (error) {
      // Fallback
    }
    return [];
  }
})();

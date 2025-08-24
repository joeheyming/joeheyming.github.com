// OS-Level functionality for HEYMING-OS Desktop Environment

// Desktop state management
let isDesktopExpanded = false;
let isAppMinimized = false;

// System stats and time functions
function updateSystemStats() {
  document.getElementById('active-windows').textContent = `Windows: ${activeWindows.length}`;
  document.getElementById('cpu-load').textContent = (0.5 + Math.random() * 2).toFixed(1);
  document.getElementById('mem-usage').textContent = (2.1 + Math.random() * 4).toFixed(1) + 'GB';
}

function updateDesktopTime() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  document.getElementById('desktop-time').textContent = timeStr;
}

// Desktop Expansion Control Functions
function toggleFullscreen() {
  if (!isDesktopExpanded) {
    expandDesktop();
  } else {
    contractDesktop();
  }
}

function expandDesktop() {
  isDesktopExpanded = true;

  // Hide other page content
  const sectionsToHide = document.querySelectorAll('.max-w-6xl > *:not(#desktop-os)');
  const footer = document.querySelector('footer');
  const easterEggBtn = document.querySelector('.fixed.bottom-6.right-6');

  sectionsToHide.forEach((section) => {
    section.style.transition = 'opacity 0.3s ease-out';
    section.style.opacity = '0';
    setTimeout(() => {
      section.style.display = 'none';
    }, 300);
  });

  if (footer) {
    footer.style.transition = 'opacity 0.3s ease-out';
    footer.style.opacity = '0';
    setTimeout(() => {
      footer.style.display = 'none';
    }, 300);
  }

  if (easterEggBtn) {
    easterEggBtn.style.transition = 'opacity 0.3s ease-out';
    easterEggBtn.style.opacity = '0';
    setTimeout(() => {
      easterEggBtn.style.display = 'none';
    }, 300);
  }

  // Expand desktop OS to full viewport
  setTimeout(() => {
    const desktopOS = document.getElementById('desktop-os');
    const container = document.querySelector('.max-w-6xl');

    desktopOS.style.position = 'fixed';
    desktopOS.style.top = '0';
    desktopOS.style.left = '0';
    desktopOS.style.width = '100vw';
    desktopOS.style.height = '100vh';
    desktopOS.style.borderRadius = '0';
    desktopOS.style.zIndex = '9999';

    container.style.maxWidth = 'none';
    container.style.padding = '0';
  }, 350);

  updateFullscreenButton(true);
  setTimeout(() => {
    showMessage('🖥️ Desktop expanded! Press ESC to close windows or minimize to return.');
  }, 400);
}

function contractDesktop() {
  isDesktopExpanded = false;

  // Restore desktop OS to normal size
  const desktopOS = document.getElementById('desktop-os');
  const container = document.querySelector('.max-w-6xl');

  desktopOS.style.position = 'relative';
  desktopOS.style.top = 'auto';
  desktopOS.style.left = 'auto';
  desktopOS.style.width = 'auto';
  desktopOS.style.height = '800px';
  desktopOS.style.borderRadius = '1.5rem';
  desktopOS.style.zIndex = 'auto';

  container.style.maxWidth = '72rem';
  container.style.padding = '0 1rem';

  // Show other page content
  setTimeout(() => {
    const sectionsToShow = document.querySelectorAll('.max-w-6xl > *:not(#desktop-os)');
    const footer = document.querySelector('footer');
    const easterEggBtn = document.querySelector('.fixed.bottom-6.right-6');

    sectionsToShow.forEach((section) => {
      section.style.display = '';
      setTimeout(() => {
        section.style.opacity = '1';
      }, 50);
    });

    if (footer) {
      footer.style.display = '';
      setTimeout(() => {
        footer.style.opacity = '1';
      }, 50);
    }

    if (easterEggBtn) {
      easterEggBtn.style.display = '';
      setTimeout(() => {
        easterEggBtn.style.opacity = '1';
      }, 50);
    }
  }, 200);

  updateFullscreenButton(false);
  showMessage('🪟 Desktop restored to normal view.');
}

function updateFullscreenButton(isExpanded) {
  const btn = document.getElementById('fullscreen-btn');
  if (isExpanded) {
    btn.innerHTML = '🪟 Minimize';
    btn.title = 'Minimize Desktop (ESC)';
  } else {
    btn.innerHTML = '📺 Expand';
    btn.title = 'Expand Desktop (F11)';
  }
}

function closeBrowser() {
  // Simulate browser close with a fun message
  showMessage("🚪 Attempting to close browser... (Just kidding! You're stuck with me! 😈)");

  // Add some dramatic effect
  document.body.style.transition = 'opacity 0.5s ease-out';
  document.body.style.opacity = '0.3';
  setTimeout(() => {
    document.body.style.opacity = '1';
    showMessage('💡 Tip: Use Ctrl+W or Cmd+W to actually close this tab!');
  }, 1000);
}

// App minimization functions
function minimizeBrowser() {
  if (isDesktopExpanded) {
    // Fancy minimize animation to taskbar
    minimizeToTaskbar();
  } else {
    // Minimize entire app to bottom tab
    minimizeToTab();
  }
}

function minimizeToTab() {
  if (isAppMinimized) return; // Already minimized

  isAppMinimized = true;
  const mainContent = document.getElementById('main-content');
  const footer = document.getElementById('main-footer');
  const easterEgg = document.querySelector('.fixed.bottom-6.right-6');
  const tabBar = document.getElementById('minimized-tab-bar');

  // Show the tab bar first
  tabBar.classList.remove('hidden');

  // Animate main content shrinking and moving to bottom
  mainContent.style.transition = 'all 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
  mainContent.style.transform = 'scale(0.1) translateY(calc(100vh - 200px))';
  mainContent.style.opacity = '0.3';
  mainContent.style.transformOrigin = 'center bottom';

  // Hide footer and easter egg
  if (footer) {
    footer.style.transition = 'opacity 0.2s ease-out';
    footer.style.opacity = '0';
    setTimeout(() => {
      footer.style.display = 'none';
    }, 200);
  }

  if (easterEgg) {
    easterEgg.style.transition = 'opacity 0.2s ease-out';
    easterEgg.style.opacity = '0';
    setTimeout(() => {
      easterEgg.style.display = 'none';
    }, 200);
  }

  // Add pulsing effect to tab
  setTimeout(() => {
    const tab = document.getElementById('minimized-app-tab');
    tab.classList.add('animate-pulse');
    showMessage('📦 App minimized to tab! Click the tab at the bottom to restore.');

    // Stop pulsing after 3 seconds
    setTimeout(() => {
      tab.classList.remove('animate-pulse');
    }, 3000);
  }, 400);
}

function restoreFromTab() {
  if (!isAppMinimized) return; // Not minimized

  isAppMinimized = false;
  const mainContent = document.getElementById('main-content');
  const footer = document.getElementById('main-footer');
  const easterEgg = document.querySelector('.fixed.bottom-6.right-6');
  const tabBar = document.getElementById('minimized-tab-bar');

  // Animate content restoring to normal
  mainContent.style.transition = 'all 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
  mainContent.style.transform = 'scale(1) translateY(0)';
  mainContent.style.opacity = '1';

  // Restore footer and easter egg
  if (footer) {
    footer.style.display = '';
    setTimeout(() => {
      footer.style.transition = 'opacity 0.3s ease-in';
      footer.style.opacity = '1';
    }, 200);
  }

  if (easterEgg) {
    easterEgg.style.display = '';
    setTimeout(() => {
      easterEgg.style.transition = 'opacity 0.3s ease-in';
      easterEgg.style.opacity = '1';
    }, 200);
  }

  // Hide tab bar after animation completes
  setTimeout(() => {
    tabBar.classList.add('hidden');

    // Clean up styles
    mainContent.style.transition = '';
    mainContent.style.transform = '';
    mainContent.style.opacity = '';
    mainContent.style.transformOrigin = '';

    if (footer) {
      footer.style.transition = '';
    }
    if (easterEgg) {
      easterEgg.style.transition = '';
    }

    showMessage('🖥️ App restored from tab!');
  }, 500);
}

function minimizeToTaskbar() {
  // Placeholder for taskbar minimization in expanded mode
  showMessage('📋 Minimized to taskbar (expanded mode feature coming soon!)');
}

// Global keyboard handling for OS functions
function initOSKeyboardHandlers() {
  document.addEventListener('keydown', (e) => {
    // F11 for desktop expansion toggle
    if (e.key === 'F11') {
      e.preventDefault();
      toggleFullscreen();
    }

    // ESC to close active window, minimize desktop, or hide messages
    if (e.key === 'Escape') {
      // First priority: close currently focused window/iframe if any
      const focusedWindow = getCurrentlyFocusedWindow();
      if (focusedWindow) {
        closeWindow(focusedWindow);
        return;
      }

      // Second priority: contract desktop if expanded
      if (isDesktopExpanded) {
        contractDesktop();
      } else {
        // Last priority: hide messages
        hideMessage();
      }
    }

    // Alt+F4 for fun (simulate close)
    if (e.altKey && e.key === 'F4') {
      e.preventDefault();
      closeBrowser();
    }
  });
}

// Initialize OS-level functionality
function initOS() {
  // Initialize keyboard handlers
  initOSKeyboardHandlers();

  // Start system monitoring
  setInterval(updateSystemStats, 5000);
  updateDesktopTime();
  setInterval(updateDesktopTime, 1000);
}

// Utility functions for state access
function getAppMinimizedState() {
  return isAppMinimized;
}

function getDesktopExpandedState() {
  return isDesktopExpanded;
}

// Terminal Command System
let commandHistory = [];
let historyIndex = -1;
let messageTimeout;

function executeCommand(command) {
  const args = command.trim().split(' ');
  const cmd = args[0].toLowerCase();
  const params = args.slice(1);

  // Add to history
  if (command.trim()) {
    commandHistory.push(command);
    historyIndex = commandHistory.length;
  }

  switch (cmd) {
    case 'help':
    case 'man':
      showHelp();
      break;
    case 'ls':
    case 'list':
      listApps();
      break;
    case 'open':
    case 'launch':
      if (params.length > 0) {
        const appName = params[0].toLowerCase();
        if (namespace_window.getAvailableApps()[appName]) {
          namespace_window.openApp(appName);
          showMessage(`🚀 Launching ${namespace_window.getAvailableApps()[appName].name}...`);
        } else {
          showMessage(`❌ App '${params[0]}' not found. Type 'ls' to see available apps.`);
        }
      } else {
        showMessage(`❌ Usage: open <app_name>`);
      }
      break;
    case 'ps':
    case 'windows':
      showActiveWindows();
      break;
    case 'kill':
    case 'close':
      if (params.length > 0) {
        const windowToClose = namespace_window
          .getActiveWindows()
          .find((w) => w.includes(params[0]));
        if (windowToClose) {
          namespace_window.closeWindow(windowToClose);
          showMessage(`🗙 Closed window: ${params[0]}`);
        } else {
          showMessage(`❌ No window found matching: ${params[0]}`);
        }
      } else {
        showMessage(`❌ Usage: kill <window_id>`);
      }
      break;
    case 'clear':
    case 'cls':
      // Clear any status messages
      hideMessage();
      break;
    case 'whoami':
      showMessage(`🦄 Joe Heyming - Principal UI Engineer & Digital Wizard`);
      break;
    case 'pwd':
      showMessage(`📁 /home/joe/playground`);
      break;
    case 'date':
      showMessage(`📅 ${new Date().toLocaleString()}`);
      break;
    case 'fortune':
    case 'quote': {
      const fortunes = [
        "🚀 'Lots of hard work.' - Joe's LinkedIn Philosophy",
        '💻 Code is poetry written in the language of logic',
        '🦄 Every bug is just a feature waiting to be discovered',
        "☁️ Why don't you take it to the cloud?",
        '🎮 Building amazing user experiences, one pixel at a time',
        '🎯 Patent holder and master of RF visualization'
      ];
      showMessage(fortunes[Math.floor(Math.random() * fortunes.length)]);
      break;
    }
    case 'fullscreen':
    case 'fs':
      toggleFullscreen();
      break;
    case 'minimize':
    case 'min':
      minimizeBrowser();
      break;
    case 'restore':
      if (getAppMinimizedState()) {
        restoreFromTab();
        showMessage('🖥️ App restored from tab!');
      } else {
        showMessage('💡 App is not currently minimized.');
      }
      break;
    case 'shadowbox':
    case 'operation':
      showMessage(`🕵️ Initiating Operation: SHADOWBOX... Classified surveillance mode activated.`);
      namespace_window.openApp('shadowbox');
      break;
    case 'exit':
    case 'quit':
      showMessage(`👋 Thanks for visiting! But you can't escape the terminal that easily... 😈`);
      break;
    case '':
      // Empty command, do nothing
      break;
    default:
      showMessage(`❌ Command not found: ${cmd}. Type 'help' for available commands.`);
  }
}

function showHelp() {
  const template = document.getElementById('help-content-template');
  const helpContent = template.content.cloneNode(true);

  showMessage({ template: true, content: helpContent }, true);
}

function listApps() {
  const template = document.getElementById('app-list-template');
  const appListContent = template.content.cloneNode(true);
  const entriesContainer = appListContent.querySelector('.app-entries');

  const entryTemplate = document.getElementById('app-entry-template');

  Object.entries(namespace_window.getAvailableApps()).forEach(([key, app]) => {
    const entryContent = entryTemplate.content.cloneNode(true);
    entryContent.querySelector('.app-name').textContent = key;
    entryContent.querySelector('.app-title').textContent = app.name;
    entryContent.querySelector('.app-description').textContent = app.description;
    entriesContainer.appendChild(entryContent);
  });

  showMessage({ template: true, content: appListContent }, true);
}

function showActiveWindows() {
  if (namespace_window.getActiveWindows().length === 0) {
    showMessage('📋 No active windows');
  } else {
    const template = document.getElementById('window-list-template');
    const windowListContent = template.content.cloneNode(true);
    const entriesContainer = windowListContent.querySelector('.window-entries');

    const entryTemplate = document.getElementById('window-entry-template');

    namespace_window.getActiveWindows().forEach((windowId, index) => {
      const appName = windowId.replace('window-', '').split('-')[0];
      const entryContent = entryTemplate.content.cloneNode(true);
      entryContent.querySelector('.window-number').textContent = index + 1;
      entryContent.querySelector('.window-id').textContent = windowId;
      entryContent.querySelector('.window-app').textContent = appName;
      entriesContainer.appendChild(entryContent);
    });

    showMessage({ template: true, content: windowListContent }, true);
  }
}

function showMessage(message, useTemplate = false) {
  let messageDiv = document.getElementById('terminal-message');
  if (!messageDiv) {
    // Clone the template
    const template = document.getElementById('terminal-message-template');
    const templateClone = template.content.cloneNode(true);
    messageDiv = templateClone.querySelector('div');
    messageDiv.id = 'terminal-message';
    document.getElementById('desktop').appendChild(messageDiv);
  }

  const contentDiv = messageDiv.querySelector('.message-content');

  if (useTemplate && typeof message === 'object' && message.template) {
    // Clear existing content and append template content
    contentDiv.innerHTML = '';
    contentDiv.appendChild(message.content);
  } else {
    // Simple text message
    contentDiv.textContent = message;
  }

  messageDiv.style.display = 'block';

  // Auto-hide after 10 seconds for non-help messages
  clearTimeout(messageTimeout);
  if (!useTemplate && !message.includes('help')) {
    messageTimeout = setTimeout(hideMessage, 10000);
  }
}

function hideMessage() {
  const messageDiv = document.getElementById('terminal-message');
  if (messageDiv) {
    messageDiv.style.display = 'none';
  }
}

function setupTerminal() {
  const terminalInput = document.getElementById('terminal-input');

  // Focus input by default without scrolling to prevent page jump
  terminalInput.focus({ preventScroll: true });

  // Handle command execution
  terminalInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const command = terminalInput.value;
      executeCommand(command);
      terminalInput.value = '';
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (commandHistory.length > 0) {
        if (historyIndex > 0) {
          historyIndex--;
        }
        terminalInput.value = commandHistory[historyIndex] || '';
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (commandHistory.length > 0) {
        if (historyIndex < commandHistory.length - 1) {
          historyIndex++;
          terminalInput.value = commandHistory[historyIndex] || '';
        } else {
          historyIndex = commandHistory.length;
          terminalInput.value = '';
        }
      }
    } else if (e.key === 'Tab') {
      e.preventDefault();
      // Auto-complete functionality
      const partial = terminalInput.value.toLowerCase();
      const commands = [
        'help',
        'ls',
        'list',
        'open',
        'launch',
        'ps',
        'windows',
        'kill',
        'close',
        'clear',
        'cls',
        'whoami',
        'pwd',
        'date',
        'fortune',
        'quote',
        'shadowbox',
        'operation',
        'fullscreen',
        'fs',
        'minimize',
        'min',
        'restore',
        'exit',
        'quit'
      ];

      // Try to complete command
      const matchingCommands = commands.filter((cmd) => cmd.startsWith(partial));
      const matchingApps = Object.keys(namespace_window.getAvailableApps()).filter((app) =>
        app.startsWith(partial.replace('open ', ''))
      );

      if (partial.startsWith('open ') && matchingApps.length === 1) {
        terminalInput.value = 'open ' + matchingApps[0];
      } else if (matchingCommands.length === 1) {
        terminalInput.value = matchingCommands[0];
      }
    } else if (e.key === 'Escape') {
      hideMessage();
    }
  });

  // Keep terminal focused when clicking on desktop
  document.getElementById('desktop').addEventListener('click', (e) => {
    if (
      e.target === document.getElementById('desktop') ||
      e.target.className.includes('desktop-pattern')
    ) {
      terminalInput.focus();
    }
  });

  // Show welcome message
  setTimeout(() => {
    showMessage(`🦄 Welcome to HEYMING-OS! Type 'help' to get started.`);
  }, 1000);
}

// Create the OS namespace
const namespace_os = {
  // Desktop functions
  toggleFullscreen,
  expandDesktop,
  contractDesktop,
  closeBrowser,
  minimizeBrowser,
  restoreFromTab,
  updateSystemStats,
  updateDesktopTime,
  initOS,
  getAppMinimizedState,
  getDesktopExpandedState,

  // Terminal functions
  executeCommand,
  showMessage,
  hideMessage,
  showHelp,
  listApps,
  showActiveWindows,
  setupTerminal
};

// Make the namespace globally available
window.namespace_os = namespace_os;

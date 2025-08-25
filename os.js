// Heyming OS - A Fake Operating System
class HeymingOS {
  constructor() {
    this.isVisible = false;
    this.windows = [];
    this.nextWindowId = 1;
    this.activeWindow = null;
    this.launcherVisible = false;

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.init());
    } else {
      this.init();
    }
  }

  init() {
    this.bindEvents();
    this.createDesktopIcons();
    this.loadAppsFromRegistry();
  }

  loadAppsFromRegistry() {
    // Wait for AppModule to be available
    if (typeof window.AppModule === 'undefined') {
      setTimeout(() => this.loadAppsFromRegistry(), 100);
      return;
    }
    this.availableApps = window.AppModule.getAllApps();
    this.updateAppLauncher();
  }

  bindEvents() {
    // OS Shutdown button
    const shutdownBtn = document.getElementById('os-close');
    if (shutdownBtn) {
      shutdownBtn.addEventListener('click', () => this.showShutdownDialog());
    }

    // Shutdown dialog handlers
    const shutdownCancel = document.getElementById('shutdown-cancel');
    const shutdownConfirm = document.getElementById('shutdown-confirm');
    const shutdownDialog = document.getElementById('shutdown-dialog');

    if (shutdownCancel) {
      shutdownCancel.addEventListener('click', () => this.hideShutdownDialog());
    }

    if (shutdownConfirm) {
      shutdownConfirm.addEventListener('click', () => this.confirmShutdown());
    }

    // Click outside dialog to cancel
    if (shutdownDialog) {
      shutdownDialog.addEventListener('click', (e) => {
        if (e.target === shutdownDialog) {
          this.hideShutdownDialog();
        }
      });
    }

    // App launcher
    const appLauncher = document.getElementById('app-launcher');
    if (appLauncher) {
      appLauncher.addEventListener('click', () => this.toggleLauncher());
    }

    // App launcher items
    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('app-item')) {
        const appName = e.target.getAttribute('data-app');
        this.launchApp(appName);
        this.hideLauncher();
      }
    });

    // Hide launcher when clicking outside
    document.addEventListener('click', (e) => {
      const launcher = document.getElementById('app-launcher');
      const menu = document.getElementById('app-launcher-menu');
      if (this.launcherVisible && !launcher.contains(e.target) && !menu.contains(e.target)) {
        this.hideLauncher();
      }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (this.launcherVisible) {
          this.hideLauncher();
        } else if (this.isVisible) {
          this.hide();
        }
      }

      // Start/Cmd key to toggle app launcher (only when OS is visible)
      if (e.key === 'Meta' && this.isVisible) {
        e.preventDefault(); // Prevent default system behavior
        this.toggleLauncher();
      }

      // Shutdown dialog keyboard shortcuts
      if (this.isShutdownDialogVisible()) {
        if (e.key === 'Escape') {
          e.preventDefault();
          this.hideShutdownDialog();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          this.confirmShutdown();
        }
      }
    });

    // Desktop double-click to hide launcher
    const desktop = document.getElementById('os-desktop');
    if (desktop) {
      desktop.addEventListener('dblclick', (e) => {
        if (e.target === desktop && this.launcherVisible) {
          this.hideLauncher();
        }
      });
    }
  }

  show() {
    const osElement = document.getElementById('heyming-os');
    if (osElement) {
      osElement.classList.remove('hidden');
      osElement.classList.add('os-fade-in');
      this.isVisible = true;

      // Prevent scrolling on main page
      document.body.style.overflow = 'hidden';

      // Show welcome notification
      setTimeout(() => {
        this.showNotification('Welcome to Heyming OS v1.0! 🚀', 'system');
      }, 500);
    }
  }

  hide() {
    const osElement = document.getElementById('heyming-os');
    if (osElement) {
      osElement.classList.add('os-fade-out');
      setTimeout(() => {
        osElement.classList.add('hidden');
        osElement.classList.remove('os-fade-in', 'os-fade-out');
        this.isVisible = false;

        // Restore scrolling on main page
        document.body.style.overflow = '';

        // Close all windows
        this.windows.forEach((window) => {
          this.closeWindow(window.id);
        });
      }, 300);
    }
  }

  toggle() {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }

  showShutdownDialog() {
    const dialog = document.getElementById('shutdown-dialog');
    if (dialog) {
      dialog.classList.remove('hidden');
      // Add a slight delay for animation
      setTimeout(() => {
        dialog.style.animation = 'fadeIn 0.2s ease-out';
      }, 10);
    }
  }

  hideShutdownDialog() {
    const dialog = document.getElementById('shutdown-dialog');
    if (dialog) {
      dialog.style.animation = 'fadeOut 0.2s ease-in';
      setTimeout(() => {
        dialog.classList.add('hidden');
        dialog.style.animation = '';
      }, 200);
    }
  }

  confirmShutdown() {
    this.hideShutdownDialog();
    // Add shutdown animation/effect
    this.showNotification('Shutting down Heyming OS...', 'system');
    setTimeout(() => {
      this.hide();
    }, 1000);
  }

  isShutdownDialogVisible() {
    const dialog = document.getElementById('shutdown-dialog');
    return dialog && !dialog.classList.contains('hidden');
  }

  toggleLauncher() {
    if (this.launcherVisible) {
      this.hideLauncher();
    } else {
      this.showLauncher();
    }
  }

  showLauncher() {
    const menu = document.getElementById('app-launcher-menu');
    if (menu) {
      // Remove hide class and show the menu
      menu.classList.remove('hidden', 'hide');
      menu.classList.add('show');
      this.launcherVisible = true;

      // Add staggered animation to app items
      this.animateAppItems();
    }
  }

  hideLauncher() {
    const menu = document.getElementById('app-launcher-menu');
    if (menu) {
      // Start hide animation
      menu.classList.remove('show');
      menu.classList.add('hide');
      this.launcherVisible = false;

      // Hide menu after animation completes
      setTimeout(() => {
        if (!this.launcherVisible) {
          menu.classList.add('hidden');
          menu.classList.remove('hide');
          this.resetAppItemsAnimation();
        }
      }, 300);
    }
  }

  animateAppItems() {
    const menu = document.getElementById('app-launcher-menu');
    if (menu) {
      const appItems = menu.querySelectorAll('.app-item');
      appItems.forEach((item, index) => {
        item.style.setProperty('--item-index', index.toString());
        item.classList.remove('animated');
        // Trigger reflow to restart animation
        void item.offsetWidth;
        item.classList.add('animated');
      });
    }
  }

  resetAppItemsAnimation() {
    const menu = document.getElementById('app-launcher-menu');
    if (menu) {
      const appItems = menu.querySelectorAll('.app-item');
      appItems.forEach((item) => {
        item.classList.remove('animated');
        item.style.removeProperty('--item-index');
      });
    }
  }

  launchApp(appName) {
    // Handle built-in system apps
    switch (appName) {
      case 'terminal':
        this.createTerminalWindow();
        return;
      case 'calculator':
        this.createCalculatorWindow();
        return;
      case 'notepad':
        this.createNotepadWindow();
        return;
    }

    // Handle apps from registry
    if (this.availableApps) {
      const app = this.availableApps.find((a) => a.id === appName);
      if (app) {
        this.createIframeWindow(app);
        return;
      }
    }

    this.showNotification(`App "${appName}" not found`, 'error');
  }

  createIframeWindow(app) {
    const content = `
      <div class="iframe-content">
        <iframe 
          src="${app.path}" 
          style="width: 100%; height: 100%; border: none; margin: 0; padding: 0; display: block;"
          title="${app.name}"
          allow="autoplay; microphone; camera; midi; encrypted-media; fullscreen"
        ></iframe>
      </div>
    `;

    // Use app's default dimensions if specified, otherwise use fallback dimensions
    const width = app.defaultWidth || 900;
    const height = app.defaultHeight || 700;

    const window = this.createWindow(app.name, content, width, height);
    window.appId = app.id;
    return window;
  }

  updateAppLauncher() {
    const launcherMenu = document.getElementById('app-launcher-menu');
    if (!launcherMenu || !this.availableApps) return;

    const appsContainer = launcherMenu.querySelector('.space-y-2');
    if (!appsContainer) return;

    // Clear existing apps (except system apps)
    appsContainer.innerHTML = '';

    // Add system apps first
    const systemApps = [
      { id: 'terminal', name: '💻 Terminal' },
      { id: 'calculator', name: '🔢 Calculator' },
      { id: 'notepad', name: '📝 Notepad' }
    ];

    systemApps.forEach((sysApp) => {
      const button = document.createElement('button');
      button.className =
        'app-item w-full text-left px-3 py-2 text-white hover:bg-gray-700 rounded transition-colors duration-200';
      button.setAttribute('data-app', sysApp.id);
      button.textContent = sysApp.name;
      appsContainer.appendChild(button);
    });

    // Add separator
    const separator = document.createElement('div');
    separator.className = 'border-t border-gray-600 my-2';
    appsContainer.appendChild(separator);

    // Group apps by category
    const categories = {};
    this.availableApps.forEach((app) => {
      if (!categories[app.category]) {
        categories[app.category] = [];
      }
      categories[app.category].push(app);
    });

    // Sort apps within each category by name
    Object.keys(categories).forEach((category) => {
      categories[category].sort((a, b) => a.shortName.localeCompare(b.shortName));
    });

    // Define consistent category order
    const categoryOrder = ['game', 'utility', 'entertainment'];

    // Add categorized apps in defined order
    categoryOrder.forEach((category) => {
      if (!categories[category]) return;
      // Add category header
      const categoryHeader = document.createElement('div');
      categoryHeader.className =
        'text-gray-400 text-xs font-bold uppercase tracking-wide px-3 py-1 mt-3 mb-1';
      categoryHeader.textContent = this.getCategoryName(category);
      appsContainer.appendChild(categoryHeader);

      // Add apps in this category
      categories[category].forEach((app) => {
        const button = document.createElement('button');
        button.className =
          'app-item w-full text-left px-3 py-2 text-white hover:bg-gray-700 rounded transition-colors duration-200';
        button.setAttribute('data-app', app.id);
        button.innerHTML = `${app.icon} ${app.shortName}`;
        appsContainer.appendChild(button);
      });
    });

    // If launcher is visible, re-animate the items
    if (this.launcherVisible) {
      setTimeout(() => this.animateAppItems(), 50);
    }
  }

  getCategoryName(category) {
    const categories = {
      game: '🎮 Games',
      utility: '🛠️ Utilities',
      entertainment: '🎪 Entertainment'
    };
    return categories[category] || category;
  }

  createWindow(title, content, width = 600, height = 400) {
    const windowId = this.nextWindowId++;
    const windowsContainer = document.getElementById('os-windows');

    const windowElement = document.createElement('div');
    windowElement.className = 'os-window active';
    windowElement.id = `window-${windowId}`;
    windowElement.style.width = width + 'px';
    windowElement.style.height = height + 'px';
    windowElement.style.left = 50 + this.windows.length * 30 + 'px';
    windowElement.style.top = 50 + this.windows.length * 30 + 'px';

    windowElement.innerHTML = `
      <div class="os-window-titlebar" data-window-id="${windowId}">
        <span class="app-icon">${this.getAppIcon(title)}</span>
        <span class="os-window-title">${title}</span>
        <div class="os-window-controls">
          <button class="os-window-control minimize" data-action="minimize" data-window-id="${windowId}">−</button>
          <button class="os-window-control maximize" data-action="maximize" data-window-id="${windowId}">□</button>
          <button class="os-window-control close" data-action="close" data-window-id="${windowId}">×</button>
        </div>
      </div>
      <div class="os-window-content">
        ${content}
      </div>
      ${this.createResizeHandles()}
    `;

    windowsContainer.appendChild(windowElement);

    const window = {
      id: windowId,
      element: windowElement,
      title: title,
      minimized: false,
      maximized: false,
      originalBounds: null
    };

    this.windows.push(window);
    this.makeWindowActive(windowId);
    this.bindWindowEvents(windowElement, windowId);
    this.createTaskbarButton(windowId, title);

    return window;
  }

  getAppIcon(title) {
    // System apps
    const systemIcons = {
      Terminal: '💻',
      Calculator: '🔢',
      Notepad: '📝'
    };

    // Check system apps first
    if (systemIcons[title]) {
      return systemIcons[title];
    }

    // Check registry apps
    if (this.availableApps) {
      const app = this.availableApps.find((a) => a.name === title);
      if (app) {
        return app.icon;
      }
    }

    return '📱';
  }

  createResizeHandles() {
    return `
      <div class="resize-handle n"></div>
      <div class="resize-handle s"></div>
      <div class="resize-handle e"></div>
      <div class="resize-handle w"></div>
      <div class="resize-handle ne"></div>
      <div class="resize-handle nw"></div>
      <div class="resize-handle se"></div>
      <div class="resize-handle sw"></div>
      <div class="window-drag-handle"></div>
    `;
  }

  bindWindowEvents(windowElement, windowId) {
    // Window controls
    windowElement.addEventListener('click', (e) => {
      if (e.target.classList.contains('os-window-control')) {
        const action = e.target.getAttribute('data-action');
        switch (action) {
          case 'minimize':
            this.minimizeWindow(windowId);
            break;
          case 'maximize':
            this.maximizeWindow(windowId);
            break;
          case 'close':
            this.closeWindow(windowId);
            break;
        }
      }
    });

    // Window focus
    windowElement.addEventListener('mousedown', () => {
      this.makeWindowActive(windowId);
    });

    // Window dragging
    const titlebar = windowElement.querySelector('.os-window-titlebar');
    this.makeDraggable(titlebar, windowElement, windowId);

    // Window resizing
    this.makeResizable(windowElement, windowId);
  }

  makeDraggable(handle, windowElement, windowId) {
    let isDragging = false;
    let currentX;
    let currentY;
    let initialX;
    let initialY;
    let initialLeft;
    let initialTop;

    handle.addEventListener('mousedown', (e) => {
      const window = this.getWindow(windowId);
      if (window && window.maximized) return; // Don't drag maximized windows

      isDragging = true;
      initialLeft = windowElement.offsetLeft;
      initialTop = windowElement.offsetTop;
      initialX = e.clientX - initialLeft;
      initialY = e.clientY - initialTop;

      // Add dragging class to disable transitions
      windowElement.classList.add('dragging');

      document.addEventListener('mousemove', drag);
      document.addEventListener('mouseup', stopDrag);

      e.preventDefault();
    });

    function drag(e) {
      if (!isDragging) return;

      currentX = e.clientX - initialX;
      currentY = e.clientY - initialY;

      // Constrain to screen bounds
      const maxX = window.innerWidth - windowElement.offsetWidth;
      const maxY = window.innerHeight - windowElement.offsetHeight - 48; // Account for taskbar

      currentX = Math.max(0, Math.min(currentX, maxX));
      currentY = Math.max(0, Math.min(currentY, maxY));

      // Use transform for smoother performance
      const deltaX = currentX - initialLeft;
      const deltaY = currentY - initialTop;
      windowElement.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
    }

    function stopDrag() {
      if (!isDragging) return;

      isDragging = false;

      // Apply the final position and remove transform
      const transform = windowElement.style.transform;
      if (transform && transform !== 'none') {
        const match = transform.match(/translate\((-?\d+(?:\.\d+)?)px, (-?\d+(?:\.\d+)?)px\)/);
        if (match) {
          const deltaX = parseFloat(match[1]);
          const deltaY = parseFloat(match[2]);
          windowElement.style.left = initialLeft + deltaX + 'px';
          windowElement.style.top = initialTop + deltaY + 'px';
        }
        windowElement.style.transform = '';
      }

      // Remove dragging class to re-enable transitions
      windowElement.classList.remove('dragging');
      document.removeEventListener('mousemove', drag);
      document.removeEventListener('mouseup', stopDrag);
    }
  }

  makeResizable(windowElement, windowId) {
    const handles = windowElement.querySelectorAll('.resize-handle, .window-drag-handle');

    handles.forEach((handle) => {
      handle.addEventListener('mousedown', (e) => {
        const window = this.getWindow(windowId);
        if (window && window.maximized) return; // Don't resize maximized windows

        e.preventDefault();
        e.stopPropagation();

        // Add dragging class to disable transitions during resize
        windowElement.classList.add('dragging');

        const startX = e.clientX;
        const startY = e.clientY;
        const startWidth = parseInt(getComputedStyle(windowElement).width, 10);
        const startHeight = parseInt(getComputedStyle(windowElement).height, 10);
        const startLeft = parseInt(getComputedStyle(windowElement).left, 10);
        const startTop = parseInt(getComputedStyle(windowElement).top, 10);

        // Determine handle direction - treat drag handle as southeast
        let handleClass;
        if (handle.classList.contains('window-drag-handle')) {
          handleClass = 'se';
        } else {
          handleClass = handle.className.split(' ')[1];
        }

        document.addEventListener('mousemove', resize);
        document.addEventListener('mouseup', stopResize);

        function resize(e) {
          const deltaX = e.clientX - startX;
          const deltaY = e.clientY - startY;

          let newWidth = startWidth;
          let newHeight = startHeight;
          let newLeft = startLeft;
          let newTop = startTop;

          // Handle different resize directions
          if (handleClass.includes('e')) {
            newWidth = Math.max(400, startWidth + deltaX);
          }
          if (handleClass.includes('w')) {
            newWidth = Math.max(400, startWidth - deltaX);
            newLeft = startLeft + deltaX;
            if (newWidth === 400) newLeft = startLeft + startWidth - 400;
          }
          if (handleClass.includes('s')) {
            newHeight = Math.max(300, startHeight + deltaY);
          }
          if (handleClass.includes('n')) {
            newHeight = Math.max(300, startHeight - deltaY);
            newTop = startTop + deltaY;
            if (newHeight === 300) newTop = startTop + startHeight - 300;
          }

          // Constrain to screen bounds
          if (newLeft + newWidth > window.innerWidth) {
            newWidth = window.innerWidth - newLeft;
          }
          if (newTop + newHeight > window.innerHeight - 48) {
            newHeight = window.innerHeight - 48 - newTop;
          }

          windowElement.style.width = newWidth + 'px';
          windowElement.style.height = newHeight + 'px';
          windowElement.style.left = newLeft + 'px';
          windowElement.style.top = newTop + 'px';
        }

        function stopResize() {
          // Remove dragging class to re-enable transitions
          windowElement.classList.remove('dragging');
          document.removeEventListener('mousemove', resize);
          document.removeEventListener('mouseup', stopResize);
        }
      });
    });
  }

  makeWindowActive(windowId) {
    // Remove active class from all windows
    this.windows.forEach((w) => {
      w.element.classList.remove('active');
    });

    // Add active class to current window
    const window = this.getWindow(windowId);
    if (window) {
      window.element.classList.add('active');
      this.activeWindow = window;

      // Update taskbar
      this.updateTaskbar();
    }
  }

  minimizeWindow(windowId) {
    const window = this.getWindow(windowId);
    if (window && !window.minimized) {
      window.element.classList.add('minimized');
      window.minimized = true;
      this.updateTaskbar();
    }
  }

  maximizeWindow(windowId) {
    const window = this.getWindow(windowId);
    if (!window) return;

    if (window.maximized) {
      // Restore window
      if (window.originalBounds) {
        window.element.style.left = window.originalBounds.left;
        window.element.style.top = window.originalBounds.top;
        window.element.style.width = window.originalBounds.width;
        window.element.style.height = window.originalBounds.height;
      }
      window.element.classList.remove('maximized');
      window.maximized = false;
    } else {
      // Maximize window
      window.originalBounds = {
        left: window.element.style.left,
        top: window.element.style.top,
        width: window.element.style.width,
        height: window.element.style.height
      };
      window.element.classList.add('maximized');
      window.maximized = true;
    }
  }

  closeWindow(windowId) {
    const windowIndex = this.windows.findIndex((w) => w.id === windowId);
    if (windowIndex === -1) return;

    const window = this.windows[windowIndex];
    window.element.remove();
    this.windows.splice(windowIndex, 1);

    // Remove taskbar button
    const taskbarButton = document.querySelector(`[data-window-id="${windowId}"]`);
    if (taskbarButton && taskbarButton.classList.contains('taskbar-app')) {
      taskbarButton.remove();
    }

    // If this was the active window, activate another one
    if (this.activeWindow && this.activeWindow.id === windowId) {
      this.activeWindow = null;
      if (this.windows.length > 0) {
        this.makeWindowActive(this.windows[this.windows.length - 1].id);
      }
    }

    this.updateTaskbar();
  }

  getWindow(windowId) {
    return this.windows.find((w) => w.id === windowId);
  }

  createTaskbarButton(windowId, title) {
    const runningApps = document.getElementById('running-apps');
    const button = document.createElement('button');
    button.className = 'taskbar-app active';
    button.setAttribute('data-window-id', windowId);
    button.innerHTML = `${this.getAppIcon(title)} ${title}`;

    button.addEventListener('click', () => {
      const window = this.getWindow(windowId);
      if (window) {
        if (window.minimized) {
          window.element.classList.remove('minimized');
          window.minimized = false;
          this.makeWindowActive(windowId);
        } else if (this.activeWindow && this.activeWindow.id === windowId) {
          this.minimizeWindow(windowId);
        } else {
          this.makeWindowActive(windowId);
        }
        this.updateTaskbar();
      }
    });

    runningApps.appendChild(button);
  }

  updateTaskbar() {
    const taskbarApps = document.querySelectorAll('.taskbar-app');
    taskbarApps.forEach((button) => {
      const windowId = parseInt(button.getAttribute('data-window-id'));
      const window = this.getWindow(windowId);

      button.classList.remove('active');
      if (window && this.activeWindow && this.activeWindow.id === windowId && !window.minimized) {
        button.classList.add('active');
      }
    });
  }

  createDesktopIcons() {
    const desktop = document.getElementById('os-desktop');

    // System apps positioned on the left side
    const systemIcons = [
      { name: 'Terminal', icon: '💻', x: 30, y: 30, app: 'terminal' },
      { name: 'Calculator', icon: '🔢', x: 30, y: 130, app: 'calculator' },
      { name: 'Notepad', icon: '📝', x: 30, y: 230, app: 'notepad' }
    ];

    systemIcons.forEach((iconData) => {
      this.createDesktopIcon(desktop, iconData);
    });

    // Add some popular apps from registry as desktop icons
    setTimeout(() => {
      if (this.availableApps) {
        const desktopApps = this.availableApps.filter((app) =>
          ['awesome', 'doom', 'farm', 'wordle-finder'].includes(app.id)
        );

        desktopApps.forEach((app, index) => {
          // Create a grid layout with proper spacing
          const iconsPerRow = 6; // Maximum icons per row
          const iconSpacing = 90; // Horizontal spacing between icons
          const rowSpacing = 100; // Vertical spacing between rows
          const startX = 150; // Start position (after system icons)
          const startY = 30; // Start position

          const row = Math.floor(index / iconsPerRow);
          const col = index % iconsPerRow;

          const iconData = {
            name: app.shortName,
            icon: app.icon,
            x: startX + col * iconSpacing,
            y: startY + row * rowSpacing,
            app: app.id
          };
          this.createDesktopIcon(desktop, iconData);
        });
      }
    }, 100);
  }

  createDesktopIcon(desktop, iconData) {
    const icon = document.createElement('div');
    icon.className = 'desktop-icon';
    icon.style.left = iconData.x + 'px';
    icon.style.top = iconData.y + 'px';
    icon.innerHTML = `
      <div class="icon">${iconData.icon}</div>
      <div class="label">${iconData.name}</div>
    `;

    icon.addEventListener('dblclick', () => {
      this.launchApp(iconData.app);
    });

    desktop.appendChild(icon);
  }

  showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = 'notification';

    const colors = {
      info: '#3182ce',
      success: '#10b981',
      error: '#ef4444',
      warning: '#f59e0b',
      system: '#8b5cf6'
    };

    notification.style.borderLeft = `4px solid ${colors[type] || colors.info}`;
    notification.textContent = message;

    document.getElementById('os-desktop').appendChild(notification);

    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 3000);
  }

  // Application creators
  createTerminalWindow() {
    const content = `
      <div class="terminal-content">
        <div class="terminal-line">
          <span class="terminal-prompt">user@heyming-os:~$</span> <span style="color: #00ff00;">echo "Welcome to Enhanced Heyming OS Terminal v2.0!"</span>
        </div>
        <div class="terminal-line">Welcome to Enhanced Heyming OS Terminal v2.0! 🚀</div>
        <div class="terminal-line">Type 'help' for available commands, or try some easter eggs! 🎉</div>
        <div class="terminal-line">
          <span class="terminal-prompt">user@heyming-os:~$</span> <input type="text" class="terminal-input" placeholder="Type a command...">
        </div>
      </div>
    `;

    const window = this.createWindow('Terminal', content, 700, 500);

    // Initialize enhanced terminal
    if (typeof Terminal !== 'undefined') {
      window.terminal = new Terminal(window.id, this);
    } else {
      console.error('Terminal class not found. Make sure terminal.js is loaded.');
    }
  }

  createCalculatorWindow() {
    const content = `
      <div class="calculator-content">
        <div class="calculator-display" id="calc-display">0</div>
        <div class="calculator-buttons">
          <button class="calculator-button" data-calc="clear">C</button>
          <button class="calculator-button" data-calc="sign">±</button>
          <button class="calculator-button" data-calc="percent">%</button>
          <button class="calculator-button operator" data-calc="/">÷</button>
          
          <button class="calculator-button" data-calc="7">7</button>
          <button class="calculator-button" data-calc="8">8</button>
          <button class="calculator-button" data-calc="9">9</button>
          <button class="calculator-button operator" data-calc="*">×</button>
          
          <button class="calculator-button" data-calc="4">4</button>
          <button class="calculator-button" data-calc="5">5</button>
          <button class="calculator-button" data-calc="6">6</button>
          <button class="calculator-button operator" data-calc="-">-</button>
          
          <button class="calculator-button" data-calc="1">1</button>
          <button class="calculator-button" data-calc="2">2</button>
          <button class="calculator-button" data-calc="3">3</button>
          <button class="calculator-button operator" data-calc="+">+</button>
          
          <button class="calculator-button" data-calc="0" style="grid-column: span 2;">0</button>
          <button class="calculator-button" data-calc=".">.</button>
          <button class="calculator-button equals" data-calc="=">=</button>
        </div>
      </div>
    `;

    const window = this.createWindow('Calculator', content, 350, 500);

    setTimeout(() => {
      this.initializeCalculator(window.id);
    }, 100);
  }

  initializeCalculator(windowId) {
    const windowElement = document.getElementById(`window-${windowId}`);
    const display = windowElement.querySelector('#calc-display');
    const buttons = windowElement.querySelectorAll('.calculator-button');

    let currentValue = '0';
    let previousValue = null;
    let operation = null;
    let waitingForOperand = false;

    function updateDisplay() {
      display.textContent = currentValue;
    }

    buttons.forEach((button) => {
      button.addEventListener('click', () => {
        const value = button.getAttribute('data-calc');

        if ('0123456789'.includes(value)) {
          if (waitingForOperand) {
            currentValue = value;
            waitingForOperand = false;
          } else {
            currentValue = currentValue === '0' ? value : currentValue + value;
          }
          updateDisplay();
        } else if (value === '.') {
          if (currentValue.indexOf('.') === -1) {
            currentValue += '.';
            updateDisplay();
          }
        } else if (['+', '-', '*', '/'].includes(value)) {
          if (previousValue !== null && !waitingForOperand) {
            calculate();
          }

          previousValue = parseFloat(currentValue);
          operation = value;
          waitingForOperand = true;
        } else if (value === '=') {
          calculate();
        } else if (value === 'clear') {
          currentValue = '0';
          previousValue = null;
          operation = null;
          waitingForOperand = false;
          updateDisplay();
        } else if (value === 'sign') {
          currentValue = (parseFloat(currentValue) * -1).toString();
          updateDisplay();
        } else if (value === 'percent') {
          currentValue = (parseFloat(currentValue) / 100).toString();
          updateDisplay();
        }
      });
    });

    function calculate() {
      if (previousValue !== null && operation && !waitingForOperand) {
        const current = parseFloat(currentValue);
        const previous = previousValue;

        let result;
        switch (operation) {
          case '+':
            result = previous + current;
            break;
          case '-':
            result = previous - current;
            break;
          case '*':
            result = previous * current;
            break;
          case '/':
            result = current !== 0 ? previous / current : 0;
            break;
          default:
            return;
        }

        currentValue = result.toString();
        previousValue = null;
        operation = null;
        waitingForOperand = true;
        updateDisplay();
      }
    }
  }

  createNotepadWindow() {
    const content = `
      <div class="notepad-content">
        <textarea class="notepad-textarea" placeholder="Start typing your notes here..."></textarea>
      </div>
    `;

    const window = this.createWindow('Notepad', content, 600, 400);

    setTimeout(() => {
      const textarea = document.querySelector(`#window-${window.id} .notepad-textarea`);
      if (textarea) {
        textarea.focus();
      }
    }, 100);
  }
}

// Initialize the OS
window.heymingOS = new HeymingOS();

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
    this.handleViewportChanges();
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

      // Adjust existing windows to current viewport (in case viewport changed while OS was hidden)
      setTimeout(() => {
        this.adjustWindowsToViewport(true); // Force repositioning when showing OS
      }, 100);

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
    // Cap dimensions to viewport size for mobile compatibility
    const requestedWidth = app.defaultWidth || 900;
    const requestedHeight = app.defaultHeight || 700;
    const cappedDimensions = this.getMaxWindowDimensions(requestedWidth, requestedHeight);

    const window = this.createWindow(
      app.name,
      content,
      cappedDimensions.width,
      cappedDimensions.height
    );
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

  getMaxWindowDimensions(requestedWidth, requestedHeight) {
    // Get viewport dimensions
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Leave some margin for the OS interface (taskbar, title bars, etc.)
    const margin = 80; // Space for taskbar and window decorations
    const sideMargin = 40; // Space on sides

    const maxWidth = Math.max(400, viewportWidth - sideMargin); // Minimum 400px width
    const maxHeight = Math.max(300, viewportHeight - margin); // Minimum 300px height

    // Cap the requested dimensions to the maximum allowed
    const cappedWidth = Math.min(requestedWidth, maxWidth);
    const cappedHeight = Math.min(requestedHeight, maxHeight);

    return {
      width: cappedWidth,
      height: cappedHeight
    };
  }

  // Helper functions for unified mouse/touch event handling
  getPointerCoordinates(e) {
    if (e.touches && e.touches.length > 0) {
      return {
        clientX: e.touches[0].clientX,
        clientY: e.touches[0].clientY
      };
    }
    return {
      clientX: e.clientX,
      clientY: e.clientY
    };
  }

  addPointerEventListeners(element, startEvents, moveEvent, endEvent) {
    // Add both mouse and touch event listeners
    startEvents.forEach((eventType) => {
      element.addEventListener(eventType, startEvent);
    });

    function startEvent(e) {
      // Prevent default to avoid scrolling on touch
      e.preventDefault();

      // Add move and end listeners for both mouse and touch
      document.addEventListener('mousemove', moveEvent);
      document.addEventListener('mouseup', endEvent);
      document.addEventListener('touchmove', moveEvent, { passive: false });
      document.addEventListener('touchend', endEvent);

      return startEvent;
    }

    return startEvent;
  }

  removePointerEventListeners(moveEvent, endEvent) {
    document.removeEventListener('mousemove', moveEvent);
    document.removeEventListener('mouseup', endEvent);
    document.removeEventListener('touchmove', moveEvent);
    document.removeEventListener('touchend', endEvent);
  }

  addDoubleTapHandler(element, callback) {
    // Handle desktop double-click
    element.addEventListener('dblclick', (e) => {
      e.preventDefault();
      callback();
    });

    // Handle mobile single tap
    const handleTap = (e) => {
      if (e.type === 'touchend') {
        e.preventDefault();
        e.stopPropagation();
        // Single tap on mobile - immediate response
        callback();
      }
    };

    // Add touch event listener for mobile single tap
    element.addEventListener('touchend', handleTap, { passive: false });

    // Prevent text selection and context menus on touch devices
    element.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
      },
      { passive: false }
    );

    // Prevent context menu on long press
    element.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });
  }

  handleViewportChanges() {
    // Handle window resize and orientation changes
    let resizeTimeout;
    const handleResize = () => {
      // Debounce resize events to avoid excessive calls
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        this.adjustWindowsToViewport();
      }, 250);
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', () => {
      // Orientation change needs a slight delay to get correct viewport dimensions
      setTimeout(() => {
        this.adjustWindowsToViewport(true); // Force repositioning on orientation change
      }, 300);
    });
  }

  adjustWindowsToViewport(forceReposition = false) {
    if (!this.isVisible || this.windows.length === 0) return;

    this.windows.forEach((window) => {
      this.adjustWindowToViewport(window, forceReposition);
    });
  }

  // Public method to force all windows back into view
  bringAllWindowsIntoView() {
    console.log('Forcing all windows back into viewport...');
    this.adjustWindowsToViewport(true);
    this.showNotification('All windows moved back into view', 'system');
  }

  adjustWindowToViewport(window, forceReposition = false) {
    const element = window.element;
    if (!element) return;

    // Handle maximized windows - they should always fill the viewport
    if (window.maximized) {
      // Maximized windows should automatically adjust to new viewport size
      element.style.left = '0px';
      element.style.top = '0px';
      element.style.width = window.innerWidth + 'px';
      element.style.height = window.innerHeight - 48 + 'px'; // Account for taskbar
      return;
    }

    // Get current window dimensions and position
    const currentWidth = parseInt(element.style.width, 10);
    const currentHeight = parseInt(element.style.height, 10);
    const currentLeft = parseInt(element.style.left, 10);
    const currentTop = parseInt(element.style.top, 10);

    // Get new maximum dimensions for current viewport
    const maxDimensions = this.getMaxWindowDimensions(currentWidth, currentHeight);

    // Check if window needs resizing
    let needsUpdate = false;
    let newWidth = currentWidth;
    let newHeight = currentHeight;
    let newLeft = currentLeft;
    let newTop = currentTop;

    // Resize if window is too large for viewport
    if (currentWidth > maxDimensions.width) {
      newWidth = maxDimensions.width;
      needsUpdate = true;
    }
    if (currentHeight > maxDimensions.height) {
      newHeight = maxDimensions.height;
      needsUpdate = true;
    }

    // Smart repositioning - ensure window is fully visible and accessible
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const taskbarHeight = 48;
    const titleBarHeight = 40; // Approximate title bar height
    const margin = 10; // Small margin from edges

    // Calculate available space for window positioning
    const maxLeft = Math.max(0, viewportWidth - newWidth);
    const maxTop = Math.max(0, viewportHeight - taskbarHeight - newHeight);

    // Enhanced off-screen detection - more aggressive when forced
    let needsRepositioning = false;

    // Check if window is completely off-screen or partially off-screen
    const isCompletelyOffScreenLeft = currentLeft + newWidth <= 0;
    const isCompletelyOffScreenRight = currentLeft >= viewportWidth;
    const isCompletelyOffScreenTop = currentTop + newHeight <= 0;
    const isCompletelyOffScreenBottom = currentTop >= viewportHeight - taskbarHeight;

    const isPartiallyOffScreenLeft = currentLeft < 0;
    const isPartiallyOffScreenRight = currentLeft + newWidth > viewportWidth;
    const isPartiallyOffScreenTop = currentTop < 0;
    const isPartiallyOffScreenBottom = currentTop + newHeight > viewportHeight - taskbarHeight;

    // Force repositioning if completely off-screen or if forced and partially off-screen
    if (
      isCompletelyOffScreenLeft ||
      isCompletelyOffScreenRight ||
      isCompletelyOffScreenTop ||
      isCompletelyOffScreenBottom
    ) {
      needsRepositioning = true;
      console.log(`Window ${window.id} is completely off-screen, repositioning...`);
    } else if (
      forceReposition &&
      (isPartiallyOffScreenLeft ||
        isPartiallyOffScreenRight ||
        isPartiallyOffScreenTop ||
        isPartiallyOffScreenBottom)
    ) {
      needsRepositioning = true;
      console.log(`Window ${window.id} is partially off-screen, force repositioning...`);
    } else {
      // Standard checks for normal repositioning
      if (currentLeft < 0 || currentLeft + newWidth > viewportWidth) {
        needsRepositioning = true;
      }
      if (currentTop < 0 || currentTop + newHeight > viewportHeight - taskbarHeight) {
        needsRepositioning = true;
      }
      // Ensure at least the title bar is visible if window was partially off-screen
      if (currentTop + titleBarHeight < 0) {
        needsRepositioning = true;
      }
    }

    if (needsRepositioning) {
      // For completely off-screen windows or forced repositioning, use optimal positioning
      if (
        isCompletelyOffScreenLeft ||
        isCompletelyOffScreenRight ||
        isCompletelyOffScreenTop ||
        isCompletelyOffScreenBottom ||
        forceReposition
      ) {
        const optimalPosition = this.findOptimalWindowPosition(newWidth, newHeight, window.id);
        if (optimalPosition) {
          newLeft = optimalPosition.left;
          newTop = optimalPosition.top;
        } else {
          // Fallback to center if no optimal position found
          newLeft = Math.max(margin, Math.min((viewportWidth - newWidth) / 2, maxLeft - margin));
          newTop = Math.max(
            margin,
            Math.min((viewportHeight - taskbarHeight - newHeight) / 2, maxTop - margin)
          );
        }
      } else {
        // Smart positioning: try to keep window in a reasonable position for partial off-screen
        if (currentLeft < 0) {
          newLeft = margin;
        } else if (currentLeft + newWidth > viewportWidth) {
          newLeft = Math.max(margin, maxLeft - margin);
        } else {
          // Window fits horizontally, keep current position if reasonable
          newLeft = Math.max(margin, Math.min(currentLeft, maxLeft - margin));
        }

        if (currentTop < 0) {
          newTop = margin;
        } else if (currentTop + newHeight > viewportHeight - taskbarHeight) {
          newTop = Math.max(margin, maxTop - margin);
        } else {
          // Window fits vertically, keep current position if reasonable
          newTop = Math.max(margin, Math.min(currentTop, maxTop - margin));
        }
      }

      needsUpdate = true;
    }

    // Apply changes if needed
    if (needsUpdate) {
      element.style.width = newWidth + 'px';
      element.style.height = newHeight + 'px';
      element.style.left = newLeft + 'px';
      element.style.top = newTop + 'px';

      // Clear any existing transform that might conflict
      element.style.transform = '';

      console.log(
        `Repositioned window ${window.id} to: ${newLeft}px, ${newTop}px (${newWidth}x${newHeight})`
      );
    }
  }

  findOptimalWindowPosition(width, height, excludeWindowId) {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const taskbarHeight = 48;
    const margin = 10;
    const step = 30; // Step size for cascading windows

    // Calculate maximum possible positions
    const maxLeft = viewportWidth - width - margin;
    const maxTop = viewportHeight - taskbarHeight - height - margin;

    // Try cascading positions (similar to how new windows are positioned)
    for (let cascade = 0; cascade < 10; cascade++) {
      const testLeft = margin + cascade * step;
      const testTop = margin + cascade * step;

      // Check if this position is within viewport
      if (testLeft > maxLeft || testTop > maxTop) {
        break;
      }

      // Check if this position overlaps significantly with existing windows
      const hasSignificantOverlap = this.windows.some((win) => {
        if (win.id === excludeWindowId || !win.element || win.minimized) {
          return false;
        }

        const winLeft = parseInt(win.element.style.left, 10);
        const winTop = parseInt(win.element.style.top, 10);
        const winWidth = parseInt(win.element.style.width, 10);
        const winHeight = parseInt(win.element.style.height, 10);

        // Calculate overlap area
        const overlapLeft = Math.max(testLeft, winLeft);
        const overlapTop = Math.max(testTop, winTop);
        const overlapRight = Math.min(testLeft + width, winLeft + winWidth);
        const overlapBottom = Math.min(testTop + height, winTop + winHeight);

        const overlapWidth = Math.max(0, overlapRight - overlapLeft);
        const overlapHeight = Math.max(0, overlapBottom - overlapTop);
        const overlapArea = overlapWidth * overlapHeight;

        // Consider significant if overlap is more than 25% of window area
        const windowArea = width * height;
        return overlapArea > windowArea * 0.25;
      });

      if (!hasSignificantOverlap) {
        return { left: testLeft, top: testTop };
      }
    }

    // If no good cascading position found, center the window
    const centerLeft = Math.max(margin, (viewportWidth - width) / 2);
    const centerTop = Math.max(margin, (viewportHeight - taskbarHeight - height) / 2);

    return {
      left: Math.min(centerLeft, maxLeft),
      top: Math.min(centerTop, maxTop)
    };
  }

  createWindow(title, content, width = 600, height = 400) {
    const windowId = this.nextWindowId++;
    const windowsContainer = document.getElementById('os-windows');

    // Cap dimensions to viewport size for mobile compatibility
    const cappedDimensions = this.getMaxWindowDimensions(width, height);

    const windowElement = document.createElement('div');
    windowElement.className = 'os-window active';
    windowElement.id = `window-${windowId}`;
    windowElement.style.width = cappedDimensions.width + 'px';
    windowElement.style.height = cappedDimensions.height + 'px';
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
    // Window controls - handle both mouse and touch events
    const handleControlAction = (e) => {
      if (e.target.classList.contains('os-window-control')) {
        e.preventDefault(); // Prevent default behavior
        e.stopPropagation(); // Stop event bubbling

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
    };

    // Add both click and touch event listeners for window controls
    windowElement.addEventListener('click', handleControlAction);

    // Touch events for better mobile responsiveness
    windowElement.addEventListener('touchend', handleControlAction, { passive: false });

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

    const startDrag = (e) => {
      const window = this.getWindow(windowId);
      if (window && window.maximized) return; // Don't drag maximized windows

      const pointer = this.getPointerCoordinates(e);

      isDragging = true;
      initialLeft = windowElement.offsetLeft;
      initialTop = windowElement.offsetTop;
      initialX = pointer.clientX - initialLeft;
      initialY = pointer.clientY - initialTop;

      // Add dragging class to disable transitions
      windowElement.classList.add('dragging');

      // Add move and end listeners for both mouse and touch
      document.addEventListener('mousemove', drag);
      document.addEventListener('mouseup', stopDrag);
      document.addEventListener('touchmove', drag, { passive: false });
      document.addEventListener('touchend', stopDrag);

      e.preventDefault();
    };

    const drag = (e) => {
      if (!isDragging) return;

      const pointer = this.getPointerCoordinates(e);
      currentX = pointer.clientX - initialX;
      currentY = pointer.clientY - initialY;

      // Constrain to screen bounds
      const maxX = window.innerWidth - windowElement.offsetWidth;
      const maxY = window.innerHeight - windowElement.offsetHeight - 48; // Account for taskbar

      currentX = Math.max(0, Math.min(currentX, maxX));
      currentY = Math.max(0, Math.min(currentY, maxY));

      // Use transform for smoother performance
      const deltaX = currentX - initialLeft;
      const deltaY = currentY - initialTop;
      windowElement.style.transform = `translate(${deltaX}px, ${deltaY}px)`;

      // Prevent scrolling on touch devices
      e.preventDefault();
    };

    const stopDrag = () => {
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
      this.removePointerEventListeners(drag, stopDrag);
    };

    // Add both mouse and touch event listeners for starting drag
    handle.addEventListener('mousedown', startDrag);
    handle.addEventListener('touchstart', startDrag, { passive: false });
  }

  makeResizable(windowElement, windowId) {
    const handles = windowElement.querySelectorAll('.resize-handle, .window-drag-handle');

    handles.forEach((handle) => {
      const startResize = (e) => {
        const window = this.getWindow(windowId);
        if (window && window.maximized) return; // Don't resize maximized windows

        e.preventDefault();
        e.stopPropagation();

        // Add dragging class to disable transitions during resize
        windowElement.classList.add('dragging');

        const pointer = this.getPointerCoordinates(e);
        const startX = pointer.clientX;
        const startY = pointer.clientY;
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

        const resize = (e) => {
          const pointer = this.getPointerCoordinates(e);
          const deltaX = pointer.clientX - startX;
          const deltaY = pointer.clientY - startY;

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

          // Prevent scrolling on touch devices
          e.preventDefault();
        };

        const stopResize = () => {
          // Remove dragging class to re-enable transitions
          windowElement.classList.remove('dragging');
          this.removePointerEventListeners(resize, stopResize);
        };

        // Add move and end listeners for both mouse and touch
        document.addEventListener('mousemove', resize);
        document.addEventListener('mouseup', stopResize);
        document.addEventListener('touchmove', resize, { passive: false });
        document.addEventListener('touchend', stopResize);
      };

      // Add both mouse and touch event listeners for starting resize
      handle.addEventListener('mousedown', startResize);
      handle.addEventListener('touchstart', startResize, { passive: false });
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

    // Add unified double-tap/double-click handler
    this.addDoubleTapHandler(icon, () => {
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
}

// Initialize the OS
window.heymingOS = new HeymingOS();

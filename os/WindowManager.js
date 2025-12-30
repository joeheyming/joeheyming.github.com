/**
 * Heyming OS - Window Manager
 * Handles window creation, dragging, resizing, and lifecycle
 */

import { Constants } from './constants.js';
import { InputHandler } from './InputHandler.js';

export class WindowManager {
  constructor() {
    this.windows = [];
    this.nextWindowId = 1;
    this.activeWindow = null;
    this.potentialActiveWindow = null;
    this.topZIndex = 100; // Start z-index for windows
    this.C = Constants;
    this.Input = InputHandler;

    // Event listeners for window lifecycle events
    this._eventListeners = {
      close: [],
      minimize: [],
      restore: [],
      focus: []
    };
  }

  /**
   * Subscribe to window events
   * @param {string} event - 'close', 'minimize', 'restore', 'focus'
   * @param {Function} callback - Called with windowId
   * @returns {Function} Unsubscribe function
   */
  on(event, callback) {
    if (this._eventListeners[event]) {
      this._eventListeners[event].push(callback);
      return () => {
        const idx = this._eventListeners[event].indexOf(callback);
        if (idx !== -1) this._eventListeners[event].splice(idx, 1);
      };
    }
  }

  _emit(event, windowId) {
    this._eventListeners[event]?.forEach((cb) => cb(windowId));
  }

  /**
   * Check if we're on a mobile/small screen
   */
  isMobileView() {
    return window.innerWidth <= this.C.MOBILE_BREAKPOINT || window.innerHeight <= 600;
  }

  /**
   * Create a new window
   * @param {string} title - Window title
   * @param {string} content - HTML content for window body
   * @param {number} width - Window width
   * @param {number} height - Window height
   * @returns {Object} Window object
   */
  createWindow(
    title,
    content,
    width = this.C.DEFAULT_WINDOW_WIDTH,
    height = this.C.DEFAULT_WINDOW_HEIGHT
  ) {
    const windowId = this.nextWindowId++;
    const windowsContainer = document.getElementById('os-windows');
    const isMobile = this.isMobileView();

    // On mobile, use full-screen dimensions
    let finalWidth, finalHeight, left, top;

    if (isMobile) {
      // Mobile: nearly full screen with small margin
      finalWidth = window.innerWidth - 10;
      finalHeight = window.innerHeight - this.C.TASKBAR_HEIGHT - 10;
      left = 5;
      top = 5;
    } else {
      // Desktop: use requested dimensions, capped to viewport
      const cappedDimensions = this.getMaxWindowDimensions(width, height);
      finalWidth = cappedDimensions.width;
      finalHeight = cappedDimensions.height;
      left = 50 + this.windows.length * this.C.CASCADE_STEP;
      top = 50 + this.windows.length * this.C.CASCADE_STEP;
    }

    const windowElement = document.createElement('div');
    windowElement.className = 'os-window active' + (isMobile ? ' mobile-view' : '');
    windowElement.id = `window-${windowId}`;
    windowElement.style.width = finalWidth + 'px';
    windowElement.style.height = finalHeight + 'px';
    windowElement.style.left = left + 'px';
    windowElement.style.top = top + 'px';

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
      ${this._createResizeHandles()}
    `;

    windowsContainer.appendChild(windowElement);

    const win = {
      id: windowId,
      element: windowElement,
      title: title,
      minimized: false,
      maximized: false,
      originalBounds: null
    };

    this.windows.push(win);
    this.makeWindowActive(windowId);
    this._bindWindowEvents(windowElement, windowId);

    return win;
  }

  /**
   * Create an iframe-based window for an app
   * @param {Object} app - App configuration object
   * @returns {Object} Window object
   */
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

    const requestedWidth = app.defaultWidth || this.C.DEFAULT_WINDOW_WIDTH;
    const requestedHeight = app.defaultHeight || this.C.DEFAULT_WINDOW_HEIGHT;
    const cappedDimensions = this.getMaxWindowDimensions(requestedWidth, requestedHeight);

    const win = this.createWindow(
      app.name,
      content,
      cappedDimensions.width,
      cappedDimensions.height
    );
    win.appId = app.id;
    return win;
  }

  /**
   * Get app icon for title bar
   */
  getAppIcon(title) {
    const systemIcons = {
      Terminal: '💻',
      Calculator: '🔢',
      Notepad: '📝'
    };

    if (systemIcons[title]) {
      return systemIcons[title];
    }

    // Check registry apps
    if (window.AppModule) {
      const apps = window.AppModule.getAllApps();
      const app = apps.find((a) => a.name === title);
      if (app) {
        return app.icon;
      }
    }

    return '📱';
  }

  /**
   * Make a window active (bring to front)
   */
  makeWindowActive(windowId) {
    // Remove active class from all windows
    this.windows.forEach((w) => {
      w.element.classList.remove('active');
    });

    // Add active class to current window and bring to front
    const win = this.getWindow(windowId);
    if (win) {
      win.element.classList.add('active');
      // Increment and apply z-index to bring to front
      this.topZIndex++;
      win.element.style.zIndex = this.topZIndex;
      this.activeWindow = win;
      this._emit('focus', windowId);
    }
  }

  /**
   * Minimize a window
   */
  minimizeWindow(windowId) {
    const win = this.getWindow(windowId);
    if (win && !win.minimized) {
      win.element.classList.add('minimized');
      win.minimized = true;
      this._emit('minimize', windowId);
    }
  }

  /**
   * Maximize or restore a window
   */
  maximizeWindow(windowId) {
    const win = this.getWindow(windowId);
    if (!win) return;

    if (win.maximized) {
      // Restore window
      if (win.originalBounds) {
        win.element.style.left = win.originalBounds.left;
        win.element.style.top = win.originalBounds.top;
        win.element.style.width = win.originalBounds.width;
        win.element.style.height = win.originalBounds.height;
      }
      win.element.classList.remove('maximized');
      win.maximized = false;
    } else {
      // Maximize window
      win.originalBounds = {
        left: win.element.style.left,
        top: win.element.style.top,
        width: win.element.style.width,
        height: win.element.style.height
      };
      win.element.classList.add('maximized');
      win.maximized = true;
    }
  }

  /**
   * Close a window
   */
  closeWindow(windowId) {
    const windowIndex = this.windows.findIndex((w) => w.id === windowId);
    if (windowIndex === -1) return;

    const win = this.windows[windowIndex];
    win.element.remove();
    this.windows.splice(windowIndex, 1);

    // If this was the active window, activate another one
    if (this.activeWindow && this.activeWindow.id === windowId) {
      this.activeWindow = null;
      if (this.windows.length > 0) {
        this.makeWindowActive(this.windows[this.windows.length - 1].id);
      }
    }

    this._emit('close', windowId);
    return win;
  }

  /**
   * Get window by ID
   */
  getWindow(windowId) {
    return this.windows.find((w) => w.id === windowId);
  }

  /**
   * Get all windows
   */
  getAllWindows() {
    return this.windows;
  }

  /**
   * Close all windows
   */
  closeAllWindows() {
    [...this.windows].forEach((win) => {
      this.closeWindow(win.id);
    });
  }

  /**
   * Restore a minimized window
   */
  restoreWindow(windowId) {
    const win = this.getWindow(windowId);
    if (win && win.minimized) {
      // Add restoring class for smooth animation
      win.element.classList.add('restoring');
      win.element.classList.remove('minimized');
      win.minimized = false;
      this.makeWindowActive(windowId);

      // Remove restoring class after animation
      setTimeout(() => {
        win.element.classList.remove('restoring');
      }, 300);
    }
  }

  /**
   * Calculate maximum window dimensions for current viewport
   */
  getMaxWindowDimensions(requestedWidth, requestedHeight) {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const isMobile = this.isMobileView();

    if (isMobile) {
      // On mobile, use nearly full screen
      return {
        width: viewportWidth - 10,
        height: viewportHeight - this.C.TASKBAR_HEIGHT - 10
      };
    }

    const maxWidth = Math.max(this.C.MIN_WINDOW_WIDTH, viewportWidth - this.C.SIDE_MARGIN);
    const maxHeight = Math.max(this.C.MIN_WINDOW_HEIGHT, viewportHeight - this.C.TOP_MARGIN);

    return {
      width: Math.min(requestedWidth, maxWidth),
      height: Math.min(requestedHeight, maxHeight)
    };
  }

  /**
   * Initialize resize listener for responsive behavior
   */
  initResizeListener() {
    let resizeTimeout;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        this.adjustWindowsToViewport(true);
      }, 150);
    });
  }

  /**
   * Adjust all windows to fit current viewport
   */
  adjustWindowsToViewport(forceReposition = false) {
    this.windows.forEach((win) => {
      this._adjustWindowToViewport(win, forceReposition);
    });
  }

  /**
   * Force all windows back into view
   * @returns {number} Number of windows adjusted
   */
  bringAllWindowsIntoView() {
    const count = this.windows.length;
    if (count > 0) {
      this.adjustWindowsToViewport(true);
    }
    return count;
  }

  /**
   * Find optimal position for a new window
   */
  findOptimalPosition(width, height, excludeWindowId = null) {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const margin = this.C.WINDOW_MARGIN;
    const step = this.C.CASCADE_STEP;

    const maxLeft = viewportWidth - width - margin;
    const maxTop = viewportHeight - this.C.TASKBAR_HEIGHT - height - margin;

    // Try cascading positions
    for (let cascade = 0; cascade < 10; cascade++) {
      const testLeft = margin + cascade * step;
      const testTop = margin + cascade * step;

      if (testLeft > maxLeft || testTop > maxTop) break;

      const hasOverlap = this.windows.some((win) => {
        if (win.id === excludeWindowId || !win.element || win.minimized) return false;

        const winLeft = parseInt(win.element.style.left, 10);
        const winTop = parseInt(win.element.style.top, 10);
        const winWidth = parseInt(win.element.style.width, 10);
        const winHeight = parseInt(win.element.style.height, 10);

        const overlapLeft = Math.max(testLeft, winLeft);
        const overlapTop = Math.max(testTop, winTop);
        const overlapRight = Math.min(testLeft + width, winLeft + winWidth);
        const overlapBottom = Math.min(testTop + height, winTop + winHeight);

        const overlapWidth = Math.max(0, overlapRight - overlapLeft);
        const overlapHeight = Math.max(0, overlapBottom - overlapTop);
        const overlapArea = overlapWidth * overlapHeight;

        return overlapArea > width * height * this.C.OVERLAP_THRESHOLD;
      });

      if (!hasOverlap) {
        return { left: testLeft, top: testTop };
      }
    }

    // Fallback to center
    const centerLeft = Math.max(margin, (viewportWidth - width) / 2);
    const centerTop = Math.max(margin, (viewportHeight - this.C.TASKBAR_HEIGHT - height) / 2);

    return {
      left: Math.min(centerLeft, maxLeft),
      top: Math.min(centerTop, maxTop)
    };
  }

  // ========== Private Methods ==========

  _createResizeHandles() {
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

  _bindWindowEvents(windowElement, windowId) {
    // Window control buttons
    const handleControlAction = (e) => {
      if (e.target.classList.contains('os-window-control')) {
        e.preventDefault();
        e.stopPropagation();

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

    windowElement.addEventListener('click', handleControlAction);
    windowElement.addEventListener('touchend', handleControlAction, { passive: false });

    // Window focus on click
    windowElement.addEventListener('mousedown', () => {
      this.makeWindowActive(windowId);
    });

    // Iframe focus detection
    this._bindIframeFocusDetection(windowElement, windowId);

    // Dragging
    const titlebar = windowElement.querySelector('.os-window-titlebar');
    this._makeDraggable(titlebar, windowElement, windowId);

    // Resizing
    this._makeResizable(windowElement, windowId);
  }

  _bindIframeFocusDetection(windowElement, windowId) {
    const iframe = windowElement.querySelector('iframe');
    if (!iframe) return;

    iframe.addEventListener('focus', () => {
      this.makeWindowActive(windowId);
    });

    iframe.addEventListener('mouseenter', () => {
      this.potentialActiveWindow = windowId;
    });

    let iframeClickTimer = null;
    let focusCheckInterval = null;

    const checkIframeClick = () => {
      if (this.potentialActiveWindow === windowId) {
        this.makeWindowActive(windowId);
        this.potentialActiveWindow = null;
      }
    };

    window.addEventListener('blur', () => {
      if (this.potentialActiveWindow === windowId) {
        iframeClickTimer = setTimeout(checkIframeClick, 10);
      }
    });

    iframe.addEventListener('mouseenter', () => {
      focusCheckInterval = setInterval(() => {
        if (document.activeElement === iframe && this.activeWindow?.id !== windowId) {
          this.makeWindowActive(windowId);
          clearInterval(focusCheckInterval);
        }
      }, 100);
    });

    iframe.addEventListener('mouseleave', () => {
      if (focusCheckInterval) {
        clearInterval(focusCheckInterval);
        focusCheckInterval = null;
      }
      this.potentialActiveWindow = null;
    });

    windowElement.addEventListener('remove', () => {
      if (iframeClickTimer) clearTimeout(iframeClickTimer);
      if (focusCheckInterval) clearInterval(focusCheckInterval);
    });
  }

  _makeDraggable(handle, windowElement, windowId) {
    let initialLeft, initialTop, initialX, initialY;

    this.Input.addDragListeners(handle, {
      onStart: (e, pointer) => {
        const win = this.getWindow(windowId);
        if (win && win.maximized) return;

        initialLeft = windowElement.offsetLeft;
        initialTop = windowElement.offsetTop;
        initialX = pointer.clientX - initialLeft;
        initialY = pointer.clientY - initialTop;

        windowElement.classList.add('dragging');
        e.preventDefault();
      },

      onMove: (e, pointer) => {
        const win = this.getWindow(windowId);
        if (win && win.maximized) return;

        let currentX = pointer.clientX - initialX;
        let currentY = pointer.clientY - initialY;

        // Only constraint: keep at least 50px visible so user can drag it back
        const minVisible = 50;

        currentX = Math.max(-windowElement.offsetWidth + minVisible, currentX);
        currentX = Math.min(window.innerWidth - minVisible, currentX);
        currentY = Math.max(-windowElement.offsetHeight + minVisible, currentY);
        currentY = Math.min(window.innerHeight - minVisible, currentY);

        const deltaX = currentX - initialLeft;
        const deltaY = currentY - initialTop;
        windowElement.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
      },

      onEnd: () => {
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
        windowElement.classList.remove('dragging');
      }
    });
  }

  _makeResizable(windowElement, windowId) {
    const handles = windowElement.querySelectorAll('.resize-handle, .window-drag-handle');

    handles.forEach((handle) => {
      let startX, startY, startWidth, startHeight, startLeft, startTop, handleClass;

      this.Input.addDragListeners(handle, {
        onStart: (e, pointer) => {
          const win = this.getWindow(windowId);
          if (win && win.maximized) return;

          e.stopPropagation();
          windowElement.classList.add('dragging');

          startX = pointer.clientX;
          startY = pointer.clientY;
          startWidth = parseInt(getComputedStyle(windowElement).width, 10);
          startHeight = parseInt(getComputedStyle(windowElement).height, 10);
          startLeft = parseInt(getComputedStyle(windowElement).left, 10);
          startTop = parseInt(getComputedStyle(windowElement).top, 10);

          handleClass = handle.classList.contains('window-drag-handle')
            ? 'se'
            : handle.className.split(' ')[1];
        },

        onMove: (e, pointer) => {
          const win = this.getWindow(windowId);
          if (win && win.maximized) return;

          const deltaX = pointer.clientX - startX;
          const deltaY = pointer.clientY - startY;

          let newWidth = startWidth;
          let newHeight = startHeight;
          let newLeft = startLeft;
          let newTop = startTop;

          if (handleClass.includes('e')) {
            newWidth = Math.max(this.C.MIN_WINDOW_WIDTH, startWidth + deltaX);
          }
          if (handleClass.includes('w')) {
            newWidth = Math.max(this.C.MIN_WINDOW_WIDTH, startWidth - deltaX);
            newLeft = startLeft + deltaX;
            if (newWidth === this.C.MIN_WINDOW_WIDTH) {
              newLeft = startLeft + startWidth - this.C.MIN_WINDOW_WIDTH;
            }
          }
          if (handleClass.includes('s')) {
            newHeight = Math.max(this.C.MIN_WINDOW_HEIGHT, startHeight + deltaY);
          }
          if (handleClass.includes('n')) {
            newHeight = Math.max(this.C.MIN_WINDOW_HEIGHT, startHeight - deltaY);
            newTop = startTop + deltaY;
            if (newHeight === this.C.MIN_WINDOW_HEIGHT) {
              newTop = startTop + startHeight - this.C.MIN_WINDOW_HEIGHT;
            }
          }

          // Constrain to screen bounds
          if (newLeft + newWidth > window.innerWidth) {
            newWidth = window.innerWidth - newLeft;
          }
          if (newTop + newHeight > window.innerHeight - this.C.TASKBAR_HEIGHT) {
            newHeight = window.innerHeight - this.C.TASKBAR_HEIGHT - newTop;
          }

          windowElement.style.width = newWidth + 'px';
          windowElement.style.height = newHeight + 'px';
          windowElement.style.left = newLeft + 'px';
          windowElement.style.top = newTop + 'px';
        },

        onEnd: () => {
          windowElement.classList.remove('dragging');
        }
      });
    });
  }

  _adjustWindowToViewport(win, forceReposition = false) {
    const element = win.element;
    if (!element) return;

    if (win.maximized) {
      element.style.left = '0px';
      element.style.top = '0px';
      element.style.width = window.innerWidth + 'px';
      element.style.height = window.innerHeight - this.C.TASKBAR_HEIGHT + 'px';
      return;
    }

    const currentWidth = parseInt(element.style.width, 10);
    const currentHeight = parseInt(element.style.height, 10);
    const currentLeft = parseInt(element.style.left, 10);
    const currentTop = parseInt(element.style.top, 10);

    const maxDimensions = this.getMaxWindowDimensions(currentWidth, currentHeight);

    let needsUpdate = false;
    let newWidth = currentWidth;
    let newHeight = currentHeight;
    let newLeft = currentLeft;
    let newTop = currentTop;

    if (currentWidth > maxDimensions.width) {
      newWidth = maxDimensions.width;
      needsUpdate = true;
    }
    if (currentHeight > maxDimensions.height) {
      newHeight = maxDimensions.height;
      needsUpdate = true;
    }

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const margin = this.C.WINDOW_MARGIN;

    const maxLeft = Math.max(0, viewportWidth - newWidth);
    const maxTop = Math.max(0, viewportHeight - this.C.TASKBAR_HEIGHT - newHeight);

    // Check if window is off-screen
    const isOffScreen =
      currentLeft + newWidth <= 0 ||
      currentLeft >= viewportWidth ||
      currentTop + newHeight <= 0 ||
      currentTop >= viewportHeight - this.C.TASKBAR_HEIGHT;

    const isPartiallyOffScreen =
      currentLeft < 0 ||
      currentLeft + newWidth > viewportWidth ||
      currentTop < 0 ||
      currentTop + newHeight > viewportHeight - this.C.TASKBAR_HEIGHT;

    if (isOffScreen || (forceReposition && isPartiallyOffScreen)) {
      const optimalPosition = this.findOptimalPosition(newWidth, newHeight, win.id);
      newLeft = optimalPosition.left;
      newTop = optimalPosition.top;
      needsUpdate = true;
    } else if (isPartiallyOffScreen) {
      if (currentLeft < 0) newLeft = margin;
      else if (currentLeft + newWidth > viewportWidth) newLeft = Math.max(margin, maxLeft - margin);

      if (currentTop < 0) newTop = margin;
      else if (currentTop + newHeight > viewportHeight - this.C.TASKBAR_HEIGHT) {
        newTop = Math.max(margin, maxTop - margin);
      }

      needsUpdate = true;
    }

    if (needsUpdate) {
      element.style.width = newWidth + 'px';
      element.style.height = newHeight + 'px';
      element.style.left = newLeft + 'px';
      element.style.top = newTop + 'px';
      element.style.transform = '';
    }
  }
}

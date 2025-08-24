// Window Management System for HEYMING-OS

// Window state management
let activeWindows = [];
let zIndexCounter = 1000;
let currentlyFocusedWindow = null;

// Available applications configuration - now using AppModule
const availableApps = AppModule.getTaskbarApps();

// Window app configuration - now using AppModule
const appConfig = AppModule.getWindowConfig();

// Main function to open an application in a new window
function openApp(appName) {
  const windowId = `window-${Date.now()}`;
  const window = createWindow(windowId, appName);
  document.getElementById('windows-container').appendChild(window);
  activeWindows.push(windowId);
  // Focus the newly created window
  focusWindow(windowId);
  updateSystemStats();
}

// Create a new window with all necessary components
function createWindow(id, appName) {
  const template = document.getElementById('window-template');
  const windowContent = template.content.cloneNode(true);
  const window = windowContent.querySelector('.window');

  // Set window properties
  window.id = id;
  // Account for desktop header space (approximately 40px for terminal bar)
  const headerOffset = 40;
  window.style.cssText = `
          width: 800px;
          height: 600px;
          top: ${headerOffset + 50 + activeWindows.length * 30}px;
          left: ${100 + activeWindows.length * 30}px;
          z-index: ${++zIndexCounter};
        `;

  const config = appConfig[appName] || { title: appName, icon: '📦' };

  // Update window content using DOM methods
  window.querySelector('.window-icon').textContent = config.icon;
  window.querySelector('.window-title').textContent = config.title;

  // Set up button event listeners
  const minimizeBtn = window.querySelector('.minimize-btn');
  const maximizeBtn = window.querySelector('.maximize-btn');
  const closeBtn = window.querySelector('.close-btn');

  minimizeBtn.addEventListener('click', () => minimizeWindow(id));
  maximizeBtn.addEventListener('click', () => maximizeWindow(id));
  closeBtn.addEventListener('click', () => closeWindow(id));

  // Set up iframe
  const iframe = window.querySelector('iframe');
  iframe.src = `${appName}/index.html`;
  iframe.addEventListener('error', () => {
    iframe.src = `data:text/html,<h1>App not found: ${appName}/index.html</h1>`;
  });
  iframe.addEventListener('load', () => {
    console.log(`Loaded ${appName}/index.html`);
  });

  makeWindowDraggable(window);
  makeWindowResizable(window);

  // Focus window on click
  window.addEventListener('mousedown', () => focusWindow(id));

  return window;
}

// Make window draggable with smooth performance
function makeWindowDraggable(window) {
  const header = window.querySelector('.window-header');
  let isDragging = false;
  let currentX = 0,
    currentY = 0,
    initialX = 0,
    initialY = 0,
    xOffset = 0,
    yOffset = 0;

  // Cache bounds to avoid layout thrashing
  let desktopBounds = null;
  let windowBounds = null;
  let animationFrameId = null;

  // Cache desktop and window bounds
  function updateBounds() {
    const desktop = document.getElementById('desktop');
    const desktopRect = desktop.getBoundingClientRect();
    desktopBounds = {
      width: desktop.offsetWidth,
      height: desktop.offsetHeight,
      left: desktopRect.left,
      top: desktopRect.top
    };
    windowBounds = {
      width: window.offsetWidth,
      height: window.offsetHeight
    };
  }

  // Smooth drag update using requestAnimationFrame
  function updatePosition() {
    if (!isDragging) return;

    // Apply bounds constraints using cached values
    const maxX = desktopBounds.width - windowBounds.width;
    const maxY = desktopBounds.height - windowBounds.height;

    // Account for desktop header space (approximately 40px for terminal bar)
    const headerOffset = 40;

    // Constrain to desktop boundaries, keeping windows below header
    currentX = Math.min(currentX, maxX);
    currentY = Math.max(headerOffset, Math.min(currentY, maxY));

    // Use transform3d for hardware acceleration
    window.style.transform = `translate3d(${currentX}px, ${currentY}px, 0)`;
    animationFrameId = null;
  }

  header.addEventListener('mousedown', dragStart);
  document.addEventListener('mousemove', drag);
  document.addEventListener('mouseup', dragEnd);

  function dragStart(e) {
    if (e.target.tagName === 'BUTTON') return;

    // Cache bounds at start of drag
    updateBounds();

    initialX = e.clientX - xOffset;
    initialY = e.clientY - yOffset;

    if (e.target === header || header.contains(e.target)) {
      isDragging = true;
      focusWindow(window.id);

      // Add dragging class for better UX
      window.classList.add('dragging');
      header.style.cursor = 'grabbing';
    }
  }

  function drag(e) {
    if (isDragging) {
      e.preventDefault();

      // Calculate new position relative to desktop
      currentX = e.clientX - initialX;
      currentY = e.clientY - initialY;
      xOffset = currentX;
      yOffset = currentY;

      // Throttle updates using requestAnimationFrame
      if (animationFrameId === null) {
        animationFrameId = requestAnimationFrame(updatePosition);
      }
    }
  }

  function dragEnd() {
    if (isDragging) {
      isDragging = false;

      // Clean up UI state
      window.classList.remove('dragging');
      header.style.cursor = 'grab';

      // Cancel any pending animation frame
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }

      // Final position update
      updatePosition();
    }
  }

  // Set initial cursor style
  header.style.cursor = 'grab';
}

// Make window resizable with smooth performance
function makeWindowResizable(window) {
  const resizeHandle = document.createElement('div');
  resizeHandle.className =
    'resize-handle absolute bottom-0 right-0 w-3 h-3 bg-gray-600 cursor-nw-resize opacity-50 hover:opacity-100';
  window.appendChild(resizeHandle);

  let isResizing = false;
  let startX, startY, startWidth, startHeight;
  let currentWidth, currentHeight;
  let animationFrameId = null;

  // Smooth resize update using requestAnimationFrame
  function updateSize() {
    if (!isResizing) return;

    window.style.width = currentWidth + 'px';
    window.style.height = currentHeight + 'px';
    animationFrameId = null;
  }

  resizeHandle.addEventListener('mousedown', (e) => {
    isResizing = true;
    startX = e.clientX;
    startY = e.clientY;
    startWidth = window.offsetWidth;
    startHeight = window.offsetHeight;
    e.stopPropagation();

    // Add resizing class for visual feedback
    window.classList.add('resizing');
    resizeHandle.style.cursor = 'nw-resize';
  });

  document.addEventListener('mousemove', (e) => {
    if (isResizing) {
      // Calculate new dimensions
      currentWidth = Math.max(300, startWidth + (e.clientX - startX));
      currentHeight = Math.max(200, startHeight + (e.clientY - startY));

      // Throttle updates using requestAnimationFrame
      if (animationFrameId === null) {
        animationFrameId = requestAnimationFrame(updateSize);
      }
    }
  });

  document.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;

      // Clean up UI state
      window.classList.remove('resizing');
      resizeHandle.style.cursor = '';

      // Cancel any pending animation frame
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }

      // Final size update
      updateSize();
    }
  });
}

// Focus a window (bring to front)
function focusWindow(id) {
  const window = document.getElementById(id);
  if (window) {
    window.style.zIndex = ++zIndexCounter;
    currentlyFocusedWindow = id;
  }
}

// Close a window and remove it from active windows
function closeWindow(id) {
  const window = document.getElementById(id);
  if (window) {
    window.remove();
    activeWindows = activeWindows.filter((w) => w !== id);
    // Clear focused window if this was the focused one
    if (currentlyFocusedWindow === id) {
      currentlyFocusedWindow = null;
    }
    updateSystemStats();
  }
}

// Minimize a window with animation
function minimizeWindow(id) {
  const window = document.getElementById(id);
  if (window) {
    window.style.transform += ' scale(0.1)';
    window.style.opacity = '0.5';
    setTimeout(() => {
      window.style.display = 'none';
    }, 200);
  }
}

// Maximize or restore a window
function maximizeWindow(id) {
  const window = document.getElementById(id);
  if (window) {
    // Account for desktop header space (approximately 40px for terminal bar)
    // and taskbar space (approximately 60px for taskbar at bottom)
    const headerOffset = 40;
    const taskbarOffset = 60;

    if (window.style.width === '100%') {
      // Restore
      window.style.width = '800px';
      window.style.height = '600px';
      window.style.top = `${headerOffset + 50}px`;
      window.style.left = '100px';
    } else {
      // Maximize - fill available space between header and taskbar
      window.style.width = '100%';
      window.style.height = `calc(100% - ${headerOffset + taskbarOffset}px)`;
      window.style.top = `${headerOffset}px`;
      window.style.left = '0';
      window.style.transform = 'none';
    }
  }
}

// Utility functions for getting window state
function getActiveWindows() {
  return activeWindows;
}

function getCurrentlyFocusedWindow() {
  return currentlyFocusedWindow;
}

function getAvailableApps() {
  return availableApps;
}

// Create the window management namespace
const namespace_window = {
  // Public functions
  openApp,
  createWindow,
  focusWindow,
  closeWindow,
  minimizeWindow,
  maximizeWindow,
  getActiveWindows,
  getCurrentlyFocusedWindow,
  getAvailableApps
};

// Make the namespace globally available
window.namespace_window = namespace_window;

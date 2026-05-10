/**
 * Heyming OS - Main Orchestrator
 * Thin coordinator that wires up all subsystems
 */

import { Config, debug, isFirstRun } from './config.js';
import { Constants, MessageTypes } from './constants.js';
import { SetupWizardController } from './SetupWizardController.js';
import { bindIframeMessageListener } from './IframeMessageBridge.js';
import { InputHandler } from './InputHandler.js';
import { WindowManager } from './WindowManager.js';
import { Taskbar } from './Taskbar.js';
import { Launcher } from './Launcher.js';
import { Desktop } from './Desktop.js';
import { NotificationService } from './NotificationService.js';
import { Clock } from './Clock.js';
import { ContextMenu } from './ContextMenu.js';
import { FileDialog } from './FileDialog.js';

// FileSystemDB is loaded as a regular script (for iframe compatibility)
const FileSystemDB = window.FileSystemDB;

export class HeymingOS {
  constructor() {
    this.isVisible = false;
    this.C = Constants;
    this.fileSystemDB = null;
    /** @type {HTMLElement | null} */
    this._shutdownDialogPriorFocus = null;

    // Initialize subsystems
    this.windowManager = new WindowManager();
    this.taskbar = new Taskbar(this.windowManager);
    this.launcher = new Launcher((appId) => this.launchApp(appId, 'launcher'));
    this.desktop = new Desktop(
      (appId) => this.launchApp(appId, 'desktop'),
      (file) => {
        void this.openDesktopFile(file).catch((err) => {
          console.error('[HeymingOS] openDesktopFile failed', err);
          this.notifications?.error?.(`Could not open file: ${err?.message || err}`);
        });
      }
    );
    this.notifications = new NotificationService();
    this.clock = new Clock();
    this.contextMenu = new ContextMenu(this);
    this.fileDialog = new FileDialog(this);
    this.setupWizard = new SetupWizardController(this);

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.init());
    } else {
      this.init();
    }
  }

  async init() {
    // Get shared filesystem instance (singleton)
    if (FileSystemDB) {
      this.fileSystemDB = await FileSystemDB.getInstance();
      this._subscribeToFilesystemEvents();
    }

    // Initialize all subsystems (DOM is now ready)
    this.taskbar.init();
    this.notifications.init();
    await this._safeInit('desktop', () => this.desktop.init());
    this.launcher.init();
    this.clock.init();
    this.contextMenu.init();
    this.fileDialog.init();

    // Initialize keyboard tracking
    InputHandler.initKeyboardTracking();
    InputHandler.onMetaKeyAlone(() => {
      if (this.isVisible) {
        this.launcher.toggle();
      }
    });

    this._bindEvents();
    this._handleViewportChanges();
    this._unbindIframeMessages = bindIframeMessageListener(this);
  }

  /**
   * Subscribe to filesystem events and propagate changes
   */
  _subscribeToFilesystemEvents() {
    const desktopPath = Config.DESKTOP;

    // Listen for all filesystem events
    const handleFilesystemEvent = (eventType, path, details) => {
      // Check if the change affects the desktop (segment-aware; see FileSystemDB.pathIsDescendantOrSelf)
      const affectsDesktop =
        FileSystemDB.pathIsDescendantOrSelf(path, desktopPath) ||
        details.parentPath === desktopPath ||
        details.oldParentPath === desktopPath ||
        details.newParentPath === desktopPath;

      if (affectsDesktop) {
        // Refresh desktop icons
        this.desktop.refresh();
      }

      // Broadcast to all app iframes that filesystem changed
      this._broadcastFilesystemChange(path, { ...details, eventType });
    };

    // Subscribe to all filesystem event types
    ['create', 'delete', 'move', 'copy', 'change'].forEach((eventType) => {
      FileSystemDB.on(eventType, (path, details) => {
        handleFilesystemEvent(eventType, path, details);
      });
    });
  }

  /**
   * Broadcast filesystem changes to all open app iframes
   */
  _broadcastFilesystemChange(path, details) {
    // Get all open windows with iframes
    const windows = this.windowManager.windows;
    windows.forEach((win) => {
      const iframe = win.element?.querySelector('iframe');
      if (iframe?.contentWindow) {
        try {
          iframe.contentWindow.postMessage(
            {
              type: MessageTypes.FILESYSTEM_CHANGE,
              path,
              details
            },
            { targetOrigin: '*' }
          );
        } catch (e) {
          // Ignore cross-origin errors
        }
      }
    });
  }

  // ========== Public API ==========

  show() {
    if (isFirstRun()) {
      this.setupWizard.show();
      return;
    }
    this._showDesktop();
  }

  _showDesktop() {
    const osElement = document.getElementById('heyming-os');
    if (osElement) {
      osElement.classList.remove('hidden');
      osElement.classList.add('os-fade-in');
      this.isVisible = true;

      document.body.style.overflow = 'hidden';

      setTimeout(() => {
        this.windowManager.adjustWindowsToViewport(true);
      }, 100);

      setTimeout(() => {
        this.notifications.system(`Welcome to Heyming OS v1.0, ${Config.USER}!`);
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

        document.body.style.overflow = '';
        this.windowManager.closeAllWindows();
        this.taskbar.clear();
      }, this.C.ANIMATION_DURATION);
    }
    window.location.href = '/';
  }

  toggle() {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }

  launchApp(appId, source = 'unknown') {
    // Check AppModule for app
    if (window.AppModule) {
      const apps = window.AppModule.getAllApps();
      const app = apps.find((a) => a.id === appId);
      if (app) {
        const win = this.windowManager.createIframeWindow(app);
        this.taskbar.createButton(win.id, win.title);
        // Ensure the new window is active and on top
        this.windowManager.makeWindowActive(win.id);
        this.taskbar.update();
        // Single chokepoint for "user opened an app inside the OS".
        // `source` distinguishes the start menu, desktop double-click,
        // right-click "Open with", cross-app launch (iframe message),
        // file association, and the file-open fallback below. This is
        // separate from the home page `gallery_app_click` event — that
        // one fires before navigation, this one fires inside the OS.
        if (typeof window.trackEvent === 'function') {
          window.trackEvent('os_app_launch', 'OS', `${appId}:${source}`);
        }
        if (typeof window.trackProjectOpen === 'function') {
          window.trackProjectOpen(app.shortName || app.name || appId);
        }
        return win;
      }
    }

    this.notifications.error(`App "${appId}" not found`);
    return null;
  }

  // Expose for external use (e.g., terminal command)
  bringAllWindowsIntoView() {
    const count = this.windowManager.bringAllWindowsIntoView();
    if (count > 0) {
      this.notifications.system(`${count} window${count > 1 ? 's' : ''} moved back into view`);
    } else {
      this.notifications.info('No windows to move');
    }
  }

  // ========== Private Methods ==========

  _bindEvents() {
    this._setupShutdownDialog();
    this._setupLauncher();
    this._setupGlobalKeyboardShortcuts();
    this._setupWindowManagerCallbacks();
  }

  _setupShutdownDialog() {
    const shutdownBtn = document.getElementById('os-close');
    const shutdownCancel = document.getElementById('shutdown-cancel');
    const shutdownConfirm = document.getElementById('shutdown-confirm');
    const shutdownDialog = document.getElementById('shutdown-dialog');

    shutdownBtn?.addEventListener('click', () => this._showShutdownDialog());
    shutdownCancel?.addEventListener('click', () => this._hideShutdownDialog());
    shutdownConfirm?.addEventListener('click', () => this._confirmShutdown());
    shutdownDialog?.addEventListener('click', (e) => {
      if (e.target === shutdownDialog) this._hideShutdownDialog();
    });

    shutdownDialog?.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab' || !this._isShutdownDialogVisible()) return;
      const buttons = shutdownDialog.querySelectorAll('button:not([disabled])');
      const list = Array.from(buttons);
      if (list.length < 2) return;
      const first = /** @type {HTMLElement} */ (list[0]);
      const last = /** @type {HTMLElement} */ (list[list.length - 1]);
      const active = /** @type {Element|null} */ (document.activeElement);
      if (e.shiftKey) {
        if (active === first) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        e.preventDefault();
        first.focus();
      }
    });
  }

  _setupLauncher() {
    const appLauncher = document.getElementById('app-launcher');
    const desktop = document.getElementById('os-desktop');

    appLauncher?.addEventListener('click', () => this.launcher.toggle());

    // Hide launcher when clicking outside
    document.addEventListener('click', (e) => {
      const launcher = document.getElementById('app-launcher');
      const menu = document.getElementById('app-launcher-menu');
      const tgt = /** @type {Node} */ (e.target);
      if (this.launcher.isVisible() && !launcher?.contains(tgt) && !menu?.contains(tgt)) {
        this.launcher.hide();
      }
    });

    // Desktop double-click to hide launcher
    desktop?.addEventListener('dblclick', (e) => {
      if (e.target === desktop && this.launcher.isVisible()) {
        this.launcher.hide();
      }
    });
  }

  _setupGlobalKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const launcherExpanded =
          document.getElementById('app-launcher')?.getAttribute('aria-expanded') === 'true';
        const launcherMenu = document.getElementById('app-launcher-menu');
        // While the close animation runs, isVisible() is already false and aria-expanded is false,
        // but the menu is still on-screen without .hidden — avoid falling through to OS hide().
        const launcherMenuOnScreen = launcherMenu && !launcherMenu.classList.contains('hidden');
        if (this._isShutdownDialogVisible()) {
          e.preventDefault();
          this._hideShutdownDialog();
        } else if (this.launcher.isVisible() || launcherExpanded || launcherMenuOnScreen) {
          this.launcher.hide();
          e.preventDefault();
        } else if (this.contextMenu?.visible) {
          this.contextMenu.hide();
          e.preventDefault();
        } else if (this.isVisible) {
          this.hide();
        }
      }

      if (this._isShutdownDialogVisible() && e.key === 'Enter') {
        if (document.activeElement?.id === 'shutdown-confirm') {
          e.preventDefault();
          this._confirmShutdown();
        }
      }
    });
  }

  _setupWindowManagerCallbacks() {
    // Subscribe to window manager events (clean event-driven approach)
    this.windowManager.on('close', (windowId) => {
      this.taskbar.removeButton(windowId);
      this.taskbar.update();
    });

    this.windowManager.on('minimize', () => {
      this.taskbar.update();
    });

    this.windowManager.on('focus', () => {
      this.taskbar.update();
    });
  }

  _showShutdownDialog() {
    const dialog = document.getElementById('shutdown-dialog');
    if (!dialog) return;
    const ae = document.activeElement;
    this._shutdownDialogPriorFocus = ae instanceof HTMLElement ? ae : null;
    dialog.classList.remove('hidden');
    dialog.setAttribute('aria-hidden', 'false');
    setTimeout(() => {
      dialog.style.animation = 'fadeIn 0.2s ease-out';
    }, 10);
    requestAnimationFrame(() => {
      document.getElementById('shutdown-cancel')?.focus();
    });
  }

  _hideShutdownDialog() {
    const dialog = document.getElementById('shutdown-dialog');
    if (!dialog) return;
    dialog.setAttribute('aria-hidden', 'true');
    dialog.style.animation = 'fadeOut 0.2s ease-in';
    setTimeout(() => {
      dialog.classList.add('hidden');
      dialog.style.animation = '';
      const prior = this._shutdownDialogPriorFocus;
      this._shutdownDialogPriorFocus = null;
      if (prior && typeof prior.focus === 'function') {
        try {
          prior.focus();
        } catch (_) {
          /* ignore cross-document focus */
        }
      }
    }, 200);
  }

  _confirmShutdown() {
    this._hideShutdownDialog();
    this.notifications.system('Shutting down Heyming OS...');
    setTimeout(() => {
      this.hide();
    }, 1000);
  }

  _isShutdownDialogVisible() {
    const dialog = document.getElementById('shutdown-dialog');
    return dialog && !dialog.classList.contains('hidden');
  }

  /**
   * Safely initialize a subsystem with error boundary
   * @param {string} name - Subsystem name for logging
   * @param {Function} initFn - Async init function
   */
  async _safeInit(name, initFn) {
    try {
      await initFn();
    } catch (error) {
      console.error(`[HeymingOS] Failed to initialize ${name}:`, error);
      this.notifications?.error(`Failed to initialize ${name}`);
    }
  }

  _handleViewportChanges() {
    let resizeTimeout;
    const handleResize = () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        this.windowManager.adjustWindowsToViewport();
      }, this.C.RESIZE_DEBOUNCE);
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', () => {
      setTimeout(() => {
        this.windowManager.adjustWindowsToViewport(true);
      }, 300);
    });
  }

  /**
   * Open a file from the desktop
   */
  async openDesktopFile(file) {
    if (!file?.path) return;

    const fileName = this.fileSystemDB?.getFileName(file.path) || file.path.split('/').pop();

    let item = file;
    if (this.fileSystemDB) {
      try {
        const full = await this.fileSystemDB.getItem(file.path);
        if (full && full.type === 'file') {
          item = full;
          if (file.mimeType && !item.mimeType) {
            item = { ...item, mimeType: file.mimeType };
          }
        }
      } catch (e) {
        debug('openDesktopFile: getItem failed', e);
      }
    }

    const mimeType = FileSystemDB ? FileSystemDB.mimeTypeForOpen(item) : 'application/octet-stream';

    const appInfo = window.AppModule.getAppForMimeType(mimeType);

    if (appInfo) {
      const content = FileSystemDB ? FileSystemDB.getContentForApp(item) : file.content ?? '';
      this.openFileWithApp(appInfo.appId, file.path, content, fileName);
    } else {
      this._showOpenWithDialog(item, file, fileName, mimeType);
    }
  }

  _showOpenWithDialog(item, file, fileName, mimeType) {
    const allApps = window.AppModule?.getAllApps?.() || [];
    const openableApps = allApps.filter((a) => a.handles && a.handles.length > 0);

    if (openableApps.length === 0) {
      this.notifications.info(`Cannot open: ${fileName} (${mimeType})`);
      return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'open-with-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', `Open ${fileName} with`);

    const panel = document.createElement('div');
    panel.className = 'open-with-panel';

    const header = document.createElement('div');
    header.className = 'open-with-header';
    header.innerHTML =
      `<div class="open-with-file-icon">📄</div>` +
      `<div class="open-with-header-text">` +
      `<h3 class="open-with-title">Open "${fileName}"</h3>` +
      `<p class="open-with-subtitle">No default app for this file type (${mimeType}).<br>Choose an application:</p>` +
      `</div>`;
    panel.appendChild(header);

    const list = document.createElement('div');
    list.className = 'open-with-list';

    for (const app of openableApps) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'open-with-app-btn';
      btn.innerHTML =
        `<span class="open-with-app-icon">${app.icon || '📦'}</span>` +
        `<span class="open-with-app-name">${app.name}</span>`;
      btn.addEventListener('click', () => {
        overlay.remove();
        const content = FileSystemDB ? FileSystemDB.getContentForApp(item) : file.content ?? '';
        this.openFileWithApp(app.id, file.path, content, fileName);
      });
      list.appendChild(btn);
    }
    panel.appendChild(list);

    const footer = document.createElement('div');
    footer.className = 'open-with-footer';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'open-with-cancel-btn';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => overlay.remove());
    footer.appendChild(cancelBtn);
    panel.appendChild(footer);

    overlay.appendChild(panel);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') overlay.remove();
    });

    document.getElementById('heyming-os').appendChild(overlay);
    cancelBtn.focus();
  }

  /**
   * Show Save As dialog for an app
   */
  showSaveAsDialog(content, suggestedName, sourceWindowId, sourceWindow) {
    this.fileDialog.showSaveAs({
      content: content,
      suggestedName: suggestedName || 'untitled.txt',
      currentPath: Config.HOME,
      onSave: (path, filename) => {
        // Refresh desktop if saved to Desktop folder
        if (path.startsWith(Config.DESKTOP)) {
          this.desktop.refresh();
        }

        // Notify the source app that the file was saved
        if (sourceWindow) {
          sourceWindow.postMessage(
            {
              type: MessageTypes.FILE_SAVED,
              success: true,
              path: path,
              fileName: filename
            },
            '*'
          );
        }
      }
    });
  }

  /**
   * Show Open File dialog for an app
   */
  showOpenFileDialog(fileTypes, title, sourceWindow) {
    this.fileDialog.showOpen({
      currentPath: Config.HOME,
      fileTypes: fileTypes || null,
      onOpen: (item) => {
        // Send the file to the requesting app
        if (sourceWindow) {
          const fileName = this.fileSystemDB?.getFileName(item.path) || item.path.split('/').pop();
          const content = FileSystemDB ? FileSystemDB.getContentForApp(item) : item.content ?? '';
          sourceWindow.postMessage(
            {
              type: MessageTypes.OPEN_FILE,
              path: item.path,
              content,
              fileName: fileName
            },
            '*'
          );
        }
      }
    });
  }

  /**
   * Save a file to the shared filesystem
   */
  async saveFileToFilesystem(path, content, fileName) {
    try {
      // Access the shared filesystem
      if (!this.fileSystemDB) {
        this.notifications.error('Filesystem not available');
        return;
      }

      await this.fileSystemDB.createFile(path, content, true); // overwrite = true

      this.notifications.success(`💾 Saved: ${fileName}`);
    } catch (error) {
      console.error('Failed to save file:', error);
      this.notifications.error(`Failed to save: ${error.message}`);
    }
  }

  /**
   * Open a file with a specific app, passing the content
   */
  openFileWithApp(appId, path, content, fileName) {
    // Store the file info for the app to pick up (backup in case message is missed)
    this.pendingFileOpen = {
      app: appId,
      path: path,
      content: content,
      fileName: fileName
    };

    // Launch a NEW instance of the app and get the window reference
    const newWindow = this.launchApp(appId, 'file_open');
    if (!newWindow) {
      this.pendingFileOpen = null;
      return;
    }

    // Send file to the specific new window
    const sendFileToNewWindow = () => {
      const iframe = newWindow.element?.querySelector('iframe');
      if (iframe) {
        const sendMessage = () => {
          debug('Sending file to new window:', appId, fileName, 'windowId:', newWindow.id);
          iframe.contentWindow.postMessage(
            {
              type: MessageTypes.OPEN_FILE,
              path: path,
              content: content,
              fileName: fileName
            },
            '*'
          );
          this.pendingFileOpen = null;
        };

        // If iframe is already loaded, send immediately with a small delay for JS init
        if (iframe.contentDocument?.readyState === 'complete') {
          setTimeout(sendMessage, 100);
        } else {
          // Wait for iframe to load
          iframe.addEventListener('load', () => setTimeout(sendMessage, 100), { once: true });
        }
        return;
      }

      // Retry if iframe not ready yet
      setTimeout(sendFileToNewWindow, 50);
    };

    setTimeout(sendFileToNewWindow, 50);
  }
}

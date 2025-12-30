/**
 * Heyming OS - Context Menu
 * Right-click menu for desktop and files
 */

export class ContextMenu {
  constructor(heymingOS) {
    this.os = heymingOS;
    this.menu = null;
    this.fileMenu = null;
    this.visible = false;
    this.currentFile = null; // Track which file is being right-clicked
  }

  /**
   * Initialize context menu
   */
  init() {
    this._createMenuElement();
    this._createFileMenuElement();
    this._bindEvents();
  }

  /**
   * Show desktop context menu at position
   */
  show(x, y) {
    this._hideAll();

    // Update paste menu item state based on clipboard contents
    const pasteItem = this.menu.querySelector('.paste-item');
    if (pasteItem) {
      const ClipboardSvc = window.HeymingOS?.ClipboardService;
      pasteItem.classList.toggle('disabled', !ClipboardSvc?.hasItems());
    }

    this._positionAndShow(this.menu, x, y);
    this.visible = true;
  }

  /**
   * Show file context menu at position
   */
  showFileMenu(x, y, file) {
    this._hideAll();
    this.currentFile = file;

    // Update menu to show filename
    const header = this.fileMenu.querySelector('.context-menu-header');
    if (header) {
      const name = this.os.fileSystemDB?.getFileName(file.path) || file.path.split('/').pop();
      header.textContent = name.length > 20 ? name.substring(0, 18) + '...' : name;
    }

    this._positionAndShow(this.fileMenu, x, y);
    this.visible = true;
  }

  /**
   * Hide all context menus
   */
  hide() {
    this._hideAll();
    this.visible = false;
    this.currentFile = null;
  }

  _hideAll() {
    if (this.menu) {
      this.menu.classList.remove('show');
      this.menu.classList.add('hidden');
    }
    if (this.fileMenu) {
      this.fileMenu.classList.remove('show');
      this.fileMenu.classList.add('hidden');
    }
  }

  _positionAndShow(menuEl, x, y) {
    if (!menuEl) return;

    const menuWidth = 200;
    const menuHeight = menuEl.offsetHeight || 200;

    let posX = x;
    let posY = y;

    if (x + menuWidth > window.innerWidth) {
      posX = window.innerWidth - menuWidth - 10;
    }
    if (y + menuHeight > window.innerHeight - 48) {
      posY = y - menuHeight;
    }

    menuEl.style.left = posX + 'px';
    menuEl.style.top = posY + 'px';
    menuEl.classList.remove('hidden');
    menuEl.classList.add('show');
  }

  // ========== Private Methods ==========

  _createMenuElement() {
    this.menu = document.createElement('div');
    this.menu.id = 'desktop-context-menu';
    this.menu.className = 'context-menu hidden';

    // Build system apps section from registry
    const systemApps = window.AppModule?.getSystemApps() || [];
    const systemAppsHtml = systemApps
      .map(
        (app) =>
          `<div class="context-menu-item" data-action="launch" data-app="${app.id}">${app.icon} Open ${app.shortName}</div>`
      )
      .join('');

    this.menu.innerHTML = `
      <div class="context-menu-item" data-action="refresh">
        🔄 Refresh Desktop
      </div>
      <div class="context-menu-item" data-action="arrange">
        📐 Arrange Icons
      </div>
      <div class="context-menu-item paste-item" data-action="paste">
        📋 Paste
      </div>
      <div class="context-menu-divider"></div>
      ${systemAppsHtml}
      <div class="context-menu-divider"></div>
      <div class="context-menu-item" data-action="bring-windows">
        🪟 Bring All Windows to View
      </div>
      <div class="context-menu-divider"></div>
      <div class="context-menu-item" data-action="about">
        🦄 About Heyming OS
      </div>
    `;

    document.getElementById('os-desktop').appendChild(this.menu);
  }

  _createFileMenuElement() {
    this.fileMenu = document.createElement('div');
    this.fileMenu.id = 'file-context-menu';
    this.fileMenu.className = 'context-menu hidden';

    this.fileMenu.innerHTML = `
      <div class="context-menu-header">filename.txt</div>
      <div class="context-menu-divider"></div>
      <div class="context-menu-item" data-action="file-open">
        📂 Open
      </div>
      <div class="context-menu-item" data-action="file-open-notepad">
        📝 Open with Notepad
      </div>
      <div class="context-menu-item" data-action="file-download">
        📥 Download
      </div>
      <div class="context-menu-divider"></div>
      <div class="context-menu-item" data-action="file-copy">
        📋 Copy
      </div>
      <div class="context-menu-item" data-action="file-cut">
        ✂️ Cut
      </div>
      <div class="context-menu-divider"></div>
      <div class="context-menu-item" data-action="file-delete">
        🗑️ Delete
      </div>
    `;

    document.getElementById('os-desktop').appendChild(this.fileMenu);
  }

  _bindEvents() {
    const desktop = document.getElementById('os-desktop');

    // Show on right-click
    desktop.addEventListener('contextmenu', (e) => {
      // Check if right-clicking on a file icon
      const fileIcon = e.target.closest('.file-icon');
      if (fileIcon) {
        e.preventDefault();
        const path = fileIcon.dataset.path;
        if (path) {
          // Get file info and show file menu
          this._getFileAndShowMenu(path, e.clientX, e.clientY);
        }
        return;
      }

      // Only show desktop menu if clicking on desktop, not on windows/app icons
      if (e.target === desktop || e.target.closest('#os-desktop') === desktop) {
        if (!e.target.closest('.os-window') && !e.target.closest('.desktop-icon')) {
          e.preventDefault();
          this.show(e.clientX, e.clientY);
        }
      }
    });

    // Hide on click elsewhere
    document.addEventListener('click', () => {
      if (this.visible) {
        this.hide();
      }
    });

    // Handle desktop menu item clicks
    this.menu.addEventListener('click', (e) => {
      const item = e.target.closest('.context-menu-item');
      if (!item) return;

      const action = item.dataset.action;
      const appId = item.dataset.app;
      this._handleAction(action, appId);
      this.hide();
    });

    // Handle file menu item clicks
    this.fileMenu.addEventListener('click', (e) => {
      const item = e.target.closest('.context-menu-item');
      if (!item) return;

      const action = item.dataset.action;
      this._handleFileAction(action);
      this.hide();
    });

    // Hide on escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.visible) {
        this.hide();
      }
    });
  }

  async _getFileAndShowMenu(path, x, y) {
    try {
      const fs = this.os.fileSystemDB;
      if (!fs) return;

      const file = await fs.getItem(path);
      if (file) {
        this.showFileMenu(x, y, file);
      }
    } catch (error) {
      console.error('Failed to get file info:', error);
    }
  }

  _handleAction(action, appId) {
    switch (action) {
      case 'refresh':
        this.os.desktop.refresh();
        this.os.notifications.system('Desktop refreshed');
        break;
      case 'arrange':
        this.os.notifications.system('Icons arranged');
        break;
      case 'paste':
        this._pasteToDesktop();
        break;
      case 'launch':
        if (appId) {
          this.os.launchApp(appId);
        }
        break;
      case 'bring-windows':
        this.os.bringAllWindowsIntoView();
        break;
      case 'about':
        this._showAbout();
        break;
    }
  }

  async _handleFileAction(action) {
    if (!this.currentFile) return;

    const file = this.currentFile;
    const fileName = this.os.fileSystemDB?.getFileName(file.path) || file.path.split('/').pop();

    switch (action) {
      case 'file-open':
        // Use MIME type to determine how to open
        this.os.openDesktopFile(file);
        break;

      case 'file-open-notepad':
        // Force open in Notepad regardless of MIME type
        this.os.openFileWithApp('notepad', file.path, file.content, fileName);
        break;

      case 'file-download':
        this._downloadFile(file);
        break;

      case 'file-copy':
        this._copyFile(file);
        break;

      case 'file-cut':
        this._cutFile(file);
        break;

      case 'file-delete':
        await this._deleteFile(file);
        break;
    }
  }

  _downloadFile(file) {
    const fileName = this.os.fileSystemDB?.getFileName(file.path) || file.path.split('/').pop();
    const content = file.content || '';
    const mimeType = file.mimeType || 'text/plain';

    try {
      if (typeof content === 'string' && content.startsWith('data:')) {
        // Content is a data URL (binary file) - convert asynchronously
        fetch(content)
          .then((res) => res.blob())
          .then((b) => this._triggerDownload(b, fileName, mimeType));
        return;
      }

      const blob = new Blob([content], { type: mimeType });
      this._triggerDownload(blob, fileName, mimeType);
    } catch (error) {
      console.error('Download failed:', error);
      this.os.notifications.error(`Download failed: ${fileName}`);
    }
  }

  _triggerDownload(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    this.os.notifications.system(`📥 Downloaded: ${fileName}`);
  }

  async _deleteFile(file) {
    const fileName = this.os.fileSystemDB?.getFileName(file.path) || file.path.split('/').pop();

    // Confirm deletion
    if (!confirm(`Delete "${fileName}"?`)) {
      return;
    }

    try {
      const fs = this.os.fileSystemDB;
      if (!fs) return;

      await fs.deleteItem(file.path);
      this.os.desktop.refresh();
      this.os.notifications.system(`Deleted: ${fileName}`);
    } catch (error) {
      console.error('Failed to delete file:', error);
      this.os.notifications.system(`Failed to delete: ${fileName}`);
    }
  }

  _copyFile(file) {
    const FileOps = window.HeymingOS?.FileOperationService;
    if (FileOps) {
      const result = FileOps.copy(this.os.fileSystemDB, [file.path], 'desktop');
      if (result.message) this.os.notifications.system(result.message);
    }
  }

  _cutFile(file) {
    const FileOps = window.HeymingOS?.FileOperationService;
    if (FileOps) {
      const result = FileOps.cut(this.os.fileSystemDB, [file.path], 'desktop');
      if (result.message) this.os.notifications.system(result.message);
    }
  }

  async _pasteToDesktop() {
    const FileOps = window.HeymingOS?.FileOperationService;
    const desktopPath = window.HeymingOS?.Config?.DESKTOP || '/home/user/Desktop';

    const result = await FileOps?.paste(this.os.fileSystemDB, desktopPath);
    if (result?.message) {
      this.os.notifications[result.success ? 'system' : 'error'](result.message);
    }
    if (result?.success) {
      this.os.desktop.refresh();
    }
  }

  _showAbout() {
    this.os.notifications.system('Heyming OS v1.0 🦄 Built with love by Joe Heyming');
  }
}

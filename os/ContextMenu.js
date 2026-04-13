/**
 * Heyming OS - Context Menu
 * Right-click menu for desktop and files
 */

export class ContextMenu {
  /** @param {unknown} s */
  static _escapeHtmlAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  /** @param {unknown} s */
  static _escapeHtmlText(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  }

  constructor(heymingOS) {
    this.os = heymingOS;
    this.menu = null;
    this.fileMenu = null;
    this.visible = false;
    this.currentFile = null; // Track which file is being right-clicked
    this._onMenuKeydown = this._onMenuKeydown.bind(this);
  }

  /**
   * Initialize context menu
   */
  init() {
    this._createMenuElement();
    this._createFileMenuElement();
    this._bindEvents();
    document.addEventListener('keydown', this._onMenuKeydown, true);
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
    const header = this.fileMenu.querySelector('#file-context-header');
    if (header) {
      const name = this.os.fileSystemDB?.getFileName(file.path) || file.path.split('/').pop();
      header.textContent = name.length > 20 ? name.substring(0, 18) + '...' : name;
    }

    this._populateOpenWithMenu(file);

    this._positionAndShow(this.fileMenu, x, y);
    this.visible = true;
  }

  /**
   * MIME-based "Open with …" rows (same routing as openDesktopFile) plus Notepad fallback when
   * notepad is not already a registered handler (force-open as text).
   */
  _populateOpenWithMenu(file) {
    const container = this.fileMenu.querySelector('#file-open-with-dynamic');
    if (!container) return;

    const F = window.FileSystemDB;
    const mime = F ? F.mimeTypeForOpen(file) : 'application/octet-stream';
    const apps = window.AppModule?.getAppsForMimeType?.(mime) || [];
    const seen = new Set(apps.map((a) => a.appId));
    const lines = [];

    for (const app of apps) {
      const id = ContextMenu._escapeHtmlAttr(app.appId);
      const icon = ContextMenu._escapeHtmlText(app.icon || '');
      const name = ContextMenu._escapeHtmlText(app.shortName || '');
      lines.push(
        `<div class="context-menu-item" role="menuitem" tabindex="-1" data-action="file-open-with" data-app="${id}">${icon} Open with ${name}</div>`
      );
    }

    if (!seen.has('notepad')) {
      lines.push(
        `<div class="context-menu-item" role="menuitem" tabindex="-1" data-action="file-open-with" data-app="notepad">📝 Open with Notepad</div>`
      );
    }

    container.innerHTML = lines.join('');
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
      this.menu.setAttribute('aria-hidden', 'true');
    }
    if (this.fileMenu) {
      this.fileMenu.classList.remove('show');
      this.fileMenu.classList.add('hidden');
      this.fileMenu.setAttribute('aria-hidden', 'true');
    }
  }

  _positionAndShow(menuEl, x, y) {
    if (!menuEl) return;

    const margin = 8;
    const taskbarPad = 48;

    menuEl.style.left = `${Math.max(margin, x)}px`;
    menuEl.style.top = `${Math.max(margin, y)}px`;
    menuEl.classList.remove('hidden');
    menuEl.classList.add('show');
    menuEl.setAttribute('aria-hidden', 'false');
    this._focusFirstMenuItem(menuEl);

    requestAnimationFrame(() => {
      const rect = menuEl.getBoundingClientRect();
      let dx = 0;
      let dy = 0;
      if (rect.right > window.innerWidth - margin) {
        dx -= rect.right - (window.innerWidth - margin);
      }
      if (rect.bottom > window.innerHeight - taskbarPad) {
        dy -= rect.bottom - (window.innerHeight - taskbarPad);
      }
      if (rect.left + dx < margin) {
        dx = margin - rect.left;
      }
      if (rect.top + dy < margin) {
        dy = margin - rect.top;
      }
      if (dx !== 0 || dy !== 0) {
        const curLeft = parseFloat(menuEl.style.left) || 0;
        const curTop = parseFloat(menuEl.style.top) || 0;
        menuEl.style.left = `${curLeft + dx}px`;
        menuEl.style.top = `${curTop + dy}px`;
      }
    });
  }

  _menuItems(menuEl) {
    return Array.from(menuEl.querySelectorAll('[role="menuitem"]')).filter(
      (el) => !el.classList.contains('disabled')
    );
  }

  _focusFirstMenuItem(menuEl) {
    const items = this._menuItems(menuEl);
    if (!items.length) return;
    items[0].focus();
  }

  _focusMenuItemAt(menuEl, index) {
    const items = this._menuItems(menuEl);
    if (!items.length) return;
    const i = ((index % items.length) + items.length) % items.length;
    items[i].focus();
  }

  _openMenuEl() {
    if (this.menu?.classList.contains('show')) return this.menu;
    if (this.fileMenu?.classList.contains('show')) return this.fileMenu;
    return null;
  }

  _onMenuKeydown(e) {
    if (!this.visible) return;
    const open = this._openMenuEl();
    if (!open) return;
    if (!open.contains(document.activeElement)) return;

    const items = this._menuItems(open);
    if (!items.length) return;
    let idx = items.indexOf(document.activeElement);
    if (idx < 0) idx = 0;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        this._focusMenuItemAt(open, idx + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        this._focusMenuItemAt(open, idx - 1);
        break;
      case 'Home':
        e.preventDefault();
        this._focusMenuItemAt(open, 0);
        break;
      case 'End':
        e.preventDefault();
        this._focusMenuItemAt(open, items.length - 1);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        /** @type {HTMLElement|null} */ (document.activeElement)?.click();
        break;
      case 'Tab':
        this.hide();
        break;
      default:
        break;
    }
  }

  // ========== Private Methods ==========

  _createMenuElement() {
    this.menu = document.createElement('div');
    this.menu.id = 'desktop-context-menu';
    this.menu.className = 'context-menu hidden';
    this.menu.setAttribute('role', 'menu');
    this.menu.setAttribute('aria-label', 'Desktop');
    this.menu.setAttribute('aria-hidden', 'true');

    // Build system apps section from registry
    const systemApps = window.AppModule?.getSystemApps() || [];
    const systemAppsHtml = systemApps
      .map(
        (app) =>
          `<div class="context-menu-item" role="menuitem" tabindex="-1" data-action="launch" data-app="${app.id}">${app.icon} Open ${app.shortName}</div>`
      )
      .join('');

    this.menu.innerHTML = `
      <div class="context-menu-item" role="menuitem" tabindex="-1" data-action="refresh">
        🔄 Refresh Desktop
      </div>
      <div class="context-menu-item" role="menuitem" tabindex="-1" data-action="arrange">
        📐 Arrange Icons
      </div>
      <div class="context-menu-item paste-item" role="menuitem" tabindex="-1" data-action="paste">
        📋 Paste
      </div>
      <div class="context-menu-divider" role="separator"></div>
      ${systemAppsHtml}
      <div class="context-menu-divider" role="separator"></div>
      <div class="context-menu-item" role="menuitem" tabindex="-1" data-action="bring-windows">
        🪟 Bring All Windows to View
      </div>
      <div class="context-menu-divider" role="separator"></div>
      <div class="context-menu-item" role="menuitem" tabindex="-1" data-action="about">
        🦄 About Heyming OS
      </div>
    `;

    document.getElementById('os-desktop').appendChild(this.menu);
  }

  _createFileMenuElement() {
    this.fileMenu = document.createElement('div');
    this.fileMenu.id = 'file-context-menu';
    this.fileMenu.className = 'context-menu hidden';
    this.fileMenu.setAttribute('role', 'menu');
    this.fileMenu.setAttribute('aria-labelledby', 'file-context-header');
    this.fileMenu.setAttribute('aria-hidden', 'true');

    this.fileMenu.innerHTML = `
      <div id="file-context-header" class="context-menu-header" role="presentation">filename.txt</div>
      <div class="context-menu-divider" role="separator"></div>
      <div class="context-menu-item" role="menuitem" tabindex="-1" data-action="file-open">
        📂 Open
      </div>
      <div id="file-open-with-dynamic"></div>
      <div class="context-menu-item" role="menuitem" tabindex="-1" data-action="file-download">
        📥 Download
      </div>
      <div class="context-menu-item" role="menuitem" tabindex="-1" data-action="file-copy-path">
        📎 Copy path
      </div>
      <div class="context-menu-divider" role="separator"></div>
      <div class="context-menu-item" role="menuitem" tabindex="-1" data-action="file-copy">
        📋 Copy
      </div>
      <div class="context-menu-item" role="menuitem" tabindex="-1" data-action="file-cut">
        ✂️ Cut
      </div>
      <div class="context-menu-divider" role="separator"></div>
      <div class="context-menu-item" role="menuitem" tabindex="-1" data-action="file-delete">
        🗑️ Delete
      </div>
    `;

    document.getElementById('os-desktop').appendChild(this.fileMenu);
  }

  _bindEvents() {
    const desktop = document.getElementById('os-desktop');

    // Show on right-click
    desktop.addEventListener('contextmenu', (e) => {
      const target = /** @type {Element} */ (e.target);
      // Check if right-clicking on a file icon
      const fileIcon = /** @type {HTMLElement|null} */ (target.closest('.file-icon'));
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
      if (target === desktop || target.closest('#os-desktop') === desktop) {
        if (!target.closest('.os-window') && !target.closest('.desktop-icon')) {
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
      const item = /** @type {HTMLElement|null} */ (
        /** @type {Element} */ (e.target).closest('.context-menu-item')
      );
      if (!item) return;

      const action = item.dataset.action;
      const appId = item.dataset.app;
      this._handleAction(action, appId);
      this.hide();
    });

    // Handle file menu item clicks
    this.fileMenu.addEventListener('click', (e) => {
      const item = /** @type {HTMLElement|null} */ (
        /** @type {Element} */ (e.target).closest('.context-menu-item')
      );
      if (!item) return;

      const action = item.dataset.action;
      this._handleFileAction(action, item);
      this.hide();
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

  async _handleFileAction(action, clickedEl) {
    if (!this.currentFile) return;

    const file = this.currentFile;
    const fileName = this.os.fileSystemDB?.getFileName(file.path) || file.path.split('/').pop();

    switch (action) {
      case 'file-open':
        // Use MIME type to determine how to open (async; errors surfaced via HeymingOS handler)
        try {
          await this.os.openDesktopFile(file);
        } catch (err) {
          console.error('[ContextMenu] openDesktopFile', err);
          this.os.notifications?.error?.(`Could not open file: ${err?.message || err}`);
        }
        break;

      case 'file-open-with': {
        const appId = clickedEl?.dataset?.app;
        if (!appId) break;
        let item = file;
        try {
          if (this.os.fileSystemDB && file.path) {
            const full = await this.os.fileSystemDB.getItem(file.path);
            if (full && full.type === 'file') {
              item = full;
            }
          }
        } catch (_) {
          /* use shallow desktop icon payload */
        }
        const F = window.FileSystemDB;
        const content = F ? F.getContentForApp(item) : item.content ?? '';
        this.os.openFileWithApp(appId, file.path, content, fileName);
        break;
      }

      case 'file-download':
        await this._downloadFile(file);
        break;

      case 'file-copy-path':
        await this._copyVirtualPathToClipboard(file.path);
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

  async _downloadFile(file) {
    const fileName = this.os.fileSystemDB?.getFileName(file.path) || file.path.split('/').pop();
    let item = file;
    try {
      if (this.os.fileSystemDB && file.path) {
        const full = await this.os.fileSystemDB.getItem(file.path);
        if (full && full.type === 'file') {
          item = full;
        }
      }
    } catch (_) {
      /* use shallow desktop icon payload */
    }

    const F = window.FileSystemDB;
    const content = F ? F.getContentForApp(item) : item.content ?? '';
    const mimeType = item.mimeType || 'text/plain';

    try {
      if (typeof content === 'string' && content.startsWith('data:')) {
        fetch(content)
          .then((res) => res.blob())
          .then((b) => this._triggerDownload(b, fileName));
        return;
      }

      const blob = new Blob([content], { type: mimeType });
      this._triggerDownload(blob, fileName);
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

  /**
   * Copy the virtual FS path to the system clipboard (same path strings as jsh / FileSystemDB keys).
   */
  async _copyVirtualPathToClipboard(path) {
    if (!path) return;
    try {
      if (!navigator.clipboard?.writeText) {
        this.os.notifications?.error?.('Clipboard not available');
        return;
      }
      await navigator.clipboard.writeText(path);
      this.os.notifications.system(`Copied path: ${path}`);
    } catch (error) {
      console.error('[ContextMenu] copy path', error);
      this.os.notifications?.error?.(`Could not copy path: ${error?.message || error}`);
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

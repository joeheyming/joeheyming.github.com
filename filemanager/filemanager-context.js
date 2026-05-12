import { debug, escapeHtmlAttr, escapeHtmlText } from './filemanager-shared.js';
/** @param {new () => object} FileManager */
export function applyFileManagerContext(FileManager) {
  Object.assign(FileManager.prototype, {
    async showContextMenu(e) {
      const menu = document.getElementById('context-menu');

      // Check if right-clicked on a file item
      const fileItem = e.target.closest('.file-item');
      if (fileItem && !this.selectedItems.has(fileItem.dataset.path)) {
        this.selectedItems.clear();
        this.selectedItems.add(fileItem.dataset.path);
        this.renderFiles();
      }

      menu.style.left = e.clientX + 'px';
      menu.style.top = e.clientY + 'px';
      menu.classList.remove('hidden');
      menu.setAttribute('aria-hidden', 'false');

      await this._populateOpenWithMenu();

      // Adjust if menu goes off screen (after dynamic "Open with" rows)
      const rect = menu.getBoundingClientRect();
      if (rect.right > window.innerWidth) {
        menu.style.left = e.clientX - rect.width + 'px';
      }
      if (rect.bottom > window.innerHeight) {
        menu.style.top = e.clientY - rect.height + 'px';
      }

      this._focusFirstContextMenuItem(menu);
    },

    _contextMenuIsOpen() {
      const menu = document.getElementById('context-menu');
      return Boolean(menu && !menu.classList.contains('hidden'));
    },

    _contextMenuItems(menuEl) {
      return Array.from(menuEl.querySelectorAll('[role="menuitem"]'));
    },

    _focusFirstContextMenuItem(menuEl) {
      const items = this._contextMenuItems(menuEl);
      if (!items.length) return;
      items[0].focus();
    },

    _focusContextMenuItemAt(menuEl, index) {
      const items = this._contextMenuItems(menuEl);
      if (!items.length) return;
      const i = ((index % items.length) + items.length) % items.length;
      items[i].focus();
    },

    _onContextMenuKeydown(e) {
      if (!this._contextMenuIsOpen()) return;
      const menu = document.getElementById('context-menu');
      if (!menu) return;
      if (!menu.contains(document.activeElement)) {
        this._focusFirstContextMenuItem(menu);
        return;
      }

      const items = this._contextMenuItems(menu);
      if (!items.length) return;
      let idx = items.indexOf(document.activeElement);
      if (idx < 0) idx = 0;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          this._focusContextMenuItemAt(menu, idx + 1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          this._focusContextMenuItemAt(menu, idx - 1);
          break;
        case 'Home':
          e.preventDefault();
          this._focusContextMenuItemAt(menu, 0);
          break;
        case 'End':
          e.preventDefault();
          this._focusContextMenuItemAt(menu, items.length - 1);
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          document.activeElement?.click();
          break;
        case 'Tab':
          this.hideContextMenu();
          break;
        default:
          break;
      }
    },

    /**
     * Same MIME → app rows as desktop file context menu (os/ContextMenu.js):
     * FileSystemDB.mimeTypeForOpen, AppModule.getAppsForMimeType, Notepad when not a handler.
     */
    async _populateOpenWithMenu() {
      const container = document.getElementById('file-open-with-dynamic');
      if (!container) return;
      container.innerHTML = '';

      if (this.selectedItems.size !== 1) return;

      const path = [...this.selectedItems][0];
      let item;
      try {
        item = await this.fs.getItem(path);
      } catch {
        return;
      }
      if (!item || item.type !== 'file') return;

      const F = window.FileSystemDB;
      const mime = F ? F.mimeTypeForOpen(item) : 'application/octet-stream';
      const rootWin = window.top || window;
      const AppMod = rootWin.AppModule || window.AppModule;
      const registry = AppMod?.getAllApps?.() || [];
      const apps =
        rootWin.MimeHandlers?.getAppsForMimeType?.(mime, registry) ||
        AppMod?.getAppsForMimeType?.(mime) ||
        [];
      const seen = new Set(apps.map((a) => a.appId));
      const lines = [];

      for (const app of apps) {
        const id = escapeHtmlAttr(app.appId);
        const icon = escapeHtmlText(app.icon || '');
        const name = escapeHtmlText(app.shortName || '');
        lines.push(
          `<div class="menu-item" role="menuitem" tabindex="-1" data-action="open-with" data-app="${id}">${icon} Open with ${name}</div>`
        );
      }

      if (!seen.has('notepad')) {
        lines.push(
          '<div class="menu-item" role="menuitem" tabindex="-1" data-action="open-with" data-app="notepad">📝 Open with Notepad</div>'
        );
      }

      container.innerHTML = lines.join('');
    },

    hideContextMenu() {
      const menu = document.getElementById('context-menu');
      if (menu) {
        menu.classList.add('hidden');
        menu.setAttribute('aria-hidden', 'true');
      }
    },

    async handleOpenWith(appId) {
      if (!appId || this.selectedItems.size !== 1) return;

      const path = [...this.selectedItems][0];
      let item;
      try {
        item = await this.fs.getItem(path);
      } catch {
        return;
      }
      if (!item || item.type !== 'file') return;

      const F = window.FileSystemDB;
      const content = F ? F.getContentForApp(item) : item.content ?? '';
      const fileName = this.fs.getFileName(path);

      if (window.self !== window.top) {
        window.parent.postMessage(
          {
            type: 'iframe-message',
            message: {
              type: 'openFile',
              app: appId,
              path: item.path,
              content,
              fileName
            }
          },
          '*'
        );
      } else {
        debug('Open with requires Heyming OS parent');
      }
    },

    async handleContextAction(action) {
      switch (action) {
        case 'open':
          if (this.selectedItems.size === 1) {
            const path = [...this.selectedItems][0];
            const item = await this.fs.getItem(path);
            if (item.type === 'directory') {
              this.navigateTo(path);
            } else {
              this.previewFile(item);
            }
          }
          break;
        case 'copy-path':
          await this.copySelectedPathsToClipboard();
          break;
        case 'rename':
          this.renameSelected();
          break;
        case 'delete':
          this.deleteSelected();
          break;
        case 'copy':
          this.copySelected();
          break;
        case 'cut':
          this.cutSelected();
          break;
        case 'paste':
          this.paste();
          break;
        case 'properties':
          this.showProperties();
          break;
      }
    }
  });
}

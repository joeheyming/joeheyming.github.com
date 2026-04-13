/**
 * Heyming OS - File Dialog
 * Reusable Save As / Open dialog for apps
 */

import { Config } from './config.js';
import { Icons } from './Icons.js';

export class FileDialog {
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
    this.fs = null;
    this.cfg = Config;
    this.currentPath = this.cfg.HOME;
    this.mode = 'save'; // 'save' or 'open'
    this.callback = null;
    this.fileContent = null;
    this.suggestedName = '';
    /** @type {string[]|null} */
    this.fileTypes = null; // Filter for file types
    this.visible = false;
  }

  async init() {
    // Get shared filesystem instance (singleton)
    if (window.FileSystemDB) {
      this.fs = await window.FileSystemDB.getInstance();
    }
    this._createDialogElement();
    this._bindEvents();
  }

  /**
   * Show Save As dialog
   * @param {Partial<{ content: string; suggestedName: string; currentPath: string; onSave: Function; fileTypes: string[] }>} [options]
   */
  showSaveAs(options = {}) {
    this.mode = 'save';
    this.fileContent = options.content || '';
    this.suggestedName = options.suggestedName || 'untitled.txt';
    this.currentPath = options.currentPath || this.cfg.HOME;
    this.callback = options.onSave || null;
    this.fileTypes = options.fileTypes || null;

    this._updateDialogTitle('Save As');
    this._updateConfirmButton('Save');
    /** @type {HTMLInputElement} */ (document.getElementById('file-dialog-filename')).value =
      this.suggestedName;

    this._show();
  }

  /**
   * Show Open dialog
   * @param {Partial<{ currentPath: string; fileTypes: string[]; onOpen: Function }>} [options]
   */
  showOpen(options = {}) {
    this.mode = 'open';
    this.currentPath = options.currentPath || this.cfg.HOME;
    this.callback = options.onOpen || null;
    this.fileTypes = options.fileTypes || null;

    this._updateDialogTitle('Open File');
    this._updateConfirmButton('Open');
    /** @type {HTMLInputElement} */ (document.getElementById('file-dialog-filename')).value = '';

    this._show();
  }

  hide() {
    const overlay = document.getElementById('file-dialog-overlay');
    if (overlay) {
      overlay.classList.add('hidden');
      this.visible = false;
    }
  }

  // ========== Private Methods ==========

  _createDialogElement() {
    // Generate sidebar items from config
    const quickAccess = this.cfg.getQuickAccess().slice(0, 4); // Home, Desktop, Documents, Downloads
    const sidebarHtml = quickAccess
      .map(
        (item) =>
          `<div class="sidebar-item" data-path="${FileDialog._escapeHtmlAttr(
            item.path
          )}">${FileDialog._escapeHtmlText(item.name)}</div>`
      )
      .join('\n          ');

    const overlay = document.createElement('div');
    overlay.id = 'file-dialog-overlay';
    overlay.className = 'file-dialog-overlay hidden';
    overlay.innerHTML = `
      <div class="file-dialog">
        <div class="file-dialog-header">
          <span id="file-dialog-title">Save As</span>
          <button id="file-dialog-close" class="file-dialog-close">×</button>
        </div>
        
        <div class="file-dialog-nav">
          <button id="file-dialog-up" title="Go Up">↑</button>
          <button id="file-dialog-home" title="Home">🏠</button>
          <span id="file-dialog-path" class="file-dialog-path">${this.cfg.HOME}</span>
        </div>
        
        <div class="file-dialog-sidebar">
          ${sidebarHtml}
        </div>
        
        <div class="file-dialog-content">
          <div id="file-dialog-list" class="file-dialog-list"></div>
        </div>
        
        <div class="file-dialog-footer">
          <input type="text" id="file-dialog-filename" placeholder="Filename..." />
          <div class="file-dialog-buttons">
            <button id="file-dialog-cancel" class="file-dialog-btn cancel">Cancel</button>
            <button id="file-dialog-confirm" class="file-dialog-btn confirm">Save</button>
          </div>
        </div>
      </div>
    `;

    document.getElementById('heyming-os').appendChild(overlay);
  }

  _bindEvents() {
    // Close button
    document.getElementById('file-dialog-close').addEventListener('click', () => this.hide());
    document.getElementById('file-dialog-cancel').addEventListener('click', () => this.hide());

    // Overlay click to close
    document.getElementById('file-dialog-overlay').addEventListener('click', (e) => {
      if (/** @type {Element} */ (e.target).id === 'file-dialog-overlay') this.hide();
    });

    // Confirm button
    document
      .getElementById('file-dialog-confirm')
      .addEventListener('click', () => this._handleConfirm());

    // Navigation
    document.getElementById('file-dialog-up').addEventListener('click', () => this._goUp());
    document
      .getElementById('file-dialog-home')
      .addEventListener('click', () => this._navigateTo(this.cfg.HOME));

    // Sidebar
    document.querySelectorAll('#file-dialog-overlay .sidebar-item').forEach((item) => {
      item.addEventListener('click', () => {
        this._navigateTo(/** @type {HTMLElement} */ (item).dataset.path || '');
      });
    });

    // Filename input - Enter to confirm
    /** @type {HTMLInputElement} */ (document.getElementById('file-dialog-filename')).addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Enter') this._handleConfirm();
        if (e.key === 'Escape') this.hide();
      }
    );
  }

  async _show() {
    const overlay = document.getElementById('file-dialog-overlay');
    overlay.classList.remove('hidden');
    this.visible = true;

    await this._loadDirectory();

    // Focus filename input for save mode
    if (this.mode === 'save') {
      setTimeout(() => {
        const input = /** @type {HTMLInputElement} */ (document.getElementById('file-dialog-filename'));
        input.focus();
        input.select();
      }, 100);
    }
  }

  async _loadDirectory() {
    if (!this.fs) return;

    const list = document.getElementById('file-dialog-list');
    const pathDisplay = document.getElementById('file-dialog-path');

    pathDisplay.textContent = this.currentPath;
    list.innerHTML = '<div class="loading">Loading...</div>';

    try {
      const items = await this.fs.listDirectory(this.currentPath);

      // Sort: directories first, then alphabetically
      items.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return this.fs.getFileName(a.path).localeCompare(this.fs.getFileName(b.path));
      });

      // Filter by file types if specified (for open mode)
      let filteredItems = items;
      if (this.mode === 'open' && this.fileTypes) {
        filteredItems = items.filter((item) => {
          if (item.type === 'directory') return true;

          const name = this.fs.getFileName(item.path);
          const ext = name.split('.').pop().toLowerCase();
          const mimeType = window.FileSystemDB?.getMimeType(item.path) || '';

          return this.fileTypes.some((filter) => {
            // Check MIME type patterns like 'video/*' or 'image/*'
            if (filter.includes('/')) {
              if (filter.endsWith('/*')) {
                const category = filter.replace('/*', '');
                return mimeType.startsWith(category + '/');
              }
              return mimeType === filter;
            }
            // Check extension
            return ext === filter.toLowerCase();
          });
        });
      }

      if (filteredItems.length === 0) {
        list.innerHTML = '<div class="empty">Empty folder</div>';
        return;
      }

      list.innerHTML = filteredItems
        .map((item) => {
          const name = this.fs.getFileName(item.path);
          const icon = item.type === 'directory' ? '📁' : this._getFileIcon(name);
          const pathA = FileDialog._escapeHtmlAttr(item.path);
          const typeA = FileDialog._escapeHtmlAttr(item.type);
          const nameA = FileDialog._escapeHtmlAttr(name);
          const nameT = FileDialog._escapeHtmlText(name);
          const iconT = FileDialog._escapeHtmlText(icon);
          return `
            <div class="file-dialog-item" data-path="${pathA}" data-type="${typeA}" data-name="${nameA}">
              <span class="icon">${iconT}</span>
              <span class="name">${nameT}</span>
            </div>
          `;
        })
        .join('');

      // Bind click events
      list.querySelectorAll('.file-dialog-item').forEach((item) => {
        item.addEventListener('click', () => this._handleItemClick(item));
        item.addEventListener('dblclick', () => this._handleItemDblClick(item));
      });
    } catch (error) {
      list.innerHTML = `<div class="error">Error: ${FileDialog._escapeHtmlText(
        error?.message || error
      )}</div>`;
    }
  }

  _handleItemClick(item) {
    // Remove selection from all
    document.querySelectorAll('.file-dialog-item').forEach((i) => i.classList.remove('selected'));
    item.classList.add('selected');

    // If it's a file, set the filename
    if (item.dataset.type === 'file') {
      /** @type {HTMLInputElement} */ (document.getElementById('file-dialog-filename')).value =
        /** @type {HTMLElement} */ (item).dataset.name || '';
    }
  }

  _handleItemDblClick(item) {
    if (item.dataset.type === 'directory') {
      this._navigateTo(item.dataset.path);
    } else if (this.mode === 'open') {
      this._handleConfirm();
    }
  }

  async _handleConfirm() {
    const filename = /** @type {HTMLInputElement} */ (
      document.getElementById('file-dialog-filename')
    ).value.trim();

    if (this.mode === 'save') {
      if (!filename) {
        this.os.notifications.error('Please enter a filename');
        return;
      }

      const fullPath = this.fs.joinPath(this.currentPath, filename);

      try {
        await this.fs.createFile(fullPath, this.fileContent, true);
        this.os.notifications.success(`💾 Saved: ${filename}`);

        if (this.callback) {
          this.callback(fullPath, filename);
        }

        this.hide();
      } catch (error) {
        this.os.notifications.error(`Failed to save: ${error.message}`);
      }
    } else if (this.mode === 'open') {
      const selected = /** @type {HTMLElement|null} */ (
        document.querySelector('.file-dialog-item.selected')
      );
      if (!selected || selected.dataset.type === 'directory') {
        this.os.notifications.error('Please select a file');
        return;
      }

      try {
        const item = await this.fs.getItem(selected.dataset.path);
        if (this.callback) {
          this.callback(item);
        }
        this.hide();
      } catch (error) {
        this.os.notifications.error(`Failed to open: ${error.message}`);
      }
    }
  }

  _navigateTo(path) {
    this.currentPath = path;
    this._loadDirectory();
    this._updateSidebar();
  }

  _goUp() {
    const parent = this.fs.getParentPath(this.currentPath);
    if (parent) {
      this._navigateTo(parent);
    }
  }

  _updateSidebar() {
    document.querySelectorAll('#file-dialog-overlay .sidebar-item').forEach((item) => {
      /** @type {HTMLElement} */ (item).classList.toggle(
        'active',
        /** @type {HTMLElement} */ (item).dataset.path === this.currentPath
      );
    });
  }

  _updateDialogTitle(title) {
    document.getElementById('file-dialog-title').textContent = title;
  }

  _updateConfirmButton(text) {
    document.getElementById('file-dialog-confirm').textContent = text;
  }

  _getFileIcon(filename) {
    return Icons.getIconForFile(filename);
  }
}

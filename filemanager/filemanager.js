import { FileSystemDB } from '../os/filesystem-db.js';
import { debug } from './filemanager-shared.js';
import { applyFileManagerDnd } from './filemanager-dnd.js';
import { applyFileManagerNav } from './filemanager-nav.js';
import { applyFileManagerView } from './filemanager-view.js';
import { applyFileManagerContext } from './filemanager-context.js';
import { applyFileManagerOps } from './filemanager-ops.js';

export class FileManager {
  constructor() {
    this.fs = null;
    const _su = () => {
      try {
        return localStorage.getItem('heymingOS_username');
      } catch {
        return null;
      }
    };
    const _u = _su() || 'user';
    this.cfg = window.parent?.HeymingOS?.Config || { HOME: `/home/${_u}`, USER: _u };
    this.currentPath = this.cfg.HOME;
    this.history = [this.currentPath];
    this.historyIndex = 0;
    this.selectedItems = new Set();
    this.isListView = false;
    this._onContextMenuKeydown = this._onContextMenuKeydown.bind(this);
    /** @type {HTMLElement | null} */
    this._focusBeforeDialog = null;
    /** @type {HTMLElement | null} */
    this._focusBeforePreview = null;

    this.init();
  }

  async init() {
    // Get shared filesystem instance (singleton)
    this.fs = await FileSystemDB.getInstance();
    await this.fs.initializeWithScaffolding(this.cfg.USER);
    this._generateSidebar();
    this.bindEvents();
    this.navigateTo(this.currentPath);
  }

  bindEvents() {
    // Listen for filesystem changes from the OS
    window.addEventListener('message', (e) => {
      if (e.data?.type === 'filesystem-change') {
        // Refresh if the change affects the current directory or its parent
        const changedPath = e.data.path;
        const details = e.data.details || {};
        const affectsCurrentDir =
          FileSystemDB.pathIsDescendantOrSelf(changedPath, this.currentPath) ||
          details.parentPath === this.currentPath ||
          details.oldParentPath === this.currentPath ||
          details.newParentPath === this.currentPath;

        if (affectsCurrentDir) {
          this.refresh();
        }
      }
    });

    // Toolbar buttons
    document.getElementById('btn-back').addEventListener('click', () => this.goBack());
    document.getElementById('btn-forward').addEventListener('click', () => this.goForward());
    document.getElementById('btn-up').addEventListener('click', () => this.goUp());
    document
      .getElementById('btn-home')
      .addEventListener('click', () => this.navigateTo(this.cfg.HOME));
    document.getElementById('btn-refresh').addEventListener('click', () => this.refresh());
    document
      .getElementById('btn-new-folder')
      .addEventListener('click', () => this.showNewFolderDialog());
    document
      .getElementById('btn-new-file')
      .addEventListener('click', () => this.showNewFileDialog());
    document.getElementById('btn-view-toggle').addEventListener('click', () => this.toggleView());
    this._syncViewToggleAria();

    // Sidebar navigation
    document.querySelectorAll('.sidebar-item').forEach((item) => {
      const path = item.dataset.path;

      item.addEventListener('click', () => {
        this.navigateTo(path);
      });

      // Allow dropping files onto sidebar items
      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        item.classList.add('drop-target');
      });

      item.addEventListener('dragleave', () => {
        item.classList.remove('drop-target');
      });

      item.addEventListener('drop', (e) => {
        e.preventDefault();
        item.classList.remove('drop-target');
        debug('Sidebar drop on:', path);
        this._handleFolderDrop(path);
      });
    });

    // Context menu
    document.getElementById('file-list').addEventListener('contextmenu', (e) => {
      e.preventDefault();
      void this.showContextMenu(e);
    });

    document.addEventListener('click', () => this.hideContextMenu());

    document.getElementById('context-menu').addEventListener('click', (e) => {
      const el = e.target.closest('.menu-item');
      if (!el) return;
      e.stopPropagation();
      const action = el.dataset.action;
      if (action === 'open-with') {
        void this.handleOpenWith(el.dataset.app);
      } else {
        this.handleContextAction(action);
      }
      this.hideContextMenu();
    });

    document.addEventListener('keydown', this._onContextMenuKeydown, true);

    // Dialog
    document.getElementById('dialog-cancel').addEventListener('click', () => this.hideDialog());
    document.getElementById('dialog-confirm').addEventListener('click', () => this.confirmDialog());
    document.getElementById('dialog-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.confirmDialog();
      if (e.key === 'Escape') this.hideDialog();
    });
    document.getElementById('dialog-overlay').addEventListener('click', (e) => {
      if (e.target.id === 'dialog-overlay') this.hideDialog();
    });

    // Preview
    document.getElementById('preview-close').addEventListener('click', () => this.hidePreview());
    document.getElementById('preview-overlay').addEventListener('click', (e) => {
      if (e.target.id === 'preview-overlay') this.hidePreview();
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      // Skip if typing in an input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      const ctxMenuOpen = this._contextMenuIsOpen();

      if (e.key === 'Delete' && this.selectedItems.size > 0 && !ctxMenuOpen) {
        this.deleteSelected();
      }
      if (e.key === 'F2' && this.selectedItems.size === 1 && !ctxMenuOpen) {
        this.renameSelected();
      }
      if (e.key === 'Escape') {
        const dialogEl = document.getElementById('dialog-overlay');
        if (dialogEl && !dialogEl.classList.contains('hidden')) {
          e.preventDefault();
          this.hideDialog();
          return;
        }
        const previewEl = document.getElementById('preview-overlay');
        if (previewEl && !previewEl.classList.contains('hidden')) {
          e.preventDefault();
          this.hidePreview();
          return;
        }
        if (ctxMenuOpen) {
          e.preventDefault();
          this.hideContextMenu();
          return;
        }
        this.selectedItems.clear();
        this.renderFiles();
      }
      if (e.key === 'Enter' && this.selectedItems.size === 1 && !ctxMenuOpen) {
        e.preventDefault();
        const path = [...this.selectedItems][0];
        this.openItem(path);
      }
      if (e.key === ' ' && this.selectedItems.size === 1 && !ctxMenuOpen) {
        e.preventDefault();
        const path = [...this.selectedItems][0];
        this.previewFile(path);
      }
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        if (ctxMenuOpen) return;
        e.preventDefault();
        void this.navigateWithArrows(e.key, e.shiftKey);
      }
      if (e.key === 'Backspace') {
        if (ctxMenuOpen) return;
        e.preventDefault();
        this.goUp();
      }
      if (e.ctrlKey || e.metaKey) {
        if (ctxMenuOpen) return;
        if (e.key === 'c') this.copySelected();
        if (e.key === 'x') this.cutSelected();
        if (e.key === 'v') this.paste();
        if (e.key === 'a') {
          e.preventDefault();
          this.selectAll();
        }
      }
    });

    // Click to deselect
    document.getElementById('content').addEventListener('click', (e) => {
      if (e.target.id === 'content' || e.target.id === 'file-list') {
        this.selectedItems.clear();
        this.renderFiles();
      }
    });

    // Set up drag and drop
    this._setupDragDrop();
  }
}

applyFileManagerDnd(FileManager);
applyFileManagerNav(FileManager);
applyFileManagerView(FileManager);
applyFileManagerContext(FileManager);
applyFileManagerOps(FileManager);

window.fileManager = new FileManager();

import { FileSystemDB } from '../os/filesystem-db.js';

/** @param {new () => object} FileManager */
export function applyFileManagerOps(FileManager) {
  Object.assign(FileManager, {
    _setPreviewBodyText(text) {
      const el = document.getElementById('preview-content');
      if (!el) return;
      el.textContent = text;
      el.classList.remove('preview-placeholder', 'preview-file-text');
      if (text === '(binary file)' || text === '(empty file)') {
        el.classList.add('preview-placeholder');
      } else {
        el.classList.add('preview-file-text');
      }
    },

    /** @param {{ type?: string, content?: string, contentBytes?: unknown, size?: number }} item */
    _previewText(item) {
      const t = FileSystemDB.getUtf8TextForDisplay(item);
      if (t !== '') {
        return t;
      }
      const sz = item.size || 0;
      if (item.type === 'file' && sz > 0) {
        return '(binary file)';
      }
      return '(empty file)';
    }
  });
  Object.assign(FileManager.prototype, {
    _openDialogOverlay() {
      const overlay = document.getElementById('dialog-overlay');
      this._focusBeforeDialog =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      overlay.classList.remove('hidden');
      overlay.setAttribute('aria-hidden', 'false');
    },

    _restoreDialogFocus() {
      if (this._focusBeforeDialog && typeof this._focusBeforeDialog.focus === 'function') {
        try {
          this._focusBeforeDialog.focus();
        } catch {
          /* ignore */
        }
      }
      this._focusBeforeDialog = null;
    },

    showNewFolderDialog() {
      this.dialogMode = 'new-folder';
      document.getElementById('dialog-title').textContent = 'New Folder';
      document.getElementById('dialog-input').value = '';
      document.getElementById('dialog-input').placeholder = 'Folder name...';
      document.getElementById('dialog-confirm').textContent = 'Create';
      this._openDialogOverlay();
      document.getElementById('dialog-input').focus();
    },

    showNewFileDialog() {
      this.dialogMode = 'new-file';
      document.getElementById('dialog-title').textContent = 'New File';
      document.getElementById('dialog-input').value = '';
      document.getElementById('dialog-input').placeholder = 'File name...';
      document.getElementById('dialog-confirm').textContent = 'Create';
      this._openDialogOverlay();
      document.getElementById('dialog-input').focus();
    },

    renameSelected() {
      if (this.selectedItems.size !== 1) return;

      const path = [...this.selectedItems][0];
      const name = this.fs.getFileName(path);

      this.dialogMode = 'rename';
      this.dialogTarget = path;
      document.getElementById('dialog-title').textContent = 'Rename';
      document.getElementById('dialog-input').value = name;
      document.getElementById('dialog-input').placeholder = 'New name...';
      document.getElementById('dialog-confirm').textContent = 'Rename';
      this._openDialogOverlay();
      document.getElementById('dialog-input').focus();
      document.getElementById('dialog-input').select();
    },

    hideDialog() {
      const overlay = document.getElementById('dialog-overlay');
      overlay.classList.add('hidden');
      overlay.setAttribute('aria-hidden', 'true');
      this.dialogMode = null;
      this.dialogTarget = null;
      this._restoreDialogFocus();
    },

    async confirmDialog() {
      const input = document.getElementById('dialog-input').value.trim();
      if (!input) return;

      const FileOps = window.parent?.HeymingOS?.FileOperationService;

      try {
        switch (this.dialogMode) {
          case 'new-folder':
            await this.fs.createDirectory(this.fs.joinPath(this.currentPath, input));
            break;
          case 'new-file':
            await this.fs.createFile(this.fs.joinPath(this.currentPath, input), '');
            break;
          case 'rename': {
            const result = await FileOps.rename(this.fs, this.dialogTarget, input);
            if (result.message) this._notify(result.message, result.success ? 'info' : 'error');
            this.selectedItems.clear();
            break;
          }
        }

        this.hideDialog();
        this.refresh();
        this.notifyOSFileChange();
      } catch (error) {
        this._notify(`❌ Error: ${error.message}`, 'error');
      }
    },

    async deleteSelected() {
      if (this.selectedItems.size === 0) return;

      const FileOps = window.parent?.HeymingOS?.FileOperationService;
      if (FileOps) {
        const result = await FileOps.delete(this.fs, [...this.selectedItems], true);
        if (result.message) {
          this._notify(result.message, result.success ? 'info' : 'error');
        }
        if (result.success) {
          this.selectedItems.clear();
          this.refresh();
          this.notifyOSFileChange();
        }
      }
    },

    copySelected() {
      const FileOps = window.parent?.HeymingOS?.FileOperationService;
      if (FileOps) {
        const result = FileOps.copy(this.fs, [...this.selectedItems], 'filemanager');
        if (result.message) this._notify(result.message);
      }
    },

    cutSelected() {
      const FileOps = window.parent?.HeymingOS?.FileOperationService;
      if (FileOps) {
        const result = FileOps.cut(this.fs, [...this.selectedItems], 'filemanager');
        if (result.message) this._notify(result.message);
      }
    },

    async paste() {
      const FileOps = window.parent?.HeymingOS?.FileOperationService;
      if (!FileOps?.hasClipboardItems()) {
        this._notify('📋 Clipboard is empty');
        return;
      }

      const result = await FileOps.paste(this.fs, this.currentPath);
      if (result.message) {
        this._notify(result.message, result.success ? 'info' : 'error');
      }
      if (result.success) {
        this.refresh();
        this.notifyOSFileChange();
      }
    },

    selectAll() {
      document.querySelectorAll('.file-item').forEach((el) => {
        this.selectedItems.add(el.dataset.path);
      });
      this.renderFiles();
    },

    async openItem(path) {
      const item = await this.fs.getItem(path);
      if (!item) return;

      if (item.type === 'directory') {
        this.navigateTo(path);
      } else {
        this.previewFile(item);
      }
    },

    async navigateWithArrows(key, shiftKey) {
      const fileItems = Array.from(document.querySelectorAll('.file-item'));
      if (fileItems.length === 0) return;

      // Find currently selected item
      let currentIndex = -1;
      const lastSelected = [...this.selectedItems].pop();
      if (lastSelected) {
        currentIndex = fileItems.findIndex((el) => el.dataset.path === lastSelected);
      }

      // If nothing selected, select first item
      if (currentIndex === -1) {
        const firstPath = fileItems[0]?.dataset.path;
        if (firstPath) {
          this.selectedItems.clear();
          this.selectedItems.add(firstPath);
          await this.renderFiles();
          const firstEl = document.querySelector(`[data-path="${CSS.escape(firstPath)}"]`);
          firstEl?.scrollIntoView({ block: 'nearest' });
          firstEl?.focus({ preventScroll: true });
        }
        return;
      }

      // Calculate next index based on view mode and key
      let nextIndex = currentIndex;
      const isGridView = !this.isListView;

      if (isGridView) {
        // Grid view: calculate columns
        const container = document.getElementById('file-list');
        const containerWidth = container?.offsetWidth || 600;
        const itemWidth = 116; // Approximate item width with gap
        const columns = Math.max(1, Math.floor(containerWidth / itemWidth));

        switch (key) {
          case 'ArrowRight':
            nextIndex = Math.min(currentIndex + 1, fileItems.length - 1);
            break;
          case 'ArrowLeft':
            nextIndex = Math.max(currentIndex - 1, 0);
            break;
          case 'ArrowDown':
            nextIndex = Math.min(currentIndex + columns, fileItems.length - 1);
            break;
          case 'ArrowUp':
            nextIndex = Math.max(currentIndex - columns, 0);
            break;
        }
      } else {
        // List view: simple up/down
        switch (key) {
          case 'ArrowDown':
          case 'ArrowRight':
            nextIndex = Math.min(currentIndex + 1, fileItems.length - 1);
            break;
          case 'ArrowUp':
          case 'ArrowLeft':
            nextIndex = Math.max(currentIndex - 1, 0);
            break;
        }
      }

      if (nextIndex === currentIndex) return;

      const nextPath = fileItems[nextIndex]?.dataset.path;
      if (!nextPath) return;

      if (shiftKey) {
        // Shift+Arrow: extend selection
        this.selectedItems.add(nextPath);
      } else {
        // Arrow only: move selection
        this.selectedItems.clear();
        this.selectedItems.add(nextPath);
      }

      await this.renderFiles();
      const nextEl = document.querySelector(`[data-path="${CSS.escape(nextPath)}"]`);
      nextEl?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      nextEl?.focus({ preventScroll: true });
    },

    async previewFile(item) {
      const name = this.fs.getFileName(item.path);

      // Check if we're inside the OS (iframe context)
      const isInOS = window.self !== window.top;

      if (isInOS) {
        // Let the OS decide how to open the file based on MIME type
        this.openWithOS(item);
      } else {
        // Show preview in file manager (standalone mode)
        document.getElementById('preview-title').textContent = name;
        FileManager._setPreviewBodyText(FileManager._previewText(item));
        this._openPreviewOverlay();
      }
    },

    openWithOS(item) {
      try {
        // Send to OS to handle based on MIME type
        window.parent.postMessage(
          {
            type: 'iframe-message',
            message: {
              type: 'openDesktopFile',
              file: {
                path: item.path,
                content: item.content || '',
                mimeType: item.mimeType || FileSystemDB.getMimeType(item.path)
              }
            }
          },
          '*'
        );
      } catch (error) {
        console.error('Failed to open file via OS:', error);
        // Fallback to preview
        document.getElementById('preview-title').textContent = this.fs.getFileName(item.path);
        FileManager._setPreviewBodyText(FileManager._previewText(item));
        this._openPreviewOverlay();
      }
    },

    _openPreviewOverlay() {
      const overlay = document.getElementById('preview-overlay');
      this._focusBeforePreview =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      overlay.classList.remove('hidden');
      overlay.setAttribute('aria-hidden', 'false');
      document.getElementById('preview-close').focus();
    },
    notifyOSFileChange() {
      if (window.self !== window.top) {
        window.parent.postMessage(
          {
            type: 'iframe-message',
            message: {
              type: 'filesChanged'
            }
          },
          '*'
        );
      }
    },

    hidePreview() {
      const overlay = document.getElementById('preview-overlay');
      overlay.classList.add('hidden');
      overlay.setAttribute('aria-hidden', 'true');
      if (this._focusBeforePreview && typeof this._focusBeforePreview.focus === 'function') {
        try {
          this._focusBeforePreview.focus();
        } catch {
          /* ignore */
        }
      }
      this._focusBeforePreview = null;
    },

    async showProperties() {
      if (this.selectedItems.size !== 1) return;

      const path = [...this.selectedItems][0];
      const item = await this.fs.getItem(path);

      const info = `
Name: ${this.fs.getFileName(path)}
Type: ${item.type}
Path: ${path}
Size: ${item.type === 'file' ? this.formatSize(item.size || 0) : 'N/A'}
Created: ${item.created ? new Date(item.created).toLocaleString() : 'Unknown'}
Modified: ${item.modified ? new Date(item.modified).toLocaleString() : 'Unknown'}
  `.trim();

      alert(info);
    }
  });
}

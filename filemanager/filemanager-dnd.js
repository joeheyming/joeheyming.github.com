import { debug } from './filemanager-shared.js';
/** @param {new () => object} FileManager */
export function applyFileManagerDnd(FileManager) {
  Object.assign(FileManager.prototype, {
    _setupDragDrop() {
      const fileList = document.getElementById('file-list');

      // Prevent default drag behaviors
      fileList.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      });

      fileList.addEventListener('dragenter', (e) => {
        e.preventDefault();
        fileList.classList.add('drag-over');
      });

      fileList.addEventListener('dragleave', (e) => {
        // Only remove if leaving the file list entirely
        if (!fileList.contains(e.relatedTarget)) {
          fileList.classList.remove('drag-over');
        }
      });

      // Handle drops on the file list background (not on folder items)
      fileList.addEventListener('drop', (e) => {
        debug('fileList drop event, target:', e.target, 'currentTarget:', e.currentTarget);
        e.preventDefault();
        fileList.classList.remove('drag-over');

        // Check if drop was on a file item
        const target = e.target;
        const fileItem = target.closest('.file-item');
        debug('fileItem:', fileItem, 'type:', fileItem?.dataset?.type);

        // If dropped on a directory item, handle it here since folder handler may not fire
        if (fileItem && fileItem.dataset.type === 'directory') {
          debug('Dropped on directory, handling folder drop');
          this._handleFolderDrop(fileItem.dataset.path);
          return;
        }

        // Handle drop on file list background (copies/moves to current directory)
        this._handleDrop(e);
      });
    },

    async _handleFolderDrop(folderPath) {
      // Check for drag data from file manager or OS desktop
      const DragSvc = window.parent?.HeymingOS?.DragService;
      const fileData = this._dragData || DragSvc?.getData();
      debug('_handleFolderDrop:', folderPath, 'dragData:', fileData);

      if (!fileData) {
        debug('No drag data');
        return;
      }

      // Support both single path and multiple paths
      const paths = fileData.paths || [fileData.path];
      const action = fileData.action || 'move';
      let successCount = 0;

      try {
        for (const sourcePath of paths) {
          const sourceDir = this.fs.getParentPath(sourcePath);
          const fileName = this.fs.getFileName(sourcePath);
          const destPath = `${folderPath}/${fileName}`;

          // Skip if file is already in this folder (dropping on same location)
          if (sourceDir === folderPath && action === 'move') {
            continue;
          }

          // Don't drop into itself
          if (sourcePath === folderPath || destPath.startsWith(sourcePath + '/')) {
            this._notify('Cannot move folder into itself', 'error');
            continue;
          }

          await this._performFileOperation(sourcePath, destPath, action);
          successCount++;
        }

        this._dragData = null;
        window.parent?.HeymingOS?.DragService?.clear();

        if (successCount > 0) {
          await this.refresh();
          this.notifyOSFileChange();
        }
      } catch (error) {
        console.error('Folder drop failed:', error);
        this._notify(`Drop failed: ${error.message}`, 'error');
      }
    },

    async _handleDrop(e) {
      const dataTransfer = e.dataTransfer;

      // Check for internal file drag (from within file manager)
      if (this._dragData) {
        await this._handleInternalDrop(this._dragData);
        this._dragData = null;
        return;
      }

      // Check for drag from OS desktop via DragService
      const DragSvc = window.parent?.HeymingOS?.DragService;
      if (DragSvc?.hasData()) {
        const osDragData = DragSvc.consume();
        debug('Received drag from OS desktop:', osDragData);
        await this._handleInternalDrop(osDragData);
        return;
      }

      // Handle external file drops (from real OS)
      if (dataTransfer.files && dataTransfer.files.length > 0) {
        await this._handleExternalDrop(dataTransfer.files);
        return;
      }

      // Handle text drops
      const text = dataTransfer.getData('text/plain');
      if (text && !text.startsWith('http') && !text.startsWith('/')) {
        await this._handleTextDrop(text);
      }
    },

    async _handleInternalDrop(fileData) {
      try {
        // Support both single path and multiple paths
        const paths = fileData.paths || [fileData.path];
        const action = fileData.action || 'move';
        let successCount = 0;

        for (const sourcePath of paths) {
          const sourceDir = this.fs.getParentPath(sourcePath);
          const fileName = this.fs.getFileName(sourcePath);
          const destPath = `${this.currentPath}/${fileName}`;

          // Skip if file is already in this folder (dropping on same location)
          if (sourceDir === this.currentPath && action === 'move') {
            continue;
          }

          // Don't drop onto itself
          if (sourcePath === destPath) continue;

          // Don't drop into a subdirectory of itself
          if (destPath.startsWith(sourcePath + '/')) {
            this._notify('Cannot move folder into itself', 'error');
            continue;
          }

          await this._performFileOperation(sourcePath, destPath, action);
          successCount++;
        }

        if (successCount > 0) {
          await this.refresh();
          this.notifyOSFileChange();
        }
      } catch (error) {
        this._notify(`Drop failed: ${error.message}`, 'error');
      }
    },

    async _handleExternalDrop(files) {
      for (const file of files) {
        try {
          const content = await this._readDroppedFile(file);
          const destPath = `${this.currentPath}/${file.name}`;

          await this.fs.createFile(destPath, content, true);
          this._notify(`Saved: ${file.name}`);
        } catch (error) {
          this._notify(`Failed to save: ${file.name}`, 'error');
        }
      }
      // Refresh view
      await this.refresh();
    },

    async _handleTextDrop(text) {
      try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const fileName = `dropped-${timestamp}.txt`;
        const destPath = `${this.currentPath}/${fileName}`;

        await this.fs.createFile(destPath, text, true);
        this._notify(`Saved: ${fileName}`);
        // Refresh view
        await this.refresh();
      } catch (error) {
        this._notify('Failed to save text', 'error');
      }
    },

    _readDroppedFile(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);

        // Read as text for text files, as data URL for others
        if (file.type.startsWith('text/') || file.type === 'application/json') {
          reader.readAsText(file);
        } else {
          reader.readAsDataURL(file);
        }
      });
    },

    /**
     * Perform a file move or copy operation with unique path handling
     * @param {string} sourcePath - Source file path
     * @param {string} destPath - Destination file path (may be modified for uniqueness)
     * @param {string} action - 'move' or 'copy'
     * @param {boolean} silent - If true, don't show notification
     * @returns {Promise<{finalPath: string, name: string}>} Result with actual path and name
     */
    async _performFileOperation(sourcePath, destPath, action, silent = false) {
      const finalPath = await this.fs.getUniquePath(destPath);
      const name = this.fs.getFileName(finalPath);

      if (action === 'move') {
        await this.fs.moveItem(sourcePath, finalPath);
        if (!silent) this._notify(`Moved: ${name}`);
      } else {
        await this.fs.copyItem(sourcePath, finalPath, true);
        if (!silent) this._notify(`Copied: ${name}`);
      }

      return { finalPath, name };
    },

    _notify(message, type = 'info') {
      // Use OS notification if available
      if (window.parent?.HeymingOS?.notifications) {
        window.parent.HeymingOS.notifications[type === 'error' ? 'error' : 'success'](message);
      } else {
        debug(message);
      }
    },

    /** Copy selected virtual paths to the system clipboard (same strings as jsh / FileSystemDB). */
    async copySelectedPathsToClipboard() {
      if (this.selectedItems.size === 0) return;
      const paths = [...this.selectedItems].sort();
      const text = paths.join('\n');
      try {
        if (!navigator.clipboard?.writeText) {
          this._notify('Clipboard not available', 'error');
          return;
        }
        await navigator.clipboard.writeText(text);
        const label =
          paths.length === 1 ? `Copied path: ${paths[0]}` : `Copied ${paths.length} paths`;
        this._notify(label);
      } catch (err) {
        console.error('copySelectedPathsToClipboard', err);
        this._notify(`Could not copy path: ${err?.message || err}`, 'error');
      }
    }
  });
}

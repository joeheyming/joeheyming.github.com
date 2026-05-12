import { debug } from './filemanager-shared.js';
/** @param {new () => object} FileManager */
export function applyFileManagerView(FileManager) {
  Object.assign(FileManager.prototype, {
    async renderFiles() {
      const fileList = document.getElementById('file-list');
      const emptyState = document.getElementById('empty-state');

      try {
        const items = await this.fs.listDirectory(this.currentPath);

        // Sort: directories first, then alphabetically
        items.sort((a, b) => {
          if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
          return this.fs.getFileName(a.path).localeCompare(this.fs.getFileName(b.path));
        });

        // Add parent directory entry if not at root
        const parentPath = this.fs.getParentPath(this.currentPath);
        const showParent = parentPath !== null;

        if (items.length === 0 && !showParent) {
          fileList.innerHTML = '';
          emptyState.classList.remove('hidden');
        } else {
          emptyState.classList.add('hidden');

          // Build file list HTML
          let html = '';

          if (this.isListView) {
            html += this._renderListHeader();
          }

          // Add ".." parent directory entry
          if (showParent) {
            html += this._renderParentItem(parentPath);
          }

          // Add regular items
          html += items.map((item) => this.renderFileItem(item)).join('');

          if (items.length === 0 && showParent) {
            html += this._renderEmptyFolderHint();
          }

          fileList.innerHTML = html;

          // Bind click and drag events
          fileList.querySelectorAll('.file-item').forEach((el) => {
            const path = el.dataset.path;
            const isParentItem = el.classList.contains('parent-item');

            el.tabIndex = -1;

            // Make items draggable (except parent ".." item)
            if (!isParentItem) {
              el.draggable = true;
            }
            el.addEventListener('dragstart', (e) => {
              // Don't drag the parent item
              if (isParentItem) {
                e.preventDefault();
                return;
              }
              debug('dragstart on:', path);

              // If dragging an unselected item, select only that item
              // If dragging a selected item, drag all selected items
              if (!this.selectedItems.has(path)) {
                this.selectedItems.clear();
                this.selectedItems.add(path);
                // Just update visual selection without full re-render
                fileList.querySelectorAll('.file-item').forEach((item) => {
                  item.classList.toggle('selected', this.selectedItems.has(item.dataset.path));
                });
              }

              // Get all selected paths for multi-drag
              const pathsToDrag = [...this.selectedItems];

              // Store drag data in class property and DragService
              // Default to MOVE (like a normal file browser), hold Alt/Option to COPY
              this._dragData = {
                paths: pathsToDrag,
                path: pathsToDrag[0], // Backward compatibility
                action: e.altKey ? 'copy' : 'move'
              };
              window.parent?.HeymingOS?.DragService?.setData(this._dragData, 'filemanager');
              debug('Setting drag data:', this._dragData);

              // Also set in dataTransfer for external drops (desktop, other apps)
              e.dataTransfer.setData('application/x-heyming-file', JSON.stringify(this._dragData));
              e.dataTransfer.setData('text/plain', pathsToDrag.join('\n'));
              e.dataTransfer.effectAllowed = e.altKey ? 'copy' : 'move';
            });

            el.addEventListener('dragend', () => {
              this._dragData = null;
            });

            el.addEventListener('click', (e) => {
              if (e.ctrlKey || e.metaKey) {
                // Multi-select
                if (this.selectedItems.has(path)) {
                  this.selectedItems.delete(path);
                } else {
                  this.selectedItems.add(path);
                }
              } else {
                this.selectedItems.clear();
                this.selectedItems.add(path);
              }
              this.renderFiles();
            });

            el.addEventListener('dblclick', async () => {
              const item = await this.fs.getItem(path);
              if (item.type === 'directory') {
                this.navigateTo(path);
              } else {
                this.previewFile(item);
              }
            });

            // Allow dropping onto directories
            el.addEventListener('dragover', (e) => {
              const isDirectory = el.dataset.type === 'directory';
              debug('dragover on:', path, 'isDirectory:', isDirectory);
              if (isDirectory) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
                el.classList.add('drop-target');
              }
            });

            el.addEventListener('dragleave', () => {
              el.classList.remove('drop-target');
            });

            el.addEventListener('drop', async (e) => {
              debug('drop event on:', path);
              e.preventDefault();
              e.stopPropagation();
              el.classList.remove('drop-target');

              const item = await this.fs.getItem(path);
              debug('drop target item:', item);
              if (!item || item.type !== 'directory') {
                debug('Not a directory, ignoring drop');
                return;
              }

              // Use class property for internal drag data (more reliable than dataTransfer in iframes)
              const fileData = this._dragData;
              debug('dragData from class:', fileData);

              if (fileData) {
                const fileName = this.fs.getFileName(fileData.path);
                const destPath = `${path}/${fileName}`;
                debug('Moving/copying from', fileData.path, 'to', destPath);

                // Don't drop into itself
                if (fileData.path === path || destPath.startsWith(fileData.path + '/')) {
                  this._notify('Cannot move folder into itself', 'error');
                  return;
                }

                try {
                  await this._performFileOperation(fileData.path, destPath, fileData.action);
                  await this.refresh();
                } catch (error) {
                  console.error('Drop failed:', error);
                  this._notify(`Drop failed: ${error.message}`, 'error');
                }
              } else {
                debug('No drag data found');
              }
            });
          });
        }

        this.updateStatusBar(items.length, showParent);
      } catch (error) {
        console.error('Render error:', error);
        emptyState.classList.add('hidden');
        fileList.innerHTML = `<div class="file-list-error" role="alert">Could not load this folder. ${this.escapeHtml(
          String(error?.message || error)
        )}</div>`;
        this.updateStatusBar(0, false);
      }
    },

    _renderListHeader() {
      return `
    <div class="file-list-header" aria-hidden="true">
      <span class="file-icon file-list-header-icon-spacer" aria-hidden="true"> </span>
      <span class="file-name file-list-header-label">Name</span>
      <div class="file-meta file-list-header-meta">
        <span>Size</span>
        <span>Modified</span>
      </div>
    </div>
  `;
    },

    _renderEmptyFolderHint() {
      return `
    <div class="empty-folder-hint" role="status" aria-live="polite">
      <span class="empty-folder-hint-icon" aria-hidden="true">📭</span>
      <div class="empty-folder-hint-text">
        <p class="empty-folder-hint-title">No files or folders here</p>
        <p class="empty-folder-hint-sub">Use <strong>📄+</strong> or <strong>📁+</strong> to add something, or press <kbd>Backspace</kbd> to go up.</p>
      </div>
    </div>
  `;
    },

    _renderParentItem(parentPath) {
      const isSelected = this.selectedItems.has(parentPath);
      const sel = isSelected ? ' selected' : '';
      if (this.isListView) {
        return `
      <div class="file-item parent-item${sel}" data-path="${parentPath}" data-type="directory">
        <span class="file-icon">📂</span>
        <span class="file-name">..</span>
        <div class="file-meta">
          <span>--</span>
          <span>--</span>
        </div>
      </div>
    `;
      }

      return `
    <div class="file-item parent-item${sel}" data-path="${parentPath}" data-type="directory">
      <span class="file-icon">📂</span>
      <span class="file-name">..</span>
    </div>
  `;
    },

    renderFileItem(item) {
      const name = this.fs.getFileName(item.path);
      const icon = this.getFileIcon(item);
      const isSelected = this.selectedItems.has(item.path);
      const itemType = item.type; // 'file' or 'directory'

      if (this.isListView) {
        const size = item.type === 'file' ? this.formatSize(item.size || 0) : '--';
        const modified = item.modified ? new Date(item.modified).toLocaleDateString() : '--';

        const cls = `file-item ${isSelected ? 'selected' : ''}`;
        return `
      <div class="${cls}" data-path="${item.path}" data-type="${itemType}">
        <span class="file-icon">${icon}</span>
        <span class="file-name">${this.escapeHtml(name)}</span>
        <div class="file-meta">
          <span>${size}</span>
          <span>${modified}</span>
        </div>
      </div>
    `;
      }

      const cls = `file-item ${isSelected ? 'selected' : ''}`;
      return `
    <div class="${cls}" data-path="${item.path}" data-type="${itemType}">
      <span class="file-icon">${icon}</span>
      <span class="file-name">${this.escapeHtml(name)}</span>
    </div>
  `;
    },

    getFileIcon(item) {
      return window.parent?.HeymingOS?.Icons?.getIconForItem(item) || '📄';
    },

    toggleView() {
      this.isListView = !this.isListView;
      const fileList = document.getElementById('file-list');
      fileList.classList.toggle('list-view', this.isListView);
      fileList.classList.toggle('grid-view', !this.isListView);
      this.renderFiles();
      this._syncViewToggleAria();
    },

    /** Theme E: toolbar view toggle — aria-pressed + labels for list vs grid. */
    _syncViewToggleAria() {
      const btn = document.getElementById('btn-view-toggle');
      if (!btn) return;
      btn.setAttribute('aria-pressed', this.isListView ? 'true' : 'false');
      if (this.isListView) {
        btn.setAttribute('aria-label', 'List view');
        btn.title = 'Switch to grid view';
      } else {
        btn.setAttribute('aria-label', 'Grid view');
        btn.title = 'Switch to list view';
      }
    },

    formatSize(bytes) {
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
      return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    },

    escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
  });
}

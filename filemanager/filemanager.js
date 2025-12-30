// File Manager for Heyming OS
// Uses shared IndexedDB filesystem with Terminal

// Debug logging helper
function debug(...args) {
  if (window.parent?.HeymingOS?.Config?.DEBUG) {
    console.log('[FileManager]', ...args);
  }
}

class FileManager {
  constructor() {
    this.fs = null;
    this.cfg = window.parent?.HeymingOS?.Config || { HOME: '/home/jheyming', USER: 'jheyming' };
    this.currentPath = this.cfg.HOME;
    this.history = [this.currentPath];
    this.historyIndex = 0;
    this.selectedItems = new Set();
    this.isListView = false;

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

  _generateSidebar() {
    // Generate Quick Access items from config
    const quickAccess = this.cfg.getQuickAccess
      ? this.cfg.getQuickAccess()
      : [
          { name: '🏠 Home', path: this.cfg.HOME },
          { name: '🖥️ Desktop', path: `${this.cfg.HOME}/Desktop` },
          { name: '📄 Documents', path: `${this.cfg.HOME}/Documents` },
          { name: '⬇️ Downloads', path: `${this.cfg.HOME}/Downloads` },
          { name: '🖼️ Pictures', path: `${this.cfg.HOME}/Pictures` },
          { name: '🎵 Music', path: `${this.cfg.HOME}/Music` },
          { name: '🎬 Videos', path: `${this.cfg.HOME}/Videos` }
        ];

    const section = document.getElementById('quick-access-section');
    if (!section) return;

    // Keep the h3, add items after
    const items = quickAccess
      .map((item) => `<div class="sidebar-item" data-path="${item.path}">${item.name}</div>`)
      .join('');

    section.innerHTML = `<h3>Quick Access</h3>${items}`;
  }

  bindEvents() {
    // Listen for filesystem changes from the OS
    window.addEventListener('message', (e) => {
      if (e.data?.type === 'filesystem-change') {
        // Refresh if the change affects the current directory or its parent
        const changedPath = e.data.path;
        const details = e.data.details || {};
        const affectsCurrentDir =
          changedPath.startsWith(this.currentPath) ||
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
      this.showContextMenu(e);
    });

    document.addEventListener('click', () => this.hideContextMenu());

    document.querySelectorAll('#context-menu .menu-item').forEach((item) => {
      item.addEventListener('click', () => {
        const action = item.dataset.action;
        this.handleContextAction(action);
        this.hideContextMenu();
      });
    });

    // Dialog
    document.getElementById('dialog-cancel').addEventListener('click', () => this.hideDialog());
    document.getElementById('dialog-confirm').addEventListener('click', () => this.confirmDialog());
    document.getElementById('dialog-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.confirmDialog();
      if (e.key === 'Escape') this.hideDialog();
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

      if (e.key === 'Delete' && this.selectedItems.size > 0) {
        this.deleteSelected();
      }
      if (e.key === 'F2' && this.selectedItems.size === 1) {
        this.renameSelected();
      }
      if (e.key === 'Escape') {
        this.selectedItems.clear();
        this.renderFiles();
      }
      if (e.key === 'Enter' && this.selectedItems.size === 1) {
        e.preventDefault();
        const path = [...this.selectedItems][0];
        this.openItem(path);
      }
      if (e.key === ' ' && this.selectedItems.size === 1) {
        e.preventDefault();
        const path = [...this.selectedItems][0];
        this.previewFile(path);
      }
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        this.navigateWithArrows(e.key, e.shiftKey);
      }
      if (e.key === 'Backspace') {
        e.preventDefault();
        this.goUp();
      }
      if (e.ctrlKey || e.metaKey) {
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
  }

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
  }

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
  }

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
  }

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
  }

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
  }

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
  }

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
  }

  _notify(message, type = 'info') {
    // Use OS notification if available
    if (window.parent?.HeymingOS?.notifications) {
      window.parent.HeymingOS.notifications[type === 'error' ? 'error' : 'success'](message);
    } else {
      debug(message);
    }
  }

  async navigateTo(path) {
    try {
      const item = await this.fs.getItem(path);
      if (!item || item.type !== 'directory') {
        console.error('Not a directory:', path);
        return;
      }

      this.currentPath = path;

      // Update history
      if (this.historyIndex < this.history.length - 1) {
        this.history = this.history.slice(0, this.historyIndex + 1);
      }
      if (this.history[this.historyIndex] !== path) {
        this.history.push(path);
        this.historyIndex = this.history.length - 1;
      }

      this.selectedItems.clear();
      await this.renderFiles();
      this.updatePathBar();
      this.updateSidebar();
      this.updateNavigationButtons();
    } catch (error) {
      console.error('Navigation error:', error);
    }
  }

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

        // Add ".." parent directory entry
        if (showParent) {
          html += this._renderParentItem(parentPath);
        }

        // Add regular items
        html += items.map((item) => this.renderFileItem(item)).join('');
        fileList.innerHTML = html;

        // Bind click and drag events
        fileList.querySelectorAll('.file-item').forEach((el) => {
          const path = el.dataset.path;
          const isParentItem = el.classList.contains('parent-item');

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

      this.updateStatusBar(items.length);
    } catch (error) {
      console.error('Render error:', error);
      fileList.innerHTML = '<div class="error">Error loading files</div>';
    }
  }

  _renderParentItem(parentPath) {
    if (this.isListView) {
      return `
        <div class="file-item parent-item" data-path="${parentPath}" data-type="directory">
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
      <div class="file-item parent-item" data-path="${parentPath}" data-type="directory">
        <span class="file-icon">📂</span>
        <span class="file-name">..</span>
      </div>
    `;
  }

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
  }

  getFileIcon(item) {
    return window.parent?.HeymingOS?.Icons?.getIconForItem(item) || '📄';
  }

  goBack() {
    if (this.historyIndex > 0) {
      this.historyIndex--;
      this.navigateTo(this.history[this.historyIndex]);
    }
  }

  goForward() {
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex++;
      this.navigateTo(this.history[this.historyIndex]);
    }
  }

  goUp() {
    const parent = this.fs.getParentPath(this.currentPath);
    if (parent) {
      this.navigateTo(parent);
    }
  }

  refresh() {
    this.renderFiles();
  }

  toggleView() {
    this.isListView = !this.isListView;
    const fileList = document.getElementById('file-list');
    fileList.classList.toggle('list-view', this.isListView);
    fileList.classList.toggle('grid-view', !this.isListView);
    this.renderFiles();
  }

  updatePathBar() {
    const pathBar = document.getElementById('current-path');
    if (!pathBar) return;

    // Split path into segments
    const segments = this.currentPath.split('/').filter(Boolean);

    // Build breadcrumb HTML
    let html = '<span class="breadcrumb-segment" data-path="/">🏠</span>';
    let currentPath = '';

    segments.forEach((segment, index) => {
      currentPath += '/' + segment;
      const isLast = index === segments.length - 1;
      const activeClass = isLast ? ' active' : '';

      html += '<span class="breadcrumb-separator">›</span>';
      html += `<span class="breadcrumb-segment${activeClass}" data-path="${currentPath}">`;
      html += `${this.escapeHtml(segment)}</span>`;
    });

    pathBar.innerHTML = html;

    // Add click handlers
    pathBar.querySelectorAll('.breadcrumb-segment').forEach((seg) => {
      seg.addEventListener('click', () => {
        const path = seg.dataset.path;
        if (path !== this.currentPath) {
          this.navigateTo(path);
        }
      });
    });
  }

  updateSidebar() {
    document.querySelectorAll('.sidebar-item').forEach((item) => {
      item.classList.toggle('active', item.dataset.path === this.currentPath);
    });
  }

  updateNavigationButtons() {
    document.getElementById('btn-back').disabled = this.historyIndex <= 0;
    document.getElementById('btn-forward').disabled = this.historyIndex >= this.history.length - 1;
    document.getElementById('btn-up').disabled = this.currentPath === '/';
  }

  updateStatusBar(count) {
    document.getElementById('item-count').textContent = `${count} item${count !== 1 ? 's' : ''}`;

    const selectedCount = this.selectedItems.size;
    document.getElementById('selected-info').textContent =
      selectedCount > 0 ? `${selectedCount} selected` : '';
  }

  showContextMenu(e) {
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

    // Adjust if menu goes off screen
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menu.style.left = e.clientX - rect.width + 'px';
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = e.clientY - rect.height + 'px';
    }
  }

  hideContextMenu() {
    document.getElementById('context-menu').classList.add('hidden');
  }

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

  showNewFolderDialog() {
    this.dialogMode = 'new-folder';
    document.getElementById('dialog-title').textContent = 'New Folder';
    document.getElementById('dialog-input').value = '';
    document.getElementById('dialog-input').placeholder = 'Folder name...';
    document.getElementById('dialog-confirm').textContent = 'Create';
    document.getElementById('dialog-overlay').classList.remove('hidden');
    document.getElementById('dialog-input').focus();
  }

  showNewFileDialog() {
    this.dialogMode = 'new-file';
    document.getElementById('dialog-title').textContent = 'New File';
    document.getElementById('dialog-input').value = '';
    document.getElementById('dialog-input').placeholder = 'File name...';
    document.getElementById('dialog-confirm').textContent = 'Create';
    document.getElementById('dialog-overlay').classList.remove('hidden');
    document.getElementById('dialog-input').focus();
  }

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
    document.getElementById('dialog-overlay').classList.remove('hidden');
    document.getElementById('dialog-input').focus();
    document.getElementById('dialog-input').select();
  }

  hideDialog() {
    document.getElementById('dialog-overlay').classList.add('hidden');
    this.dialogMode = null;
    this.dialogTarget = null;
  }

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
  }

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
  }

  copySelected() {
    const FileOps = window.parent?.HeymingOS?.FileOperationService;
    if (FileOps) {
      const result = FileOps.copy(this.fs, [...this.selectedItems], 'filemanager');
      if (result.message) this._notify(result.message);
    }
  }

  cutSelected() {
    const FileOps = window.parent?.HeymingOS?.FileOperationService;
    if (FileOps) {
      const result = FileOps.cut(this.fs, [...this.selectedItems], 'filemanager');
      if (result.message) this._notify(result.message);
    }
  }

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
  }

  selectAll() {
    document.querySelectorAll('.file-item').forEach((el) => {
      this.selectedItems.add(el.dataset.path);
    });
    this.renderFiles();
  }

  async openItem(path) {
    const item = await this.fs.getItem(path);
    if (!item) return;

    if (item.type === 'directory') {
      this.navigateTo(path);
    } else {
      this.previewFile(item);
    }
  }

  navigateWithArrows(key, shiftKey) {
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
        this.renderFiles();
        fileItems[0]?.scrollIntoView({ block: 'nearest' });
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

    this.renderFiles();
    fileItems[nextIndex]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

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
      document.getElementById('preview-content').textContent = item.content || '(empty file)';
      document.getElementById('preview-overlay').classList.remove('hidden');
    }
  }

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
      document.getElementById('preview-content').textContent = item.content || '(empty file)';
      document.getElementById('preview-overlay').classList.remove('hidden');
    }
  }

  /**
   * Notify the OS that files have changed, so desktop can refresh
   */
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
  }

  hidePreview() {
    document.getElementById('preview-overlay').classList.add('hidden');
  }

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

  formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Initialize file manager
window.fileManager = new FileManager();

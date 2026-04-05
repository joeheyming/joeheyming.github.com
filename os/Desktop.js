/**
 * Heyming OS - Desktop
 * Handles desktop icons and background
 */

import { Config } from './config.js';
import { Constants } from './constants.js';
import { InputHandler } from './InputHandler.js';
import { DragService } from './DragService.js';
import { FileOperationService } from './FileOperationService.js';
import { QuickLookPreview } from './QuickLookPreview.js';

export class Desktop {
  constructor(onLaunchApp, onOpenFile) {
    this.onLaunchApp = onLaunchApp;
    this.onOpenFile = onOpenFile;
    this.desktop = null;
    this.fs = null;
    this.desktopPath = Config.DESKTOP;
    this.fileIcons = []; // Track file icons for refresh
    this.selectedFiles = new Set(); // Currently selected file paths
    this.lastSelectedFile = null; // For shift-click range selection
    this.C = Constants;
    this.Input = InputHandler;

    // Drag selection state
    this.isDragSelecting = false;
    this.dragSelectStart = null;
    this.selectionBox = null;

    // Quick Look preview
    this.quickLook = null;
  }

  /**
   * Initialize desktop with icons
   */
  async init() {
    this.desktop = document.getElementById('os-desktop');
    if (!this.desktop) {
      console.warn('Desktop: os-desktop element not found');
      return;
    }

    // Get shared filesystem instance (singleton)
    if (window.FileSystemDB) {
      this.fs = await window.FileSystemDB.getInstance();
    }

    this._setupDropZone();
    this._setupKeyboardShortcuts();
    this._setupSelectionHandling();
    this._setupDesktopIconFocusSync();
    this._setupDragSelection();
    this._waitForAppModule();

    // Initialize Quick Look preview component
    this.quickLook = new QuickLookPreview(this.desktop, {
      onOpenFile: (item) => this.onOpenFile(item)
    });
  }

  /**
   * Refresh desktop file icons
   */
  async refresh() {
    await this._loadDesktopFiles();
  }

  // ========== Private Methods ==========

  _waitForAppModule(attempts = 0) {
    const MAX_ATTEMPTS = 20;
    const RETRY_DELAY = 100;

    if (window.AppModule) {
      try {
        this._createDesktopIcons();
        this._loadDesktopFiles();
      } catch (error) {
        console.error('[Desktop] Failed to initialize icons:', error);
      }
      return;
    }

    if (attempts < MAX_ATTEMPTS) {
      setTimeout(() => this._waitForAppModule(attempts + 1), RETRY_DELAY);
    } else {
      console.error('[Desktop] AppModule never loaded after', MAX_ATTEMPTS * RETRY_DELAY, 'ms');
    }
  }

  _createDesktopIcons() {
    // Get all apps with desktopIcon: true from registry
    const desktopApps = window.AppModule.getDesktopApps();
    if (this.Input.isMobile()) {
      // On mobile: all apps in a responsive grid (ignore fixed positions)
      const iconSpacingX = this.C.MOBILE_ICON_SPACING_X;
      const iconSpacingY = this.C.MOBILE_ICON_SPACING_Y;
      const startX = this.C.MOBILE_ICON_START_X;
      const startY = this.C.MOBILE_ICON_START_Y;
      const iconsPerRow = Math.max(
        this.C.MOBILE_MIN_ICONS_PER_ROW,
        Math.floor((window.innerWidth - this.C.MOBILE_ICON_MARGIN) / iconSpacingX)
      );

      desktopApps.forEach((app, index) => {
        const row = Math.floor(index / iconsPerRow);
        const col = index % iconsPerRow;

        this._createAppIcon({
          name: app.shortName,
          icon: app.icon,
          x: startX + col * iconSpacingX,
          y: startY + row * iconSpacingY,
          app: app.id
        });
      });
    } else {
      // On desktop: system apps at fixed positions, others in grid
      const systemApps = desktopApps.filter((app) => app.system && app.desktopPosition);
      const regularApps = desktopApps.filter((app) => !app.system || !app.desktopPosition);

      // Create system app icons at their fixed positions
      systemApps.forEach((app) => {
        this._createAppIcon({
          name: app.shortName,
          icon: app.icon,
          x: app.desktopPosition.x,
          y: app.desktopPosition.y,
          app: app.id
        });
      });

      // Create regular app icons in a grid
      regularApps.forEach((app, index) => {
        const row = Math.floor(index / this.C.ICONS_PER_ROW);
        const col = index % this.C.ICONS_PER_ROW;

        this._createAppIcon({
          name: app.shortName,
          icon: app.icon,
          x: this.C.ICON_START_X + col * this.C.ICON_SPACING_X,
          y: this.C.ICON_START_Y + row * this.C.ICON_SPACING_Y,
          app: app.id
        });
      });
    }
  }

  async _loadDesktopFiles() {
    if (!this.fs) return;

    // Remove existing file icons
    this.fileIcons.forEach((icon) => icon.remove());
    this.fileIcons = [];

    try {
      const items = await this.fs.listDirectory(this.desktopPath);
      const files = items.filter((item) => item.type === 'file');
      if (this.Input.isMobile()) {
        // On mobile, place files below app icons in a grid
        const desktopApps = window.AppModule?.getDesktopApps() || [];
        const iconsPerRow = Math.max(
          this.C.MOBILE_MIN_ICONS_PER_ROW,
          Math.floor((window.innerWidth - this.C.MOBILE_ICON_MARGIN) / this.C.MOBILE_ICON_SPACING_X)
        );
        const appIconRows = Math.ceil(desktopApps.length / iconsPerRow);

        const startX = this.C.MOBILE_ICON_START_X;
        const startY =
          this.C.MOBILE_ICON_START_Y + (appIconRows + 1) * this.C.MOBILE_ICON_SPACING_Y;

        files.forEach((file, index) => {
          const fileName = this.fs.getFileName(file.path);
          const icon = this._getFileIcon(fileName);
          const row = Math.floor(index / iconsPerRow);
          const col = index % iconsPerRow;

          const iconEl = this._createFileIcon({
            name: fileName,
            icon: icon,
            x: startX + col * this.C.MOBILE_ICON_SPACING_X,
            y: startY + row * this.C.MOBILE_ICON_SPACING_Y,
            file: file
          });

          this.fileIcons.push(iconEl);
        });
      } else {
        // On desktop, place files on the right side
        const startX = window.innerWidth - this.C.FILE_ICON_RIGHT_OFFSET;
        const startY = this.C.FILE_ICON_START_Y;
        const spacing = this.C.FILE_ICON_SPACING;

        files.forEach((file, index) => {
          const fileName = this.fs.getFileName(file.path);
          const icon = this._getFileIcon(fileName);

          const iconEl = this._createFileIcon({
            name: fileName,
            icon: icon,
            x: startX,
            y: startY + index * spacing,
            file: file
          });

          this.fileIcons.push(iconEl);
        });
      }
    } catch (error) {
      console.warn('Failed to load desktop files:', error);
    }
  }

  _createAppIcon(iconData) {
    const icon = document.createElement('div');
    icon.className = 'desktop-icon';
    icon.style.left = iconData.x + 'px';
    icon.style.top = iconData.y + 'px';

    const iconEl = document.createElement('div');
    iconEl.className = 'icon';
    iconEl.textContent = iconData.icon;

    const labelEl = document.createElement('div');
    labelEl.className = 'label';
    labelEl.textContent = iconData.name;

    icon.appendChild(iconEl);
    icon.appendChild(labelEl);

    icon.tabIndex = 0;
    icon.setAttribute('role', 'button');
    icon.setAttribute('aria-label', `Open ${iconData.name}`);
    icon.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.onLaunchApp(iconData.app);
      }
    });

    this.Input.addDoubleTapHandler(icon, () => {
      this.onLaunchApp(iconData.app);
    });

    this.desktop.appendChild(icon);
    return icon;
  }

  _createFileIcon(iconData) {
    const icon = document.createElement('div');
    icon.className = 'desktop-icon file-icon';
    icon.setAttribute('data-path', iconData.file.path);
    icon.style.left = iconData.x + 'px';
    icon.style.top = iconData.y + 'px';
    icon.draggable = true;

    // Truncate long filenames
    const displayName =
      iconData.name.length > this.C.ICON_LABEL_MAX_LENGTH
        ? iconData.name.substring(0, this.C.ICON_LABEL_TRUNCATE_AT) + '...'
        : iconData.name;

    const iconEl = document.createElement('div');
    iconEl.className = 'icon';
    iconEl.textContent = iconData.icon;

    const labelEl = document.createElement('div');
    labelEl.className = 'label';
    labelEl.title = iconData.name;
    labelEl.textContent = displayName;

    icon.appendChild(iconEl);
    icon.appendChild(labelEl);

    icon.tabIndex = 0;
    icon.setAttribute('role', 'button');
    icon.setAttribute('aria-label', `${iconData.name}, file — Enter to open, Space for Quick Look`);
    icon.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this._selectFile(iconData.file.path, icon, null);
        void this._openSelected();
      } else if (e.key === ' ') {
        e.preventDefault();
        this._selectFile(iconData.file.path, icon, null);
        void this._showQuickLook();
      }
    });

    // Make file draggable to real OS
    icon.addEventListener('dragstart', async (e) => {
      e.stopPropagation(); // Don't trigger desktop drop zone
      await this._handleFileDragStart(e, iconData);
    });

    icon.addEventListener('dragend', (e) => {
      // Clear shared drag data
      DragService.clear();

      // If dropped outside the browser window, trigger download
      if (e.dataTransfer.dropEffect === 'none') {
        this._downloadFile(iconData);
      }
    });

    // Single click to select (with modifier key support)
    icon.addEventListener('click', (e) => {
      e.stopPropagation();
      this._selectFile(iconData.file.path, icon, e);
    });

    this.Input.addDoubleTapHandler(icon, async () => {
      // Get full file item with content
      const item = await this.fs.getItem(iconData.file.path);
      if (item && this.onOpenFile) {
        this.onOpenFile(item);
      }
    });

    this.desktop.appendChild(icon);
    return icon;
  }

  async _handleFileDragStart(e, iconData) {
    const iconElement = e.target.closest('.desktop-icon');
    const draggedPath = iconData.file.path;

    // Determine which files to drag:
    // - If dragged file is in selection, drag all selected files
    // - If dragged file is NOT in selection, select it and drag only it
    let pathsToDrag;
    if (this.selectedFiles.has(draggedPath)) {
      pathsToDrag = [...this.selectedFiles];
    } else {
      // Clicking an unselected file while dragging - select just that file
      this._clearSelection();
      this.selectedFiles.add(draggedPath);
      iconElement.classList.add('selected');
      pathsToDrag = [draggedPath];
    }

    // Set data for internal transfers (to File Manager) - support multiple paths
    const dragData = {
      paths: pathsToDrag,
      path: pathsToDrag[0], // Backward compatibility
      action: 'move'
    };
    DragService.setData(dragData, 'desktop');
    e.dataTransfer.setData('application/x-heyming-file', JSON.stringify(dragData));

    // For dragging to real OS - only support single file download
    // (browsers don't support multi-file drag well)
    const item = await this.fs.getItem(draggedPath);
    if (item) {
      const fileName = iconData.name;
      const content = item.content || '';
      const mimeType = item.mimeType || 'text/plain';

      try {
        let blob;
        if (typeof content === 'string' && content.startsWith('data:')) {
          const response = await fetch(content);
          blob = await response.blob();
        } else {
          blob = new Blob([content], { type: mimeType });
        }

        const url = URL.createObjectURL(blob);
        e.dataTransfer.setData('DownloadURL', `${mimeType}:${fileName}:${url}`);

        if (mimeType.startsWith('text/') || mimeType === 'application/json') {
          e.dataTransfer.setData('text/plain', content);
        }

        iconElement.addEventListener(
          'dragend',
          () => {
            URL.revokeObjectURL(url);
          },
          { once: true }
        );
      } catch (error) {
        console.warn('Failed to prepare file for drag:', error);
        e.dataTransfer.setData('text/plain', draggedPath);
      }
    }

    e.dataTransfer.effectAllowed = 'copyMove';
  }

  _getFileIcon(filename) {
    return window.HeymingOS.Icons.getIconForFile(filename);
  }

  // ========== Selection & Keyboard ==========

  _setupSelectionHandling() {
    // Click on desktop clears selection
    this.desktop.addEventListener('click', (e) => {
      // Only clear if clicking on desktop itself, not on icons
      if (e.target === this.desktop || e.target.id === 'os-desktop') {
        this._clearSelection();
      }
    });
  }

  /** Theme E: when Tab moves focus onto an icon, sync file selection with keyboard users. */
  _setupDesktopIconFocusSync() {
    this.desktop.addEventListener('focusin', (e) => {
      const icon = e.target?.closest?.('.desktop-icon');
      if (!icon || !this.desktop.contains(icon)) return;
      if (icon.classList.contains('file-icon')) {
        const path = icon.dataset.path;
        if (path) this._selectFile(path, icon, null);
      } else {
        this._clearSelection();
      }
    });
  }

  _setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Only handle shortcuts when desktop is focused (no input element)
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      // Skip if within an iframe
      if (e.target.closest('iframe')) return;

      const isMeta = e.metaKey || e.ctrlKey;
      const hasSelection = this.selectedFiles.size > 0;
      const hasSingleSelection = this.selectedFiles.size === 1;

      if (isMeta && e.key === 'c' && hasSelection) {
        e.preventDefault();
        this._copySelected();
      } else if (isMeta && e.key === 'x' && hasSelection) {
        e.preventDefault();
        this._cutSelected();
      } else if (isMeta && e.key === 'v') {
        e.preventDefault();
        this._paste();
      } else if (e.key === 'Delete' && hasSelection) {
        e.preventDefault();
        this._deleteSelected();
      } else if (isMeta && e.key === 'a') {
        // Select all files
        e.preventDefault();
        this._selectAll();
      } else if (e.key === 'F2' && hasSingleSelection) {
        // Rename selected file
        e.preventDefault();
        this._renameSelected();
      } else if (e.key === ' ' && hasSingleSelection) {
        // Quick Look preview
        e.preventDefault();
        this._showQuickLook();
      } else if (e.key === 'Escape') {
        // Close Quick Look if open (stop Escape from reaching HeymingOS global hide())
        if (this.quickLook?.isOpen()) {
          e.preventDefault();
          e.stopImmediatePropagation();
          this.quickLook.close();
        }
      } else if (e.key === 'Enter' && hasSingleSelection) {
        // Open selected file
        e.preventDefault();
        this._openSelected();
      } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        const ae = document.activeElement;
        if (ae?.closest?.('.desktop-icon:not(.file-icon)')) {
          return;
        }
        // Arrow key navigation
        e.preventDefault();
        this._navigateWithArrows(e.key, e.shiftKey);
      }
    });
  }

  _selectFile(path, iconElement, event = null) {
    const isCmd = event?.metaKey || event?.ctrlKey;
    const isShift = event?.shiftKey;

    if (isCmd) {
      // Cmd/Ctrl+click: Toggle selection
      if (this.selectedFiles.has(path)) {
        this.selectedFiles.delete(path);
        iconElement.classList.remove('selected');
      } else {
        this.selectedFiles.add(path);
        iconElement.classList.add('selected');
      }
      this.lastSelectedFile = path;
    } else if (isShift && this.lastSelectedFile) {
      // Shift+click: Range selection
      this._selectRange(this.lastSelectedFile, path);
    } else {
      // Regular click: Single select
      this._clearSelection();
      this.selectedFiles.add(path);
      iconElement.classList.add('selected');
      this.lastSelectedFile = path;
    }
  }

  _selectRange(fromPath, toPath) {
    // Get all file icons in order
    const icons = Array.from(this.desktop.querySelectorAll('.file-icon'));
    const paths = icons.map((el) => el.dataset.path);

    const fromIndex = paths.indexOf(fromPath);
    const toIndex = paths.indexOf(toPath);

    if (fromIndex === -1 || toIndex === -1) return;

    const start = Math.min(fromIndex, toIndex);
    const end = Math.max(fromIndex, toIndex);

    // Clear and select range
    this._clearSelection();
    for (let i = start; i <= end; i++) {
      const path = paths[i];
      if (path) {
        this.selectedFiles.add(path);
        icons[i].classList.add('selected');
      }
    }
  }

  _clearSelection() {
    this.selectedFiles.clear();
    this.desktop.querySelectorAll('.file-icon.selected').forEach((el) => {
      el.classList.remove('selected');
    });
  }

  _copySelected() {
    if (this.selectedFiles.size === 0) return;
    const result = FileOperationService.copy(this.fs, [...this.selectedFiles], 'desktop');
    if (result.message) this._notify(result.message);
  }

  _cutSelected() {
    if (this.selectedFiles.size === 0) return;
    const result = FileOperationService.cut(this.fs, [...this.selectedFiles], 'desktop');
    if (result.message) this._notify(result.message);
  }

  _selectAll() {
    this._clearSelection();
    this.fileIcons.forEach((icon) => {
      const path = icon.dataset.path;
      if (path) {
        this.selectedFiles.add(path);
        icon.classList.add('selected');
      }
    });
    const count = this.selectedFiles.size;
    if (count > 0) {
      this._notify(`Selected ${count} item${count > 1 ? 's' : ''}`);
    }
  }

  async _paste() {
    const result = await FileOperationService.paste(this.fs, this.desktopPath);
    if (result.message) {
      this._notify(result.message, result.success ? 'system' : 'error');
    }
  }

  async _deleteSelected() {
    if (this.selectedFiles.size === 0) return;
    const result = await FileOperationService.delete(this.fs, [...this.selectedFiles], true);
    if (result.message) {
      this._notify(result.message, result.success ? 'system' : 'error');
    }
    if (result.success) {
      this._clearSelection();
    }
  }

  async _renameSelected() {
    if (this.selectedFiles.size !== 1) return;
    const path = [...this.selectedFiles][0];
    const result = await FileOperationService.rename(this.fs, path);
    if (result.message) {
      this._notify(result.message, result.success ? 'system' : 'error');
    }
    if (result.success) {
      this._clearSelection();
    }
  }

  // ========== Quick Look Preview ==========

  async _showQuickLook() {
    if (this.selectedFiles.size !== 1) return;

    const path = [...this.selectedFiles][0];
    const item = await this.fs.getItem(path);
    if (!item) return;

    const fileName = this.fs.getFileName(path);
    this.quickLook.show(item, fileName);
  }

  async _openSelected() {
    if (this.selectedFiles.size !== 1) return;
    const path = [...this.selectedFiles][0];
    const item = await this.fs.getItem(path);
    if (item && this.onOpenFile) {
      this.onOpenFile(item);
    }
  }

  _navigateWithArrows(key, shiftKey) {
    if (this.fileIcons.length === 0) return;

    // Get current selection or start from first icon
    const currentPath = this.lastSelectedFile || [...this.selectedFiles][0];
    const currentIcon = currentPath
      ? this.fileIcons.find((el) => el.dataset.path === currentPath)
      : null;

    // If no selection, select the first file icon
    if (!currentIcon) {
      const firstIcon = this.fileIcons[0];
      if (firstIcon) {
        const path = firstIcon.dataset.path;
        this._clearSelection();
        this.selectedFiles.add(path);
        firstIcon.classList.add('selected');
        this.lastSelectedFile = path;
        firstIcon.focus();
      }
      return;
    }

    // Find the next icon in the direction of the arrow key
    const nextIcon = this._findNextIcon(currentIcon, key);
    if (!nextIcon) return;

    const nextPath = nextIcon.dataset.path;

    if (shiftKey) {
      // Shift+Arrow: Extend selection
      this.selectedFiles.add(nextPath);
      nextIcon.classList.add('selected');
    } else {
      // Arrow only: Move selection
      this._clearSelection();
      this.selectedFiles.add(nextPath);
      nextIcon.classList.add('selected');
    }
    this.lastSelectedFile = nextPath;

    // Scroll icon into view if needed
    nextIcon.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    nextIcon.focus();
  }

  _findNextIcon(currentIcon, direction) {
    const currentRect = currentIcon.getBoundingClientRect();
    const currentCenterX = currentRect.left + currentRect.width / 2;
    const currentCenterY = currentRect.top + currentRect.height / 2;

    let bestIcon = null;
    let bestScore = Infinity;

    for (const icon of this.fileIcons) {
      if (icon === currentIcon) continue;

      const rect = icon.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      const dx = centerX - currentCenterX;
      const dy = centerY - currentCenterY;

      // Check if icon is in the right direction
      let isValidDirection = false;
      let primaryDistance = 0;
      let secondaryDistance = 0;

      const threshold = this.C.ARROW_NAV_THRESHOLD;
      switch (direction) {
        case 'ArrowRight':
          isValidDirection = dx > threshold;
          primaryDistance = dx;
          secondaryDistance = Math.abs(dy);
          break;
        case 'ArrowLeft':
          isValidDirection = dx < -threshold;
          primaryDistance = -dx;
          secondaryDistance = Math.abs(dy);
          break;
        case 'ArrowDown':
          isValidDirection = dy > threshold;
          primaryDistance = dy;
          secondaryDistance = Math.abs(dx);
          break;
        case 'ArrowUp':
          isValidDirection = dy < -threshold;
          primaryDistance = -dy;
          secondaryDistance = Math.abs(dx);
          break;
      }

      if (!isValidDirection) continue;

      // Score: prefer closer icons, with secondary distance as tiebreaker
      const score = primaryDistance + secondaryDistance * 0.1;

      if (score < bestScore) {
        bestScore = score;
        bestIcon = icon;
      }
    }

    return bestIcon;
  }

  // ========== Drag Selection (Rubber Band) ==========

  _setupDragSelection() {
    // Create selection box element
    this.selectionBox = document.createElement('div');
    this.selectionBox.className = 'desktop-selection-box';
    this.selectionBox.style.display = 'none';
    this.desktop.appendChild(this.selectionBox);

    // Mouse down - start drag selection
    this.desktop.addEventListener('mousedown', (e) => {
      // Only start if clicking directly on desktop (not on icons or windows)
      if (e.target !== this.desktop && e.target.id !== 'os-desktop') return;
      if (e.button !== 0) return; // Left click only

      // Don't start if right-clicking (context menu)
      if (e.button === 2) return;

      this.isDragSelecting = true;
      this.dragSelectStart = { x: e.clientX, y: e.clientY };

      // Clear selection unless holding Shift or Cmd
      if (!e.shiftKey && !e.metaKey && !e.ctrlKey) {
        this._clearSelection();
      }

      // Show selection box at start position
      this.selectionBox.style.left = e.clientX + 'px';
      this.selectionBox.style.top = e.clientY + 'px';
      this.selectionBox.style.width = '0px';
      this.selectionBox.style.height = '0px';
      this.selectionBox.style.display = 'block';
    });

    // Mouse move - update selection box
    document.addEventListener('mousemove', (e) => {
      if (!this.isDragSelecting) return;

      const startX = this.dragSelectStart.x;
      const startY = this.dragSelectStart.y;
      const currentX = e.clientX;
      const currentY = e.clientY;

      const left = Math.min(startX, currentX);
      const top = Math.min(startY, currentY);
      const width = Math.abs(currentX - startX);
      const height = Math.abs(currentY - startY);

      this.selectionBox.style.left = left + 'px';
      this.selectionBox.style.top = top + 'px';
      this.selectionBox.style.width = width + 'px';
      this.selectionBox.style.height = height + 'px';

      // Select files that intersect with the selection box
      this._selectIntersectingFiles(left, top, width, height, e.shiftKey || e.metaKey || e.ctrlKey);
    });

    // Mouse up - end drag selection
    document.addEventListener('mouseup', () => {
      if (!this.isDragSelecting) return;

      this.isDragSelecting = false;
      this.selectionBox.style.display = 'none';
    });
  }

  _selectIntersectingFiles(boxLeft, boxTop, boxWidth, boxHeight, additive) {
    const boxRight = boxLeft + boxWidth;
    const boxBottom = boxTop + boxHeight;

    // Only check file icons, not app icons
    this.fileIcons.forEach((icon) => {
      const rect = icon.getBoundingClientRect();
      const path = icon.dataset.path;

      // Check if icon intersects with selection box
      const intersects =
        rect.left < boxRight &&
        rect.right > boxLeft &&
        rect.top < boxBottom &&
        rect.bottom > boxTop;

      if (intersects) {
        this.selectedFiles.add(path);
        icon.classList.add('selected');
      } else if (!additive) {
        // If not in additive mode, deselect files outside the box
        this.selectedFiles.delete(path);
        icon.classList.remove('selected');
      }
    });
  }

  // ========== Drop Zone ==========

  _setupDropZone() {
    // Theme E: drop overlay — use relatedTarget on dragleave so moving the pointer over
    // child icons does not clear .drop-active (avoids flicker vs dragleave on every child enter).
    this.desktop.addEventListener('dragenter', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.desktop.classList.add('drop-active');
    });

    this.desktop.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const next = e.relatedTarget;
      if (next && this.desktop.contains(next)) {
        return;
      }
      this.desktop.classList.remove('drop-active');
    });

    this.desktop.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const dt = e.dataTransfer;
      if (!dt) return;
      const types = dt.types ? Array.from(dt.types) : [];
      const internal = types.includes('application/x-heyming-file');
      const files = types.includes('Files');
      if (internal) {
        dt.dropEffect = 'move';
      } else if (files) {
        dt.dropEffect = 'copy';
      }
    });

    this.desktop.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.desktop.classList.remove('drop-active');
      this._handleDrop(e);
    });
  }

  async _handleDrop(e) {
    const dataTransfer = e.dataTransfer;

    // Check for internal file drag via DragService
    if (DragService.hasData()) {
      const dragData = DragService.consume();
      window.HeymingOS.debug('Desktop received drag:', dragData);
      await this._handleInternalDrop(dragData);
      return;
    }

    // Check for internal file drag via dataTransfer (fallback)
    const internalData = dataTransfer.getData('application/x-heyming-file');
    if (internalData) {
      await this._handleInternalDrop(JSON.parse(internalData));
      return;
    }

    // Handle external file drops (from real OS)
    if (dataTransfer.files && dataTransfer.files.length > 0) {
      await this._handleExternalDrop(dataTransfer.files);
      return;
    }

    // Handle text drops
    const text = dataTransfer.getData('text/plain');
    if (text) {
      await this._handleTextDrop(text);
    }
  }

  async _handleInternalDrop(fileData) {
    if (!this.fs) return;

    const paths = fileData.paths || [fileData.path];
    const action = fileData.action || 'move';

    const result = await FileOperationService.moveOrCopy(this.fs, paths, this.desktopPath, action);
    if (result.message) {
      this._notify(result.message, result.success ? 'system' : 'error');
    }
  }

  async _handleExternalDrop(files) {
    if (!this.fs) return;

    for (const file of files) {
      try {
        const content = await this._readFile(file);
        const destPath = `${this.desktopPath}/${file.name}`;

        await this.fs.createFile(destPath, content, true);
        this._notify(`📄 Saved: ${file.name}`);
      } catch (error) {
        this._notify(`❌ Failed to save: ${file.name}`, 'error');
      }
    }
  }

  async _handleTextDrop(text) {
    if (!this.fs) return;

    try {
      // Generate a unique filename
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const fileName = `dropped-${timestamp}.txt`;
      const destPath = `${this.desktopPath}/${fileName}`;

      await this.fs.createFile(destPath, text, true);
      this._notify(`📄 Saved: ${fileName}`);
    } catch (error) {
      this._notify(`❌ Failed to save text`, 'error');
    }
  }

  _readFile(file) {
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

  _notify(message, type = 'system') {
    if (window.HeymingOS?.instance?.notifications) {
      window.HeymingOS.instance.notifications[type](message);
    }
  }

  async _downloadFile(iconData) {
    const item = await this.fs.getItem(iconData.file.path);
    if (!item) return;

    const fileName = iconData.name;
    const content = item.content || '';
    const mimeType = item.mimeType || 'text/plain';

    try {
      let blob;
      if (typeof content === 'string' && content.startsWith('data:')) {
        const response = await fetch(content);
        blob = await response.blob();
      } else {
        blob = new Blob([content], { type: mimeType });
      }

      // Create download link and trigger it
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      this._notify(`📥 Downloaded: ${fileName}`);
    } catch (error) {
      console.error('Download failed:', error);
      this._notify(`❌ Download failed: ${fileName}`, 'error');
    }
  }
}

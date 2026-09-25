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
import { loadPrefs, patchPrefs, wallpaperStyleFor } from './prefs.js';
import { promptName } from './OsDialog.js';
import {
  appIconKey,
  clampIconPosition,
  defaultAppPosition,
  defaultFilePosition,
  desktopVfsItems,
  dropPointToIconPosition,
  packLayoutToGrid,
  parseIconKey,
  resolveIconPosition,
  translateGroup,
  vfsIconKey
} from './desktop-layout.js';

export class Desktop {
  constructor(onLaunchApp, onOpenFile) {
    this.onLaunchApp = onLaunchApp;
    this.onOpenFile = onOpenFile;
    this.desktop = null;
    this.fs = null;
    this.desktopPath = Config.DESKTOP;
    this.fileIcons = []; // VFS icons on the desktop
    this.appIcons = [];
    this.selectedKeys = new Set();
    this.lastSelectedKey = null;
    this.iconLayout = {};
    this.C = Constants;
    this.Input = InputHandler;

    // Drag selection state
    this.isDragSelecting = false;
    this.dragSelectStart = null;
    this.selectionBox = null;
    this.dragSelectionFrame = null;
    this.dragSelectionPointer = null;
    this.dragSelectionIconRects = null;

    // Quick Look preview
    this.quickLook = null;
    this.iconSize = 'm';
    this._wallpaperBlobUrl = null;
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
    if (!this.fs && window.FileSystemDB) {
      this.fs = await window.FileSystemDB.getInstance();
    }

    this.iconLayout = { ...loadPrefs().desktopIconLayout };
    this._setupDropZone();
    this._setupKeyboardShortcuts();
    this._setupSelectionHandling();
    this._setupDesktopIconFocusSync();
    this._setupDragSelection();
    await this._ensureAppModuleAndRenderIcons();

    // Initialize Quick Look preview component
    this.quickLook = new QuickLookPreview(this.desktop, {
      onOpenFile: (item) => this.onOpenFile(item)
    });

    this.desktop.style.removeProperty('background');
  }

  /**
   * @param {import('./prefs.js').OsPrefs} prefs
   */
  async applyAppearance(prefs) {
    if (!this.desktop) return;
    const previousSize = this.iconSize;
    this.applyIconSize(prefs.iconSize);
    await this.applyWallpaper(prefs.wallpaper);
    if (prefs.desktopIconLayout) {
      this.iconLayout = { ...prefs.desktopIconLayout };
    }
    if (previousSize !== this.iconSize) {
      await this._renderIcons();
    }
  }

  /**
   * @param {string} size
   */
  applyIconSize(size) {
    this.iconSize = this.C.ICON_SIZE_LAYOUT[size] ? size : 'm';
    const layout = this._iconLayout();
    this.desktop.dataset.iconSize = this.iconSize;
    this.desktop.style.setProperty('--os-icon-tile', `${layout.tile}px`);
    this.desktop.style.setProperty('--os-icon-font', `${layout.font}px`);
    this.desktop.style.setProperty('--os-icon-label', `${layout.label}px`);
  }

  _iconLayout() {
    return this.C.ICON_SIZE_LAYOUT[this.iconSize] || this.C.ICON_SIZE_LAYOUT.m;
  }

  /**
   * @param {import('./prefs.js').WallpaperPref} wallpaper
   */
  async applyWallpaper(wallpaper) {
    if (!this.desktop) return;
    this.desktop.style.removeProperty('background');
    if (this._wallpaperBlobUrl) {
      URL.revokeObjectURL(this._wallpaperBlobUrl);
      this._wallpaperBlobUrl = null;
    }

    let imageUrl = '';
    if (wallpaper?.source === 'vfs' && wallpaper.path && this.fs && window.FileSystemDB) {
      try {
        const item = await this.fs.getItem(wallpaper.path);
        if (item && item.type === 'file') {
          const content = window.FileSystemDB.getContentForApp(item);
          const url = this._objectUrlFromContent(content, item.mimeType);
          if (url.startsWith('blob:')) {
            this._wallpaperBlobUrl = url;
          }
          imageUrl = url;
        }
      } catch (err) {
        console.warn('[Desktop] wallpaper file unavailable', err);
      }
    }

    const style = wallpaperStyleFor(wallpaper, imageUrl);
    this.desktop.style.backgroundImage = style.backgroundImage;
    this.desktop.style.backgroundColor = style.backgroundColor;
    this.desktop.style.backgroundSize = style.backgroundSize;
    this.desktop.style.backgroundRepeat = style.backgroundRepeat;
    this.desktop.style.backgroundPosition = style.backgroundPosition;
    this.desktop.style.backgroundAttachment = style.backgroundAttachment;
  }

  _objectUrlFromContent(content, mime) {
    if (content instanceof ArrayBuffer) {
      return URL.createObjectURL(new Blob([content], { type: mime || 'image/png' }));
    }
    if (ArrayBuffer.isView(content)) {
      const copy = content.buffer.slice(
        content.byteOffset,
        content.byteOffset + content.byteLength
      );
      return URL.createObjectURL(
        new Blob([/** @type {ArrayBuffer} */ (copy)], { type: mime || 'image/png' })
      );
    }
    if (typeof content === 'string') {
      const trimmed = content.trim();
      if (
        trimmed.startsWith('blob:') ||
        trimmed.startsWith('http') ||
        trimmed.startsWith('data:')
      ) {
        return trimmed;
      }
      if (trimmed.startsWith('<')) {
        return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(content);
      }
    }
    return '';
  }

  arrangeIcons() {
    const keys = this._iconElements()
      .map((el) => el.dataset.iconKey)
      .filter(Boolean);
    const packed = packLayoutToGrid(keys, this._iconLayout(), this.C);
    this._persistLayout(packed, true);
    return this._renderIcons();
  }

  /**
   * Refresh desktop file icons
   */
  async refresh() {
    this.desktopPath = Config.DESKTOP;
    await this._renderIcons();
  }

  // ========== Private Methods ==========

  async _ensureAppModuleAndRenderIcons() {
    if (typeof window.AppModule === 'undefined' || !window.__heymingAppRegistryReady) {
      console.error(
        '[Desktop] AppModule not ready — ensure mime-handlers.js and app.js load before the OS module.'
      );
      return;
    }
    try {
      await this._renderIcons();
    } catch (error) {
      console.error('[Desktop] Failed to initialize icons:', error);
    }
  }

  _mobileLayout() {
    const spacingX = this.C.MOBILE_ICON_SPACING_X;
    return {
      startX: this.C.MOBILE_ICON_START_X,
      startY: this.C.MOBILE_ICON_START_Y,
      spacingX,
      spacingY: this.C.MOBILE_ICON_SPACING_Y,
      iconsPerRow: Math.max(
        this.C.MOBILE_MIN_ICONS_PER_ROW,
        Math.floor((window.innerWidth - this.C.MOBILE_ICON_MARGIN) / spacingX)
      )
    };
  }

  _iconBounds() {
    const layout = this._iconLayout();
    return {
      minX: 0,
      minY: 0,
      maxX: Math.max(0, window.innerWidth - layout.tile),
      maxY: Math.max(0, window.innerHeight - this.C.TASKBAR_HEIGHT - layout.tile - 24)
    };
  }

  _iconElements() {
    return Array.from(this.desktop?.querySelectorAll('.desktop-icon') || []);
  }

  _vfsPathsFromSelection() {
    const paths = [];
    for (const key of this.selectedKeys) {
      const parsed = parseIconKey(key);
      if (parsed?.kind === 'vfs') paths.push(parsed.path);
    }
    return paths;
  }

  _persistLayout(partial, replace = false) {
    this.iconLayout = replace ? { ...partial } : { ...this.iconLayout, ...partial };
    patchPrefs({ desktopIconLayout: this.iconLayout });
  }

  async _renderIcons() {
    if (!this.desktop) return;

    this._invalidateDragSelectionGeometry();
    this._iconElements().forEach((el) => el.remove());
    this.fileIcons = [];
    this.appIcons = [];

    const layout = this._iconLayout();
    const mobile = this.Input.isMobile();
    const desktopApps = window.AppModule?.getDesktopApps?.() || [];
    const systemApps = desktopApps.filter((app) => app.system && app.desktopPosition);
    const regularApps = desktopApps.filter((app) => !app.system || !app.desktopPosition);
    const orderedApps = mobile ? desktopApps : [...systemApps, ...regularApps];

    orderedApps.forEach((app, index) => {
      const regularIndex = mobile
        ? index
        : app.system && app.desktopPosition
        ? 0
        : regularApps.indexOf(app);
      const fallback = defaultAppPosition(
        app,
        mobile ? index : regularIndex,
        layout,
        this.C,
        mobile,
        this._mobileLayout()
      );
      const key = appIconKey(app.id);
      const pos = mobile ? fallback : resolveIconPosition(key, this.iconLayout, fallback);
      const el = this._createAppIcon({
        name: app.shortName,
        icon: app.icon,
        x: pos.x,
        y: pos.y,
        app: app.id
      });
      this.appIcons.push(el);
    });

    if (this.fs) {
      try {
        const items = desktopVfsItems(await this.fs.listDirectory(this.desktopPath));
        const appCount = orderedApps.length;
        const mobileMetrics = this._mobileLayout();
        const fileMobile = {
          ...mobileMetrics,
          startY:
            mobileMetrics.startY +
            (Math.ceil(appCount / mobileMetrics.iconsPerRow) + 1) * mobileMetrics.spacingY
        };

        items.forEach((item, index) => {
          const fileName = this.fs.getFileName(item.path);
          const glyph = item.type === 'directory' ? '📁' : this._getFileIcon(fileName);
          const fallback = defaultFilePosition(
            index,
            layout,
            this.C,
            mobile,
            fileMobile,
            window.innerWidth
          );
          const key = vfsIconKey(item.path);
          const pos = mobile ? fallback : resolveIconPosition(key, this.iconLayout, fallback);
          const iconEl = this._createFileIcon({
            name: fileName,
            icon: glyph,
            x: pos.x,
            y: pos.y,
            file: item
          });
          this.fileIcons.push(iconEl);
        });
      } catch (error) {
        console.warn('Failed to load desktop files:', error);
      }
    }

    this._syncSelectionClasses();
    this._handleDragSelectionGeometryChange();
  }

  _createAppIcon(iconData) {
    const key = appIconKey(iconData.app);
    const icon = document.createElement('div');
    icon.className = 'desktop-icon';
    icon.dataset.iconKey = key;
    icon.dataset.appId = iconData.app;
    icon.style.left = iconData.x + 'px';
    icon.style.top = iconData.y + 'px';
    if (!this.Input.isMobile()) {
      icon.draggable = true;
    }

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
        this._selectKey(key, icon, null);
        this.onLaunchApp(iconData.app);
      }
    });

    icon.addEventListener('click', (e) => {
      e.stopPropagation();
      this._selectKey(key, icon, e);
    });

    this.Input.addDoubleTapHandler(icon, () => {
      this.onLaunchApp(iconData.app);
    });

    if (!this.Input.isMobile()) {
      icon.addEventListener('dragstart', (e) => {
        e.stopPropagation();
        this._handleIconDragStart(e, icon, key);
      });
      icon.addEventListener('dragend', () => {
        DragService.clear();
      });
    }

    this.desktop.appendChild(icon);
    return icon;
  }

  _createFileIcon(iconData) {
    const key = vfsIconKey(iconData.file.path);
    const isDir = iconData.file.type === 'directory';
    const icon = document.createElement('div');
    icon.className = 'desktop-icon file-icon';
    icon.dataset.iconKey = key;
    icon.setAttribute('data-path', iconData.file.path);
    icon.dataset.itemType = isDir ? 'directory' : 'file';
    icon.style.left = iconData.x + 'px';
    icon.style.top = iconData.y + 'px';
    icon.draggable = true;

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
    icon.setAttribute(
      'aria-label',
      isDir
        ? `${iconData.name}, folder — Enter to open`
        : `${iconData.name}, file — Enter to open, Space for Quick Look`
    );
    icon.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this._selectKey(key, icon, null);
        void this._openSelected();
      } else if (e.key === ' ' && !isDir) {
        e.preventDefault();
        this._selectKey(key, icon, null);
        void this._showQuickLook();
      }
    });

    icon.addEventListener('dragstart', async (e) => {
      e.stopPropagation();
      await this._handleFileDragStart(e, iconData, icon, key);
    });

    icon.addEventListener('dragend', (e) => {
      DragService.clear();
      if (!isDir && e.dataTransfer.dropEffect === 'none') {
        this._downloadFile(iconData);
      }
    });

    icon.addEventListener('click', (e) => {
      e.stopPropagation();
      this._selectKey(key, icon, e);
    });

    this.Input.addDoubleTapHandler(icon, async () => {
      const item = await this.fs.getItem(iconData.file.path);
      if (item && this.onOpenFile) {
        this.onOpenFile(item);
      }
    });

    this.desktop.appendChild(icon);
    return icon;
  }

  _dragPayloadForIcon(iconElement, key) {
    if (!this.selectedKeys.has(key)) {
      this._clearSelection();
      this.selectedKeys.add(key);
      iconElement.classList.add('selected');
      this.lastSelectedKey = key;
    }
    const keys = [...this.selectedKeys];
    const origin = {};
    for (const k of keys) {
      const el = this._iconElements().find((node) => node.dataset.iconKey === k);
      if (el) {
        origin[k] = {
          x: parseFloat(el.style.left) || 0,
          y: parseFloat(el.style.top) || 0
        };
      }
    }
    const rect = iconElement.getBoundingClientRect();
    const vfsPaths = keys
      .map((k) => parseIconKey(k))
      .filter((p) => p?.kind === 'vfs')
      .map((p) => p.path);
    return {
      action: 'reposition',
      keys,
      anchorKey: key,
      origin,
      grabOffset: { x: 0, y: 0 },
      paths: vfsPaths,
      path: vfsPaths[0],
      clientAnchor: { x: rect.left, y: rect.top }
    };
  }

  _handleIconDragStart(e, iconElement, key) {
    const dragData = this._dragPayloadForIcon(iconElement, key);
    dragData.grabOffset = {
      x: e.clientX - dragData.clientAnchor.x,
      y: e.clientY - dragData.clientAnchor.y
    };
    DragService.setData(dragData, 'desktop');
    e.dataTransfer.setData('application/x-heyming-file', JSON.stringify(dragData));
    e.dataTransfer.effectAllowed = 'copyMove';
  }

  async _handleFileDragStart(e, iconData, iconElement, key) {
    const dragData = this._dragPayloadForIcon(iconElement, key);
    dragData.grabOffset = {
      x: e.clientX - dragData.clientAnchor.x,
      y: e.clientY - dragData.clientAnchor.y
    };
    DragService.setData(dragData, 'desktop');
    e.dataTransfer.setData('application/x-heyming-file', JSON.stringify(dragData));

    // For dragging to real OS - only support single file download
    // (browsers don't support multi-file drag well)
    const item = await this.fs.getItem(iconData.file.path);
    if (item && item.type === 'file') {
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
        e.dataTransfer.setData('text/plain', iconData.file.path);
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
      const t = /** @type {Element} */ (e.target);
      if (t === this.desktop || t.id === 'os-desktop') {
        this._clearSelection();
      }
    });
  }

  /** Theme E: when Tab moves focus onto an icon, sync file selection with keyboard users. */
  _setupDesktopIconFocusSync() {
    this.desktop.addEventListener('focusin', (e) => {
      const icon = /** @type {HTMLElement|null} */ (
        /** @type {Element} */ (e.target).closest?.('.desktop-icon')
      );
      if (!icon || !this.desktop.contains(icon)) return;
      if (icon.dataset.iconKey) {
        this._selectKey(icon.dataset.iconKey, icon, null);
      }
    });
  }

  _setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      const tgt = /** @type {Element} */ (e.target);
      // Only handle shortcuts when desktop is focused (no input element)
      if (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA') return;
      // Skip if within an iframe
      if (tgt.closest('iframe')) return;

      const isMeta = e.metaKey || e.ctrlKey;
      const hasSelection = this.selectedKeys.size > 0;
      const hasSingleSelection = this.selectedKeys.size === 1;
      const vfsSelection = this._vfsPathsFromSelection();

      if (isMeta && e.key === 'c' && vfsSelection.length > 0) {
        e.preventDefault();
        this._copySelected();
      } else if (isMeta && e.key === 'x' && vfsSelection.length > 0) {
        e.preventDefault();
        this._cutSelected();
      } else if (isMeta && e.key === 'v') {
        e.preventDefault();
        this._paste();
      } else if (e.key === 'Delete' && vfsSelection.length > 0) {
        e.preventDefault();
        this._deleteSelected();
      } else if (isMeta && e.key === 'a') {
        e.preventDefault();
        this._selectAll();
      } else if (e.key === 'F2' && vfsSelection.length === 1) {
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
        e.preventDefault();
        this._navigateWithArrows(e.key, e.shiftKey);
      }
    });
  }

  _selectKey(key, iconElement, event = null) {
    const isCmd = event?.metaKey || event?.ctrlKey;
    const isShift = event?.shiftKey;

    if (isCmd) {
      if (this.selectedKeys.has(key)) {
        this.selectedKeys.delete(key);
        iconElement.classList.remove('selected');
      } else {
        this.selectedKeys.add(key);
        iconElement.classList.add('selected');
      }
      this.lastSelectedKey = key;
    } else if (isShift && this.lastSelectedKey) {
      this._selectRange(this.lastSelectedKey, key);
    } else {
      this._clearSelection();
      this.selectedKeys.add(key);
      iconElement.classList.add('selected');
      this.lastSelectedKey = key;
    }
  }

  _selectRange(fromKey, toKey) {
    const icons = this._iconElements();
    const keys = icons.map((el) => el.dataset.iconKey);
    const fromIndex = keys.indexOf(fromKey);
    const toIndex = keys.indexOf(toKey);
    if (fromIndex === -1 || toIndex === -1) return;

    const start = Math.min(fromIndex, toIndex);
    const end = Math.max(fromIndex, toIndex);
    this._clearSelection();
    for (let i = start; i <= end; i++) {
      const k = keys[i];
      if (k) {
        this.selectedKeys.add(k);
        icons[i].classList.add('selected');
      }
    }
  }

  _clearSelection() {
    this.selectedKeys.clear();
    this._syncSelectionClasses();
  }

  _syncSelectionClasses() {
    this._iconElements().forEach((el) => {
      el.classList.toggle('selected', this.selectedKeys.has(el.dataset.iconKey));
    });
  }

  _copySelected() {
    const paths = this._vfsPathsFromSelection();
    if (paths.length === 0) return;
    const result = FileOperationService.copy(this.fs, paths, 'desktop');
    if (result.message) this._notify(result.message);
  }

  _cutSelected() {
    const paths = this._vfsPathsFromSelection();
    if (paths.length === 0) return;
    const result = FileOperationService.cut(this.fs, paths, 'desktop');
    if (result.message) this._notify(result.message);
  }

  _selectAll() {
    this._clearSelection();
    this._iconElements().forEach((icon) => {
      const key = icon.dataset.iconKey;
      if (key) {
        this.selectedKeys.add(key);
        icon.classList.add('selected');
      }
    });
    const count = this.selectedKeys.size;
    if (count > 0) {
      this._notify(`Selected ${count} item${count > 1 ? 's' : ''}`);
    }
  }

  async _paste() {
    const result = await FileOperationService.paste(this.fs, this.desktopPath);
    if (result.message) {
      this._notify(result.message, result.success ? 'system' : 'error');
    }
    if (result.success) {
      await this.refresh();
    }
  }

  async _deleteSelected() {
    const paths = this._vfsPathsFromSelection();
    if (paths.length === 0) return;
    const result = await FileOperationService.delete(this.fs, paths, true);
    if (result.message) {
      this._notify(result.message, result.success ? 'system' : 'error');
    }
    if (result.success) {
      this._clearSelection();
      await this.refresh();
    }
  }

  async _renameSelected() {
    const paths = this._vfsPathsFromSelection();
    if (paths.length !== 1) return;
    const result = await FileOperationService.rename(this.fs, paths[0]);
    if (result.message) {
      this._notify(result.message, result.success ? 'system' : 'error');
    }
    if (result.success) {
      this._clearSelection();
      await this.refresh();
    }
  }

  async createNewFolder() {
    if (!this.fs) return { success: false, message: '' };
    const name = await promptName({
      title: 'New Folder',
      defaultValue: 'New Folder',
      confirmLabel: 'Create'
    });
    if (!name) return { success: false, message: '' };
    try {
      const dest = await this.fs.getUniquePath(`${this.desktopPath}/${name}`);
      await this.fs.mkdir(dest);
      await this.refresh();
      return { success: true, message: `📁 Created folder: ${this.fs.getFileName(dest)}` };
    } catch (error) {
      return { success: false, message: `❌ ${error.message}` };
    }
  }

  async createNewFile() {
    if (!this.fs) return { success: false, message: '' };
    const name = await promptName({
      title: 'New File',
      defaultValue: 'untitled.txt',
      confirmLabel: 'Create'
    });
    if (!name) return { success: false, message: '' };
    try {
      const dest = await this.fs.getUniquePath(`${this.desktopPath}/${name}`);
      await this.fs.createFile(dest, '', false);
      await this.refresh();
      return { success: true, message: `📄 Created: ${this.fs.getFileName(dest)}` };
    } catch (error) {
      return { success: false, message: `❌ ${error.message}` };
    }
  }

  async _showQuickLook() {
    const paths = this._vfsPathsFromSelection();
    if (paths.length !== 1) return;
    const item = await this.fs.getItem(paths[0]);
    if (!item || item.type !== 'file') return;
    this.quickLook.show(item, this.fs.getFileName(paths[0]));
  }

  async _openSelected() {
    if (this.selectedKeys.size !== 1) return;
    const key = [...this.selectedKeys][0];
    const parsed = parseIconKey(key);
    if (parsed?.kind === 'app') {
      this.onLaunchApp(parsed.id);
      return;
    }
    if (parsed?.kind === 'vfs') {
      const item = await this.fs.getItem(parsed.path);
      if (item && this.onOpenFile) {
        this.onOpenFile(item);
      }
    }
  }

  _navigateWithArrows(key, shiftKey) {
    const icons = this._iconElements();
    if (icons.length === 0) return;

    const currentKey = this.lastSelectedKey || [...this.selectedKeys][0];
    const currentIcon = currentKey ? icons.find((el) => el.dataset.iconKey === currentKey) : null;

    if (!currentIcon) {
      const firstIcon = icons[0];
      if (firstIcon?.dataset.iconKey) {
        this._clearSelection();
        this.selectedKeys.add(firstIcon.dataset.iconKey);
        firstIcon.classList.add('selected');
        this.lastSelectedKey = firstIcon.dataset.iconKey;
        firstIcon.focus();
      }
      return;
    }

    const nextIcon = this._findNextIcon(currentIcon, key, icons);
    if (!nextIcon) return;
    const nextKey = nextIcon.dataset.iconKey;
    if (shiftKey) {
      this.selectedKeys.add(nextKey);
      nextIcon.classList.add('selected');
    } else {
      this._clearSelection();
      this.selectedKeys.add(nextKey);
      nextIcon.classList.add('selected');
    }
    this.lastSelectedKey = nextKey;
    nextIcon.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    nextIcon.focus();
  }

  _findNextIcon(currentIcon, direction, iconList = this._iconElements()) {
    const currentRect = currentIcon.getBoundingClientRect();
    const currentCenterX = currentRect.left + currentRect.width / 2;
    const currentCenterY = currentRect.top + currentRect.height / 2;

    let bestIcon = null;
    let bestScore = Infinity;

    for (const icon of iconList) {
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
      const t = /** @type {Element} */ (e.target);
      if (t !== this.desktop && t.id !== 'os-desktop') return;
      if (e.button !== 0) return; // Left click only

      this.isDragSelecting = true;
      this.dragSelectStart = { x: e.clientX, y: e.clientY };
      this.dragSelectionPointer = null;

      // Clear selection unless holding Shift or Cmd
      if (!e.shiftKey && !e.metaKey && !e.ctrlKey) {
        this._clearSelection();
      }
      this._cacheDragSelectionIconRects();

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

      this.dragSelectionPointer = {
        x: e.clientX,
        y: e.clientY,
        additive: e.shiftKey || e.metaKey || e.ctrlKey
      };
      this._scheduleDragSelectionUpdate();
    });

    // Mouse up - end drag selection
    document.addEventListener('mouseup', () => {
      this._endDragSelection(true);
    });

    window.addEventListener('blur', () => this._endDragSelection(false));
    window.addEventListener('resize', () => this._handleDragSelectionGeometryChange());
    document.addEventListener('scroll', () => this._handleDragSelectionGeometryChange(), true);
  }

  _scheduleDragSelectionUpdate() {
    if (this.dragSelectionFrame !== null || !this.dragSelectionPointer) return;

    this.dragSelectionFrame = window.requestAnimationFrame(() => {
      this.dragSelectionFrame = null;
      if (this.isDragSelecting) {
        this._updateDragSelection();
      }
    });
  }

  _updateDragSelection() {
    if (!this.dragSelectStart || !this.dragSelectionPointer) return;

    const startX = this.dragSelectStart.x;
    const startY = this.dragSelectStart.y;
    const { x: currentX, y: currentY, additive } = this.dragSelectionPointer;
    const left = Math.min(startX, currentX);
    const top = Math.min(startY, currentY);
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);

    this.selectionBox.style.left = left + 'px';
    this.selectionBox.style.top = top + 'px';
    this.selectionBox.style.width = width + 'px';
    this.selectionBox.style.height = height + 'px';

    this._selectIntersectingFiles(left, top, width, height, additive);
  }

  _endDragSelection(flushPending) {
    if (!this.isDragSelecting) return;

    if (this.dragSelectionFrame !== null) {
      window.cancelAnimationFrame(this.dragSelectionFrame);
      this.dragSelectionFrame = null;
      if (flushPending) {
        this._updateDragSelection();
      }
    }

    this.isDragSelecting = false;
    this.dragSelectStart = null;
    this.dragSelectionPointer = null;
    this.dragSelectionIconRects = null;
    this.selectionBox.style.display = 'none';
  }

  _handleDragSelectionGeometryChange() {
    this._invalidateDragSelectionGeometry();
    if (this.isDragSelecting) {
      this._scheduleDragSelectionUpdate();
    }
  }

  _invalidateDragSelectionGeometry() {
    this.dragSelectionIconRects = null;
  }

  _cacheDragSelectionIconRects() {
    this.dragSelectionIconRects = this._iconElements()
      .map((icon) => {
        const key = icon.dataset.iconKey;
        if (!key) return null;
        return { icon, key, rect: icon.getBoundingClientRect() };
      })
      .filter(Boolean);
    return this.dragSelectionIconRects;
  }

  _selectIntersectingFiles(boxLeft, boxTop, boxWidth, boxHeight, additive) {
    const boxRight = boxLeft + boxWidth;
    const boxBottom = boxTop + boxHeight;

    // Only check file icons, not app icons
    const iconRects = this.dragSelectionIconRects || this._cacheDragSelectionIconRects();
    iconRects.forEach(({ icon, key, rect }) => {
      const intersects =
        rect.left < boxRight &&
        rect.right > boxLeft &&
        rect.top < boxBottom &&
        rect.bottom > boxTop;

      if (intersects) {
        this.selectedKeys.add(key);
        icon.classList.add('selected');
      } else if (!additive) {
        this.selectedKeys.delete(key);
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
      if (next instanceof Node && this.desktop.contains(next)) {
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
      await this._handleInternalDrop(dragData, e);
      return;
    }

    // Check for internal file drag via dataTransfer (fallback)
    const internalData = dataTransfer.getData('application/x-heyming-file');
    if (internalData) {
      await this._handleInternalDrop(JSON.parse(internalData), e);
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

  async _handleInternalDrop(fileData, dropEvent) {
    const folderTarget = /** @type {HTMLElement | null} */ (
      dropEvent?.target?.closest?.('.file-icon[data-item-type="directory"]')
    );
    const paths = (fileData.paths || [fileData.path]).filter(Boolean);
    const fromDesktop = fileData.action === 'reposition' || Boolean(fileData.keys);

    if (folderTarget && paths.length && this.fs) {
      const dest = folderTarget.dataset.path;
      const result = await FileOperationService.moveOrCopy(this.fs, paths, dest, 'move');
      if (result.message) {
        this._notify(result.message, result.success ? 'system' : 'error');
      }
      if (result.success) {
        await this.refresh();
      }
      return;
    }

    if (fromDesktop && dropEvent && !this.Input.isMobile()) {
      this._applyReposition(fileData, dropEvent);
      return;
    }

    if (!this.fs || paths.length === 0) return;

    const action = fileData.action === 'reposition' ? 'move' : fileData.action || 'move';
    const result = await FileOperationService.moveOrCopy(this.fs, paths, this.desktopPath, action);
    if (result.message) {
      this._notify(result.message, result.success ? 'system' : 'error');
    }
    if (result.success && dropEvent && !this.Input.isMobile()) {
      const layout = this._iconLayout();
      const desktopRect = this.desktop.getBoundingClientRect();
      const pos = dropPointToIconPosition(
        dropEvent.clientX,
        dropEvent.clientY,
        fileData.grabOffset || { x: 0, y: 0 },
        desktopRect,
        layout.spacingX,
        layout.spacingY,
        this._iconBounds()
      );
      const updates = {};
      paths.forEach((p, i) => {
        updates[vfsIconKey(p)] = clampIconPosition(
          pos.x,
          pos.y + i * layout.spacingY,
          this._iconBounds()
        );
      });
      this._persistLayout(updates);
      await this.refresh();
    }
  }

  _applyReposition(fileData, dropEvent) {
    const layout = this._iconLayout();
    const desktopRect = this.desktop.getBoundingClientRect();
    const grab = fileData.grabOffset || { x: 0, y: 0 };
    const anchorPos = dropPointToIconPosition(
      dropEvent.clientX,
      dropEvent.clientY,
      grab,
      desktopRect,
      layout.spacingX,
      layout.spacingY,
      this._iconBounds()
    );
    const origin = fileData.origin || {};
    const next = translateGroup(
      origin,
      fileData.anchorKey,
      anchorPos,
      layout.spacingX,
      layout.spacingY,
      this._iconBounds()
    );
    this._persistLayout(next);
    for (const [key, pos] of Object.entries(next)) {
      const el = this._iconElements().find((node) => node.dataset.iconKey === key);
      if (el) {
        el.style.left = pos.x + 'px';
        el.style.top = pos.y + 'px';
      }
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

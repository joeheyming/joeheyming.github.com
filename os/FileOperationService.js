/**
 * Heyming OS - File Operation Service
 * Shared file operations (copy, cut, paste, move, delete) used by Desktop and File Manager
 */

import { ClipboardService } from './ClipboardService.js';

export const FileOperationService = {
  /**
   * Copy files to clipboard
   * @param {FileSystemDB} fs - Filesystem instance
   * @param {string[]} paths - Array of file paths to copy
   * @param {string} source - Source identifier ('desktop', 'filemanager')
   * @returns {{ count: number, message: string }}
   */
  copy(fs, paths, source = 'unknown') {
    if (!paths || paths.length === 0) return { count: 0, message: '' };

    ClipboardService.copy(paths, source);
    const count = paths.length;
    const name = count === 1 ? fs.getFileName(paths[0]) : `${count} items`;
    return { count, message: `📋 Copied: ${name}` };
  },

  /**
   * Cut files to clipboard
   * @param {FileSystemDB} fs - Filesystem instance
   * @param {string[]} paths - Array of file paths to cut
   * @param {string} source - Source identifier
   * @returns {{ count: number, message: string }}
   */
  cut(fs, paths, source = 'unknown') {
    if (!paths || paths.length === 0) return { count: 0, message: '' };

    ClipboardService.cut(paths, source);
    const count = paths.length;
    const name = count === 1 ? fs.getFileName(paths[0]) : `${count} items`;
    return { count, message: `✂️ Cut: ${name}` };
  },

  /**
   * Paste files from clipboard to destination
   * @param {FileSystemDB} fs - Filesystem instance
   * @param {string} destDir - Destination directory path
   * @returns {Promise<{ success: boolean, count: number, message: string }>}
   */
  async paste(fs, destDir) {
    if (!ClipboardService.hasItems()) {
      return { success: false, count: 0, message: '📋 Clipboard is empty' };
    }

    const { items, operation } = ClipboardService.get();
    let successCount = 0;
    const results = [];

    try {
      for (const sourcePath of items) {
        const fileName = fs.getFileName(sourcePath);
        let destPath = fs.joinPath(destDir, fileName);

        // Get unique path if file exists
        destPath = await fs.getUniquePath(destPath);
        const actualName = fs.getFileName(destPath);

        if (operation === 'cut') {
          await fs.moveItem(sourcePath, destPath);
        } else {
          await fs.copyItem(sourcePath, destPath);
        }
        successCount++;
        results.push(actualName);
      }

      // Clear clipboard if cut
      if (operation === 'cut') {
        ClipboardService.clear();
      }

      const verb = operation === 'cut' ? 'Moved' : 'Copied';
      const msg =
        successCount === 1 ? `📁 ${verb}: ${results[0]}` : `📁 ${verb} ${successCount} items`;

      return { success: true, count: successCount, message: msg };
    } catch (error) {
      return { success: false, count: successCount, message: `❌ Paste failed: ${error.message}` };
    }
  },

  /**
   * Delete files
   * @param {FileSystemDB} fs - Filesystem instance
   * @param {string[]} paths - Array of file paths to delete
   * @param {boolean} confirm - Whether to show confirmation
   * @returns {Promise<{ success: boolean, count: number, message: string }>}
   */
  async delete(fs, paths, confirm = true) {
    if (!paths || paths.length === 0) {
      return { success: false, count: 0, message: '' };
    }

    const count = paths.length;
    const confirmMsg =
      count === 1 ? `Delete "${fs.getFileName(paths[0])}"?` : `Delete ${count} items?`;

    if (confirm && !window.confirm(confirmMsg)) {
      return { success: false, count: 0, message: '' };
    }

    try {
      for (const path of paths) {
        await fs.deleteItem(path);
      }

      const name = count === 1 ? fs.getFileName(paths[0]) : `${count} items`;
      return { success: true, count, message: `🗑️ Deleted: ${name}` };
    } catch (error) {
      return { success: false, count: 0, message: `❌ Delete failed: ${error.message}` };
    }
  },

  /**
   * Rename a file
   * @param {FileSystemDB} fs - Filesystem instance
   * @param {string} path - File path to rename
   * @param {string} newName - New filename (optional, will prompt if not provided)
   * @returns {Promise<{ success: boolean, newPath: string, message: string }>}
   */
  async rename(fs, path, newName = null) {
    const oldName = fs.getFileName(path);
    const finalName = newName || window.prompt('Rename file:', oldName);

    if (!finalName || finalName === oldName) {
      return { success: false, newPath: path, message: '' };
    }

    try {
      const parentPath = fs.getParentPath(path);
      const newPath = fs.joinPath(parentPath, finalName);
      await fs.moveItem(path, newPath);
      return { success: true, newPath, message: `✏️ Renamed to: ${finalName}` };
    } catch (error) {
      return { success: false, newPath: path, message: `❌ Rename failed: ${error.message}` };
    }
  },

  /**
   * Move files to destination (for drag/drop)
   * @param {FileSystemDB} fs - Filesystem instance
   * @param {string[]} sourcePaths - Array of source paths
   * @param {string} destDir - Destination directory
   * @param {string} action - 'move' or 'copy'
   * @returns {Promise<{ success: boolean, count: number, message: string }>}
   */
  async moveOrCopy(fs, sourcePaths, destDir, action = 'move') {
    if (!sourcePaths || sourcePaths.length === 0) {
      return { success: false, count: 0, message: '' };
    }

    let successCount = 0;

    try {
      for (const sourcePath of sourcePaths) {
        const sourceDir = fs.getParentPath(sourcePath);
        const fileName = fs.getFileName(sourcePath);
        const destPath = fs.joinPath(destDir, fileName);

        // Skip if file is already in destination (dropping on same location)
        if (sourceDir === destDir && action === 'move') {
          continue;
        }

        // Get unique path if destination exists (but not if it's the same file)
        let finalPath = destPath;
        if (sourcePath !== destPath) {
          finalPath = await fs.getUniquePath(destPath);
        }

        if (action === 'move') {
          await fs.moveItem(sourcePath, finalPath);
        } else {
          await fs.copyItem(sourcePath, finalPath);
        }
        successCount++;
      }

      if (successCount === 0) {
        return { success: true, count: 0, message: '' }; // No-op, not an error
      }

      const verb = action === 'move' ? 'Moved' : 'Copied';
      const name = successCount === 1 ? fs.getFileName(sourcePaths[0]) : `${successCount} items`;
      return { success: true, count: successCount, message: `📁 ${verb}: ${name}` };
    } catch (error) {
      return {
        success: false,
        count: successCount,
        message: `❌ ${action === 'move' ? 'Move' : 'Copy'} failed: ${error.message}`
      };
    }
  },

  /**
   * Check if clipboard has items
   * @returns {boolean}
   */
  hasClipboardItems() {
    return ClipboardService.hasItems();
  },

  /**
   * Clear clipboard
   */
  clearClipboard() {
    ClipboardService.clear();
  }
};

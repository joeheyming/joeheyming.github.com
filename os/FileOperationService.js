/**
 * Heyming OS - File Operation Service
 * Shared file operations (copy, cut, paste, move, delete) used by Desktop and File Manager
 */

import { ClipboardService } from './ClipboardService.js';
import { confirmAction, promptName } from './OsDialog.js';
import { TRASH_PATH, allPathsInTrash, isProtectedTrashRoot, isTrashPath } from './trash.js';

export const FileOperationService = {
  TRASH_PATH,

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
   * @param {FileSystemDB} fs
   */
  async ensureTrash(fs) {
    const existing = await fs.getItem(TRASH_PATH);
    if (!existing) {
      await fs.mkdir(TRASH_PATH);
      return;
    }
    if (existing.type !== 'directory') {
      throw new Error('Trash path exists and is not a folder');
    }
  },

  /**
   * Soft-delete to Trash, or permanently delete items already in Trash.
   * @param {FileSystemDB} fs
   * @param {string[]} paths
   * @param {boolean | { confirm?: boolean, confirmFn?: (msg: string) => boolean | Promise<boolean> }} [confirmOrOpts]
   * @returns {Promise<{ success: boolean, count: number, message: string, permanent?: boolean }>}
   */
  async delete(fs, paths, confirmOrOpts = true) {
    if (!paths || paths.length === 0) {
      return { success: false, count: 0, message: '' };
    }

    const opts =
      typeof confirmOrOpts === 'boolean' ? { confirm: confirmOrOpts } : confirmOrOpts || {};
    const shouldConfirm = opts.confirm !== false;
    const confirmFn =
      opts.confirmFn ||
      ((msg) =>
        confirmAction({
          title: 'Delete',
          message: msg,
          confirmLabel: 'Delete'
        }));

    const unique = [...new Set(paths.filter((p) => p && !isProtectedTrashRoot(p)))];
    if (unique.length === 0) {
      return { success: false, count: 0, message: 'Cannot delete Trash' };
    }

    const permanent = allPathsInTrash(unique);
    const count = unique.length;
    const confirmMsg = permanent
      ? count === 1
        ? `Permanently delete "${fs.getFileName(unique[0])}"?`
        : `Permanently delete ${count} items?`
      : count === 1
      ? `Move "${fs.getFileName(unique[0])}" to Trash?`
      : `Move ${count} items to Trash?`;

    if (shouldConfirm) {
      const ok = await confirmFn(confirmMsg);
      if (!ok) {
        return { success: false, count: 0, message: '' };
      }
    }

    try {
      if (permanent) {
        for (const path of unique) {
          await fs.deleteItem(path, true);
        }
        const name = count === 1 ? fs.getFileName(unique[0]) : `${count} items`;
        return {
          success: true,
          count,
          permanent: true,
          message: `🗑️ Deleted: ${name}`
        };
      }

      await this.ensureTrash(fs);
      for (const path of unique) {
        if (isTrashPath(path)) {
          await fs.deleteItem(path, true);
          continue;
        }
        const dest = await fs.getUniquePath(`${TRASH_PATH}/${fs.getFileName(path)}`);
        await fs.moveItem(path, dest);
      }

      const name = count === 1 ? fs.getFileName(unique[0]) : `${count} items`;
      return { success: true, count, permanent: false, message: `🗑️ Moved to Trash: ${name}` };
    } catch (error) {
      return { success: false, count: 0, message: `❌ Delete failed: ${error.message}` };
    }
  },

  /**
   * Restore items from Trash to destDir (defaults to parent of destDir join).
   * @param {FileSystemDB} fs
   * @param {string[]} paths
   * @param {string} destDir
   */
  async restore(fs, paths, destDir) {
    if (!paths || paths.length === 0) {
      return { success: false, count: 0, message: '' };
    }
    const unique = paths.filter((p) => isTrashPath(p) && !isProtectedTrashRoot(p));
    if (unique.length === 0) {
      return { success: false, count: 0, message: 'Nothing to restore' };
    }

    try {
      let successCount = 0;
      for (const path of unique) {
        const dest = await fs.getUniquePath(
          `${destDir.replace(/\/$/, '')}/${fs.getFileName(path)}`
        );
        await fs.moveItem(path, dest);
        successCount++;
      }
      const name = successCount === 1 ? fs.getFileName(unique[0]) : `${successCount} items`;
      return { success: true, count: successCount, message: `↩️ Restored: ${name}` };
    } catch (error) {
      return { success: false, count: 0, message: `❌ Restore failed: ${error.message}` };
    }
  },

  /**
   * Permanently delete everything in Trash.
   * @param {FileSystemDB} fs
   * @param {{ confirm?: boolean, confirmFn?: (msg: string) => boolean | Promise<boolean> }} [opts]
   */
  async emptyTrash(fs, opts = {}) {
    const shouldConfirm = opts.confirm !== false;
    const confirmFn =
      opts.confirmFn ||
      ((msg) =>
        confirmAction({
          title: 'Empty Trash',
          message: msg,
          confirmLabel: 'Empty Trash'
        }));

    if (shouldConfirm) {
      const ok = await confirmFn('Permanently delete all items in Trash?');
      if (!ok) {
        return { success: false, count: 0, message: '' };
      }
    }

    try {
      await this.ensureTrash(fs);
      const children = await fs.listDirectory(TRASH_PATH);
      for (const child of children) {
        await fs.deleteItem(child.path, true);
      }
      return {
        success: true,
        count: children.length,
        message: children.length ? `🗑️ Emptied Trash (${children.length})` : 'Trash is empty'
      };
    } catch (error) {
      return { success: false, count: 0, message: `❌ Empty Trash failed: ${error.message}` };
    }
  },

  /**
   * Rename a file
   * @param {FileSystemDB} fs - Filesystem instance
   * @param {string} path - File path to rename
   * @param {string} [newName] - New filename (prompts if omitted)
   * @returns {Promise<{ success: boolean, newPath: string, message: string }>}
   */
  async rename(fs, path, newName = null) {
    const oldName = fs.getFileName(path);
    let finalName = newName;
    if (!finalName) {
      finalName = await promptName({
        title: 'Rename',
        defaultValue: oldName,
        confirmLabel: 'Rename'
      });
    }

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

        if (sourceDir === destDir && action === 'move') {
          continue;
        }

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
        return { success: true, count: 0, message: '' };
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

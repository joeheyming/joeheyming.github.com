/**
 * Trash path helpers. File moves live in FileOperationService.
 */

export const TRASH_PATH = '/Trash';

/**
 * @param {string} path
 * @param {string} [trashPath]
 */
export function isTrashPath(path, trashPath = TRASH_PATH) {
  if (!path) return false;
  return path === trashPath || path.startsWith(`${trashPath}/`);
}

/**
 * @param {string[]} paths
 * @param {string} [trashPath]
 */
export function allPathsInTrash(paths, trashPath = TRASH_PATH) {
  return paths.length > 0 && paths.every((p) => isTrashPath(p, trashPath));
}

/**
 * @param {string} path
 * @param {string} [trashPath]
 */
export function isProtectedTrashRoot(path, trashPath = TRASH_PATH) {
  return path === trashPath;
}

/**
 * Default restore location for a trashed file name.
 * @param {string} fileName
 * @param {string} desktopPath
 */
export function restorePathForName(fileName, desktopPath) {
  const trimmed = String(fileName || '').replace(/^\/+/, '');
  return `${desktopPath.replace(/\/$/, '')}/${trimmed}`;
}

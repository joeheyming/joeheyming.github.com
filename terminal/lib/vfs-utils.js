/**
 * Virtual filesystem helpers — symlink resolution, file content decoding,
 * directory sorting/filtering. Used by commands that need to traverse the VFS.
 */

import { ShellCore } from './shell-core.js';

const _resolveVirtualPath = ShellCore.resolveVirtualPath;

function dirnameVirtualPath(p) {
  if (p == null || p === '' || p === '/') return '/';
  const i = p.lastIndexOf('/');
  if (i <= 0) return '/';
  return p.slice(0, i) || '/';
}

/**
 * Follow a symlink chain to a regular file.
 * @param {{ resolvePath: (s: string) => string, getFileSystemItem: (p: string) => Promise<*> }} terminal
 * @param {string} operand
 * @param {string} cmdName
 * @returns {Promise<{ ok: true, file: object } | { ok: false, stderr: string }>}
 */
async function vfsFollowSymlinksToFile(terminal, operand, cmdName) {
  let fullPath = terminal.resolvePath(operand);
  const visited = new Set();
  for (let depth = 0; depth < 32; depth++) {
    if (visited.has(fullPath))
      return { ok: false, stderr: `${cmdName}: ${operand}: Too many levels of symbolic links` };
    visited.add(fullPath);
    const file = await terminal.getFileSystemItem(fullPath);
    if (!file)
      return {
        ok: false,
        stderr: `${cmdName}: cannot open '${operand}' for reading: No such file or directory`
      };
    if (file.type === 'symlink') {
      const raw = file.target;
      if (raw == null || String(raw).trim() === '')
        return { ok: false, stderr: `${cmdName}: ${operand}: Invalid argument` };
      fullPath = _resolveVirtualPath(String(raw).trim(), dirnameVirtualPath(fullPath));
      continue;
    }
    if (file.type !== 'file')
      return { ok: false, stderr: `${cmdName}: Error reading '${operand}': Is a directory` };
    return { ok: true, file };
  }
  return { ok: false, stderr: `${cmdName}: ${operand}: Too many levels of symbolic links` };
}

/**
 * Follow a symlink chain to a directory.
 * @param {{ resolvePath: (s: string) => string, getFileSystemItem: (p: string) => Promise<*> }} terminal
 * @param {string} operand
 * @param {string} cmdName
 */
async function vfsFollowSymlinksToDir(terminal, operand, cmdName) {
  let fullPath = terminal.resolvePath(operand);
  const visited = new Set();
  for (let depth = 0; depth < 32; depth++) {
    if (visited.has(fullPath))
      return { ok: false, stderr: `${cmdName}: ${operand}: Too many levels of symbolic links` };
    visited.add(fullPath);
    const item = await terminal.getFileSystemItem(fullPath);
    if (!item) return { ok: false, stderr: `${cmdName}: ${operand}: No such file or directory` };
    if (item.type === 'symlink') {
      const raw = item.target;
      if (raw == null || String(raw).trim() === '')
        return { ok: false, stderr: `${cmdName}: ${operand}: Invalid argument` };
      fullPath = _resolveVirtualPath(String(raw).trim(), dirnameVirtualPath(fullPath));
      continue;
    }
    if (item.type !== 'directory')
      return { ok: false, stderr: `${cmdName}: ${operand}: Not a directory` };
    return { ok: true, item, resolvedPath: fullPath };
  }
  return { ok: false, stderr: `${cmdName}: ${operand}: Too many levels of symbolic links` };
}

/**
 * Follow a symlink chain to any node type.
 * @param {{ resolvePath: (s: string) => string, getFileSystemItem: (p: string) => Promise<*> }} terminal
 * @param {string} fullPath
 */
async function vfsFollowSymlinksToAny(terminal, fullPath) {
  const visited = new Set();
  for (let depth = 0; depth < 32; depth++) {
    if (visited.has(fullPath)) return { ok: false };
    visited.add(fullPath);
    const item = await terminal.getFileSystemItem(fullPath);
    if (!item) return { ok: false };
    if (item.type === 'symlink') {
      const raw = item.target;
      if (raw == null || String(raw).trim() === '') return { ok: false };
      fullPath = _resolveVirtualPath(String(raw).trim(), dirnameVirtualPath(fullPath));
      continue;
    }
    return { ok: true, item, resolvedPath: fullPath };
  }
  return { ok: false };
}

/**
 * Canonical readlink follow (for readlink -f / -e).
 */
async function vfsReadlinkCanonical(terminal, operand, mode, cmdPrefix = 'readlink') {
  let p = terminal.resolvePath(operand);
  p = _resolveVirtualPath(p, '/');
  const visited = new Set();
  for (let depth = 0; depth < 32; depth++) {
    if (visited.has(p))
      return { ok: false, stderr: `${cmdPrefix}: ${operand}: Too many levels of symbolic links` };
    visited.add(p);
    const item = await terminal.getFileSystemItem(p);
    if (!item) {
      if (mode === 'e')
        return { ok: false, stderr: `${cmdPrefix}: ${operand}: No such file or directory` };
      return { ok: true, path: p };
    }
    if (item.type === 'symlink') {
      const raw = String(item.target || '').trim();
      if (!raw) return { ok: false, stderr: `${cmdPrefix}: ${operand}: Invalid argument` };
      p = _resolveVirtualPath(raw, dirnameVirtualPath(p));
      continue;
    }
    return { ok: true, path: p };
  }
  return { ok: false, stderr: `${cmdPrefix}: ${operand}: Too many levels of symbolic links` };
}

/**
 * Decode VFS file item content to UTF-8 text (or detect binary).
 */
function fileItemUtf8ForDisplay(item) {
  if (!item || item.type !== 'file') return { text: '', isBinary: false };
  if (item.content != null && item.content !== '')
    return { text: String(item.content), isBinary: false };
  const raw = item.contentBytes;
  if (raw == null) return { text: '', isBinary: false };
  let u8;
  if (raw instanceof ArrayBuffer) u8 = new Uint8Array(raw);
  else if (ArrayBuffer.isView(raw)) u8 = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  else return { text: '', isBinary: false };
  if (u8.byteLength === 0) return { text: '', isBinary: false };
  const maxSample = 8192;
  const sample = u8.byteLength > maxSample ? u8.subarray(0, maxSample) : u8;
  if (sample.indexOf(0) !== -1) return { text: '', isBinary: true };
  const text = new TextDecoder('utf-8', { fatal: false }).decode(u8);
  return { text, isBinary: false };
}

/**
 * Stable locale sort of directory entries by name.
 */
function sortDirectoryEntriesByName(entries) {
  return [...entries].sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

/**
 * Tab-completion directory filter: hides dotfiles unless prefix starts with '.'.
 */
function filterDirectoryEntriesForTabCompletion(entries, searchPattern) {
  const pat = searchPattern == null ? '' : String(searchPattern);
  const includeDotfiles = pat.length > 0 && pat.startsWith('.');
  return entries.filter((entry) => {
    const name = entry && entry.name != null ? String(entry.name) : '';
    if (!includeDotfiles && name.startsWith('.')) return false;
    return name.startsWith(pat);
  });
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const VfsUtils = {
  dirnameVirtualPath,
  vfsFollowSymlinksToFile,
  vfsFollowSymlinksToDir,
  vfsFollowSymlinksToAny,
  vfsReadlinkCanonical,
  fileItemUtf8ForDisplay,
  sortDirectoryEntriesByName,
  filterDirectoryEntriesForTabCompletion
};

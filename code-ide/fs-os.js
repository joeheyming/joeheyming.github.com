/**
 * fs-os.js — Filesystem adapter that talks to HeymingOS.
 *
 * In an iframe under HeymingOS, the parent exposes `window.parent.FileSystemDB`
 * (and helpers on `window.parent.HeymingOS`). We use it directly for browsing
 * and fall back to the postMessage protocol for save / save-as so the OS can
 * update its own UI (taskbar, file dialogs, etc.).
 *
 * The adapter intentionally exposes the same shape as fs-local.js so the rest
 * of the app does not care which environment it is running in.
 */

const PROJECT_LABEL = 'HeymingOS Filesystem';

export function isOsEmbedded() {
  return window.self !== window.top && !!window.parent?.HeymingOS;
}

export async function createOsFs(rootPath) {
  if (!isOsEmbedded()) {
    throw new Error('createOsFs called outside HeymingOS');
  }

  const HOS = window.parent.HeymingOS;
  const fsdb = await window.parent.FileSystemDB.getInstance();

  // Default project root — prefer Documents, fall back to HOME.
  const root = rootPath || HOS?.Config?.DOCUMENTS || HOS?.Config?.HOME || '/home/user';

  const listeners = new Set();

  // Subscribe to OS broadcasts so the tree refreshes on external changes.
  window.addEventListener('message', (e) => {
    if (e.data?.type === 'filesystem-change') {
      for (const fn of listeners) {
        try {
          fn(e.data);
        } catch (err) {
          console.error('[code-ide] fs listener', err);
        }
      }
    }
  });

  function postToOs(message) {
    window.parent.postMessage({ type: 'iframe-message', message }, '*');
  }

  // FileSystemDB lives in the parent window; binary blobs round-tripped
  // through getContentForApp arrive as parent-realm ArrayBuffers, so the
  // iframe's `content instanceof ArrayBuffer` check returns false and the
  // content silently stringifies to "[object ArrayBuffer]" (or empty,
  // depending on the engine). Duck-type the byteLength/buffer fields and
  // copy bytes via a fresh iframe-realm Uint8Array before decoding.
  function decodeBytes(byteLength, copyInto) {
    if (byteLength === 0) return '';
    const u8 = new Uint8Array(byteLength);
    copyInto(u8);
    return new TextDecoder('utf-8', { fatal: false }).decode(u8);
  }

  function normalizeContent(content) {
    if (content == null) return '';
    if (typeof content === 'string') return content;
    if (content instanceof ArrayBuffer) {
      return decodeBytes(content.byteLength, (u8) => u8.set(new Uint8Array(content)));
    }
    if (ArrayBuffer.isView(content)) {
      return decodeBytes(content.byteLength, (u8) =>
        u8.set(new Uint8Array(content.buffer, content.byteOffset, content.byteLength))
      );
    }
    if (typeof content === 'object' && typeof content.byteLength === 'number') {
      // Cross-realm ArrayBuffer: structured-clone keeps the bytes accessible
      // via .byteLength; copy through the parent's Uint8Array so we don't
      // depend on iframe `instanceof` matching the parent constructor.
      const ParentU8 = window.parent?.Uint8Array;
      if (ParentU8) {
        try {
          const view = content.buffer
            ? new ParentU8(content.buffer, content.byteOffset || 0, content.byteLength)
            : new ParentU8(content);
          return decodeBytes(content.byteLength, (u8) => u8.set(view));
        } catch (_) {
          /* fall through to String() */
        }
      }
    }
    return String(content);
  }

  function joinPath(parent, name) {
    if (!parent || parent === '/') return '/' + name;
    return parent.replace(/\/+$/, '') + '/' + name;
  }

  function parentOf(path) {
    if (!path || path === '/') return '/';
    const idx = path.lastIndexOf('/');
    return idx <= 0 ? '/' : path.slice(0, idx);
  }

  function baseName(path) {
    if (!path || path === '/') return '/';
    return path.slice(path.lastIndexOf('/') + 1);
  }

  return {
    kind: 'os',
    label: PROJECT_LABEL,
    root,
    joinPath,
    parentOf,
    baseName,

    async listDir(path) {
      const items = await fsdb.listDirectory(path);
      // Raw IDB records carry `.path` and `.type` but no `.name`; derive it.
      const getName =
        typeof fsdb.getFileName === 'function' ? (p) => fsdb.getFileName(p) : (p) => baseName(p);
      const out = items.map((it) => ({
        name: it.name || getName(it.path) || '',
        path: it.path,
        isDirectory: it.type === 'directory' || it.isDirectory === true,
        size: it.size ?? null,
        modified: it.modified || it.modifiedTime || it.updatedAt || null
      }));
      out.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      return out;
    },

    async readFile(path) {
      const item = await fsdb.getItem(path);
      if (!item) throw new Error(`Not found: ${path}`);
      // getContentForApp returns ArrayBuffer for binary, string for text.
      const content =
        typeof fsdb.getContentForApp === 'function'
          ? await fsdb.getContentForApp(item)
          : item.content;
      return normalizeContent(content);
    },

    async writeFile(path, content) {
      // Route through the OS so the desktop and any other watchers update.
      postToOs({
        type: 'save',
        path,
        content,
        fileName: baseName(path)
      });
    },

    async saveAs(content, suggestedName) {
      postToOs({ type: 'saveAs', content, suggestedName });
    },

    async createFile(path, content = '') {
      if (typeof fsdb.createFile === 'function') {
        await fsdb.createFile(path, content);
      } else {
        // Older API
        await fsdb.createItem?.({ path, type: 'file', content });
      }
    },

    async createDirectory(path) {
      if (typeof fsdb.createDirectory === 'function') {
        await fsdb.createDirectory(path);
      } else {
        await fsdb.createItem?.({ path, type: 'directory' });
      }
    },

    async rename(oldPath, newPath) {
      if (typeof fsdb.rename === 'function') {
        await fsdb.rename(oldPath, newPath);
      } else if (typeof fsdb.move === 'function') {
        await fsdb.move(oldPath, newPath);
      } else {
        throw new Error('Rename not supported by this filesystem.');
      }
    },

    async remove(path) {
      if (typeof fsdb.deleteItem === 'function') {
        await fsdb.deleteItem(path);
      } else if (typeof fsdb.remove === 'function') {
        await fsdb.remove(path);
      } else {
        throw new Error('Delete not supported by this filesystem.');
      }
    },

    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    openFileDialog(fileTypes) {
      postToOs({ type: 'openFileDialog', fileTypes });
    }
  };
}

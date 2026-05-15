/**
 * fs-local.js — Standalone filesystem adapter.
 *
 * Two modes:
 *   - in-memory + localStorage (default), key 'code-ide:project'
 *   - File System Access API (showDirectoryPicker), promoted via `openFolder()`
 *
 * Both expose the same interface as fs-os.js (listDir/readFile/writeFile/...).
 */

const STORAGE_KEY = 'code-ide:project';

function makeMemoryProject() {
  return {
    name: 'Untitled Project',
    files: {
      '/README.md':
        '# Welcome to Code IDE\n\n' +
        'A Monaco-powered editor that runs entirely in your browser.\n\n' +
        '- Click **Open Folder…** to point at a real folder on disk.\n' +
        '- Or just start typing — your project autosaves to `localStorage`.\n',
      '/src/main.js':
        '// Press F5 to run this file in a sandboxed iframe.\n' +
        "console.log('Hello from Code IDE 👋');\n" +
        "for (let i = 1; i <= 3; i++) console.log('tick', i);\n",
      '/src/style.css': 'body {\n  font-family: system-ui;\n  margin: 2rem;\n}\n'
    }
  };
}

function loadMemoryProject() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (err) {
    console.warn('[code-ide] failed to parse stored project, resetting', err);
  }
  return makeMemoryProject();
}

function saveMemoryProject(project) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
  } catch (err) {
    console.warn('[code-ide] failed to persist project', err);
  }
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

/**
 * Local in-memory + localStorage backed adapter.
 */
function createMemoryAdapter() {
  let project = loadMemoryProject();
  const listeners = new Set();

  function emit(eventType, path, details = {}) {
    saveMemoryProject(project);
    for (const fn of listeners) {
      try {
        fn({ type: 'filesystem-change', path, details: { ...details, eventType } });
      } catch (err) {
        console.error('[code-ide] listener error', err);
      }
    }
  }

  function isDirPath(path) {
    if (path === '/' || path === '') return true;
    const prefix = path.replace(/\/+$/, '') + '/';
    return Object.keys(project.files).some((p) => p.startsWith(prefix));
  }

  function listDir(path) {
    const norm = path === '/' ? '' : path.replace(/\/+$/, '');
    const prefix = norm + '/';
    const seen = new Map();
    for (const filePath of Object.keys(project.files)) {
      if (!filePath.startsWith(prefix)) continue;
      const rest = filePath.slice(prefix.length);
      const [first, ...more] = rest.split('/');
      if (!first) continue;
      const childPath = norm + '/' + first;
      const isDirectory = more.length > 0;
      if (seen.has(first)) {
        if (isDirectory) seen.get(first).isDirectory = true;
      } else {
        seen.set(first, {
          name: first,
          path: childPath,
          isDirectory,
          size: isDirectory ? null : project.files[childPath]?.length ?? 0
        });
      }
    }
    return [...seen.values()].sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  function readFile(path) {
    if (!(path in project.files)) throw new Error(`Not found: ${path}`);
    return project.files[path];
  }

  function writeFile(path, content) {
    const existed = path in project.files;
    project.files[path] = content;
    emit(existed ? 'change' : 'create', path);
  }

  function createFile(path, content = '') {
    if (path in project.files) throw new Error(`Already exists: ${path}`);
    project.files[path] = content;
    emit('create', path);
  }

  function createDirectory(path) {
    // Directories are implicit in flat-storage; create a placeholder if empty.
    const marker = joinPath(path, '.keep');
    if (!(marker in project.files)) {
      project.files[marker] = '';
      emit('create', path);
    }
  }

  function rename(oldPath, newPath) {
    const next = {};
    let renamedSomething = false;
    for (const [p, c] of Object.entries(project.files)) {
      if (p === oldPath) {
        next[newPath] = c;
        renamedSomething = true;
      } else if (p.startsWith(oldPath + '/')) {
        next[newPath + p.slice(oldPath.length)] = c;
        renamedSomething = true;
      } else {
        next[p] = c;
      }
    }
    if (!renamedSomething) throw new Error(`Not found: ${oldPath}`);
    project.files = next;
    emit('move', newPath, { oldParentPath: parentOf(oldPath), newParentPath: parentOf(newPath) });
  }

  function remove(path) {
    let removed = false;
    for (const p of Object.keys(project.files)) {
      if (p === path || p.startsWith(path + '/')) {
        delete project.files[p];
        removed = true;
      }
    }
    if (!removed) throw new Error(`Not found: ${path}`);
    emit('delete', path);
  }

  function setProjectName(name) {
    project.name = name;
    saveMemoryProject(project);
  }

  function resetProject() {
    project = makeMemoryProject();
    saveMemoryProject(project);
    emit('change', '/');
  }

  return {
    kind: 'local',
    get label() {
      return project.name || 'Untitled Project';
    },
    setProjectName,
    resetProject,
    root: '/',
    joinPath,
    parentOf,
    baseName,
    listDir: async (p) => listDir(p),
    readFile: async (p) => readFile(p),
    writeFile: async (p, c) => writeFile(p, c),
    createFile: async (p, c) => createFile(p, c),
    createDirectory: async (p) => createDirectory(p),
    rename: async (a, b) => rename(a, b),
    remove: async (p) => remove(p),
    isDirPath,
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    // Save-as: download the file from the browser.
    async saveAs(content, suggestedName) {
      if (window.showSaveFilePicker) {
        try {
          const handle = await window.showSaveFilePicker({ suggestedName });
          const w = await handle.createWritable();
          await w.write(content);
          await w.close();
          return;
        } catch (err) {
          if (err.name === 'AbortError') return;
          console.warn('[code-ide] showSaveFilePicker failed, falling back', err);
        }
      }
      const blob = new Blob([content], { type: 'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = suggestedName || 'untitled.txt';
      a.click();
      URL.revokeObjectURL(a.href);
    }
  };
}

/**
 * File System Access API adapter (real folder on disk).
 *
 * Backed by a `FileSystemDirectoryHandle`. Falls back to nothing if the API is
 * unavailable. Permissions are requested on demand.
 */
async function createDirectoryHandleAdapter(dirHandle) {
  const listeners = new Set();

  async function ensurePermission(handle, mode = 'readwrite') {
    if (!handle?.queryPermission) return true;
    const have = await handle.queryPermission({ mode });
    if (have === 'granted') return true;
    const ask = await handle.requestPermission({ mode });
    return ask === 'granted';
  }

  async function resolveDir(path, { create = false } = {}) {
    const parts = path.split('/').filter(Boolean);
    let cur = dirHandle;
    for (const part of parts) {
      cur = await cur.getDirectoryHandle(part, { create });
    }
    return cur;
  }

  async function resolveFile(path, { create = false } = {}) {
    const parts = path.split('/').filter(Boolean);
    const fileName = parts.pop();
    let cur = dirHandle;
    for (const part of parts) {
      cur = await cur.getDirectoryHandle(part, { create });
    }
    const fileHandle = await cur.getFileHandle(fileName, { create });
    return { parent: cur, fileHandle, fileName };
  }

  function emit(eventType, path, details = {}) {
    for (const fn of listeners) {
      try {
        fn({ type: 'filesystem-change', path, details: { ...details, eventType } });
      } catch (err) {
        console.error('[code-ide] listener error', err);
      }
    }
  }

  return {
    kind: 'fs-access',
    label: dirHandle.name,
    root: '/',
    joinPath,
    parentOf,
    baseName,
    async listDir(path) {
      if (!(await ensurePermission(dirHandle))) throw new Error('Permission denied');
      const dir = path === '/' ? dirHandle : await resolveDir(path);
      const out = [];
      for await (const [name, handle] of dir.entries()) {
        const childPath = path === '/' ? '/' + name : path.replace(/\/+$/, '') + '/' + name;
        out.push({
          name,
          path: childPath,
          isDirectory: handle.kind === 'directory',
          size: null
        });
      }
      return out.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    },
    async readFile(path) {
      const { fileHandle } = await resolveFile(path);
      const file = await fileHandle.getFile();
      return await file.text();
    },
    async writeFile(path, content) {
      if (!(await ensurePermission(dirHandle))) throw new Error('Permission denied');
      const { fileHandle } = await resolveFile(path, { create: true });
      const w = await fileHandle.createWritable();
      await w.write(content);
      await w.close();
      emit('change', path);
    },
    async createFile(path, content = '') {
      if (!(await ensurePermission(dirHandle))) throw new Error('Permission denied');
      const { fileHandle } = await resolveFile(path, { create: true });
      const w = await fileHandle.createWritable();
      await w.write(content);
      await w.close();
      emit('create', path);
    },
    async createDirectory(path) {
      if (!(await ensurePermission(dirHandle))) throw new Error('Permission denied');
      await resolveDir(path, { create: true });
      emit('create', path);
    },
    async rename(oldPath, newPath) {
      // FS Access API has no native rename; copy + remove.
      const old = await resolveFile(oldPath);
      const file = await old.fileHandle.getFile();
      const text = await file.text();
      const { fileHandle: newHandle } = await resolveFile(newPath, { create: true });
      const w = await newHandle.createWritable();
      await w.write(text);
      await w.close();
      await old.parent.removeEntry(old.fileName);
      emit('move', newPath, { oldParentPath: parentOf(oldPath), newParentPath: parentOf(newPath) });
    },
    async remove(path) {
      const parts = path.split('/').filter(Boolean);
      const name = parts.pop();
      let cur = dirHandle;
      for (const part of parts) {
        cur = await cur.getDirectoryHandle(part);
      }
      await cur.removeEntry(name, { recursive: true });
      emit('delete', path);
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async saveAs(content, suggestedName) {
      if (window.showSaveFilePicker) {
        try {
          const handle = await window.showSaveFilePicker({ suggestedName });
          const w = await handle.createWritable();
          await w.write(content);
          await w.close();
        } catch (err) {
          if (err.name !== 'AbortError') throw err;
        }
      }
    }
  };
}

export async function createLocalFs() {
  return createMemoryAdapter();
}

export async function openLocalFolder() {
  if (!window.showDirectoryPicker) {
    throw new Error(
      "This browser can't open a folder from disk. Try Chrome or Edge."
    );
  }
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
  return createDirectoryHandleAdapter(handle);
}

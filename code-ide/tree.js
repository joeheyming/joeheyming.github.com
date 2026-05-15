/**
 * tree.js — Collapsible file-tree view bound to a filesystem adapter.
 *
 * Only renders. Emits events via callbacks. No knowledge of editor/models.
 */

const ICONS = {
  folder: '📁',
  'folder-open': '📂',
  file: '📄',
  js: '📜',
  ts: '📘',
  json: '🔧',
  md: '📝',
  html: '🌐',
  css: '🎨',
  py: '🐍',
  go: '🐹',
  rs: '🦀',
  sh: '🐚',
  txt: '📄',
  image: '🖼️'
};

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico']);

function iconFor(node) {
  if (node.isDirectory) return node.expanded ? ICONS['folder-open'] : ICONS.folder;
  const name = node.name || '';
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  if (IMAGE_EXT.has(ext)) return ICONS.image;
  return ICONS[ext] || ICONS.file;
}

export class FileTree {
  constructor(container, fs, callbacks = {}) {
    this.container = container;
    this.fs = fs;
    this.callbacks = callbacks;
    this.expanded = new Set(['/']);
    this.selected = null;
    this.editing = null; // path being renamed/created
    this.cache = new Map(); // path -> children array
    this.decorations = new Map(); // absolutePath -> 'M' | '??' | etc.
    this.container.addEventListener('contextmenu', (e) => this.handleContext(e));
  }

  /** Replace the decoration map and re-apply badges to all visible rows. */
  setDecorations(decorations) {
    this.decorations = decorations || new Map();
    this.applyDecorations();
  }

  applyDecorations() {
    if (!this.container) return;
    for (const row of this.container.querySelectorAll('.tree-node')) {
      const path = row.dataset.path;
      const code = this.decorations.get(path);
      const badge = row.querySelector('.tree-badge');
      if (badge) badge.remove();
      row.classList.remove(
        'decor-modified',
        'decor-added',
        'decor-deleted',
        'decor-untracked',
        'decor-conflict'
      );
      if (code) {
        const cls = decorClass(code);
        if (cls) row.classList.add(cls);
        const span = document.createElement('span');
        span.className = 'tree-badge ' + cls;
        span.textContent = code;
        span.title = decorLabel(code);
        row.appendChild(span);
      }
    }
  }

  setFs(fs) {
    this.fs = fs;
    this.cache.clear();
    this.expanded = new Set(['/']);
    this.selected = null;
  }

  async render() {
    const root = this.fs.root || '/';
    const rootChildren = await this.fetch(root);
    this.container.innerHTML = '';
    const fragment = document.createDocumentFragment();
    for (const child of rootChildren) {
      await this.renderNode(child, fragment, 0);
    }
    this.container.appendChild(fragment);
    this.applyDecorations();
  }

  async fetch(path) {
    if (this.cache.has(path)) return this.cache.get(path);
    const items = await this.fs.listDir(path);
    this.cache.set(path, items);
    return items;
  }

  invalidate(path) {
    if (path == null) {
      this.cache.clear();
      return;
    }
    // invalidate the parent of the changed path too
    const parent = this.fs.parentOf(path);
    this.cache.delete(parent);
    this.cache.delete(path);
  }

  async renderNode(node, parent, depth) {
    const row = document.createElement('div');
    row.className = 'tree-node';
    row.dataset.path = node.path;
    row.dataset.dir = node.isDirectory ? '1' : '0';
    row.style.paddingLeft = 4 + depth * 14 + 'px';

    const chevron = document.createElement('span');
    chevron.className = 'chevron';
    chevron.textContent = node.isDirectory ? (this.expanded.has(node.path) ? '▾' : '▸') : ' ';
    row.appendChild(chevron);

    const icon = document.createElement('span');
    icon.className = 'icon';
    icon.textContent = iconFor({ ...node, expanded: this.expanded.has(node.path) });
    row.appendChild(icon);

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = node.name || node.path?.split('/').pop() || '(unnamed)';
    row.appendChild(name);

    if (this.selected === node.path) row.classList.add('selected');

    row.addEventListener('click', (e) => this.handleClick(e, node, row));
    row.addEventListener('dblclick', (e) => this.handleDoubleClick(e, node));

    parent.appendChild(row);

    if (node.isDirectory && this.expanded.has(node.path)) {
      const children = await this.fetch(node.path);
      for (const child of children) {
        await this.renderNode(child, parent, depth + 1);
      }
    }
  }

  async handleClick(e, node, row) {
    e.stopPropagation();
    this.select(node.path);
    if (node.isDirectory) {
      if (this.expanded.has(node.path)) this.expanded.delete(node.path);
      else this.expanded.add(node.path);
      await this.render();
    } else {
      this.callbacks.onOpen?.(node);
    }
  }

  async handleDoubleClick(e, node) {
    if (!node.isDirectory) {
      this.callbacks.onOpen?.(node, { focus: true });
    }
  }

  select(path) {
    this.selected = path;
    for (const el of this.container.querySelectorAll('.tree-node.selected')) {
      el.classList.remove('selected');
    }
    const row = this.container.querySelector(`.tree-node[data-path="${cssEscape(path)}"]`);
    if (row) row.classList.add('selected');
  }

  /**
   * Inline-create a new file or folder under `parentPath`. The user types the
   * name; pressing Enter commits, Escape cancels.
   */
  async beginCreate(parentPath, kind) {
    const dir = parentPath || this.fs.root || '/';
    this.expanded.add(dir);
    await this.render();
    const parentRow = this.container.querySelector(`.tree-node[data-path="${cssEscape(dir)}"]`);
    const depth = parentRow ? (parseInt(parentRow.style.paddingLeft, 10) - 4) / 14 + 1 : 0;
    const row = document.createElement('div');
    row.className = 'tree-node editing';
    row.style.paddingLeft = 4 + depth * 14 + 'px';
    row.innerHTML = `<span class="chevron"> </span><span class="icon">${
      kind === 'directory' ? ICONS.folder : ICONS.file
    }</span><span class="name"></span>`;
    const input = document.createElement('input');
    input.placeholder = kind === 'directory' ? 'new-folder' : 'new-file.js';
    row.querySelector('.name').appendChild(input);

    if (parentRow && parentRow.nextSibling) {
      this.container.insertBefore(row, parentRow.nextSibling);
    } else {
      this.container.appendChild(row);
    }
    input.focus();

    return new Promise((resolve) => {
      const finish = async (commit) => {
        const name = input.value.trim();
        row.remove();
        if (!commit || !name) {
          resolve(null);
          return;
        }
        const path = this.fs.joinPath(dir, name);
        try {
          if (kind === 'directory') await this.fs.createDirectory(path);
          else await this.fs.createFile(path, '');
          this.invalidate(path);
          await this.render();
          this.select(path);
          resolve({ path, kind });
        } catch (err) {
          resolve({ error: err });
        }
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') finish(true);
        else if (e.key === 'Escape') finish(false);
      });
      input.addEventListener('blur', () => finish(true));
    });
  }

  async beginRename(node) {
    await this.render();
    const row = this.container.querySelector(`.tree-node[data-path="${cssEscape(node.path)}"]`);
    if (!row) return null;
    const nameEl = row.querySelector('.name');
    const oldName = nameEl.textContent;
    nameEl.innerHTML = '';
    const input = document.createElement('input');
    input.value = oldName;
    nameEl.appendChild(input);
    input.focus();
    input.setSelectionRange(
      0,
      oldName.lastIndexOf('.') > 0 ? oldName.lastIndexOf('.') : oldName.length
    );

    return new Promise((resolve) => {
      const finish = async (commit) => {
        const name = input.value.trim();
        if (!commit || !name || name === oldName) {
          await this.render();
          resolve(null);
          return;
        }
        const newPath = this.fs.joinPath(this.fs.parentOf(node.path), name);
        try {
          await this.fs.rename(node.path, newPath);
          this.invalidate(node.path);
          this.invalidate(newPath);
          await this.render();
          this.select(newPath);
          resolve({ oldPath: node.path, newPath });
        } catch (err) {
          resolve({ error: err });
        }
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') finish(true);
        else if (e.key === 'Escape') finish(false);
      });
      input.addEventListener('blur', () => finish(true));
    });
  }

  handleContext(e) {
    e.preventDefault();
    const row = e.target.closest('.tree-node');
    const path = row?.dataset.path || this.fs.root || '/';
    const isDir = row ? row.dataset.dir === '1' : true;
    this.select(path);
    this.callbacks.onContext?.({
      path,
      isDirectory: isDir,
      x: e.clientX,
      y: e.clientY,
      name: row?.querySelector('.name')?.textContent || ''
    });
  }
}

function cssEscape(s) {
  if (window.CSS?.escape) return window.CSS.escape(s);
  return String(s).replace(/(["\\])/g, '\\$1');
}

function decorClass(code) {
  if (code === '??') return 'decor-untracked';
  if (code === 'A') return 'decor-added';
  if (code === 'M') return 'decor-modified';
  if (code === 'D') return 'decor-deleted';
  if (code === '!') return 'decor-conflict';
  return '';
}

function decorLabel(code) {
  return (
    {
      M: 'Modified',
      A: 'Added',
      D: 'Deleted',
      '??': 'Untracked',
      '!': 'Conflict'
    }[code] || code
  );
}

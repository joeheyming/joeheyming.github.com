/**
 * Menu-bar dropdown, tab context menu, tree context menu, and the shared
 * `popupMenu` that backs both context menus. Mixed into `CodeIDE.prototype`
 * at boot so `this` continues to refer to the running ide instance.
 */

const $ = (sel, root = document) => root.querySelector(sel);

export const menuMethods = {
  /**
   * Render a list of `{label, action, danger?, sep?, disabled?}` items as a
   * dismiss-on-outside-click menu at (x, y). One implementation backs both
   * the tab and tree context menus.
   */
  popupMenu(items, x, y) {
    document.querySelectorAll('.ctx-menu').forEach((el) => el.remove());
    const menu = document.createElement('div');
    menu.className = 'ctx-menu';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';

    for (const item of items) {
      if (item.sep) {
        const sep = document.createElement('div');
        sep.className = 'sep';
        menu.appendChild(sep);
        continue;
      }
      const row = document.createElement('div');
      row.className =
        'item' + (item.danger ? ' danger' : '') + (item.disabled ? ' disabled' : '');
      row.textContent = item.label;
      if (!item.disabled) {
        row.addEventListener('click', () => {
          menu.remove();
          try {
            item.action?.();
          } catch (err) {
            this.toast(err.message, 'error');
          }
        });
      }
      menu.appendChild(row);
    }

    document.body.appendChild(menu);
    setTimeout(() => {
      const dismiss = (e) => {
        if (!menu.contains(e.target)) {
          menu.remove();
          document.removeEventListener('mousedown', dismiss);
        }
      };
      document.addEventListener('mousedown', dismiss);
    }, 0);
  },

  /** VS Code-style tab actions. */
  showTabContext({ path, x, y }) {
    const idx = this.tabs.findIndex((t) => t.path === path);
    if (idx < 0) return;
    const closeMany = (paths) => {
      for (const p of paths) this.closeTab(p);
    };
    const others = () => this.tabs.filter((t) => t.path !== path).map((t) => t.path);
    const toRight = () =>
      this.tabs
        .slice(this.tabs.findIndex((t) => t.path === path) + 1)
        .map((t) => t.path);
    const saved = () =>
      this.tabs
        .filter((t) => t.kind === 'diff' || !this.host.isDirty(t.path))
        .map((t) => t.path);
    const all = () => this.tabs.map((t) => t.path);

    const items = [
      { label: 'Close', action: () => this.closeTab(path) },
      {
        label: 'Close Others',
        disabled: this.tabs.length <= 1,
        action: () => closeMany(others())
      },
      {
        label: 'Close to the Right',
        disabled: idx === this.tabs.length - 1,
        action: () => closeMany(toRight())
      },
      {
        label: 'Close Saved',
        disabled: saved().length === 0,
        action: () => closeMany(saved())
      },
      { sep: true },
      {
        label: 'Close All',
        danger: true,
        action: () => closeMany(all())
      }
    ];
    this.popupMenu(items, x, y);
  },

  showTreeContext({ path, isDirectory, x, y }) {
    const items = [];
    if (!isDirectory) {
      items.push({ label: 'Open', action: () => this.openPath(path) });
      items.push({ label: 'Open to Side (Diff)', action: () => this.openPath(path) });
      items.push({ sep: true });
    }
    items.push({
      label: 'New File',
      action: () => this.tree.beginCreate(isDirectory ? path : this.fs.parentOf(path), 'file')
    });
    items.push({
      label: 'New Folder',
      action: () => this.tree.beginCreate(isDirectory ? path : this.fs.parentOf(path), 'directory')
    });
    items.push({ sep: true });
    items.push({
      label: 'Rename',
      action: () => this.tree.beginRename({ path, name: this.fs.baseName(path) })
    });
    items.push({
      label: 'Delete',
      danger: true,
      action: async () => {
        if (!window.confirm(`Delete ${path}?`)) return;
        try {
          await this.fs.remove(path);
          this.closeTab(path);
          this.tree.invalidate(null);
          await this.tree.render();
        } catch (err) {
          this.toast(err.message, 'error');
        }
      }
    });
    this.popupMenu(items, x, y);
  },

  bindMenuBar() {
    const menus = {
      file: () => [
        { label: 'New File', kbd: 'Ctrl+N', action: () => this.newUntitledTab() },
        {
          label: 'New File in Project…',
          action: () => this.tree.beginCreate(this.fs.root, 'file')
        },
        { sep: true },
        { label: 'Open File from Disk…', action: () => this.openFromDisk() },
        { label: 'Open Folder…', action: () => this.openFolderFromDisk() },
        { sep: true },
        { label: 'Save', kbd: 'Ctrl+S', action: () => this.saveActive() },
        { label: 'Save As…', kbd: 'Ctrl+Shift+S', action: () => this.saveActiveAs() },
        { sep: true },
        {
          label: this.fs.kind === 'local' ? 'Reset Project' : 'Close Project',
          action: () => this.resetOrCloseProject()
        }
      ],
      edit: () => [
        {
          label: 'Undo',
          kbd: 'Ctrl+Z',
          action: () => this.host.editor.getAction('undo')?.run()
        },
        {
          label: 'Redo',
          kbd: 'Ctrl+Shift+Z',
          action: () => this.host.editor.getAction('redo')?.run()
        },
        { sep: true },
        {
          label: 'Find',
          kbd: 'Ctrl+F',
          action: () => this.host.editor.getAction('actions.find')?.run()
        },
        {
          label: 'Replace',
          kbd: 'Ctrl+H',
          action: () => this.host.editor.getAction('editor.action.startFindReplaceAction')?.run()
        },
        {
          label: 'Command Palette',
          kbd: 'F1',
          action: () => this.host.editor.getAction('editor.action.quickCommand')?.run()
        }
      ],
      view: () => [
        { label: 'Toggle Theme', action: () => $('#cmd-theme').click() },
        { label: 'Toggle Vim Mode', action: () => $('#cmd-vim').click() },
        {
          label: `${this.formatOnSave ? '✓ ' : ''}Format On Save`,
          action: () => {
            this.formatOnSave = !this.formatOnSave;
            localStorage.setItem('code-ide:formatOnSave', this.formatOnSave ? '1' : '0');
            this.toast(this.formatOnSave ? 'Format on save: on' : 'Format on save: off');
          }
        },
        { sep: true },
        { label: 'Console Panel', action: () => this.showPanel('console') },
        { label: 'Diff Panel', action: () => this.showPanel('diff') }
      ],
      run: () => [
        { label: 'Run Current File', kbd: 'F5', action: () => this.runActive() },
        { label: 'Reset Runner', action: () => this.runner.reset() },
        { label: 'Clear Console', action: () => this.clearConsole() }
      ],
      help: () => [
        {
          label: 'About Code IDE',
          action: () =>
            this.toast(
              'Code IDE — Monaco-powered editor (v0.1). Built for the Heyming Apps suite.',
              'info'
            )
        },
        {
          label: 'Visit Joe Heyming',
          action: () => window.open('https://joeheyming.github.io/', '_blank')
        }
      ]
    };

    const closeMenu = () => {
      this.menuOpen = null;
      this.dropdownEl.hidden = true;
      for (const btn of document.querySelectorAll('.menubar .menu')) btn.classList.remove('open');
    };

    document.addEventListener('click', (e) => {
      if (!this.menuOpen) return;
      if (this.dropdownEl.contains(e.target)) return;
      if (e.target.closest('.menubar .menu')) return;
      closeMenu();
    });

    for (const btn of document.querySelectorAll('.menubar .menu')) {
      btn.addEventListener('click', () => {
        const id = btn.dataset.menu;
        if (this.menuOpen === id) {
          closeMenu();
          return;
        }
        const items = menus[id]?.() ?? [];
        this.dropdownEl.innerHTML = '';
        items.forEach((item) => {
          if (item.sep) {
            const sep = document.createElement('div');
            sep.className = 'sep';
            this.dropdownEl.appendChild(sep);
            return;
          }
          const row = document.createElement('div');
          row.className = 'item';
          row.innerHTML = `<span>${item.label}</span>${
            item.kbd ? `<span class="kbd">${item.kbd}</span>` : ''
          }`;
          row.addEventListener('click', () => {
            closeMenu();
            try {
              item.action?.();
            } catch (err) {
              this.toast(err.message, 'error');
            }
          });
          this.dropdownEl.appendChild(row);
        });
        // Position under the button
        const rect = btn.getBoundingClientRect();
        this.dropdownEl.style.left = rect.left + 'px';
        this.dropdownEl.style.top = rect.bottom + 'px';
        this.dropdownEl.hidden = false;
        for (const b of document.querySelectorAll('.menubar .menu')) b.classList.remove('open');
        btn.classList.add('open');
        this.menuOpen = id;
      });
    }

    this.formatOnSave = localStorage.getItem('code-ide:formatOnSave') === '1';
  }
};

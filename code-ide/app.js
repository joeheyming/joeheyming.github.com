/**
 * app.js — top-level orchestrator. Wires DOM, filesystem, editor, runner,
 * diff view, tree, status bar, command palette, and keyboard shortcuts.
 */

import { EditorHost, detectLanguage } from './editor.js';
import { createLocalFs, openLocalFolder } from './fs-local.js';
import { createOsFs, isOsEmbedded } from './fs-os.js';
import { FileTree } from './tree.js';
import { Runner } from './runner.js';
import { DiffView } from './diff.js';
import { canPrettier, formatWithPrettier } from './format.js';
import { createGitService } from './git-service.js';
import { ScmView } from './scm-view.js';

const $ = (sel, root = document) => root.querySelector(sel);

const debug = (...args) => {
  if (window.parent?.HeymingOS?.Config?.DEBUG) console.log('[code-ide]', ...args);
};

class CodeIDE {
  constructor() {
    this.fs = null;
    this.host = null;
    this.tree = null;
    this.runner = null;
    this.diff = null;
    this.tabs = []; // [{ path, name, dirty, isPlaceholder }]
    this.activePath = null;
    this.pendingSaveAs = null;
    this.toastStack = null;
    this.menuOpen = null;
    this.dropdownEl = $('#menu-dropdown');
  }

  async boot() {
    this.toastStack = document.createElement('div');
    this.toastStack.className = 'toast-stack';
    document.body.appendChild(this.toastStack);

    this.host = new EditorHost($('#editor'), {
      theme: localStorage.getItem('code-ide:theme') || 'vs-dark'
    });
    await this.host.init($('#diff-main'));
    this.host.setTheme(this.host.themeName);

    this.runner = new Runner($('#sandbox'), {
      onMessage: (msg) => this.appendConsole(msg)
    });

    this.diff = new DiffView($('#diff-editor'), this.host);

    this.fs = isOsEmbedded() ? await createOsFs() : await createLocalFs();
    document.body.classList.toggle('standalone', this.fs.kind !== 'os');
    debug('fs kind', this.fs.kind, 'root', this.fs.root);

    this.tree = new FileTree($('#tree'), this.fs, {
      onOpen: (node) => this.openPath(node.path),
      onContext: (ctx) => this.showTreeContext(ctx)
    });
    await this.tree.render();

    // Git integration is only available when embedded in HeymingOS (the only
    // env that hosts a FileSystemDB compatible with the terminal git stack).
    this.git = await createGitService(this.fs).catch((err) => {
      console.warn('[code-ide] git unavailable:', err);
      return null;
    });
    if (this.git) {
      await this.git.setRoot(this.fs.root);
      this.scm = new ScmView($('#scm'), this.makeScmHost());
      this.git.onChange((state) => this.onGitState(state));
    } else {
      $('#scm').innerHTML = `
        <div class="scm-empty">
          <p>Source control is only available when Code IDE is running inside HeymingOS.</p>
          <p style="margin-top:12px;font-size:11px;">Open <a href="../os/" target="_top">HeymingOS</a>
          and launch Code IDE there for git integration (init, clone, commit, branch, pull, push, diff).</p>
        </div>`;
      // Hide remote-action buttons (no service to back them).
      for (const id of ['scm-refresh', 'scm-pull', 'scm-push', 'scm-sync', 'scm-more']) {
        const el = $('#' + id);
        if (el) el.hidden = true;
      }
    }

    this.bindStatusbar();
    this.bindToolbarButtons();
    this.bindMenuBar();
    this.bindTreeActions();
    this.bindPanel();
    this.bindKeyboard();
    this.bindWelcome();
    this.bindOsMessages();
    this.bindFsChanges();
    this.bindSidebarTabs();
    if (this.git) this.bindScmActions();

    this.updateStatusEnvironment();
    this.updateProjectLabel();

    // If we are embedded under HeymingOS, ask for any pending file open.
    if (isOsEmbedded()) {
      window.parent.postMessage(
        { type: 'iframe-message', message: { type: 'requestPendingFile', app: 'code-ide' } },
        '*'
      );
    } else if (this.fs.kind === 'local') {
      // Auto-open the README in standalone mode so the welcome isn't lonely.
      try {
        await this.openPath('/README.md');
      } catch {
        /* empty workspace is fine */
      }
    }
  }

  // ─── Tabs / models ─────────────────────────────────────────────────────

  async openPath(path) {
    if (!path) return;
    let entry = this.tabs.find((t) => t.path === path);
    if (!entry) {
      let content = '';
      try {
        content = await this.fs.readFile(path);
      } catch (err) {
        this.toast(`Could not open ${path}: ${err.message}`, 'error');
        return;
      }
      const name = this.fs.baseName(path);
      this.host.openModel(path, content, detectLanguage(name));
      entry = { path, name, dirty: false };
      this.tabs.push(entry);
    }
    this.setActive(path);
  }

  /** Open a new in-memory tab (not yet on disk). */
  newUntitledTab(suggestedName = 'untitled.txt') {
    let n = 1;
    let path;
    do {
      path = '/__scratch/' + (n === 1 ? suggestedName : `${n}-${suggestedName}`);
      n++;
    } while (this.tabs.some((t) => t.path === path));
    this.host.openModel(path, '', detectLanguage(suggestedName));
    this.tabs.push({ path, name: this.fs.baseName(path), dirty: false, isPlaceholder: true });
    this.setActive(path);
  }

  setActive(path) {
    this.activePath = path;
    const tab = this.tabs.find((t) => t.path === path);
    if (tab?.kind === 'diff') {
      // Re-fetch fresh diff content (HEAD may have moved or working tree edited).
      this.openWorkingDiff(tab.filepath);
      return;
    }
    this.host.hideMainDiff();
    this.host.setActive(path);
    this.renderTabs();
    this.updateStatusFromActive();
    $('#welcome').classList.add('hidden');
    $('#editor').classList.remove('hidden');
  }

  closeTab(path) {
    const tab = this.tabs.find((t) => t.path === path);
    if (tab?.kind !== 'diff' && this.host.isDirty(path)) {
      const ok = window.confirm(`Discard unsaved changes to ${this.fs.baseName(path)}?`);
      if (!ok) return;
    }
    this.tabs = this.tabs.filter((t) => t.path !== path);
    if (tab?.kind !== 'diff') this.host.closeModel(path);
    if (this.activePath === path) {
      this.host.hideMainDiff();
      const next = this.tabs[this.tabs.length - 1];
      if (next) this.setActive(next.path);
      else {
        this.activePath = null;
        $('#welcome').classList.remove('hidden');
        $('#editor').classList.add('hidden');
        this.renderTabs();
      }
    } else {
      this.renderTabs();
    }
  }

  renderTabs() {
    const host = $('#tabs');
    host.innerHTML = '';
    for (const tab of this.tabs) {
      const isDiff = tab.kind === 'diff';
      const dirty = !isDiff && this.host.isDirty(tab.path);
      const el = document.createElement('div');
      el.className =
        'tab' + (tab.path === this.activePath ? ' active' : '') + (dirty ? ' dirty' : '');
      el.dataset.path = tab.path;
      const icon = isDiff ? '⇆' : '📄';
      const titleAttr = isDiff ? `${tab.sourcePath} (vs HEAD)` : tab.path;
      el.innerHTML = `<span class="icon">${icon}</span><span class="name" title="${titleAttr}">${tab.name}</span><span class="close" title="Close">×</span>`;
      el.addEventListener('click', (e) => {
        if (e.target.classList.contains('close')) return;
        this.setActive(tab.path);
      });
      el.querySelector('.close').addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeTab(tab.path);
      });
      el.addEventListener('auxclick', (e) => {
        if (e.button === 1) this.closeTab(tab.path);
      });
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.showTabContext({ path: tab.path, x: e.clientX, y: e.clientY });
      });
      host.appendChild(el);
    }
    this.refreshDiffSelects();
  }

  /**
   * VS Code-style tab actions. Mirrors the tree's `.ctx-menu` pattern so we
   * stay consistent with the existing UI rather than introducing a new
   * popup widget.
   */
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
  }

  /**
   * Render a list of `{label, action, danger?, sep?, disabled?}` items as a
   * dismiss-on-outside-click menu at (x, y). Extracted so the tab and tree
   * context menus share one implementation.
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
  }

  // ─── Save / save-as ────────────────────────────────────────────────────

  async saveActive() {
    if (!this.activePath) return;
    const path = this.activePath;
    const tab = this.tabs.find((t) => t.path === path);
    if (tab?.isPlaceholder) {
      return this.saveActiveAs();
    }

    let content = this.host.getValue(path);

    // Format on save: try Prettier first, fall back to Monaco's formatter.
    const lang = this.host.getLanguage(path);
    if (this.formatOnSave && canPrettier(lang)) {
      try {
        const formatted = await formatWithPrettier(content, lang);
        if (formatted != null && formatted !== content) {
          this.host.setValue(path, formatted);
          content = formatted;
        }
      } catch (err) {
        this.toast('Prettier failed: ' + (err.message || err), 'warn');
      }
    }

    try {
      await this.fs.writeFile(path, content);
      this.host.markSaved(path);
      this.toast(`Saved ${this.fs.baseName(path)}`, 'success');
    } catch (err) {
      this.toast(`Save failed: ${err.message}`, 'error');
    }
    this.renderTabs();
  }

  async saveActiveAs() {
    if (!this.activePath) return;
    const path = this.activePath;
    const content = this.host.getValue(path);
    const suggested = this.fs.baseName(path).replace(/^\d+-/, '');

    if (this.fs.kind === 'os') {
      this.pendingSaveAs = { oldPath: path };
      await this.fs.saveAs(content, suggested);
    } else {
      try {
        await this.fs.saveAs(content, suggested);
        this.toast(`Saved ${suggested}`, 'success');
      } catch (err) {
        this.toast(`Save As failed: ${err.message}`, 'error');
      }
    }
  }

  // ─── Run ───────────────────────────────────────────────────────────────

  async runActive() {
    if (!this.activePath) {
      this.toast('Open a JS file first', 'warn');
      return;
    }
    const lang = this.host.getLanguage(this.activePath);
    if (lang !== 'javascript' && lang !== 'typescript') {
      this.toast(`Cannot run a ${lang} file`, 'warn');
      return;
    }
    const code = this.host.getValue(this.activePath);
    if (lang === 'typescript') {
      this.toast('Running TypeScript as JavaScript (no type stripping)', 'warn');
    }
    this.showPanel('console');
    this.clearConsole();
    await this.runner.run(code, this.fs.baseName(this.activePath));
  }

  // ─── Format ───────────────────────────────────────────────────────────

  async formatActive() {
    if (!this.activePath) return;
    const lang = this.host.getLanguage(this.activePath);
    if (canPrettier(lang)) {
      try {
        const src = this.host.getValue(this.activePath);
        const formatted = await formatWithPrettier(src, lang);
        if (formatted != null) {
          this.host.setValue(this.activePath, formatted);
          // Keep dirty flag accurate: setValue rewrites baseline, undo via Ctrl+Z.
          this.host.fireDirty();
          this.renderTabs();
          this.toast('Formatted with Prettier', 'success');
        }
        return;
      } catch (err) {
        this.toast('Prettier failed, using Monaco formatter', 'warn');
      }
    }
    await this.host.formatCurrent();
  }

  // ─── Status bar ────────────────────────────────────────────────────────

  bindStatusbar() {
    this.host.onCursor((pos) => {
      $('#status-cursor').textContent = `Ln ${pos.line}, Col ${pos.column}`;
    });
    this.host.onDirty(() => {
      this.renderTabs();
      this.updateStatusFromActive();
    });
  }

  updateStatusFromActive() {
    if (!this.activePath) {
      $('#status-language').textContent = '—';
      $('#status-dirty').textContent = '';
      return;
    }
    const lang = this.host.getLanguage(this.activePath);
    $('#status-language').textContent = lang;
    $('#status-dirty').textContent = this.host.isDirty(this.activePath) ? '● Modified' : 'Saved';
  }

  updateStatusEnvironment() {
    const env = $('#status-env');
    if (this.fs.kind === 'os') env.textContent = 'HeymingOS';
    else if (this.fs.kind === 'fs-access') env.textContent = `Folder: ${this.fs.label}`;
    else env.textContent = 'Standalone';
  }

  updateProjectLabel() {
    $('#project-label').textContent = this.fs.label || 'Project';
  }

  // ─── Toolbar ───────────────────────────────────────────────────────────

  bindToolbarButtons() {
    $('#cmd-format').addEventListener('click', () => this.formatActive());
    $('#cmd-run').addEventListener('click', () => this.runActive());
    $('#cmd-diff').addEventListener('click', () => this.showPanel('diff'));
    $('#cmd-theme').addEventListener('click', () => {
      const next = this.host.cycleTheme();
      localStorage.setItem('code-ide:theme', next);
    });
    $('#cmd-vim').addEventListener('click', async () => {
      const btn = $('#cmd-vim');
      const on = await this.host.toggleVim($('#status-mode'));
      btn.classList.toggle('active', on);
      $('#status-mode').textContent = on ? '' : 'INS';
      $('#status-mode').classList.toggle('vim', on);
      this.toast(on ? 'Vim mode on' : 'Vim mode off');
    });
  }

  // ─── Menu bar ──────────────────────────────────────────────────────────

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

  // ─── Tree actions ──────────────────────────────────────────────────────

  bindTreeActions() {
    $('#tree-new-file').addEventListener('click', async () => {
      const parent = this.tree.selected
        ? (await this.isDirectory(this.tree.selected))
          ? this.tree.selected
          : this.fs.parentOf(this.tree.selected)
        : this.fs.root;
      const res = await this.tree.beginCreate(parent, 'file');
      if (res?.error) this.toast(res.error.message, 'error');
    });
    $('#tree-new-folder').addEventListener('click', async () => {
      const parent = this.tree.selected
        ? (await this.isDirectory(this.tree.selected))
          ? this.tree.selected
          : this.fs.parentOf(this.tree.selected)
        : this.fs.root;
      const res = await this.tree.beginCreate(parent, 'directory');
      if (res?.error) this.toast(res.error.message, 'error');
    });
    $('#tree-open-folder').addEventListener('click', () => this.openFolderFromDisk());
    $('#tree-refresh').addEventListener('click', async () => {
      this.tree.invalidate(null);
      await this.tree.render();
    });
  }

  async isDirectory(path) {
    try {
      const parent = this.fs.parentOf(path);
      const items = await this.fs.listDir(parent);
      return items.find((it) => it.path === path)?.isDirectory ?? false;
    } catch {
      return false;
    }
  }

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
  }

  // ─── Panel (console + diff) ────────────────────────────────────────────

  bindPanel() {
    $('#panel-close').addEventListener('click', () => this.hidePanel());
    for (const t of document.querySelectorAll('.panel-tab')) {
      t.addEventListener('click', () => this.showPanel(t.dataset.panelTab));
    }
    $('#console-clear').addEventListener('click', () => this.clearConsole());
    $('#diff-render').addEventListener('click', () => {
      const left = $('#diff-left').value;
      const right = $('#diff-right').value;
      if (left && right) this.diff.show(left, right);
    });
  }

  showPanel(which) {
    $('.workspace').classList.add('has-panel');
    $('#panel').hidden = false;
    for (const tab of document.querySelectorAll('.panel-tab')) {
      tab.classList.toggle('active', tab.dataset.panelTab === which);
    }
    for (const view of document.querySelectorAll('.panel-view')) {
      view.hidden = view.dataset.panelView !== which;
    }
    if (which === 'diff') this.refreshDiffSelects();
  }

  hidePanel() {
    $('.workspace').classList.remove('has-panel');
    $('#panel').hidden = true;
  }

  refreshDiffSelects() {
    const left = $('#diff-left');
    const right = $('#diff-right');
    if (!left || !right) return;
    const lv = left.value;
    const rv = right.value;
    left.innerHTML = '';
    right.innerHTML = '';
    for (const tab of this.tabs) {
      const opt1 = document.createElement('option');
      opt1.value = tab.path;
      opt1.textContent = tab.name;
      left.appendChild(opt1);
      const opt2 = opt1.cloneNode(true);
      right.appendChild(opt2);
    }
    left.value = lv && this.tabs.some((t) => t.path === lv) ? lv : this.tabs[0]?.path || '';
    right.value =
      rv && this.tabs.some((t) => t.path === rv)
        ? rv
        : this.tabs[1]?.path || this.tabs[0]?.path || '';
  }

  // ─── Console output ───────────────────────────────────────────────────

  appendConsole({ level, args }) {
    const out = $('#console-output');
    const row = document.createElement('div');
    row.className = 'console-line ' + (level || 'log');
    row.textContent = args.join(' ');
    out.appendChild(row);
    out.scrollTop = out.scrollHeight;
  }

  clearConsole() {
    $('#console-output').innerHTML = '';
  }

  // ─── Welcome screen ───────────────────────────────────────────────────

  bindWelcome() {
    for (const btn of document.querySelectorAll('[data-welcome]')) {
      btn.addEventListener('click', () => {
        const w = btn.dataset.welcome;
        if (w === 'new-file') this.newUntitledTab('untitled.js');
        else if (w === 'open-folder') this.openFolderFromDisk();
        else if (w === 'sample') this.loadSampleProject();
      });
    }
  }

  async loadSampleProject() {
    try {
      await this.fs.createDirectory?.('/sample');
    } catch {
      /* ignore */
    }
    const files = {
      '/sample/index.js':
        "import { greet } from './greet.js';\n\nconsole.log(greet('Code IDE'));\n",
      '/sample/greet.js': 'export function greet(name) {\n  return `Hello, ${name}!`;\n}\n',
      '/sample/notes.md': '# Sample Project\n\nThis project demonstrates multi-file editing.\n'
    };
    for (const [path, content] of Object.entries(files)) {
      try {
        await this.fs.createFile(path, content);
      } catch {
        await this.fs.writeFile(path, content);
      }
    }
    this.tree.invalidate(null);
    await this.tree.render();
    await this.openPath('/sample/index.js');
  }

  async openFromDisk() {
    if (this.fs.kind === 'os') {
      this.fs.openFileDialog?.(['js', 'ts', 'json', 'md', 'html', 'css', 'py', 'txt']);
      return;
    }
    return new Promise((resolve) => {
      const inp = $('#file-input');
      inp.value = '';
      inp.onchange = async () => {
        const file = inp.files?.[0];
        if (!file) return resolve();
        const text = await file.text();
        const path = '/__disk/' + file.name;
        try {
          await this.fs.createFile(path, text);
        } catch {
          await this.fs.writeFile(path, text);
        }
        this.tree.invalidate(null);
        await this.tree.render();
        await this.openPath(path);
        resolve();
      };
      inp.click();
    });
  }

  async openFolderFromDisk() {
    try {
      const fs = await openLocalFolder();
      this.fs = fs;
      this.tree.setFs(fs);
      await this.tree.render();
      this.updateStatusEnvironment();
      this.updateProjectLabel();
      this.toast(`Opened folder: ${fs.label}`, 'success');
    } catch (err) {
      if (err.name === 'AbortError') return;
      this.toast(err.message, 'error');
    }
  }

  async resetOrCloseProject() {
    if (this.fs.kind === 'local') {
      if (!window.confirm('Reset project to the default sample? Unsaved tabs will be lost.'))
        return;
      this.fs.resetProject();
      while (this.tabs.length) this.closeTab(this.tabs[0].path);
      this.tree.invalidate(null);
      await this.tree.render();
    } else if (this.fs.kind === 'fs-access') {
      this.fs = await createLocalFs();
      this.tree.setFs(this.fs);
      while (this.tabs.length) this.closeTab(this.tabs[0].path);
      await this.tree.render();
      this.updateStatusEnvironment();
      this.updateProjectLabel();
    }
  }

  // ─── HeymingOS messages ───────────────────────────────────────────────

  bindOsMessages() {
    window.addEventListener('message', async (e) => {
      const data = e.data || {};
      if (data.type === 'openFile') {
        const { content, fileName, path } = data;
        const targetPath = path || '/' + (fileName || 'untitled');
        const text = await this.normalizeContent(content);
        if (!this.host.hasModel(targetPath)) {
          this.host.openModel(targetPath, text, detectLanguage(fileName));
          this.tabs.push({
            path: targetPath,
            name: fileName || this.fs.baseName(targetPath),
            dirty: false
          });
        } else {
          this.host.setValue(targetPath, text);
        }
        this.setActive(targetPath);
      } else if (data.type === 'fileSaved') {
        const pending = this.pendingSaveAs;
        if (pending && data.success && data.path) {
          // Rename the active tab/model to the new path.
          this.host.renameModel(pending.oldPath, data.path);
          const tab = this.tabs.find((t) => t.path === pending.oldPath);
          if (tab) {
            tab.path = data.path;
            tab.name = data.fileName || this.fs.baseName(data.path);
            tab.isPlaceholder = false;
          }
          this.activePath = data.path;
          this.host.markSaved(data.path);
          this.renderTabs();
          this.toast(`Saved as ${tab?.name}`, 'success');
        }
        this.pendingSaveAs = null;
      } else if (data.type === 'filesystem-change') {
        // Refresh the tree if something we care about changed.
        this.tree.invalidate(null);
        this.tree.render();
      }
    });
  }

  async normalizeContent(content) {
    if (content == null) return '';
    if (typeof content === 'string') return content;
    if (content instanceof ArrayBuffer)
      return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(content));
    if (ArrayBuffer.isView(content)) {
      const u8 = new Uint8Array(content.buffer, content.byteOffset, content.byteLength);
      return new TextDecoder('utf-8', { fatal: false }).decode(u8);
    }
    return String(content);
  }

  bindFsChanges() {
    this.fs.onChange?.(() => {
      this.tree.invalidate(null);
      this.tree.render().then(() => {
        if (this.git) this.tree.setDecorations(this.git.decorations());
      });
      // Re-run git status (debounced inside the service).
      this.git?.refresh?.();
    });
  }

  // ─── Keyboard ─────────────────────────────────────────────────────────

  bindKeyboard() {
    document.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        this.saveActive();
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        this.saveActiveAs();
      } else if (mod && !e.shiftKey && e.key.toLowerCase() === 'n') {
        if (!e.target.closest('.monaco-editor')) {
          e.preventDefault();
          this.newUntitledTab();
        }
      } else if (e.key === 'F5') {
        e.preventDefault();
        this.runActive();
      } else if (mod && !e.shiftKey && e.key.toLowerCase() === 'p') {
        if (!e.target.closest('.monaco-editor')) {
          e.preventDefault();
          this.openQuickOpen();
        }
      } else if (e.key === 'Escape' && this.menuOpen) {
        this.menuOpen = null;
        this.dropdownEl.hidden = true;
      }
    });
  }

  // ─── Quick open palette ───────────────────────────────────────────────

  async openQuickOpen() {
    if (document.querySelector('.palette')) return;
    const backdrop = document.createElement('div');
    backdrop.className = 'palette-backdrop';
    const palette = document.createElement('div');
    palette.className = 'palette';
    palette.innerHTML = `<input placeholder="Go to file…" autofocus /><div class="results"></div>`;
    document.body.append(backdrop, palette);

    const input = palette.querySelector('input');
    const results = palette.querySelector('.results');

    const allFiles = await this.collectAllFiles();
    let active = 0;
    let visible = allFiles;

    const close = () => {
      backdrop.remove();
      palette.remove();
    };

    const render = () => {
      results.innerHTML = '';
      visible.slice(0, 50).forEach((f, i) => {
        const row = document.createElement('div');
        row.className = 'row' + (i === active ? ' active' : '');
        row.innerHTML = `<span>${this.fs.baseName(f)}</span><span class="path">${f}</span>`;
        row.addEventListener('click', () => {
          close();
          this.openPath(f);
        });
        results.appendChild(row);
      });
    };
    render();

    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      visible = q ? allFiles.filter((f) => f.toLowerCase().includes(q)) : allFiles;
      active = 0;
      render();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        close();
      } else if (e.key === 'ArrowDown') {
        active = Math.min(active + 1, visible.length - 1);
        render();
      } else if (e.key === 'ArrowUp') {
        active = Math.max(active - 1, 0);
        render();
      } else if (e.key === 'Enter') {
        const target = visible[active];
        if (target) {
          close();
          this.openPath(target);
        }
      }
    });
    backdrop.addEventListener('click', close);
    input.focus();
  }

  async collectAllFiles() {
    const out = [];
    const queue = [this.fs.root || '/'];
    let safety = 1000;
    while (queue.length && safety-- > 0) {
      const dir = queue.shift();
      let items;
      try {
        items = await this.fs.listDir(dir);
      } catch {
        continue;
      }
      for (const item of items) {
        if (item.isDirectory) queue.push(item.path);
        else out.push(item.path);
      }
    }
    return out.sort();
  }

  // ─── Sidebar tabs (Explorer / Source Control) ────────────────────────

  bindSidebarTabs() {
    for (const btn of document.querySelectorAll('.sidebar-tab')) {
      btn.addEventListener('click', () => this.activateSidebarView(btn.dataset.view));
    }
  }

  activateSidebarView(view) {
    const sidebar = $('#sidebar');
    sidebar.dataset.activeView = view;
    for (const tab of document.querySelectorAll('.sidebar-tab')) {
      tab.classList.toggle('active', tab.dataset.view === view);
    }
    for (const v of document.querySelectorAll('.sidebar-view')) {
      v.hidden = v.dataset.view !== view;
    }
  }

  // ─── Git / Source Control ─────────────────────────────────────────────

  makeScmHost() {
    const ide = this;
    return {
      hasRepo: () => !!ide.git?.getRoot(),
      open: (filepath) => ide.openPath(ide.fs.joinPath(ide.git.getRoot(), filepath)),
      openDiff: (filepath) => ide.openWorkingDiff(filepath),
      stage: async (f) => ide.runGitOp(() => ide.git.stage(f)),
      unstage: async (f) => ide.runGitOp(() => ide.git.unstage(f)),
      discard: async (f) => ide.runGitOp(() => ide.git.discard(f)),
      stageAll: async () => ide.runGitOp(() => ide.git.stageAll()),
      unstageAll: async () => ide.runGitOp(() => ide.git.unstageAll()),
      discardAll: async () => {
        const state = ide.git.getState();
        const targets = state.files.filter((f) => f.working).map((f) => f.filepath);
        for (const t of targets) await ide.git.discard(t);
      },
      commit: async (message) => {
        try {
          const oid = await ide.runGitOp(() => ide.git.commit(message));
          ide.toast(`Committed ${oid?.slice(0, 7) || ''}`, 'success');
        } catch (err) {
          ide.toast('Commit failed: ' + err.message, 'error');
        }
      },
      init: async () => {
        try {
          await ide.runGitOp(() => ide.git.init(ide.fs.root));
          ide.toast('Initialized empty git repository', 'success');
        } catch (err) {
          ide.toast('Init failed: ' + err.message, 'error');
        }
      },
      clone: async (url) => {
        try {
          ide.toast('Cloning…', 'info');
          await ide.runGitOp(() => ide.git.clone(url, ide.fs.root));
          ide.toast('Clone complete', 'success');
          ide.tree.invalidate(null);
          await ide.tree.render();
        } catch (err) {
          ide.toast('Clone failed: ' + err.message, 'error');
        }
      }
    };
  }

  async runGitOp(fn) {
    this.scm?.setBusy(true);
    try {
      const result = await fn();
      return result;
    } catch (err) {
      this.toast(err.message || String(err), 'error');
      throw err;
    } finally {
      this.scm?.setBusy(false);
    }
  }

  onGitState(state) {
    // Update SCM panel.
    if (this.scm) this.scm.setState(state);
    // Update tree decorations.
    if (this.tree && this.git) {
      this.tree.setDecorations(this.git.decorations());
    }
    // Update branch indicator + count badge on sidebar SCM tab.
    this.updateBranchIndicator(state);
  }

  updateBranchIndicator(state) {
    const btn = $('#status-branch');
    const name = $('#status-branch-name');
    const counts = $('#status-branch-counts');
    const badge = $('#scm-badge');
    if (!btn || !name || !counts || !badge) return;
    if (!this.git || !this.git.getRoot()) {
      btn.hidden = true;
      badge.hidden = true;
      return;
    }
    btn.hidden = false;
    name.textContent = state?.branch || 'detached';
    const total = state?.files?.length || 0;
    counts.textContent = total ? ` ${total}` : '';
    badge.hidden = total === 0;
    badge.textContent = String(total);
  }

  bindScmActions() {
    $('#status-branch').addEventListener('click', () => this.openBranchPicker());
    $('#scm-refresh').addEventListener('click', () => this.git.refresh());
    $('#scm-pull').addEventListener('click', async () => {
      try {
        this.toast('Pulling…', 'info');
        await this.runGitOp(() => this.git.pull());
        this.toast('Pull complete', 'success');
      } catch (err) {
        this.toast('Pull failed: ' + err.message, 'error');
      }
    });
    $('#scm-push').addEventListener('click', async () => {
      try {
        if (!this.git.getToken()) {
          const token = window.prompt(
            'GitHub Personal Access Token (used only this session):'
          );
          if (!token) return;
          this.git.setToken(token);
        }
        this.toast('Pushing…', 'info');
        await this.runGitOp(() => this.git.push());
        this.toast('Push complete', 'success');
      } catch (err) {
        this.toast('Push failed: ' + err.message, 'error');
      }
    });
    $('#scm-sync').addEventListener('click', async () => {
      try {
        await this.runGitOp(() => this.git.pull());
        if (this.git.getToken()) await this.runGitOp(() => this.git.push());
        this.toast('Sync complete', 'success');
      } catch (err) {
        this.toast('Sync failed: ' + err.message, 'error');
      }
    });
    $('#scm-more').addEventListener('click', (e) => this.showScmMoreMenu(e));
  }

  showScmMoreMenu(e) {
    document.querySelectorAll('.ctx-menu').forEach((el) => el.remove());
    const rect = e.currentTarget.getBoundingClientRect();
    const items = [
      {
        label: 'Initialize Repository…',
        action: async () => {
          await this.runGitOp(() => this.git.init(this.fs.root));
          this.toast('Initialized', 'success');
        }
      },
      {
        label: 'Clone Repository…',
        action: () => {
          const url = window.prompt('Repository URL:');
          if (url) this.scm?.host?.clone?.(url) || this.makeScmHost().clone(url);
        }
      },
      { sep: true },
      {
        label: 'Set GitHub Token…',
        action: () => {
          const token = window.prompt('GitHub Personal Access Token:');
          if (token != null) this.git.setToken(token);
        }
      },
      {
        label: 'Clear GitHub Token',
        action: () => {
          this.git.setToken('');
          this.toast('Token cleared', 'success');
        }
      },
      { sep: true },
      {
        label: 'Create Branch…',
        action: async () => {
          const name = window.prompt('New branch name:');
          if (!name) return;
          await this.runGitOp(() => this.git.createBranch(name));
          this.toast(`Created and switched to ${name}`, 'success');
        }
      },
      { label: 'Switch Branch…', action: () => this.openBranchPicker() }
    ];
    const menu = document.createElement('div');
    menu.className = 'ctx-menu';
    menu.style.left = rect.left + 'px';
    menu.style.top = rect.bottom + 'px';
    for (const item of items) {
      if (item.sep) {
        const sep = document.createElement('div');
        sep.className = 'sep';
        menu.appendChild(sep);
        continue;
      }
      const row = document.createElement('div');
      row.className = 'item';
      row.textContent = item.label;
      row.addEventListener('click', () => {
        menu.remove();
        try {
          item.action?.();
        } catch (err) {
          this.toast(err.message, 'error');
        }
      });
      menu.appendChild(row);
    }
    document.body.appendChild(menu);
    setTimeout(() => {
      const dismiss = (ev) => {
        if (!menu.contains(ev.target)) {
          menu.remove();
          document.removeEventListener('mousedown', dismiss);
        }
      };
      document.addEventListener('mousedown', dismiss);
    }, 0);
  }

  async openBranchPicker() {
    if (!this.git?.getRoot()) return;
    const branches = await this.git.listBranches();
    const current = await this.git.currentBranch();
    document.querySelectorAll('.palette, .palette-backdrop').forEach((el) => el.remove());
    const backdrop = document.createElement('div');
    backdrop.className = 'palette-backdrop';
    const palette = document.createElement('div');
    palette.className = 'palette';
    palette.innerHTML = `<input placeholder="Switch branch (or type new name + Enter to create)…" /><div class="results"></div>`;
    document.body.append(backdrop, palette);
    const input = palette.querySelector('input');
    const results = palette.querySelector('.results');
    let visible = branches.slice();
    let active = 0;
    const close = () => {
      backdrop.remove();
      palette.remove();
    };
    const render = () => {
      results.innerHTML = '';
      visible.forEach((b, i) => {
        const row = document.createElement('div');
        row.className = 'row' + (i === active ? ' active' : '');
        row.innerHTML = `<span>${b === current ? '✓ ' : ''}${b}</span><span class="path">branch</span>`;
        row.addEventListener('click', async () => {
          close();
          await this.runGitOp(() => this.git.checkout(b));
          this.toast(`Switched to ${b}`, 'success');
        });
        results.appendChild(row);
      });
    };
    render();
    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      visible = q ? branches.filter((b) => b.toLowerCase().includes(q)) : branches.slice();
      active = 0;
      render();
    });
    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowDown') {
        active = Math.min(active + 1, visible.length - 1);
        render();
      } else if (e.key === 'ArrowUp') {
        active = Math.max(active - 1, 0);
        render();
      } else if (e.key === 'Enter') {
        const target = visible[active];
        if (target) {
          close();
          await this.runGitOp(() => this.git.checkout(target));
          this.toast(`Switched to ${target}`, 'success');
        } else if (input.value.trim()) {
          const name = input.value.trim();
          close();
          await this.runGitOp(() => this.git.createBranch(name));
          this.toast(`Created and switched to ${name}`, 'success');
        }
      }
    });
    backdrop.addEventListener('click', close);
    input.focus();
  }

  /**
   * Open a working-vs-HEAD diff for the given filepath (relative to the repo
   * root). Replaces the editor in the main area with a diff editor, and
   * reuses a synthetic tab so the user can close it.
   */
  async openWorkingDiff(filepath) {
    if (!this.git?.getRoot()) return;
    const abs = this.fs.joinPath(this.git.getRoot(), filepath);
    const tabPath = '__diff__::' + abs;
    let entry = this.tabs.find((t) => t.path === tabPath);
    if (!entry) {
      entry = {
        path: tabPath,
        name: this.fs.baseName(abs) + ' (Working Tree)',
        dirty: false,
        kind: 'diff',
        sourcePath: abs,
        filepath
      };
      this.tabs.push(entry);
    }
    this.activePath = tabPath;
    try {
      const { head, working } = await this.git.diffAgainstHead(filepath);
      this.host.showMainDiff(
        head,
        working,
        detectLanguage(this.fs.baseName(abs)),
        `${this.fs.baseName(abs)} (HEAD)`,
        `${this.fs.baseName(abs)} (Working Tree)`
      );
    } catch (err) {
      this.toast('Diff failed: ' + err.message, 'error');
    }
    this.renderTabs();
    $('#welcome').classList.add('hidden');
  }

  // ─── Toast ─────────────────────────────────────────────────────────────

  toast(message, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    this.toastStack.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity 0.2s';
      setTimeout(() => el.remove(), 220);
    }, 2400);
  }
}

(async function main() {
  const ide = new CodeIDE();
  window.__codeIDE = ide;
  try {
    await ide.boot();
  } catch (err) {
    console.error('Failed to boot Code IDE', err);
    document.body.innerHTML = `<pre style="padding:24px;color:#f48771;background:#1e1e1e;height:100vh;margin:0;">Failed to boot Code IDE:\n\n${
      err.stack || err.message || err
    }</pre>`;
  }
})();

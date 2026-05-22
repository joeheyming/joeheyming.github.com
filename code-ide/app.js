/**
 * app.js — top-level orchestrator. Wires DOM, filesystem, editor, runner,
 * diff view, tree, status bar, command palette, and keyboard shortcuts.
 *
 * Source-control plumbing, the menu bar / context menus, and the quick-open
 * palette live in sibling files and get mixed into `CodeIDE.prototype` at
 * import time so the methods can keep using `this`.
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
import { scmMethods } from './scm-actions.js';
import { menuMethods } from './menus.js';
import { paletteMethods } from './palette.js';
import { createNotifier } from '/notifications.js';

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

    this._notifier = createNotifier({
      container: this.toastStack,
      kindClass: (k) => `toast ${k === 'warn' || k === 'error' || k === 'success' ? k : ''}`.trim(),
      defaultDurationMs: 2400,
      fadeOut: { outClass: 'toast-out', outMs: 220 }
    });

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

  // ─── Toast ─────────────────────────────────────────────────────────────

  toast(message, type = 'info') {
    this._notifier.notify(message, { kind: type });
  }
}

// Mix in the methods that live in sibling files. They use `this` like
// regular class methods, but live separately so the orchestrator file
// stays focused on boot + tabs + save/run/format + the bindings above.
Object.assign(CodeIDE.prototype, scmMethods, menuMethods, paletteMethods);

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

/**
 * Source-control plumbing for the Code IDE class. These methods live here
 * (rather than inside `app.js`) only to keep the orchestrator file small;
 * they're mixed into `CodeIDE.prototype` at boot via `Object.assign`, so
 * `this.git` / `this.scm` / `this.fs` / `this.toast` etc. are all the
 * same instance properties as in app.js.
 */

import { detectLanguage } from './editor.js';

const $ = (sel, root = document) => root.querySelector(sel);

export const scmMethods = {
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
  },

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
  },

  onGitState(state) {
    if (this.scm) this.scm.setState(state);
    if (this.tree && this.git) {
      this.tree.setDecorations(this.git.decorations());
    }
    this.updateBranchIndicator(state);
  },

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
  },

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
  },

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
  },

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
  },

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
};

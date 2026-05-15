/**
 * scm-view.js — Source Control sidebar view, modeled after VS Code.
 *
 * Layout:
 *   ┌──────────────────────────────────────────────┐
 *   │ SOURCE CONTROL  [↻] [⤓] [⤒] [⟲]             │  header + actions
 *   │ ┌────────────────────────────────────────┐  │
 *   │ │ Commit message…                        │  │  textarea
 *   │ └────────────────────────────────────────┘  │
 *   │ [✓ Commit]   [✓ Stage All] [✗ Discard All]  │
 *   │                                              │
 *   │ ▾ Staged Changes (n)                         │
 *   │   M  src/foo.js              [-]             │
 *   │   A  README.md               [-]             │
 *   │ ▾ Changes (n)                                │
 *   │   M  app.js                  [+] [↺]         │
 *   │   ?? new.txt                 [+] [↺]         │
 *   └──────────────────────────────────────────────┘
 *
 * Calls back into a host with these methods:
 *   open(filepath)            — open a file from the changes list
 *   diff(filepath)            — open a working-vs-HEAD diff for a file
 *   stage(filepath) / unstage / discard / stageAll / unstageAll / discardAll
 *   commit(message)
 *   pull / push / fetch / sync
 *   init / clone(url)
 */

const STATUS_LABEL = {
  M: 'Modified',
  A: 'Added',
  D: 'Deleted',
  '??': 'Untracked',
  '!': 'Conflict',
  R: 'Renamed'
};

export class ScmView {
  constructor(container, host) {
    this.container = container;
    this.host = host;
    this.lastState = null;
    this.commitMessage = '';
    this.expanded = { staged: true, working: true };
    this.busy = false;
    this.render();
  }

  setBusy(busy) {
    this.busy = busy;
    this.container.classList.toggle('busy', busy);
  }

  setState(state) {
    this.lastState = state;
    this.render();
  }

  render() {
    if (!this.container) return;
    const state = this.lastState;
    if (!state) {
      this.container.innerHTML = `
        <div class="scm-empty">
          <p>Loading…</p>
        </div>`;
      return;
    }
    if (state.error) {
      this.container.innerHTML = `
        <div class="scm-empty">
          <p>Couldn't read git status:</p>
          <pre>${escapeHtml(state.error)}</pre>
          <div class="scm-actions">
            <button class="btn" data-act="init">Initialize Repository</button>
            <button class="btn" data-act="clone">Clone…</button>
          </div>
        </div>`;
      this.bindEmptyActions();
      return;
    }
    if (!this.host.hasRepo()) {
      this.container.innerHTML = `
        <div class="scm-empty">
          <p>The current folder is not a git repository.</p>
          <div class="scm-actions">
            <button class="btn primary" data-act="init">Initialize Repository</button>
            <button class="btn" data-act="clone">Clone Repository…</button>
          </div>
        </div>`;
      this.bindEmptyActions();
      return;
    }

    const staged = state.files.filter((f) => f.staged);
    const working = state.files.filter((f) => f.working && !f.staged);
    const stagedSet = new Set(staged.map((f) => f.filepath));
    // A file can appear in BOTH lists (e.g. staged then re-modified). Show
    // the staged side under "Staged Changes" and the still-unstaged side
    // under "Changes" — VS Code does the same.
    const workingExtra = state.files.filter((f) => f.working && stagedSet.has(f.filepath));

    const canCommit = staged.length > 0 && this.commitMessage.trim().length > 0;

    this.container.innerHTML = `
      <div class="scm-commit">
        <textarea
          class="scm-msg"
          placeholder="Message (Ctrl+Enter to commit on '${escapeHtml(state.branch || 'detached')}')"
          rows="2">${escapeHtml(this.commitMessage)}</textarea>
        <div class="scm-buttons">
          <button class="btn primary" data-act="commit" ${canCommit ? '' : 'disabled'}>
            ✓ Commit
          </button>
          <div class="scm-button-row">
            <button class="btn small" data-act="stage-all" title="Stage all changes" ${working.length || workingExtra.length ? '' : 'disabled'}>＋ All</button>
            <button class="btn small" data-act="unstage-all" title="Unstage all" ${staged.length ? '' : 'disabled'}>− All</button>
            <button class="btn small" data-act="discard-all" title="Discard all changes" ${working.length || workingExtra.length ? '' : 'disabled'}>↺</button>
          </div>
        </div>
      </div>
      ${this.renderGroup('Staged Changes', 'staged', staged, true)}
      ${this.renderGroup('Changes', 'working', [...working, ...workingExtra], false)}
      ${
        staged.length === 0 && working.length === 0 && workingExtra.length === 0
          ? '<div class="scm-clean">Working tree clean. ✓</div>'
          : ''
      }
    `;

    this.bindCommitArea();
    this.bindGroups();
  }

  renderGroup(title, kind, files, isStaged) {
    if (files.length === 0) return '';
    const ex = this.expanded[kind] !== false;
    return `
      <div class="scm-group" data-group="${kind}">
        <div class="scm-group-header">
          <span class="chevron">${ex ? '▾' : '▸'}</span>
          <span class="title">${title}</span>
          <span class="count">${files.length}</span>
        </div>
        ${ex ? `<div class="scm-list">${files.map((f) => this.renderRow(f, isStaged)).join('')}</div>` : ''}
      </div>`;
  }

  renderRow(file, isStaged) {
    const code = isStaged ? file.staged : file.working;
    const label = STATUS_LABEL[code] || code;
    const buttons = isStaged
      ? `<button class="scm-act" data-act="unstage" data-path="${escapeAttr(file.filepath)}" title="Unstage">−</button>`
      : `
          <button class="scm-act" data-act="discard" data-path="${escapeAttr(file.filepath)}" title="Discard changes">↺</button>
          <button class="scm-act" data-act="stage" data-path="${escapeAttr(file.filepath)}" title="Stage">＋</button>
        `;
    return `
      <div class="scm-row" data-path="${escapeAttr(file.filepath)}" title="${escapeAttr(label)}">
        <span class="scm-name">${escapeHtml(basename(file.filepath))}</span>
        <span class="scm-dir">${escapeHtml(dirname(file.filepath))}</span>
        <span class="scm-row-actions">${buttons}</span>
        <span class="scm-code code-${cssCode(code)}" title="${label}">${escapeHtml(code)}</span>
      </div>`;
  }

  bindCommitArea() {
    const ta = this.container.querySelector('.scm-msg');
    if (ta) {
      ta.addEventListener('input', () => {
        this.commitMessage = ta.value;
        // Keep the commit button enable-state in sync without re-rendering
        // the entire DOM (and stealing focus from the textarea).
        const btn = this.container.querySelector('button[data-act="commit"]');
        if (btn) {
          const hasStaged = this.lastState?.files?.some((f) => f.staged);
          btn.disabled = !(hasStaged && this.commitMessage.trim().length > 0);
        }
      });
      ta.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          this.commit();
        }
      });
    }
    this.container.querySelectorAll('button[data-act]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const act = btn.dataset.act;
        switch (act) {
          case 'commit':
            this.commit();
            break;
          case 'stage-all':
            this.host.stageAll();
            break;
          case 'unstage-all':
            this.host.unstageAll();
            break;
          case 'discard-all':
            if (window.confirm('Discard all changes? This cannot be undone.')) {
              this.host.discardAll();
            }
            break;
          case 'init':
            this.host.init();
            break;
          case 'clone': {
            const url = window.prompt('Repository URL:');
            if (url) this.host.clone(url);
            break;
          }
        }
      });
    });
  }

  bindGroups() {
    this.container.querySelectorAll('.scm-group-header').forEach((h) => {
      h.addEventListener('click', () => {
        const kind = h.parentElement.dataset.group;
        this.expanded[kind] = !this.expanded[kind];
        this.render();
      });
    });
    this.container.querySelectorAll('.scm-row').forEach((row) => {
      row.addEventListener('click', () => {
        const filepath = row.dataset.path;
        if (filepath) this.host.openDiff(filepath);
      });
    });
    this.container.querySelectorAll('.scm-act').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const filepath = btn.dataset.path;
        const act = btn.dataset.act;
        if (act === 'stage') this.host.stage(filepath);
        else if (act === 'unstage') this.host.unstage(filepath);
        else if (act === 'discard') {
          if (window.confirm(`Discard changes to ${filepath}?`)) {
            this.host.discard(filepath);
          }
        }
      });
    });
  }

  bindEmptyActions() {
    this.container.querySelectorAll('button[data-act]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const act = btn.dataset.act;
        if (act === 'init') this.host.init();
        else if (act === 'clone') {
          const url = window.prompt('Repository URL:');
          if (url) this.host.clone(url);
        }
      });
    });
  }

  commit() {
    const msg = this.commitMessage.trim();
    if (!msg) return;
    this.host.commit(msg);
    this.commitMessage = '';
  }
}

// ── helpers ────────────────────────────────────────────────────────────────

function basename(p) {
  if (!p) return '';
  return p.slice(p.lastIndexOf('/') + 1);
}
function dirname(p) {
  if (!p) return '';
  const idx = p.lastIndexOf('/');
  return idx === -1 ? '' : p.slice(0, idx);
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[c]);
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/`/g, '&#96;');
}
function cssCode(code) {
  if (code === '??') return 'untracked';
  if (code === '!') return 'conflict';
  return (code || '').toLowerCase();
}

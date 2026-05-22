/**
 * ai-diff.js — Apply / Reject overlay for AI-proposed edits.
 *
 * When the AI calls `applyEdit` with `dryRun: true`, it returns the
 * proposed new file content as a `preview` string. We render that
 * against the current file using the existing `EditorHost.showMainDiff`
 * (the same Monaco diff editor used by the SCM "working vs HEAD" view)
 * and show a bar above the diff with Apply / Reject / "Open in Diff
 * panel" actions.
 *
 * Apply path:
 *   1. ide.fs.writeFile(path, preview)         — persist to disk.
 *   2. ide.host.setValue(path, preview)        — sync the Monaco buffer.
 *   3. ide.host.markSaved(path)                — clear dirty flag.
 *   4. hideMainDiff + reopen the file tab.
 *
 * Reject path:
 *   1. hideMainDiff.
 *   2. Reopen the file tab. Editor buffer untouched.
 *
 * The bar is created lazily and reused across edits.
 */

import { detectLanguage } from './editor.js';

const BAR_ID = 'ai-diff-bar';

function detectLanguageFromPath(path) {
  // detectLanguage in editor.js is built for filename-only too — pass
  // the path as-is and it pops the basename.
  return detectLanguage(String(path || ''));
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function ensureBarMount(container) {
  let bar = document.getElementById(BAR_ID);
  if (bar) return bar;
  bar = document.createElement('div');
  bar.id = BAR_ID;
  bar.className = 'ai-diff-bar';
  bar.hidden = true;
  bar.innerHTML = `
    <div class="ai-diff-bar-left">
      <span class="ai-diff-icon">✨</span>
      <div class="ai-diff-bar-meta">
        <div class="ai-diff-bar-title"></div>
        <div class="ai-diff-bar-path"></div>
      </div>
    </div>
    <div class="ai-diff-bar-right">
      <button class="ai-diff-btn ai-diff-reject" type="button">Reject</button>
      <button class="ai-diff-btn ai-diff-apply" type="button">Apply</button>
    </div>
  `;
  container.appendChild(bar);
  return bar;
}

export class AiDiffController {
  /**
   * @param {{ ide: any }} opts
   */
  constructor(opts) {
    this.ide = opts.ide;
    /** @type {{ path: string, original: string, proposed: string, summary: string, originalLanguage?: string } | null} */
    this.pending = null;
    this._bar = null;
  }

  _container() {
    return document.querySelector('.editor-container') || document.body;
  }

  _setBarVisible(visible) {
    const container = this._container();
    if (container?.classList) {
      container.classList.toggle('has-ai-diff-bar', visible);
    }
  }

  _ensureBar() {
    if (this._bar) return this._bar;
    this._bar = ensureBarMount(this._container());
    const reject = this._bar.querySelector('.ai-diff-reject');
    const apply = this._bar.querySelector('.ai-diff-apply');
    reject?.addEventListener('click', () => this.reject());
    apply?.addEventListener('click', () => this.apply());
    return this._bar;
  }

  /** Is there an unresolved AI edit waiting for the user? */
  hasPending() {
    return !!this.pending;
  }

  /**
   * Open a diff for an AI-proposed write. If another is already
   * pending, the previous one is silently rejected (treated as
   * superseded).
   *
   * @param {{
   *   path: string,
   *   original: string,
   *   proposed: string,
   *   summary?: string,
   *   kind?: 'edit' | 'create'
   * }} edit
   */
  show(edit) {
    if (!edit || typeof edit.path !== 'string') {
      console.warn('[code-ide:ai:diff] show called with no valid edit', { edit });
      return;
    }
    if (this.pending) this._closeWithoutCommit({ silent: true });

    const kind = edit.kind === 'create' ? 'create' : 'edit';

    let language;
    if (kind === 'create') {
      language = detectLanguageFromPath(edit.path);
    } else {
      language = this.ide.host.getLanguage(edit.path) || detectLanguageFromPath(edit.path);
    }

    console.log('[code-ide:ai:diff] showing proposal', {
      path: edit.path,
      kind,
      language,
      originalSize: (edit.original || '').length,
      proposedSize: (edit.proposed || '').length
    });

    this.pending = {
      path: edit.path,
      original: edit.original,
      proposed: edit.proposed,
      summary: edit.summary || (kind === 'create' ? 'New file proposed' : 'Proposed edit'),
      kind,
      originalLanguage: language
    };

    const leftTitle = kind === 'create' ? `(new file)` : `${edit.path} (current)`;
    const rightTitle = `${edit.path} (proposed)`;
    const diffEditor = this.ide.host.showMainDiff(
      edit.original,
      edit.proposed,
      language,
      leftTitle,
      rightTitle
    );
    if (!diffEditor) {
      console.error(
        '[code-ide:ai:diff] showMainDiff returned null — Monaco diff did NOT mount. ' +
          'Likely cause: #diff-main container missing from DOM, or EditorHost not initialized.'
      );
    }
    // Hide the welcome splash. Without this, when no file tab is open
    // the welcome panel stacks on top of #diff-main with position:absolute
    // and visually covers the diff — the bar at the bottom shows but the
    // user sees "no diff appeared".
    try {
      const welcome = document.getElementById('welcome');
      if (welcome && !welcome.classList.contains('hidden')) {
        welcome.classList.add('hidden');
        console.log('[code-ide:ai:diff] hid #welcome so diff is visible');
      }
    } catch {
      /* welcome panel is optional */
    }

    const bar = this._ensureBar();
    const icon = bar.querySelector('.ai-diff-icon');
    const title = bar.querySelector('.ai-diff-bar-title');
    const path = bar.querySelector('.ai-diff-bar-path');
    const applyBtn = bar.querySelector('.ai-diff-apply');
    if (icon) icon.textContent = kind === 'create' ? '🆕' : '✨';
    if (title) title.textContent = this.pending.summary;
    if (path) path.innerHTML = `<code>${escapeHtml(edit.path)}</code>`;
    if (applyBtn) applyBtn.textContent = kind === 'create' ? 'Create' : 'Apply';
    bar.hidden = false;
    bar.classList.add('visible');
    this._setBarVisible(true);
    console.log('[code-ide:ai:diff] proposal bar visible', { path: edit.path, kind });
  }

  /**
   * Apply the pending write: persist to disk, sync Monaco for any
   * existing model, refresh the file tree, open the file in a tab,
   * and notify the user.
   */
  async apply() {
    const p = this.pending;
    if (!p) return;
    try {
      const isCreate = p.kind === 'create';
      // For edits with an open Monaco buffer, sync first so the editor
      // shows the new content the moment we hide the diff.
      if (!isCreate && this.ide.host.hasModel(p.path)) {
        this.ide.host.setValue(p.path, p.proposed);
      }
      // Persist to disk. createFile uses fs.createFile when present
      // (some adapters distinguish create-vs-overwrite); writeFile is
      // the universal fallback and what the embedded OS adapter uses
      // either way.
      if (isCreate && typeof this.ide.fs.createFile === 'function') {
        try {
          await this.ide.fs.createFile(p.path, p.proposed);
        } catch (err) {
          // Fallback: writeFile creates-or-overwrites in every adapter.
          await this.ide.fs.writeFile(p.path, p.proposed);
        }
      } else {
        await this.ide.fs.writeFile(p.path, p.proposed);
      }
      if (this.ide.host.hasModel(p.path)) {
        this.ide.host.markSaved(p.path);
      }
      // Refresh the file tree so the new file appears.
      if (isCreate) {
        try {
          this.ide.tree?.invalidate?.(null);
          await this.ide.tree?.render?.();
        } catch {
          /* tree refresh is best-effort */
        }
      }
      this._closeWithoutCommit({ silent: true });
      try {
        await this.ide.openPath(p.path);
      } catch {
        /* tab may not exist; that's fine */
      }
      const verb = isCreate ? 'Created' : 'Applied AI edit to';
      this.ide.toast?.(`${verb} ${this.ide.fs.baseName(p.path)}`, 'success');
    } catch (err) {
      this.ide.toast?.(
        `${this.pending?.kind === 'create' ? 'Create' : 'Apply'} failed: ${
          err && err.message ? err.message : String(err)
        }`,
        'error'
      );
    }
  }

  /** Reject the pending write. No-op if nothing pending. */
  reject() {
    if (!this.pending) return;
    const path = this.pending.path;
    const wasCreate = this.pending.kind === 'create';
    this._closeWithoutCommit({ silent: true });
    if (!wasCreate) {
      // Reopen the file tab so the editor isn't stuck on a hidden diff.
      this.ide.openPath?.(path).catch(() => {});
    }
    this.ide.toast?.(wasCreate ? 'Discarded proposed file' : 'Rejected AI edit', 'info');
  }

  _closeWithoutCommit({ silent }) {
    this.pending = null;
    try {
      this.ide.host.hideMainDiff();
    } catch (err) {
      if (!silent) console.warn('[code-ide:ai] hideMainDiff threw', err);
    }
    if (this._bar) {
      this._bar.hidden = true;
      this._bar.classList.remove('visible');
    }
    this._setBarVisible(false);
  }

  /**
   * Hard-cancel: discard pending without notifying. Used during teardown.
   */
  cancel() {
    if (!this.pending) return;
    this._closeWithoutCommit({ silent: true });
  }
}

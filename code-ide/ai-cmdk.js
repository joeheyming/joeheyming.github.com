/**
 * ai-cmdk.js — Cmd+K inline-edit floating prompt.
 *
 * Cursor-style UX: select code in the editor, press ⌘K (or Ctrl+K),
 * a small centered modal appears with a single text input "Edit
 * selection". User types "extract this into a function", presses
 * Enter, and the on-device model proposes an `applyEdit` dry-run.
 * The IDE renders the diff in the main editor area with Apply / Reject
 * buttons (via AiDiffController).
 *
 * Cmd+K conversations are single-shot — each invocation gets a fresh
 * conversation history. The side-panel chat (ai-panel.js) is for
 * multi-turn dialogue; this is for "do the thing" inline edits.
 */

import { getAiEngine } from './ai-engine.js';
import {
  createIdeToolCtx,
  snapshotActiveFile,
  pickLastWriteProposal
} from './ai-context.js';

export class AiCmdKController {
  /**
   * @param {{
   *   ide: any,
   *   diffController: import('./ai-diff.js').AiDiffController,
   *   isEmbedded: boolean,
   *   onRequestPanelOpen?: () => void
   * }} opts
   */
  constructor(opts) {
    this.ide = opts.ide;
    this.diff = opts.diffController;
    this.isEmbedded = opts.isEmbedded;
    this.onRequestPanelOpen = opts.onRequestPanelOpen || (() => {});
    this.engine = getAiEngine();

    /** @type {HTMLElement|null} */
    this._backdrop = null;
    /** @type {HTMLElement|null} */
    this._modal = null;
    /** @type {AbortController|null} */
    this._currentTurn = null;

    this.toolCtx = createIdeToolCtx({
      ide: this.ide,
      isEmbedded: this.isEmbedded,
      getActiveFile: () =>
        snapshotActiveFile(this.ide, { includeContent: true, includeSelection: true })
    });
  }

  isOpen() {
    return !!this._backdrop;
  }

  /**
   * Open the Cmd+K prompt. If there's no active file, show a toast and
   * bail — Cmd+K only makes sense when there's a buffer to edit.
   */
  open() {
    if (this.isOpen()) {
      this._modal?.querySelector('input')?.focus();
      return;
    }
    if (!this.ide.activePath) {
      this.ide.toast?.('Open a file first to use AI inline edit.', 'warn');
      return;
    }

    const snapshot = snapshotActiveFile(this.ide, {
      includeContent: false,
      includeSelection: true
    });
    const selection = snapshot && snapshot.selection ? snapshot.selection : null;

    this._mount(selection);
  }

  close() {
    this._currentTurn?.abort();
    this._currentTurn = null;
    if (this._backdrop) this._backdrop.remove();
    if (this._modal) this._modal.remove();
    this._backdrop = null;
    this._modal = null;
  }

  _mount(selection) {
    const backdrop = document.createElement('div');
    backdrop.className = 'palette-backdrop ai-cmdk-backdrop';

    const modal = document.createElement('div');
    modal.className = 'palette ai-cmdk';

    const path = this.ide.activePath;
    const baseName = this.ide.fs.baseName(path);

    const selectionLabel = selection && selection.range
      ? `Selection: lines ${selection.range.startLine}–${selection.range.endLine}`
      : 'No selection (will edit the whole file)';

    modal.innerHTML = `
      <div class="ai-cmdk-header">
        <span class="ai-cmdk-icon">✨</span>
        <span class="ai-cmdk-target"><code>${escapeHtml(baseName)}</code></span>
        <span class="ai-cmdk-selection">${escapeHtml(selectionLabel)}</span>
      </div>
      <input
        type="text"
        class="ai-cmdk-input"
        placeholder="Describe the edit (e.g. add error handling)…"
        autocomplete="off"
        spellcheck="false"
      />
      <div class="ai-cmdk-status" data-role="status"></div>
      <div class="ai-cmdk-hint">
        <span><kbd>Enter</kbd> propose edit</span>
        <span><kbd>Esc</kbd> cancel</span>
      </div>
    `;

    document.body.appendChild(backdrop);
    document.body.appendChild(modal);
    this._backdrop = backdrop;
    this._modal = modal;

    const input = modal.querySelector('input');
    const status = modal.querySelector('[data-role="status"]');

    backdrop.addEventListener('click', () => this.close());
    document.addEventListener('keydown', this._onKey, true);

    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        const value = input.value.trim();
        if (!value) return;
        this._submit(value, status);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    });

    setTimeout(() => input?.focus(), 0);
  }

  _onKey = (e) => {
    if (e.key === 'Escape' && this.isOpen()) {
      this.close();
    }
  };

  async _submit(prompt, statusEl) {
    if (!this.engine.isReady()) {
      if (statusEl) statusEl.textContent = 'Loading model… this may take a moment on first run.';
      try {
        await this.engine.ensureModel();
      } catch (err) {
        if (statusEl) {
          statusEl.textContent = err && err.message ? err.message : 'Model load failed.';
        }
        return;
      }
    }

    const input = this._modal?.querySelector('input');
    if (input) /** @type {HTMLInputElement} */ (input).disabled = true;
    if (statusEl) statusEl.textContent = 'Asking the model…';

    const controller = new AbortController();
    this._currentTurn = controller;

    /** @type {Array<object>} */
    const history = [];

    let finalText = '';

    try {
      // Wrap the user's prompt with a per-turn nudge that pushes the
      // model toward applyEdit. Hermes-3 + WebLLM occasionally answers
      // in prose ("Sure, here's how I would refactor it…") instead of
      // emitting a structured tool call. The wrap is added to the wire
      // text only, so the user doesn't see it.
      const userText = `${prompt}

[System reminder: this is a Cmd+K inline-edit request. Respond by
calling the applyEdit tool with dryRun: true. Do not write the proposed
code in chat; the IDE will render the diff to the user from your tool
call. If the request is ambiguous, pick the most reasonable
interpretation rather than asking back.]`;

      await this.engine.runTurn({
        history,
        userText,
        toolCtx: this.toolCtx,
        signal: controller.signal,
        onAssistantDelta: ({ content }) => {
          if (typeof content === 'string') finalText += content;
        }
      });

      const showed = this._tryShowProposedEdit(history);
      this.close();
      if (!showed) {
        // The model didn't produce an applyEdit. Surface its prose to
        // the user via a toast so they're not staring at nothing.
        const summary = finalText.trim().slice(0, 200) || 'No edit proposed.';
        this.ide.toast?.(summary, 'info');
      }
    } catch (err) {
      if (err && err.name === 'AbortError') {
        if (statusEl) statusEl.textContent = 'Stopped.';
      } else {
        const msg = err && err.message ? err.message : String(err);
        if (statusEl) statusEl.textContent = `Error: ${msg}`;
      }
      if (input) /** @type {HTMLInputElement} */ (input).disabled = false;
    } finally {
      this._currentTurn = null;
    }
  }

  /**
   * Walk a Cmd+K turn's history, find the latest write-tool (applyEdit
   * or createFile) dry-run, and route it to the diff controller.
   * Returns true on success.
   *
   * @param {Array<object>} history
   */
  _tryShowProposedEdit(history) {
    const proposal = pickLastWriteProposal(history, (path) => {
      try {
        return this.ide.host.hasModel(path) ? this.ide.host.getValue(path) : '';
      } catch {
        return null;
      }
    });
    if (!proposal) return false;
    this.diff.show({
      path: proposal.path,
      original: proposal.original,
      proposed: proposal.proposed,
      summary: describeProposal(proposal),
      kind: proposal.kind
    });
    return true;
  }
}

function describeProposal(proposal) {
  if (!proposal) return 'Proposed edit';
  if (proposal.kind === 'create') return 'New file proposed';
  const n = proposal.editCount || 0;
  if (n <= 0) return 'Proposed edit';
  if (n === 1) return '1 edit proposed';
  return `${n} edits proposed`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

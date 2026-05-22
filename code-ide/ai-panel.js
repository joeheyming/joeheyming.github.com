/**
 * ai-panel.js — the Assistant side panel inside Code IDE.
 *
 * UI flow:
 *   - The panel mounts into one of the right-column `.panel-view`
 *     divs, alongside Console and Diff.
 *   - On first open, if the on-device model isn't cached yet, we
 *     show an Install gate (Hermes-3-Llama-3.1-8B, ~4.5 GB into OPFS).
 *   - Once ready, the user can chat. We display the conversation as
 *     bubbles + tool-call cards.
 *   - When the model proposes a code edit via the `applyEdit` tool,
 *     we intercept the dry-run result, render it as a Monaco diff
 *     in the main editor area (via AiDiffController), and let the
 *     user click Apply or Reject.
 *
 * History is in-memory only — opening the panel in a new session
 * starts a fresh conversation. (The standalone /chat/ surface
 * persists; this one deliberately does not, because the relevant
 * context is the open file, which changes with the IDE.)
 */

import { getAiEngine } from './ai-engine.js';
import {
  createIdeToolCtx,
  snapshotActiveFile,
  pickLastWriteProposal
} from './ai-context.js';

/**
 * @typedef {Object} HistoryMessage
 * @property {'user'|'assistant'|'system'|'tool'} role
 * @property {string} content
 * @property {Array<{ id: string, type: string, function: { name: string, arguments: string }}>} [tool_calls]
 * @property {string} [tool_call_id]
 * @property {string} [name]
 */

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Light-weight markdown renderer — code fences, inline code, paragraphs.
 * Avoid pulling in marked/DOMPurify here; chat panel users tend to
 * paste short prose and short code, and the model already knows we
 * have Monaco for the heavy diff lifting.
 */
function renderMarkdown(text) {
  const t = String(text || '');
  // Pull out fenced code blocks first so we don't paragraph-wrap them.
  const blocks = [];
  let placeholder = (i) => `\u0000FENCE${i}\u0000`;
  const stripped = t.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (_m, lang, body) => {
    const idx = blocks.length;
    blocks.push({ lang, body });
    return placeholder(idx);
  });
  // Inline code.
  let html = stripped.replace(/`([^`\n]+)`/g, (_m, body) => `<code>${escapeHtml(body)}</code>`);
  // Paragraphs (split on blank lines).
  html = html
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
  // Restore code blocks.
  html = html.replace(/\u0000FENCE(\d+)\u0000/g, (_m, idx) => {
    const b = blocks[Number(idx)];
    return `<pre class="ai-code"><code class="lang-${escapeHtml(b.lang || '')}">${escapeHtml(
      b.body
    )}</code></pre>`;
  });
  // Code blocks landed inside <p> tags after the placeholder dance —
  // fix that so the layout doesn't break.
  html = html.replace(/<p>(<pre class="ai-code">[\s\S]*?<\/pre>)<\/p>/g, '$1');
  return html;
}

export class AiPanelController {
  /**
   * @param {{
   *   ide: any,
   *   container: HTMLElement,
   *   diffController: import('./ai-diff.js').AiDiffController,
   *   isEmbedded: boolean
   * }} opts
   */
  constructor(opts) {
    this.ide = opts.ide;
    this.container = opts.container;
    this.diff = opts.diffController;
    this.isEmbedded = opts.isEmbedded;
    this.engine = getAiEngine();

    /** @type {HistoryMessage[]} */
    this.history = [];

    /** @type {AbortController|null} */
    this._currentTurn = null;
    /** @type {boolean} */
    this._busy = false;

    this.toolCtx = createIdeToolCtx({
      ide: this.ide,
      isEmbedded: this.isEmbedded,
      getActiveFile: () =>
        snapshotActiveFile(this.ide, { includeContent: true, includeSelection: true })
    });

    this._render();
    this._bindEngineEvents();
  }

  _render() {
    this.container.innerHTML = `
      <div class="ai-panel">
        <div class="ai-panel-toolbar">
          <span class="ai-panel-title">AI Assistant</span>
          <span class="ai-panel-status" data-role="status"></span>
          <button class="ai-icon-btn" data-action="new" title="New chat">＋</button>
        </div>
        <div class="ai-panel-body" data-role="body">
          <div class="ai-install" data-role="install" hidden>
            <div class="ai-install-headline">On-device AI assistant</div>
            <p class="ai-install-blurb">
              Code IDE's AI runs entirely in your browser on your GPU. No cloud,
              no API key — but the first run downloads
              <strong>Hermes-3-Llama-3.1-8B</strong>
              (~4.5&nbsp;GB) into your browser's OPFS cache. After that it's
              instant and offline.
            </p>
            <div class="ai-install-progress" data-role="progress"></div>
            <button class="ai-install-btn" data-action="install" type="button">
              Install on-device model
            </button>
            <p class="ai-install-fineprint" data-role="install-error"></p>
          </div>
          <div class="ai-empty" data-role="empty">
            <div class="ai-empty-headline">Try asking…</div>
            <ul class="ai-empty-suggestions">
              <li data-suggestion="Explain what the active file does">Explain what the active file does</li>
              <li data-suggestion="Add a JSDoc comment to the top of this file">Add a JSDoc comment to the top of this file</li>
              <li data-suggestion="Extract the selection into a function">Extract the selection into a function</li>
              <li data-suggestion="Add error handling here">Add error handling here</li>
            </ul>
            <p class="ai-empty-tip">
              Tip: select code and press <kbd>⌘K</kbd> / <kbd>Ctrl+K</kbd> for inline edits.
            </p>
          </div>
          <div class="ai-messages" data-role="messages"></div>
        </div>
        <form class="ai-composer" data-role="composer">
          <textarea
            class="ai-input"
            data-role="input"
            rows="2"
            placeholder="Ask anything about your code…"
          ></textarea>
          <div class="ai-composer-actions">
            <button class="ai-send" type="submit" data-role="send" title="Send (Enter)">Send</button>
            <button class="ai-stop" type="button" data-role="stop" hidden title="Stop">Stop</button>
          </div>
        </form>
      </div>
    `;

    this._els = {
      install: this.container.querySelector('[data-role="install"]'),
      installBtn: this.container.querySelector('[data-action="install"]'),
      installError: this.container.querySelector('[data-role="install-error"]'),
      progress: this.container.querySelector('[data-role="progress"]'),
      empty: this.container.querySelector('[data-role="empty"]'),
      messages: this.container.querySelector('[data-role="messages"]'),
      composer: this.container.querySelector('[data-role="composer"]'),
      input: this.container.querySelector('[data-role="input"]'),
      send: this.container.querySelector('[data-role="send"]'),
      stop: this.container.querySelector('[data-role="stop"]'),
      status: this.container.querySelector('[data-role="status"]'),
      newBtn: this.container.querySelector('[data-action="new"]')
    };

    this._els.installBtn?.addEventListener('click', () => this._startInstall());
    this._els.composer?.addEventListener('submit', (e) => {
      e.preventDefault();
      this._handleSendClick();
    });
    this._els.stop?.addEventListener('click', () => this.stopCurrentTurn());
    this._els.newBtn?.addEventListener('click', () => this.newChat());
    this._els.input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        this._handleSendClick();
      }
    });
    this._els.input?.addEventListener('input', () => this._autoresize());
    this.container.addEventListener('click', (e) => {
      const target = /** @type {HTMLElement} */ (e.target);
      if (target && target.matches('[data-suggestion]')) {
        const text = target.getAttribute('data-suggestion') || '';
        if (this._els.input) {
          this._els.input.value = text;
          this._els.input.focus();
          this._autoresize();
        }
      }
    });

    this._refreshGate();
  }

  _bindEngineEvents() {
    this.engine.onProgress((p) => {
      if (this._els.progress) {
        const pct = Math.round((p.progress || 0) * 100);
        this._els.progress.textContent = pct >= 1 ? `${pct}% — ${p.text || ''}` : p.text || '';
      }
    });
    this.engine.onStatusChange((status, error) => {
      this._refreshGate();
      if (status === 'error' && error) {
        if (this._els.installError) this._els.installError.textContent = error;
      }
    });
  }

  _refreshGate() {
    if (!this._els.install) return;
    if (this.engine.isReady()) {
      this._els.install.hidden = true;
      this._els.composer.hidden = false;
      this._els.empty.hidden = this.history.length > 0;
      this._setStatus('Ready');
    } else if (this.engine.isLoading()) {
      this._els.install.hidden = false;
      this._els.composer.hidden = true;
      this._els.empty.hidden = true;
      this._els.installBtn.disabled = true;
      this._els.installBtn.textContent = 'Installing…';
      this._setStatus('Loading model…');
    } else {
      this._els.install.hidden = false;
      this._els.composer.hidden = true;
      this._els.empty.hidden = true;
      this._els.installBtn.disabled = false;
      this._els.installBtn.textContent = 'Install on-device model';
      this._setStatus(this.engine.lastError ? 'Error' : 'Not loaded');
    }
  }

  _setStatus(text) {
    if (this._els.status) this._els.status.textContent = text;
  }

  async _startInstall() {
    if (this._els.installError) this._els.installError.textContent = '';
    try {
      await this.engine.ensureModel();
    } catch (err) {
      // _refreshGate already shows the error via onStatusChange.
      console.warn('[code-ide:ai] model install failed', err);
    }
  }

  _autoresize() {
    const ta = this._els.input;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(180, ta.scrollHeight) + 'px';
  }

  newChat() {
    this.stopCurrentTurn();
    this.history = [];
    if (this._els.messages) this._els.messages.innerHTML = '';
    if (this._els.empty) this._els.empty.hidden = false;
  }

  stopCurrentTurn() {
    if (this._currentTurn) {
      try {
        this._currentTurn.abort();
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * Send a user message. Public so Cmd+K can hand off "convert this
   * selection-only edit into a full chat turn" if the user opens the
   * panel afterwards.
   *
   * @param {string} text
   */
  async send(text) {
    const userText = String(text || '').trim();
    if (!userText) return;
    if (!this.engine.isReady()) {
      try {
        await this.engine.ensureModel();
      } catch {
        return;
      }
    }
    if (this._busy) return;

    this._busy = true;
    if (this._els.empty) this._els.empty.hidden = true;
    this._renderUserBubble(userText);

    if (this._els.input) {
      this._els.input.value = '';
      this._autoresize();
    }
    if (this._els.send) this._els.send.disabled = true;
    if (this._els.stop) this._els.stop.hidden = false;
    this._setStatus('Thinking…');

    const controller = new AbortController();
    this._currentTurn = controller;

    /** @type {HTMLElement|null} */
    let assistantBubble = null;
    /** @type {string} */
    let assistantBuffer = '';

    /** @type {Map<string, HTMLElement>} */
    const toolCards = new Map();

    try {
      await this.engine.runTurn({
        history: this.history,
        userText,
        toolCtx: this.toolCtx,
        signal: controller.signal,
        onAssistantMessageStart: () => {
          assistantBuffer = '';
          assistantBubble = this._renderAssistantBubble('');
        },
        onAssistantDelta: ({ content }) => {
          if (typeof content !== 'string' || !content) return;
          assistantBuffer += content;
          if (assistantBubble) {
            assistantBubble.innerHTML = renderMarkdown(assistantBuffer);
            this._scrollToBottom();
          }
        },
        onAssistantMessageEnd: () => {
          if (assistantBubble && assistantBuffer.trim() === '') {
            assistantBubble.remove();
          }
          assistantBubble = null;
        },
        onAssistantTextRetracted: () => {
          if (assistantBubble) assistantBubble.remove();
          assistantBubble = null;
          assistantBuffer = '';
        },
        onToolEvent: (event) => {
          this._renderToolEvent(event, toolCards);
        }
      });

      // After the turn settles, scan the history for the most recent
      // applyEdit dry-run preview and route it to the diff controller.
      this._maybeShowProposedEdit();
    } catch (err) {
      const msg =
        err && err.name === 'AbortError'
          ? '_aborted'
          : err && err.message
          ? err.message
          : String(err);
      if (msg !== '_aborted') {
        this._renderSystemNote(`Error: ${msg}`);
      } else {
        this._renderSystemNote('Stopped.');
      }
    } finally {
      this._currentTurn = null;
      this._busy = false;
      if (this._els.send) this._els.send.disabled = false;
      if (this._els.stop) this._els.stop.hidden = true;
      this._setStatus('Ready');
    }
  }

  _handleSendClick() {
    const text = this._els.input ? this._els.input.value : '';
    this.send(text);
  }

  _renderUserBubble(text) {
    if (!this._els.messages) return;
    const div = document.createElement('div');
    div.className = 'ai-msg ai-msg-user';
    div.innerHTML = `<div class="ai-bubble">${renderMarkdown(text)}</div>`;
    this._els.messages.appendChild(div);
    this._scrollToBottom();
  }

  /** @returns {HTMLElement|null} the bubble inner element for streaming updates */
  _renderAssistantBubble(initial) {
    if (!this._els.messages) return null;
    const wrap = document.createElement('div');
    wrap.className = 'ai-msg ai-msg-asst';
    wrap.innerHTML = `<div class="ai-bubble">${renderMarkdown(initial)}</div>`;
    this._els.messages.appendChild(wrap);
    this._scrollToBottom();
    return wrap.querySelector('.ai-bubble');
  }

  _renderSystemNote(text) {
    if (!this._els.messages) return;
    const div = document.createElement('div');
    div.className = 'ai-msg ai-msg-sys';
    div.textContent = text;
    this._els.messages.appendChild(div);
    this._scrollToBottom();
  }

  _renderToolEvent(event, toolCards) {
    if (!this._els.messages) return;
    let card = toolCards.get(event.id);
    if (!card) {
      card = document.createElement('div');
      card.className = 'ai-tool';
      card.innerHTML = `
        <span class="ai-tool-name"></span>
        <span class="ai-tool-status"></span>
      `;
      this._els.messages.appendChild(card);
      toolCards.set(event.id, card);
    }
    const nameEl = card.querySelector('.ai-tool-name');
    const statusEl = card.querySelector('.ai-tool-status');
    if (nameEl) nameEl.textContent = friendlyToolName(event.name);
    if (statusEl) {
      if (event.phase === 'started') statusEl.textContent = 'running…';
      else if (event.phase === 'completed') statusEl.textContent = 'done';
      else if (event.phase === 'failed') {
        statusEl.textContent = 'failed';
        card.classList.add('failed');
        if (event.error) statusEl.title = event.error;
      }
    }
    if (event.phase === 'completed') card.classList.add('completed');
    this._scrollToBottom();
  }

  /**
   * Look back through `this.history` for a write-tool dry-run result
   * (applyEdit or createFile) and route it to the diff controller.
   *
   * Edge cases:
   *   - Multiple write calls in a turn: pick the LAST one.
   *   - dryRun: false: skipped (already committed; the IDE is the
   *     source of truth for that, the model should never call it).
   *   - tool error: skipped (the model sees the error and may try
   *     again on the next turn).
   */
  _maybeShowProposedEdit() {
    console.log('[code-ide:ai:panel] _maybeShowProposedEdit start', {
      historyLength: this.history.length,
      hasDiffController: !!this.diff
    });
    const proposal = pickLastWriteProposal(this.history, (path) => {
      try {
        return this.ide.host.hasModel(path) ? this.ide.host.getValue(path) : '';
      } catch (err) {
        console.warn('[code-ide:ai:panel] readBuffer threw', { path, error: err && err.message });
        return null;
      }
    });
    if (!proposal) {
      console.log(
        '[code-ide:ai:panel] no proposal to show — turn ended without a write to preview'
      );
      return;
    }
    if (!this.diff) {
      console.error(
        '[code-ide:ai:panel] HAVE a proposal but NO diffController — cannot show diff',
        { path: proposal.path, kind: proposal.kind }
      );
      return;
    }
    console.log('[code-ide:ai:panel] dispatching proposal to AiDiffController', {
      path: proposal.path,
      kind: proposal.kind,
      proposedSize: proposal.proposed.length
    });
    this.diff.show({
      path: proposal.path,
      original: proposal.original,
      proposed: proposal.proposed,
      summary: describeProposal(proposal),
      kind: proposal.kind
    });
  }

  _scrollToBottom() {
    if (!this._els.messages) return;
    // The scroll container is the .panel-body; scroll the panel-view
    // down to the latest message. Use rAF so layout has settled.
    requestAnimationFrame(() => {
      this._els.messages.scrollTop = this._els.messages.scrollHeight;
    });
  }
}

function friendlyToolName(name) {
  switch (name) {
    case 'applyEdit':
      return 'proposing edit';
    case 'createFile':
      return 'creating file';
    case 'readFile':
      return 'reading file';
    case 'listFiles':
      return 'listing folder';
    case 'webFetch':
      return 'fetching URL';
    case 'launchApp':
      return 'launching app';
    case 'notify':
      return 'showing notification';
    case 'listApps':
      return 'looking up apps';
    case 'tool':
      return 'tool call';
    default:
      return name || 'tool';
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

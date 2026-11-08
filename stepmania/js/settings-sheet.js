// Settings sheet — column keybinds. Persistence lives on InputManager.

import { adoptSharedStyles } from './sharedStyles.js';
import { COLUMNS, inputManager, isReservedActionKey, keyCodeLabel } from './inputManager.js';
import gameState from './gameState.js';

const COLUMN_META = [
  { id: COLUMNS.LEFT, name: 'Left' },
  { id: COLUMNS.DOWN, name: 'Down' },
  { id: COLUMNS.UP, name: 'Up' },
  { id: COLUMNS.RIGHT, name: 'Right' }
];

/** @returns {Element|null} */
function deepActiveElement() {
  let node = document.activeElement;
  while (node && node.shadowRoot && node.shadowRoot.activeElement) {
    node = node.shadowRoot.activeElement;
  }
  return node;
}

class SettingsSheetElement extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    /** @type {number|null} */
    this._listeningColumn = null;
    this._hint = '';
    /** @type {Element|null} */
    this._returnFocus = null;
    this._onKeyDown = (ev) => this._handleCapture(ev);
    this._onDocKey = (ev) => {
      if (this.hidden) return;
      if (ev.key === 'Escape') {
        ev.preventDefault();
        this.close();
      }
    };
  }

  connectedCallback() {
    this.hidden = true;
    this._refresh();
  }

  disconnectedCallback() {
    document.removeEventListener('keydown', this._onKeyDown, true);
    document.removeEventListener('keydown', this._onDocKey);
  }

  open() {
    if (this.hidden) {
      const active = deepActiveElement();
      this._returnFocus = active && active !== document.body ? active : null;
    }
    this.hidden = false;
    this._listeningColumn = null;
    this._hint = 'Click a column, then press a key to add it.';
    this._refresh();
    document.addEventListener('keydown', this._onKeyDown, true);
    document.addEventListener('keydown', this._onDocKey);
    const closeBtn = this.shadowRoot.getElementById('close-btn');
    if (closeBtn) closeBtn.focus();
  }

  close() {
    this._listeningColumn = null;
    const inner = this.shadowRoot && this.shadowRoot.activeElement;
    if (inner && typeof inner.blur === 'function') inner.blur();
    this.hidden = true;
    if (document.activeElement === this) this.blur();
    document.removeEventListener('keydown', this._onKeyDown, true);
    document.removeEventListener('keydown', this._onDocKey);
    const target = this._returnFocus;
    this._returnFocus = null;
    if (target instanceof HTMLElement && target.isConnected) target.focus();
  }

  /** Re-render and keep focus on the equivalent control while the sheet is open. */
  _refresh() {
    const active = this.shadowRoot.activeElement;
    let selector = '';
    if (active instanceof HTMLElement) {
      if (active.id) selector = `#${active.id}`;
      else if (active.hasAttribute('data-scroll')) {
        selector = `[data-scroll="${active.getAttribute('data-scroll')}"]`;
      } else if (active.hasAttribute('data-add-col')) {
        selector = `[data-add-col="${active.getAttribute('data-add-col')}"]`;
      } else if (active.hasAttribute('data-unbind')) {
        const add = active.closest('.row')?.querySelector('[data-add-col]');
        if (add) selector = `[data-add-col="${add.getAttribute('data-add-col')}"]`;
      }
    }
    this.render();
    adoptSharedStyles(this.shadowRoot);
    this.bindEvents();
    if (this.hidden) return;
    const target =
      (selector && this.shadowRoot.querySelector(selector)) ||
      this.shadowRoot.getElementById('close-btn');
    if (target instanceof HTMLElement) target.focus();
  }

  toggle() {
    if (this.hidden) this.open();
    else this.close();
  }

  bindEvents() {
    const backdrop = this.shadowRoot.getElementById('backdrop');
    if (backdrop) {
      backdrop.addEventListener('click', (ev) => {
        if (ev.target === backdrop) this.close();
      });
    }
    const closeBtn = this.shadowRoot.getElementById('close-btn');
    if (closeBtn) closeBtn.addEventListener('click', () => this.close());
    const resetBtn = this.shadowRoot.getElementById('reset-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        inputManager.resetKeyBindings();
        this._listeningColumn = null;
        this._hint = 'Restored WASD and arrow keys.';
        this._refresh();
      });
    }
    this.shadowRoot.querySelectorAll('[data-scroll]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const direction = btn.getAttribute('data-scroll') === 'down' ? 'down' : 'up';
        gameState.setScrollDirection(direction);
        this._hint = direction === 'down' ? 'Notes fall downward.' : 'Notes rise to the top.';
        this._refresh();
      });
    });
    this.shadowRoot.querySelectorAll('[data-add-col]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this._listeningColumn = Number(btn.getAttribute('data-add-col'));
        this._hint = `Press a key for ${COLUMN_META[this._listeningColumn].name}…`;
        this._refresh();
      });
    });
    this.shadowRoot.querySelectorAll('[data-unbind]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const code = Number(btn.getAttribute('data-unbind'));
        inputManager.unbindKey(code);
        this._hint = `Removed ${keyCodeLabel(code)}.`;
        this._refresh();
      });
    });
  }

  _handleCapture(ev) {
    if (this.hidden || this._listeningColumn == null) return;
    const keyCode = ev.which || ev.keyCode;
    if (!keyCode) return;
    if (ev.key === 'Escape') return;

    ev.preventDefault();
    ev.stopPropagation();

    if (isReservedActionKey(keyCode)) {
      this._hint = `${keyCodeLabel(keyCode)} is reserved (play / speed / rate).`;
      this._refresh();
      return;
    }

    const ok = inputManager.bindKey(keyCode, this._listeningColumn);
    this._listeningColumn = null;
    this._hint = ok ? `Bound ${keyCodeLabel(keyCode)}.` : 'Could not bind that key.';
    this._refresh();
  }

  render() {
    const rows = COLUMN_META.map((col) => {
      const keys = inputManager.getKeysForColumn(col.id);
      const chips = keys
        .map(
          (code) =>
            `<button type="button" class="chip" data-unbind="${code}" title="Remove ${escapeHtml(
              keyCodeLabel(code)
            )}">${escapeHtml(keyCodeLabel(code))} ×</button>`
        )
        .join('');
      const listening = this._listeningColumn === col.id;
      return `
        <div class="row ${listening ? 'listening' : ''}">
          <div class="col-name">${escapeHtml(col.name)}</div>
          <div class="chips">${chips || '<span class="empty">No keys</span>'}</div>
          <button type="button" class="add" data-add-col="${col.id}">${
        listening ? 'Listening…' : 'Add key'
      }</button>
        </div>`;
    }).join('');

    const direction = gameState.getScrollDirection();

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        :host([hidden]) { display: none !important; }
        .backdrop {
          position: fixed; inset: 0;
          background: var(--scrim-strong, rgba(15, 23, 42, 0.8));
          z-index: 80;
          display: flex; align-items: center; justify-content: center;
          padding: 24px;
        }
        .panel {
          width: min(420px, 100%);
          background: var(--surface-1, #fff);
          color: var(--text-1, #111);
          border-radius: 0.75rem;
          border: 1px solid var(--hairline-strong, #ccc);
          box-shadow: 0 20px 50px rgba(0,0,0,0.35);
          padding: 1rem 1.1rem 1.15rem;
          font-family: var(--font-ui, system-ui, sans-serif);
        }
        h2 { margin: 0 0 0.35rem; font-size: 1.15rem; }
        .hint { font-size: 0.8rem; color: var(--text-2, #555); min-height: 1.2em; margin-bottom: 0.75rem; }
        .row {
          display: grid;
          grid-template-columns: 3.5rem 1fr auto;
          gap: 0.5rem;
          align-items: center;
          margin-bottom: 0.5rem;
        }
        .row.listening { outline: 2px solid var(--accent-primary, #1a73e8); outline-offset: 2px; border-radius: 0.4rem; }
        .col-name { font-weight: 600; font-size: 0.85rem; }
        .chips { display: flex; flex-wrap: wrap; gap: 0.35rem; }
        .chip {
          border: 1px solid var(--hairline-strong, #ccc);
          background: var(--surface-2, #f3f3f3);
          color: inherit;
          border-radius: 999px;
          padding: 0.15rem 0.5rem;
          font-size: 0.75rem;
          cursor: pointer;
        }
        .empty { font-size: 0.75rem; color: var(--text-2, #888); }
        .add, .footer button, .scroll-btn {
          border: 1px solid var(--hairline-strong, #ccc);
          background: var(--surface-1, #fff);
          color: inherit;
          border-radius: 0.5rem;
          padding: 0.35rem 0.65rem;
          font-size: 0.8rem;
          cursor: pointer;
        }
        .scroll-row { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-bottom: 0.75rem; }
        .scroll-btn.selected {
          border-color: var(--accent-primary, #1a73e8);
          background: var(--surface-2, #f3f3f3);
          font-weight: 600;
        }
        .section-label { font-size: 0.72rem; font-weight: 600; letter-spacing: 0.02em; margin: 0 0 0.35rem; }
        .footer { display: flex; justify-content: space-between; gap: 0.5rem; margin-top: 0.85rem; }
        .note { font-size: 0.72rem; color: var(--text-2, #666); margin-top: 0.65rem; }
      </style>
      <div class="backdrop" id="backdrop">
        <div class="panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
          <h2 id="settings-title">Keys and scroll</h2>
          <p class="hint">${escapeHtml(this._hint)}</p>
          <p class="section-label">Scroll</p>
          <div class="scroll-row">
            <button type="button" class="scroll-btn${
              direction === 'up' ? ' selected' : ''
            }" data-scroll="up">Upscroll</button>
            <button type="button" class="scroll-btn${
              direction === 'down' ? ' selected' : ''
            }" data-scroll="down">Downscroll</button>
          </div>
          ${rows}
          <p class="note">Space, [ ] \\ and \` stay reserved. Click a key chip to remove it.</p>
          <div class="footer">
            <button type="button" id="reset-btn">Reset defaults</button>
            <button type="button" id="close-btn">Done</button>
          </div>
        </div>
      </div>
    `;
  }
}

/** @param {unknown} value */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

customElements.define('sm-settings-sheet', SettingsSheetElement);

export { SettingsSheetElement };

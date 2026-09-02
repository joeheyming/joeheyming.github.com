// Settings sheet — column keybinds. Persistence lives on InputManager.

import { adoptSharedStyles } from './sharedStyles.js';
import { COLUMNS, inputManager, isReservedActionKey, keyCodeLabel } from './inputManager.js';

const COLUMN_META = [
  { id: COLUMNS.LEFT, name: 'Left' },
  { id: COLUMNS.DOWN, name: 'Down' },
  { id: COLUMNS.UP, name: 'Up' },
  { id: COLUMNS.RIGHT, name: 'Right' }
];

class SettingsSheetElement extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    /** @type {number|null} */
    this._listeningColumn = null;
    this._hint = '';
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
    this.render();
    adoptSharedStyles(this.shadowRoot);
    this.bindEvents();
  }

  disconnectedCallback() {
    document.removeEventListener('keydown', this._onKeyDown, true);
    document.removeEventListener('keydown', this._onDocKey);
  }

  open() {
    this.hidden = false;
    this._listeningColumn = null;
    this._hint = 'Click a column, then press a key to add it.';
    this.render();
    adoptSharedStyles(this.shadowRoot);
    this.bindEvents();
    document.addEventListener('keydown', this._onKeyDown, true);
    document.addEventListener('keydown', this._onDocKey);
    const closeBtn = this.shadowRoot.getElementById('close-btn');
    if (closeBtn) closeBtn.focus();
  }

  close() {
    this.hidden = true;
    this._listeningColumn = null;
    document.removeEventListener('keydown', this._onKeyDown, true);
    document.removeEventListener('keydown', this._onDocKey);
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
        this.render();
        adoptSharedStyles(this.shadowRoot);
        this.bindEvents();
      });
    }
    this.shadowRoot.querySelectorAll('[data-add-col]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this._listeningColumn = Number(btn.getAttribute('data-add-col'));
        this._hint = `Press a key for ${COLUMN_META[this._listeningColumn].name}…`;
        this.render();
        adoptSharedStyles(this.shadowRoot);
        this.bindEvents();
      });
    });
    this.shadowRoot.querySelectorAll('[data-unbind]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const code = Number(btn.getAttribute('data-unbind'));
        inputManager.unbindKey(code);
        this._hint = `Removed ${keyCodeLabel(code)}.`;
        this.render();
        adoptSharedStyles(this.shadowRoot);
        this.bindEvents();
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
      this.render();
      adoptSharedStyles(this.shadowRoot);
      this.bindEvents();
      return;
    }

    const ok = inputManager.bindKey(keyCode, this._listeningColumn);
    this._listeningColumn = null;
    this._hint = ok ? `Bound ${keyCodeLabel(keyCode)}.` : 'Could not bind that key.';
    this.render();
    adoptSharedStyles(this.shadowRoot);
    this.bindEvents();
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
        .add, .footer button {
          border: 1px solid var(--hairline-strong, #ccc);
          background: var(--surface-1, #fff);
          color: inherit;
          border-radius: 0.5rem;
          padding: 0.35rem 0.65rem;
          font-size: 0.8rem;
          cursor: pointer;
        }
        .footer { display: flex; justify-content: space-between; gap: 0.5rem; margin-top: 0.85rem; }
        .note { font-size: 0.72rem; color: var(--text-2, #666); margin-top: 0.65rem; }
      </style>
      <div class="backdrop" id="backdrop">
        <div class="panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
          <h2 id="settings-title">Keybinds</h2>
          <p class="hint">${escapeHtml(this._hint)}</p>
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

/**
 * Display Mode Selector Web Component
 * A dropdown for selecting countdown display modes
 */
import { localeService } from '../i18n/locale-service.js';
import {
  onClickOutside,
  dropdownStyles,
  chevronStyles,
  selectMenuKeys,
  srOnlyStyles
} from './shared-styles.js';

// Display mode definitions with icons
const DISPLAY_MODE_DEFS = [
  { id: 'analog', icon: '⏰' },
  { id: 'balldrop', icon: '🎊' },
  { id: 'bar', icon: '📊' },
  { id: 'binary', icon: '01' },
  { id: 'decimal', icon: '🔢' },
  { id: 'flip', icon: '🔄' },
  { id: 'hex', icon: '⬡' },
  { id: 'hourglass', icon: '⏳' },
  { id: 'led', icon: '🔴' },
  { id: 'natural', icon: '💬' },
  { id: 'percentage', icon: '%' },
  { id: 'radar', icon: '🎯' },
  { id: 'roman', icon: '🏛️' },
  { id: 'slot', icon: '🎰' },
  { id: 'standard', icon: '⏱️' },
  { id: 'thermometer', icon: '🌡️' },
  { id: 'total', icon: '⏲️' },
  { id: 'words', icon: '🔤' }
];

// Get translated display modes, sorted by localized name
function getDisplayModes() {
  return DISPLAY_MODE_DEFS.map((def) => ({
    id: def.id,
    name: localeService.str(`displayModes.${def.id}`),
    description: localeService.str(`displayModes.${def.id}Desc`),
    icon: def.icon
  })).sort((a, b) => a.name.localeCompare(b.name, localeService.locale));
}

function displayLabel() {
  const text = localeService.str('ui.display');
  const label = text && text !== 'ui.display' ? text.replace(/[:：]\s*$/, '') : '';
  return label || 'Display';
}

// Export getter function for use elsewhere (don't cache at module load time)
export function getDisplayModesList() {
  return getDisplayModes();
}

// Legacy export - will be evaluated after translations load if used after init
export const DISPLAY_MODES = DISPLAY_MODE_DEFS.map((def) => def.id);

class DisplayModeSelector extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open', delegatesFocus: true });
    this.isOpen = false;
    this.selectedMode = 'standard';
    this._highlighted = 0;
    this._ready = false;
    this._clickOutsideCleanup = null;
    this._releaseKeys = null;
    this._shadowBound = false;
  }

  static get observedAttributes() {
    return ['value'];
  }

  async connectedCallback() {
    if (this.tabIndex < 0) this.tabIndex = 0;
    // Wait for translations to be loaded before rendering
    await localeService.ready();
    this._ready = true;

    this.render();
    this.setupEventListeners();

    // Re-render when locale changes. Listeners live on the shadow root and
    // the host, so they survive the new markup.
    if (this._unsubscribe) this._unsubscribe();
    this._unsubscribe = localeService.subscribe(() => {
      const refocus = this.shadowRoot.activeElement === this.btn;
      this.render();
      if (refocus) this.btn.focus();
    });
  }

  disconnectedCallback() {
    if (this._unsubscribe) this._unsubscribe();
    this._unsubscribe = null;
    if (this._clickOutsideCleanup) this._clickOutsideCleanup();
    this._clickOutsideCleanup = null;
    if (this._releaseKeys) this._releaseKeys();
    this._releaseKeys = null;
  }

  items() {
    return this.dropdown ? [...this.dropdown.querySelectorAll('.dropdown-item')] : [];
  }

  choose(index) {
    const item = this.items()[index];
    if (!item) {
      this.close();
      return;
    }
    const mode = item.dataset.mode;
    this.selectedMode = mode;
    this.close();
    this.updateDisplay();
    this.dispatchEvent(
      new CustomEvent('mode-change', {
        detail: { mode },
        bubbles: true
      })
    );
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (name === 'value' && newValue !== oldValue) {
      this.selectedMode = newValue;
      this.updateDisplay();
    }
  }

  get value() {
    return this.selectedMode;
  }

  set value(mode) {
    const modes = getDisplayModes();
    if (modes.find((m) => m.id === mode)) {
      this.selectedMode = mode;
      this.setAttribute('value', mode);
      this.updateDisplay();
    }
  }

  render() {
    const modes = getDisplayModes();
    const currentMode = modes.find((m) => m.id === this.selectedMode) || modes[0];

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          position: relative;
          font-family: 'Outfit', system-ui, sans-serif;
          z-index: 50;
        }

        ${dropdownStyles}
        ${chevronStyles}

        .selector-button {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 16px;
          background: rgba(15, 23, 42, 0.6);
          border: 1px solid rgba(148, 163, 184, 0.2);
          border-radius: 10px;
          cursor: pointer;
          transition: all 0.2s ease;
          min-width: 200px;
        }

        .selector-button:hover {
          background: rgba(15, 23, 42, 0.8);
          border-color: rgba(245, 158, 11, 0.4);
        }

        .selector-button:focus {
          outline: none;
          border-color: #f59e0b;
          box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.2);
        }

        .mode-icon {
          font-size: 1.2rem;
          width: 28px;
          text-align: center;
        }

        .mode-info {
          flex: 1;
          text-align: left;
        }

        .mode-name {
          font-size: 0.9rem;
          font-weight: 500;
          color: #f8fafc;
        }

        .mode-description {
          font-size: 0.75rem;
          color: #64748b;
          margin-top: 2px;
        }

        .dropdown-item .mode-icon {
          font-size: 1.1rem;
          opacity: 0.9;
        }

        .dropdown-item .mode-name {
          font-size: 0.85rem;
        }

        .dropdown-item .mode-description {
          font-size: 0.7rem;
        }

        /* Custom scrollbar */
        .dropdown::-webkit-scrollbar-track {
          background: #1e293b;
          border-radius: 10px;
        }

        .dropdown::-webkit-scrollbar-thumb {
          background-color: #f59e0b;
          border-radius: 10px;
          border: 2px solid #1e293b;
        }

        @media (max-width: 400px) {
          .selector-button {
            min-width: 160px;
            padding: 8px 12px;
            gap: 8px;
          }
          .mode-icon {
            font-size: 1rem;
            width: 24px;
          }
          .mode-name {
            font-size: 0.8rem;
          }
          .mode-description {
            display: none;
          }
        }

        ${srOnlyStyles}
      </style>

      <span class="sr-only" id="label">${displayLabel()}</span>
      <button class="selector-button" id="selectorBtn" role="combobox" aria-haspopup="listbox"
        aria-expanded="false" aria-controls="dropdown" aria-labelledby="label currentName">
        <span class="mode-icon" aria-hidden="true">${currentMode.icon}</span>
        <div class="mode-info">
          <div class="mode-name" id="currentName">${currentMode.name}</div>
          <div class="mode-description">${currentMode.description}</div>
        </div>
        <span class="chevron" id="chevron" aria-hidden="true">▼</span>
      </button>

      <div class="dropdown" id="dropdown" role="listbox" aria-labelledby="label">
        ${modes
          .map(
            (mode, index) => `
          <div class="dropdown-item ${mode.id === this.selectedMode ? 'selected' : ''}"
               id="mode-option-${index}"
               data-mode="${mode.id}"
               role="option"
               aria-selected="${mode.id === this.selectedMode}">
            <span class="mode-icon" aria-hidden="true">${mode.icon}</span>
            <div class="mode-info">
              <div class="mode-name">${mode.name}</div>
              <div class="mode-description">${mode.description}</div>
            </div>
          </div>
        `
          )
          .join('')}
      </div>
    `;

    // Cache element references
    this.btn = this.shadowRoot.getElementById('selectorBtn');
    this.dropdown = this.shadowRoot.getElementById('dropdown');
    this.chevron = this.shadowRoot.getElementById('chevron');
    this.isOpen = false;
  }

  setupEventListeners() {
    if (!this._shadowBound) {
      this._shadowBound = true;
      this.shadowRoot.addEventListener('click', (event) => {
        const item = event.target.closest('.dropdown-item');
        if (item) {
          this.choose(this.items().indexOf(item));
          return;
        }
        if (event.target.closest('#selectorBtn')) this.toggle();
      });
      this.shadowRoot.addEventListener('keydown', (event) => {
        if (event.altKey && event.key === 'ArrowDown' && !this.isOpen) {
          event.preventDefault();
          this.open();
        }
      });

      // OK on a remote clicks the focused host, not the button inside it.
      this.addEventListener('click', (event) => {
        if (event.composedPath()[0] !== this) return;
        if (!this.isOpen) this.open();
        else this.choose(this._highlighted);
      });

      this.addEventListener('focusout', () => {
        setTimeout(() => {
          if (this.isOpen && !this.shadowRoot.activeElement) this.close();
        }, 0);
      });
    }

    if (this._clickOutsideCleanup) this._clickOutsideCleanup();
    this._clickOutsideCleanup = onClickOutside(this, () => {
      if (this.isOpen) this.close();
    });
    if (this._releaseKeys) this._releaseKeys();
    this._releaseKeys = selectMenuKeys(this, {
      isOpen: () => this.isOpen,
      count: () => this.items().length,
      highlighted: () => this._highlighted,
      highlight: (index) => {
        this._highlighted = index;
        this._paintHighlight();
      },
      choose: (index) => this.choose(index),
      close: () => this.close()
    });
  }

  toggle() {
    this.isOpen ? this.close() : this.open();
  }

  open() {
    this.isOpen = true;
    this.dropdown.classList.add('open');
    this.chevron.classList.add('open');
    this.btn.setAttribute('aria-expanded', 'true');
    const items = this.items();
    const selected = items.findIndex((item) => item.classList.contains('selected'));
    this._highlighted = selected >= 0 ? selected : 0;
    this._paintHighlight();
  }

  // While open, aria-selected follows the highlight (APG select-only combobox).
  _paintHighlight() {
    const items = this.items();
    items.forEach((item, index) => {
      const active = index === this._highlighted;
      item.classList.toggle('highlighted', active);
      item.setAttribute('aria-selected', String(active));
    });
    const current = items[this._highlighted];
    if (current) this.btn.setAttribute('aria-activedescendant', current.id);
    if (current && typeof current.scrollIntoView === 'function') {
      current.scrollIntoView({ block: 'nearest' });
    }
  }

  close() {
    this.isOpen = false;
    this.dropdown.classList.remove('open');
    this.chevron.classList.remove('open');
    this.btn.setAttribute('aria-expanded', 'false');
    this.btn.removeAttribute('aria-activedescendant');
    this.updateDisplay();
  }

  updateDisplay() {
    const modes = getDisplayModes();
    const currentMode = modes.find((m) => m.id === this.selectedMode) || modes[0];

    if (this.btn) {
      const icon = this.btn.querySelector('.mode-icon');
      const name = this.btn.querySelector('.mode-name');
      const desc = this.btn.querySelector('.mode-description');

      if (icon) icon.textContent = currentMode.icon;
      if (name) name.textContent = currentMode.name;
      if (desc) desc.textContent = currentMode.description;
    }

    // Update selected state in dropdown
    const items = this.shadowRoot.querySelectorAll('.dropdown-item');
    items.forEach((item) => {
      const isSelected = item.dataset.mode === this.selectedMode;
      item.classList.toggle('selected', isSelected);
      if (!this.isOpen) item.setAttribute('aria-selected', String(isSelected));
    });
  }
}

customElements.define('display-mode-selector', DisplayModeSelector);
export default DisplayModeSelector;

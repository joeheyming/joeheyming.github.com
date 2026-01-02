/**
 * Display Mode Selector Web Component
 * A dropdown for selecting countdown display modes
 */
import { localeService } from '../i18n/locale-service.js';
import { onClickOutside, dropdownStyles, chevronStyles } from './shared-styles.js';

// Display mode definitions with icons
const DISPLAY_MODE_DEFS = [
  { id: 'analog', icon: '⏰' },
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

// Export getter function for use elsewhere (don't cache at module load time)
export function getDisplayModesList() {
  return getDisplayModes();
}

// Legacy export - will be evaluated after translations load if used after init
export const DISPLAY_MODES = DISPLAY_MODE_DEFS.map((def) => def.id);

class DisplayModeSelector extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.isOpen = false;
    this.selectedMode = 'standard';
    this._ready = false;
    this._clickOutsideCleanup = null;
  }

  static get observedAttributes() {
    return ['value'];
  }

  async connectedCallback() {
    // Wait for translations to be loaded before rendering
    await localeService.ready();
    this._ready = true;

    this.render();
    this.setupEventListeners();

    // Re-render when locale changes
    this._unsubscribe = localeService.subscribe(() => {
      this.render();
      this.setupEventListeners();
    });
  }

  disconnectedCallback() {
    if (this._unsubscribe) this._unsubscribe();
    if (this._clickOutsideCleanup) this._clickOutsideCleanup();
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
      </style>

      <button class="selector-button" id="selectorBtn" aria-haspopup="listbox" aria-expanded="false">
        <span class="mode-icon">${currentMode.icon}</span>
        <div class="mode-info">
          <div class="mode-name">${currentMode.name}</div>
          <div class="mode-description">${currentMode.description}</div>
        </div>
        <span class="chevron" id="chevron">▼</span>
      </button>

      <div class="dropdown" id="dropdown" role="listbox">
        ${modes
          .map(
            (mode) => `
          <div class="dropdown-item ${mode.id === this.selectedMode ? 'selected' : ''}"
               data-mode="${mode.id}"
               role="option"
               aria-selected="${mode.id === this.selectedMode}">
            <span class="mode-icon">${mode.icon}</span>
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
  }

  setupEventListeners() {
    // Remove old click-outside listener if exists
    if (this._clickOutsideCleanup) {
      this._clickOutsideCleanup();
    }

    this.btn.addEventListener('click', () => this.toggle());

    this.dropdown.addEventListener('click', (e) => {
      const item = e.target.closest('.dropdown-item');
      if (item) {
        const mode = item.dataset.mode;
        this.selectedMode = mode;
        this.close();
        this.updateDisplay();

        // Dispatch custom event
        this.dispatchEvent(
          new CustomEvent('mode-change', {
            detail: { mode },
            bubbles: true
          })
        );
      }
    });

    // Click outside to close (with cleanup)
    this._clickOutsideCleanup = onClickOutside(this, () => {
      if (this.isOpen) this.close();
    });

    // Keyboard navigation
    this.btn.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const modes = getDisplayModes();
        const currentIndex = modes.findIndex((m) => m.id === this.selectedMode);
        let newIndex;
        if (e.key === 'ArrowDown') {
          newIndex = (currentIndex + 1) % modes.length;
        } else {
          newIndex = currentIndex === 0 ? modes.length - 1 : currentIndex - 1;
        }
        this.selectedMode = modes[newIndex].id;
        this.updateDisplay();
        this.dispatchEvent(
          new CustomEvent('mode-change', {
            detail: { mode: this.selectedMode },
            bubbles: true
          })
        );
      }
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
  }

  close() {
    this.isOpen = false;
    this.dropdown.classList.remove('open');
    this.chevron.classList.remove('open');
    this.btn.setAttribute('aria-expanded', 'false');
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
      item.setAttribute('aria-selected', isSelected);
    });
  }
}

customElements.define('display-mode-selector', DisplayModeSelector);
export default DisplayModeSelector;

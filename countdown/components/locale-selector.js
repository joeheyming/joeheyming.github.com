/**
 * Locale Selector Web Component
 * Dropdown for selecting display language
 */
import { localeService, SUPPORTED_LOCALES } from '../i18n/locale-service.js';
import {
  onClickOutside,
  dropdownStyles,
  chevronStyles,
  selectorButtonStyles,
  dropdownArrow
} from './shared-styles.js';

class LocaleSelector extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.isOpen = false;
    this._clickOutsideCleanup = null;
  }

  async connectedCallback() {
    if (this.tabIndex < 0) this.tabIndex = 0;
    this._highlighted = 0;
    await localeService.ready();
    this.render();
    this.setupEventListeners();

    // Listen for locale changes
    this._unsubscribe = localeService.subscribe(() => this.updateDisplay());
  }

  disconnectedCallback() {
    if (this._unsubscribe) this._unsubscribe();
    if (this._clickOutsideCleanup) this._clickOutsideCleanup();
  }

  render() {
    const currentLocale = SUPPORTED_LOCALES.find((l) => l.code === localeService.locale);

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: inline-block;
          position: relative;
          font-family: 'Outfit', sans-serif;
          z-index: 100;
        }

        ${selectorButtonStyles}
        ${dropdownStyles}
        ${chevronStyles}

        .dropdown {
          right: 0;
          left: auto;
          min-width: 200px;
        }

        .globe-icon {
          font-size: 1.1rem;
        }

        .locale-code {
          font-weight: 600;
          text-transform: uppercase;
          font-size: 0.75rem;
          color: #f59e0b;
        }

        .locale-info {
          display: flex;
          flex-direction: column;
          gap: 2px;
          flex: 1;
        }

        .locale-name {
          font-size: 0.85rem;
          color: #f8fafc;
        }

        .locale-native {
          font-size: 0.75rem;
          color: #64748b;
        }

        .locale-check {
          color: #22c55e;
          font-size: 1rem;
        }

        .rtl-badge {
          font-size: 0.6rem;
          padding: 2px 4px;
          background: rgba(168, 85, 247, 0.2);
          color: #a855f7;
          border-radius: 4px;
          margin-left: 8px;
        }
      </style>

      <button class="selector-btn" id="selectorBtn">
        <span class="globe-icon">🌐</span>
        <span class="locale-code" id="localeCode">${currentLocale?.code || 'en'}</span>
        <span class="chevron" id="chevron">▼</span>
      </button>

      <div class="dropdown" id="dropdown">
        ${SUPPORTED_LOCALES.map(
          (locale) => `
          <div class="dropdown-item ${locale.code === localeService.locale ? 'selected' : ''}" 
               data-locale="${locale.code}">
            <div class="locale-info">
              <span class="locale-name">${locale.name}${
            locale.rtl ? '<span class="rtl-badge">RTL</span>' : ''
          }</span>
              <span class="locale-native">${locale.nativeName}</span>
            </div>
            ${locale.code === localeService.locale ? '<span class="locale-check">✓</span>' : ''}
          </div>
        `
        ).join('')}
      </div>
    `;

    // Cache element references
    this.btn = this.shadowRoot.getElementById('selectorBtn');
    this.dropdown = this.shadowRoot.getElementById('dropdown');
    this.chevron = this.shadowRoot.getElementById('chevron');
    this.localeCodeEl = this.shadowRoot.getElementById('localeCode');
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
        const locale = item.dataset.locale;
        localeService.locale = locale;
        this.close();
      }
    });

    // Click outside to close (with cleanup)
    this._clickOutsideCleanup = onClickOutside(this, () => {
      if (this.isOpen) this.close();
    });

    // Arrow navigation stops on this host. The button inside the shadow
    // is invisible to it. OK clicks the host and opens the list.
    this.addEventListener('click', (event) => {
      if (event.composedPath()[0] !== this) return;
      if (!this.isOpen) {
        this.open();
        return;
      }
      const item = this.dropdown.querySelectorAll('.dropdown-item')[this._highlighted];
      if (!item) {
        this.close();
        return;
      }
      localeService.locale = item.dataset.locale;
      this.close();
    });

    this.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.isOpen) {
        event.preventDefault();
        this.close();
        return;
      }
      if (!this.isOpen) return;
      const items = [...this.dropdown.querySelectorAll('.dropdown-item')];
      const next = dropdownArrow(event, this._highlighted, items.length);
      if (next === null) return;
      if (next === 'leave') {
        this.close();
        return;
      }
      this._highlighted = next;
      this._paintHighlight(items);
    });
  }

  toggle() {
    this.isOpen ? this.close() : this.open();
  }

  open() {
    this.isOpen = true;
    this.dropdown.classList.add('open');
    this.chevron.classList.add('open');
    const items = [...this.dropdown.querySelectorAll('.dropdown-item')];
    const selected = items.findIndex((item) => item.classList.contains('selected'));
    this._highlighted = selected >= 0 ? selected : 0;
    this._paintHighlight(items);
  }

  _paintHighlight(items) {
    items.forEach((item, index) => {
      item.classList.toggle('highlighted', index === this._highlighted);
    });
    const current = items[this._highlighted];
    if (current && typeof current.scrollIntoView === 'function') {
      current.scrollIntoView({ block: 'nearest' });
    }
  }

  close() {
    this.isOpen = false;
    this.dropdown.classList.remove('open');
    this.chevron.classList.remove('open');
  }

  updateDisplay() {
    // Update locale code display
    if (this.localeCodeEl) {
      this.localeCodeEl.textContent = localeService.locale;
    }

    // Update selected state in dropdown
    const items = this.shadowRoot.querySelectorAll('.dropdown-item');
    items.forEach((item) => {
      const isSelected = item.dataset.locale === localeService.locale;
      item.classList.toggle('selected', isSelected);

      // Update checkmark
      const existingCheck = item.querySelector('.locale-check');
      if (isSelected && !existingCheck) {
        item.insertAdjacentHTML('beforeend', '<span class="locale-check">✓</span>');
      } else if (!isSelected && existingCheck) {
        existingCheck.remove();
      }
    });
  }
}

customElements.define('locale-selector', LocaleSelector);
export default LocaleSelector;

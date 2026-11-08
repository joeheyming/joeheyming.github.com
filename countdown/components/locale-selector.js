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
  selectMenuKeys,
  srOnlyStyles
} from './shared-styles.js';

class LocaleSelector extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open', delegatesFocus: true });
    this.isOpen = false;
    this._highlighted = 0;
    this._clickOutsideCleanup = null;
    this._releaseKeys = null;
  }

  async connectedCallback() {
    if (this.tabIndex < 0) this.tabIndex = 0;
    await localeService.ready();
    if (!this.btn) {
      this.render();
      this.setupEventListeners();
    }
    this.bindDocumentListeners();

    // Listen for locale changes
    if (this._unsubscribe) this._unsubscribe();
    this._unsubscribe = localeService.subscribe(() => this.updateDisplay());
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
    if (item) localeService.locale = item.dataset.locale;
    this.close();
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

        ${srOnlyStyles}
      </style>

      <span class="sr-only" id="label">Language</span>
      <button class="selector-btn" id="selectorBtn" role="combobox" aria-haspopup="listbox"
        aria-expanded="false" aria-controls="dropdown" aria-labelledby="label localeName">
        <span class="globe-icon" aria-hidden="true">🌐</span>
        <span class="locale-code" id="localeCode" aria-hidden="true">${
          currentLocale?.code || 'en'
        }</span>
        <span class="sr-only" id="localeName">${currentLocale?.name || 'English'}</span>
        <span class="chevron" id="chevron" aria-hidden="true">▼</span>
      </button>

      <div class="dropdown" id="dropdown" role="listbox" aria-labelledby="label">
        ${SUPPORTED_LOCALES.map(
          (locale, index) => `
          <div class="dropdown-item ${locale.code === localeService.locale ? 'selected' : ''}"
               id="locale-option-${index}" role="option"
               aria-selected="${locale.code === localeService.locale}"
               data-locale="${locale.code}">
            <div class="locale-info">
              <span class="locale-name">${locale.name}${
            locale.rtl ? '<span class="rtl-badge">RTL</span>' : ''
          }</span>
              <span class="locale-native" lang="${locale.code}">${locale.nativeName}</span>
            </div>
            ${
              locale.code === localeService.locale
                ? '<span class="locale-check" aria-hidden="true">✓</span>'
                : ''
            }
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
    this.localeNameEl = this.shadowRoot.getElementById('localeName');
  }

  // Bound once: the shadow tree is rendered once and only updated after.
  setupEventListeners() {
    this.btn.addEventListener('click', () => this.toggle());
    this.btn.addEventListener('keydown', (event) => {
      if (event.altKey && event.key === 'ArrowDown' && !this.isOpen) {
        event.preventDefault();
        this.open();
      }
    });

    this.dropdown.addEventListener('click', (e) => {
      const item = e.target.closest('.dropdown-item');
      if (item) this.choose(this.items().indexOf(item));
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

  bindDocumentListeners() {
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
    const current = SUPPORTED_LOCALES.find((l) => l.code === localeService.locale);
    if (this.localeCodeEl) {
      this.localeCodeEl.textContent = localeService.locale;
    }
    if (this.localeNameEl && current) {
      this.localeNameEl.textContent = current.name;
    }

    // Update selected state in dropdown
    const items = this.shadowRoot.querySelectorAll('.dropdown-item');
    items.forEach((item) => {
      const isSelected = item.dataset.locale === localeService.locale;
      item.classList.toggle('selected', isSelected);
      if (!this.isOpen) item.setAttribute('aria-selected', String(isSelected));

      // Update checkmark
      const existingCheck = item.querySelector('.locale-check');
      if (isSelected && !existingCheck) {
        item.insertAdjacentHTML(
          'beforeend',
          '<span class="locale-check" aria-hidden="true">✓</span>'
        );
      } else if (!isSelected && existingCheck) {
        existingCheck.remove();
      }
    });
  }
}

customElements.define('locale-selector', LocaleSelector);
export default LocaleSelector;

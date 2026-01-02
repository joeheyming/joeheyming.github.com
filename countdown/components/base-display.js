/**
 * Base class for all countdown display web components.
 * Provides common lifecycle management, locale support, and utility methods.
 */
import { localeService } from '../i18n/locale-service.js';

export class BaseCountdownDisplay extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._ready = false;
    this._pendingData = null;
  }

  async connectedCallback() {
    await localeService.ready();
    this.render();
    this._ready = true;

    // Subscribe to locale changes - call updateLabels if defined
    this._unsubscribe = localeService.subscribe(() => {
      this.updateLabels?.();
      // Re-apply pending data to update any locale-dependent display
      if (this._pendingData) {
        this._onUpdate(this._pendingData);
      }
    });

    // Apply any data that was set before we were ready
    if (this._pendingData) {
      this._onUpdate(this._pendingData);
    }
  }

  disconnectedCallback() {
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
  }

  /**
   * Public update method - handles pending data pattern
   * @param {Object} data - Countdown data object
   */
  update(data) {
    this._pendingData = data;
    if (!this._ready) return;
    this._onUpdate(data);
  }

  /**
   * Override in subclass to render the component's HTML
   * Called once when component is connected and locale is ready
   */
  render() {
    throw new Error('Subclass must implement render()');
  }

  /**
   * Override in subclass to handle data updates
   * Called when update() is invoked and component is ready
   * @param {Object} data - Countdown data object
   */
  _onUpdate(data) {
    throw new Error('Subclass must implement _onUpdate()');
  }

  /**
   * Override in subclass to update labels when locale changes
   * Optional - only needed if component has translatable text
   */
  updateLabels() {
    // Default: auto-update elements with data-locale-key attribute
    this.shadowRoot.querySelectorAll('[data-locale-key]').forEach((el) => {
      const key = el.dataset.localeKey;
      const suffix = el.dataset.localeSuffix || '';
      el.textContent = localeService.str(key) + suffix;
    });
  }

  // ============ Utility Methods ============

  /**
   * Get localized string from locale service
   * @param {string} key - Translation key (e.g., 'units.days')
   * @returns {string} Translated string
   */
  t(key) {
    return localeService.str(key);
  }

  /**
   * Toggle visibility of years element and separator
   * @param {HTMLElement} yearsEl - Years container element
   * @param {HTMLElement} separatorEl - Separator element (optional)
   * @param {boolean} show - Whether to show years
   */
  toggleYearsVisibility(yearsEl, separatorEl, show) {
    if (yearsEl) {
      yearsEl.classList.toggle('hidden', !show);
    }
    if (separatorEl) {
      separatorEl.classList.toggle('hidden', !show);
    }
  }

  /**
   * Calculate days remaining (accounting for years if shown)
   * @param {number} years - Number of years
   * @param {number} totalDays - Total days remaining
   * @returns {number} Days to display (either total or remainder after years)
   */
  getDaysRemaining(years, totalDays) {
    return years > 0 ? totalDays % 365 : totalDays;
  }

  /**
   * Update an element's text only if changed (prevents unnecessary reflows)
   * @param {HTMLElement} element - Element to update
   * @param {string} newValue - New text content
   */
  updateValue(element, newValue) {
    if (element && element.textContent !== newValue) {
      element.textContent = newValue;
    }
  }
}

export default BaseCountdownDisplay;

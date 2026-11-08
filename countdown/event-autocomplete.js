import dayjs from 'dayjs';
import { getLocalizedEventLabel, CATEGORY_EMOJIS } from './events.js';
import { localeService } from './i18n/locale-service.js';
import {
  onClickOutside,
  dropdownStyles,
  chevronStyles,
  dropdownArrow,
  claimKeys,
  homeEndKey,
  srOnlyStyles
} from './components/shared-styles.js';

const FILTER_DEBOUNCE_MS = 120;

function escapeAttr(value) {
  return String(value).replace(/[&"<>]/g, (c) =>
    c === '&' ? '&amp;' : c === '"' ? '&quot;' : c === '<' ? '&lt;' : '&gt;'
  );
}

// "new years" matches "New Year's Day". Apostrophes and extra spaces stay out of the comparison.
function searchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/['’ʼ`´]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Event Autocomplete Web Component
 * A searchable dropdown for selecting countdown events
 */
class EventAutocomplete extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open', delegatesFocus: true });
    this.events = [];
    this.filteredEvents = [];
    this.highlightedIndex = 0;
    this.selectedEvent = null;
    this.isOpen = false;
    this._clickOutsideCleanup = null;
    this._filterTimer = null;
    this._pendingFilterQuery = null;
    // Painted row order. Category groups do not follow filteredEvents.
    this.visibleEvents = null;
    this._releaseKeys = null;
  }

  async connectedCallback() {
    if (this.tabIndex < 0) this.tabIndex = 0;
    // Wait for translations before rendering
    await localeService.ready();
    this.render();
    this.setupEventListeners();

    // Render dropdown if events were set before render completed
    if (this.events.length > 0) {
      this.renderDropdown();
    }

    // Update display if selectedEvent was set before render completed
    if (this.selectedEvent) {
      this.updateInputDisplay();
    }

    // The page focuses this host before the field exists. Typing belongs in the field.
    this.focusSearch();

    // Subscribe to locale changes
    this._localeUnsubscribe = localeService.subscribe(() => {
      this.renderDropdown();
      if (this.selectedEvent) {
        this.updateInputDisplay();
      }
    });
  }

  disconnectedCallback() {
    this.cancelPendingFilter();
    if (this._localeUnsubscribe) this._localeUnsubscribe();
    if (this._clickOutsideCleanup) this._clickOutsideCleanup();
    if (this._releaseKeys) this._releaseKeys();
    this._releaseKeys = null;
  }

  // Get localized UI string from centralized strings
  str(key) {
    return localeService.str(`ui.${key}`);
  }

  // Get localized category label with emoji
  getCategoryLabel(category) {
    const emoji = CATEGORY_EMOJIS[category] || '';
    const name = localeService.str(`categories.${category}`);
    return `${emoji} ${name}`.trim();
  }

  // Get localized event label
  getEventLabel(event) {
    if (event.category === 'custom') {
      return event.label; // Custom events keep their original label
    }
    return getLocalizedEventLabel(event.id);
  }

  // Update input display with localized label
  updateInputDisplay() {
    if (this.selectedEvent && this.input) {
      this.input.value = `${this.selectedEvent.emoji} ${this.getEventLabel(this.selectedEvent)}`;
    }
  }

  static get observedAttributes() {
    return ['placeholder', 'value'];
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (name === 'placeholder' && this.input) {
      this.input.placeholder = newValue;
    }
  }

  setEvents(events) {
    this.cancelPendingFilter();
    this.events = events;
    // Sort by date (nearest first)
    this.filteredEvents = [...events].sort((a, b) => dayjs(a.date).diff(dayjs(b.date)));
    this.renderDropdown();
  }

  setSelectedEvent(event) {
    this.cancelPendingFilter();
    this.selectedEvent = event;
    if (event && this.input) {
      this.input.value = `${event.emoji} ${event.label}`;
    }
    this.renderDropdown();
  }

  getSelectedEvent() {
    return this.selectedEvent;
  }

  getDaysAway(date) {
    const d = dayjs(date);
    if (!d.isValid()) return '';
    const days = Math.ceil(d.diff(dayjs(), 'day', true));
    if (days === 0) return this.str('today');
    if (days === 1) return this.str('tomorrow');
    return `${days} ${this.str('days')}`;
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          position: relative;
          font-family: 'Outfit', system-ui, sans-serif;
          z-index: 1000;
        }

        * {
          box-sizing: border-box;
        }

        .input-wrapper {
          position: relative;
        }

        input {
          width: 100%;
          background: rgba(15, 23, 42, 0.8);
          border: 1px solid rgba(245, 158, 11, 0.3);
          border-radius: 12px;
          padding: 14px 18px;
          padding-right: 40px;
          color: #f8fafc;
          font-family: inherit;
          font-size: 1rem;
          transition: all 0.3s ease;
          outline: none;
        }

        input:focus {
          border-color: #f59e0b;
          box-shadow: 0 0 20px rgba(245, 158, 11, 0.3);
        }

        input::placeholder {
          color: #64748b;
        }

        ${chevronStyles}

        .chevron {
          position: absolute;
          right: 14px;
          top: 50%;
          transform: translateY(-50%) rotate(0deg);
          pointer-events: none;
        }

        .chevron.open {
          transform: translateY(-50%) rotate(180deg);
        }

        ${dropdownStyles}

        .dropdown {
          z-index: 9999;
          max-height: min(320px, 50vh);
        }

        .item {
          padding: 12px 16px;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 12px;
          transition: all 0.15s ease;
          border-bottom: 1px solid rgba(148, 163, 184, 0.1);
        }

        .item:last-child {
          border-bottom: none;
        }

        .item:hover,
        .item.highlighted {
          background: rgba(245, 158, 11, 0.12);
        }

        .item.selected {
          background: rgba(245, 158, 11, 0.2);
          border-left: 3px solid #f59e0b;
        }

        .emoji {
          font-size: 1.5rem;
          width: 36px;
          text-align: center;
          flex-shrink: 0;
        }

        .info {
          flex: 1;
          min-width: 0;
        }

        .name {
          color: #f8fafc;
          font-weight: 500;
          font-size: 0.95rem;
        }

        .date {
          color: #64748b;
          font-size: 0.8rem;
          margin-top: 2px;
        }

        .days-badge {
          color: #fbbf24;
          font-size: 0.75rem;
          font-weight: 600;
          background: rgba(245, 158, 11, 0.15);
          padding: 4px 10px;
          border-radius: 20px;
          flex-shrink: 0;
        }

        .no-results {
          padding: 20px;
          text-align: center;
          color: #64748b;
          font-size: 0.9rem;
        }

        .category-header {
          padding: 8px 16px;
          font-size: 0.7rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: #64748b;
          background: rgba(15, 23, 42, 0.5);
          border-bottom: 1px solid rgba(148, 163, 184, 0.1);
          position: sticky;
          top: 0;
          z-index: 1;
        }

        .delete-btn {
          background: transparent;
          border: none;
          color: #64748b;
          font-size: 0.9rem;
          cursor: pointer;
          padding: 4px 8px;
          border-radius: 4px;
          transition: all 0.15s ease;
          opacity: 0;
          flex-shrink: 0;
        }

        .item:hover .delete-btn {
          opacity: 1;
        }

        .delete-btn:hover {
          background: rgba(239, 68, 68, 0.2);
          color: #ef4444;
        }
        ${srOnlyStyles}
      </style>

      <div class="input-wrapper">
        <input type="text" placeholder="${
          this.getAttribute('placeholder') || 'Search events...'
        }" autocomplete="off" role="combobox" aria-autocomplete="list"
          aria-expanded="false" aria-controls="eventListbox" aria-label="${
            escapeAttr(this.getAttribute('label') || 'Event to count down to')
          }" />
        <svg class="chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M6 9l6 6 6-6"/>
        </svg>
      </div>
      <div class="dropdown" id="eventListbox" role="listbox" aria-label="Events"></div>
      <div class="sr-only" role="status" aria-live="polite"></div>
    `;

    this.input = this.shadowRoot.querySelector('input');
    this.dropdown = this.shadowRoot.querySelector('.dropdown');
    this.chevron = this.shadowRoot.querySelector('.chevron');
    this.status = this.shadowRoot.querySelector('[role="status"]');
  }

  // The active option is announced through aria-activedescendant. Focus
  // stays in the field, so typing keeps working.
  syncActiveOption() {
    if (!this.input) return;
    const active = this.isOpen ? this.dropdown.querySelector('.item.highlighted') : null;
    if (active && active.id) this.input.setAttribute('aria-activedescendant', active.id);
    else this.input.removeAttribute('aria-activedescendant');
  }

  announceCount() {
    if (!this.status || !this.isOpen) return;
    const count = this.menuEvents().length;
    this.status.textContent =
      count === 0 ? 'No events found' : count === 1 ? '1 event' : `${count} events`;
  }

  groupEventsByCategory(events) {
    const groups = {};
    events.forEach((event) => {
      const cat = event.category || 'other';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(event);
    });
    return groups;
  }

  renderDropdown() {
    if (!this.dropdown) return;

    if (this.filteredEvents.length === 0) {
      this.visibleEvents = [];
      this.dropdown.innerHTML = '<div class="no-results" role="presentation">No events found</div>';
      this.syncActiveOption();
      return;
    }

    // Group events by category
    const grouped = this.groupEventsByCategory(this.filteredEvents);

    // Render with category headers. The highlight follows this painted
    // order, which is not the date order stored in filteredEvents.
    let html = '';
    const visibleEvents = [];

    // Custom events first if any
    const categoryOrder = [
      'custom',
      'seasonal',
      'cultural',
      'religious',
      'national',
      'international',
      'family',
      'fun',
      'other'
    ];

    categoryOrder.forEach((category) => {
      const events = grouped[category];
      if (!events || events.length === 0) return;

      html += `<div role="group" aria-labelledby="cat-${category}">`;
      html += `<div class="category-header" id="cat-${category}" role="presentation">${this.getCategoryLabel(
        category
      )}</div>`;

      events.forEach((event) => {
        const index = visibleEvents.length;
        visibleEvents.push(event);
        const isCustom = event.category === 'custom';
        const eventDateObj = new Date(event.date);
        const formattedDate = Number.isFinite(eventDateObj.getTime())
          ? new Intl.DateTimeFormat(localeService.locale, {
              month: 'long',
              day: 'numeric',
              year: 'numeric'
            }).format(eventDateObj)
          : '';
        const highlighted = index === this.highlightedIndex;
        const label = this.getEventLabel(event);
        html += `
          <div class="item${highlighted ? ' highlighted' : ''}${
          this.selectedEvent?.id === event.id ? ' selected' : ''
        }" id="event-option-${index}" role="option" aria-selected="${highlighted}"
            data-id="${event.id}" data-index="${index}">
            <span class="emoji" aria-hidden="true">${event.emoji}</span>
            <div class="info">
              <div class="name">${label}</div>
              <div class="date">${formattedDate}</div>
            </div>
            <span class="days-badge">${this.getDaysAway(event.date)}</span>
            ${
              isCustom
                ? `<button class="delete-btn" data-delete-id="${
                    event.id
                  }" tabindex="-1" aria-label="Delete ${escapeAttr(
                    label
                  )}" title="Delete">✕</button>`
                : ''
            }
          </div>
        `;
      });
      html += '</div>';
    });

    this.visibleEvents = visibleEvents;
    this.dropdown.innerHTML = html;
    this.syncActiveOption();
  }

  filterEvents(query) {
    this.cancelPendingFilter();
    const sorted = [...this.events].sort((a, b) => dayjs(a.date).diff(dayjs(b.date)));

    const queryText = searchText(query);
    if (!queryText) {
      this.filteredEvents = sorted;
    } else {
      this.filteredEvents = sorted.filter((event) => {
        const localizedLabel = searchText(this.getEventLabel(event));
        return (
          searchText(event.label).includes(queryText) ||
          searchText(event.name).includes(queryText) ||
          localizedLabel.includes(queryText)
        );
      });
    }

    this.highlightedIndex = this.filteredEvents.length > 0 ? 0 : -1;
    this.renderDropdown();
    if (queryText) this.announceCount();
  }

  scheduleFilter(query) {
    this.cancelPendingFilter();
    this._pendingFilterQuery = query;
    this._filterTimer = setTimeout(() => {
      const pendingQuery = this._pendingFilterQuery;
      this._filterTimer = null;
      this._pendingFilterQuery = null;
      this.filterEvents(pendingQuery);
    }, FILTER_DEBOUNCE_MS);
  }

  flushPendingFilter() {
    if (this._pendingFilterQuery === null) return false;

    const pendingQuery = this._pendingFilterQuery;
    this.cancelPendingFilter();
    this.filterEvents(pendingQuery);
    return true;
  }

  cancelPendingFilter() {
    if (this._filterTimer !== null) {
      clearTimeout(this._filterTimer);
      this._filterTimer = null;
    }
    this._pendingFilterQuery = null;
  }

  open(resetFilter = true) {
    this.isOpen = true;
    this.dropdown.classList.add('open');
    this.chevron.classList.add('open');
    this.input.setAttribute('aria-expanded', 'true');
    // Show all events when opening - user can type to filter
    if (resetFilter) {
      this.filterEvents('');
      this.highlightSelected();
    }
    this.syncActiveOption();
    this.announceCount();
  }

  menuEvents() {
    return this.visibleEvents || this.filteredEvents;
  }

  highlightedEvent() {
    const events = this.menuEvents();
    if (this.highlightedIndex < 0 || this.highlightedIndex >= events.length) return null;
    return events[this.highlightedIndex] || null;
  }

  highlightSelected() {
    const events = this.menuEvents();
    if (!events.length) return;
    const selected = this.selectedEvent
      ? events.findIndex((event) => event.id === this.selectedEvent.id)
      : -1;
    const next = selected >= 0 ? selected : 0;
    if (next !== this.highlightedIndex) {
      this.highlightedIndex = next;
      this.renderDropdown();
    }
    this.scrollToHighlighted();
  }

  // Arrows and OK follow the painted rows. The listener is on window
  // during capture so a focused shadow input cannot lose the arrow to
  // page focus movement before this menu sees it.
  handleMenuKey(event) {
    if (!this.isOpen || event.defaultPrevented) return false;
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    const key = event.key;
    if (key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.close();
      return true;
    }
    // Left and Right move the caret in the field. remote.js moves focus
    // once the caret is already at that end.
    const inField = this.shadowRoot.activeElement === this.input;
    if ((key === 'ArrowLeft' || key === 'ArrowRight') && inField) return false;
    if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'Enter') {
      this.flushPendingFilter();
    }
    if (key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      const choice = this.highlightedEvent();
      if (choice) this.selectEvent(choice.id);
      return true;
    }
    const jump = (key === 'Home' || key === 'End') && !inField;
    const edge = jump ? homeEndKey(event, this.menuEvents().length) : null;
    const next =
      edge !== null ? edge : dropdownArrow(event, this.highlightedIndex, this.menuEvents().length);
    if (next === null) return false;
    if (next === 'leave') {
      this.close();
      return false;
    }
    event.preventDefault();
    this.highlightedIndex = next;
    this.renderDropdown();
    this.scrollToHighlighted();
    return true;
  }

  close() {
    this.cancelPendingFilter();
    this.isOpen = false;
    this.dropdown.classList.remove('open');
    this.chevron.classList.remove('open');
    this.input.setAttribute('aria-expanded', 'false');
    this.highlightedIndex = 0;
    this.syncActiveOption();
    // Restore selected event text if nothing new was selected
    this.updateInputDisplay();
  }

  selectEvent(eventId) {
    this.cancelPendingFilter();
    const event = this.events.find((e) => e.id === eventId);
    if (event) {
      this.selectedEvent = event;
      this.updateInputDisplay();
      this.close();
      this.dispatchEvent(
        new CustomEvent('event-selected', {
          detail: event,
          bubbles: true,
          composed: true
        })
      );
    }
  }

  focusSearch() {
    if (!this.input) return;
    const view = this.ownerDocument && this.ownerDocument.defaultView;
    const active = view && view.document.activeElement;
    if (active === this) this.input.focus();
  }

  // A letter typed while the host itself is focused never reaches the inner field.
  takeTypedKey(event) {
    if (!this.input || !event.key || event.key.length !== 1) return false;
    if (event.metaKey || event.ctrlKey || event.altKey) return false;
    if (this.shadowRoot.activeElement === this.input) return false;
    event.preventDefault();
    this._suppressSelectAll = true;
    this.input.focus();
    this.input.value = event.key;
    this.input.setSelectionRange(event.key.length, event.key.length);
    this.input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  scrollToHighlighted() {
    const highlighted = this.dropdown.querySelector('.highlighted');
    if (highlighted) {
      highlighted.scrollIntoView({ block: 'nearest' });
    }
  }

  setupEventListeners() {
    // Track if we should select on mouseup (for click-to-select-all behavior)
    let shouldSelectAll = false;

    // Focus selects the text. It does not open the list: an arrow must be
    // able to leave, and only Enter, Space, or OK opens the menu.
    this.input.addEventListener('focus', () => {
      if (this._suppressSelectAll) {
        this._suppressSelectAll = false;
        shouldSelectAll = false;
        return;
      }
      shouldSelectAll = true;
      setTimeout(() => {
        if (shouldSelectAll) {
          this.input.select();
        }
      }, 0);
    });

    // Select all on mouseup (after click completes)
    this.input.addEventListener('mouseup', (e) => {
      if (shouldSelectAll) {
        e.preventDefault();
        this.input.select();
        shouldSelectAll = false;
      }
    });

    this.input.addEventListener('click', () => {
      if (!this.isOpen) {
        this.open();
      }
    });

    // Input filtering - clear selection state when user types
    this.input.addEventListener('input', (e) => {
      const query = e.target.value;
      if (!this.isOpen) {
        this.open(false);
      }
      this.scheduleFilter(query);
    });

    // Keyboard navigation - let browser handle modifier keys (Ctrl+A, Cmd+C, etc.)
    this.input.addEventListener('keydown', (e) => {
      if (e.altKey && e.key === 'ArrowDown' && !this.isOpen) {
        e.preventDefault();
        this.open();
        return;
      }
      // Allow all modifier key combinations (Ctrl, Cmd, Alt) to work normally
      if (e.ctrlKey || e.metaKey || e.altKey) {
        return;
      }

      // User is typing without modifiers, don't auto-select on next focus
      shouldSelectAll = false;

      // A closed field lets arrows move focus. Enter and Space open it.
      if (!this.isOpen && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        this.open();
        return;
      }

      if (!this.isOpen && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        return;
      }

      if (this.handleMenuKey(e)) return;

      if (e.key === 'Tab') this.close();
    });

    // Click outside to close (with cleanup)
    if (this._clickOutsideCleanup) this._clickOutsideCleanup();
    this._clickOutsideCleanup = onClickOutside(this, () => {
      if (this.isOpen) this.close();
    });

    if (this._releaseKeys) this._releaseKeys();
    this._releaseKeys = claimKeys(this, (event) => this.handleMenuKey(event));

    // Listeners on the host survive a re-render, so they are added once.
    if (!this._hostBound) {
      this._hostBound = true;
      this.bindHostListeners();
    }

    this.setupDropdownListeners();
  }

  bindHostListeners() {
    // Focus moving to another control closes the list. Wait a tick so a
    // mouse click on a row is not lost while focus settles.
    this.addEventListener('focusout', () => {
      setTimeout(() => {
        if (this.isOpen && !this.shadowRoot.activeElement) this.close();
      }, 0);
    });

    // OK on a remote clicks this field. The click's first target is often
    // the input inside the shadow tree, not the host. A click on a row
    // still belongs to that row.
    this.addEventListener('click', (event) => {
      const origin = event.composedPath()[0];
      if (!origin || origin.nodeType !== 1) return;
      if (origin.closest && origin.closest('.item, .delete-btn, .dropdown')) return;
      if (!this.isOpen) {
        this.open();
        return;
      }
      // A mouse click on the text places the caret. The remote's OK is a
      // click on the host, or a click that did not come from the mouse.
      if (origin === this.input && event.isTrusted && event.detail > 0) return;
      const choice = this.highlightedEvent();
      if (choice) this.selectEvent(choice.id);
      else this.close();
    });

    this.addEventListener('keydown', (event) => {
      if (this.takeTypedKey(event)) return;
      this.handleMenuKey(event);
    });
  }

  setupDropdownListeners() {
    // Dropdown item interactions
    this.dropdown.addEventListener('click', (e) => {
      // Check if delete button was clicked
      const deleteBtn = e.target.closest('.delete-btn');
      if (deleteBtn) {
        e.stopPropagation();
        const eventId = deleteBtn.dataset.deleteId;
        this.dispatchEvent(
          new CustomEvent('event-delete', {
            detail: { id: eventId },
            bubbles: true,
            composed: true
          })
        );
        return;
      }

      const item = e.target.closest('.item');
      if (item) {
        this.selectEvent(item.dataset.id);
      }
    });

    this.dropdown.addEventListener('mousemove', (e) => {
      const item = e.target.closest('.item');
      if (item) {
        const newIndex = parseInt(item.dataset.index, 10);
        if (newIndex !== this.highlightedIndex) {
          this.highlightedIndex = newIndex;
          this.renderDropdown();
        }
      }
    });
  }
}

customElements.define('event-autocomplete', EventAutocomplete);

export default EventAutocomplete;

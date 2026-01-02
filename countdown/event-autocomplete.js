import dayjs from 'dayjs';
import { getLocalizedEventLabel, CATEGORY_EMOJIS } from './events.js';
import { localeService } from './i18n/locale-service.js';
import { onClickOutside, dropdownStyles, chevronStyles } from './components/shared-styles.js';

/**
 * Event Autocomplete Web Component
 * A searchable dropdown for selecting countdown events
 */
class EventAutocomplete extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.events = [];
    this.filteredEvents = [];
    this.highlightedIndex = 0;
    this.selectedEvent = null;
    this.isOpen = false;
    this._clickOutsideCleanup = null;
  }

  async connectedCallback() {
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

    // Subscribe to locale changes
    this._localeUnsubscribe = localeService.subscribe(() => {
      this.renderDropdown();
      if (this.selectedEvent) {
        this.updateInputDisplay();
      }
    });
  }

  disconnectedCallback() {
    if (this._localeUnsubscribe) this._localeUnsubscribe();
    if (this._clickOutsideCleanup) this._clickOutsideCleanup();
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
    this.events = events;
    // Sort by date (nearest first)
    this.filteredEvents = [...events].sort((a, b) => dayjs(a.date).diff(dayjs(b.date)));
    this.renderDropdown();
  }

  setSelectedEvent(event) {
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
    const days = Math.ceil(dayjs(date).diff(dayjs(), 'day', true));
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
      </style>

      <div class="input-wrapper">
        <input type="text" placeholder="${
          this.getAttribute('placeholder') || 'Search events...'
        }" autocomplete="off" />
        <svg class="chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M6 9l6 6 6-6"/>
        </svg>
      </div>
      <div class="dropdown"></div>
    `;

    this.input = this.shadowRoot.querySelector('input');
    this.dropdown = this.shadowRoot.querySelector('.dropdown');
    this.chevron = this.shadowRoot.querySelector('.chevron');
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
      this.dropdown.innerHTML = '<div class="no-results">No events found</div>';
      return;
    }

    // Group events by category
    const grouped = this.groupEventsByCategory(this.filteredEvents);

    // Render with category headers
    let html = '';
    let globalIndex = 0;

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

      html += `<div class="category-header">${this.getCategoryLabel(category)}</div>`;

      events.forEach((event) => {
        const isCustom = event.category === 'custom';
        const formattedDate = new Intl.DateTimeFormat(localeService.locale, {
          month: 'long',
          day: 'numeric',
          year: 'numeric'
        }).format(new Date(event.date));
        html += `
          <div class="item${globalIndex === this.highlightedIndex ? ' highlighted' : ''}${
          this.selectedEvent?.id === event.id ? ' selected' : ''
        }" data-id="${event.id}" data-index="${globalIndex}">
            <span class="emoji">${event.emoji}</span>
            <div class="info">
              <div class="name">${this.getEventLabel(event)}</div>
              <div class="date">${formattedDate}</div>
            </div>
            <span class="days-badge">${this.getDaysAway(event.date)}</span>
            ${
              isCustom
                ? `<button class="delete-btn" data-delete-id="${event.id}" title="Delete">✕</button>`
                : ''
            }
          </div>
        `;
        globalIndex++;
      });
    });

    this.dropdown.innerHTML = html;
  }

  filterEvents(query) {
    const sorted = [...this.events].sort((a, b) => dayjs(a.date).diff(dayjs(b.date)));

    if (!query.trim()) {
      this.filteredEvents = sorted;
    } else {
      const lowerQuery = query.toLowerCase();
      this.filteredEvents = sorted.filter((event) => {
        const localizedLabel = this.getEventLabel(event).toLowerCase();
        return (
          event.label.toLowerCase().includes(lowerQuery) ||
          event.name.toLowerCase().includes(lowerQuery) ||
          localizedLabel.includes(lowerQuery)
        );
      });
    }

    this.highlightedIndex = this.filteredEvents.length > 0 ? 0 : -1;
    this.renderDropdown();
  }

  open() {
    this.isOpen = true;
    this.dropdown.classList.add('open');
    this.chevron.classList.add('open');
    // Show all events when opening - user can type to filter
    this.filterEvents('');
  }

  close() {
    this.isOpen = false;
    this.dropdown.classList.remove('open');
    this.chevron.classList.remove('open');
    this.highlightedIndex = 0;
    // Restore selected event text if nothing new was selected
    this.updateInputDisplay();
  }

  selectEvent(eventId) {
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

  scrollToHighlighted() {
    const highlighted = this.dropdown.querySelector('.highlighted');
    if (highlighted) {
      highlighted.scrollIntoView({ block: 'nearest' });
    }
  }

  setupEventListeners() {
    // Track if we should select on mouseup (for click-to-select-all behavior)
    let shouldSelectAll = false;

    // Focus to open dropdown
    this.input.addEventListener('focus', () => {
      shouldSelectAll = true;
      this.open();
      // Use setTimeout to select after browser has finished focus handling
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
      this.filterEvents(query);
      if (!this.isOpen) {
        this.open();
      }
    });

    // Keyboard navigation - let browser handle modifier keys (Ctrl+A, Cmd+C, etc.)
    this.input.addEventListener('keydown', (e) => {
      // Allow all modifier key combinations (Ctrl, Cmd, Alt) to work normally
      if (e.ctrlKey || e.metaKey || e.altKey) {
        return;
      }

      // User is typing without modifiers, don't auto-select on next focus
      shouldSelectAll = false;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          if (!this.isOpen) {
            this.open();
          } else {
            this.highlightedIndex = Math.min(
              this.highlightedIndex + 1,
              this.filteredEvents.length - 1
            );
            this.renderDropdown();
            this.scrollToHighlighted();
          }
          break;
        case 'ArrowUp':
          e.preventDefault();
          this.highlightedIndex = Math.max(this.highlightedIndex - 1, 0);
          this.renderDropdown();
          this.scrollToHighlighted();
          break;
        case 'Enter':
          e.preventDefault();
          if (this.highlightedIndex >= 0 && this.filteredEvents[this.highlightedIndex]) {
            this.selectEvent(this.filteredEvents[this.highlightedIndex].id);
          }
          break;
        case 'Escape':
          this.close();
          this.input.blur();
          break;
        case 'Tab':
          this.close();
          break;
      }
    });

    // Click outside to close (with cleanup)
    this._clickOutsideCleanup = onClickOutside(this, () => {
      if (this.isOpen) this.close();
    });

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

/**
 * Shared CSS styles and utilities for countdown display components.
 * Import and include in component's shadow DOM styles.
 */

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Register a click-outside handler that auto-cleans up.
 * Returns a cleanup function to remove the listener.
 *
 * @param {HTMLElement} element - The element to detect clicks outside of
 * @param {Function} callback - Called when click occurs outside element
 * @returns {Function} Cleanup function to remove the listener
 */
export function onClickOutside(element, callback) {
  const handler = (e) => {
    if (!element.contains(e.target)) {
      callback(e);
    }
  };
  document.addEventListener('click', handler);
  return () => document.removeEventListener('click', handler);
}

// ============================================================================
// DROPDOWN STYLES (shared across selector components)
// ============================================================================

/**
 * Dropdown container styles - used by event-autocomplete, display-mode-selector, locale-selector
 */
export const dropdownStyles = `
  .dropdown {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    background: rgba(15, 23, 42, 0.98);
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 12px;
    backdrop-filter: blur(20px);
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
    display: none;
    overflow: hidden;
    max-height: 320px;
    overflow-y: auto;
    z-index: 100;
  }

  .dropdown.open {
    display: block;
    animation: slideDown 0.15s ease;
  }

  @keyframes slideDown {
    from {
      opacity: 0;
      transform: translateY(-8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  /* Scrollbar styling */
  .dropdown::-webkit-scrollbar {
    width: 8px;
  }

  .dropdown::-webkit-scrollbar-track {
    background: transparent;
  }

  .dropdown::-webkit-scrollbar-thumb {
    background: rgba(245, 158, 11, 0.3);
    border-radius: 4px;
  }

  .dropdown-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    cursor: pointer;
    transition: background 0.15s ease;
    border-bottom: 1px solid rgba(148, 163, 184, 0.1);
  }

  .dropdown-item:last-child {
    border-bottom: none;
  }

  .dropdown-item:hover {
    background: rgba(245, 158, 11, 0.1);
  }

  .dropdown-item.selected {
    background: rgba(245, 158, 11, 0.15);
  }

  .dropdown-item.highlighted {
    background: rgba(245, 158, 11, 0.12);
  }
`;

/**
 * Chevron icon styles for dropdowns
 */
export const chevronStyles = `
  .chevron {
    font-size: 0.7rem;
    color: #64748b;
    transition: transform 0.2s ease;
  }

  .chevron.open {
    transform: rotate(180deg);
  }
`;

/**
 * Selector button base styles
 */
export const selectorButtonStyles = `
  .selector-btn,
  .selector-button {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    color: #94a3b8;
    font-size: 0.85rem;
    font-family: 'Outfit', sans-serif;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .selector-btn:hover,
  .selector-button:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #f8fafc;
  }

  .selector-btn:focus,
  .selector-button:focus {
    outline: none;
    border-color: #f59e0b;
    box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.2);
  }
`;

// ============================================================================
// DISPLAY COMPONENT STYLES
// ============================================================================

/**
 * Base host styles - flex centering with minimum height
 * @param {number} minHeight - Minimum height in pixels (default: 120)
 */
export const hostStyles = (minHeight = 120) => `
  :host {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: ${minHeight}px;
  }
`;

/**
 * Hidden utility class
 */
export const hiddenClass = `
  .hidden {
    display: none !important;
  }
`;

/**
 * Standard time value typography (large numbers)
 */
export const timeValueStyles = `
  .time-value {
    font-family: 'Share Tech Mono', ui-monospace, 'Menlo', monospace;
    font-weight: 700;
    color: #f8fafc;
    line-height: 1;
    text-shadow: 0 0 40px rgba(245, 158, 11, 0.4);
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.05em;
  }
`;

/**
 * Standard time label typography
 */
export const timeLabelStyles = `
  .time-label {
    font-family: 'Outfit', sans-serif;
    font-size: 0.8rem;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.15em;
    margin-top: 8px;
  }
`;

/**
 * Blinking separator animation
 */
export const separatorStyles = `
  .time-separator {
    font-family: 'Orbitron', monospace;
    font-size: clamp(2rem, 6vw, 3.5rem);
    color: #f59e0b;
    opacity: 0.6;
    animation: blink 1s infinite;
    flex-shrink: 0;
    padding: 0 4px;
    line-height: 1;
    align-self: center;
  }

  @keyframes blink {
    0%, 100% { opacity: 0.6; }
    50% { opacity: 0.2; }
  }
`;

/**
 * Fullscreen scaling for time values
 */
export const fullscreenStyles = `
  :host-context(.countdown-display.fullscreen) .time-value {
    font-size: clamp(4rem, 12vw, 8rem);
  }

  :host-context(.countdown-display.fullscreen) .time-label {
    font-size: 1.1rem;
    margin-top: 16px;
  }

  :host-context(.countdown-display.fullscreen) .time-separator {
    font-size: clamp(3rem, 8vw, 5rem);
  }
`;

/**
 * Mobile responsive grid styles
 */
export const mobileGridStyles = `
  @media (max-width: 700px) {
    .time-separator {
      display: none;
    }

    .countdown-grid {
      gap: 8px;
      flex-wrap: wrap;
      justify-content: center;
    }

    .time-unit {
      width: 72px;
      min-width: 72px;
      background: rgba(15, 23, 42, 0.5);
      padding: 12px 8px;
      border-radius: 12px;
      border: 1px solid rgba(148, 163, 184, 0.1);
    }

    .time-unit.days,
    .time-unit.years {
      width: 86px;
      min-width: 86px;
    }

    .time-value {
      font-size: 1.8rem;
    }
  }
`;

/**
 * Common color variables as CSS custom properties
 */
export const colorVariables = `
  :host {
    --color-bg-deep: #030712;
    --color-bg-surface: rgba(15, 23, 42, 0.7);
    --color-accent-primary: #f59e0b;
    --color-accent-secondary: #fbbf24;
    --color-accent-glow: rgba(245, 158, 11, 0.4);
    --color-text-primary: #f8fafc;
    --color-text-secondary: #94a3b8;
    --color-text-muted: #64748b;
    --color-border-subtle: rgba(148, 163, 184, 0.1);
    --color-border-accent: rgba(245, 158, 11, 0.3);
  }
`;

/**
 * Combine multiple style fragments
 * @param {...string} styles - Style strings to combine
 * @returns {string} Combined styles
 */
export function combineStyles(...styles) {
  return styles.join('\n');
}

/**
 * Standard display component styles bundle
 * Includes: host, hidden, colors, time value/label, separator, fullscreen, mobile
 */
export const STANDARD_STYLES = combineStyles(
  hostStyles(120),
  hiddenClass,
  colorVariables,
  timeValueStyles,
  timeLabelStyles,
  separatorStyles,
  fullscreenStyles,
  mobileGridStyles
);

export default STANDARD_STYLES;

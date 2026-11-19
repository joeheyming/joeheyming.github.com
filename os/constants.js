/**
 * Heyming OS - Constants and Configuration
 * Shared constants used across all OS modules.
 *
 * Message names live in `/shared/os-protocol.js` (`window.HeymingOsProtocol`).
 * This module only looks them up.
 */

/** @returns {NonNullable<Window['HeymingOsProtocol']>} */
export function osProtocol() {
  const api = globalThis.window?.HeymingOsProtocol;
  if (!api) throw new Error('Heyming OS protocol did not load');
  return api;
}

export const Constants = {
  // Layout dimensions
  TASKBAR_HEIGHT: 48,
  TITLE_BAR_HEIGHT: 40,

  // Window constraints
  MIN_WINDOW_WIDTH: 400,
  MIN_WINDOW_HEIGHT: 300,
  DEFAULT_WINDOW_WIDTH: 900,
  DEFAULT_WINDOW_HEIGHT: 700,

  // Spacing and margins
  WINDOW_MARGIN: 10,
  SIDE_MARGIN: 40,
  TOP_MARGIN: 80,
  CASCADE_STEP: 30,

  // Desktop icon layout
  ICON_SPACING_X: 90,
  ICON_SPACING_Y: 100,
  ICONS_PER_ROW: 6,
  ICON_START_X: 150,
  ICON_START_Y: 30,
  SYSTEM_ICON_X: 30,

  // Mobile icon layout
  MOBILE_ICON_SPACING_X: 80,
  MOBILE_ICON_SPACING_Y: 100,
  MOBILE_ICON_START_X: 20,
  MOBILE_ICON_START_Y: 20,
  MOBILE_MIN_ICONS_PER_ROW: 2,
  MOBILE_ICON_MARGIN: 40,

  // Icon label truncation
  ICON_LABEL_MAX_LENGTH: 12,
  ICON_LABEL_TRUNCATE_AT: 10,

  // Arrow key navigation threshold (pixels)
  ARROW_NAV_THRESHOLD: 20,

  // Mobile breakpoint (pixels)
  MOBILE_BREAKPOINT: 768,

  // Desktop file icon positioning (right side)
  FILE_ICON_RIGHT_OFFSET: 120,
  FILE_ICON_START_Y: 30,
  FILE_ICON_SPACING: 90,

  // Animation timings (ms)
  ANIMATION_DURATION: 300,
  NOTIFICATION_DURATION: 3000,
  RESIZE_DEBOUNCE: 250,

  // Z-index layers
  Z_INDEX_WINDOW: 100,
  Z_INDEX_ACTIVE_WINDOW: 200,
  Z_INDEX_LAUNCHER: 1000,
  Z_INDEX_DIALOG: 2000,
  Z_INDEX_NOTIFICATION: 3000,
  Z_INDEX_SCREENSAVER: 3500,

  ICON_SIZE_LAYOUT: {
    s: {
      tile: 48,
      font: 32,
      spacingX: 72,
      spacingY: 84,
      fileSpacing: 76,
      rightOffset: 96,
      label: 11
    },
    m: {
      tile: 64,
      font: 48,
      spacingX: 90,
      spacingY: 100,
      fileSpacing: 90,
      rightOffset: 120,
      label: 11
    },
    l: {
      tile: 80,
      font: 64,
      spacingX: 110,
      spacingY: 124,
      fileSpacing: 110,
      rightOffset: 140,
      label: 12
    }
  },

  // Overlap threshold for window positioning (percentage)
  OVERLAP_THRESHOLD: 0.25,

  // Category display order
  CATEGORY_ORDER: ['game', 'utility', 'entertainment'],

  // Category display names
  CATEGORY_NAMES: {
    game: '🎮 Games',
    utility: '🛠️ Utilities',
    entertainment: '🎪 Entertainment'
  },

  // Notification colors
  NOTIFICATION_COLORS: {
    info: '#3182ce',
    success: '#10b981',
    error: '#ef4444',
    warning: '#f59e0b',
    system: '#8b5cf6'
  }
};

// Freeze to prevent accidental modification
Object.freeze(Constants);
Object.freeze(Constants.CATEGORY_ORDER);
Object.freeze(Constants.CATEGORY_NAMES);
Object.freeze(Constants.NOTIFICATION_COLORS);
Object.freeze(Constants.ICON_SIZE_LAYOUT);
Object.freeze(Constants.ICON_SIZE_LAYOUT.s);
Object.freeze(Constants.ICON_SIZE_LAYOUT.m);
Object.freeze(Constants.ICON_SIZE_LAYOUT.l);

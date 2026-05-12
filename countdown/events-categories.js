import { localeService } from './i18n/locale-service.js';

// ============================================================================
// LOCALIZED EVENT NAME HELPER
// ============================================================================

/**
 * Get localized event label using centralized strings
 * @param {string} eventId - The event ID
 * @returns {string} The localized event label
 */
export function getLocalizedEventLabel(eventId) {
  return localeService.str(`events.${eventId}`);
}

// ============================================================================
// CATEGORY DEFINITIONS
// ============================================================================

/**
 * Category emojis - used for visual identification in dropdowns
 */
export const CATEGORY_EMOJIS = {
  seasonal: '🗓️',
  cultural: '🌍',
  religious: '🕊️',
  national: '🏛️',
  international: '🌐',
  family: '👨‍👩‍👧',
  fun: '🎈',
  custom: '⭐',
  other: '📌'
};

import dayjs from 'dayjs';
import { getPresetEvents } from './events-presets.js';

// ============================================================================
// CUSTOM EVENTS
// ============================================================================

/**
 * Get custom events stored in localStorage
 * Filters out past events automatically
 */
export function getCustomEvents() {
  try {
    const saved = localStorage.getItem('countdown-custom-events');
    if (saved) {
      const events = JSON.parse(saved);
      const now = dayjs();
      // Filter out past events and return valid ones
      return events.filter((e) => dayjs(e.date).isAfter(now));
    }
  } catch (e) {
    console.error('Error loading custom events:', e);
  }
  return [];
}

/**
 * Save a custom event to localStorage
 */
export function saveCustomEvent(event) {
  const customEvents = getCustomEvents();
  // Remove any existing event with same id
  const filtered = customEvents.filter((e) => e.id !== event.id);
  filtered.push(event);
  localStorage.setItem('countdown-custom-events', JSON.stringify(filtered));
}

/**
 * Delete a custom event from localStorage
 */
export function deleteCustomEvent(eventId) {
  const customEvents = getCustomEvents();
  const filtered = customEvents.filter((e) => e.id !== eventId);
  localStorage.setItem('countdown-custom-events', JSON.stringify(filtered));
}

/**
 * Get all events (presets + custom)
 */
export function getAllEvents() {
  const presets = getPresetEvents();
  const custom = getCustomEvents().map((e) => ({
    ...e,
    category: 'custom'
  }));
  // Drop any event with a missing or unparseable date so downstream
  // formatters (Intl.DateTimeFormat, etc.) can't throw "Invalid time value".
  return [...presets, ...custom].filter((e) => {
    if (!e || !e.date) return false;
    const t = new Date(e.date).getTime();
    return Number.isFinite(t);
  });
}

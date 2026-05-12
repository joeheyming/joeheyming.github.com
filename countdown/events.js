/**
 * Events Module - Holiday definitions and date calculations
 * Contains all preset events, custom event management, and date calculation utilities
 *
 * Event name translations are in i18n/translations/{locale}.json under "events" section.
 * To add a new translation, edit the corresponding language file.
 */
export { getLocalizedEventLabel, CATEGORY_EMOJIS } from './events-categories.js';
export { getPresetEvents } from './events-presets.js';
export {
  getCustomEvents,
  saveCustomEvent,
  deleteCustomEvent,
  getAllEvents
} from './events-storage.js';

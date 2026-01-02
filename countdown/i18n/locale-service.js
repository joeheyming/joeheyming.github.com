/**
 * Locale Service - Manages internationalization for countdown app
 *
 * Translations are loaded from individual JSON files in the translations/ folder.
 * Each language has its own file (e.g., en.json, es.json, ru.json).
 *
 * Usage:
 *   localeService.str('ui.title')           // Get UI string
 *   localeService.str('events.christmas')   // Get event name
 *   localeService.t(localStrings, 'key')    // Fallback for component-local strings
 */

// Cache for loaded translations
const translationsCache = {};
let englishStrings = null;

// Load a translation file
async function loadTranslation(locale) {
  if (translationsCache[locale]) {
    return translationsCache[locale];
  }

  try {
    const response = await fetch(new URL(`./translations/${locale}.json`, import.meta.url));
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    translationsCache[locale] = data;
    return data;
  } catch (e) {
    console.warn(`Could not load translations for ${locale}:`, e.message);
    return null;
  }
}

// Load English as base (always needed for fallback)
const initPromise = loadTranslation('en').then((data) => {
  englishStrings = data || {};
});

// Supported languages - only those with translation files in translations/
export const SUPPORTED_LOCALES = [
  { code: 'en', name: 'English', nativeName: 'English', rtl: false },
  { code: 'es', name: 'Spanish', nativeName: 'Español', rtl: false },
  { code: 'fr', name: 'French', nativeName: 'Français', rtl: false },
  { code: 'de', name: 'German', nativeName: 'Deutsch', rtl: false },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', rtl: false },
  { code: 'ko', name: 'Korean', nativeName: '한국어', rtl: false },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português', rtl: false },
  { code: 'ru', name: 'Russian', nativeName: 'Русский', rtl: false },
  { code: 'ja', name: 'Japanese', nativeName: '日本語', rtl: false },
  { code: 'zh', name: 'Chinese', nativeName: '中文', rtl: false },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', rtl: true }
].sort((a, b) => a.name.localeCompare(b.name));

class LocaleService {
  constructor() {
    this._locale = this.detectLocale();
    this._n2words = null;
    this._listeners = new Set();
  }

  detectLocale() {
    // Check localStorage first
    const saved = localStorage.getItem('countdown-locale');
    if (saved && SUPPORTED_LOCALES.find((l) => l.code === saved)) {
      return saved;
    }

    // Try browser language
    const browserLang = navigator.language.split('-')[0];
    if (SUPPORTED_LOCALES.find((l) => l.code === browserLang)) {
      return browserLang;
    }

    return 'en';
  }

  get locale() {
    return this._locale;
  }

  set locale(code) {
    if (this._locale !== code && SUPPORTED_LOCALES.find((l) => l.code === code)) {
      this._locale = code;
      localStorage.setItem('countdown-locale', code);
      // Load translations for new locale, then notify
      loadTranslation(code).then(() => {
        this._notifyListeners();
      });
    }
  }

  get localeInfo() {
    return SUPPORTED_LOCALES.find((l) => l.code === this._locale) || SUPPORTED_LOCALES[0];
  }

  get isRTL() {
    return this.localeInfo.rtl;
  }

  // Subscribe to locale changes
  subscribe(callback) {
    this._listeners.add(callback);
    return () => this._listeners.delete(callback);
  }

  _notifyListeners() {
    this._listeners.forEach((cb) => cb(this._locale));
  }

  // Set n2words module (loaded dynamically)
  setN2Words(n2words) {
    this._n2words = n2words;
  }

  /**
   * Wait for strings to be loaded
   * @returns {Promise} Resolves when strings are loaded
   */
  async ready() {
    await initPromise;
    await this._ensureLocaleLoaded();
  }

  // Ensure current locale is loaded
  async _ensureLocaleLoaded() {
    if (this._locale !== 'en' && !translationsCache[this._locale]) {
      await loadTranslation(this._locale);
    }
  }

  /**
   * Get a string from the translation files.
   * Uses dot notation to access nested keys.
   *
   * @param {string} path - Dot-separated path like 'ui.title' or 'events.christmas'
   * @returns {string} The translated string or the path if not found
   */
  str(path) {
    const keys = path.split('.');
    const localeData = translationsCache[this._locale] || {};

    // Helper to get nested value
    const getValue = (obj, keys) => {
      let value = obj;
      for (const key of keys) {
        if (value && typeof value === 'object' && key in value) {
          value = value[key];
        } else {
          return undefined;
        }
      }
      return typeof value === 'string' ? value : undefined;
    };

    // Try current locale first, then English fallback
    return getValue(localeData, keys) || getValue(englishStrings, keys) || path;
  }

  /**
   * Get an entire section from the translations.
   *
   * @param {string} section - Section name like 'ui', 'events', 'categories'
   * @returns {Object} The section object with English fallback for missing keys
   */
  getSection(section) {
    const localeData = translationsCache[this._locale]?.[section] || {};
    const englishData = englishStrings?.[section] || {};
    return { ...englishData, ...localeData };
  }

  /**
   * Get a translated string from a translations object.
   * Falls back to English if the current locale isn't available.
   *
   * Usage:
   *   const STRINGS = {
   *     en: { greeting: 'Hello', farewell: 'Goodbye' },
   *     es: { greeting: 'Hola', farewell: 'Adiós' },
   *     fr: { greeting: 'Bonjour' } // farewell will fall back to English
   *   };
   *   localeService.t(STRINGS, 'greeting') // Returns 'Hola' if locale is 'es'
   *   localeService.t(STRINGS, 'farewell') // Returns 'Goodbye' if locale is 'fr' (fallback)
   *
   * @param {Object} translations - Object with locale codes as keys, each containing string keys
   * @param {string} key - The string key to look up
   * @returns {string} The translated string or the key if not found
   */
  t(translations, key) {
    const localeStrings = translations[this._locale];
    const englishStrings = translations.en || {};

    // Try current locale first, then English, then return key
    if (localeStrings && localeStrings[key] !== undefined) {
      return localeStrings[key];
    }
    if (englishStrings[key] !== undefined) {
      return englishStrings[key];
    }
    return key;
  }

  /**
   * Get all strings for current locale (with English fallback for missing keys)
   * Useful when you need multiple strings at once
   *
   * @param {Object} translations - Object with locale codes as keys
   * @returns {Object} Merged strings object
   */
  getStrings(translations) {
    const englishStrings = translations.en || {};
    const localeStrings = translations[this._locale] || {};
    return { ...englishStrings, ...localeStrings };
  }

  // Convert number to words using n2words
  numberToWords(num) {
    if (!this._n2words) {
      return num.toString();
    }

    try {
      return this._n2words(num, { lang: this._locale });
    } catch (e) {
      // Fallback if language not supported
      console.warn(`n2words doesn't support ${this._locale}, falling back to number`);
      return num.toString();
    }
  }

  // Get relative time format (for Natural display)
  getRelativeTimeFormat() {
    return new Intl.RelativeTimeFormat(this._locale, { numeric: 'auto', style: 'long' });
  }

  // Format relative time intelligently
  formatRelativeTime(totalDays, hours, minutes, seconds) {
    const rtf = this.getRelativeTimeFormat();

    if (totalDays >= 365) {
      const years = Math.floor(totalDays / 365);
      return { text: rtf.format(years, 'year'), detail: `${totalDays} days` };
    }
    if (totalDays >= 30) {
      const months = Math.floor(totalDays / 30);
      return { text: rtf.format(months, 'month'), detail: `${totalDays} days` };
    }
    if (totalDays >= 7) {
      const weeks = Math.floor(totalDays / 7);
      return { text: rtf.format(weeks, 'week'), detail: `${totalDays} days` };
    }
    if (totalDays >= 1) {
      return { text: rtf.format(totalDays, 'day'), detail: `${hours}h ${minutes}m` };
    }
    if (hours >= 1) {
      return { text: rtf.format(hours, 'hour'), detail: `${minutes}m ${seconds}s` };
    }
    if (minutes >= 1) {
      return { text: rtf.format(minutes, 'minute'), detail: `${seconds}s` };
    }
    return { text: rtf.format(seconds, 'second'), detail: '' };
  }

  // Format date using Intl.DateTimeFormat
  formatDate(date, options = {}) {
    const defaultOptions = {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    };
    return new Intl.DateTimeFormat(this._locale, { ...defaultOptions, ...options }).format(
      new Date(date)
    );
  }
}

// Singleton instance
export const localeService = new LocaleService();
export default localeService;

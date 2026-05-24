/**
 * Heyming OS - Configuration
 * Central location for all configurable values
 */

const USERNAME_KEY = 'heymingOS_username';
const HOSTNAME_KEY = 'heymingOS_hostname';

export function getSavedUsername() {
  try {
    return localStorage.getItem(USERNAME_KEY);
  } catch {
    return null;
  }
}

export function saveUsername(name) {
  try {
    localStorage.setItem(USERNAME_KEY, name);
  } catch {
    // storage unavailable
  }
}

export function getSavedHostname() {
  try {
    return localStorage.getItem(HOSTNAME_KEY);
  } catch {
    return null;
  }
}

export function saveHostname(name) {
  try {
    localStorage.setItem(HOSTNAME_KEY, name);
  } catch {
    // storage unavailable
  }
}

export function isFirstRun() {
  return !getSavedUsername();
}

export const Config = {
  // ─── Brand identity ─────────────────────────────────────────────
  // Mirror of the same values in brand.css (--brand-tagline) and
  // BRAND.md. If you change these, change all three.
  OS_NAME: 'Heyming OS',
  OS_VERSION: '1.0',
  OS_TAGLINE: 'A desktop that fits in a tab.',

  get USER() {
    return getSavedUsername() || 'user';
  },
  get HOSTNAME() {
    return getSavedHostname() || 'heyming-os';
  },

  // Computed paths (derived from USER)
  get HOME() {
    return `/home/${this.USER}`;
  },
  get DESKTOP() {
    return `${this.HOME}/Desktop`;
  },
  get DOCUMENTS() {
    return `${this.HOME}/Documents`;
  },
  get DOWNLOADS() {
    return `${this.HOME}/Downloads`;
  },
  get PICTURES() {
    return `${this.HOME}/Pictures`;
  },
  get MUSIC() {
    return `${this.HOME}/Music`;
  },
  get VIDEOS() {
    return `${this.HOME}/Videos`;
  },

  // Debug settings
  DEBUG: false,

  // Quick access folders for file dialogs/managers
  getQuickAccess() {
    return [
      { name: '🏠 Home', path: this.HOME },
      { name: '🖥️ Desktop', path: this.DESKTOP },
      { name: '📄 Documents', path: this.DOCUMENTS },
      { name: '⬇️ Downloads', path: this.DOWNLOADS },
      { name: '🖼️ Pictures', path: this.PICTURES },
      { name: '🎵 Music', path: this.MUSIC },
      { name: '🎬 Videos', path: this.VIDEOS }
    ];
  }
};

// Helper to get config from any context (iframe or main window)
export function getConfig() {
  // If we're in an iframe, try to get config from parent
  if (window.parent !== window && window.parent.HeymingOS?.Config) {
    return window.parent.HeymingOS.Config;
  }
  return Config;
}

// Shorthand for logging with DEBUG flag
export function debug(...args) {
  if (getConfig().DEBUG) {
    console.log('[HeymingOS]', ...args);
  }
}

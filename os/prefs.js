/**
 * Heyming OS user preferences (localStorage).
 * Theme stays in `hos-theme` so the home page switcher stays in sync.
 */

import { normalizeIconLayout } from './desktop-layout.js';

export const PREFS_KEY = 'heymingOS_prefs';
export const THEME_KEY = 'hos-theme';
export const MAX_WALLPAPER_DATA_URL = 2048;

export const THEMES = ['auto', 'light', 'dark'];
export const ICON_SIZES = ['s', 'm', 'l'];
export const WALLPAPER_FITS = ['cover', 'contain', 'center', 'tile'];
export const SCREENSAVER_STYLES = ['clock', 'blank'];

export const GLOW_GRADIENT = [
  'radial-gradient(ellipse at 25% 15%, rgba(124, 92, 255, 0.18) 0%, rgba(124, 92, 255, 0) 55%)',
  'radial-gradient(ellipse at 75% 85%, rgba(91, 60, 220, 0.12) 0%, rgba(91, 60, 220, 0) 60%)'
].join(', ');

export const TIGER_URL = '/assets/ghostscript_tiger.svg';

/** @typedef {{ source: 'preset'|'vfs'|'color', id?: string, path?: string, color?: string, fit: string }} WallpaperPref */
/** @typedef {{ enabled: boolean, timeoutMs: number, style: string }} ScreensaverPref */
/** @typedef {{ wallpaper: WallpaperPref, theme: string, iconSize: string, clockShowSeconds: boolean, screensaver: ScreensaverPref, desktopIconLayout: Record<string, { x: number, y: number }> }} OsPrefs */

/** @type {Record<string, { label: string, kind: 'glow'|'image'|'solid', image?: string, color?: string }>} */
export const WALLPAPER_PRESETS = {
  glow: { label: 'Violet glow', kind: 'glow' },
  tiger: { label: 'Ghostscript tiger', kind: 'image', image: TIGER_URL },
  surface: { label: 'Surface', kind: 'solid', color: 'var(--surface-0)' },
  ink: { label: 'Ink', kind: 'solid', color: 'var(--surface-1)' },
  accent: { label: 'Accent', kind: 'solid', color: 'var(--accent-primary-bg)' }
};

export const DEFAULT_PREFS = Object.freeze({
  wallpaper: Object.freeze({ source: 'preset', id: 'glow', fit: 'cover' }),
  theme: 'dark',
  iconSize: 'm',
  clockShowSeconds: false,
  screensaver: Object.freeze({
    enabled: false,
    timeoutMs: 120000,
    style: 'clock'
  }),
  desktopIconLayout: Object.freeze({})
});

/**
 * @param {string} fit
 * @returns {{ size: string, repeat: string, position: string }}
 */
export function fitToCss(fit) {
  switch (fit) {
    case 'contain':
      return { size: 'contain', repeat: 'no-repeat', position: 'center' };
    case 'center':
      return { size: 'auto', repeat: 'no-repeat', position: 'center' };
    case 'tile':
      return { size: 'auto', repeat: 'repeat', position: '0 0' };
    case 'cover':
    default:
      return { size: 'cover', repeat: 'no-repeat', position: 'center' };
  }
}

/**
 * @param {unknown} raw
 * @returns {OsPrefs}
 */
export function normalizePrefs(raw) {
  const src = raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {};
  const wallpaperIn =
    src.wallpaper && typeof src.wallpaper === 'object'
      ? /** @type {Record<string, unknown>} */ (src.wallpaper)
      : {};
  const saverIn =
    src.screensaver && typeof src.screensaver === 'object'
      ? /** @type {Record<string, unknown>} */ (src.screensaver)
      : {};

  const wallpaper = normalizeWallpaper(wallpaperIn);
  const theme = THEMES.includes(/** @type {string} */ (src.theme))
    ? /** @type {string} */ (src.theme)
    : DEFAULT_PREFS.theme;
  const iconSize = ICON_SIZES.includes(/** @type {string} */ (src.iconSize))
    ? /** @type {string} */ (src.iconSize)
    : DEFAULT_PREFS.iconSize;
  const clockShowSeconds = Boolean(src.clockShowSeconds);
  const timeoutMs = Number(saverIn.timeoutMs);
  const screensaver = {
    enabled: Boolean(saverIn.enabled),
    timeoutMs:
      Number.isFinite(timeoutMs) && timeoutMs >= 15000
        ? Math.min(timeoutMs, 30 * 60 * 1000)
        : DEFAULT_PREFS.screensaver.timeoutMs,
    style: SCREENSAVER_STYLES.includes(/** @type {string} */ (saverIn.style))
      ? /** @type {string} */ (saverIn.style)
      : DEFAULT_PREFS.screensaver.style
  };

  const desktopIconLayout = normalizeIconLayout(src.desktopIconLayout);

  return { wallpaper, theme, iconSize, clockShowSeconds, screensaver, desktopIconLayout };
}

/**
 * @param {Record<string, unknown>} wallpaperIn
 * @returns {WallpaperPref}
 */
export function normalizeWallpaper(wallpaperIn) {
  const fit = WALLPAPER_FITS.includes(/** @type {string} */ (wallpaperIn.fit))
    ? /** @type {string} */ (wallpaperIn.fit)
    : DEFAULT_PREFS.wallpaper.fit;
  const source = wallpaperIn.source;

  if (source === 'vfs') {
    const path = String(wallpaperIn.path || '');
    if (!path || path.startsWith('data:') || path.length > 1024) {
      return { ...DEFAULT_PREFS.wallpaper, fit };
    }
    return { source: 'vfs', path, fit };
  }

  if (source === 'color') {
    const color = String(wallpaperIn.color || '').trim();
    if (!color || color.length > 64 || color.startsWith('data:')) {
      return { ...DEFAULT_PREFS.wallpaper, fit };
    }
    return { source: 'color', color, fit };
  }

  const id = String(wallpaperIn.id || DEFAULT_PREFS.wallpaper.id);
  return {
    source: 'preset',
    id: WALLPAPER_PRESETS[id] ? id : DEFAULT_PREFS.wallpaper.id,
    fit
  };
}

/**
 * Reject storing image bytes in prefs JSON.
 * @param {unknown} raw
 * @returns {OsPrefs}
 */
export function prefsFromUnknown(raw) {
  if (raw && typeof raw === 'object') {
    const w = /** @type {{ wallpaper?: { path?: string, color?: string } }} */ (raw).wallpaper;
    const path = w?.path || '';
    const color = w?.color || '';
    if (
      (typeof path === 'string' &&
        path.startsWith('data:') &&
        path.length > MAX_WALLPAPER_DATA_URL) ||
      (typeof color === 'string' &&
        color.startsWith('data:') &&
        color.length > MAX_WALLPAPER_DATA_URL)
    ) {
      throw new Error('Wallpaper data URLs are not stored in preferences');
    }
  }
  return normalizePrefs(raw);
}

/**
 * @param {WallpaperPref} wallpaper
 * @param {string} [imageUrl]
 * @returns {{ backgroundImage: string, backgroundColor: string, backgroundSize: string, backgroundRepeat: string, backgroundPosition: string, backgroundAttachment: string }}
 */
export function wallpaperStyleFor(wallpaper, imageUrl) {
  const fit = fitToCss(wallpaper.fit);
  const base = {
    backgroundSize: fit.size,
    backgroundRepeat: fit.repeat,
    backgroundPosition: fit.position,
    backgroundAttachment: 'fixed',
    backgroundColor: 'var(--surface-0)',
    backgroundImage: 'none'
  };

  if (wallpaper.source === 'color') {
    return {
      ...base,
      backgroundColor: wallpaper.color || 'var(--surface-0)',
      backgroundImage: 'none'
    };
  }

  if (wallpaper.source === 'vfs' && imageUrl) {
    return { ...base, backgroundImage: `url("${imageUrl}")` };
  }

  const preset = WALLPAPER_PRESETS[wallpaper.id || 'glow'] || WALLPAPER_PRESETS.glow;
  if (preset.kind === 'glow') {
    return {
      ...base,
      backgroundSize: 'auto',
      backgroundRepeat: 'no-repeat',
      backgroundPosition: 'center',
      backgroundImage: GLOW_GRADIENT
    };
  }
  if (preset.kind === 'solid') {
    return {
      ...base,
      backgroundColor: preset.color || 'var(--surface-0)',
      backgroundImage: 'none'
    };
  }
  if (preset.kind === 'image' && preset.image) {
    const size = wallpaper.id === 'tiger' && wallpaper.fit === 'cover' ? '25%' : fit.size;
    const repeat = wallpaper.id === 'tiger' && wallpaper.fit === 'cover' ? 'no-repeat' : fit.repeat;
    return {
      ...base,
      backgroundSize: size,
      backgroundRepeat: repeat,
      backgroundImage: `url("${preset.image}")`
    };
  }
  return base;
}

/**
 * @param {string} [value]
 */
export function applyDocumentTheme(value) {
  const theme = THEMES.includes(/** @type {string} */ (value)) ? value : 'dark';
  if (typeof document === 'undefined') return theme;
  if (theme === 'auto') {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = theme;
  }
  return theme;
}

function storageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function storageRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function readThemeKey() {
  const t = storageGet(THEME_KEY);
  if (t === 'light' || t === 'dark' || t === 'auto') return t;
  return null;
}

/**
 * @returns {OsPrefs}
 */
export function loadPrefs() {
  let parsed = null;
  const raw = storageGet(PREFS_KEY);
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }
  const prefs = prefsFromUnknown(parsed);
  const themeFromSite = readThemeKey();
  if (themeFromSite) {
    prefs.theme = themeFromSite;
  }
  return prefs;
}

/**
 * @param {OsPrefs} prefs
 */
export function savePrefs(prefs) {
  const normalized = normalizePrefs(prefs);
  storageSet(PREFS_KEY, JSON.stringify(normalized));
  storageSet(THEME_KEY, normalized.theme);
  applyDocumentTheme(normalized.theme);
  return normalized;
}

/**
 * @param {Partial<OsPrefs>} patch
 * @returns {OsPrefs}
 */
export function patchPrefs(patch) {
  const current = loadPrefs();
  const merged = {
    ...current,
    ...patch,
    wallpaper: patch.wallpaper ? { ...current.wallpaper, ...patch.wallpaper } : current.wallpaper,
    screensaver: patch.screensaver
      ? { ...current.screensaver, ...patch.screensaver }
      : current.screensaver
  };
  return savePrefs(merged);
}

export function clearOsLocalStorage() {
  storageRemove(PREFS_KEY);
  storageRemove('heymingOS_username');
  storageRemove('heymingOS_hostname');
}

export const Prefs = {
  PREFS_KEY,
  THEME_KEY,
  WALLPAPER_PRESETS,
  DEFAULT_PREFS,
  load: loadPrefs,
  save: savePrefs,
  patch: patchPrefs,
  normalize: normalizePrefs,
  wallpaperStyleFor,
  fitToCss,
  applyDocumentTheme,
  clearOsLocalStorage
};

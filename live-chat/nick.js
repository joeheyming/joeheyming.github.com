import { CONFIG } from './config.js';

const ADJECTIVES = [
  'Swift',
  'Brave',
  'Lucky',
  'Quiet',
  'Rusty',
  'Neon',
  'Cosmic',
  'Fuzzy',
  'Turbo',
  'Sneaky',
  'Clever',
  'Sunny',
  'Dusty',
  'Pixel',
  'Rapid',
  'Chill',
  'Iron',
  'Golden',
  'Wild',
  'Nimble'
];

const NOUNS = [
  'Slayer',
  'Marine',
  'Imp',
  'Cacodemon',
  'Plasma',
  'Shotgun',
  'Rocket',
  'Cyber',
  'Baron',
  'Demon',
  'Phobos',
  'Mars',
  'Glyph',
  'Vector',
  'Pixel',
  'Comet',
  'Falcon',
  'Viper',
  'Nomad',
  'Ranger'
];

/**
 * @param {string} raw
 * @returns {string}
 */
export function sanitizeNick(raw) {
  const cleaned = String(raw || '')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, CONFIG.maxNickChars);
  return cleaned;
}

/**
 * @param {string} nick
 * @returns {string|null} error message or null if ok
 */
export function validateNick(nick) {
  const n = sanitizeNick(nick);
  if (n.length < CONFIG.minNickChars) {
    return `Name needs at least ${CONFIG.minNickChars} characters`;
  }
  if (n.length > CONFIG.maxNickChars) {
    return `Name max ${CONFIG.maxNickChars} characters`;
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9 _-]*$/.test(n)) {
    return 'Letters, numbers, spaces, and hyphens only';
  }
  return null;
}

function localNick() {
  const adj = ADJECTIVES[(Math.random() * ADJECTIVES.length) | 0];
  const noun = NOUNS[(Math.random() * NOUNS.length) | 0];
  const n = (Math.random() * 90 + 10) | 0;
  return sanitizeNick(`${adj}${noun}${n}`);
}

/**
 * Prefer a quick public username via proxyService; fall back to local words.
 * @returns {Promise<string>}
 */
export async function generateNick() {
  try {
    const proxy = typeof window !== 'undefined' ? window.proxyService : null;
    if (proxy && typeof proxy.fetchJson === 'function') {
      const data = await proxy.fetchJson('https://randomuser.me/api/?inc=login&noinfo', {
        skipDirect: false,
        timeout: 4000
      });
      const login = data?.results?.[0]?.login?.username;
      if (typeof login === 'string' && login.trim()) {
        let nick = sanitizeNick(login.replace(/[._]/g, ' '));
        if (!nick || nick.length < CONFIG.minNickChars) nick = localNick();
        if (nick.length > CONFIG.maxNickChars) nick = nick.slice(0, CONFIG.maxNickChars);
        if (!validateNick(nick)) return nick;
      }
    }
  } catch {
    // Fall through to local generator.
  }
  return localNick();
}

/**
 * @returns {string|null}
 */
export function loadStoredNick() {
  try {
    const n = localStorage.getItem(CONFIG.nickKey);
    if (!n) return null;
    const err = validateNick(n);
    return err ? null : sanitizeNick(n);
  } catch {
    return null;
  }
}

/**
 * @param {string} nick
 */
export function storeNick(nick) {
  const cleaned = sanitizeNick(nick);
  try {
    localStorage.setItem(CONFIG.nickKey, cleaned);
  } catch {
    // Ignore quota / private mode.
  }
  return cleaned;
}

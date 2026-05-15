/**
 * Pac-Infinite — local save/load.
 *
 * Persists everything needed to "Continue" a session in a single
 * localStorage blob:
 *   - World seed (so chunks regenerate identically)
 *   - Eaten dots (set of "cx,cy,lx,ly" keys; chunks restore these on build)
 *   - Pacman pose (grid pos, surface height, yaw)
 *   - Score and high score (Phase 3)
 *
 * Lives are intentionally NOT saved — every Continue starts a fresh run
 * with `STARTING_LIVES`, and score zeroes too. The high score persists
 * across runs.
 *
 * Chunks themselves don't need to be persisted — they're deterministic
 * functions of (seed, cx, cy) thanks to the procedural generator.
 *
 * Storage key:    'pacman-infinite-save'
 * Schema version: 2 (declared via createPrefs `version`). Old saves at
 *                 a different version are ignored — we never crash on
 *                 stale data, just start fresh.
 *
 * v2: added score, highScore (Phase 3 — ghosts/pills/fruits/scoring),
 *     plus an optional `food` field (Minecraft-style hunger) — defaults
 *     to null when missing so old saves still load and the game uses
 *     FOOD_START in that case.
 * v1: seed + pacman pose + eatenDots
 */

import { createPrefs } from '/play/shared/prefs.js';

const SAVE_KEY = 'pacman-infinite-save';
const VERSION = 2;

/** Build the canonical "this dot got eaten" key. */
export function eatenKey(cx, cy, lx, ly) {
  return `${cx},${cy},${lx},${ly}`;
}

/**
 * @typedef {{
 *   seed: number,
 *   pacman: {gx:number, gy:number, h:number, yaw:number}|null,
 *   eatenDots: Set<string>,
 *   score: number,
 *   highScore: number,
 *   food: number|null,
 *   difficulty: string|null,
 *   savedAt: number
 * }} SaveState
 */

/** @returns {SaveState} */
function defaults() {
  return {
    seed: 0,
    pacman: null,
    eatenDots: new Set(),
    score: 0,
    highScore: 0,
    food: null,
    difficulty: null,
    savedAt: 0
  };
}

const _prefs = createPrefs({
  key: SAVE_KEY,
  version: VERSION,
  defaults,
  // Wire-shape (flat object stored in localStorage v2 had keys
  // {v, seed, pacman, eaten:[...], score, highScore, food, difficulty,
  //  ts}). createPrefs wraps under {__v, __data} on save; pre-migration
  // we read the old `v: 2` shape too in `migrate` for back-compat.
  serialize: (state) => ({
    seed: state.seed >>> 0,
    pacman: state.pacman ?? null,
    eaten: Array.from(state.eatenDots || []),
    score: Math.max(0, state.score | 0),
    highScore: Math.max(0, state.highScore | 0),
    // Persist food to the nearest tenth so the bar restores naturally.
    food: typeof state.food === 'number' ? Math.round(state.food * 10) / 10 : null,
    difficulty: typeof state.difficulty === 'string' ? state.difficulty : null,
    ts: Date.now()
  }),
  // Run before migrate. The old shape stored `v: 2` flat (no __v / __data
  // envelope); createPrefs unwraps the envelope and gives us either the
  // user's serialized blob or the legacy flat blob. Either way pull the
  // fields out the same way.
  deserialize: (stored) => stored,
  migrate: (stored, fromVersion) => {
    // Legacy save: stored at version 2 but with no __v stamp, the file
    // shape is the flat `{v: 2, seed, eaten, ...}` envelope. createPrefs
    // calls migrate when the stamped version != current — but a legacy
    // save has no stamp (fromVersion === null) yet may still be schema
    // v2. Detect that by sniffing `stored.v`.
    if (fromVersion === null && stored && typeof stored.v === 'number' && stored.v === VERSION) {
      const { v: _v, ...rest } = stored;
      return rest;
    }
    // Anything else (mismatched version, unknown shape) → treat as
    // unloadable. Returning null causes sanitize() to fall back to
    // defaults via the spread-onto-defaults below.
    return null;
  },
  sanitize: (raw) => {
    if (!raw || typeof raw !== 'object' || typeof raw.seed !== 'number') {
      return defaults();
    }
    return {
      seed: raw.seed >>> 0,
      pacman: raw.pacman ?? null,
      eatenDots: new Set(Array.isArray(raw.eaten) ? raw.eaten : []),
      score: typeof raw.score === 'number' ? raw.score : 0,
      highScore: typeof raw.highScore === 'number' ? raw.highScore : 0,
      // null sentinel = not in save → caller picks the FOOD_START default
      food: typeof raw.food === 'number' ? raw.food : null,
      // Persisted difficulty so Continue inherits the run's mode. Older
      // saves without this field let the menu pick the default.
      difficulty: typeof raw.difficulty === 'string' ? raw.difficulty : null,
      savedAt: typeof raw.ts === 'number' ? raw.ts : 0
    };
  }
});

/**
 * Load any persisted save. Returns null if there's no save, the schema is
 * a different version, the JSON is corrupt, or localStorage is disabled.
 *
 * @returns {SaveState | null}
 */
export function loadSave() {
  if (!_prefs.has()) return null;
  const state = _prefs.load();
  // `savedAt === 0` is the sentinel from the defaults factory: every
  // real save stamps `Date.now()` (always positive), so a savedAt of 0
  // means createPrefs returned defaults (corrupt blob, wrong version,
  // unmigratable shape). Mirrors the legacy "treat as no-save".
  if (!state || state.savedAt === 0) return null;
  return state;
}

/**
 * Synchronously persist the current world state. Caller is responsible for
 * deciding when to call this (we throttle from the game loop and force a
 * flush on pagehide).
 *
 * @param {{ seed: number, pacman: object|null, eatenDots: Set<string>|Iterable<string>, score?: number, highScore?: number, food?: number|null, difficulty?: string|null }} state
 * @returns {boolean} success
 */
export function saveState({
  seed,
  pacman,
  eatenDots,
  score = 0,
  highScore = 0,
  food = null,
  difficulty = null
}) {
  try {
    /** @type {SaveState} */
    const full = {
      seed: seed >>> 0,
      pacman: /** @type {any} */ (pacman) ?? null,
      eatenDots: eatenDots instanceof Set ? eatenDots : new Set(eatenDots || []),
      score: Math.max(0, score | 0),
      highScore: Math.max(0, highScore | 0),
      food,
      difficulty,
      savedAt: Date.now()
    };
    _prefs.save(full);
    return true;
  } catch (e) {
    // Quota exceeded, private mode, etc. Don't crash the game over a save.
    console.warn('[pac-infinite] save failed:', e);
    return false;
  }
}

/** Wipe the save. Used by "NEW GAME". */
export function clearSave() {
  _prefs.clear();
}

/** Cheap "is there anything to continue?" check, used to gate menu UI. */
export function hasSave() {
  return _prefs.has();
}

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
 * Schema version: bump VERSION when the shape changes; old saves are then
 *                 ignored (treated as no-save) so we never crash on stale data.
 *
 * v2: added score, highScore (Phase 3 — ghosts/pills/fruits/scoring),
 *     plus an optional `food` field (Minecraft-style hunger) — defaults
 *     to null when missing so old saves still load and the game uses
 *     FOOD_START in that case.
 * v1: seed + pacman pose + eatenDots
 */

const SAVE_KEY = 'pacman-infinite-save';
const VERSION = 2;

/** Build the canonical "this dot got eaten" key. */
export function eatenKey(cx, cy, lx, ly) {
  return `${cx},${cy},${lx},${ly}`;
}

/**
 * Load any persisted save. Returns null if there's no save, the schema is
 * a different version, the JSON is corrupt, or localStorage is disabled.
 *
 * @returns {{ seed: number, pacman: {gx:number, gy:number, h:number, yaw:number}|null, eatenDots: Set<string>, score: number, highScore: number, food: number|null, savedAt: number } | null}
 */
export function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || obj.v !== VERSION) return null;
    if (typeof obj.seed !== 'number') return null;
    return {
      seed: obj.seed >>> 0,
      pacman: obj.pacman ?? null,
      eatenDots: new Set(Array.isArray(obj.eaten) ? obj.eaten : []),
      score: typeof obj.score === 'number' ? obj.score : 0,
      highScore: typeof obj.highScore === 'number' ? obj.highScore : 0,
      // null sentinel = not in save → caller picks the FOOD_START default
      food: typeof obj.food === 'number' ? obj.food : null,
      // Persisted difficulty so Continue inherits the run's mode. Older
      // saves without this field let the menu pick the default.
      difficulty: typeof obj.difficulty === 'string' ? obj.difficulty : null,
      savedAt: typeof obj.ts === 'number' ? obj.ts : 0
    };
  } catch (_e) {
    return null;
  }
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
    const eatenArr = eatenDots ? Array.from(eatenDots) : [];
    const obj = {
      v: VERSION,
      seed: seed >>> 0,
      pacman: pacman ?? null,
      eaten: eatenArr,
      score: Math.max(0, score | 0),
      highScore: Math.max(0, highScore | 0),
      // Persist food to the nearest tenth so the bar restores naturally.
      food: typeof food === 'number' ? Math.round(food * 10) / 10 : null,
      difficulty: typeof difficulty === 'string' ? difficulty : null,
      ts: Date.now()
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(obj));
    return true;
  } catch (e) {
    // Quota exceeded, private mode, etc. Don't crash the game over a save.
    console.warn('[pac-infinite] save failed:', e);
    return false;
  }
}

/** Wipe the save. Used by "NEW GAME". */
export function clearSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch (_e) {
    /* ignore */
  }
}

/** Cheap "is there anything to continue?" check, used to gate menu UI. */
export function hasSave() {
  try {
    return localStorage.getItem(SAVE_KEY) !== null;
  } catch (_e) {
    return false;
  }
}

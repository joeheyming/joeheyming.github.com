/** Deep / wide room so parallel aisles stay walkable. */
export const ROOM = { w: 32, d: 28, h: 3.45 };
/** Face-out DVD / VHS case proportions */
export const BOX = { w: 0.38, h: 0.56, d: 0.1 };
export const SHELF = { depth: 0.34, thick: 0.04, rowH: 0.58, back: 0.05 };
/**
 * Lean back into the shelf (top toward backboard). Negative because
 * case +Z faces the aisle — positive X pitch tips the cover outward.
 */
export const CASE_LEAN = -0.32;
export const CASE_GAP = 0.07;
export const SHELF_ROWS = 5;
/** Cases fill lower planks only; the top plank is reserved for the genre label. */
export const STOCK_ROWS = SHELF_ROWS - 1;
/** Half-width of a gondola spine (meters). */
export const GONDOLA_HALF = 0.2;
/** Max aisle run so shelves stay walkable in the room. */
export const MAX_AISLE_LEN = 16;
/** Soft cap so big buckets (TV Series) become several labeled shelves. */
export const TARGET_PER_FACE = 16;
/** Clear walkway between gondola outsides (meters). */
export const MIN_WALKWAY = 2.1;

export const EYE_HEIGHT = 1.72;
export const MOVE_SPEED = 3.4;
export const MOUSE_SENS = 0.0022;
export const PITCH_LIMIT = Math.PI / 2 - 0.12;
/** Walk-cycle — longer stride + gentler bob reads as a normal adult gait. */
export const STEP_SPACING = 1.05;
export const BOB_Y = 0.022;
export const BOB_X = 0.014;
export const BOB_ROLL = 0.006;

export const GENRE_LABELS = {
  action: 'Action',
  anime: 'Anime',
  anthology: 'Anthology',
  comedy: 'Comedy',
  fantasy: 'Fantasy',
  'game-show': 'Game Shows',
  satire: 'Satire',
  'sci-fi': 'Sci-Fi',
  spy: 'Spy',
  sports: 'Sports',
  superhero: 'Superhero'
};

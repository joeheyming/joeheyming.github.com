// Colored outlines from One Million Checkboxes.
//
// The original CSS only declares the palette (gold, red, green, purple).
// Which cells get a frame is a fixed scatter: checkbox 45, then a step
// uniformly chosen from 237..475, which is the gap range in the
// published index list (about one colored box every ~355 cells).
// Colors are an even mix of the four names. The sequence is seeded so
// every visitor sees the same frames.

export const OUTLINE_NAMES = ['gold', 'red', 'green', 'purple'];

const FIRST_INDEX = 45;
const MIN_GAP = 237;
const GAP_SPAN = 475 - 237 + 1;

/**
 * @param {number} n
 * @returns {{ indices: Uint32Array, colors: Uint8Array }}
 */
export function buildOutlines(n) {
  /** @type {number[]} */
  const indices = [];
  /** @type {number[]} */
  const colors = [];
  let seed = 0x6f6d6362;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  let i = FIRST_INDEX;
  while (i < n) {
    indices.push(i);
    colors.push(Math.floor(rand() * OUTLINE_NAMES.length));
    i += MIN_GAP + Math.floor(rand() * GAP_SPAN);
  }
  return {
    indices: Uint32Array.from(indices),
    colors: Uint8Array.from(colors)
  };
}

/**
 * @param {Uint32Array} indices
 * @param {Uint8Array} colors
 * @param {number} cellId
 * @returns {number} color id, or -1 when the cell is plain
 */
export function outlineAt(indices, colors, cellId) {
  let lo = 0;
  let hi = indices.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const value = indices[mid];
    if (value === cellId) return colors[mid];
    if (value < cellId) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

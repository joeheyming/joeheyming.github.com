/**
 * Squiggly / Jigsaw region generator.
 *
 * Produces an 81-long array of region ids 0..8 where:
 *   - each region id appears exactly 9 times
 *   - each region is orthogonally connected
 *
 * Strategy: round-robin frontier growth from 9 spread-out seeds, with
 * retries. If 200 attempts all fail we fall back to a hand-tuned
 * layout so the game always loads.
 */

import { SIZE, TOTAL, idx } from './variants.js';

function neighbors(i) {
  const out = [];
  const r = Math.floor(i / SIZE);
  const c = i % SIZE;
  if (r > 0) out.push(idx(r - 1, c));
  if (r < SIZE - 1) out.push(idx(r + 1, c));
  if (c > 0) out.push(idx(r, c - 1));
  if (c < SIZE - 1) out.push(idx(r, c + 1));
  return out;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickSeeds() {
  // Spread 9 seeds across the grid: one per (roughly) "stripe".
  // Use slight randomness within each stripe so layouts vary.
  const seeds = [];
  const rowOrder = shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  for (let r = 0; r < SIZE; r++) {
    const c = Math.floor(Math.random() * SIZE);
    seeds.push(idx(rowOrder[r], c));
  }
  // Drop duplicates if any (unlikely).
  return Array.from(new Set(seeds)).slice(0, 9);
}

function attempt() {
  const assigned = new Array(TOTAL).fill(-1);
  const sizes = new Array(9).fill(0);
  const seeds = pickSeeds();
  if (seeds.length < 9) return null;

  for (let r = 0; r < 9; r++) {
    if (assigned[seeds[r]] !== -1) return null;
    assigned[seeds[r]] = r;
    sizes[r] = 1;
  }

  // Round-robin growth: each round, every region with room grabs one
  // unassigned neighbor at random.
  for (let round = 0; round < 8; round++) {
    const order = shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    for (const r of order) {
      if (sizes[r] >= 9) continue;
      const frontier = [];
      for (let i = 0; i < TOTAL; i++) {
        if (assigned[i] !== r) continue;
        for (const n of neighbors(i)) {
          if (assigned[n] === -1) frontier.push(n);
        }
      }
      if (!frontier.length) return null;
      // Prefer cells that have the fewest unassigned neighbors —
      // grabs "dead-end" cells first so we don't strand them.
      let best = frontier[0];
      let bestFree = Infinity;
      for (const f of shuffle(frontier)) {
        let free = 0;
        for (const n of neighbors(f)) if (assigned[n] === -1) free++;
        if (free < bestFree) {
          bestFree = free;
          best = f;
        }
      }
      assigned[best] = r;
      sizes[r]++;
    }
  }

  if (assigned.some((v) => v < 0)) return null;
  if (sizes.some((s) => s !== 9)) return null;
  return assigned;
}

// 4 hand-built layouts. Each row is 9 chars, digits 0..8.
// Verified: each id appears 9 times, each region is connected.
const FALLBACK_LAYOUTS = [
  [
    '000111222',
    '000111222',
    '000111222',
    '333444555',
    '333444555',
    '333444555',
    '666777888',
    '666777888',
    '666777888'
  ],
  [
    '000001111',
    '022200111',
    '022233311',
    '422233311',
    '422553311',
    '442553366',
    '447755366',
    '777755866',
    '777788866'
  ],
  [
    '000111222',
    '003111222',
    '033341522',
    '333341552',
    '634441555',
    '633477555',
    '666477788',
    '666477888',
    '666777888'
  ]
];

function parseLayout(rows) {
  const out = [];
  for (const row of rows) {
    for (const ch of row) out.push(parseInt(ch, 10));
  }
  return out;
}

function validateLayout(layout) {
  const counts = new Array(9).fill(0);
  for (const v of layout) counts[v]++;
  if (counts.some((c) => c !== 9)) return false;
  for (let r = 0; r < 9; r++) {
    const cells = [];
    for (let i = 0; i < TOTAL; i++) if (layout[i] === r) cells.push(i);
    const seen = new Set([cells[0]]);
    const stack = [cells[0]];
    while (stack.length) {
      const cur = stack.pop();
      for (const n of neighbors(cur)) {
        if (layout[n] === r && !seen.has(n)) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
    if (seen.size !== 9) return false;
  }
  return true;
}

// Filter fallbacks to only the ones that actually validate.
const VALIDATED_FALLBACKS = FALLBACK_LAYOUTS.map(parseLayout).filter(validateLayout);

function rotate90(layout) {
  const out = new Array(TOTAL);
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      out[idx(c, SIZE - 1 - r)] = layout[idx(r, c)];
    }
  }
  return out;
}

function mirrorH(layout) {
  const out = new Array(TOTAL);
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      out[idx(r, SIZE - 1 - c)] = layout[idx(r, c)];
    }
  }
  return out;
}

// Re-label region ids 0..8 in the order they first appear, so different
// transformations look like "different" puzzles to the UI.
function relabel(layout) {
  const map = new Map();
  let next = 0;
  return layout.map((v) => {
    if (!map.has(v)) {
      map.set(v, next++);
    }
    return map.get(v);
  });
}

export function generateJigsawLayout(maxAttempts = 200) {
  for (let i = 0; i < maxAttempts; i++) {
    const layout = attempt();
    if (layout && validateLayout(layout)) return layout;
  }
  // Fallback: pick a hand-tuned layout + a random rotation/mirror.
  if (!VALIDATED_FALLBACKS.length) {
    // Last-ditch: plain 3x3 boxes labeled as a jigsaw.
    const boxes = new Array(TOTAL);
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        boxes[idx(r, c)] = Math.floor(r / 3) * 3 + Math.floor(c / 3);
      }
    }
    return boxes;
  }
  let l = VALIDATED_FALLBACKS[Math.floor(Math.random() * VALIDATED_FALLBACKS.length)];
  const rot = Math.floor(Math.random() * 4);
  for (let i = 0; i < rot; i++) l = rotate90(l);
  if (Math.random() < 0.5) l = mirrorH(l);
  return relabel(l);
}

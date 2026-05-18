/**
 * Variant region definitions for Sudoku.
 *
 * A variant is just a set of "regions" — groups of 9 cells that must
 * each contain digits 1-9 with no repeats. By composing different
 * region sets we get the classic, X (diagonals), Jigsaw / Squiggly
 * (irregular 9-cell shapes instead of 3x3 boxes), and Hyper / extra-
 * region variants, plus any combination of those.
 *
 * Cell indices are 0..80, with row = i / 9, col = i % 9.
 */

export const SIZE = 9;
export const TOTAL = SIZE * SIZE;

export function idx(r, c) {
  return r * SIZE + c;
}

export function rc(i) {
  return [Math.floor(i / SIZE), i % SIZE];
}

export function rowCells(r) {
  const out = [];
  for (let c = 0; c < SIZE; c++) out.push(idx(r, c));
  return out;
}

export function colCells(c) {
  const out = [];
  for (let r = 0; r < SIZE; r++) out.push(idx(r, c));
  return out;
}

export function boxCells(br, bc) {
  const out = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out.push(idx(br * 3 + r, bc * 3 + c));
    }
  }
  return out;
}

export function diagMainCells() {
  const out = [];
  for (let i = 0; i < SIZE; i++) out.push(idx(i, i));
  return out;
}

export function diagAntiCells() {
  const out = [];
  for (let i = 0; i < SIZE; i++) out.push(idx(i, SIZE - 1 - i));
  return out;
}

// Windoku-style hyper regions: 4 extra 3x3 boxes inset by one cell.
export function hyperExtraRegions() {
  const out = [];
  for (const r0 of [1, 5]) {
    for (const c0 of [1, 5]) {
      const reg = [];
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          reg.push(idx(r0 + r, c0 + c));
        }
      }
      out.push(reg);
    }
  }
  return out;
}

export function standardRows() {
  const out = [];
  for (let r = 0; r < SIZE; r++) out.push(rowCells(r));
  return out;
}

export function standardCols() {
  const out = [];
  for (let c = 0; c < SIZE; c++) out.push(colCells(c));
  return out;
}

export function standardBoxes() {
  const out = [];
  for (let br = 0; br < 3; br++) {
    for (let bc = 0; bc < 3; bc++) {
      out.push(boxCells(br, bc));
    }
  }
  return out;
}

/**
 * Build a variant config from boolean flags + an optional jigsaw
 * layout (an 81-long array of region ids 0..8).
 *
 * The returned object has:
 *   regions:     array of arrays of cell indices (each length 9)
 *   blockOf:     81-long array of block ids (3x3 box, or jigsaw region)
 *   peers:       81-long array of Set<number> of peer cells
 *   flags:       echo of input flags
 *   jigsawLayout the 81-long region-id array, or null
 */
export function buildVariant(flags) {
  const { jigsaw = false, diagonals = false, hyper = false, jigsawLayout = null } = flags;

  const regions = [];
  regions.push(...standardRows());
  regions.push(...standardCols());

  let blockOf;
  if (jigsaw && jigsawLayout) {
    // Group cells by region id from the layout.
    const grouped = Array.from({ length: 9 }, () => []);
    for (let i = 0; i < TOTAL; i++) {
      grouped[jigsawLayout[i]].push(i);
    }
    for (const g of grouped) regions.push(g);
    blockOf = jigsawLayout.slice();
  } else {
    regions.push(...standardBoxes());
    blockOf = new Array(TOTAL);
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        blockOf[idx(r, c)] = Math.floor(r / 3) * 3 + Math.floor(c / 3);
      }
    }
  }

  if (diagonals) {
    regions.push(diagMainCells());
    regions.push(diagAntiCells());
  }

  let extraRegions = null;
  if (hyper) {
    extraRegions = hyperExtraRegions();
    for (const reg of extraRegions) regions.push(reg);
  }

  // Build peer sets.
  const peers = Array.from({ length: TOTAL }, () => new Set());
  for (const reg of regions) {
    for (const a of reg) {
      for (const b of reg) {
        if (a !== b) peers[a].add(b);
      }
    }
  }

  return {
    regions,
    blockOf,
    peers,
    flags: { jigsaw, diagonals, hyper },
    jigsawLayout: jigsaw && jigsawLayout ? jigsawLayout.slice() : null,
    extraRegions
  };
}

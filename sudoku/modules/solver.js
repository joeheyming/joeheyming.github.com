/**
 * Sudoku solver, uniqueness checker, and puzzle generator.
 *
 * The solver is variant-agnostic — it just consumes the peers array
 * built by `buildVariant`. Same code handles classic, X, jigsaw,
 * hyper, and combinations.
 */

import { SIZE, TOTAL } from './variants.js';

const ALL_DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function candidates(grid, peers, i) {
  const used = new Set();
  for (const p of peers[i]) {
    const v = grid[p];
    if (v) used.add(v);
  }
  const cands = [];
  for (let d = 1; d <= 9; d++) if (!used.has(d)) cands.push(d);
  return cands;
}

/**
 * Solve a grid with backtracking using minimum-remaining-values
 * heuristic. `stopAt` limits how many solutions to enumerate (1 = just
 * find any solution, 2 = check uniqueness). Returns the number of
 * solutions found (capped at stopAt). If `out` is provided, fills it
 * with the first solution.
 */
export function solve(grid, peers, options = {}) {
  const { stopAt = 1, randomize = false, out = null, stepLimit = 200000 } = options;
  const work = grid.slice();
  let count = 0;
  let steps = 0;
  let aborted = false;

  function backtrack() {
    if (count >= stopAt) return;
    if (++steps > stepLimit) {
      aborted = true;
      return;
    }

    let bestIdx = -1;
    let bestCands = null;
    for (let i = 0; i < TOTAL; i++) {
      if (work[i] !== 0) continue;
      const cands = candidates(work, peers, i);
      if (!cands.length) return;
      if (!bestCands || cands.length < bestCands.length) {
        bestCands = cands;
        bestIdx = i;
        if (cands.length === 1) break;
      }
    }

    if (bestIdx === -1) {
      count++;
      if (out && count === 1) {
        for (let i = 0; i < TOTAL; i++) out[i] = work[i];
      }
      return;
    }

    const order = randomize ? shuffleInPlace(bestCands.slice()) : bestCands;
    for (const d of order) {
      work[bestIdx] = d;
      backtrack();
      work[bestIdx] = 0;
      if (count >= stopAt || aborted) return;
    }
  }

  backtrack();
  return { count, aborted };
}

export function countSolutions(grid, peers, limit = 2) {
  const { count } = solve(grid, peers, { stopAt: limit });
  return count;
}

export function findSolution(grid, peers, { randomize = false } = {}) {
  const out = new Array(TOTAL).fill(0);
  const { count } = solve(grid, peers, { stopAt: 1, randomize, out });
  return count > 0 ? out : null;
}

/**
 * Generate a solved grid that satisfies a variant.
 */
export function generateSolvedGrid(peers) {
  const empty = new Array(TOTAL).fill(0);
  // Retry a few times in case the solver hits its step limit on a hard variant.
  for (let attempt = 0; attempt < 5; attempt++) {
    const solution = findSolution(empty, peers, { randomize: true });
    if (solution) return solution;
  }
  return null;
}

/**
 * Given a solved grid, randomly remove cells while keeping the puzzle
 * uniquely solvable. Stops once `targetClues` clues remain, or when no
 * more cells can be removed.
 */
export function carvePuzzle(solved, peers, targetClues, options = {}) {
  const { symmetric = true } = options;
  const puzzle = solved.slice();

  const positions = [];
  for (let i = 0; i < TOTAL; i++) positions.push(i);
  shuffleInPlace(positions);

  let cluesLeft = TOTAL;

  for (const i of positions) {
    if (cluesLeft <= targetClues) break;
    if (puzzle[i] === 0) continue;
    const mirror = TOTAL - 1 - i; // 180° symmetry
    const removeMirror = symmetric && mirror !== i && puzzle[mirror] !== 0;

    const saved = puzzle[i];
    const savedMirror = removeMirror ? puzzle[mirror] : 0;
    puzzle[i] = 0;
    if (removeMirror) puzzle[mirror] = 0;

    const { count, aborted } = solve(puzzle, peers, { stopAt: 2, stepLimit: 50000 });
    if (count === 1 && !aborted) {
      cluesLeft -= removeMirror ? 2 : 1;
    } else {
      puzzle[i] = saved;
      if (removeMirror) puzzle[mirror] = savedMirror;
    }
  }

  return { puzzle, clues: cluesLeft };
}

/**
 * High-level: produce a puzzle + its solution for the given variant.
 *
 * `difficulty` is one of 'easy', 'medium', 'hard', 'expert'.
 */
export function generatePuzzle(variant, difficulty = 'medium') {
  const cluesFor = {
    easy: 40,
    medium: 32,
    hard: 26,
    expert: 23
  };
  const targetClues = cluesFor[difficulty] || 32;

  const solved = generateSolvedGrid(variant.peers);
  if (!solved) return null;

  const { puzzle, clues } = carvePuzzle(solved, variant.peers, targetClues);
  return {
    puzzle,
    solution: solved,
    clues,
    difficulty
  };
}

/**
 * Find the single cell to fill in next that has the fewest candidates.
 * Used for the "Hint" button. Returns { index, value } or null.
 */
export function findEasiestHint(currentGrid, solution, peers) {
  let bestIdx = -1;
  let bestCands = null;
  for (let i = 0; i < TOTAL; i++) {
    if (currentGrid[i] !== 0) continue;
    const cands = candidates(currentGrid, peers, i);
    if (!cands.length) {
      // Already invalid — fall back to revealing one solution cell.
      return { index: i, value: solution[i] };
    }
    if (!bestCands || cands.length < bestCands.length) {
      bestCands = cands;
      bestIdx = i;
      if (cands.length === 1) break;
    }
  }
  if (bestIdx === -1) return null;
  return { index: bestIdx, value: solution[bestIdx] };
}

/**
 * Find conflicts: cells whose value duplicates within any region.
 * Returns a Set<number> of cell indices.
 */
export function findConflicts(grid, regions) {
  const bad = new Set();
  for (const region of regions) {
    const positions = new Map(); // digit -> array of cell indices
    for (const i of region) {
      const v = grid[i];
      if (!v) continue;
      if (!positions.has(v)) positions.set(v, []);
      positions.get(v).push(i);
    }
    for (const cells of positions.values()) {
      if (cells.length > 1) {
        for (const c of cells) bad.add(c);
      }
    }
  }
  return bad;
}

export { ALL_DIGITS };

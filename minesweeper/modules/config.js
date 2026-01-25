/**
 * Minesweeper Configuration
 * Difficulty settings and game constants
 */

export const DIFFICULTIES = {
  beginner: { rows: 9, cols: 9, mines: 10 },
  intermediate: { rows: 16, cols: 16, mines: 40 },
  expert: { rows: 16, cols: 30, mines: 99 },
  custom: { rows: 9, cols: 9, mines: 10 } // Default custom values
};

// Constraints for custom games
export const CUSTOM_LIMITS = {
  minRows: 5,
  maxRows: 30,
  minCols: 5,
  maxCols: 50,
  minMines: 1
};

/**
 * Calculate max mines for a given board size
 * (Must leave at least 9 cells free for first click safety)
 */
export function getMaxMines(rows, cols) {
  return Math.max(1, rows * cols - 9);
}

export const CELL_SIZE = 54; // Base size, will be scaled dynamically
export const MIN_CELL_SIZE = 36; // Minimum for touch targets on mobile
export const MIN_CELL_SIZE_EXPERT = 24; // Smaller minimum for expert mode to fit screen
export const MAX_CELL_SIZE = 60;

export const FACES = {
  normal: '🙂',
  pressed: '😮',
  won: '😎',
  lost: '😵'
};

export const SYMBOLS = {
  mine: '💣',
  flag: '🚩',
  wrongFlag: '❌'
};

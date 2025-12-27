/**
 * Minesweeper Board Module
 * Handles board state, mine placement, and cell logic
 */

import { DIFFICULTIES } from './config.js';

export class Board {
  constructor(difficulty = 'beginner', customConfig = null) {
    this.setDifficulty(difficulty, customConfig);
    this.reset();
  }

  setDifficulty(difficulty, customConfig = null) {
    if (difficulty === 'custom' && customConfig) {
      this.difficulty = 'custom';
      this.config = { ...customConfig };
    } else if (DIFFICULTIES[difficulty]) {
      this.difficulty = difficulty;
      this.config = DIFFICULTIES[difficulty];
    } else {
      throw new Error(`Unknown difficulty: ${difficulty}`);
    }
  }

  get rows() {
    return this.config.rows;
  }
  get cols() {
    return this.config.cols;
  }
  get totalMines() {
    return this.config.mines;
  }
  get totalCells() {
    return this.rows * this.cols;
  }

  reset() {
    const { rows, cols } = this.config;

    this.cells = [];
    this.revealed = [];
    this.flagged = [];
    this.minesPlaced = false;

    for (let r = 0; r < rows; r++) {
      this.cells[r] = [];
      this.revealed[r] = [];
      this.flagged[r] = [];
      for (let c = 0; c < cols; c++) {
        this.cells[r][c] = 0;
        this.revealed[r][c] = false;
        this.flagged[r][c] = false;
      }
    }
  }

  isValidCell(row, col) {
    return row >= 0 && row < this.rows && col >= 0 && col < this.cols;
  }

  isMine(row, col) {
    return this.cells[row][col] === -1;
  }

  isRevealed(row, col) {
    return this.revealed[row][col];
  }

  isFlagged(row, col) {
    return this.flagged[row][col];
  }

  getValue(row, col) {
    return this.cells[row][col];
  }

  getRevealedCount() {
    let count = 0;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this.revealed[r][c]) count++;
      }
    }
    return count;
  }

  getFlagCount() {
    let count = 0;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this.flagged[r][c]) count++;
      }
    }
    return count;
  }

  /**
   * Place mines on the board, avoiding the first click area
   */
  placeMines(firstClickRow, firstClickCol) {
    if (this.minesPlaced) return;

    const { rows, cols, mines } = this.config;

    // Build exclusion set (first click + neighbors)
    const excluded = new Set();
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const nr = firstClickRow + dr;
        const nc = firstClickCol + dc;
        if (this.isValidCell(nr, nc)) {
          excluded.add(`${nr},${nc}`);
        }
      }
    }

    // Place mines randomly
    let placed = 0;
    while (placed < mines) {
      const r = Math.floor(Math.random() * rows);
      const c = Math.floor(Math.random() * cols);

      if (this.cells[r][c] !== -1 && !excluded.has(`${r},${c}`)) {
        this.cells[r][c] = -1;
        placed++;
      }
    }

    // Calculate adjacent mine counts
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (this.cells[r][c] !== -1) {
          this.cells[r][c] = this.countAdjacentMines(r, c);
        }
      }
    }

    this.minesPlaced = true;
  }

  countAdjacentMines(row, col) {
    let count = 0;
    this.forEachNeighbor(row, col, (nr, nc) => {
      if (this.cells[nr][nc] === -1) count++;
    });
    return count;
  }

  countAdjacentFlags(row, col) {
    let count = 0;
    this.forEachNeighbor(row, col, (nr, nc) => {
      if (this.flagged[nr][nc]) count++;
    });
    return count;
  }

  /**
   * Toggle flag on a cell
   * @returns {boolean} New flag state
   */
  toggleFlag(row, col) {
    if (this.revealed[row][col]) return false;
    this.flagged[row][col] = !this.flagged[row][col];
    return this.flagged[row][col];
  }

  /**
   * Reveal a cell
   * @returns {Object} Result with revealed cells and whether a mine was hit
   */
  reveal(row, col) {
    const result = {
      revealedCells: [],
      hitMine: false
    };

    this._revealRecursive(row, col, result);
    return result;
  }

  _revealRecursive(row, col, result) {
    if (!this.isValidCell(row, col)) return;
    if (this.revealed[row][col] || this.flagged[row][col]) return;

    this.revealed[row][col] = true;
    result.revealedCells.push({ row, col, value: this.cells[row][col] });

    // Hit a mine
    if (this.cells[row][col] === -1) {
      result.hitMine = true;
      return;
    }

    // Empty cell - reveal neighbors
    if (this.cells[row][col] === 0) {
      this.forEachNeighbor(row, col, (nr, nc) => {
        this._revealRecursive(nr, nc, result);
      });
    }
  }

  /**
   * Chord reveal - reveal neighbors if flag count matches number
   * @returns {Object} Result with revealed cells and whether a mine was hit
   */
  chord(row, col) {
    const result = {
      revealedCells: [],
      hitMine: false
    };

    if (!this.revealed[row][col]) return result;

    const num = this.cells[row][col];
    if (num <= 0) return result;

    const flagCount = this.countAdjacentFlags(row, col);
    if (flagCount !== num) return result;

    this.forEachNeighbor(row, col, (nr, nc) => {
      if (!this.flagged[nr][nc] && !this.revealed[nr][nc]) {
        const subResult = this.reveal(nr, nc);
        result.revealedCells.push(...subResult.revealedCells);
        if (subResult.hitMine) result.hitMine = true;
      }
    });

    return result;
  }

  /**
   * Get all mine positions
   */
  getAllMines() {
    const mines = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this.cells[r][c] === -1) {
          mines.push({ row: r, col: c });
        }
      }
    }
    return mines;
  }

  /**
   * Get all incorrectly flagged cells
   */
  getWrongFlags() {
    const wrong = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this.flagged[r][c] && this.cells[r][c] !== -1) {
          wrong.push({ row: r, col: c });
        }
      }
    }
    return wrong;
  }

  /**
   * Flag all remaining mines (for win state)
   */
  flagAllMines() {
    const flagged = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this.cells[r][c] === -1 && !this.flagged[r][c]) {
          this.flagged[r][c] = true;
          flagged.push({ row: r, col: c });
        }
      }
    }
    return flagged;
  }

  /**
   * Iterate over all neighbors of a cell
   */
  forEachNeighbor(row, col, callback) {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = row + dr;
        const nc = col + dc;
        if (this.isValidCell(nr, nc)) {
          callback(nr, nc);
        }
      }
    }
  }
}

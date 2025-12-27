/**
 * Minesweeper Game Controller
 * Main game state machine and logic coordinator
 */

import { Board } from './board.js';
import { Timer } from './timer.js';
import { UI, getUIElements } from './ui.js';
import { DIFFICULTIES, CUSTOM_LIMITS, getMaxMines } from './config.js';

export class Game {
  constructor() {
    this.board = null;
    this.timer = null;
    this.ui = null;
    this.currentDifficulty = 'beginner';
    this.customConfig = null; // For custom difficulty

    // Game state
    this.state = 'idle'; // idle, playing, won, lost
    this.minesRemaining = 0;
  }

  /**
   * Initialize the game
   */
  init() {
    // Set up UI
    const elements = getUIElements();
    this.ui = new UI(elements);

    // Set up timer
    this.timer = new Timer((time) => {
      this.ui.updateTimer(time);
    });

    // Set up event handlers
    this.ui.setCellHandlers({
      onClick: (row, col) => this.handleClick(row, col),
      onRightClick: (row, col) => this.handleRightClick(row, col),
      onMiddleClick: (row, col) => this.handleChord(row, col),
      onMouseDown: (row, col) => this.handleMouseDown(row, col),
      onMouseUp: () => this.handleMouseUp()
    });

    this.ui.setupGlobalListeners({
      onNewGame: () => this.newGame(),
      onDifficultyChange: (difficulty) => this.setDifficulty(difficulty),
      onCustom: () => this.showCustomDialog()
    });

    // Start new game
    this.newGame();
  }

  /**
   * Start a new game
   */
  newGame() {
    // Create new board (pass custom config if applicable)
    this.board = new Board(this.currentDifficulty, this.customConfig);

    // Reset state
    this.state = 'idle';
    this.minesRemaining = this.board.totalMines;

    // Reset timer
    this.timer.reset();

    // Update UI
    this.ui.renderBoard(this.board.rows, this.board.cols);
    this.ui.updateMineCounter(this.minesRemaining);
    this.ui.updateTimer(0);
    this.ui.setFace('normal');
    this.ui.animateWindow(null);
    this.ui.updateDifficultyButtons(this.currentDifficulty);
  }

  /**
   * Set difficulty and start new game
   */
  setDifficulty(difficulty) {
    if (!DIFFICULTIES[difficulty]) return;
    this.currentDifficulty = difficulty;
    // Clear custom config when using a preset
    if (difficulty !== 'custom') {
      this.customConfig = null;
    }
    this.newGame();
  }

  /**
   * Handle left click on cell
   */
  handleClick(row, col) {
    if (this.state === 'won' || this.state === 'lost') return;
    if (this.board.isFlagged(row, col)) return;

    // First click - place mines and start timer
    if (this.state === 'idle') {
      this.board.placeMines(row, col);
      this.timer.start();
      this.state = 'playing';
    }

    // Reveal the cell
    const result = this.board.reveal(row, col);

    // Update UI for revealed cells
    result.revealedCells.forEach(({ row: r, col: c, value }) => {
      this.ui.updateCell(r, c, this.board.cols, {
        revealed: true,
        isMine: value === -1,
        value: value,
        exploded: value === -1 && r === row && c === col
      });
    });

    if (result.hitMine) {
      this.handleGameOver(row, col);
    } else {
      this.checkWin();
    }
  }

  /**
   * Handle right click on cell (flag)
   */
  handleRightClick(row, col) {
    if (this.state === 'won' || this.state === 'lost') return;
    if (this.board.isRevealed(row, col)) return;

    const nowFlagged = this.board.toggleFlag(row, col);
    this.minesRemaining += nowFlagged ? -1 : 1;

    this.ui.updateCell(row, col, this.board.cols, {
      revealed: false,
      flagged: nowFlagged
    });
    this.ui.updateMineCounter(this.minesRemaining);
  }

  /**
   * Handle middle click (chord)
   */
  handleChord(row, col) {
    if (this.state !== 'playing') return;

    const result = this.board.chord(row, col);

    result.revealedCells.forEach(({ row: r, col: c, value }) => {
      this.ui.updateCell(r, c, this.board.cols, {
        revealed: true,
        isMine: value === -1,
        value: value,
        exploded: value === -1
      });
    });

    if (result.hitMine) {
      // Find the first mine that was hit
      const mine = result.revealedCells.find((c) => c.value === -1);
      if (mine) {
        this.handleGameOver(mine.row, mine.col);
      }
    } else if (result.revealedCells.length > 0) {
      this.checkWin();
    }
  }

  /**
   * Handle mouse down on cell (change face)
   */
  handleMouseDown(row, col) {
    if (this.state === 'won' || this.state === 'lost') return;
    if (!this.board.isRevealed(row, col) && !this.board.isFlagged(row, col)) {
      this.ui.setFace('pressed');
    }
  }

  /**
   * Handle mouse up (reset face)
   */
  handleMouseUp() {
    if (this.state === 'playing' || this.state === 'idle') {
      this.ui.setFace('normal');
    }
  }

  /**
   * Handle game over (mine hit)
   */
  handleGameOver(explodedRow, explodedCol) {
    this.state = 'lost';
    this.timer.stop();

    // Show all mines
    const mines = this.board.getAllMines();
    mines.forEach(({ row, col }) => {
      this.ui.updateCell(row, col, this.board.cols, {
        revealed: true,
        isMine: true,
        exploded: row === explodedRow && col === explodedCol
      });
    });

    // Show wrong flags
    const wrongFlags = this.board.getWrongFlags();
    wrongFlags.forEach(({ row, col }) => {
      this.ui.updateCell(row, col, this.board.cols, {
        revealed: true,
        wrongFlag: true
      });
    });

    this.ui.setFace('lost');
    this.ui.animateWindow('game-over');
  }

  /**
   * Check if player has won
   */
  checkWin() {
    const revealedCount = this.board.getRevealedCount();
    const targetRevealed = this.board.totalCells - this.board.totalMines;

    if (revealedCount === targetRevealed) {
      this.state = 'won';
      this.timer.stop();

      // Auto-flag remaining mines
      const flagged = this.board.flagAllMines();
      flagged.forEach(({ row, col }) => {
        this.ui.updateCell(row, col, this.board.cols, {
          revealed: false,
          flagged: true
        });
      });

      this.minesRemaining = 0;
      this.ui.updateMineCounter(0);
      this.ui.setFace('won');
      this.ui.animateWindow('won');
    }
  }

  /**
   * Show help modal
   */
  showHelp() {
    this.ui.showModal('help-modal');
  }

  /**
   * Show about modal
   */
  showAbout() {
    this.ui.showModal('about-modal');
  }

  /**
   * Close a specific modal
   */
  closeModal(modalId) {
    this.ui.hideModal(modalId);
  }

  /**
   * Show custom game dialog
   */
  showCustomDialog() {
    // Pre-fill with current custom values or defaults
    const config = this.customConfig || DIFFICULTIES.custom;
    document.getElementById('custom-rows').value = config.rows;
    document.getElementById('custom-cols').value = config.cols;
    document.getElementById('custom-mines').value = config.mines;

    // Update max mines hint
    this.updateMinesHint();

    // Set up input listeners
    const rowsInput = document.getElementById('custom-rows');
    const colsInput = document.getElementById('custom-cols');

    rowsInput.onchange = () => this.updateMinesHint();
    colsInput.onchange = () => this.updateMinesHint();

    this.ui.showModal('custom-modal');
  }

  /**
   * Update the mines hint based on current row/col values
   */
  updateMinesHint() {
    const rows = parseInt(document.getElementById('custom-rows').value) || CUSTOM_LIMITS.minRows;
    const cols = parseInt(document.getElementById('custom-cols').value) || CUSTOM_LIMITS.minCols;
    const maxMines = getMaxMines(rows, cols);

    const minesInput = document.getElementById('custom-mines');
    minesInput.max = maxMines;

    const hint = document.getElementById('mines-hint');
    hint.textContent = `(1-${maxMines})`;
  }

  /**
   * Handle custom form submission
   */
  submitCustom(event) {
    event.preventDefault();

    const rows = parseInt(document.getElementById('custom-rows').value);
    const cols = parseInt(document.getElementById('custom-cols').value);
    const mines = parseInt(document.getElementById('custom-mines').value);

    // Validate
    const { minRows, maxRows, minCols, maxCols, minMines } = CUSTOM_LIMITS;
    const maxMines = getMaxMines(rows, cols);

    if (rows < minRows || rows > maxRows) {
      alert(`Height must be between ${minRows} and ${maxRows}`);
      return false;
    }

    if (cols < minCols || cols > maxCols) {
      alert(`Width must be between ${minCols} and ${maxCols}`);
      return false;
    }

    if (mines < minMines || mines > maxMines) {
      alert(`Mines must be between ${minMines} and ${maxMines}`);
      return false;
    }

    // Save custom config and start game
    this.customConfig = { rows, cols, mines };
    this.currentDifficulty = 'custom';
    this.ui.hideModal('custom-modal');
    this.newGame();

    return false;
  }
}

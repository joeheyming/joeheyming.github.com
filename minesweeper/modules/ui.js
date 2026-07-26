/**
 * Minesweeper UI Module
 * Handles all DOM rendering and updates
 */

import {
  CELL_SIZE,
  MIN_CELL_SIZE,
  MIN_CELL_SIZE_EXPERT,
  MAX_CELL_SIZE,
  FACES,
  SYMBOLS
} from './config.js';

export class UI {
  constructor(elements) {
    this.elements = elements;
    this.cellClickHandler = null;
    this.cellRightClickHandler = null;
    this.cellMiddleClickHandler = null;
    this.currentRows = 0;
    this.currentCols = 0;
    this.currentCellSize = 54;
  }

  /**
   * Set up cell event handlers
   */
  setCellHandlers({ onClick, onRightClick, onMiddleClick, onMouseDown, onMouseUp }) {
    this.cellClickHandler = onClick;
    this.cellRightClickHandler = onRightClick;
    this.cellMiddleClickHandler = onMiddleClick;
    this.cellMouseDownHandler = onMouseDown;
    this.cellMouseUpHandler = onMouseUp;
  }

  /**
   * Calculate optimal cell size to fit the viewport
   */
  calculateCellSize(rows, cols) {
    const header = document.querySelector('.game-header');
    const controls = document.querySelector('.controls');
    const statusBar = document.querySelector('.status-bar');
    const helpText = document.querySelector('.help-text');
    const gameContainer = document.querySelector('.game-container');

    const headerHeight = header?.offsetHeight || 48;
    const controlsHeight = controls?.offsetHeight || 50;
    const statusBarHeight = statusBar?.offsetHeight || 80;
    const helpTextHeight = helpText?.offsetHeight || 30;
    const containerPadding = 16 + 8 + 6; // game-container padding + border + board border
    const wrapperGap = 12 * 4;
    const bodyPadding = 24;

    const verticalPadding =
      headerHeight +
      controlsHeight +
      statusBarHeight +
      helpTextHeight +
      containerPadding +
      wrapperGap +
      bodyPadding;

    // Horizontal chrome: body padding + game-container + board border/padding
    const bodyStyles = getComputedStyle(document.body);
    const bodyPadX =
      (parseFloat(bodyStyles.paddingLeft) || 0) + (parseFloat(bodyStyles.paddingRight) || 0);
    let containerChrome = 22;
    if (gameContainer) {
      const cs = getComputedStyle(gameContainer);
      containerChrome =
        (parseFloat(cs.paddingLeft) || 0) +
        (parseFloat(cs.paddingRight) || 0) +
        (parseFloat(cs.borderLeftWidth) || 0) +
        (parseFloat(cs.borderRightWidth) || 0);
    }
    const boardChrome = 10; // .game-board border 3+3 + padding 2+2
    const availableWidth = Math.max(
      0,
      window.innerWidth - bodyPadX - containerChrome - boardChrome
    );
    const availableHeight = window.innerHeight - verticalPadding;

    const maxCellWidth = Math.floor(availableWidth / cols);
    const maxCellHeight = Math.floor(availableHeight / rows);
    const idealSize = Math.min(maxCellWidth, maxCellHeight);

    // Large boards (expert 16×30) keep a touch-friendly floor and scroll inside
    // .game-container. Smaller boards shrink below the soft min so the document
    // never needs horizontal scrolling on narrow phones (e.g. 320px).
    const isLargeBoard = cols >= 20 || rows >= 16;
    const preferredMin = isLargeBoard ? MIN_CELL_SIZE_EXPERT : MIN_CELL_SIZE;
    const absoluteFloor = 18;

    if (idealSize >= preferredMin) {
      return Math.min(MAX_CELL_SIZE, idealSize);
    }
    if (!isLargeBoard && idealSize >= absoluteFloor) {
      return idealSize;
    }
    return preferredMin;
  }

  /**
   * Render the game board grid
   */
  renderBoard(rows, cols) {
    const { gameBoard } = this.elements;

    // Store current dimensions
    this.currentRows = rows;
    this.currentCols = cols;

    // Calculate optimal cell size
    const cellSize = this.calculateCellSize(rows, cols);
    this.currentCellSize = cellSize;

    // Set CSS variables for cell size and border
    const borderWidth = cellSize < 40 ? 2 : 3;
    gameBoard.style.setProperty('--cell-size', `${cellSize}px`);
    gameBoard.style.setProperty('--cell-border', `${borderWidth}px`);
    gameBoard.style.gridTemplateColumns = `repeat(${cols}, var(--cell-size))`;
    gameBoard.innerHTML = '';

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.row = r;
        cell.dataset.col = c;

        // Event listeners
        cell.addEventListener('click', (e) => {
          this.cellClickHandler?.(r, c, e);
        });

        cell.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          this.cellRightClickHandler?.(r, c);
        });

        cell.addEventListener('auxclick', (e) => {
          if (e.button === 1) {
            e.preventDefault();
            this.cellMiddleClickHandler?.(r, c);
          }
        });

        cell.addEventListener('mousedown', (e) => {
          if (e.button === 0) {
            this.cellMouseDownHandler?.(r, c);
          }
        });

        cell.addEventListener('mouseup', () => {
          this.cellMouseUpHandler?.();
        });

        gameBoard.appendChild(cell);
      }
    }

    // Global mouseup/mouseleave for face reset
    gameBoard.addEventListener('mouseleave', () => {
      this.cellMouseUpHandler?.();
    });
  }

  /**
   * Get cell element by position
   */
  getCell(row, col, cols) {
    const index = row * cols + col;
    return this.elements.gameBoard.children[index];
  }

  /**
   * Update a single cell's display
   */
  updateCell(row, col, cols, state) {
    const cell = this.getCell(row, col, cols);
    if (!cell) return;

    // Clear existing classes and content
    cell.className = 'cell';
    cell.textContent = '';

    if (state.revealed) {
      cell.classList.add('revealed');

      if (state.isMine) {
        cell.textContent = SYMBOLS.mine;
        if (state.exploded) {
          cell.classList.add('mine-exploded');
        }
      } else if (state.value > 0) {
        cell.textContent = state.value;
        cell.classList.add(`num-${state.value}`);
      }
    } else if (state.flagged) {
      cell.classList.add('flagged');
      cell.textContent = SYMBOLS.flag;
    } else if (state.wrongFlag) {
      cell.classList.add('revealed', 'mine-wrong');
      cell.textContent = SYMBOLS.wrongFlag;
    }
  }

  /**
   * Update the mine counter display
   */
  updateMineCounter(value) {
    const clamped = Math.max(-99, Math.min(999, value));
    const display = String(Math.abs(clamped)).padStart(3, '0');
    const prefix = clamped < 0 ? '-' : '';
    this.elements.minesDisplay.textContent = prefix + display;
  }

  /**
   * Update the timer display
   */
  updateTimer(seconds) {
    const display = String(Math.min(seconds, 999)).padStart(3, '0');
    this.elements.timerDisplay.textContent = display;
  }

  /**
   * Set the face button emoji
   */
  setFace(type) {
    this.elements.faceBtn.textContent = FACES[type] || FACES.normal;
  }

  /**
   * Update difficulty button states
   */
  updateDifficultyButtons(currentDifficulty) {
    document.querySelectorAll('.diff-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.difficulty === currentDifficulty);
    });
  }

  /**
   * Show a modal
   */
  showModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.add('active');
    }
  }

  /**
   * Hide a modal
   */
  hideModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.remove('active');
    }
  }

  /**
   * Hide all modals
   */
  hideAllModals() {
    document.querySelectorAll('.modal').forEach((modal) => {
      modal.classList.remove('active');
    });
  }

  /**
   * Add animation class to wrapper
   */
  animateWindow(animationClass) {
    const wrapper = document.querySelector('.game-wrapper');
    wrapper.classList.remove('won', 'game-over');

    if (animationClass) {
      wrapper.classList.add(animationClass);
    }
  }

  /**
   * Set up global event listeners
   */
  setupGlobalListeners(handlers) {
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === 'F2') {
        e.preventDefault();
        handlers.onNewGame?.();
      }
      if (e.key === 'Escape') {
        this.hideAllModals();
      }
    });

    // Difficulty buttons
    document.querySelectorAll('.diff-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const difficulty = btn.dataset.difficulty;
        if (difficulty === 'custom') {
          handlers.onCustom?.();
        } else {
          handlers.onDifficultyChange?.(difficulty);
        }
      });
    });

    // Modal overlay click to close
    document.querySelectorAll('.modal').forEach((modal) => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          modal.classList.remove('active');
        }
      });
    });

    // Prevent context menu on game board
    this.elements.gameBoard.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });

    // Handle window resize - recalculate cell size
    let resizeTimeout;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        this.resizeBoard();
      }, 100);
    });
  }

  /**
   * Resize board cells to fit current viewport
   */
  resizeBoard() {
    if (this.currentRows === 0 || this.currentCols === 0) return;

    const { gameBoard } = this.elements;
    const cellSize = this.calculateCellSize(this.currentRows, this.currentCols);
    this.currentCellSize = cellSize;

    const borderWidth = cellSize < 40 ? 2 : 3;
    gameBoard.style.setProperty('--cell-size', `${cellSize}px`);
    gameBoard.style.setProperty('--cell-border', `${borderWidth}px`);
  }
}

/**
 * Get all UI element references
 */
export function getUIElements() {
  return {
    gameBoard: document.getElementById('game-board'),
    faceBtn: document.getElementById('face-btn'),
    minesDisplay: document.getElementById('mines-display'),
    timerDisplay: document.getElementById('timer-display')
  };
}

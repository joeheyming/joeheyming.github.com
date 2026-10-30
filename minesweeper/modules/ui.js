/**
 * Minesweeper UI Module
 * Handles all DOM rendering and updates
 */

import { MIN_CELL_SIZE, MIN_CELL_SIZE_EXPERT, MAX_CELL_SIZE, FACES, SYMBOLS } from './config.js';

/**
 * Pick a cell size that stays inside the leftover viewport.
 * A short screen must not fall back to the touch minimum: that minimum
 * is what pushes a 9×9 beginner board off a 540px-tall TV.
 * @param {number} idealSize
 * @param {boolean} isLargeBoard
 * @returns {number}
 */
export function fitCellSize(idealSize, isLargeBoard) {
  const preferredMin = isLargeBoard ? MIN_CELL_SIZE_EXPERT : MIN_CELL_SIZE;
  const absoluteFloor = 14;
  if (!Number.isFinite(idealSize) || idealSize <= 0) return absoluteFloor;
  const capped = Math.min(MAX_CELL_SIZE, Math.floor(idealSize));
  if (capped >= preferredMin) return capped;
  if (capped >= absoluteFloor) return capped;
  return absoluteFloor;
}

export class UI {
  constructor(elements) {
    this.elements = elements;
    this.cellClickHandler = null;
    this.cellRightClickHandler = null;
    this.cellMiddleClickHandler = null;
    this.currentRows = 0;
    this.currentCols = 0;
    this.currentCellSize = 54;
    this.cursor = { row: 0, col: 0 };
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
    const { gameBoard } = this.elements;
    const helpText = document.querySelector('.help-text');
    const gameContainer = document.querySelector('.game-container');
    const wrapper = document.querySelector('.game-wrapper');

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

    // Measure from where the board actually starts, so a short TV viewport
    // (960×540) subtracts the real header, difficulty row, and status bar
    // instead of a guess that comes out smaller than the painted chrome.
    const boardTop = gameBoard?.getBoundingClientRect().top ?? 0;
    const helpHeight = helpText?.offsetHeight || 0;
    const padBottom = parseFloat(bodyStyles.paddingBottom) || 0;
    const gapBelow = wrapper ? parseFloat(getComputedStyle(wrapper).rowGap) || 0 : 12;
    let availableHeight =
      window.innerHeight - boardTop - helpHeight - gapBelow - padBottom - boardChrome;
    if (boardTop < 8) availableHeight = window.innerHeight - 280;

    const maxCellWidth = Math.floor(availableWidth / cols);
    const maxCellHeight = Math.floor(availableHeight / rows);
    const idealSize = Math.min(maxCellWidth, maxCellHeight);
    const isLargeBoard = cols >= 20 || rows >= 16;
    return fitCellSize(idealSize, isLargeBoard);
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
        cell.tabIndex = 0;
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

    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => this.resizeBoard());
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
   * Move the remote cursor onto a square and keep it in view.
   * @param {number} row
   * @param {number} col
   */
  focusCell(row, col) {
    const cell = this.getCell(row, col, this.currentCols);
    if (!cell) return;
    this.cursor = { row, col };
    cell.focus({ preventScroll: true });
    cell.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }

  /**
   * Flag the square the remote is on. Used by the Flag button, which
   * has to stand in for a right-click the D-pad cannot send.
   */
  flagCursor() {
    const { row, col } = this.cursor;
    if (row == null || col == null) return;
    this.cellRightClickHandler?.(row, col);
    this.focusCell(row, col);
  }

  /**
   * Set up global event listeners
   */
  setupGlobalListeners(handlers) {
    // Keyboard shortcuts. Arrow keys move square to square once the
    // cursor is on the board. Down from the difficulty row or the face
    // enters the board; the TV's spatial navigation never does, because
    // the overflowing grid is not a candidate.
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'F2') {
          e.preventDefault();
          handlers.onNewGame?.();
          return;
        }
        if (e.key === 'Escape') {
          this.hideAllModals();
          return;
        }
        this.handleRemoteKey(e);
      },
      true
    );

    this.elements.flagBtn?.addEventListener('click', () => {
      this.flagCursor();
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

    document.fonts?.ready?.then(() => {
      this.resizeBoard();
    });
  }

  /**
   * D-pad movement. Arrows are only taken when they stay on the board
   * or step onto it from the controls, so the difficulty buttons and
   * the Flag button remain reachable.
   * @param {KeyboardEvent} e
   */
  handleRemoteKey(e) {
    const target = e.target && typeof e.target.closest === 'function' ? e.target : null;
    if (!target || target.closest('input, textarea, select') || target.isContentEditable) return;

    const step = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    const delta = step[e.key];
    const cell = target.closest('.cell');

    if ((e.key === 'f' || e.key === 'F') && cell) {
      e.preventDefault();
      this.cursor = { row: Number(cell.dataset.row), col: Number(cell.dataset.col) };
      this.flagCursor();
      return;
    }

    if (!delta) return;

    if (cell && cell.closest('#game-board')) {
      const row = Number(cell.dataset.row) + delta[0];
      const col = Number(cell.dataset.col) + delta[1];
      e.preventDefault();
      if (row >= 0 && col >= 0 && row < this.currentRows && col < this.currentCols) {
        this.focusCell(row, col);
        return;
      }
      if (e.key === 'ArrowUp') this.elements.faceBtn?.focus();
      if (e.key === 'ArrowDown') this.elements.flagBtn?.focus();
      return;
    }

    if (e.key === 'ArrowDown' && target.closest('.controls, .status-bar, .game-header')) {
      e.preventDefault();
      this.focusCell(this.cursor.row || 0, this.cursor.col || 0);
      return;
    }

    if (e.key === 'ArrowUp' && (target.closest('.help-text') || target === this.elements.flagBtn)) {
      e.preventDefault();
      this.focusCell(this.currentRows - 1, this.cursor.col || 0);
    }
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
    timerDisplay: document.getElementById('timer-display'),
    flagBtn: document.getElementById('flag-btn')
  };
}

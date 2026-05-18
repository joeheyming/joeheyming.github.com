/**
 * Sudoku — main entry point.
 *
 * Wires the game state up to the UI, handles the "new game" dialog
 * (variant + difficulty), and exposes a global `sudoku` object for
 * the inline HTML buttons.
 */

import { Game } from './modules/game.js';
import { SudokuUI } from './modules/ui.js';

const game = new Game();
const ui = new SudokuUI(game);

const DEFAULT_FLAGS = {
  jigsaw: false,
  diagonals: false,
  hyper: false,
  difficulty: 'medium'
};

function readNewGameForm() {
  const form = document.getElementById('newgame-form');
  if (!form) return { ...DEFAULT_FLAGS };
  return {
    jigsaw: false,
    diagonals: false,
    hyper: false,
    difficulty: form.elements['difficulty'].value
  };
}

function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('active');
}

function startNewGame(opts) {
  const params = opts || readNewGameForm();
  const board = document.getElementById('board');
  if (board) board.classList.add('generating');
  // Defer so the spinner can paint.
  setTimeout(() => {
    const ok = game.newGame(params);
    if (board) board.classList.remove('generating');
    if (!ok) {
      const msg = document.getElementById('message');
      if (msg) msg.textContent = 'Could not generate that puzzle. Try a different variant.';
    }
    closeModal('newgame-modal');
  }, 30);
}

function bindGlobalControls() {
  document.getElementById('open-newgame').addEventListener('click', () => {
    openModal('newgame-modal');
  });
  document.querySelectorAll('[data-close-modal]').forEach((btn) => {
    btn.addEventListener('click', () => {
      closeModal(btn.getAttribute('data-close-modal'));
    });
  });
  document.getElementById('newgame-form').addEventListener('submit', (e) => {
    e.preventDefault();
    startNewGame();
  });
  document.getElementById('undo-btn').addEventListener('click', () => game.undo());
  document.getElementById('redo-btn').addEventListener('click', () => game.redo());
  document.getElementById('hint-btn').addEventListener('click', () => game.hint());
  document.getElementById('autofill-btn').addEventListener('click', () => game.autofillNotes());
  document.getElementById('restart-btn').addEventListener('click', () => {
    // Restart current puzzle: just reset to the givens.
    if (!confirm('Restart this puzzle? Your progress will be cleared.')) return;
    for (let i = 0; i < game.givens.length; i++) {
      game.cells[i] = game.givens[i];
      game.notes[i] = 0;
    }
    game.history = [];
    game.future = [];
    game.won = false;
    game.paused = false;
    game.elapsedBeforePause = 0;
    game.startTime = Date.now();
    game.hintsUsed = 0;
    game.save();
    game.emit('restart');
  });
}

// ---------- Share button -------------------------------------------------

function configureShareButton() {
  const shareBtn = document.querySelector('share-button');
  if (!shareBtn) return;
  shareBtn.textGenerator = () => {
    if (game.won) {
      const total = Math.floor(game.elapsedMs() / 1000);
      const m = Math.floor(total / 60);
      const s = total % 60;
      return `I just solved Sudoku in ${m}m ${s}s! 🔢 Try to beat my time:`;
    }
    return `Play Sudoku in your browser — pencil marks, hints, mobile friendly 🔢`;
  };
}

// ---------- Boot ---------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  ui.init();
  bindGlobalControls();
  configureShareButton();

  const loaded = game.load();
  const savedFlags = game.variantFlags || {};
  const savedIsVariant = savedFlags.jigsaw || savedFlags.diagonals || savedFlags.hyper;
  if (!loaded || !game.variant || savedIsVariant) {
    // Old saves from when variants were selectable are discarded so
    // the user lands on vanilla 9×9 as advertised.
    if (loaded && savedIsVariant) game.clearSave();
    startNewGame(DEFAULT_FLAGS);
  } else {
    // Fire a render now that everything is initialized.
    game.emit('load');
  }
});

window.sudoku = { game, ui, startNewGame };

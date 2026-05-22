/**
 * Sudoku UI: renders the board, the number pad, the status bar, and
 * wires up keyboard / mouse / touch input.
 *
 * The board is built once per `newGame` (when the variant changes the
 * borders need re-laying), and after that we just patch the contents
 * and CSS classes of each cell on every state change.
 */

import { TOTAL, SIZE, idx } from './variants.js';
import { ALL_DIGITS } from './solver.js';

const SELECTORS = {
  board: '#board',
  numpad: '#numpad',
  variantBadge: '#variant-badge',
  difficultyBadge: '#difficulty-badge',
  timer: '#timer',
  hintsCount: '#hints-count',
  mistakesCount: '#mistakes-count',
  notesToggle: '#notes-toggle',
  autoCheck: '#auto-check',
  highlightSame: '#highlight-same',
  autoRemoveNotes: '#auto-remove-notes',
  message: '#message',
  pauseBtn: '#pause-btn',
  pauseOverlay: '#pause-overlay'
};

function fmtTime(ms) {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export class SudokuUI {
  constructor(game) {
    this.game = game;
    this.cellEls = new Array(TOTAL);
    this.timerInterval = null;
    this.bound = false;
    this.lastFlags = null;
    this.lastLayoutKey = null;
  }

  init() {
    this.el = {};
    for (const [k, sel] of Object.entries(SELECTORS)) {
      this.el[k] = document.querySelector(sel);
    }
    this.bindControls();
    // The board skeleton needs a variant to know where the thick block
    // borders go and whether to draw X/Hyper backgrounds — defer it
    // until the first render() after newGame()/load(). render() will
    // pick it up automatically because lastLayoutKey starts as null.
    this.renderNumpad();
    this.startTimer();
    this.game.onChange(() => this.render());
    this.bindInput();
    this.render();
  }

  // ----- Skeleton -----------------------------------------------------

  renderBoardSkeleton() {
    const board = this.el.board;
    board.innerHTML = '';

    const variant = this.game.variant;
    const flags = this.game.variantFlags;
    const layoutKey = JSON.stringify({ flags, layout: variant ? variant.jigsawLayout : null });
    this.lastLayoutKey = layoutKey;

    // Hyper / windoku tinted regions. Background tints go BELOW cells
    // (visible when cells are transparent); a matching set of dashed
    // outline overlays is appended AFTER the cells so it stays
    // visible even when the cells have their own backgrounds
    // (jigsaw tint, peer highlight, etc).
    const hyperPositions = flags.hyper
      ? [
          { top: 1, left: 1 },
          { top: 1, left: 5 },
          { top: 5, left: 1 },
          { top: 5, left: 5 }
        ]
      : [];
    for (const p of hyperPositions) {
      const bg = document.createElement('div');
      bg.className = 'hyper-region';
      bg.style.gridRow = `${p.top + 1} / span 3`;
      bg.style.gridColumn = `${p.left + 1} / span 3`;
      board.appendChild(bg);
    }

    // X-sudoku diagonal markers. SVG is the simplest way to draw a
    // real diagonal line at the right angle; the CSS gradient trick
    // ends up perpendicular to its named direction.
    if (flags.diagonals) {
      const svgNS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(svgNS, 'svg');
      svg.setAttribute('class', 'x-diagonals');
      svg.setAttribute('viewBox', '0 0 100 100');
      svg.setAttribute('preserveAspectRatio', 'none');
      svg.setAttribute('aria-hidden', 'true');
      const mk = (x1, y1, x2, y2, cls) => {
        const line = document.createElementNS(svgNS, 'line');
        line.setAttribute('x1', x1);
        line.setAttribute('y1', y1);
        line.setAttribute('x2', x2);
        line.setAttribute('y2', y2);
        line.setAttribute('class', cls);
        svg.appendChild(line);
      };
      mk(0, 0, 100, 100, 'x-line x-line-main');
      mk(100, 0, 0, 100, 'x-line x-line-anti');
      board.appendChild(svg);
    }

    // Cells.
    for (let i = 0; i < TOTAL; i++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.idx = i;
      cell.setAttribute('role', 'button');
      cell.setAttribute('tabindex', '0');
      cell.setAttribute('aria-label', `Row ${Math.floor(i / SIZE) + 1}, column ${(i % SIZE) + 1}`);
      const r = Math.floor(i / SIZE);
      const c = i % SIZE;
      cell.style.gridRow = r + 1;
      cell.style.gridColumn = c + 1;

      // Thick borders between blocks (3x3 box OR jigsaw region boundary).
      // We only need right/bottom — adjacent cells share the same edge,
      // and the board itself provides the outer border.
      const block = variant.blockOf[i];
      if (c < SIZE - 1 && variant.blockOf[idx(r, c + 1)] !== block) {
        cell.classList.add('thick-right');
      }
      if (r < SIZE - 1 && variant.blockOf[idx(r + 1, c)] !== block) {
        cell.classList.add('thick-bottom');
      }

      // Faint per-region tint for jigsaw so the regions are easy to
      // see at a glance. We use a CSS variable so the stylesheet owns
      // the actual color palette.
      if (flags.jigsaw) {
        cell.style.setProperty('--region-hue', `${block * 40}deg`);
        cell.classList.add('jigsaw');
      }

      const value = document.createElement('div');
      value.className = 'cell-value';
      cell.appendChild(value);

      const notes = document.createElement('div');
      notes.className = 'cell-notes';
      for (let d = 1; d <= 9; d++) {
        const n = document.createElement('span');
        n.className = 'note';
        n.dataset.digit = d;
        notes.appendChild(n);
      }
      cell.appendChild(notes);

      board.appendChild(cell);
      this.cellEls[i] = cell;
    }

    // Hyper outline overlays — appended last so they sit above the
    // cells in the stacking context and the dashed border is visible
    // even when a cell underneath has its own background.
    for (const p of hyperPositions) {
      const outline = document.createElement('div');
      outline.className = 'hyper-region-outline';
      outline.style.gridRow = `${p.top + 1} / span 3`;
      outline.style.gridColumn = `${p.left + 1} / span 3`;
      board.appendChild(outline);
    }
  }

  renderNumpad() {
    const pad = this.el.numpad;
    pad.innerHTML = '';
    for (const d of ALL_DIGITS) {
      const btn = document.createElement('button');
      btn.className = 'numpad-btn';
      btn.dataset.digit = d;
      btn.type = 'button';
      btn.textContent = d;
      pad.appendChild(btn);
    }
    const erase = document.createElement('button');
    erase.className = 'numpad-btn numpad-erase';
    erase.type = 'button';
    erase.dataset.action = 'erase';
    erase.innerHTML = '⌫';
    erase.setAttribute('aria-label', 'Erase');
    pad.appendChild(erase);
  }

  // ----- Bindings -----------------------------------------------------

  bindInput() {
    if (this.bound) return;
    this.bound = true;

    this.el.board.addEventListener('click', (e) => {
      const cell = e.target.closest('.cell');
      if (!cell) return;
      const i = Number(cell.dataset.idx);
      this.game.selectCell(i);
    });

    this.el.numpad.addEventListener('click', (e) => {
      const btn = e.target.closest('.numpad-btn');
      if (!btn) return;
      if (btn.dataset.action === 'erase') {
        this.game.eraseSelected();
        return;
      }
      const d = Number(btn.dataset.digit);
      this.game.inputDigit(d);
    });

    document.addEventListener('keydown', (e) => {
      // Skip if user is typing inside an input/textarea.
      const t = e.target;
      const tag = t && t.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (t && t.isContentEditable)) return;

      if (e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        this.game.inputDigit(Number(e.key));
        return;
      }
      if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') {
        e.preventDefault();
        this.game.eraseSelected();
        return;
      }
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        this.game.toggleNoteMode();
        return;
      }
      if ((e.key === 'z' || e.key === 'Z') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (e.shiftKey) this.game.redo();
        else this.game.undo();
        return;
      }
      if ((e.key === 'y' || e.key === 'Y') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        this.game.redo();
        return;
      }
      if (e.key === 'h' || e.key === 'H') {
        e.preventDefault();
        this.game.hint();
        return;
      }

      const sel = this.game.selected;
      if (sel < 0) return;
      let r = Math.floor(sel / SIZE);
      let c = sel % SIZE;
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        r = (r + SIZE - 1) % SIZE;
        this.game.selectCell(idx(r, c));
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        r = (r + 1) % SIZE;
        this.game.selectCell(idx(r, c));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        c = (c + SIZE - 1) % SIZE;
        this.game.selectCell(idx(r, c));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        c = (c + 1) % SIZE;
        this.game.selectCell(idx(r, c));
      }
    });
  }

  bindControls() {
    // The toggle buttons live in the toolbar; their state is reflected
    // by an `is-on` class. They're idempotent so render() can refresh
    // them after undo/redo etc.
    if (this.el.notesToggle) {
      this.el.notesToggle.addEventListener('click', () => this.game.toggleNoteMode());
    }
    if (this.el.autoCheck) {
      this.el.autoCheck.addEventListener('click', () => {
        this.game.setAutoCheck(!this.game.autoCheck);
      });
    }
    if (this.el.highlightSame) {
      this.el.highlightSame.addEventListener('click', () => {
        this.game.setHighlightSame(!this.game.highlightSame);
      });
    }
    if (this.el.autoRemoveNotes) {
      this.el.autoRemoveNotes.addEventListener('click', () => {
        this.game.setAutoRemoveNotes(!this.game.autoRemoveNotes);
      });
    }
    if (this.el.pauseBtn) {
      this.el.pauseBtn.addEventListener('click', () => this.game.togglePause());
    }
    if (this.el.pauseOverlay) {
      this.el.pauseOverlay.addEventListener('click', () => this.game.togglePause());
    }
  }

  // ----- Render -------------------------------------------------------

  variantLabel() {
    const f = this.game.variantFlags;
    const parts = [];
    if (f.jigsaw) parts.push('Squiggly');
    if (f.hyper) parts.push('Hyper');
    if (f.diagonals) parts.push('X');
    if (!parts.length) parts.push('Classic');
    return parts.join(' · ');
  }

  layoutChanged() {
    const variant = this.game.variant;
    const flags = this.game.variantFlags;
    const key = JSON.stringify({ flags, layout: variant ? variant.jigsawLayout : null });
    return key !== this.lastLayoutKey;
  }

  render() {
    if (!this.game.variant) return;

    // If the variant structure changed (e.g. new game with a different
    // jigsaw layout) we need to rebuild the board skeleton.
    if (this.layoutChanged()) {
      this.renderBoardSkeleton();
    }

    // Status badges.
    if (this.el.variantBadge) this.el.variantBadge.textContent = this.variantLabel();
    if (this.el.difficultyBadge) {
      const d = this.game.difficulty;
      this.el.difficultyBadge.textContent = d.charAt(0).toUpperCase() + d.slice(1);
    }
    if (this.el.hintsCount) this.el.hintsCount.textContent = String(this.game.hintsUsed);

    const conflicts = this.game.getConflicts();
    const wrong = this.game.getWrongCells();
    if (this.el.mistakesCount) this.el.mistakesCount.textContent = String(wrong.size);

    const sel = this.game.selected;
    const selValue = sel >= 0 ? this.game.cells[sel] : 0;
    const peerSet = sel >= 0 ? this.game.variant.peers[sel] : null;

    for (let i = 0; i < TOTAL; i++) {
      const cell = this.cellEls[i];
      const value = this.game.cells[i];
      const notesMask = this.game.notes[i];
      const isGiven = this.game.isGiven(i);

      // Value display.
      const valueEl = cell.firstChild;
      const notesEl = cell.children[1];
      if (value) {
        valueEl.textContent = String(value);
        valueEl.style.display = '';
        notesEl.style.display = 'none';
      } else {
        valueEl.textContent = '';
        valueEl.style.display = 'none';
        notesEl.style.display = '';
        for (let d = 1; d <= 9; d++) {
          const span = notesEl.children[d - 1];
          const on = (notesMask & (1 << (d - 1))) !== 0;
          span.textContent = on ? String(d) : '';
        }
      }

      // CSS classes.
      cell.classList.toggle('given', isGiven);
      cell.classList.toggle('user', !!value && !isGiven);
      cell.classList.toggle('selected', i === sel);
      cell.classList.toggle('peer', peerSet ? peerSet.has(i) : false);
      cell.classList.toggle(
        'same-digit',
        this.game.highlightSame && selValue !== 0 && value === selValue && i !== sel
      );
      cell.classList.toggle('conflict', conflicts.has(i));
      cell.classList.toggle('wrong', wrong.has(i));
    }

    // Numpad: count remaining for each digit; gray out completed ones.
    const counts = new Array(10).fill(0);
    for (let i = 0; i < TOTAL; i++) {
      const v = this.game.cells[i];
      if (v) counts[v]++;
    }
    const padBtns = this.el.numpad.querySelectorAll('.numpad-btn');
    for (const btn of padBtns) {
      if (btn.dataset.action === 'erase') continue;
      const d = Number(btn.dataset.digit);
      btn.classList.toggle('done', counts[d] === 9);
      btn.classList.toggle('selected-digit', this.game.highlightSame && d === selValue);
      btn.dataset.remaining = String(9 - counts[d]);
    }

    // Toggle buttons.
    if (this.el.notesToggle) {
      this.el.notesToggle.classList.toggle('is-on', this.game.noteMode);
      this.el.notesToggle.setAttribute('aria-pressed', String(this.game.noteMode));
    }
    if (this.el.autoCheck) {
      this.el.autoCheck.classList.toggle('is-on', this.game.autoCheck);
      this.el.autoCheck.setAttribute('aria-pressed', String(this.game.autoCheck));
    }
    if (this.el.highlightSame) {
      this.el.highlightSame.classList.toggle('is-on', this.game.highlightSame);
      this.el.highlightSame.setAttribute('aria-pressed', String(this.game.highlightSame));
    }
    if (this.el.autoRemoveNotes) {
      this.el.autoRemoveNotes.classList.toggle('is-on', this.game.autoRemoveNotes);
      this.el.autoRemoveNotes.setAttribute('aria-pressed', String(this.game.autoRemoveNotes));
    }

    // Pause overlay.
    if (this.el.pauseOverlay) {
      this.el.pauseOverlay.classList.toggle('active', this.game.paused && !this.game.won);
    }
    if (this.el.pauseBtn) {
      this.el.pauseBtn.textContent = this.game.paused ? '▶' : '⏸';
    }

    // Win message.
    if (this.el.message) {
      if (this.game.won) {
        this.el.message.textContent = `🎉 Solved in ${fmtTime(this.game.elapsedMs())}!`;
        this.el.message.classList.add('won');
      } else {
        this.el.message.textContent = '';
        this.el.message.classList.remove('won');
      }
    }

    this.updateTimer();
  }

  startTimer() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.timerInterval = setInterval(() => this.updateTimer(), 500);
  }

  updateTimer() {
    if (!this.el.timer) return;
    this.el.timer.textContent = fmtTime(this.game.elapsedMs());
  }
}

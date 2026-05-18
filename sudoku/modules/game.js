/**
 * Sudoku game state: board values, pencil-mark notes, selection,
 * undo/redo history, hints, win detection, and localStorage saves.
 */

import { TOTAL, buildVariant } from './variants.js';
import { generateJigsawLayout } from './jigsaw.js';
import {
  generatePuzzle,
  findEasiestHint,
  findConflicts,
  ALL_DIGITS
} from './solver.js';

const STORAGE_KEY = 'sudoku-savegame-v1';

function emptyNotes() {
  return Array.from({ length: TOTAL }, () => 0);
}

// Notes are stored as a bitmask: bit (d-1) set means digit d is noted.
function noteHas(mask, d) {
  return (mask & (1 << (d - 1))) !== 0;
}

function noteSet(mask, d) {
  return mask | (1 << (d - 1));
}

function noteClear(mask, d) {
  return mask & ~(1 << (d - 1));
}

function noteToggle(mask, d) {
  return mask ^ (1 << (d - 1));
}

function noteList(mask) {
  const out = [];
  for (let d = 1; d <= 9; d++) if (noteHas(mask, d)) out.push(d);
  return out;
}

export class Game {
  constructor() {
    this.variant = null;
    this.variantFlags = { jigsaw: false, diagonals: false, hyper: false };
    this.difficulty = 'medium';
    this.givens = new Array(TOTAL).fill(0);
    this.cells = new Array(TOTAL).fill(0);
    this.notes = emptyNotes();
    this.solution = new Array(TOTAL).fill(0);
    this.selected = -1;
    this.noteMode = false;
    this.autoCheck = true;
    this.autoRemoveNotes = true;
    this.highlightSame = true;
    this.history = [];
    this.future = [];
    this.startTime = Date.now();
    this.elapsedBeforePause = 0;
    this.paused = false;
    this.won = false;
    this.hintsUsed = 0;
    this.listeners = new Set();
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(event = 'change') {
    for (const fn of this.listeners) fn(event);
  }

  /**
   * Start a brand new puzzle. Returns true on success.
   */
  newGame({ jigsaw = false, diagonals = false, hyper = false, difficulty = 'medium' } = {}) {
    let jigsawLayout = null;
    if (jigsaw) jigsawLayout = generateJigsawLayout();
    const variant = buildVariant({ jigsaw, diagonals, hyper, jigsawLayout });

    const generated = generatePuzzle(variant, difficulty);
    if (!generated) return false;

    this.variant = variant;
    this.variantFlags = { jigsaw, diagonals, hyper };
    this.difficulty = difficulty;
    this.givens = generated.puzzle.slice();
    this.cells = generated.puzzle.slice();
    this.solution = generated.solution.slice();
    this.notes = emptyNotes();
    this.selected = -1;
    this.noteMode = false;
    this.history = [];
    this.future = [];
    this.startTime = Date.now();
    this.elapsedBeforePause = 0;
    this.paused = false;
    this.won = false;
    this.hintsUsed = 0;

    this.save();
    this.emit('newGame');
    return true;
  }

  isGiven(i) {
    return this.givens[i] !== 0;
  }

  getCell(i) {
    return this.cells[i];
  }

  getNotes(i) {
    return noteList(this.notes[i]);
  }

  selectCell(i) {
    if (i === this.selected) return;
    this.selected = i;
    this.emit('select');
  }

  toggleNoteMode() {
    this.noteMode = !this.noteMode;
    this.emit('noteMode');
  }

  setNoteMode(on) {
    if (this.noteMode === on) return;
    this.noteMode = !!on;
    this.emit('noteMode');
  }

  setAutoCheck(on) {
    this.autoCheck = !!on;
    this.emit('settings');
  }

  setHighlightSame(on) {
    this.highlightSame = !!on;
    this.emit('settings');
  }

  setAutoRemoveNotes(on) {
    this.autoRemoveNotes = !!on;
    this.emit('settings');
  }

  /** Record a multi-cell change in history. ops is an array of
   *  { index, prevValue, prevNotes, nextValue, nextNotes }. */
  pushHistory(ops) {
    if (!ops.length) return;
    this.history.push(ops);
    if (this.history.length > 500) this.history.shift();
    this.future.length = 0;
  }

  undo() {
    const ops = this.history.pop();
    if (!ops) return;
    for (const op of ops) {
      this.cells[op.index] = op.prevValue;
      this.notes[op.index] = op.prevNotes;
    }
    this.future.push(ops);
    this.won = false;
    this.save();
    this.emit('undo');
  }

  redo() {
    const ops = this.future.pop();
    if (!ops) return;
    for (const op of ops) {
      this.cells[op.index] = op.nextValue;
      this.notes[op.index] = op.nextNotes;
    }
    this.history.push(ops);
    this.save();
    this.emit('redo');
    this.checkWin();
  }

  /**
   * Input from the user. If a cell is selected (and isn't a given),
   * either set its value or toggle a note depending on mode.
   */
  inputDigit(d) {
    const i = this.selected;
    if (i < 0 || this.isGiven(i)) return;
    if (this.noteMode) {
      if (this.cells[i] !== 0) return; // Don't add notes to filled cells.
      const ops = [
        {
          index: i,
          prevValue: this.cells[i],
          prevNotes: this.notes[i],
          nextValue: this.cells[i],
          nextNotes: noteToggle(this.notes[i], d)
        }
      ];
      this.applyOps(ops);
      return;
    }
    // Filled mode.
    if (this.cells[i] === d) {
      // Tapping the same digit clears the cell.
      this.eraseSelected();
      return;
    }
    const ops = [
      {
        index: i,
        prevValue: this.cells[i],
        prevNotes: this.notes[i],
        nextValue: d,
        nextNotes: 0
      }
    ];
    // Auto-remove this digit from peer notes.
    if (this.autoRemoveNotes) {
      for (const p of this.variant.peers[i]) {
        if (noteHas(this.notes[p], d)) {
          ops.push({
            index: p,
            prevValue: this.cells[p],
            prevNotes: this.notes[p],
            nextValue: this.cells[p],
            nextNotes: noteClear(this.notes[p], d)
          });
        }
      }
    }
    this.applyOps(ops);
    this.checkWin();
  }

  eraseSelected() {
    const i = this.selected;
    if (i < 0 || this.isGiven(i)) return;
    if (this.cells[i] === 0 && this.notes[i] === 0) return;
    const ops = [
      {
        index: i,
        prevValue: this.cells[i],
        prevNotes: this.notes[i],
        nextValue: 0,
        nextNotes: 0
      }
    ];
    this.applyOps(ops);
  }

  applyOps(ops) {
    for (const op of ops) {
      this.cells[op.index] = op.nextValue;
      this.notes[op.index] = op.nextNotes;
    }
    this.pushHistory(ops);
    this.save();
    this.emit('input');
  }

  /**
   * Reveal one cell from the solution.
   */
  hint() {
    if (this.won) return null;
    const result = findEasiestHint(this.cells, this.solution, this.variant.peers);
    if (!result) return null;
    const { index, value } = result;
    if (this.isGiven(index)) return null;
    const ops = [
      {
        index,
        prevValue: this.cells[index],
        prevNotes: this.notes[index],
        nextValue: value,
        nextNotes: 0
      }
    ];
    if (this.autoRemoveNotes) {
      for (const p of this.variant.peers[index]) {
        if (noteHas(this.notes[p], value)) {
          ops.push({
            index: p,
            prevValue: this.cells[p],
            prevNotes: this.notes[p],
            nextValue: this.cells[p],
            nextNotes: noteClear(this.notes[p], value)
          });
        }
      }
    }
    this.applyOps(ops);
    this.hintsUsed++;
    this.checkWin();
    this.emit('hint');
    return result;
  }

  /**
   * Auto-fill pencil marks for every empty cell with its true candidates.
   */
  autofillNotes() {
    const ops = [];
    for (let i = 0; i < TOTAL; i++) {
      if (this.cells[i] !== 0) continue;
      let mask = 0;
      for (let d = 1; d <= 9; d++) {
        let ok = true;
        for (const p of this.variant.peers[i]) {
          if (this.cells[p] === d) {
            ok = false;
            break;
          }
        }
        if (ok) mask |= 1 << (d - 1);
      }
      if (mask !== this.notes[i]) {
        ops.push({
          index: i,
          prevValue: this.cells[i],
          prevNotes: this.notes[i],
          nextValue: this.cells[i],
          nextNotes: mask
        });
      }
    }
    if (ops.length) this.applyOps(ops);
  }

  getConflicts() {
    return findConflicts(this.cells, this.variant.regions);
  }

  /**
   * Cells whose value disagrees with the solution. Only used when
   * `autoCheck` is on, so the game can highlight wrong guesses.
   */
  getWrongCells() {
    const out = new Set();
    if (!this.autoCheck) return out;
    for (let i = 0; i < TOTAL; i++) {
      if (this.cells[i] !== 0 && !this.isGiven(i) && this.cells[i] !== this.solution[i]) {
        out.add(i);
      }
    }
    return out;
  }

  checkWin() {
    if (this.won) return true;
    for (let i = 0; i < TOTAL; i++) {
      if (this.cells[i] !== this.solution[i]) return false;
    }
    this.won = true;
    this.paused = true;
    this.elapsedBeforePause = this.elapsedMs();
    this.emit('win');
    return true;
  }

  elapsedMs() {
    if (this.paused) return this.elapsedBeforePause;
    return this.elapsedBeforePause + (Date.now() - this.startTime);
  }

  togglePause() {
    if (this.won) return;
    if (this.paused) {
      this.startTime = Date.now();
      this.paused = false;
    } else {
      this.elapsedBeforePause = this.elapsedMs();
      this.paused = true;
    }
    this.emit('pause');
  }

  // ----- Persistence ---------------------------------------------------

  save() {
    if (typeof localStorage === 'undefined') return;
    try {
      const payload = {
        variantFlags: this.variantFlags,
        jigsawLayout: this.variant ? this.variant.jigsawLayout : null,
        difficulty: this.difficulty,
        givens: this.givens,
        cells: this.cells,
        notes: this.notes,
        solution: this.solution,
        hintsUsed: this.hintsUsed,
        elapsedMs: this.elapsedMs(),
        won: this.won
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (e) {
      // Quota or disabled; ignore.
    }
  }

  load() {
    if (typeof localStorage === 'undefined') return false;
    let raw;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      return false;
    }
    if (!raw) return false;
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      return false;
    }
    if (!data || !Array.isArray(data.givens) || data.givens.length !== TOTAL) return false;

    const flags = data.variantFlags || { jigsaw: false, diagonals: false, hyper: false };
    const variant = buildVariant({
      jigsaw: !!flags.jigsaw,
      diagonals: !!flags.diagonals,
      hyper: !!flags.hyper,
      jigsawLayout: flags.jigsaw ? data.jigsawLayout : null
    });

    this.variant = variant;
    this.variantFlags = flags;
    this.difficulty = data.difficulty || 'medium';
    this.givens = data.givens.slice();
    this.cells = (data.cells || data.givens).slice();
    this.notes = (data.notes || emptyNotes()).slice();
    this.solution = (data.solution || new Array(TOTAL).fill(0)).slice();
    this.hintsUsed = data.hintsUsed || 0;
    this.elapsedBeforePause = data.elapsedMs || 0;
    this.startTime = Date.now();
    this.paused = !!data.won;
    this.won = !!data.won;
    this.selected = -1;
    this.history = [];
    this.future = [];
    this.emit('load');
    return true;
  }

  clearSave() {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      // ignore
    }
  }
}

export { ALL_DIGITS };

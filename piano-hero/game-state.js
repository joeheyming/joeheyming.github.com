// Pure-state singleton for piano-hero. Mirrors stepmania/js/gameState.js
// in spirit — no DOM, no audio, no timing logic. Just a place where the
// engine, the renderer, the score panel, and play-along input can read
// and write the same shared values.
//
// Mutators emit a 'change' event so the page can wire `now-playing`,
// the play/pause button label, the tempo display, etc.

import { JUDGMENT_LABELS } from './judgment-policy.js';

/** Visual color per hand. Picked to be high-contrast on dark stages. */
export const HAND_COLORS = {
  right: '#60a5fa',
  left: '#f97316'
};

class GameState {
  constructor() {
    /** @type {import('./midi-parser.js').ParsedMidi | null} */
    this.chart = null;
    this.currentSongKey = null;
    this.currentSongLabel = '';
    /** 0.5..1.5 — multiplied into the playhead advance rate. */
    this.tempo = 1.0;
    /** 'watch' | 'play-along' */
    this.mode = 'watch';
    /** Per-hand visibility / audibility — both default on. */
    this.handsActive = { left: true, right: true };
    /** Engine status: 'idle' | 'playing' | 'paused' | 'finished'. */
    this.status = 'idle';
    /** Tally indexed by JUDGMENT_INDEX. */
    this.tapNoteScores = new Array(JUDGMENT_LABELS.length).fill(0);
    /** Running combo (resets on miss/bad). */
    this.combo = 0;
    this.maxCombo = 0;
    /** @type {Function[]} */
    this._listeners = [];
  }

  on(fn) {
    this._listeners.push(fn);
    return () => {
      const i = this._listeners.indexOf(fn);
      if (i >= 0) this._listeners.splice(i, 1);
    };
  }

  _emit() {
    for (const fn of this._listeners.slice()) {
      try {
        fn(this);
      } catch (err) {
        console.error('GameState listener threw', err);
      }
    }
  }

  setChart(chart, key, label) {
    this.chart = chart;
    this.currentSongKey = key;
    this.currentSongLabel = label || (chart && chart.title) || '';
    this.resetScore();
    this.status = 'idle';
    this._emit();
  }

  setMode(mode) {
    this.mode = mode === 'play-along' ? 'play-along' : 'watch';
    this.resetScore();
    this._emit();
  }

  setTempo(t) {
    this.tempo = Math.max(0.25, Math.min(2.0, Number(t) || 1));
    this._emit();
  }

  setHandActive(hand, active) {
    if (hand !== 'left' && hand !== 'right') return;
    this.handsActive[hand] = !!active;
    this._emit();
  }

  setStatus(status) {
    this.status = status;
    this._emit();
  }

  resetScore() {
    this.tapNoteScores = new Array(JUDGMENT_LABELS.length).fill(0);
    this.combo = 0;
    this.maxCombo = 0;
  }

  recordJudgment(index) {
    if (index < 0 || index >= this.tapNoteScores.length) return;
    this.tapNoteScores[index] += 1;
    // Bad / miss break the combo. Tightened windows extend it.
    if (index >= 3) {
      this.combo = 0;
    } else {
      this.combo += 1;
      if (this.combo > this.maxCombo) this.maxCombo = this.combo;
    }
    this._emit();
  }

  /** Returns the visible/audible note list for the current hand filter. */
  getActiveNotes() {
    if (!this.chart) return [];
    if (this.handsActive.left && this.handsActive.right) return this.chart.notes;
    if (!this.handsActive.left && !this.handsActive.right) return [];
    const wanted = this.handsActive.right ? 'right' : 'left';
    return this.chart.notes.filter((n) => n.hand === wanted);
  }
}

const gameState = new GameState();
export default gameState;

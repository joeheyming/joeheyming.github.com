/**
 * Pitch × time grid renderer and paint gestures.
 */

import {
  PITCH_MAX,
  PITCH_COUNT,
  activeTrack,
  findNoteAt,
  paintNote,
  setNoteSpan
} from './model.js';
import { midiToName, isBlackKey, isC } from '../shared/audio.js';

const ROW_H = 18;
const COL_W = 22;
const LABEL_W = 44;

export class PitchGrid {
  /**
   * @param {{
   *   canvas: HTMLCanvasElement,
   *   getSong: () => import('./model.js').Song,
   *   onChange: () => void,
   *   onBeforeEdit?: () => void,
   *   onPreview?: (midi: number) => void
   * }} opts
   */
  constructor(opts) {
    this.canvas = opts.canvas;
    this.ctx = /** @type {CanvasRenderingContext2D} */ (this.canvas.getContext('2d'));
    this.getSong = opts.getSong;
    this.onChange = opts.onChange;
    this.onBeforeEdit = opts.onBeforeEdit || (() => {});
    this.onPreview = opts.onPreview || (() => {});
    this.playheadStep = -1;
    this._drag = null;
    this._raf = 0;

    this.canvas.addEventListener('pointerdown', (e) => this._pointerDown(e));
    this.canvas.addEventListener('pointermove', (e) => this._pointerMove(e));
    this.canvas.addEventListener('pointerup', (e) => this._pointerUp(e));
    this.canvas.addEventListener('pointercancel', (e) => this._pointerUp(e));
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const song = this.getSong();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = LABEL_W + song.steps * COL_W;
    const cssH = PITCH_COUNT * ROW_H;
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  setPlayhead(step) {
    if (
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches &&
      this.playheadStep >= 0 &&
      step % 4 !== 0
    ) {
      return;
    }
    this.playheadStep = step;
    this.draw();
  }

  clearPlayhead() {
    this.playheadStep = -1;
    this.draw();
  }

  draw() {
    const song = this.getSong();
    const ctx = this.ctx;
    const w = LABEL_W + song.steps * COL_W;
    const h = PITCH_COUNT * ROW_H;
    ctx.clearRect(0, 0, w, h);

    // background
    ctx.fillStyle = '#12151c';
    ctx.fillRect(0, 0, w, h);

    // rows (high pitch at top)
    for (let i = 0; i < PITCH_COUNT; i++) {
      const midi = PITCH_MAX - i;
      const y = i * ROW_H;
      ctx.fillStyle = isBlackKey(midi) ? '#1a1f2a' : '#151922';
      ctx.fillRect(LABEL_W, y, w - LABEL_W, ROW_H);
      if (isC(midi)) {
        ctx.fillStyle = 'rgba(96, 165, 250, 0.08)';
        ctx.fillRect(LABEL_W, y, w - LABEL_W, ROW_H);
      }
      ctx.fillStyle = '#8b93a7';
      ctx.font = '10px JetBrains Mono, ui-monospace, monospace';
      ctx.textBaseline = 'middle';
      ctx.fillText(midiToName(midi), 6, y + ROW_H / 2);
    }

    // vertical grid — beat lines every 4, bar lines every 16
    for (let s = 0; s <= song.steps; s++) {
      const x = LABEL_W + s * COL_W;
      const isBar = s % 16 === 0;
      const isBeat = s % 4 === 0;
      ctx.strokeStyle = isBar
        ? 'rgba(94, 234, 212, 0.35)'
        : isBeat
        ? 'rgba(255,255,255,0.14)'
        : 'rgba(255,255,255,0.05)';
      ctx.lineWidth = isBar ? 1.5 : 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    ctx.lineWidth = 1;

    // horizontal lines
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    for (let i = 0; i <= PITCH_COUNT; i++) {
      const y = i * ROW_H;
      ctx.beginPath();
      ctx.moveTo(LABEL_W, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // notes
    const notes = activeTrack(song);
    for (const note of notes) {
      const row = PITCH_MAX - note.p;
      if (row < 0 || row >= PITCH_COUNT) continue;
      const x = LABEL_W + note.s * COL_W + 1;
      const y = row * ROW_H + 1;
      const nw = note.l * COL_W - 2;
      ctx.fillStyle = '#5eead4';
      ctx.fillRect(x, y, nw, ROW_H - 2);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.55)';
      ctx.fillRect(x, y, Math.min(4, nw), ROW_H - 2);
    }

    // playhead
    if (this.playheadStep >= 0 && this.playheadStep < song.steps) {
      const x = LABEL_W + this.playheadStep * COL_W;
      ctx.fillStyle = 'rgba(251, 191, 36, 0.28)';
      ctx.fillRect(x, 0, COL_W, h);
    }

    // label gutter
    ctx.fillStyle = '#0d1017';
    ctx.fillRect(0, 0, LABEL_W - 1, h);
    for (let i = 0; i < PITCH_COUNT; i++) {
      const midi = PITCH_MAX - i;
      const y = i * ROW_H;
      ctx.fillStyle = isC(midi) ? '#e2e8f0' : '#8b93a7';
      ctx.font = '10px JetBrains Mono, ui-monospace, monospace';
      ctx.textBaseline = 'middle';
      ctx.fillText(midiToName(midi), 6, y + ROW_H / 2);
    }
  }

  /** @param {PointerEvent} e */
  _cellFromEvent(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const song = this.getSong();
    if (x < LABEL_W) return null;
    const step = Math.floor((x - LABEL_W) / COL_W);
    const row = Math.floor(y / ROW_H);
    if (step < 0 || step >= song.steps || row < 0 || row >= PITCH_COUNT) return null;
    return { step, pitch: PITCH_MAX - row };
  }

  /** @param {PointerEvent} e */
  _pointerDown(e) {
    if (e.button !== 0) return;
    const cell = this._cellFromEvent(e);
    if (!cell) return;
    this.onBeforeEdit();
    const song = this.getSong();
    const notes = activeTrack(song);
    const existing = findNoteAt(notes, cell.pitch, cell.step);
    this.canvas.setPointerCapture(e.pointerId);
    if (existing) {
      paintNote(notes, cell.pitch, cell.step, 1, song.steps);
      this._drag = { mode: 'erase', pitch: cell.pitch, start: existing.s };
    } else {
      paintNote(notes, cell.pitch, cell.step, 1, song.steps);
      this.onPreview(cell.pitch);
      this._drag = { mode: 'paint', pitch: cell.pitch, start: cell.step };
    }
    this.onChange();
    this.draw();
  }

  /** @param {PointerEvent} e */
  _pointerMove(e) {
    if (!this._drag || this._drag.mode !== 'paint') return;
    const cell = this._cellFromEvent(e);
    if (!cell || cell.pitch !== this._drag.pitch) return;
    const song = this.getSong();
    const notes = activeTrack(song);
    setNoteSpan(notes, this._drag.pitch, this._drag.start, cell.step, song.steps);
    this.onChange();
    this.draw();
  }

  /** @param {PointerEvent} e */
  _pointerUp(e) {
    if (this.canvas.hasPointerCapture(e.pointerId)) {
      this.canvas.releasePointerCapture(e.pointerId);
    }
    this._drag = null;
  }
}

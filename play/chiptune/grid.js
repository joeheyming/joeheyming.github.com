/**
 * Pitch × time grid renderer and paint gestures.
 */

import {
  PITCH_MAX,
  PITCH_COUNT,
  STEPS_PER_BAR,
  activeTrack,
  barsOf,
  findNoteAt,
  paintNote,
  setNoteSpan,
  songBarCount,
  visibleBarCount
} from './model.js';
import { midiToName, isBlackKey, isC } from '../shared/audio.js';

const ROW_H = 18;
const COL_W = 22;
const MIN_COL = 14;
const MAX_COL = 36;
const LABEL_W = 44;

export class PitchGrid {
  /**
   * @param {{
   *   canvas: HTMLCanvasElement,
   *   getSong: () => import('./model.js').Song,
   *   onChange: () => void,
   *   onBeforeEdit?: () => void,
   *   onPreview?: (midi: number) => void,
   *   onViewChange?: () => void
   * }} opts
   */
  constructor(opts) {
    this.canvas = opts.canvas;
    this.ctx = /** @type {CanvasRenderingContext2D} */ (this.canvas.getContext('2d'));
    this.getSong = opts.getSong;
    this.onChange = opts.onChange;
    this.onBeforeEdit = opts.onBeforeEdit || (() => {});
    this.onPreview = opts.onPreview || (() => {});
    this.onViewChange = opts.onViewChange || (() => {});
    this.playheadStep = -1;
    this.playheadArr = 0;
    this.viewStartBar = 0;
    this.visibleBars = 1;
    this.colW = COL_W;
    this.isolatedPattern = -1;
    this._drag = null;
    this._raf = 0;

    this.canvas.addEventListener('pointerdown', (e) => this._pointerDown(e));
    this.canvas.addEventListener('pointermove', (e) => this._pointerMove(e));
    this.canvas.addEventListener('pointerup', (e) => this._pointerUp(e));
    this.canvas.addEventListener('pointercancel', (e) => this._pointerUp(e));
    const wrap = this.canvas.parentElement;
    if (typeof ResizeObserver === 'function' && wrap) {
      this._observer = new ResizeObserver(() => this.resize());
      this._observer.observe(wrap);
    } else {
      window.addEventListener('resize', () => this.resize());
    }
  }

  /** @param {import('./model.js').Song} song */
  usesTimeline(song = this.getSong()) {
    return song.arrangement.length > 1 && this.isolatedPattern < 0;
  }

  /** @param {number} patternIndex */
  focusPattern(patternIndex) {
    const song = this.getSong();
    const slot = song.arrangement.indexOf(patternIndex);
    if (song.arrangement.length > 1 && slot >= 0) {
      this.isolatedPattern = -1;
      this.viewStartBar = slot * barsOf(song);
    } else if (song.arrangement.length > 1) {
      this.isolatedPattern = patternIndex;
    } else {
      this.isolatedPattern = -1;
    }
    this.resize();
  }

  /** @param {number} delta */
  nudgeWindow(delta) {
    this.viewStartBar += delta;
    this.resize();
  }

  resize() {
    const song = this.getSong();
    const wrap = this.canvas.parentElement;
    const width = wrap?.clientWidth || 0;
    let cssW = LABEL_W + song.steps * COL_W;
    if (this.usesTimeline(song)) {
      if (width < LABEL_W + STEPS_PER_BAR * MIN_COL) return;
      const total = songBarCount(song);
      this.visibleBars = visibleBarCount(width, total, {
        labelW: LABEL_W,
        colW: COL_W,
        minCol: MIN_COL,
        maxCol: MAX_COL,
        stepsPerBar: STEPS_PER_BAR
      });
      this.colW = (width - LABEL_W) / (this.visibleBars * STEPS_PER_BAR);
      cssW = width;
      if (this.colW > MAX_COL) {
        this.colW = MAX_COL;
        cssW = Math.round(LABEL_W + this.visibleBars * STEPS_PER_BAR * this.colW);
      } else if (this.colW < MIN_COL) {
        this.colW = MIN_COL;
        cssW = Math.round(LABEL_W + this.visibleBars * STEPS_PER_BAR * this.colW);
      }
      const maxStart = Math.max(0, total - this.visibleBars);
      this.viewStartBar = Math.max(0, Math.min(this.viewStartBar, maxStart));
    } else {
      this.visibleBars = barsOf(song);
      this.viewStartBar = 0;
      this.colW = COL_W;
    }
    this._applySize(cssW, PITCH_COUNT * ROW_H);
    this.draw();
    this.onViewChange();
  }

  /**
   * @param {number} cssW
   * @param {number} cssH
   */
  _applySize(cssW, cssH) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /**
   * @param {number} step
   * @param {number} [arrIndex]
   */
  setPlayhead(step, arrIndex = 0) {
    if (
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches &&
      this.playheadStep >= 0 &&
      step % 4 !== 0
    ) {
      return;
    }
    this.playheadStep = step;
    this.playheadArr = arrIndex;
    const song = this.getSong();
    if (this.usesTimeline(song)) {
      const bar = arrIndex * barsOf(song) + Math.floor(step / STEPS_PER_BAR);
      const end = this.viewStartBar + Math.max(1, this.visibleBars);
      if (bar < this.viewStartBar || bar >= end) {
        this.viewStartBar = bar;
        this.resize();
        return;
      }
    }
    this.draw();
  }

  clearPlayhead() {
    this.playheadStep = -1;
    this.playheadArr = 0;
    this.draw();
  }

  draw() {
    const song = this.getSong();
    const ctx = this.ctx;
    const timeline = this.usesTimeline(song);
    const steps = timeline ? this.visibleBars * STEPS_PER_BAR : song.steps;
    const colW = this.colW;
    const origin = timeline ? this.viewStartBar * STEPS_PER_BAR : 0;
    const w = LABEL_W + steps * colW;
    const h = PITCH_COUNT * ROW_H;
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = '#12151c';
    ctx.fillRect(0, 0, w, h);

    for (let i = 0; i < PITCH_COUNT; i++) {
      const midi = PITCH_MAX - i;
      const y = i * ROW_H;
      ctx.fillStyle = isBlackKey(midi) ? '#1a1f2a' : '#151922';
      ctx.fillRect(LABEL_W, y, w - LABEL_W, ROW_H);
      if (isC(midi)) {
        ctx.fillStyle = 'rgba(96, 165, 250, 0.08)';
        ctx.fillRect(LABEL_W, y, w - LABEL_W, ROW_H);
      }
    }

    for (let s = 0; s <= steps; s++) {
      const x = LABEL_W + s * colW;
      const abs = origin + s;
      const isBar = abs % STEPS_PER_BAR === 0;
      const isBeat = abs % 4 === 0;
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

    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    for (let i = 0; i <= PITCH_COUNT; i++) {
      const y = i * ROW_H;
      ctx.beginPath();
      ctx.moveTo(LABEL_W, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    const vis1 = origin + steps;
    for (const source of this._sources(song, origin, vis1)) {
      const pattern = song.patterns[source.patternIndex];
      const notes = pattern?.tracks[song.activeChannel] || [];
      for (const note of notes) {
        const row = PITCH_MAX - note.p;
        if (row < 0 || row >= PITCH_COUNT) continue;
        const abs = source.slotOrigin + note.s;
        const absEnd = abs + note.l;
        const draw0 = Math.max(abs, origin);
        const draw1 = Math.min(absEnd, vis1);
        if (draw1 <= draw0) continue;
        const x = LABEL_W + (draw0 - origin) * colW + 1;
        const y = row * ROW_H + 1;
        const nw = (draw1 - draw0) * colW - 2;
        ctx.fillStyle = '#5eead4';
        ctx.fillRect(x, y, nw, ROW_H - 2);
        ctx.fillStyle = 'rgba(15, 23, 42, 0.55)';
        ctx.fillRect(x, y, Math.min(4, nw), ROW_H - 2);
      }
    }

    const playAbs = timeline
      ? this.playheadArr * song.steps + this.playheadStep
      : this.playheadStep;
    if (this.playheadStep >= 0 && playAbs >= origin && playAbs < vis1) {
      const x = LABEL_W + (playAbs - origin) * colW;
      ctx.fillStyle = 'rgba(251, 191, 36, 0.28)';
      ctx.fillRect(x, 0, colW, h);
    }

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

  /**
   * @param {import('./model.js').Song} song
   * @param {number} origin
   * @param {number} vis1
   */
  _sources(song, origin, vis1) {
    if (!this.usesTimeline(song)) {
      const patternIndex = this.isolatedPattern >= 0 ? this.isolatedPattern : song.activePattern;
      return [{ patternIndex, slotOrigin: 0 }];
    }
    /** @type {{ patternIndex: number, slotOrigin: number }[]} */
    const sources = [];
    for (let slot = 0; slot < song.arrangement.length; slot++) {
      const slotOrigin = slot * song.steps;
      if (slotOrigin + song.steps <= origin || slotOrigin >= vis1) continue;
      sources.push({ patternIndex: song.arrangement[slot] ?? 0, slotOrigin });
    }
    return sources;
  }

  /** @param {PointerEvent} e */
  _cellFromEvent(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const song = this.getSong();
    if (x < LABEL_W) return null;
    const row = Math.floor(y / ROW_H);
    if (row < 0 || row >= PITCH_COUNT) return null;
    const pitch = PITCH_MAX - row;
    if (!this.usesTimeline(song)) {
      const step = Math.floor((x - LABEL_W) / this.colW);
      if (step < 0 || step >= song.steps) return null;
      const patternIndex = this.isolatedPattern >= 0 ? this.isolatedPattern : song.activePattern;
      return { step, pitch, patternIndex };
    }
    const visStep = Math.floor((x - LABEL_W) / this.colW);
    const abs = this.viewStartBar * STEPS_PER_BAR + visStep;
    const totalSteps = song.arrangement.length * song.steps;
    if (visStep < 0 || abs < 0 || abs >= totalSteps) return null;
    const slot = Math.floor(abs / song.steps);
    return {
      step: abs - slot * song.steps,
      pitch,
      patternIndex: song.arrangement[slot] ?? 0
    };
  }

  /** @param {import('./model.js').Song} song @param {number} patternIndex */
  _track(song, patternIndex) {
    const pattern = song.patterns[patternIndex] || song.patterns[0];
    return pattern?.tracks[song.activeChannel] || pattern?.tracks[0] || activeTrack(song);
  }

  /** @param {PointerEvent} e */
  _pointerDown(e) {
    if (e.button !== 0) return;
    const cell = this._cellFromEvent(e);
    if (!cell) return;
    this.onBeforeEdit();
    const song = this.getSong();
    if (cell.patternIndex !== song.activePattern && song.patterns[cell.patternIndex]) {
      song.activePattern = cell.patternIndex;
    }
    const notes = this._track(song, cell.patternIndex);
    const existing = findNoteAt(notes, cell.pitch, cell.step);
    this.canvas.setPointerCapture(e.pointerId);
    if (existing) {
      paintNote(notes, cell.pitch, cell.step, 1, song.steps);
      this._drag = {
        mode: 'erase',
        pitch: cell.pitch,
        start: existing.s,
        patternIndex: cell.patternIndex
      };
    } else {
      paintNote(notes, cell.pitch, cell.step, 1, song.steps);
      this.onPreview(cell.pitch);
      this._drag = {
        mode: 'paint',
        pitch: cell.pitch,
        start: cell.step,
        patternIndex: cell.patternIndex
      };
    }
    this.onChange();
    this.draw();
  }

  /** @param {PointerEvent} e */
  _pointerMove(e) {
    if (!this._drag || this._drag.mode !== 'paint') return;
    const cell = this._cellFromEvent(e);
    if (!cell || cell.pitch !== this._drag.pitch || cell.patternIndex !== this._drag.patternIndex) {
      return;
    }
    const song = this.getSong();
    const notes = this._track(song, this._drag.patternIndex);
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

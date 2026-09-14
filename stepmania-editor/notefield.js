import { quantColorForBeat } from './noteQuantization.js';

const COL_COLORS = ['#e11d48', '#2563eb', '#22c55e', '#eab308'];
const COL_LABELS = ['←', '↓', '↑', '→'];
const BEATS_PER_MEASURE = 4;
/** Left gutter reserves room for measure numbers, as the native field does. */
const PAD = 44;

/**
 * @typedef {Object} NotefieldState
 * @property {Array} noteData
 * @property {number} cursorBeat
 * @property {number} cursorCol
 * @property {number} snap
 * @property {number} playBeat
 * @property {boolean} playing
 */

/**
 * @param {HTMLCanvasElement} canvas
 * @param {() => NotefieldState} getState
 * @param {(ev: { type: string, beat: number, col: number }) => void} onInput
 */
export function mountNotefield(canvas, getState, onInput) {
  const ctx = canvas.getContext('2d');
  const colCount = 4;
  const receptorsY = 52;
  const basePxPerBeat = 56;
  let pxPerBeat = basePxPerBeat;
  let viewBeat = 0;
  let dragging = null;
  let raf = 0;

  function size() {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function beatAtY(y) {
    return viewBeat + (y - receptorsY) / pxPerBeat;
  }

  function colAtX(x) {
    const w = canvas.clientWidth;
    const pad = PAD;
    const inner = w - pad * 2;
    const cw = inner / colCount;
    return Math.max(0, Math.min(3, Math.floor((x - pad) / cw)));
  }

  function draw() {
    const state = getState();
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    pxPerBeat = basePxPerBeat * (state.zoom || 1);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0b1020';
    ctx.fillRect(0, 0, w, h);

    if (state.playing) viewBeat = Math.max(0, state.playBeat - 0.5);
    else viewBeat = Math.max(0, state.cursorBeat - 2);

    const pad = PAD;
    const inner = w - pad * 2;
    const cw = inner / colCount;

    drawSelection(state, pad, w, h);
    const beatsOnScreen = h / pxPerBeat + 2;
    const startBeat = Math.floor(viewBeat);
    const snapStep = 4 / (state.snap || 16);

    // Faint snap grid, then beat and measure lines on top. Measure lines are
    // drawn on their own pass so an off-grid snap (triplets) can't skip them.
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.beginPath();
    for (
      let b = Math.ceil(startBeat / snapStep) * snapStep;
      b < viewBeat + beatsOnScreen;
      b += snapStep
    ) {
      const y = receptorsY + (b - viewBeat) * pxPerBeat;
      ctx.moveTo(pad, y);
      ctx.lineTo(w - pad, y);
    }
    ctx.stroke();

    ctx.font = '11px ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let b = Math.max(0, Math.ceil(viewBeat)); b < viewBeat + beatsOnScreen; b += 1) {
      const y = receptorsY + (b - viewBeat) * pxPerBeat;
      const isMeasure = b % BEATS_PER_MEASURE === 0;
      ctx.strokeStyle = isMeasure ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.14)';
      ctx.lineWidth = isMeasure ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(pad, y);
      ctx.lineTo(w - pad, y);
      ctx.stroke();
      if (isMeasure) {
        ctx.fillStyle = 'rgba(226,232,240,0.75)';
        ctx.fillText(String(b / BEATS_PER_MEASURE), pad - 5, y);
      }
    }

    for (let col = 0; col < colCount; col++) {
      const x = pad + col * cw + cw / 2;
      ctx.fillStyle = COL_COLORS[col];
      ctx.globalAlpha = 0.9;
      rounded(ctx, x - 18, receptorsY - 18, 36, 36, 8);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#0b1020';
      ctx.font = '16px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(COL_LABELS[col], x, receptorsY);
    }

    for (const [beat, col, props] of state.noteData || []) {
      const y = receptorsY + (beat - viewBeat) * pxPerBeat;
      if (y < -40 || y > h + 80) continue;
      const x = pad + col * cw + cw / 2;
      const duration = Number(props?.Duration) || 0;
      if ((props?.Type === 2 || props?.Type === 4) && duration > 0) {
        const endY = receptorsY + (beat + duration / 48 - viewBeat) * pxPerBeat;
        ctx.fillStyle = props.Type === 4 ? 'rgba(168,85,247,0.35)' : 'rgba(251,146,60,0.35)';
        ctx.fillRect(x - 8, y, 16, Math.max(8, endY - y));
      }
      drawNote(ctx, x, y, props, quantColorForBeat(beat));
    }

    const cy = receptorsY + (state.cursorBeat - viewBeat) * pxPerBeat;
    const cx = pad + state.cursorCol * cw + cw / 2;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.strokeRect(cx - 22, cy - 22, 44, 44);

    if (state.playing) {
      const py = receptorsY + (state.playBeat - viewBeat) * pxPerBeat;
      ctx.strokeStyle = '#f472b6';
      ctx.beginPath();
      ctx.moveTo(pad, py);
      ctx.lineTo(w - pad, py);
      ctx.stroke();
    }
  }

  /** Area markers, laid with Space the way StepMania's LAY_SELECT does. */
  function drawSelection(state, pad, w, h) {
    const { selStart, selEnd } = state;
    if (selStart == null) return;
    const yFor = (beat) => receptorsY + (beat - viewBeat) * pxPerBeat;
    if (selEnd == null) {
      const y = yFor(selStart);
      ctx.strokeStyle = 'rgba(56,189,248,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(pad, y);
      ctx.lineTo(w - pad, y);
      ctx.stroke();
      return;
    }
    const top = yFor(Math.min(selStart, selEnd));
    const bottom = yFor(Math.max(selStart, selEnd));
    if (bottom < 0 || top > h) return;
    ctx.fillStyle = 'rgba(56,189,248,0.14)';
    ctx.fillRect(pad, top, w - pad * 2, bottom - top);
  }

  function pointer(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  canvas.addEventListener('mousedown', (e) => {
    const p = pointer(e);
    const col = colAtX(p.x);
    const beat = Math.max(0, getState().quantize(beatAtY(p.y)));
    dragging = { col, beat };
    onInput({ type: 'down', beat, col });
  });
  window.addEventListener('mouseup', (e) => {
    if (!dragging) return;
    const p = pointer(e);
    const beat = Math.max(0, getState().quantize(beatAtY(p.y)));
    onInput({ type: 'up', beat, col: dragging.col, startBeat: dragging.beat });
    dragging = null;
  });

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      onInput({ type: 'wheel', delta: e.deltaY > 0 ? 1 : -1 });
    },
    { passive: false }
  );

  function loop() {
    draw();
    raf = requestAnimationFrame(loop);
  }

  size();
  window.addEventListener('resize', size);
  raf = requestAnimationFrame(loop);

  return {
    destroy() {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', size);
    }
  };
}

function rounded(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawNote(ctx, x, y, props, color) {
  const type = props?.Type;
  ctx.save();
  ctx.translate(x, y);
  if (type === 'M') {
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(0, 0, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('!', 0, 1);
  } else if (type === 'L') {
    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(-14, -6, 28, 12);
  } else if (type === 'F') {
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, -16);
    ctx.lineTo(16, 0);
    ctx.lineTo(0, 16);
    ctx.lineTo(-16, 0);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, -16);
    ctx.lineTo(16, 0);
    ctx.lineTo(0, 16);
    ctx.lineTo(-16, 0);
    ctx.closePath();
    ctx.fill();
    if (type === 4) {
      ctx.strokeStyle = '#a855f7';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }
  ctx.restore();
}

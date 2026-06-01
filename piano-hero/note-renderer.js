// Pure draw helpers for the falling-notes canvas. The engine calls
// `renderFrame(ctx, opts)` once per requestAnimationFrame; everything
// here is stateless beyond a tiny per-frame layout cache.
//
// Coordinate model:
//   - x, width align to the on-screen piano keyboard. Each note's x is
//     derived from `keyboard.keyEls.get(midi).getBoundingClientRect()`,
//     translated into the canvas's local coordinate space.
//   - y is computed from `(note.time - songNow) * pixelsPerSecond`, with
//     y=0 at the top of the canvas and y=canvasHeight at the strike line
//     (just above the keyboard).
//   - A note that spans `duration` seconds becomes a rectangle of height
//     `duration * pixelsPerSecond`.

import { HAND_COLORS } from './game-state.js';

/** Pixels per second of song time. Higher = notes fall faster, fewer
 *  visible at once. 280 px/s gives ~1.5 s of look-ahead on a 420 px canvas
 *  which is enough to react. The engine can tune this if we expose a
 *  "scroll speed" preference later. */
export const DEFAULT_PIXELS_PER_SECOND = 280;

/**
 * Render a single frame.
 *
 * @param {Object} args
 * @param {import('./canvas-manager.js').default} args.canvasManager
 * @param {Map<number, HTMLElement>} args.keyEls  midi -> piano-key element
 * @param {{ midi: number, time: number, duration: number, hand: 'left'|'right' }[]} args.notes
 *        Already filtered by hand-active state; assumed sorted by time.
 * @param {number} args.songNow                   Current song time in seconds.
 * @param {number} [args.pixelsPerSecond]
 * @param {Set<number>} [args.activeHits]         midi notes currently lit (Watch
 *                                                 mode: notes audibly playing;
 *                                                 Play-along: notes the user just
 *                                                 successfully hit).
 */
export function renderFrame({
  canvasManager,
  keyEls,
  notes,
  songNow,
  pixelsPerSecond = DEFAULT_PIXELS_PER_SECOND,
  activeHits
}) {
  const ctx = canvasManager.ctx;
  if (!ctx) return;
  canvasManager.beginFrame();
  const { width, height } = canvasManager;

  // Strike line sits 4 px above the canvas bottom — the line where notes
  // "land" on the keyboard.
  const strikeY = height - 4;

  drawStrikeLine(ctx, width, strikeY);

  if (!keyEls || keyEls.size === 0 || !notes || notes.length === 0) {
    drawHitFlash(ctx, keyEls, activeHits, width, strikeY, canvasManager);
    return;
  }

  // Build a per-frame x/width cache for visible MIDIs. Doing this once
  // is much cheaper than calling getBoundingClientRect per-note.
  const canvasRect = canvasManager.element.getBoundingClientRect();
  const keyRects = new Map();
  for (const [midi, el] of keyEls.entries()) {
    const r = el.getBoundingClientRect();
    keyRects.set(midi, {
      x: r.left - canvasRect.left,
      width: r.width,
      isBlack: el.classList.contains('black')
    });
  }

  // Visible y-range. Anything whose end is above the canvas top, or
  // whose start is below the strike line, is offscreen.
  const lookAheadSec = (strikeY / pixelsPerSecond) * 1.2; // a little slack
  for (const note of notes) {
    const dt = note.time - songNow;
    if (dt > lookAheadSec) break; // sorted, so nothing later is visible
    if (dt + note.duration < -0.05) continue; // fully past the strike line

    const rect = keyRects.get(note.midi);
    if (!rect) continue;

    const yBottom = strikeY - dt * pixelsPerSecond;
    const yTop = yBottom - note.duration * pixelsPerSecond;
    if (yBottom < 0 || yTop > strikeY) continue;

    drawFallingNote(ctx, {
      x: rect.x,
      y: yTop,
      width: rect.width,
      height: yBottom - yTop,
      hand: note.hand,
      isBlack: rect.isBlack,
      // Notes currently at or just past the strike line glow brighter to
      // signal "play me now".
      atStrike: dt <= 0 && dt + note.duration > 0
    });
  }

  drawHitFlash(ctx, keyEls, activeHits, width, strikeY, canvasManager);
}

/**
 * Draw a single falling note rectangle.
 */
export function drawFallingNote(ctx, { x, y, width, height, hand, isBlack, atStrike }) {
  if (height < 4) height = 4;
  const color = HAND_COLORS[hand] || HAND_COLORS.right;
  // Black-key notes are inset and narrower so they read as visually distinct.
  const inset = isBlack ? 1 : 2;
  const ix = x + inset;
  const iw = Math.max(2, width - inset * 2);

  ctx.save();
  // Subtle vertical gradient — bright at the bottom (where it'll strike)
  // fading slightly toward the top so a long note doesn't look flat.
  const grad = ctx.createLinearGradient(0, y, 0, y + height);
  grad.addColorStop(0, withAlpha(color, 0.7));
  grad.addColorStop(1, withAlpha(color, 1.0));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.roundRect(ix, y, iw, height, 4);
  ctx.fill();

  // Outline pop when the note is currently being played (at the strike line).
  if (atStrike) {
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#fef3c7';
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.roundRect(ix, y, iw, height, 4);
    ctx.stroke();
  }
  ctx.restore();
}

/** Draw the strike line just above the keyboard. */
export function drawStrikeLine(ctx, width, strikeY) {
  ctx.save();
  ctx.fillStyle = 'rgba(99, 102, 241, 0.15)';
  ctx.fillRect(0, strikeY - 1, width, 2);
  ctx.fillStyle = 'rgba(99, 102, 241, 0.55)';
  ctx.fillRect(0, strikeY, width, 1);
  ctx.restore();
}

/** Highlight any keys currently being hit with a subtle flash band. */
export function drawHitFlash(ctx, keyEls, activeHits, width, strikeY, canvasManager) {
  if (!keyEls || !activeHits || activeHits.size === 0) return;
  const canvasRect = canvasManager.element.getBoundingClientRect();
  ctx.save();
  for (const midi of activeHits) {
    const el = keyEls.get(midi);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    const x = r.left - canvasRect.left;
    const w = r.width;
    const grad = ctx.createLinearGradient(0, strikeY - 32, 0, strikeY);
    grad.addColorStop(0, 'rgba(254, 243, 199, 0)');
    grad.addColorStop(1, 'rgba(254, 243, 199, 0.45)');
    ctx.fillStyle = grad;
    ctx.fillRect(x, strikeY - 32, w, 32);
  }
  ctx.restore();
}

function withAlpha(hex, alpha) {
  // Accepts #RRGGBB; returns rgba string.
  if (typeof hex !== 'string' || hex[0] !== '#' || hex.length !== 7) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

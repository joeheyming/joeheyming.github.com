/**
 * Media Player visualizer draw helpers (canvas 2d).
 * Modes match common player UIs: spectrum bars, oscilloscope line, both, mirrored bars, radial.
 */

export const VIZ_MODES = ['both', 'bars', 'line', 'mirror', 'radial'];

/** Shown briefly on the canvas when the mode is cycled by click. */
export const VIZ_MODE_LABELS = {
  both: 'Bars + wave',
  bars: 'Bars',
  line: 'Wave',
  mirror: 'Mirror',
  radial: 'Radial'
};

export const VIZ_SIZE = {
  minWidth: 220,
  minHeight: 80,
  maxHeight: 720,
  defaultHeight: 240
};

/** Size the stroke widths and gaps were originally tuned against. */
const BASE_WIDTH = 520;
const BASE_HEIGHT = 140;

/**
 * Geometric mean of the width and height ratios, so line weights and gaps
 * grow with the box instead of staying hairline-thin when it is dragged large.
 * @param {number} width
 * @param {number} height
 */
export function vizScale(width, height) {
  const w = Math.max(1, width) / BASE_WIDTH;
  const h = Math.max(1, height) / BASE_HEIGHT;
  return Math.max(0.5, Math.min(4, Math.sqrt(w * h)));
}

/**
 * @param {unknown} value
 * @returns {'both'|'bars'|'line'|'mirror'|'radial'}
 */
export function normalizeVizMode(value) {
  if (typeof value === 'string' && VIZ_MODES.includes(value)) {
    return /** @type {'both'|'bars'|'line'|'mirror'|'radial'} */ (value);
  }
  return 'both';
}

/**
 * Next mode in the cycle, wrapping at the end.
 * @param {unknown} current
 * @returns {'both'|'bars'|'line'|'mirror'|'radial'}
 */
export function nextVizMode(current) {
  const index = VIZ_MODES.indexOf(normalizeVizMode(current));
  return /** @type {'both'|'bars'|'line'|'mirror'|'radial'} */ (
    VIZ_MODES[(index + 1) % VIZ_MODES.length]
  );
}

/**
 * @param {unknown} width
 * @param {unknown} height
 * @returns {{ width: number, height: number }}
 */
export function clampVizSize(width, height) {
  const w = Number(width);
  const h = Number(height);
  return {
    width: Number.isFinite(w) ? Math.max(VIZ_SIZE.minWidth, w) : VIZ_SIZE.minWidth,
    height: Number.isFinite(h)
      ? Math.max(VIZ_SIZE.minHeight, Math.min(VIZ_SIZE.maxHeight, h))
      : VIZ_SIZE.defaultHeight
  };
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {{
 *   mode: string,
 *   freq: Uint8Array,
 *   time: Uint8Array|null,
 *   width: number,
 *   height: number,
 *   barTop: string,
 *   barBottom: string,
 *   line: string
 * }} opts
 */
export function drawVisualizer(ctx, opts) {
  const mode = normalizeVizMode(opts.mode);
  const { freq, time, width, height, barTop, barBottom, line } = opts;
  ctx.clearRect(0, 0, width, height);
  if (width < 2 || height < 2) return;
  const scale = vizScale(width, height);

  if (mode === 'bars') drawBars(ctx, freq, width, height, height, barTop, barBottom, 1, scale);
  else if (mode === 'line') drawWave(ctx, time, width, height, line, scale);
  else if (mode === 'mirror') drawMirror(ctx, freq, width, height, barTop, barBottom, scale);
  else if (mode === 'radial') drawRadial(ctx, freq, width, height, barTop, barBottom, scale);
  else {
    const band = Math.max(24 * scale, Math.floor(height * 0.28));
    drawBars(ctx, freq, width, height, band, barTop, barBottom, 0.45, scale);
    drawWave(ctx, time, width, height, line, scale);
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {Uint8Array} freq
 * @param {number} width
 * @param {number} height
 * @param {number} band
 * @param {string} barTop
 * @param {string} barBottom
 * @param {number} alpha
 * @param {number} scale
 */
function drawBars(ctx, freq, width, height, band, barTop, barBottom, alpha, scale) {
  const gradient = ctx.createLinearGradient(0, height - band, 0, height);
  gradient.addColorStop(0, barTop);
  gradient.addColorStop(1, barBottom);
  ctx.fillStyle = gradient;
  ctx.globalAlpha = alpha;
  const n = freq.length;
  const barWidth = (width / n) * 2.5;
  const gap = Math.min(barWidth * 0.4, scale);
  let x = 0;
  for (let i = 0; i < n; i++) {
    const barHeight = (freq[i] / 255) * band;
    ctx.fillRect(x, height - barHeight, barWidth - gap, barHeight);
    x += barWidth;
    if (x > width) break;
  }
  ctx.globalAlpha = 1;
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {Uint8Array|null} time
 * @param {number} width
 * @param {number} height
 * @param {string} color
 * @param {number} scale
 */
function drawWave(ctx, time, width, height, color, scale) {
  if (!time || time.length < 2) return;
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5 * scale;
  ctx.lineJoin = 'round';
  const n = time.length;
  for (let i = 0; i < n; i++) {
    const px = (i / (n - 1)) * width;
    const py = (time[i] / 255) * height;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {Uint8Array} freq
 * @param {number} width
 * @param {number} height
 * @param {string} barTop
 * @param {string} barBottom
 * @param {number} scale
 */
function drawMirror(ctx, freq, width, height, barTop, barBottom, scale) {
  const mid = height / 2;
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, barTop);
  gradient.addColorStop(0.5, barBottom);
  gradient.addColorStop(1, barTop);
  ctx.fillStyle = gradient;
  const n = freq.length;
  const barWidth = (width / n) * 2.5;
  const gap = Math.min(barWidth * 0.4, scale);
  let x = 0;
  for (let i = 0; i < n; i++) {
    const h = ((freq[i] / 255) * height) / 2;
    ctx.fillRect(x, mid - h, barWidth - gap, h * 2);
    x += barWidth;
    if (x > width) break;
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {Uint8Array} freq
 * @param {number} width
 * @param {number} height
 * @param {string} barTop
 * @param {string} barBottom
 * @param {number} scale
 */
function drawRadial(ctx, freq, width, height, barTop, barBottom, scale) {
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) * 0.28;
  const maxLen = Math.min(width, height) * 0.42;
  const count = Math.min(96, freq.length);
  const step = Math.max(1, Math.floor(freq.length / count));
  ctx.strokeStyle = barTop;
  ctx.lineWidth = Math.max(1.5 * scale, (Math.PI * 2 * radius) / count - scale);
  ctx.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    const mag = freq[Math.min(freq.length - 1, i * step)] / 255;
    const ang = (i / count) * Math.PI * 2 - Math.PI / 2;
    const inner = radius;
    const outer = radius + mag * maxLen;
    ctx.beginPath();
    ctx.strokeStyle = mag > 0.55 ? barBottom : barTop;
    ctx.moveTo(cx + Math.cos(ang) * inner, cy + Math.sin(ang) * inner);
    ctx.lineTo(cx + Math.cos(ang) * outer, cy + Math.sin(ang) * outer);
    ctx.stroke();
  }
}

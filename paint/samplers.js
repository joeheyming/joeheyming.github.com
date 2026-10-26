// Color Sampler points (PhotoCraft engine sampler_cmds.rs, analysis_ui.rs Tool::ColorSampler):
// numbered colour readings pinned to canvas pixels and listed in the Info panel. state.samplers
// is an array of [x, y] whole pixels, at most MAX_SAMPLERS; every helper returns a new array.
// Saved in .paintproj. Sample Size averages a square centred on the point (sample_cmds.rs).

/** Photoshop's Color Sampler limit: at most 10 points per document. */
export const MAX_SAMPLERS = 10;

/** The options bar's Sample Size choices: 1 = Point Sample, else the side of the square. */
export const SAMPLER_SIZES = [
  { value: '1', label: 'Point Sample' },
  { value: '3', label: '3 by 3 Average' },
  { value: '5', label: '5 by 5 Average' }
];

// The whole pixel (x, y) lands on, or null when it is off the W × H canvas.
function pixelAt(x, y, W, H) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const px = Math.floor(x),
    py = Math.floor(y);
  return px >= 0 && py >= 0 && px < W && py < H ? [px, py] : null;
}

/**
 * view.colorSamplers.add: a point on the pixel under (x, y). Returns the same array when the
 * point is off the canvas or the document already has MAX_SAMPLERS points.
 */
export function addSampler(points, x, y, W, H) {
  const p = pixelAt(x, y, W, H);
  if (!p || points.length >= MAX_SAMPLERS) return points;
  return [...points, p];
}

/** view.colorSamplers.move; off the canvas the point is removed (a drag off-canvas). */
export function moveSampler(points, i, x, y, W, H) {
  if (i < 0 || i >= points.length) return points;
  const p = pixelAt(x, y, W, H);
  if (!p) return removeSampler(points, i);
  return points.map((q, j) => (j === i ? p : q));
}

/** view.colorSamplers.delete: later points renumber down by one. */
export function removeSampler(points, i) {
  return points.filter((_, j) => j !== i);
}

/** Index of the point nearest (x, y) within tol px (measured from the pixel centre), or -1. */
export function nearestSampler(points, x, y, tol) {
  let best = -1,
    bestD = Infinity;
  points.forEach(([px, py], i) => {
    const d = Math.hypot(px + 0.5 - x, py + 0.5 - y);
    if (d <= tol && d < bestD) {
      best = i;
      bestD = d;
    }
  });
  return best;
}

/** Points from a .paintproj (older files have none), capped at MAX_SAMPLERS. */
export function normalizeSamplers(points) {
  if (!Array.isArray(points)) return [];
  const ok = (p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]);
  return points
    .filter(ok)
    .slice(0, MAX_SAMPLERS)
    .map(([x, y]) => [Math.floor(x), Math.floor(y)]);
}

/**
 * The RGB a sample of `size` reads at pixel (x, y) of imgData (sample_cmds.rs sample_rect and
 * average): the size × size square centred on it, clipped to the canvas, averaged weighted by
 * alpha so transparent pixels don't darken it, and rounded. All transparent reads [0, 0, 0].
 */
export function sampleAverage(imgData, x, y, size = 1) {
  const { width: W, height: H, data } = imgData;
  const r = Math.floor(Math.max(1, size) / 2);
  const x0 = Math.max(0, x - r),
    x1 = Math.min(W - 1, x + r);
  const y0 = Math.max(0, y - r),
    y1 = Math.min(H - 1, y + r);
  let sr = 0,
    sg = 0,
    sb = 0,
    sa = 0;
  for (let yy = y0; yy <= y1; yy++) {
    for (let xx = x0; xx <= x1; xx++) {
      const i = (yy * W + xx) * 4;
      const a = data[i + 3];
      sr += data[i] * a;
      sg += data[i + 1] * a;
      sb += data[i + 2] * a;
      sa += a;
    }
  }
  if (sa === 0) return [0, 0, 0];
  return [Math.round(sr / sa), Math.round(sg / sa), Math.round(sb / sa)];
}

/** The Info panel's rows: [{ number, rgb }] for each point, read from the composite. */
export function samplerReadouts(imgData, points, size = 1) {
  return points.map(([x, y], i) => ({ number: i + 1, rgb: sampleAverage(imgData, x, y, size) }));
}

/**
 * Each point's marker (analysis_ui.rs draw_overlay): a crosshair ring on the pixel centre and its
 * number to the lower right, in screen px at `zoom`.
 */
export function drawSamplerMarkers(ov, points, zoom = 1) {
  const px = 1 / (zoom || 1);
  ov.save();
  ov.lineWidth = 1.5 * px;
  ov.font = `${10 * px}px sans-serif`;
  ov.textAlign = 'left';
  ov.textBaseline = 'top';
  points.forEach(([x, y], i) => {
    const cx = x + 0.5,
      cy = y + 0.5;
    for (const [color, w] of [
      ['#000', 3 * px],
      ['#fff', 1.5 * px]
    ]) {
      ov.strokeStyle = color;
      ov.lineWidth = w;
      ov.beginPath();
      ov.arc(cx, cy, 5 * px, 0, Math.PI * 2);
      ov.moveTo(cx, cy - 9 * px);
      ov.lineTo(cx, cy - 5 * px);
      ov.moveTo(cx, cy + 5 * px);
      ov.lineTo(cx, cy + 9 * px);
      ov.moveTo(cx - 9 * px, cy);
      ov.lineTo(cx - 5 * px, cy);
      ov.moveTo(cx + 5 * px, cy);
      ov.lineTo(cx + 9 * px, cy);
      ov.stroke();
    }
    ov.fillStyle = '#fff';
    ov.fillText(String(i + 1), cx + 7 * px, cy + 5 * px);
  });
  ov.restore();
}

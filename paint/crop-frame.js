// Paint — Crop tool frame geometry (PhotoCraft crates/ui-egui/src/crop_ui.rs, Classic Mode,
// upright). A frame is [x0, y0, x1, y1] in document px with x0 <= x1 and y0 <= y1.

/** Screen px of handle reach; divide by the zoom for document px (crop_ui.rs HANDLE_PX). */
export const CROP_HANDLE_PX = 8;
/** Smallest frame side in document px (crop_ui.rs MIN_FRAME). */
export const CROP_MIN_FRAME = 1;

const HANDLE_NAMES = {
  '0,-1': 'n',
  '0,1': 's',
  '1,0': 'e',
  '-1,0': 'w',
  '1,-1': 'ne',
  '-1,-1': 'nw',
  '1,1': 'se',
  '-1,1': 'sw'
};

// Handle name → [hx, hy] with -1 the low edge, 1 the high edge, 0 the axis is untouched.
const HANDLE_AXES = Object.fromEntries(
  Object.entries(HANDLE_NAMES).map(([k, name]) => [name, k.split(',').map(Number)])
);

function normalized(ax, ay, bx, by) {
  return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
}

/**
 * What (x, y) is over: 'inside', a handle ('n' 's' 'e' 'w' 'ne' 'nw' 'se' 'sw'), or 'outside'.
 * handlePx is the reach in document px; inside a small frame it shrinks to a quarter of the
 * side so the middle stays movable (crop_ui.rs hit).
 */
export function cropHit(frame, x, y, handlePx) {
  const [x0, y0, x1, y1] = frame;
  const tol = handlePx;
  const axis = (lo, hi, v, otherIn) => {
    if (!otherIn) return 0;
    const t = Math.max(0, Math.min(tol, (hi - lo) / 4));
    // Outside the frame the full reach applies; inside it, the shrunk one.
    const near = (e, outward) => (v - e) * outward <= tol && (e - v) * outward <= t;
    const nLo = near(lo, -1);
    const nHi = near(hi, 1);
    if (nLo && nHi) return Math.abs(v - lo) <= Math.abs(v - hi) ? -1 : 1;
    if (nLo) return -1;
    if (nHi) return 1;
    return 0;
  };
  const inX = x >= x0 - tol && x <= x1 + tol;
  const inY = y >= y0 - tol && y <= y1 + tol;
  const hx = axis(x0, x1, x, inY);
  const hy = axis(y0, y1, y, inX);
  if (hx !== 0 || hy !== 0) return HANDLE_NAMES[`${hx},${hy}`];
  if (x > x0 && x < x1 && y > y0 && y < y1) return 'inside';
  return 'outside';
}

/**
 * The frame after dragging `hit` by (dx, dy). 'inside' moves it; a handle resizes from the
 * opposite edge (opts.alt about the centre, opts.ratio — width / height — holds that aspect,
 * else opts.shift keeps the frame's); 'outside' leaves it. Sides never drop below CROP_MIN_FRAME.
 * @param {number[]} frame
 * @param {string} hit
 * @param {number} dx
 * @param {number} dy
 * @param {{ shift?: boolean, alt?: boolean, ratio?: number | null }} [opts]
 */
export function cropDrag(frame, hit, dx, dy, opts = {}) {
  const [x0, y0, x1, y1] = frame;
  if (hit === 'inside') return [x0 + dx, y0 + dy, x1 + dx, y1 + dy];
  const axes = HANDLE_AXES[hit];
  if (!axes) return [x0, y0, x1, y1];
  const [hx, hy] = axes;
  const alt = !!opts.alt;
  // Per axis: the fixed point, the signed extent from it, and whether it is centred (the
  // extent is then a half-extent) — crop_ui.rs resized.
  const axis = (lo, hi, h, d) => {
    const c = (lo + hi) / 2;
    if (h === 1) return alt ? [c, hi + d - c, true] : [lo, hi + d - lo, false];
    if (h === -1) return alt ? [c, lo + d - c, true] : [hi, lo + d - hi, false];
    return [c, (hi - lo) / 2, true];
  };
  const [fx, ex0, cx] = axis(x0, x1, hx, dx);
  const [fy, ey0, cy] = axis(y0, y1, hy, dy);
  let ex = ex0;
  let ey = ey0;
  const full = (e, c) => Math.abs(e) * (c ? 2 : 1);
  const back = (e, len, c) => (e < 0 ? -1 : 1) * (c ? len / 2 : len);
  // A ratio preset holds its proportions; without one Shift keeps the frame's own.
  const k = validRatio(opts.ratio) ?? (opts.shift ? (x1 - x0) / (y1 - y0) : null);
  if (Number.isFinite(k) && k > 0) {
    let w = full(ex, cx);
    let h = full(ey, cy);
    if (hx !== 0 && hy !== 0) {
      // A corner: the larger relative extent wins.
      const s = Math.max(w / k, h);
      w = s * k;
      h = s;
    } else if (hx !== 0) h = w / k;
    else w = h * k;
    ex = back(ex, w, cx);
    ey = back(ey, h, cy);
  }
  // A side collapsed to nothing keeps its minimum toward the dragged handle.
  const least = (e, h, c) => back(e === 0 ? h || 1 : e, CROP_MIN_FRAME, c);
  if (full(ex, cx) < CROP_MIN_FRAME) ex = least(ex, hx, cx);
  if (full(ey, cy) < CROP_MIN_FRAME) ey = least(ey, hy, cy);
  const span = (f, e, c) => (c ? [f - e, f + e] : [f, f + e]);
  const [ax, bx] = span(fx, ex, cx);
  const [ay, by] = span(fy, ey, cy);
  return normalized(ax, ay, bx, by);
}

/**
 * A new frame dragged from (x0, y0) to (x1, y1): opts.ratio (width / height) held with the
 * larger relative extent winning, else opts.shift square; opts.alt from the centre
 * (crop_ui.rs drawn, chrome_ui.rs marquee_end).
 * @param {{ shift?: boolean, alt?: boolean, ratio?: number | null }} [opts]
 */
export function cropDraw(x0, y0, x1, y1, opts = {}) {
  let ex = x1;
  let ey = y1;
  const k = validRatio(opts.ratio);
  if (k) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const m = Math.max(Math.abs(dx) / k, Math.abs(dy));
    ex = x0 + (dx < 0 ? -1 : 1) * m * k;
    ey = y0 + (dy < 0 ? -1 : 1) * m;
  } else if (opts.shift) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const m = Math.max(Math.abs(dx), Math.abs(dy));
    ex = x0 + (dx < 0 ? -m : m);
    ey = y0 + (dy < 0 ? -m : m);
  }
  if (opts.alt) return normalized(2 * x0 - ex, 2 * y0 - ey, ex, ey);
  return normalized(x0, y0, ex, ey);
}

// ── Ratio presets (chrome_ui.rs CROP_RATIOS / crop_ratio, crop_ui.rs fitted_ratio, swapped,
// swapped_ratio) ──

/** The W x H mode key (chrome_ui.rs WHR, pixels only: Paint has no resolution). */
export const CROP_WXH = 'wxh';

/** The options-bar ratio presets: PhotoCraft's keys and labels; the empty key is no ratio. */
export const CROP_RATIOS = [
  { value: '', label: 'Ratio' },
  { value: CROP_WXH, label: 'W x H' },
  { value: 'original', label: 'Original Ratio' },
  { value: '1:1', label: '1 : 1 (Square)' },
  { value: '4:5', label: '4 : 5 (8 : 10)' },
  { value: '5:7', label: '5 : 7' },
  { value: '2:3', label: '2 : 3 (4 : 6)' },
  { value: '16:9', label: '16 : 9' }
];

// ── W x H presets (crop_size.rs PRESETS, FRONT, chosen, front_image, clear), px only ──

/** Size presets for the Ratio select: PhotoCraft's px presets (Paint has no resolution). */
export const CROP_SIZE_PRESETS = [
  { value: 'preset:1024x768px', label: '1024 x 768 px', w: '1024', h: '768' },
  { value: 'preset:1280x800px', label: '1280 x 800 px', w: '1280', h: '800' },
  { value: 'preset:1366x768px', label: '1366 x 768 px', w: '1366', h: '768' }
];
/** Select key that fills W x H from the document; applied at once, never kept as the ratio. */
export const CROP_FRONT = 'front';
/** Select key that empties the W x H fields; applied at once, never kept as the ratio. */
export const CROP_CLEAR = 'clear';

/**
 * The crop option patch for a Ratio select key (crop_size.rs chosen): a size preset, Front
 * Image (the docW x docH document), and Clear all leave W x H mode on with their fields; any
 * other key is just the ratio.
 */
export function cropChosen(key, opts, docW, docH) {
  const preset = CROP_SIZE_PRESETS.find((p) => p.value === key);
  if (preset) return { ratio: CROP_WXH, cropW: preset.w, cropH: preset.h };
  if (key === CROP_FRONT) return { ratio: CROP_WXH, cropW: String(docW), cropH: String(docH) };
  if (key === CROP_CLEAR) return { ratio: CROP_WXH, cropW: '', cropH: '' };
  return { ratio: key };
}

function validRatio(k) {
  return Number.isFinite(k) && k > 0 ? k : null;
}

// A ratio key's sides [w, h] ('original' is the document), or null.
function ratioSides(key, docW, docH) {
  let sides = null;
  if (key === 'original') sides = [docW, docH];
  else if (typeof key === 'string' && key.includes(':')) {
    const [a, b] = key.split(':', 2).map((t) => (t.trim() === '' ? NaN : Number(t)));
    sides = [a, b];
  }
  if (!sides || !sides.every((v) => Number.isFinite(v) && v > 0)) return null;
  return sides;
}

/** A ratio key as width / height ('original' uses the document size), or null for none. */
export function cropRatio(key, docW, docH) {
  const sides = ratioSides(key, docW, docH);
  return sides ? validRatio(sides[0] / sides[1]) : null;
}

/**
 * The largest centred frame of `ratio` (width / height) inside `frame`; never adds area. null
 * for an empty frame or a ratio that is not positive.
 */
export function cropFittedRatio(frame, ratio) {
  const w = frame[2] - frame[0];
  const h = frame[3] - frame[1];
  if (!frame.every(Number.isFinite) || !(w > 0) || !(h > 0) || !validRatio(ratio)) return null;
  if (Math.abs(w / h / ratio - 1) < 1e-12) return [...frame];
  const [cx, cy] = center(frame);
  const [fw, fh] = w / h > ratio ? [h * ratio, h] : [w, w / ratio];
  return [cx - fw / 2, cy - fh / 2, cx + fw / 2, cy + fh / 2];
}

/**
 * The W x H mode's output size from the Width and Height fields (crop_size.rs target), whole
 * px and at least 1, or null unless both parse as positive numbers.
 */
export function cropTargetSize(wText, hText) {
  const side = (t) => {
    const s = String(t ?? '').trim();
    const v = s === '' ? NaN : Number(s);
    return Number.isFinite(v) && v > 0 ? Math.max(1, Math.round(v)) : null;
  };
  const w = side(wText);
  const h = side(hText);
  return w && h ? { w, h } : null;
}

/** `frame` with its width and height swapped about its centre. */
export function cropSwapped(frame) {
  const [cx, cy] = center(frame);
  const hw = (frame[2] - frame[0]) / 2;
  const hh = (frame[3] - frame[1]) / 2;
  return [cx - hh, cy - hw, cx + hh, cy + hw];
}

// crop_size.rs fmt_ratio: up to three decimals, trailing zeros dropped.
function fmtRatio(v) {
  return String(Number(v.toFixed(3)));
}

/**
 * The ratio key with its sides swapped ("a:b" → "b:a"; 'original' → the document turned on its
 * side), or null without a ratio.
 */
export function cropSwappedRatio(key, docW, docH) {
  const sides = ratioSides(key, docW, docH);
  return sides ? `${fmtRatio(sides[1])}:${fmtRatio(sides[0])}` : null;
}

/**
 * The frame the Crop tool shows before any edit (crop_ui.rs default_frame): the selection's
 * bounding box { x, y, w, h } clamped to the W x H canvas when one is given and it overlaps,
 * else the whole canvas.
 */
export function cropDefaultFrame(W, H, selBox) {
  if (selBox) {
    const x0 = Math.max(0, Math.min(W, selBox.x));
    const y0 = Math.max(0, Math.min(H, selBox.y));
    const x1 = Math.max(0, Math.min(W, selBox.x + selBox.w));
    const y1 = Math.max(0, Math.min(H, selBox.y + selBox.h));
    if (x1 > x0 && y1 > y0) return [x0, y0, x1, y1];
  }
  return [0, 0, W, H];
}

/**
 * The whole-pixel box a frame crops a W x H canvas to, { x, y, w, h }, or null when it
 * misses the canvas. Edges round to the nearest pixel and clamp to the canvas.
 */
export function cropClamp(frame, W, H) {
  const x0 = Math.max(0, Math.min(W, Math.round(frame[0])));
  const y0 = Math.max(0, Math.min(H, Math.round(frame[1])));
  const x1 = Math.max(0, Math.min(W, Math.round(frame[2])));
  const y1 = Math.max(0, Math.min(H, Math.round(frame[3])));
  if (x1 - x0 < 1 || y1 - y0 < 1) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * CSS cursor for a cropHit result on a frame turned deg degrees. Outside a pending frame
 * (turnable) a drag turns it; without one it draws a new frame.
 */
export function cropCursor(hit, turnable = false, deg = 0) {
  if (hit === 'inside') return 'move';
  if (hit === 'outside') return turnable ? CROP_TURN_CURSOR : 'crosshair';
  if (!deg) return `${hit}-resize`;
  // The arrow as the handle faces on screen, to the nearest of the eight (resize_icon).
  const [hx, hy] = HANDLE_AXES[hit];
  const [tx, ty] = turn(hx, hy, 0, 0, deg);
  const oct = ((Math.round(Math.atan2(ty, tx) / (Math.PI / 4)) % 8) + 8) % 8;
  return `${['e', 'se', 's', 'sw', 'w', 'nw', 'n', 'ne'][oct]}-resize`;
}

// ── Composition overlay (crop_overlay.rs CropOverlay, OverlayShow, guides) ──

/** The guides the frame can show, in PhotoCraft's menu order (the order O cycles). */
export const CROP_OVERLAYS = [
  { value: 'thirds', label: 'Rule of Thirds' },
  { value: 'grid', label: 'Grid' },
  { value: 'diagonal', label: 'Diagonal' },
  { value: 'triangle', label: 'Triangle' },
  { value: 'goldenRatio', label: 'Golden Ratio' },
  { value: 'goldenSpiral', label: 'Golden Spiral' }
];

/** When the guide shows: Auto only while the frame is dragged. */
export const CROP_OVERLAY_SHOW = [
  { value: 'auto', label: 'Auto Show Overlay' },
  { value: 'always', label: 'Always Show Overlay' },
  { value: 'never', label: 'Never Show Overlay' }
];

/** Whether the guide shows under `show`, gesture being a crop drag in progress. */
export function cropOverlayShows(show, gesture) {
  if (show === 'always') return true;
  if (show === 'never') return false;
  return !!gesture;
}

/**
 * How many orientations Shift+O steps through: the Triangle's diagonal runs either way, and
 * the Golden Spiral winds into any of the four corners.
 */
export function cropOverlayOrientations(kind) {
  if (kind === 'goldenSpiral') return 4;
  return kind === 'triangle' ? 2 : 1;
}

/** The overlay after `kind` (O), wrapping round. */
export function cropNextOverlay(kind) {
  const i = CROP_OVERLAYS.findIndex((o) => o.value === kind);
  return CROP_OVERLAYS[(i + 1) % CROP_OVERLAYS.length].value;
}

// Golden section 1/φ and the Grid's target screen spacing and line cap (crop_overlay.rs).
const INV_PHI = 0.618034;
const CROP_GRID_PX = 32;
const CROP_GRID_MAX = 96;

/**
 * The golden spiral in unit coordinates (crop_overlay.rs golden_spiral): quarter arcs through
 * nested golden rectangles in a φ × 1 space, squares cut off the left, top, right and bottom
 * in turn, winding in from the bottom-left corner towards the lower right.
 */
function goldenSpiral() {
  const phi = 1 + INV_PHI;
  const steps = 12;
  const r = [0, 0, phi, 1];
  let p = [0, 1];
  const pts = [p];
  for (let i = 0; i < 12; i++) {
    const s = Math.min(r[2] - r[0], r[3] - r[1]);
    if (s < 1e-4) break;
    // The square cut off, the arc's centre (a corner of it) and the end point.
    let centre;
    let end;
    if (i % 4 === 0) {
      r[0] += s;
      centre = [r[0], r[3]];
      end = [r[0], r[1]];
    } else if (i % 4 === 1) {
      r[1] += s;
      centre = [r[0], r[1]];
      end = [r[2], r[1]];
    } else if (i % 4 === 2) {
      r[2] -= s;
      centre = [r[2], r[1]];
      end = [r[2], r[3]];
    } else {
      r[3] -= s;
      centre = [r[2], r[3]];
      end = [r[0], r[3]];
    }
    const a0 = Math.atan2(p[1] - centre[1], p[0] - centre[0]);
    const a1 = Math.atan2(end[1] - centre[1], end[0] - centre[0]);
    let da = a1 - a0;
    if (da > Math.PI) da -= 2 * Math.PI;
    else if (da < -Math.PI) da += 2 * Math.PI;
    for (let k = 1; k <= steps; k++) {
      const a = a0 + (da * k) / steps;
      pts.push([centre[0] + s * Math.cos(a), centre[1] + s * Math.sin(a)]);
    }
    p = end;
  }
  const unit = (v) => Math.min(1, Math.max(0, v));
  return pts.map(([x, y]) => [unit(x / phi), unit(y)]);
}

/**
 * The guide polylines ([[x, y], ...], frame-local px from its top-left) for a w × h frame
 * (crop_overlay.rs guides). scale is screen px per frame px: the Grid aims for square cells
 * of about 32 screen px, and a frame under 1 screen px on a side gets no guides. orient is
 * taken modulo cropOverlayOrientations(kind); bit 1 mirrors left to right, bit 2 top to bottom.
 */
export function cropGuides(kind, orient, w, h, scale = 1) {
  const sw = w * scale;
  const sh = h * scale;
  if (!Number.isFinite(sw) || !Number.isFinite(sh) || sw < 1 || sh < 1) return [];
  const seg = (a, b) => [a, b];
  const cross = (fs) => fs.flatMap((f) => [seg([f, 0], [f, 1]), seg([0, f], [1, f])]);
  let lines;
  if (kind === 'thirds') lines = cross([1 / 3, 2 / 3]);
  else if (kind === 'goldenRatio') lines = cross([1 - INV_PHI, INV_PHI]);
  else if (kind === 'grid') {
    const axis = (len, vertical) => {
      const n = Math.min(CROP_GRID_MAX, Math.max(2, Math.floor(len / CROP_GRID_PX)));
      const out = [];
      for (let i = 1; i < n; i++) {
        const f = i / n;
        out.push(vertical ? seg([f, 0], [f, 1]) : seg([0, f], [1, f]));
      }
      return out;
    };
    lines = [...axis(sw, true), ...axis(sh, false)];
  } else if (kind === 'diagonal') {
    // 45° on screen from each corner until the line meets the far edge.
    const m = Math.min(sw, sh);
    const u = m / sw;
    const v = m / sh;
    lines = [
      seg([0, 0], [u, v]),
      seg([1, 0], [1 - u, v]),
      seg([0, 1], [u, 1 - v]),
      seg([1, 1], [1 - u, 1 - v])
    ];
  } else if (kind === 'triangle') {
    // The top-left to bottom-right diagonal and the perpendiculars to it from the other two
    // corners; their feet sit at t = w² / (w² + h²) and s = 1 − t along it.
    let t;
    let s;
    if (sw >= sh) {
      t = 1 / (1 + (sh / sw) ** 2);
      s = 1 - t;
    } else {
      s = 1 / (1 + (sw / sh) ** 2);
      t = 1 - s;
    }
    lines = [seg([0, 0], [1, 1]), seg([1, 0], [t, t]), seg([0, 1], [s, s])];
  } else if (kind === 'goldenSpiral') lines = [goldenSpiral()];
  else return [];
  const o = (orient | 0) % cropOverlayOrientations(kind);
  const fx = (o & 1) !== 0;
  const fy = (o & 2) !== 0;
  return lines.map((l) => l.map(([x, y]) => [(fx ? 1 - x : x) * w, (fy ? 1 - y : y) * h]));
}

// ── Crop shield (crop_shield.rs CropShield, fill) ──

/** PhotoCraft's (Photoshop's) shield defaults: all on, Match Canvas, 75 %. */
export const CROP_SHIELD_DEFAULTS = Object.freeze({
  showCroppedArea: true,
  enabled: true,
  color: 'canvas',
  customColor: '#000000',
  opacity: 75,
  autoAdjust: true
});

/** Auto Adjust Opacity: the share of the opacity the shield keeps while the frame is dragged. */
const SHIELD_EDITING_FACTOR = 0.5;

function hexRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? ''));
  const n = m ? parseInt(m[1], 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * What to paint over the area outside the crop frame (crop_shield.rs fill) as [r, g, b, a]
 * (0..255), canvasRgb being the pasteboard colour and editing a crop drag in progress: the
 * opaque canvas colour when Show Cropped Area is off, null when the shield is disabled or fully
 * transparent, otherwise its colour at its opacity (halved while editing with Auto Adjust).
 */
export function cropShieldFill(shield, canvasRgb, editing) {
  const s = { ...CROP_SHIELD_DEFAULTS, ...shield };
  const [r, g, b] = canvasRgb;
  if (!s.showCroppedArea) return [r, g, b, 255];
  if (!s.enabled) return null;
  const rgb = s.color === 'custom' ? hexRgb(s.customColor) : [r, g, b];
  const o = Number.isFinite(s.opacity) ? s.opacity : CROP_SHIELD_DEFAULTS.opacity;
  const k = s.autoAdjust && editing ? SHIELD_EDITING_FACTOR : 1;
  const a = Math.min(255, Math.max(0, Math.round((Math.min(100, Math.max(0, o)) / 100) * k * 255)));
  return a > 0 ? [...rgb, a] : null;
}

/** An [r, g, b, a] (0..255) fill as a canvas rgba() string. */
export function cropShieldCss([r, g, b, a]) {
  return `rgba(${r}, ${g}, ${b}, ${+(a / 255).toFixed(4)})`;
}

/**
 * Shade the overlay outside `frame` (turned deg degrees about its centre) with `shade`
 * (cropShieldFill's [r, g, b, a], none when null; undefined is the default shield on black) and
 * draw its border, the composition guides (cropGuides polylines, frame-local px), and eight
 * handles on the turned frame. zoom keeps the strokes and handles a constant screen size.
 */
export function drawCropOverlay(
  ov,
  frame,
  zoom = 1,
  deg = 0,
  guides = null,
  shade = cropShieldFill(CROP_SHIELD_DEFAULTS, [0, 0, 0], false)
) {
  const W = ov.canvas.width;
  const H = ov.canvas.height;
  ov.clearRect(0, 0, W, H);
  if (!frame) return;
  const [x0, y0, x1, y1] = frame;
  const px = 1 / (zoom || 1);
  ov.save();
  if (shade) {
    ov.fillStyle = cropShieldCss(shade);
    ov.beginPath();
    ov.rect(0, 0, W, H);
    ov.moveTo(...cropCorners(frame, deg)[0]);
    for (const c of cropCorners(frame, deg).slice(1)) ov.lineTo(...c);
    ov.closePath();
    ov.fill('evenodd');
  }
  if (deg) {
    // Border and handles in the frame's own axes.
    const [cx, cy] = center(frame);
    ov.translate(cx, cy);
    ov.rotate((deg * Math.PI) / 180);
    ov.translate(-cx, -cy);
  }
  ov.lineWidth = px;
  if (guides?.length) {
    ov.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ov.beginPath();
    for (const line of guides) {
      ov.moveTo(x0 + line[0][0], y0 + line[0][1]);
      for (const [gx, gy] of line.slice(1)) ov.lineTo(x0 + gx, y0 + gy);
    }
    ov.stroke();
  }
  ov.strokeStyle = '#fff';
  ov.strokeRect(x0, y0, x1 - x0, y1 - y0);
  const s = 6 * px;
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  ov.fillStyle = '#fff';
  ov.strokeStyle = '#000';
  for (const [hx, hy] of [
    [x0, y0],
    [mx, y0],
    [x1, y0],
    [x1, my],
    [x1, y1],
    [mx, y1],
    [x0, y1],
    [x0, my]
  ]) {
    ov.fillRect(hx - s / 2, hy - s / 2, s, s);
    ov.strokeRect(hx - s / 2, hy - s / 2, s, s);
  }
  ov.restore();
}

// ── Turned frames (crop_ui.rs turn, corners, hit_turned, turned_angle, resized_turned) ──
// A turned frame is the upright frame plus an angle in degrees, clockwise on screen (y down),
// about the frame's centre.

/** (x, y) turned deg degrees clockwise on screen about (cx, cy) (crop_ui.rs turn). */
function turn(x, y, cx, cy, deg) {
  const r = (deg * Math.PI) / 180;
  const s = Math.sin(r);
  const k = Math.cos(r);
  const dx = x - cx;
  const dy = y - cy;
  return [cx + k * dx - s * dy, cy + s * dx + k * dy];
}

function center(frame) {
  return [(frame[0] + frame[2]) / 2, (frame[1] + frame[3]) / 2];
}

/** An angle in degrees brought into (−180, 180]; 0 for anything not finite. */
export function cropNormalizedAngle(deg) {
  if (!Number.isFinite(deg)) return 0;
  const a = ((deg % 360) + 360) % 360;
  return a > 180 ? a - 360 : a;
}

/**
 * The frame's angle after turning it from `from` degrees by the pointer's sweep about (cx, cy)
 * from direction `grab` (radians) to (x, y); snap (Shift) rounds it to 15° steps.
 */
export function cropTurnedAngle(cx, cy, grab, from, x, y, snap = false) {
  const now = Math.atan2(y - cy, x - cx);
  const a = from + ((now - grab) * 180) / Math.PI;
  return cropNormalizedAngle(snap ? Math.round(a / 15) * 15 : a);
}

/**
 * The corners of `frame` turned deg degrees about its centre: top-left, top-right,
 * bottom-right, bottom-left of the upright frame.
 */
export function cropCorners(frame, deg) {
  const [x0, y0, x1, y1] = frame;
  const [cx, cy] = center(frame);
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1]
  ].map(([x, y]) => turn(x, y, cx, cy, deg));
}

/** cropHit for `frame` turned deg degrees: handles and inside are found in its own axes. */
export function cropHitTurned(frame, deg, x, y, handlePx) {
  if (!deg) return cropHit(frame, x, y, handlePx);
  const [cx, cy] = center(frame);
  const [lx, ly] = turn(x, y, cx, cy, -deg);
  return cropHit(frame, lx, ly, handlePx);
}

/**
 * cropDrag for `frame` turned deg degrees: a handle moves along the frame's own axes by the
 * document-space drag (dx, dy), and the edges opposite stay where they are on screen.
 * 'inside' moves the frame (the turn is about its centre, so it moves with it).
 * @param {{ shift?: boolean, alt?: boolean }} [opts]
 */
export function cropResizedTurned(frame, deg, hit, dx, dy, opts = {}) {
  if (!deg || hit === 'inside') return cropDrag(frame, hit, dx, dy, opts);
  const [cx, cy] = center(frame);
  // In the frame's axes (about its old centre), then the new centre back on the page.
  const [ldx, ldy] = turn(dx, dy, 0, 0, -deg);
  const n = cropDrag(frame, hit, ldx, ldy, opts);
  const [ncx, ncy] = center(n);
  const [px, py] = turn(ncx, ncy, cx, cy, deg);
  const hw = (n[2] - n[0]) / 2;
  const hh = (n[3] - n[1]) / 2;
  return [px - hw, py - hh, px + hw, py + hh];
}

/**
 * The turn cursor shown outside a pending frame: a curved two-headed arrow (an original
 * drawing, as PhotoCraft's draw_turn_cursor), hot spot at its centre.
 */
export const CROP_TURN_CURSOR =
  'url("data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round">' +
      '<g stroke="#000" stroke-width="4"><path d="M5 15a10 10 0 0 1 10-10M2 12l3 3 3-3M12 2l3 3-3 3"/></g>' +
      '<g stroke="#fff" stroke-width="2"><path d="M5 15a10 10 0 0 1 10-10M2 12l3 3 3-3M12 2l3 3-3 3"/></g>' +
      '</svg>'
  ) +
  '") 12 12, alias';

/**
 * An angle readout: one decimal and a degree sign, never '-0.0°' or '-180.0°'
 * (canvas::angle_readout).
 */
export function cropAngleReadout(deg) {
  let d = roundAway(deg * 10) / 10;
  if (d === 0) d = 0;
  else if (d === -180) d = 180;
  return `${d.toFixed(1)}°`;
}

/**
 * The frame's W x H as the readout shows it: each side rounded and at least 1 px, or null when
 * either is not finite (crop_ui.rs frame_size).
 */
export function cropFrameSize(frame) {
  const [w, h] = [frame[2] - frame[0], frame[3] - frame[1]];
  if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
  return [Math.max(1, roundAway(w)), Math.max(1, roundAway(h))];
}

/** The shortest Straighten line in screen px (crop_straighten.rs MIN_LINE_PX). */
export const CROP_STRAIGHTEN_MIN_PX = 3;

// Rust's f64::round: halves away from zero.
function roundAway(v) {
  return Math.sign(v) * Math.round(Math.abs(v));
}

/**
 * The frame angle (degrees, clockwise) that makes the line a → b level, or plumb when it is
 * nearer vertical (crop_straighten.rs frame_angle with analysis_cmds::straighten_angle); null
 * for a line shorter than minLen or not finite.
 */
export function cropStraightenAngle(a, b, minLen) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (!Number.isFinite(len) || !(len >= Math.max(minLen, Number.MIN_VALUE))) return null;
  const deg = (Math.atan2(-dy, dx) * 180) / Math.PI;
  const rot = deg - 90 * roundAway(deg / 90);
  // Committing turns the document back by the frame's angle; turning it by rot levels the line.
  return Number.isFinite(rot) ? cropNormalizedAngle(-rot) + 0 : null;
}

/**
 * The largest frame of w x h proportions, turned deg degrees, that stays inside a cw x ch
 * canvas, centred on it (crop_straighten.rs fitted); null when a size is not a positive
 * finite number.
 */
export function cropStraightenFitted(w, h, cw, ch, deg) {
  if (![w, h, cw, ch, deg].every(Number.isFinite) || w <= 0 || h <= 0 || cw <= 0 || ch <= 0) {
    return null;
  }
  const r = (deg * Math.PI) / 180;
  const s = Math.abs(Math.sin(r));
  const c = Math.abs(Math.cos(r));
  // The turned frame's bounds, scaled by k, must fit the canvas on both axes.
  const k = Math.min(cw / (w * c + h * s), ch / (w * s + h * c));
  if (!Number.isFinite(k) || k <= 0) return null;
  const [hw, hh, cx, cy] = [(w * k) / 2, (h * k) / 2, cw / 2, ch / 2];
  return [cx - hw, cy - hh, cx + hw, cy + hh];
}

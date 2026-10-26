// Selection module for the paint app.
//
// Owns everything to do with the marching-ants selection overlay,
// rectangle / lasso / magic-wand selection state on the canvas, the
// clipboard (copy / cut / paste / delete), and the pixel-mask
// helpers used for modifier-key combining (Shift / Alt / Cmd
// add / subtract / intersect).
//
// All stateful entry points take the paint app's `state` object
// (and the overlay 2D context `ov`) as explicit arguments instead
// of importing them — keeps this module testable in isolation and
// matches the dependency-injection pattern used by `layers.js` /
// `history.js`. paint.js wraps each export in a no-arg local
// function so its existing call sites don't have to change.

import { shows } from './snap.js';

// ── Pure helpers ────────────────────────────────────────────────

// Collect every mask pixel that touches a non-mask pixel (or the canvas edge).
// Used for true "marching ants" around non-rectangular selections — combined
// Shift/Alt/Cmd magic-wand and lasso picks. We render these as a 1-pixel
// alternating white/black pattern; setLineDash is unusable here because
// per-pixel disjoint subpaths reset the dash pattern at every moveTo.
export function buildBoundaryPixels(mask, W, H) {
  const out = [];
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      if (!mask[row + x]) continue;
      const onEdge =
        y === 0 ||
        !mask[row - W + x] ||
        y === H - 1 ||
        !mask[row + W + x] ||
        x === 0 ||
        !mask[row + x - 1] ||
        x === W - 1 ||
        !mask[row + x + 1];
      if (onEdge) out.push(x, y);
    }
  }
  return out;
}

export function hexToRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16)
  ];
}

export function selectionToFullMask(sel, W, H) {
  if (sel.mask && sel.mask.length === W * H) return sel.mask.slice();
  const mask = new Uint8Array(W * H);
  if (sel.mode !== 'active') return mask;
  const x0 = Math.max(0, sel.x),
    y0 = Math.max(0, sel.y);
  const x1 = Math.min(W, sel.x + sel.w),
    y1 = Math.min(H, sel.y + sel.h);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) mask[y * W + x] = 1;
  }
  return mask;
}

export function maskBBox(mask, W, H) {
  let minX = W,
    maxX = -1,
    minY = H,
    maxY = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (mask[y * W + x]) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

// Mask of the ellipse inscribed in the box (x, y, w, h), clipped to the W x H canvas.
// A pixel is inside when its center falls within the ellipse.
export function ellipseMask(x, y, w, h, W, H) {
  const mask = new Uint8Array(W * H);
  const left = Math.min(x, x + w),
    top = Math.min(y, y + h);
  const rx = Math.abs(w) / 2,
    ry = Math.abs(h) / 2;
  if (rx <= 0 || ry <= 0) return mask;
  const cx = left + rx,
    cy = top + ry;
  const x0 = Math.max(0, Math.floor(left)),
    y0 = Math.max(0, Math.floor(top));
  const x1 = Math.min(W, Math.ceil(left + 2 * rx)),
    y1 = Math.min(H, Math.ceil(top + 2 * ry));
  for (let py = y0; py < y1; py++) {
    const dy = (py + 0.5 - cy) / ry;
    for (let px = x0; px < x1; px++) {
      const dx = (px + 0.5 - cx) / rx;
      if (dx * dx + dy * dy <= 1) mask[py * W + px] = 1;
    }
  }
  return mask;
}

// Box-blur one row or column of `src` into `dst` with a half-width of r. Samples
// past the ends count as 0 (unselected), or repeat the end sample when `replicate` is set.
// Running sums keep it O(n) for any r.
function boxBlurLine(src, dst, start, stride, n, r, replicate = false) {
  const norm = 1 / (2 * r + 1);
  const at = (k) => {
    if (k < 0 || k >= n) {
      if (!replicate) return 0;
      k = k < 0 ? 0 : n - 1;
    }
    return src[start + k * stride];
  };
  let sum = 0;
  for (let k = -r; k <= r; k++) sum += at(k);
  for (let i = 0; i < n; i++) {
    dst[start + i * stride] = sum * norm;
    sum += at(i + r + 1) - at(i - r);
  }
}

// Feather a 0/1 selection mask by `radius` pixels. Selections in Paint are still 0/1, so this
// wave feathers by expanding the hard mask through a blur-and-threshold instead of a soft edge.
// The blurred coverage is doubled into a soft ramp that grows past the edge, then snapped back
// to a hard mask at 0.5. The original selection always stays selected.
export function featherMask(mask, W, H, radius) {
  const r = Math.min(Math.max(W, H), Math.max(0, Math.round(Number(radius) || 0)));
  if (r === 0) return mask.slice();
  const a = new Float32Array(W * H),
    b = new Float32Array(W * H);
  for (let p = 0; p < a.length; p++) a[p] = mask[p] ? 1 : 0;
  for (let y = 0; y < H; y++) boxBlurLine(a, b, y * W, 1, W, r);
  for (let x = 0; x < W; x++) boxBlurLine(b, a, x, W, H, r);
  const out = new Uint8Array(W * H);
  for (let p = 0; p < out.length; p++) {
    out[p] = mask[p] || Math.min(1, a[p] * 2) >= 0.5 ? 1 : 0;
  }
  return out;
}

// Squared Euclidean distance from each pixel to the nearest pixel where `seed[p]` is set
// (Felzenszwalb and Huttenlocher, one column pass then one row pass). Pixels past the canvas
// edge are not seeds. With no seeds every distance stays at FAR.
const FAR = 1e20;

function distanceLine(f, n, d, v, z) {
  let k = 0;
  v[0] = 0;
  z[0] = -FAR;
  z[1] = FAR;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = FAR;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

export function squaredDistance(seed, W, H) {
  const out = new Float64Array(W * H);
  for (let p = 0; p < out.length; p++) out[p] = seed[p] ? 0 : FAR;
  const n = Math.max(W, H);
  const f = new Float64Array(n),
    d = new Float64Array(n),
    v = new Int32Array(n),
    z = new Float64Array(n + 1);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) f[y] = out[y * W + x];
    distanceLine(f, H, d, v, z);
    for (let y = 0; y < H; y++) out[y * W + x] = d[y];
  }
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) f[x] = out[row + x];
    distanceLine(f, W, d, v, z);
    for (let x = 0; x < W; x++) out[row + x] = d[x];
  }
  return out;
}

function morphRadius(radius) {
  return Math.min(64, Math.max(0, Math.round(Number(radius) || 0)));
}

// Grow a 0/1 selection by `radius` pixels (0..64), a binary dilation by a disk: a pixel is
// selected when its centre is within `radius` of a selected centre, as in PhotoCraft's Expand.
export function expandMask(mask, W, H, radius) {
  const r = morphRadius(radius);
  if (r === 0) return mask.slice();
  const dist = squaredDistance(mask, W, H);
  const out = new Uint8Array(W * H);
  for (let p = 0; p < out.length; p++) out[p] = dist[p] <= r * r ? 1 : 0;
  return out;
}

// Shrink a 0/1 selection by `radius` pixels (0..64), a binary erosion by a disk: a selected
// pixel stays only when no unselected centre is within `radius`. Like PhotoCraft's Contract,
// the canvas edge does not count as unselected.
export function contractMask(mask, W, H, radius) {
  const r = morphRadius(radius);
  if (r === 0) return mask.slice();
  const unselected = new Uint8Array(W * H);
  for (let p = 0; p < unselected.length; p++) unselected[p] = mask[p] ? 0 : 1;
  const dist = squaredDistance(unselected, W, H);
  const out = new Uint8Array(W * H);
  for (let p = 0; p < out.length; p++) out[p] = mask[p] && dist[p] > r * r ? 1 : 0;
  return out;
}

// Select ▸ Modify ▸ Border… (PhotoCraft selection.rs border, thresholded for a 0/1 mask): a band
// `width` px wide straddling the selection edge, half inside and half outside. A pixel D away
// (centre to centre) from the nearest pixel across the edge is kept while D − 1 < width / 2.
// The canvas edge counts as a selection edge, so a Select All borders along the canvas.
export function borderMask(mask, W, H, width) {
  const w = Math.max(0, Number(width) || 0);
  const out = new Uint8Array(W * H);
  if (w <= 0) return out;
  const pad = Math.ceil(w / 2) + 2;
  const PW = W + 2 * pad,
    PH = H + 2 * pad;
  const inside = new Uint8Array(PW * PH),
    outside = new Uint8Array(PW * PH);
  for (let y = 0; y < PH; y++) {
    for (let x = 0; x < PW; x++) {
      const cx = x - pad,
        cy = y - pad;
      const on = cx >= 0 && cy >= 0 && cx < W && cy < H && mask[cy * W + cx] ? 1 : 0;
      inside[y * PW + x] = on;
      outside[y * PW + x] = 1 - on;
    }
  }
  const toInside = squaredDistance(inside, PW, PH),
    toOutside = squaredDistance(outside, PW, PH);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const q = (y + pad) * PW + x + pad;
      const d = Math.sqrt(inside[q] ? toOutside[q] : toInside[q]);
      out[y * W + x] = d - 1 < w / 2 ? 1 : 0;
    }
  }
  return out;
}

// Select ▸ Modify ▸ Smooth… (PhotoCraft selection_blur.rs smooth): a box average of radius
// round(radius) with the canvas edge repeated, then a hard threshold at ½. Straight edges stay,
// corners round off, and specks smaller than the box drop.
export function smoothMask(mask, W, H, radius) {
  const r = Math.min(Math.max(W, H), Math.max(0, Math.round(Number(radius) || 0)));
  if (r === 0) return mask.slice();
  const a = new Float32Array(W * H),
    b = new Float32Array(W * H);
  for (let p = 0; p < a.length; p++) a[p] = mask[p] ? 1 : 0;
  for (let y = 0; y < H; y++) boxBlurLine(a, b, y * W, 1, W, r, true);
  for (let x = 0; x < W; x++) boxBlurLine(b, a, x, W, H, r, true);
  const out = new Uint8Array(W * H);
  for (let p = 0; p < out.length; p++) out[p] = a[p] >= 0.5 ? 1 : 0;
  return out;
}

// Select ▸ Grow / Similar (PhotoCraft selection_cmds.rs grow_similar): the selected pixels'
// per-channel RGBA range, widened by `tolerance` (0..255), picks new pixels. Grow adds those
// 4-connected to the selection; Similar adds them anywhere. `data` is the sampled layer's RGBA.
// Returns null when the selection is empty.
export function growSelectionMask(mask, data, W, H, tolerance, contiguous) {
  const tol = Math.max(0, Number(tolerance) || 0);
  const lo = [255, 255, 255, 255],
    hi = [0, 0, 0, 0];
  let any = false;
  for (let p = 0; p < W * H; p++) {
    if (!mask[p]) continue;
    any = true;
    for (let c = 0; c < 4; c++) {
      const v = data[p * 4 + c];
      if (v < lo[c]) lo[c] = v;
      if (v > hi[c]) hi[c] = v;
    }
  }
  if (!any) return null;
  const inRange = (p) => {
    for (let c = 0; c < 4; c++) {
      const v = data[p * 4 + c];
      if (v < lo[c] - tol || v > hi[c] + tol) return false;
    }
    return true;
  };
  const out = new Uint8Array(W * H);
  for (let p = 0; p < out.length; p++) out[p] = mask[p] ? 1 : 0;
  if (!contiguous) {
    for (let p = 0; p < out.length; p++) if (!out[p] && inRange(p)) out[p] = 1;
    return out;
  }
  const stack = [];
  for (let p = 0; p < out.length; p++) if (out[p]) stack.push(p);
  while (stack.length) {
    const p = stack.pop();
    const x = p % W;
    const next = [x > 0 ? p - 1 : -1, x + 1 < W ? p + 1 : -1, p - W, p + W];
    for (const q of next) {
      if (q < 0 || q >= out.length || out[q] || !inRange(q)) continue;
      out[q] = 1;
      stack.push(q);
    }
  }
  return out;
}

// Decide which modifier-key combine mode applies for the given event-like
// object (anything with shiftKey / ctrlKey / altKey booleans).
//
//   Add:       Shift OR Cmd/Ctrl  (web-multi-select intuition + Photoshop's Shift)
//   Subtract:  Alt/Option
//   Intersect: any add modifier combined with subtract
export function selectionModeFor(modKeys) {
  const add = modKeys.shiftKey || modKeys.ctrlKey;
  const sub = modKeys.altKey;
  if (add && sub) return 'intersect';
  if (add) return 'add';
  if (sub) return 'subtract';
  return null;
}

// PhotoCraft's options-bar selection mode (app.ui.selection_mode): held modifiers win,
// otherwise the chosen button applies. option is 'new' | 'add' | 'subtract' | 'intersect';
// 'new' (or anything unknown) resolves to null, a plain replace.
export const SELECTION_MODES = ['new', 'add', 'subtract', 'intersect'];

export function resolveSelectionMode(option, modKeys) {
  const held = selectionModeFor(modKeys);
  if (held) return held;
  return option !== 'new' && SELECTION_MODES.includes(option) ? option : null;
}

// ── Marching-ants overlay ───────────────────────────────────────

// Tools whose in-progress box is drawn as marching ants while the pointer is down.
const DRAWING_ANTS_TOOLS = new Set([
  'rectSelect',
  'singleRowMarquee',
  'singleColumnMarquee',
  'lasso'
]);

let dashOffset = 0;
let lastDashTime = 0;

// Clear the overlay, then let the active tool redraw what it keeps there (the Ruler's line,
// paint.js state.drawToolOverlay), so the ants and a deselect do not wipe it.
function clearOverlay(state, ov) {
  ov.clearRect(0, 0, ov.canvas.width, ov.canvas.height);
  state.drawToolOverlay?.(ov);
}

export function drawSelectionOverlay(state, ov) {
  const sel = state.sel;
  if (sel.mode === 'none') return;
  if (state.drawing && !DRAWING_ANTS_TOOLS.has(state.tool)) return;
  // A pending Crop frame owns the overlay until it is committed or cancelled.
  if (state.cropFrame) return;
  // View › Show › Selection Edges (or Extras) off: the selection stays, its ants do not draw.
  if (!shows(state, 'selectionEdges')) {
    clearOverlay(state, ov);
    return;
  }
  drawAnts(state, ov);
  state.drawToolOverlay?.(ov);
}

function drawAnts(state, ov) {
  const sel = state.sel;
  ov.clearRect(0, 0, ov.canvas.width, ov.canvas.height);

  if (sel.mode === 'moving' && sel.data) {
    // Floating content already drawn to canvas in onMove, no extra needed
  }

  // Prefer the real mask outline when we have one — this is what makes
  // multi-region selections (e.g. Shift-click magic wand) actually look right
  // instead of one giant bbox swallowing the empty space between regions.
  const W = ov.canvas.width,
    H = ov.canvas.height;
  const hasFullMask = sel.mask && sel.mask.length === W * H && sel.mode === 'active';
  if (hasFullMask) {
    if (!sel.boundaryPixels) sel.boundaryPixels = buildBoundaryPixels(sel.mask, W, H);
    const pts = sel.boundaryPixels;
    // Two-pass: alternate white/black on a phase-shifting parity so the ants
    // visibly march without depending on lineDash continuity.
    ov.beginPath();
    for (let i = 0; i < pts.length; i += 2) {
      if (((pts[i] + pts[i + 1] + dashOffset) & 7) < 4) ov.rect(pts[i], pts[i + 1], 1, 1);
    }
    ov.fillStyle = '#fff';
    ov.fill();
    ov.beginPath();
    for (let i = 0; i < pts.length; i += 2) {
      if (((pts[i] + pts[i + 1] + dashOffset) & 7) >= 4) ov.rect(pts[i], pts[i + 1], 1, 1);
    }
    ov.fillStyle = '#000';
    ov.fill();
    return;
  }

  // Fallback: rectangle bbox or lasso polyline — these still use animated dashes.
  ov.save();
  ov.strokeStyle = '#fff';
  ov.lineWidth = 1;
  ov.setLineDash([4, 4]);
  ov.lineDashOffset = -dashOffset;

  if (sel.lassoPoly && sel.mode === 'active') {
    ov.beginPath();
    ov.moveTo(sel.lassoPoly[0][0], sel.lassoPoly[0][1]);
    for (const [px, py] of sel.lassoPoly) ov.lineTo(px, py);
    ov.closePath();
    ov.stroke();
    // Second pass in black offset by half period
    ov.strokeStyle = '#000';
    ov.lineDashOffset = -dashOffset + 4;
    ov.beginPath();
    ov.moveTo(sel.lassoPoly[0][0], sel.lassoPoly[0][1]);
    for (const [px, py] of sel.lassoPoly) ov.lineTo(px, py);
    ov.closePath();
    ov.stroke();
  } else {
    ov.strokeRect(sel.x + 0.5, sel.y + 0.5, sel.w, sel.h);
    ov.strokeStyle = '#000';
    ov.lineDashOffset = -dashOffset + 4;
    ov.strokeRect(sel.x + 0.5, sel.y + 0.5, sel.w, sel.h);
  }
  ov.setLineDash([]);
  ov.restore();
}

// Start the requestAnimationFrame loop that advances the dash offset
// so the ants visibly "march". Call once at app init; the loop runs
// for the lifetime of the page.
export function startSelectionAnimation(state, ov) {
  function tick(ts) {
    if (ts - lastDashTime > 80) {
      dashOffset = (dashOffset + 1) % 8;
      lastDashTime = ts;
      if (state.sel.mode !== 'none' && !state.drawing) {
        drawSelectionOverlay(state, ov);
      }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// ── Stateful operations ─────────────────────────────────────────

/** Hit-test: bbox first, then mask pixel when present. */
export function isInsideSelection(sel, x, y, canvasW) {
  if (sel.mode !== 'active' && sel.mode !== 'moving') return false;
  if (x < sel.x || x > sel.x + sel.w || y < sel.y || y > sel.y + sel.h) return false;
  if (!sel.mask || !canvasW) return true;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  if (ix < 0 || iy < 0 || ix >= canvasW) return false;
  return !!sel.mask[iy * canvasW + ix];
}

/** Bbox-local mask (w*h) from a full-canvas mask — for clipboard. */
export function extractLocalMask(sel, canvasW) {
  if (!sel.mask) return null;
  const local = new Uint8Array(sel.w * sel.h);
  for (let row = 0; row < sel.h; row++) {
    for (let col = 0; col < sel.w; col++) {
      local[row * sel.w + col] = sel.mask[(sel.y + row) * canvasW + (sel.x + col)] ? 1 : 0;
    }
  }
  return local;
}

/** Expand a bbox-local mask into a full-canvas mask at (x, y). */
export function localMaskToFull(local, x, y, w, h, canvasW, canvasH) {
  const full = new Uint8Array(canvasW * canvasH);
  if (!local) return full;
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      if (!local[row * w + col]) continue;
      const fx = x + col;
      const fy = y + row;
      if (fx >= 0 && fy >= 0 && fx < canvasW && fy < canvasH) full[fy * canvasW + fx] = 1;
    }
  }
  return full;
}

function translateMaskBy(sel, dx, dy, W, H) {
  if (!sel.mask || (!dx && !dy)) return;
  const next = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!sel.mask[y * W + x]) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < W && ny < H) next[ny * W + nx] = 1;
    }
  }
  sel.mask = next;
  sel.boundaryPixels = null;
  if (sel.lassoPoly) {
    sel.lassoPoly = sel.lassoPoly.map(([px, py]) => [px + dx, py + dy]);
  }
}

/** Lift selection into floating state (mask-aware hole). */
export function liftSelection(state, ctx) {
  const sel = state.sel;
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const data = ctx.getImageData(sel.x, sel.y, sel.w, sel.h);
  const [br, bg, bb] = hexToRgb(state.bgColor);

  if (sel.mask) {
    const img = ctx.getImageData(0, 0, W, H);
    for (let row = 0; row < sel.h; row++) {
      for (let col = 0; col < sel.w; col++) {
        const mx = sel.x + col;
        const my = sel.y + row;
        if (mx < 0 || my < 0 || mx >= W || my >= H) continue;
        const maskIdx = my * W + mx;
        const di = (row * sel.w + col) * 4;
        if (!sel.mask[maskIdx]) {
          data.data[di + 3] = 0;
        } else {
          const pos = maskIdx * 4;
          img.data[pos] = br;
          img.data[pos + 1] = bg;
          img.data[pos + 2] = bb;
          img.data[pos + 3] = 255;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  } else {
    ctx.fillStyle = state.bgColor;
    ctx.fillRect(sel.x, sel.y, sel.w, sel.h);
  }

  sel.data = data;
  sel.baseData = ctx.getImageData(0, 0, W, H);
}

/**
 * Stamp floating selection onto the layer.
 * Uses drawImage so masked/transparent float pixels composite correctly.
 */
export function stampFloatingSelection(state, ctx) {
  const sel = state.sel;
  if (!sel.data || !sel.baseData) return;
  ctx.putImageData(sel.baseData, 0, 0);
  const tmp = document.createElement('canvas');
  tmp.width = sel.w;
  tmp.height = sel.h;
  tmp.getContext('2d').putImageData(sel.data, 0, 0);
  ctx.drawImage(tmp, Math.round(sel.x), Math.round(sel.y));
}

/** Begin a move if (x,y) is inside the active selection. */
export function tryBeginMove(state, ctx, x, y) {
  const sel = state.sel;
  if (sel.mode !== 'active') return false;
  if (!isInsideSelection(sel, x, y, ctx.canvas.width)) return false;
  state.selStartMoveX = x;
  state.selStartMoveY = y;
  state.selOrigX = sel.x;
  state.selOrigY = sel.y;
  if (!sel.data || !sel.baseData) {
    state.pushUndo?.('Move');
    liftSelection(state, ctx);
  } else {
    state.pushUndo?.('Move');
  }
  sel.mode = 'moving';
  return true;
}

export function updateMove(state, ctx, x, y) {
  const sel = state.sel;
  if (sel.mode !== 'moving' || !sel.data || !sel.baseData) return;
  sel.x = state.selOrigX + (x - state.selStartMoveX);
  sel.y = state.selOrigY + (y - state.selStartMoveY);
  stampFloatingSelection(state, ctx);
}

export function endMove(state, ctx) {
  const sel = state.sel;
  if (sel.mode !== 'moving') return;
  const dx = Math.round(sel.x - state.selOrigX);
  const dy = Math.round(sel.y - state.selOrigY);
  sel.x = Math.round(sel.x);
  sel.y = Math.round(sel.y);
  stampFloatingSelection(state, ctx);
  translateMaskBy(sel, dx, dy, ctx.canvas.width, ctx.canvas.height);
  // Clear float so the next drag re-lifts from the stamped canvas
  sel.data = null;
  sel.baseData = null;
  sel.mode = 'active';
  sel.boundaryPixels = null;
}

/**
 * Commit (deselect). If content is floating mid-move, stamp it first so
 * Escape / tool-switch never loses pixels.
 * @param {CanvasRenderingContext2D} [ctx]
 */
export function commitSelection(state, ov, ctx) {
  const sel = state.sel;
  if (sel.mode === 'none') return;
  if (ctx && sel.data && sel.baseData) {
    stampFloatingSelection(state, ctx);
  }
  sel.mode = 'none';
  sel.data = null;
  sel.mask = null;
  sel.baseData = null;
  sel.lassoPoly = null;
  sel.boundaryPixels = null;
  clearOverlay(state, ov);
}

// Build an ImageData for clipboard, zeroing non-masked pixels' alpha
export function getSelectionImageData(state, ctx) {
  const sel = state.sel;
  const raw = ctx.getImageData(sel.x, sel.y, sel.w, sel.h);
  if (!sel.mask) return raw;
  const W = ctx.canvas.width;
  for (let row = 0; row < sel.h; row++) {
    for (let col = 0; col < sel.w; col++) {
      const maskIdx = (sel.y + row) * W + (sel.x + col);
      if (!sel.mask[maskIdx]) raw.data[(row * sel.w + col) * 4 + 3] = 0;
    }
  }
  return raw;
}

export function copySelection(state, ov, ctx, cut, pushUndo) {
  const sel = state.sel;
  if (sel.mode !== 'active') return false;
  const data = getSelectionImageData(state, ctx);
  state.clipboard = {
    data,
    x: sel.x,
    y: sel.y,
    w: sel.w,
    h: sel.h,
    localMask: extractLocalMask(sel, ctx.canvas.width)
  };
  if (cut) {
    pushUndo('Cut');
    if (sel.mask) {
      const W = ctx.canvas.width;
      const img = ctx.getImageData(0, 0, W, ctx.canvas.height);
      const [br, bg, bb] = hexToRgb(state.bgColor);
      for (let row = 0; row < sel.h; row++) {
        for (let col = 0; col < sel.w; col++) {
          const maskIdx = (sel.y + row) * W + (sel.x + col);
          if (sel.mask[maskIdx]) {
            const pos = maskIdx * 4;
            img.data[pos] = br;
            img.data[pos + 1] = bg;
            img.data[pos + 2] = bb;
            img.data[pos + 3] = 255;
          }
        }
      }
      ctx.putImageData(img, 0, 0);
    } else {
      ctx.fillStyle = state.bgColor;
      ctx.fillRect(sel.x, sel.y, sel.w, sel.h);
    }
    commitSelection(state, ov, ctx);
  }
  return true;
}

/** Convert ImageData to a PNG Blob (for OS clipboard write). */
export function imageDataToPngBlob(imageData) {
  return new Promise((resolve) => {
    const tmp = document.createElement('canvas');
    tmp.width = imageData.width;
    tmp.height = imageData.height;
    tmp.getContext('2d').putImageData(imageData, 0, 0);
    tmp.toBlob((blob) => resolve(blob), 'image/png');
  });
}

/** Write a PNG blob to the system clipboard. Fails silently if unsupported. */
export async function writePngBlobToClipboard(blob) {
  if (!blob || !('ClipboardItem' in window) || !navigator.clipboard?.write) return;
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  } catch {
    // Permission denied / insecure context — ignore
  }
}

/**
 * Decode a File (or blob URL string) into an in-memory clipboard payload.
 * @param {Blob | string} src
 * @returns {Promise<{ data: ImageData, w: number, h: number, localMask: null }>}
 */
export function clipboardFromImageSource(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = typeof src === 'string' ? src : URL.createObjectURL(src);
    const revoke = typeof src !== 'string';
    img.onload = () => {
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      const tmp = document.createElement('canvas');
      tmp.width = w;
      tmp.height = h;
      const tctx = tmp.getContext('2d', { willReadFrequently: true });
      tctx.drawImage(img, 0, 0);
      const data = tctx.getImageData(0, 0, w, h);
      if (revoke) URL.revokeObjectURL(url);
      resolve({ data, w, h, localMask: null });
    };
    img.onerror = () => {
      if (revoke) URL.revokeObjectURL(url);
      reject(new Error('Could not load image'));
    };
    img.src = url;
  });
}

/**
 * Mark a just-drawn region as an active, movable selection.
 * `baseData` must be a full-canvas snapshot taken *before* the content was drawn.
 * `localMask` is optional bbox-local (w*h) mask.
 */
export function activatePlacedSelection(state, ctx, x, y, w, h, baseData, localMask = null) {
  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;
  let sx = Math.round(x);
  let sy = Math.round(y);
  let sw = Math.round(w);
  let sh = Math.round(h);
  if (sx < 0) {
    sw += sx;
    sx = 0;
  }
  if (sy < 0) {
    sh += sy;
    sy = 0;
  }
  if (sx + sw > cw) sw = cw - sx;
  if (sy + sh > ch) sh = ch - sy;
  if (sw < 1 || sh < 1) {
    state.sel = {
      mode: 'none',
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      data: null,
      mask: null,
      baseData: null
    };
    return false;
  }
  const floatData = ctx.getImageData(sx, sy, sw, sh);
  const mask = localMask ? localMaskToFull(localMask, sx, sy, sw, sh, cw, ch) : null;
  state.sel = {
    mode: 'active',
    x: sx,
    y: sy,
    w: sw,
    h: sh,
    data: floatData,
    mask,
    baseData,
    lassoPoly: null
  };
  return true;
}

/**
 * Paste clipboard at (x, y). Pass null x/y to use current sel origin or 0,0.
 */
export function pasteClipboard(state, ctx, pushUndo, atX, atY) {
  if (!state.clipboard) return false;
  pushUndo('Paste');
  const { data, w, h, localMask } = state.clipboard;
  const x = atX != null ? atX : state.sel.x || 0;
  const y = atY != null ? atY : state.sel.y || 0;
  const baseData = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
  const tmp = document.createElement('canvas');
  tmp.width = w;
  tmp.height = h;
  tmp.getContext('2d', { willReadFrequently: true }).putImageData(data, 0, 0);
  ctx.drawImage(tmp, x, y);
  return activatePlacedSelection(state, ctx, x, y, w, h, baseData, localMask || null);
}

export function deleteSelection(state, ov, ctx, pushUndo) {
  const sel = state.sel;
  if (sel.mode !== 'active') return;
  pushUndo('Delete');
  if (sel.baseData && sel.data) {
    ctx.putImageData(sel.baseData, 0, 0);
    commitSelection(state, ov, ctx);
    return;
  }
  if (sel.mask) {
    const W = ctx.canvas.width;
    const img = ctx.getImageData(0, 0, W, ctx.canvas.height);
    const [br, bg, bb] = hexToRgb(state.bgColor);
    for (let row = 0; row < sel.h; row++) {
      for (let col = 0; col < sel.w; col++) {
        const maskIdx = (sel.y + row) * W + (sel.x + col);
        if (sel.mask[maskIdx]) {
          const pos = maskIdx * 4;
          img.data[pos] = br;
          img.data[pos + 1] = bg;
          img.data[pos + 2] = bb;
          img.data[pos + 3] = 255;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  } else {
    ctx.fillStyle = state.bgColor;
    ctx.fillRect(sel.x, sel.y, sel.w, sel.h);
  }
  commitSelection(state, ov, ctx);
}

/** Shift-constrain a free line to the nearest 45° increment. */
export function constrainLine(x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const angle = Math.atan2(dy, dx);
  const snap = Math.PI / 4;
  const snapped = Math.round(angle / snap) * snap;
  const dist = Math.hypot(dx, dy);
  return { x: x0 + Math.cos(snapped) * dist, y: y0 + Math.sin(snapped) * dist };
}

/** Shift-constrain a box so width == height (square / circle bounds). */
export function constrainSquare(x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const s = Math.max(Math.abs(dx), Math.abs(dy));
  const sx = dx === 0 ? (dy === 0 ? 1 : Math.sign(dy)) : Math.sign(dx);
  const sy = dy === 0 ? sx : Math.sign(dy);
  return { x: x0 + sx * s, y: y0 + sy * s };
}

/**
 * Selection-tool commit Seam. Tools always call this; they must not hang commit on the
 * document bag. Production runs applySelectionWithMask. Tests may set state.selectionCommit
 * (or the legacy state.applySelectionWithMask spy) to record calls.
 */
export function commitToolSelection(state, mask, W, H, mode) {
  const spy = state.selectionCommit ?? state.applySelectionWithMask;
  if (typeof spy === 'function') {
    spy(mask, W, H, mode);
    return;
  }
  applySelectionWithMask(state, mask, W, H, mode);
}

// Combine a freshly-built selection mask with the existing selection per modifier mode.
// Mutates `state.sel`; sets it to mode='none' if the result is empty.
export function applySelectionWithMask(state, newMask, W, H, mode) {
  let combined = newMask;
  if (mode && state.sel.mode === 'active') {
    const existing = selectionToFullMask(state.sel, W, H);
    combined = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) {
      if (mode === 'add') combined[i] = existing[i] || newMask[i] ? 1 : 0;
      else if (mode === 'subtract') combined[i] = existing[i] && !newMask[i] ? 1 : 0;
      else if (mode === 'intersect') combined[i] = existing[i] && newMask[i] ? 1 : 0;
    }
  }
  const bbox = maskBBox(combined, W, H);
  if (!bbox) {
    state.sel.mode = 'none';
    state.sel.mask = null;
    state.sel.data = null;
    state.sel.baseData = null;
    state.sel.lassoPoly = null;
    return;
  }
  state.sel = {
    mode: 'active',
    x: bbox.x,
    y: bbox.y,
    w: bbox.w,
    h: bbox.h,
    mask: combined,
    data: null,
    baseData: null
  };
}

export function selectAll(state, ov, W, H) {
  const mask = new Uint8Array(W * H).fill(1);
  state.sel = { mode: 'active', x: 0, y: 0, w: W, h: H, mask, data: null, baseData: null };
  drawSelectionOverlay(state, ov);
}

export function invertSelection(state, ov, W, H) {
  if (state.sel.mode !== 'active') {
    selectAll(state, ov, W, H);
    return;
  }
  const cur = selectionToFullMask(state.sel, W, H);
  const inv = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) inv[i] = cur[i] ? 0 : 1;
  applySelectionWithMask(state, inv, W, H, null);
  drawSelectionOverlay(state, ov);
}

const SELECTION_MODIFIERS = {
  feather: featherMask,
  expand: expandMask,
  contract: contractMask,
  border: borderMask,
  smooth: smoothMask
};

// Select ▸ Modify ▸ Border / Smooth / Expand / Contract / Feather. Runs the mask op on the current
// selection with a radius clamped to 0..32 and makes the result the new selection. Border and
// Smooth refuse a radius below 1 (PhotoCraft's dialog minimum). A floating paste is stamped onto
// `ctx` first so its pixels survive. Returns false (and changes nothing) with no selection.
export function modifySelection(state, ov, ctx, W, H, op, radius) {
  const fn = SELECTION_MODIFIERS[op];
  if (!fn || state.sel.mode !== 'active') return false;
  const r = Math.min(32, Math.max(0, Math.round(Number(radius) || 0)));
  if ((op === 'border' || op === 'smooth') && r < 1) return false;
  if (ctx && state.sel.data && state.sel.baseData) stampFloatingSelection(state, ctx);
  applySelectionWithMask(state, fn(selectionToFullMask(state.sel, W, H), W, H, r), W, H, null);
  if (state.sel.mode === 'none') clearOverlay(state, ov);
  else drawSelectionOverlay(state, ov);
  return true;
}

// Select ▸ Deselect: remembers the selection for Reselect, then commits it.
export function deselectSelection(state, ov, ctx, W, H) {
  if (state.sel.mode === 'active') state.lastSelMask = selectionToFullMask(state.sel, W, H);
  commitSelection(state, ov, ctx);
}

// Select ▸ Reselect (Shift+Ctrl+D): restores the mask the last Deselect dropped. Returns false
// when there is none, or the canvas has changed size since.
export function reselectSelection(state, ov, ctx, W, H) {
  const last = state.lastSelMask;
  if (!last || last.length !== W * H) return false;
  if (state.sel.mode !== 'none') commitSelection(state, ov, ctx);
  applySelectionWithMask(state, last.slice(), W, H, null);
  if (state.sel.mode === 'none') clearOverlay(state, ov);
  else drawSelectionOverlay(state, ov);
  return true;
}

// Select ▸ Grow / Similar on the current selection, sampling `img` (default: `ctx`, the active
// layer, after a floating paste is stamped). Returns false with no selection.
export function growSelection(state, ov, ctx, W, H, tolerance, contiguous, img = null) {
  if (state.sel.mode !== 'active') return false;
  if (ctx && state.sel.data && state.sel.baseData) stampFloatingSelection(state, ctx);
  const src = img ?? ctx.getImageData(0, 0, W, H);
  const mask = growSelectionMask(
    selectionToFullMask(state.sel, W, H),
    src.data,
    W,
    H,
    tolerance,
    contiguous
  );
  if (!mask) return false;
  applySelectionWithMask(state, mask, W, H, null);
  drawSelectionOverlay(state, ov);
  return true;
}

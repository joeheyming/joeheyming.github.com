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

// ── Marching-ants overlay ───────────────────────────────────────

let dashOffset = 0;
let lastDashTime = 0;

export function drawSelectionOverlay(state, ov) {
  const sel = state.sel;
  if (sel.mode === 'none') return;
  if (state.drawing && state.tool !== 'rectSelect' && state.tool !== 'lasso') return;

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
  ov.clearRect(0, 0, ov.canvas.width, ov.canvas.height);
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

/** Flip active selection (or whole active layer if none) horizontally or vertically. */
export function flipSelection(state, ctx, pushUndo, horizontal) {
  const sel = state.sel;
  pushUndo(horizontal ? 'Flip Horizontal' : 'Flip Vertical');

  if (sel.mode === 'active' && sel.w > 0 && sel.h > 0) {
    // Stamp floating first if needed
    if (sel.data && sel.baseData) stampFloatingSelection(state, ctx);
    const src = ctx.getImageData(sel.x, sel.y, sel.w, sel.h);
    const out = ctx.createImageData(sel.w, sel.h);
    for (let row = 0; row < sel.h; row++) {
      for (let col = 0; col < sel.w; col++) {
        const sx = horizontal ? sel.w - 1 - col : col;
        const sy = horizontal ? row : sel.h - 1 - row;
        const si = (sy * sel.w + sx) * 4;
        const di = (row * sel.w + col) * 4;
        out.data[di] = src.data[si];
        out.data[di + 1] = src.data[si + 1];
        out.data[di + 2] = src.data[si + 2];
        out.data[di + 3] = src.data[si + 3];
      }
    }
    ctx.putImageData(out, sel.x, sel.y);
    if (sel.mask) {
      const W = ctx.canvas.width;
      const H = ctx.canvas.height;
      const local = extractLocalMask(sel, W);
      const flipped = new Uint8Array(sel.w * sel.h);
      for (let row = 0; row < sel.h; row++) {
        for (let col = 0; col < sel.w; col++) {
          const sx = horizontal ? sel.w - 1 - col : col;
          const sy = horizontal ? row : sel.h - 1 - row;
          flipped[row * sel.w + col] = local[sy * sel.w + sx];
        }
      }
      sel.mask = localMaskToFull(flipped, sel.x, sel.y, sel.w, sel.h, W, H);
      sel.boundaryPixels = null;
    }
    sel.data = null;
    sel.baseData = null;
    return;
  }

  // Flip entire layer
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const src = ctx.getImageData(0, 0, W, H);
  const out = ctx.createImageData(W, H);
  for (let row = 0; row < H; row++) {
    for (let col = 0; col < W; col++) {
      const sx = horizontal ? W - 1 - col : col;
      const sy = horizontal ? row : H - 1 - row;
      const si = (sy * W + sx) * 4;
      const di = (row * W + col) * 4;
      out.data[di] = src.data[si];
      out.data[di + 1] = src.data[si + 1];
      out.data[di + 2] = src.data[si + 2];
      out.data[di + 3] = src.data[si + 3];
    }
  }
  ctx.putImageData(out, 0, 0);
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

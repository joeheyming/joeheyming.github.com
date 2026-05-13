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
        (y === 0 || !mask[row - W + x]) ||
        (y === H - 1 || !mask[row + W + x]) ||
        (x === 0 || !mask[row + x - 1]) ||
        (x === W - 1 || !mask[row + x + 1]);
      if (onEdge) out.push(x, y);
    }
  }
  return out;
}

export function hexToRgb(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

export function selectionToFullMask(sel, W, H) {
  if (sel.mask && sel.mask.length === W * H) return sel.mask.slice();
  const mask = new Uint8Array(W * H);
  if (sel.mode !== 'active') return mask;
  const x0 = Math.max(0, sel.x), y0 = Math.max(0, sel.y);
  const x1 = Math.min(W, sel.x + sel.w), y1 = Math.min(H, sel.y + sel.h);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) mask[y * W + x] = 1;
  }
  return mask;
}

export function maskBBox(mask, W, H) {
  let minX = W, maxX = -1, minY = H, maxY = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (mask[y * W + x]) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
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
  const W = ov.canvas.width, H = ov.canvas.height;
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

export function commitSelection(state, ov) {
  const sel = state.sel;
  if (sel.mode === 'none') return;
  // If floating data was moved, it's already stamped in onMove
  sel.mode = 'none';
  sel.data = null; sel.mask = null; sel.baseData = null;
  sel.lassoPoly = null;
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
  if (sel.mode !== 'active') return;
  const data = getSelectionImageData(state, ctx);
  state.clipboard = { data, w: sel.w, h: sel.h, mask: sel.mask ? sel.mask.slice() : null };
  if (cut) {
    pushUndo('Cut');
    if (sel.mask) {
      // Fill only selected pixels with bgColor
      const W = ctx.canvas.width;
      const img = ctx.getImageData(0, 0, W, ctx.canvas.height);
      const [br, bg, bb] = hexToRgb(state.bgColor);
      for (let row = 0; row < sel.h; row++) {
        for (let col = 0; col < sel.w; col++) {
          const maskIdx = (sel.y + row) * W + (sel.x + col);
          if (sel.mask[maskIdx]) {
            const pos = maskIdx * 4;
            img.data[pos] = br; img.data[pos + 1] = bg; img.data[pos + 2] = bb; img.data[pos + 3] = 255;
          }
        }
      }
      ctx.putImageData(img, 0, 0);
    } else {
      ctx.fillStyle = state.bgColor;
      ctx.fillRect(sel.x, sel.y, sel.w, sel.h);
    }
    commitSelection(state, ov);
  }
}

export function pasteClipboard(state, ctx, pushUndo) {
  if (!state.clipboard) return;
  pushUndo('Paste');
  const { data, w, h, mask } = state.clipboard;
  if (mask) {
    // Paste via temp canvas to handle alpha
    const tmp = document.createElement('canvas');
    tmp.width = w; tmp.height = h;
    tmp.getContext('2d', { willReadFrequently: true }).putImageData(data, 0, 0);
    ctx.drawImage(tmp, state.sel.x || 0, state.sel.y || 0);
  } else {
    ctx.putImageData(data, state.sel.x || 0, state.sel.y || 0);
  }
  state.sel = {
    mode: 'active', x: state.sel.x || 0, y: state.sel.y || 0, w, h,
    data: null, mask: null, baseData: null,
  };
}

export function deleteSelection(state, ov, ctx, pushUndo) {
  const sel = state.sel;
  if (sel.mode !== 'active') return;
  pushUndo('Delete');
  if (sel.mask) {
    const W = ctx.canvas.width;
    const img = ctx.getImageData(0, 0, W, ctx.canvas.height);
    const [br, bg, bb] = hexToRgb(state.bgColor);
    for (let row = 0; row < sel.h; row++) {
      for (let col = 0; col < sel.w; col++) {
        const maskIdx = (sel.y + row) * W + (sel.x + col);
        if (sel.mask[maskIdx]) {
          const pos = maskIdx * 4;
          img.data[pos] = br; img.data[pos + 1] = bg; img.data[pos + 2] = bb; img.data[pos + 3] = 255;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  } else {
    ctx.fillStyle = state.bgColor;
    ctx.fillRect(sel.x, sel.y, sel.w, sel.h);
  }
  commitSelection(state, ov);
}

// Combine a freshly-built selection mask with the existing selection per modifier mode.
// Mutates `state.sel`; sets it to mode='none' if the result is empty.
export function applySelectionWithMask(state, newMask, W, H, mode) {
  let combined = newMask;
  if (mode && state.sel.mode === 'active') {
    const existing = selectionToFullMask(state.sel, W, H);
    combined = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) {
      if (mode === 'add') combined[i] = (existing[i] || newMask[i]) ? 1 : 0;
      else if (mode === 'subtract') combined[i] = (existing[i] && !newMask[i]) ? 1 : 0;
      else if (mode === 'intersect') combined[i] = (existing[i] && newMask[i]) ? 1 : 0;
    }
  }
  const bbox = maskBBox(combined, W, H);
  if (!bbox) {
    state.sel.mode = 'none';
    state.sel.mask = null; state.sel.data = null; state.sel.baseData = null;
    state.sel.lassoPoly = null;
    return;
  }
  state.sel = {
    mode: 'active',
    x: bbox.x, y: bbox.y, w: bbox.w, h: bbox.h,
    mask: combined,
    data: null, baseData: null,
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

// Tool registry — each entry is { label, icon, cursor, options?, onDown, onMove, onUp }
// All hooks: (ctx, overlayCtx, state, x, y, isRightClick)

// Per-tool option lookup. Schema lives next to each tool definition (TOOL_OPTION_SCHEMA);
// runtime values live on state.toolOptions[toolId].
export function toolOpts(state, toolId) {
  return (state.toolOptions && state.toolOptions[toolId]) || {};
}

function hexToRgba(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b, 255];
}

export function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

function floodFill(ctx, startX, startY, fillHex, tolerance = 15) {
  const canvas = ctx.canvas;
  const W = canvas.width, H = canvas.height;
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  const sx = Math.round(startX), sy = Math.round(startY);
  if (sx < 0 || sx >= W || sy < 0 || sy >= H) return;

  const base = (sy * W + sx) * 4;
  const tr = d[base], tg = d[base + 1], tb = d[base + 2], ta = d[base + 3];
  const [fr, fg, fb] = hexToRgba(fillHex);
  if (tr === fr && tg === fg && tb === fb && ta === 255) return;

  const stack = [sx + sy * W];
  const seen = new Uint8Array(W * H);
  seen[sx + sy * W] = 1;

  while (stack.length) {
    const idx = stack.pop();
    const pos = idx * 4;
    if (
      Math.abs(d[pos] - tr) > tolerance ||
      Math.abs(d[pos + 1] - tg) > tolerance ||
      Math.abs(d[pos + 2] - tb) > tolerance ||
      Math.abs(d[pos + 3] - ta) > tolerance
    ) continue;

    d[pos] = fr; d[pos + 1] = fg; d[pos + 2] = fb; d[pos + 3] = 255;

    const px = idx % W, py = (idx / W) | 0;
    if (px > 0 && !seen[idx - 1]) { seen[idx - 1] = 1; stack.push(idx - 1); }
    if (px < W - 1 && !seen[idx + 1]) { seen[idx + 1] = 1; stack.push(idx + 1); }
    if (py > 0 && !seen[idx - W]) { seen[idx - W] = 1; stack.push(idx - W); }
    if (py < H - 1 && !seen[idx + W]) { seen[idx + W] = 1; stack.push(idx + W); }
  }
  ctx.putImageData(img, 0, 0);
}

// BFS selection — returns Uint8Array mask (1=selected) and bounding box.
// When contiguous=false, selects ALL matching pixels regardless of connectivity.
export function floodSelect(ctx, startX, startY, tolerance = 30, contiguous = true) {
  const canvas = ctx.canvas;
  const W = canvas.width, H = canvas.height;
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  const sx = Math.round(startX), sy = Math.round(startY);
  if (sx < 0 || sx >= W || sy < 0 || sy >= H) return null;

  const base = (sy * W + sx) * 4;
  const tr = d[base], tg = d[base + 1], tb = d[base + 2], ta = d[base + 3];
  const mask = new Uint8Array(W * H);
  let minX = sx, maxX = sx, minY = sy, maxY = sy;

  const matches = (pos) =>
    Math.abs(d[pos] - tr) <= tolerance &&
    Math.abs(d[pos + 1] - tg) <= tolerance &&
    Math.abs(d[pos + 2] - tb) <= tolerance &&
    Math.abs(d[pos + 3] - ta) <= tolerance;

  if (!contiguous) {
    let any = false;
    for (let i = 0; i < W * H; i++) {
      if (matches(i * 4)) {
        mask[i] = 1;
        const px = i % W, py = (i / W) | 0;
        if (!any) { minX = maxX = px; minY = maxY = py; any = true; }
        else {
          if (px < minX) minX = px; if (px > maxX) maxX = px;
          if (py < minY) minY = py; if (py > maxY) maxY = py;
        }
      }
    }
    if (!any) return null;
    return { mask, x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  }

  const stack = [sx + sy * W];
  mask[sx + sy * W] = 1;

  while (stack.length) {
    const idx = stack.pop();
    if (!matches(idx * 4)) continue;

    const px = idx % W, py = (idx / W) | 0;
    if (px < minX) minX = px; if (px > maxX) maxX = px;
    if (py < minY) minY = py; if (py > maxY) maxY = py;

    if (px > 0 && !mask[idx - 1]) { mask[idx - 1] = 1; stack.push(idx - 1); }
    if (px < W - 1 && !mask[idx + 1]) { mask[idx + 1] = 1; stack.push(idx + 1); }
    if (py > 0 && !mask[idx - W]) { mask[idx - W] = 1; stack.push(idx - W); }
    if (py < H - 1 && !mask[idx + W]) { mask[idx + W] = 1; stack.push(idx + W); }
  }

  return { mask, x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

// Scanline fill — returns Uint8Array mask for a closed polygon path
export function scanlineFill(path, W, H) {
  const mask = new Uint8Array(W * H);
  if (path.length < 3) return mask;

  for (let y = 0; y < H; y++) {
    const intersections = [];
    for (let i = 0; i < path.length; i++) {
      const [x1, y1] = path[i];
      const [x2, y2] = path[(i + 1) % path.length];
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
        intersections.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
      }
    }
    intersections.sort((a, b) => a - b);
    for (let i = 0; i < intersections.length - 1; i += 2) {
      const x0 = Math.max(0, Math.ceil(intersections[i]));
      const x1 = Math.min(W - 1, Math.floor(intersections[i + 1]));
      for (let x = x0; x <= x1; x++) mask[y * W + x] = 1;
    }
  }
  return mask;
}

function applyFgStyle(ctx, state) {
  ctx.strokeStyle = state.activeColor;
  ctx.fillStyle = state.activeColor;
  ctx.lineWidth = state.brushSize;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

// Pressure scales between 30%..100% of base size for stylus input,
// and is a no-op (1.0) for mouse/touch.
function pressureSize(state, baseSize) {
  const p = state.pressure ?? 1;
  if (p >= 1) return baseSize;
  return Math.max(0.5, baseSize * (0.3 + 0.7 * p));
}

// Per-tool options schema. Renderer in ui.js reads this. Defaults seed state.toolOptions.
// Types: 'range' { min, max, step, default }, 'checkbox' { default }, 'select' { options, default }.
export const TOOL_OPTION_SCHEMA = {
  pencil: [{ key: 'size', type: 'range', label: 'Size', min: 1, max: 100, step: 1, default: 4 }],
  brush:  [
    { key: 'size',  type: 'range', label: 'Size',  min: 1, max: 100, step: 1, default: 4 },
    { key: 'flow',  type: 'range', label: 'Flow',  min: 1, max: 100, step: 1, default: 80 },
  ],
  eraser: [{ key: 'size', type: 'range', label: 'Size', min: 1, max: 100, step: 1, default: 4 }],
  spray:  [
    { key: 'size',    type: 'range', label: 'Size',    min: 1, max: 100, step: 1, default: 4 },
    { key: 'density', type: 'range', label: 'Density', min: 1, max: 100, step: 1, default: 80 },
  ],
  fill: [
    { key: 'tolerance', type: 'range', label: 'Tolerance', min: 0, max: 100, step: 1, default: 15 },
  ],
  eyedropper: [],
  text: [
    { key: 'size',   type: 'range',  label: 'Font size', min: 8,  max: 200, step: 1, default: 16 },
    { key: 'family', type: 'select', label: 'Font',
      options: [
        { value: 'sans-serif', label: 'Sans' },
        { value: 'serif',      label: 'Serif' },
        { value: 'monospace',  label: 'Mono' },
        { value: 'cursive',    label: 'Cursive' },
        { value: 'fantasy',    label: 'Display' },
      ],
      default: 'sans-serif' },
    { key: 'bold',   type: 'checkbox', label: 'Bold',   default: false },
    { key: 'italic', type: 'checkbox', label: 'Italic', default: false },
  ],
  line:    [{ key: 'size', type: 'range', label: 'Width', min: 1, max: 50, step: 1, default: 2 }],
  rect:    [
    { key: 'size', type: 'range',    label: 'Width', min: 1, max: 50, step: 1, default: 2 },
    { key: 'fill', type: 'checkbox', label: 'Fill',  default: false },
  ],
  ellipse: [
    { key: 'size', type: 'range',    label: 'Width', min: 1, max: 50, step: 1, default: 2 },
    { key: 'fill', type: 'checkbox', label: 'Fill',  default: false },
  ],
  rectSelect: [
    { key: '_hint', type: 'hint',
      text: '⇧/⌘ add · ⌥ subtract · ⇧⌥ intersect',
      title: 'Hold Shift or Cmd/Ctrl to add to the selection. Hold Alt/Option to subtract. Combine for intersect.' },
  ],
  lasso: [
    { key: '_hint', type: 'hint',
      text: '⇧/⌘ add · ⌥ subtract · ⇧⌥ intersect',
      title: 'Hold Shift or Cmd/Ctrl to add to the selection. Hold Alt/Option to subtract. Combine for intersect.' },
  ],
  magicWand: [
    { key: 'tolerance',  type: 'range',    label: 'Tolerance',  min: 0, max: 200, step: 1, default: 30 },
    { key: 'contiguous', type: 'checkbox', label: 'Contiguous', default: true },
    { key: '_hint', type: 'hint',
      text: '⇧/⌘ add · ⌥ subtract · ⇧⌥ intersect',
      title: 'Hold Shift or Cmd/Ctrl to add to the selection. Hold Alt/Option to subtract. Combine for intersect.' },
  ],
};

// Build the default state.toolOptions object from the schema.
export function defaultToolOptions() {
  const out = {};
  for (const [tool, opts] of Object.entries(TOOL_OPTION_SCHEMA)) {
    out[tool] = {};
    for (const o of opts) {
      if (o.type === 'hint') continue;
      out[tool][o.key] = o.default;
    }
  }
  return out;
}

export const TOOLS = {
  pencil: {
    label: 'Pencil', icon: '✏️', cursor: 'crosshair',
    onDown(ctx, ov, state, x, y) {
      state.drawing = true;
      state.lastX = x; state.lastY = y;
      applyFgStyle(ctx, state);
      const sz = pressureSize(state, state.brushSize);
      ctx.lineWidth = sz;
      ctx.beginPath();
      ctx.arc(x, y, sz / 2, 0, Math.PI * 2);
      ctx.fill();
    },
    onMove(ctx, ov, state, x, y) {
      if (!state.drawing) return;
      ctx.lineWidth = pressureSize(state, state.brushSize);
      ctx.beginPath();
      ctx.moveTo(state.lastX, state.lastY);
      ctx.lineTo(x, y);
      ctx.stroke();
      state.lastX = x; state.lastY = y;
    },
    onUp(ctx, ov, state) { state.drawing = false; },
  },

  brush: {
    label: 'Brush', icon: '🖌️', cursor: 'crosshair',
    options: { hardness: 80, flow: 80 },
    onDown(ctx, ov, state, x, y) {
      state.drawing = true;
      state.lastX = x; state.lastY = y;
      const opts = toolOpts(state, 'brush');
      const sz = pressureSize(state, state.brushSize * 3);
      ctx.strokeStyle = state.activeColor;
      ctx.fillStyle = state.activeColor;
      ctx.lineWidth = sz;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = (opts.flow ?? 80) / 100;
      ctx.globalCompositeOperation = 'source-over';
      ctx.beginPath();
      ctx.arc(x, y, sz / 2, 0, Math.PI * 2);
      ctx.fill();
    },
    onMove(ctx, ov, state, x, y) {
      if (!state.drawing) return;
      ctx.lineWidth = pressureSize(state, state.brushSize * 3);
      ctx.beginPath();
      ctx.moveTo(state.lastX, state.lastY);
      ctx.lineTo(x, y);
      ctx.stroke();
      state.lastX = x; state.lastY = y;
    },
    onUp(ctx, ov, state) { state.drawing = false; ctx.globalAlpha = 1; },
  },

  eraser: {
    label: 'Eraser', icon: '🧽', cursor: 'crosshair',
    onDown(ctx, ov, state, x, y) {
      state.drawing = true;
      state.lastX = x; state.lastY = y;
      const sz = pressureSize(state, state.brushSize * 3);
      ctx.strokeStyle = '#000';
      ctx.fillStyle = '#000';
      ctx.lineWidth = sz;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.arc(x, y, sz / 2, 0, Math.PI * 2);
      ctx.fill();
    },
    onMove(ctx, ov, state, x, y) {
      if (!state.drawing) return;
      ctx.lineWidth = pressureSize(state, state.brushSize * 3);
      ctx.beginPath();
      ctx.moveTo(state.lastX, state.lastY);
      ctx.lineTo(x, y);
      ctx.stroke();
      state.lastX = x; state.lastY = y;
    },
    onUp(ctx, ov, state) {
      state.drawing = false;
      ctx.globalCompositeOperation = 'source-over';
    },
  },

  spray: {
    label: 'Spray', icon: '💨', cursor: 'crosshair',
    onDown(ctx, ov, state, x, y) {
      state.drawing = true;
      state.sprayX = x; state.sprayY = y;
      state.sprayTimer = setInterval(() => state.sprayDot?.(state.sprayX, state.sprayY), 30);
      state.sprayDot?.(x, y);
    },
    onMove(ctx, ov, state, x, y) {
      if (!state.drawing) return;
      state.sprayX = x; state.sprayY = y;
      state.sprayDot?.(x, y);
    },
    onUp(ctx, ov, state) {
      state.drawing = false;
      clearInterval(state.sprayTimer);
    },
  },

  fill: {
    label: 'Fill', icon: '🪣', cursor: 'crosshair',
    onDown(ctx, ov, state, x, y) {
      const tol = toolOpts(state, 'fill').tolerance ?? 15;
      floodFill(ctx, x, y, state.activeColor, tol);
    },
    onMove() {}, onUp() {},
  },

  eyedropper: {
    label: 'Eyedropper', icon: '🔍', cursor: 'crosshair',
    onDown(ctx, ov, state, x, y, isRight) {
      const px = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
      const hex = rgbToHex(px[0], px[1], px[2]);
      if (isRight) {
        state.bgColor = hex;
        state.onBgColorChange?.(hex);
      } else {
        state.color = hex;
        state.activeColor = hex;
        state.onColorChange?.(hex);
      }
    },
    onMove() {}, onUp() {},
  },

  text: {
    label: 'Text', icon: 'T', cursor: 'text',
    onDown(ctx, ov, state, x, y) { state.showTextInput?.(ctx, x, y); },
    onMove() {}, onUp() {},
  },

  line: {
    label: 'Line', icon: '╱', cursor: 'crosshair',
    onDown(ctx, ov, state, x, y) {
      state.drawing = true;
      state.startX = x; state.startY = y;
    },
    onMove(ctx, ov, state, x, y) {
      if (!state.drawing) return;
      ov.clearRect(0, 0, ov.canvas.width, ov.canvas.height);
      ov.strokeStyle = state.activeColor;
      ov.lineWidth = state.brushSize;
      ov.lineCap = 'round';
      ov.globalAlpha = 1;
      ov.beginPath();
      ov.moveTo(state.startX, state.startY);
      ov.lineTo(x, y);
      ov.stroke();
    },
    onUp(ctx, ov, state, x, y) {
      if (!state.drawing) return;
      state.drawing = false;
      ov.clearRect(0, 0, ov.canvas.width, ov.canvas.height);
      applyFgStyle(ctx, state);
      ctx.beginPath();
      ctx.moveTo(state.startX, state.startY);
      ctx.lineTo(x, y);
      ctx.stroke();
    },
  },

  rect: {
    label: 'Rect', icon: '▭', cursor: 'crosshair',
    onDown(ctx, ov, state, x, y) {
      state.drawing = true; state.startX = x; state.startY = y;
    },
    onMove(ctx, ov, state, x, y) {
      if (!state.drawing) return;
      ov.clearRect(0, 0, ov.canvas.width, ov.canvas.height);
      ov.strokeStyle = state.activeColor;
      ov.fillStyle = state.activeColor;
      ov.lineWidth = state.brushSize;
      ov.globalAlpha = 1;
      const w = x - state.startX, h = y - state.startY;
      if (state.shapeFill) ov.fillRect(state.startX, state.startY, w, h);
      else ov.strokeRect(state.startX, state.startY, w, h);
    },
    onUp(ctx, ov, state, x, y) {
      if (!state.drawing) return;
      state.drawing = false;
      ov.clearRect(0, 0, ov.canvas.width, ov.canvas.height);
      applyFgStyle(ctx, state);
      const w = x - state.startX, h = y - state.startY;
      if (state.shapeFill) ctx.fillRect(state.startX, state.startY, w, h);
      else ctx.strokeRect(state.startX, state.startY, w, h);
    },
  },

  ellipse: {
    label: 'Ellipse', icon: '⬭', cursor: 'crosshair',
    onDown(ctx, ov, state, x, y) {
      state.drawing = true; state.startX = x; state.startY = y;
    },
    onMove(ctx, ov, state, x, y) {
      if (!state.drawing) return;
      ov.clearRect(0, 0, ov.canvas.width, ov.canvas.height);
      const rx = Math.abs(x - state.startX) / 2;
      const ry = Math.abs(y - state.startY) / 2;
      const cx = (state.startX + x) / 2, cy = (state.startY + y) / 2;
      ov.strokeStyle = state.activeColor;
      ov.fillStyle = state.activeColor;
      ov.lineWidth = state.brushSize;
      ov.globalAlpha = 1;
      ov.beginPath();
      ov.ellipse(cx, cy, Math.max(rx, 0.5), Math.max(ry, 0.5), 0, 0, Math.PI * 2);
      if (state.shapeFill) ov.fill(); else ov.stroke();
    },
    onUp(ctx, ov, state, x, y) {
      if (!state.drawing) return;
      state.drawing = false;
      ov.clearRect(0, 0, ov.canvas.width, ov.canvas.height);
      applyFgStyle(ctx, state);
      const rx = Math.abs(x - state.startX) / 2;
      const ry = Math.abs(y - state.startY) / 2;
      const cx = (state.startX + x) / 2, cy = (state.startY + y) / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, Math.max(rx, 0.5), Math.max(ry, 0.5), 0, 0, Math.PI * 2);
      if (state.shapeFill) ctx.fill(); else ctx.stroke();
    },
  },

  // ── Selection tools ─────────────────────────────────────────────

  rectSelect: {
    label: 'Select', icon: '⬚', cursor: 'crosshair',
    onDown(ctx, ov, state, x, y) {
      const sel = state.sel;
      const hasModifier = !!(state.selectionModeFor?.(state));
      if (!hasModifier && sel.mode === 'active' && isInside(sel, x, y)) {
        // Start moving the selection content
        state.selStartMoveX = x; state.selStartMoveY = y;
        state.selOrigX = sel.x; state.selOrigY = sel.y;
        if (!sel.data) {
          sel.data = ctx.getImageData(sel.x, sel.y, sel.w, sel.h);
          ctx.fillStyle = state.bgColor;
          ctx.fillRect(sel.x, sel.y, sel.w, sel.h);
          sel.baseData = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
        }
        sel.mode = 'moving';
      } else {
        // Without a modifier key, commit any existing floating content
        if (!hasModifier) state.commitSelection?.();
        // Start new selection
        sel.mode = 'drawing';
        sel.x = x; sel.y = y; sel.w = 0; sel.h = 0;
        if (!hasModifier) { sel.data = null; sel.mask = null; sel.baseData = null; }
        state.startX = x; state.startY = y;
        state.drawing = true;
      }
    },
    onMove(ctx, ov, state, x, y) {
      const sel = state.sel;
      if (sel.mode === 'drawing' && state.drawing) {
        const nx = Math.min(x, state.startX);
        const ny = Math.min(y, state.startY);
        sel.x = nx; sel.y = ny;
        sel.w = Math.abs(x - state.startX);
        sel.h = Math.abs(y - state.startY);
      } else if (sel.mode === 'moving') {
        const dx = x - state.selStartMoveX;
        const dy = y - state.selStartMoveY;
        sel.x = state.selOrigX + dx;
        sel.y = state.selOrigY + dy;
        ctx.putImageData(sel.baseData, 0, 0);
        ctx.putImageData(sel.data, sel.x, sel.y);
      }
    },
    onUp(ctx, ov, state) {
      const sel = state.sel;
      if (sel.mode === 'drawing') {
        state.drawing = false;
        if (sel.w < 2 || sel.h < 2) { sel.mode = 'none'; return; }
        const W = ctx.canvas.width, H = ctx.canvas.height;
        const mode = state.selectionModeFor?.(state);
        if (mode && state.applySelectionWithMask) {
          const m = new Uint8Array(W * H);
          const x0 = Math.max(0, sel.x), y0 = Math.max(0, sel.y);
          const x1 = Math.min(W, sel.x + sel.w), y1 = Math.min(H, sel.y + sel.h);
          for (let yy = y0; yy < y1; yy++)
            for (let xx = x0; xx < x1; xx++) m[yy * W + xx] = 1;
          state.applySelectionWithMask(m, W, H, mode);
        } else {
          sel.mode = 'active';
          sel.data = ctx.getImageData(sel.x, sel.y, sel.w, sel.h);
        }
      } else if (sel.mode === 'moving') {
        sel.mode = 'active';
      }
    },
  },

  lasso: {
    label: 'Lasso', icon: '🔗', cursor: 'crosshair',
    onDown(ctx, ov, state, x, y) {
      const hasModifier = !!(state.selectionModeFor?.(state));
      if (!hasModifier) state.commitSelection?.();
      state.lassoPath = [[x, y]];
      state.sel.mode = 'lasso-drawing';
      state.drawing = true;
    },
    onMove(ctx, ov, state, x, y) {
      if (!state.drawing) return;
      state.lassoPath.push([x, y]);
      ov.clearRect(0, 0, ov.canvas.width, ov.canvas.height);
      ov.strokeStyle = '#fff';
      ov.lineWidth = 1;
      ov.setLineDash([4, 4]);
      ov.beginPath();
      ov.moveTo(state.lassoPath[0][0], state.lassoPath[0][1]);
      for (const [px, py] of state.lassoPath) ov.lineTo(px, py);
      ov.stroke();
      ov.setLineDash([]);
    },
    onUp(ctx, ov, state) {
      if (!state.drawing) return;
      state.drawing = false;
      ov.clearRect(0, 0, ov.canvas.width, ov.canvas.height);
      if (state.lassoPath.length < 3) { state.sel.mode = 'none'; return; }

      const { scanlineFill: fill } = state;
      if (!fill) { state.sel.mode = 'none'; return; }

      const W = ctx.canvas.width, H = ctx.canvas.height;
      const mask = fill(state.lassoPath, W, H);
      const mode = state.selectionModeFor?.(state);
      if (mode && state.applySelectionWithMask) {
        state.applySelectionWithMask(mask, W, H, mode);
      } else {
        let minX = W, maxX = 0, minY = H, maxY = 0;
        for (const [px, py] of state.lassoPath) {
          if (px < minX) minX = px; if (px > maxX) maxX = px;
          if (py < minY) minY = py; if (py > maxY) maxY = py;
        }
        state.sel = {
          mode: 'active',
          x: Math.max(0, minX), y: Math.max(0, minY),
          w: Math.min(maxX - minX + 1, W), h: Math.min(maxY - minY + 1, H),
          mask, data: null, baseData: null,
          lassoPoly: state.lassoPath,
        };
      }
    },
  },

  magicWand: {
    label: 'Magic Wand', icon: '🪄', cursor: 'crosshair',
    onDown(ctx, ov, state, x, y) {
      const hasModifier = !!(state.selectionModeFor?.(state));
      if (!hasModifier) state.commitSelection?.();
      const result = state.doMagicWand?.(ctx, x, y);
      if (!result) return;
      const W = ctx.canvas.width, H = ctx.canvas.height;
      const mode = state.selectionModeFor?.(state);
      if (mode && state.applySelectionWithMask) {
        state.applySelectionWithMask(result.mask, W, H, mode);
      } else {
        state.sel = {
          mode: 'active',
          x: result.x, y: result.y, w: result.w, h: result.h,
          mask: result.mask, data: null, baseData: null,
        };
      }
    },
    onMove() {}, onUp() {},
  },
};

function isInside(sel, x, y) {
  return x >= sel.x && x <= sel.x + sel.w && y >= sel.y && y <= sel.y + sel.h;
}

// Tool registry — each entry is { label, icon, cursor, onDown, onMove, onUp }
// All hooks: (ctx, overlayCtx, state, x, y, isRightClick)

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

// BFS selection — returns Uint8Array mask (1=selected) and bounding box
export function floodSelect(ctx, startX, startY, tolerance = 30) {
  const canvas = ctx.canvas;
  const W = canvas.width, H = canvas.height;
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  const sx = Math.round(startX), sy = Math.round(startY);
  if (sx < 0 || sx >= W || sy < 0 || sy >= H) return null;

  const base = (sy * W + sx) * 4;
  const tr = d[base], tg = d[base + 1], tb = d[base + 2], ta = d[base + 3];

  const mask = new Uint8Array(W * H);
  const stack = [sx + sy * W];
  mask[sx + sy * W] = 1;
  let minX = sx, maxX = sx, minY = sy, maxY = sy;

  while (stack.length) {
    const idx = stack.pop();
    const pos = idx * 4;
    if (
      Math.abs(d[pos] - tr) > tolerance ||
      Math.abs(d[pos + 1] - tg) > tolerance ||
      Math.abs(d[pos + 2] - tb) > tolerance ||
      Math.abs(d[pos + 3] - ta) > tolerance
    ) continue;

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

export const TOOLS = {
  pencil: {
    label: 'Pencil', icon: '✏️', cursor: 'crosshair',
    onDown(ctx, ov, state, x, y) {
      state.drawing = true;
      state.lastX = x; state.lastY = y;
      applyFgStyle(ctx, state);
      ctx.beginPath();
      ctx.arc(x, y, state.brushSize / 2, 0, Math.PI * 2);
      ctx.fill();
    },
    onMove(ctx, ov, state, x, y) {
      if (!state.drawing) return;
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
    onDown(ctx, ov, state, x, y) {
      state.drawing = true;
      state.lastX = x; state.lastY = y;
      ctx.strokeStyle = state.activeColor;
      ctx.fillStyle = state.activeColor;
      ctx.lineWidth = state.brushSize * 3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = 0.8;
      ctx.globalCompositeOperation = 'source-over';
      ctx.beginPath();
      ctx.arc(x, y, (state.brushSize * 3) / 2, 0, Math.PI * 2);
      ctx.fill();
    },
    onMove(ctx, ov, state, x, y) {
      if (!state.drawing) return;
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
      ctx.strokeStyle = '#000';
      ctx.fillStyle = '#000';
      ctx.lineWidth = state.brushSize * 3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.arc(x, y, (state.brushSize * 3) / 2, 0, Math.PI * 2);
      ctx.fill();
    },
    onMove(ctx, ov, state, x, y) {
      if (!state.drawing) return;
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
    onDown(ctx, ov, state, x, y) { floodFill(ctx, x, y, state.activeColor); },
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
      if (sel.mode === 'active' && isInside(sel, x, y)) {
        // Start moving the selection content
        state.selStartMoveX = x; state.selStartMoveY = y;
        state.selOrigX = sel.x; state.selOrigY = sel.y;
        if (!sel.data) {
          // Grab pixel data and punch hole
          sel.data = ctx.getImageData(sel.x, sel.y, sel.w, sel.h);
          ctx.fillStyle = state.bgColor;
          ctx.fillRect(sel.x, sel.y, sel.w, sel.h);
          sel.baseData = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
        }
        sel.mode = 'moving';
      } else {
        // Commit any existing floating content
        state.commitSelection?.();
        // Start new selection
        sel.mode = 'drawing';
        sel.x = x; sel.y = y; sel.w = 0; sel.h = 0;
        sel.data = null; sel.mask = null; sel.baseData = null;
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
        // Redraw base + floating content on canvas
        ctx.putImageData(sel.baseData, 0, 0);
        ctx.putImageData(sel.data, sel.x, sel.y);
      }
    },
    onUp(ctx, ov, state, x, y) {
      const sel = state.sel;
      if (sel.mode === 'drawing') {
        state.drawing = false;
        if (sel.w < 2 || sel.h < 2) {
          sel.mode = 'none';
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
      state.commitSelection?.();
      state.lassoPath = [[x, y]];
      state.sel.mode = 'lasso-drawing';
      state.drawing = true;
    },
    onMove(ctx, ov, state, x, y) {
      if (!state.drawing) return;
      state.lassoPath.push([x, y]);
      // Preview path on overlay
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
    onUp(ctx, ov, state, x, y) {
      if (!state.drawing) return;
      state.drawing = false;
      ov.clearRect(0, 0, ov.canvas.width, ov.canvas.height);
      if (state.lassoPath.length < 3) { state.sel.mode = 'none'; return; }

      const { scanlineFill: fill } = state;
      if (!fill) { state.sel.mode = 'none'; return; }

      const W = ctx.canvas.width, H = ctx.canvas.height;
      const mask = fill(state.lassoPath, W, H);
      // Compute bounding box
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
    },
  },

  magicWand: {
    label: 'Magic Wand', icon: '🪄', cursor: 'crosshair',
    onDown(ctx, ov, state, x, y) {
      state.commitSelection?.();
      const result = state.doMagicWand?.(ctx, x, y);
      if (result) {
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

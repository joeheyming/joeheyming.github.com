// Placed objects (text / images) — Google Drawings-style selectable items
// that live above raster layers and can be clicked, moved, and re-edited.

let nextObjectId = 1;

/**
 * @typedef {{
 *   id: number,
 *   type: 'text',
 *   x: number, y: number, w: number, h: number,
 *   text: string,
 *   fontSpec: string,
 *   fontSize: number,
 *   color: string,
 *   family: string,
 *   bold: boolean,
 *   italic: boolean,
 *   canvasX: number,
 *   canvasY: number
 * }} TextObject
 *
 * @typedef {{
 *   id: number,
 *   type: 'image',
 *   x: number, y: number, w: number, h: number,
 *   source: HTMLCanvasElement
 * }} ImageObject
 *
 * @typedef {TextObject | ImageObject} PaintObject
 */

export function cloneObjects(objects) {
  return objects.map((o) => {
    if (o.type === 'image') {
      const source = document.createElement('canvas');
      source.width = o.source.width;
      source.height = o.source.height;
      source.getContext('2d').drawImage(o.source, 0, 0);
      return { ...o, source };
    }
    return { ...o };
  });
}

export function measureTextObject(partial) {
  const tmp = document.createElement('canvas').getContext('2d');
  tmp.font = partial.fontSpec;
  tmp.textBaseline = 'alphabetic';
  const metrics = tmp.measureText(partial.text);
  const ascent = metrics.actualBoundingBoxAscent ?? partial.fontSize * 0.8;
  const descent = metrics.actualBoundingBoxDescent ?? partial.fontSize * 0.2;
  const left = metrics.actualBoundingBoxLeft ?? 0;
  const right = metrics.actualBoundingBoxRight ?? metrics.width;
  const w = Math.max(1, Math.ceil(left + right));
  const h = Math.max(1, Math.ceil(ascent + descent));
  const x = partial.canvasX - left;
  const y = partial.canvasY + partial.fontSize - ascent;
  return { x, y, w, h, ascent, left };
}

/** @returns {TextObject} */
export function createTextObject({
  text,
  canvasX,
  canvasY,
  fontSpec,
  fontSize,
  color,
  family,
  bold,
  italic
}) {
  const metrics = measureTextObject({ text, fontSpec, fontSize, canvasX, canvasY });
  return {
    id: nextObjectId++,
    type: 'text',
    x: metrics.x,
    y: metrics.y,
    w: metrics.w,
    h: metrics.h,
    text,
    fontSpec,
    fontSize,
    color,
    family,
    bold: !!bold,
    italic: !!italic,
    canvasX,
    canvasY
  };
}

/** @returns {ImageObject} */
export function createImageObjectFromImageData(imageData, x, y) {
  const source = document.createElement('canvas');
  source.width = imageData.width;
  source.height = imageData.height;
  source.getContext('2d').putImageData(imageData, 0, 0);
  return {
    id: nextObjectId++,
    type: 'image',
    x: Math.round(x),
    y: Math.round(y),
    w: imageData.width,
    h: imageData.height,
    source
  };
}

/** @returns {ImageObject} */
export function createImageObjectFromImage(img, x, y) {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const source = document.createElement('canvas');
  source.width = w;
  source.height = h;
  source.getContext('2d').drawImage(img, 0, 0);
  return {
    id: nextObjectId++,
    type: 'image',
    x: Math.round(x),
    y: Math.round(y),
    w,
    h,
    source
  };
}

/** Serialize objects for .paintproj / autosave (image pixels as PNG data URLs). */
export function serializeObjects(objects) {
  return (objects || []).map((o) => {
    if (o.type === 'image') {
      return {
        type: 'image',
        x: o.x,
        y: o.y,
        w: o.w,
        h: o.h,
        dataUrl: o.source.toDataURL('image/png')
      };
    }
    return {
      type: 'text',
      x: o.x,
      y: o.y,
      w: o.w,
      h: o.h,
      text: o.text,
      fontSpec: o.fontSpec,
      fontSize: o.fontSize,
      color: o.color,
      family: o.family,
      bold: !!o.bold,
      italic: !!o.italic,
      canvasX: o.canvasX,
      canvasY: o.canvasY,
      stretch: !!o.stretch
    };
  });
}

/** Restore objects from serialized form. */
export async function deserializeObjects(serialized) {
  if (!Array.isArray(serialized) || !serialized.length) return [];
  const out = [];
  for (const raw of serialized) {
    if (raw.type === 'image' && raw.dataUrl) {
      const img = await loadImageEl(raw.dataUrl);
      const source = document.createElement('canvas');
      const sw = img.naturalWidth || img.width;
      const sh = img.naturalHeight || img.height;
      source.width = sw;
      source.height = sh;
      source.getContext('2d').drawImage(img, 0, 0);
      out.push({
        id: nextObjectId++,
        type: 'image',
        x: raw.x || 0,
        y: raw.y || 0,
        w: raw.w || sw,
        h: raw.h || sh,
        source
      });
    } else if (raw.type === 'text') {
      out.push({
        id: nextObjectId++,
        type: 'text',
        x: raw.x || 0,
        y: raw.y || 0,
        w: raw.w || 1,
        h: raw.h || 1,
        text: raw.text || '',
        fontSpec: raw.fontSpec || '16px sans-serif',
        fontSize: raw.fontSize || 16,
        color: raw.color || '#000000',
        family: raw.family || 'sans-serif',
        bold: !!raw.bold,
        italic: !!raw.italic,
        canvasX: raw.canvasX ?? raw.x ?? 0,
        canvasY: raw.canvasY ?? raw.y ?? 0,
        stretch: !!raw.stretch
      });
    }
  }
  return out;
}

function loadImageEl(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export function hitTestObject(objects, x, y) {
  // Topmost first (last in array)
  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i];
    if (o._hiddenWhileEdit) continue;
    if (x >= o.x && x <= o.x + o.w && y >= o.y && y <= o.y + o.h) return o;
  }
  return null;
}

export function findObject(objects, id) {
  return objects.find((o) => o.id === id) || null;
}

export function handlePoints(o) {
  return {
    nw: { x: o.x, y: o.y },
    ne: { x: o.x + o.w, y: o.y },
    sw: { x: o.x, y: o.y + o.h },
    se: { x: o.x + o.w, y: o.y + o.h }
  };
}

/** Canvas-space half-size for handle hit targets (~14px on screen, JS Paint-like). */
export function handleHalfSize(zoom = 1) {
  return Math.max(10, 14 / Math.max(0.25, zoom));
}

/** Hit-test resize handles of a selected object. `zoom` keeps handles screen-sized. */
export function hitTestHandle(obj, x, y, zoom = 1) {
  if (!obj) return null;
  const half = handleHalfSize(zoom);
  const pts = handlePoints(obj);
  for (const [name, p] of Object.entries(pts)) {
    if (x >= p.x - half && x <= p.x + half && y >= p.y - half && y <= p.y + half) {
      return name;
    }
  }
  return null;
}

export function handleCursor(handle) {
  if (handle === 'nw' || handle === 'se') return 'nwse-resize';
  if (handle === 'ne' || handle === 'sw') return 'nesw-resize';
  return 'default';
}

const MIN_OBJ = 12;

/**
 * Resize object from a corner handle.
 * @param {boolean} lockAspect  Shift (Drawings standard): keep width/height ratio
 */
export function resizeObjectFromHandle(obj, handle, px, py, start, lockAspect = false) {
  const aspect = start.w / Math.max(1, start.h);
  const fixedR = start.x + start.w;
  const fixedB = start.y + start.h;

  let left = start.x;
  let top = start.y;
  let right = fixedR;
  let bottom = fixedB;

  if (handle === 'se') {
    right = px;
    bottom = py;
  } else if (handle === 'sw') {
    left = px;
    bottom = py;
  } else if (handle === 'ne') {
    right = px;
    top = py;
  } else if (handle === 'nw') {
    left = px;
    top = py;
  }

  let w = right - left;
  let h = bottom - top;

  if (lockAspect) {
    const wantW = Math.abs(w);
    const wantH = Math.abs(h);
    if (wantW / aspect >= wantH) {
      const sw = Math.max(MIN_OBJ, wantW);
      w = (Math.sign(w) || 1) * sw;
      h = (Math.sign(h) || 1) * (sw / aspect);
    } else {
      const sh = Math.max(MIN_OBJ, wantH);
      h = (Math.sign(h) || 1) * sh;
      w = (Math.sign(w) || 1) * (sh * aspect);
    }
  }

  // Normalize to positive size anchored on the opposite corner
  let absW = Math.max(MIN_OBJ, Math.abs(w));
  let absH = Math.max(MIN_OBJ, Math.abs(h));
  if (handle === 'se') {
    left = start.x;
    top = start.y;
  } else if (handle === 'sw') {
    left = fixedR - absW;
    top = start.y;
  } else if (handle === 'ne') {
    left = start.x;
    top = fixedB - absH;
  } else {
    left = fixedR - absW;
    top = fixedB - absH;
  }

  if (obj.type === 'image') {
    obj.x = Math.round(left);
    obj.y = Math.round(top);
    obj.w = Math.round(absW);
    obj.h = Math.round(absH);
    return;
  }

  // Text
  if (lockAspect) {
    // Scale font with height (keeps glyph aspect); remeasure natural box
    const scale = absH / start.h;
    const newSize = Math.max(8, Math.round((start.fontSize || 16) * scale));
    const i = obj.italic ? 'italic ' : '';
    const b = obj.bold ? 'bold ' : '';
    obj.fontSize = newSize;
    obj.fontSpec = `${i}${b}${newSize}px ${obj.family || 'sans-serif'}`;
    obj.canvasX = start.canvasX ?? start.x;
    obj.canvasY = start.canvasY ?? start.y;
    const metrics = measureTextObject({
      text: obj.text,
      fontSpec: obj.fontSpec,
      fontSize: obj.fontSize,
      canvasX: obj.canvasX,
      canvasY: obj.canvasY
    });
    absW = metrics.w;
    absH = metrics.h;
    if (handle === 'se') {
      left = start.x;
      top = start.y;
    } else if (handle === 'sw') {
      left = fixedR - absW;
      top = start.y;
    } else if (handle === 'ne') {
      left = start.x;
      top = fixedB - absH;
    } else {
      left = fixedR - absW;
      top = fixedB - absH;
    }
    obj.x = Math.round(left);
    obj.y = Math.round(top);
    obj.w = Math.round(absW);
    obj.h = Math.round(absH);
    const m2 = measureTextObject({
      text: obj.text,
      fontSpec: obj.fontSpec,
      fontSize: obj.fontSize,
      canvasX: 0,
      canvasY: 0
    });
    obj.canvasX = obj.x + (m2.left || 0);
    obj.canvasY = obj.y - obj.fontSize + (m2.ascent || obj.fontSize * 0.8);
    obj.stretch = false;
    return;
  }

  // Free text resize: stretch the rendered glyphs to the box (non-uniform OK)
  obj.x = Math.round(left);
  obj.y = Math.round(top);
  obj.w = Math.round(absW);
  obj.h = Math.round(absH);
  obj.stretch = true;
  // Keep fillText anchors in sync for double-click edit positioning
  const m0 = measureTextObject({
    text: obj.text,
    fontSpec: obj.fontSpec,
    fontSize: obj.fontSize,
    canvasX: 0,
    canvasY: 0
  });
  obj.canvasX = obj.x + (m0.left || 0);
  obj.canvasY = obj.y - obj.fontSize + (m0.ascent || obj.fontSize * 0.8);
}

export function updateTextObject(obj, text, style) {
  obj.text = text;
  if (style) {
    if (style.fontSpec != null) obj.fontSpec = style.fontSpec;
    if (style.fontSize != null) obj.fontSize = style.fontSize;
    if (style.color != null) obj.color = style.color;
    if (style.family != null) obj.family = style.family;
    if (style.bold != null) obj.bold = style.bold;
    if (style.italic != null) obj.italic = style.italic;
  }
  // Keep top-left of previous box as canvas anchor for remeasure
  const metrics = measureTextObject({
    text: obj.text,
    fontSpec: obj.fontSpec,
    fontSize: obj.fontSize,
    canvasX: obj.canvasX,
    canvasY: obj.canvasY
  });
  obj.x = metrics.x;
  obj.y = metrics.y;
  obj.w = metrics.w;
  obj.h = metrics.h;
}

export function moveObject(obj, x, y) {
  const dx = x - obj.x;
  const dy = y - obj.y;
  obj.x = x;
  obj.y = y;
  if (obj.type === 'text') {
    obj.canvasX += dx;
    obj.canvasY += dy;
  }
}

/** Draw all objects onto the objects canvas. Selection outlines + handles on primary. */
export function renderObjects(canvas, objects, selectedIds, zoom = 1) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const o of objects) {
    if (o._hiddenWhileEdit) continue;
    if (o.type === 'image') {
      ctx.drawImage(o.source, o.x, o.y, o.w, o.h);
    } else if (o.type === 'text') {
      ctx.save();
      ctx.fillStyle = o.color;
      ctx.textBaseline = 'alphabetic';
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.font = o.fontSpec;
      if (o.stretch) {
        const nat = measureTextObject({
          text: o.text,
          fontSpec: o.fontSpec,
          fontSize: o.fontSize,
          canvasX: 0,
          canvasY: 0
        });
        const sx = o.w / Math.max(1, nat.w);
        const sy = o.h / Math.max(1, nat.h);
        ctx.translate(o.x, o.y);
        ctx.scale(sx, sy);
        ctx.translate(-nat.x, -nat.y);
        ctx.fillText(o.text, 0, o.fontSize);
      } else {
        ctx.fillText(o.text, o.canvasX, o.canvasY + o.fontSize);
      }
      ctx.restore();
    }
  }
  const ids = normalizeSelectedIds(selectedIds);
  if (!ids.length) return;
  const primaryId = ids[ids.length - 1];
  for (const id of ids) {
    const sel = findObject(objects, id);
    if (sel) drawObjectOutline(ctx, sel, zoom, id === primaryId && ids.length === 1);
  }
}

function normalizeSelectedIds(selectedIds) {
  if (selectedIds == null) return [];
  if (Array.isArray(selectedIds)) return selectedIds.filter((id) => id != null);
  return [selectedIds];
}

/** Axis-aligned bounds of objects (for multi-select status / marquee). */
export function objectsBounds(objects) {
  if (!objects?.length) return null;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const o of objects) {
    minX = Math.min(minX, o.x);
    minY = Math.min(minY, o.y);
    maxX = Math.max(maxX, o.x + o.w);
    maxY = Math.max(maxY, o.y + o.h);
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Objects whose boxes intersect the marquee rect. */
export function objectsIntersectingRect(objects, x0, y0, x1, y1) {
  const left = Math.min(x0, x1);
  const top = Math.min(y0, y1);
  const right = Math.max(x0, x1);
  const bottom = Math.max(y0, y1);
  return objects.filter((o) => {
    if (o._hiddenWhileEdit) return false;
    return !(o.x + o.w < left || o.x > right || o.y + o.h < top || o.y > bottom);
  });
}

function drawObjectOutline(ctx, o, zoom = 1, showHandles = true) {
  ctx.save();
  ctx.strokeStyle = '#1a73e8';
  ctx.lineWidth = 1 / Math.max(0.25, zoom);
  ctx.setLineDash([]);
  ctx.strokeRect(o.x + 0.5, o.y + 0.5, o.w, o.h);
  if (!showHandles) {
    ctx.restore();
    return;
  }
  // Keep handles ~10–12px on screen regardless of zoom
  const hs = Math.max(10, 12 / Math.max(0.25, zoom));
  const pts = handlePoints(o);
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#1a73e8';
  for (const p of Object.values(pts)) {
    ctx.fillRect(p.x - hs / 2, p.y - hs / 2, hs, hs);
    ctx.strokeRect(p.x - hs / 2 + 0.5, p.y - hs / 2 + 0.5, hs, hs);
  }
  ctx.restore();
}

/** Composite objects onto a 2d context (for export / flatten). */
export function drawObjectsOnto(ctx, objects) {
  for (const o of objects) {
    if (o.type === 'image') {
      ctx.drawImage(o.source, o.x, o.y, o.w, o.h);
    } else if (o.type === 'text') {
      ctx.save();
      ctx.font = o.fontSpec;
      ctx.fillStyle = o.color;
      ctx.textBaseline = 'alphabetic';
      if (o.stretch) {
        const nat = measureTextObject({
          text: o.text,
          fontSpec: o.fontSpec,
          fontSize: o.fontSize,
          canvasX: 0,
          canvasY: 0
        });
        const sx = o.w / Math.max(1, nat.w);
        const sy = o.h / Math.max(1, nat.h);
        ctx.translate(o.x, o.y);
        ctx.scale(sx, sy);
        ctx.translate(-nat.x, -nat.y);
        ctx.fillText(o.text, 0, o.fontSize);
      } else {
        ctx.fillText(o.text, o.canvasX, o.canvasY + o.fontSize);
      }
      ctx.restore();
    }
  }
}

export function resizeObjectsCanvas(canvas, w, h) {
  canvas.width = w;
  canvas.height = h;
}

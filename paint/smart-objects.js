// Smart objects (PhotoCraft Layer › Smart Objects, engine smart_cmds.rs). A smart layer is a
// layer record with kind 'smart' and layer.smart = { source, layers, transform }:
//   source     the contents' composite, { width, height, data } RGBA bytes in source pixels
//   layers     the contents bottom to top ({ name, opacity, visible, blendMode, clipped, styles,
//              data }), also in source pixels; Convert to Layers unpacks them
//   transform  the placement, a 3x3 homography [m0..m8] row-major from source pixels to document
//              pixels (transform.js applyHomography)
// The layer's canvas is always rendered from source through transform, so Free Transform edits
// the transform and scaling down then up again brings the source pixels back exactly. Source
// buffers are never written after they are made, so copies of a smart object share them.

import {
  freeTransformAffine,
  homographyCorners,
  quadHomography,
  transformImageData,
  warpQuad
} from './transform.js';
import { compositeTreeBytes, isPixelSafeTool } from './layer-groups.js';
import { cloneStyles } from './layer-style.js';
import { createLayer } from './layer-shell.js';

export const SMART_KIND = 'smart';

export function isSmartLayer(layer) {
  return layer?.kind === SMART_KIND && !!layer.smart;
}

/**
 * The status note when a tool would paint on a smart object's pixels (they are rendered from its
 * source, so the stroke would not last), or null. Rasterize it first, as PhotoCraft asks.
 */
export function smartToolRefusal(layer, toolId, label = toolId) {
  if (!isSmartLayer(layer) || isPixelSafeTool(toolId)) return null;
  return `Could not use the ${label}: the target layer is a smart object`;
}

export const IDENTITY_HOMOGRAPHY = Object.freeze([1, 0, 0, 0, 1, 0, 0, 0, 1]);

export function translation(dx, dy) {
  return [1, 0, dx, 0, 1, dy, 0, 0, 1];
}

/** A canvas-order affine [a, b, c, d, e, f] (transform.js) as a homography. */
export function affineHomography([a, b, c, d, e, f]) {
  return [a, c, e, b, d, f, 0, 0, 1];
}

/** A · B: B first, then A. */
export function multiplyHomography(A, B) {
  const out = new Array(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c];
    }
  }
  return out;
}

// Normalised so m8 is 1, and values within 1e-9 of an integer snapped to it: a scale and its
// inverse compose back to a plain whole-pixel placement.
function tidy(m) {
  const k = m[8] || 1;
  return m.map((v) => {
    const x = v / k;
    const r = Math.round(x);
    return Math.abs(x - r) < 1e-9 ? r : x;
  });
}

/** [dx, dy] when m is a whole-pixel move with no scale, turn, or perspective, else null. */
export function wholePixelOffset(m) {
  const t = tidy(m);
  const unit = t[0] === 1 && t[1] === 0 && t[3] === 0 && t[4] === 1 && t[6] === 0 && t[7] === 0;
  return unit && Number.isInteger(t[2]) && Number.isInteger(t[5]) ? [t[2], t[5]] : null;
}

/** A copy that shares the (immutable) source and contents pixels. */
export function cloneSmart(smart) {
  if (!smart) return null;
  return {
    source: smart.source,
    layers: smart.layers.map((l) => ({ ...l, styles: cloneStyles(l.styles) })),
    transform: smart.transform.slice()
  };
}

/** The smart object placed through the document-space homography m after its own transform. */
export function transformSmart(smart, m) {
  return { ...cloneSmart(smart), transform: tidy(multiplyHomography(m, smart.transform)) };
}

/** The placed contents' bounds in document pixels ({ x, y, w, h }, not rounded). */
export function smartBounds(smart) {
  const box = { x: 0, y: 0, w: smart.source.width, h: smart.source.height };
  const corners = homographyCorners(box, smart.transform);
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/**
 * A Free Transform box as a document homography: the quad when the box was skewed, distorted,
 * or given perspective, else the affine t about box (transform.js freeTransformAffine).
 */
export function freeTransformHomography(box, t, quad = null) {
  return quad ? quadHomography(box, quad) : affineHomography(freeTransformAffine(box, t));
}

function bytesBounds(data, W, H) {
  let x0 = W,
    y0 = H,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!data[(y * W + x) * 4 + 3]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

function cropBytes(data, W, box) {
  const out = new Uint8ClampedArray(box.w * box.h * 4);
  for (let y = 0; y < box.h; y++) {
    const s = ((box.y + y) * W + box.x) * 4;
    out.set(data.subarray(s, s + box.w * 4), y * box.w * 4);
  }
  return out;
}

/**
 * Layer › Smart Objects › Convert to Smart Object (smart_cmds.rs layers_to_smart): records are
 * the layers bottom to top, each { name, opacity, visible, blendMode, clipped, styles, data } with
 * W x H RGBA bytes (masks already applied). The contents are cropped to the composite's opaque
 * bounds and placed there by a whole-pixel transform. null when nothing is opaque.
 */
export function smartFromLayers(records, W, H) {
  const stack = records.map((r, i) => ({
    id: i + 1,
    kind: 'pixel',
    parentId: null,
    name: r.name,
    opacity: r.opacity ?? 1,
    visible: r.visible !== false,
    blendMode: r.blendMode || 'source-over',
    clipped: r.clipped === true,
    styles: cloneStyles(r.styles),
    mask: null,
    data: r.data
  }));
  const composite = compositeTreeBytes(stack, W, H);
  const box = bytesBounds(composite, W, H);
  if (!box) return null;
  return {
    source: { width: box.w, height: box.h, data: cropBytes(composite, W, box) },
    layers: stack.map((l) => ({
      name: l.name,
      opacity: l.opacity,
      visible: l.visible,
      blendMode: l.blendMode,
      clipped: l.clipped,
      styles: l.styles,
      width: box.w,
      height: box.h,
      data: cropBytes(l.data, W, box)
    })),
    transform: translation(box.x, box.y)
  };
}

/**
 * src ({ width, height, data } in source pixels) through the homography m onto a new W x H
 * image. A whole-pixel placement copies the bytes exactly; an affine one samples bilinearly
 * (transform.js transformImageData), anything else through the quad warp.
 */
export function placePixels(src, m, W, H) {
  const off = wholePixelOffset(m);
  if (off) {
    const out = new Uint8ClampedArray(W * H * 4);
    const [dx, dy] = off;
    const x0 = Math.max(0, dx);
    const x1 = Math.min(W, dx + src.width);
    if (x1 <= x0) return { width: W, height: H, data: out };
    for (let y = Math.max(0, dy); y < Math.min(H, dy + src.height); y++) {
      const s = ((y - dy) * src.width + (x0 - dx)) * 4;
      out.set(src.data.subarray(s, s + (x1 - x0) * 4), (y * W + x0) * 4);
    }
    return { width: W, height: H, data: out };
  }
  const t = tidy(m);
  const box = { x: 0, y: 0, w: src.width, h: src.height };
  if (t[6] === 0 && t[7] === 0) {
    return transformImageData(src, box, [t[0], t[3], t[1], t[4], t[2], t[5]], W, H);
  }
  return warpQuad(src, homographyCorners(box, t), W, H, box);
}

/** The smart object's pixels on a W x H document. */
export function renderSmart(smart, W, H) {
  return placePixels(smart.source, smart.transform, W, H);
}

/**
 * Layer › Smart Objects › Convert to Layers (smart_cmds/unpack.rs): the contents as W x H layer
 * records at the placement, bottom to top. One layer replaces the smart object; the caller
 * puts several in a group named after it.
 */
export function unpackSmart(smart, W, H) {
  return smart.layers.map((l) => ({
    name: l.name,
    opacity: l.opacity,
    visible: l.visible,
    blendMode: l.blendMode,
    clipped: l.clipped,
    styles: cloneStyles(l.styles),
    data: placePixels(l, smart.transform, W, H).data
  }));
}

/** .paintproj form: pixel buffers go through encode(image) → string (a PNG data URL). */
export function smartToJSON(smart, encode) {
  return {
    source: encode(smart.source),
    layers: smart.layers.map(({ data, width, height, ...rest }) => ({
      ...rest,
      styles: cloneStyles(rest.styles),
      image: encode({ width, height, data })
    })),
    transform: smart.transform.slice()
  };
}

/** The saved form back; decode(string) resolves to { width, height, data }. null if unusable. */
export async function smartFromJSON(json, decode) {
  const t = json?.transform;
  if (!json?.source || !Array.isArray(t) || t.length !== 9 || !t.every(Number.isFinite)) {
    return null;
  }
  const source = await decode(json.source);
  const saved = Array.isArray(json.layers) ? json.layers : [];
  const layers = await Promise.all(
    saved.map(async (l) => {
      const img = l.image ? await decode(l.image) : source;
      return {
        name: typeof l.name === 'string' ? l.name : 'Layer',
        opacity: typeof l.opacity === 'number' ? l.opacity : 1,
        visible: l.visible !== false,
        blendMode: l.blendMode || 'source-over',
        clipped: l.clipped === true,
        styles: cloneStyles(l.styles),
        width: img.width,
        height: img.height,
        data: img.data
      };
    })
  );
  if (!layers.length) {
    layers.push({
      name: 'Layer 1',
      opacity: 1,
      visible: true,
      blendMode: 'source-over',
      clipped: false,
      styles: null,
      width: source.width,
      height: source.height,
      data: source.data
    });
  }
  return { source, layers, transform: t.slice() };
}

/** A smart object layer: its canvas renders from layer.smart. */
export function createSmartLayer(name, smart, w, h) {
  const layer = createLayer(name, w, h);
  layer.kind = 'smart';
  layer.smart = cloneSmart(smart);
  renderSmartLayer(layer);
  return layer;
}

/** Redraw a smart layer's canvas from its source through its transform. */
export function renderSmartLayer(layer) {
  if (!isSmartLayer(layer)) return;
  const { width, height } = layer.canvas;
  const img = layer.ctx.createImageData(width, height);
  img.data.set(renderSmart(layer.smart, width, height).data);
  layer.ctx.putImageData(img, 0, 0);
  layer.smartSize = [width, height];
}

/** Re-render every smart layer whose canvas changed size since it was drawn. */
export function refreshSmartLayers(layers) {
  for (const layer of layers) {
    if (!isSmartLayer(layer)) continue;
    const [w, h] = layer.smartSize ?? [];
    if (w !== layer.canvas.width || h !== layer.canvas.height) renderSmartLayer(layer);
  }
}

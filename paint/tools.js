// Tool registry — each entry is { label, icon, cursor, options?, onDown, onMove, onUp }.
// icon is a name in ICONS (paint/icons.js).
// All hooks: (ctx, overlayCtx, state, x, y, isRightClick)

import {
  buildBoundaryPixels,
  commitToolSelection,
  ellipseMask,
  featherMask,
  isInsideSelection,
  maskBBox,
  resolveSelectionMode,
  selectionToFullMask
} from './selection.js';
import {
  GRADIENT_PRESET_GROUPS,
  resolvePresetOpacity,
  resolvePresetStops
} from './gradient-presets.js';
import { hexToUnit } from './gradient-stops.js';
import {
  DEFAULT_CUSTOM_SHAPE,
  STROKE_ALIGNS,
  customShapeNames,
  renderShape,
  shapeFromDrag,
  tracePath
} from './shapes.js';
import {
  edgeMap,
  liveWire,
  magneticSpacing,
  pathLength,
  quickSelectDab,
  snapToEdge
} from './smart-select.js';
import {
  CROP_CLEAR,
  CROP_FRONT,
  CROP_HANDLE_PX,
  CROP_RATIOS,
  CROP_SIZE_PRESETS,
  cropChosen,
  cropCursor,
  cropDefaultFrame,
  cropDraw,
  cropFittedRatio,
  cropHitTurned,
  cropRatio,
  cropResizedTurned,
  cropSwapped,
  cropSwappedRatio,
  cropTargetSize,
  cropTurnedAngle,
  CROP_OVERLAY_SHOW,
  CROP_OVERLAYS,
  CROP_WXH,
  CROP_SHIELD_DEFAULTS,
  cropGuides,
  cropNextOverlay,
  cropOverlayOrientations,
  cropOverlayShows,
  cropShieldFill,
  CROP_STRAIGHTEN_MIN_PX,
  cropAngleReadout,
  cropFrameSize,
  cropStraightenAngle,
  cropStraightenFitted,
  drawCropOverlay
} from './crop-frame.js';
import { BLEND_MODES } from './layers.js';
import {
  checkerPattern,
  cloneDab,
  cloneStrokeOffset,
  colorDab,
  blendRgb,
  colorReplaceDab,
  backgroundEraseDab,
  hotspotColor,
  coverageDab,
  dodgeBurn,
  eraseDab,
  eraseSquareDab,
  paintTipDab,
  pencilDab,
  autoEraseColor,
  focusDab,
  healStroke,
  historyDab,
  localBlur,
  localSharpen,
  mixerBeginStroke,
  mixerDab,
  mixerEndStroke,
  mixerState,
  patchHeal,
  patchPreview,
  patternDab,
  redEyeFix,
  samplePre,
  smudgeDab,
  smudgeStroke,
  spotHealStroke,
  sponge,
  toneDab
} from './retouch.js';
import { brushSettingsOf, dabBuilder, pathWalker, strokeSeed } from './brush-dynamics.js';
import { applyHomography, convexQuad, homographyFromQuad } from './transform.js';
import { measurementScaleFactor } from './measurement.js';
import { cloneSampler, isIdentityTransform } from './clone-source.js';
import { isBackgroundLayer } from './layer-new.js';
import { transparencyLocked } from './layer-locks.js';
import { paragraphBoxFromDrag } from './type-layers.js';
import { curvatureAnchors, freeformSubpath } from './pen-variants.js';
import {
  addAnchor,
  anchorsInBox,
  bendSegment,
  convertPoint,
  deleteAnchor,
  drawPathOverlay,
  emptyPath,
  emptyPaths,
  hitPath,
  moveAnchors,
  moveHandle,
  moveSubpaths,
  penDrag,
  penPress,
  shownHandles,
  subpathAnchors,
  subpathAt,
  targetPath,
  withTargetPath
} from './paths.js';
import {
  addCountMarker,
  clearCount,
  countTotal,
  drawCountMarkers,
  moveCountMarker,
  nearestCountMarker,
  removeCountMarker
} from './count.js';
import {
  MAX_SAMPLERS,
  SAMPLER_SIZES,
  addSampler,
  drawSamplerMarkers,
  moveSampler,
  nearestSampler,
  removeSampler
} from './samplers.js';
import { NOTE_COLOR, addNote, drawNoteMarkers, noteAt, noteLabel, setNote } from './notes.js';

export { TOOL_GROUPS, TOOL_KEYS, toolForKey, toolGroupIndex, toolKey } from './tool-groups.js';
export { DEFAULT_MEASUREMENT_SCALE, measurementScaleFactor } from './measurement.js';

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
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

// Paint Bucket composite (PhotoCraft bucket_fill_region / bucket_fill_src): source-over the fill
// at opacity / 100 into dst wherever region[p] is 1. src is a '#rrggbb' color (Fill: Foreground)
// or a pattern tile { width, height, data } repeated from the document origin (Fill: Pattern).
// The region comes from floodSelectImage, the Magic Wand's matcher, so bucket and wand pick the
// same pixels. region may also be a Float32Array coverage (antialiasCoverage) that scales the
// opacity per pixel.
export function bucketFillImage(dst, region, src, opacity = 100) {
  const d = dst.data;
  const W = dst.width;
  const tile = typeof src === 'string' ? null : src;
  const solid = tile ? null : hexToRgba(src);
  const a = Math.max(0, Math.min(100, opacity)) / 100;
  if (a <= 0) return;
  for (let p = 0; p < region.length; p++) {
    if (!region[p]) continue;
    const pa = a * region[p];
    const i = p * 4;
    let fr, fg, fb;
    if (tile) {
      const t = ((Math.floor(p / W) % tile.height) * tile.width + ((p % W) % tile.width)) * 4;
      fr = tile.data[t];
      fg = tile.data[t + 1];
      fb = tile.data[t + 2];
    } else {
      [fr, fg, fb] = solid;
    }
    const da = d[i + 3] / 255;
    const k = da * (1 - pa);
    const outA = pa + k;
    d[i] = Math.round((fr * pa + d[i] * k) / outA);
    d[i + 1] = Math.round((fg * pa + d[i + 1] * k) / outA);
    d[i + 2] = Math.round((fb * pa + d[i + 2] * k) / outA);
    d[i + 3] = Math.round(outA * 255);
  }
}

// Magic Eraser (PhotoCraft erase.rs magic_erase over wand_region). The region around (x, y) in
// sample (the layer, or the visible composite for Sample All Layers) comes from floodSelectImage;
// Anti-alias softens its edge with antialiasCoverage, quantized to bytes like the wand's mask.
// Each covered pixel keeps its colour and its alpha is multiplied by 1 − coverage × opacity / 100
// × selMask[p]; a fully erased pixel becomes transparent black. Returns the erased pixel count,
// or 0 when (x, y) is off the canvas.
export function magicEraseImage(dst, sample, x, y, opts = {}, selMask = null) {
  const W = dst.width,
    H = dst.height;
  const region = floodSelectImage(sample, x, y, opts.tolerance ?? 32, opts.contiguous !== false);
  if (!region) return 0;
  const cover = opts.antiAlias !== false ? antialiasCoverage(region.mask, W, H) : region.mask;
  const amount = Math.max(1, Math.min(100, opts.opacity ?? 100)) / 100;
  const d = dst.data;
  let n = 0;
  for (let p = 0; p < W * H; p++) {
    const c = Math.round(cover[p] * 255);
    if (!c || (selMask && !selMask[p])) continue;
    const k = (c / 255) * amount;
    const i = p * 4;
    const a = d[i + 3] * (1 - k);
    if (k >= 1 || a <= 0) d.fill(0, i, i + 4);
    else d[i + 3] = Math.round(a);
    n++;
  }
  return n;
}

// PhotoCraft selection.rs antialias: a soft fringe on a 0/1 mask. A pixel whose 3 x 3
// neighbourhood (off-canvas neighbours read as the pixel itself) differs from it becomes
// 0.5 + 0.5 * mean when selected, 0.5 * mean when not; other pixels keep 0 or 1.
export function antialiasCoverage(mask, W, H) {
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const self = mask[i] ? 1 : 0;
      let sum = 0;
      let edge = false;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          const v = xx < 0 || yy < 0 || xx >= W || yy >= H ? self : mask[yy * W + xx] ? 1 : 0;
          if (v !== self) edge = true;
          sum += v;
        }
      }
      out[i] = edge ? (self ? 0.5 + (0.5 * sum) / 9 : (0.5 * sum) / 9) : self;
    }
  }
  return out;
}

// BFS selection on a canvas context — see floodSelectImage.
export function floodSelect(ctx, startX, startY, tolerance = 32, contiguous = true) {
  const { width, height } = ctx.canvas;
  return floodSelectImage(
    ctx.getImageData(0, 0, width, height),
    startX,
    startY,
    tolerance,
    contiguous
  );
}

// BFS selection over an ImageData-like { width, height, data } — returns a Uint8Array mask
// (1 = selected, matching pixels only) and bounding box, or null off-canvas.
// When contiguous=false, selects ALL matching pixels regardless of connectivity.
export function floodSelectImage(img, startX, startY, tolerance = 32, contiguous = true) {
  const W = img.width,
    H = img.height;
  const d = img.data;
  const sx = Math.round(startX),
    sy = Math.round(startY);
  if (sx < 0 || sx >= W || sy < 0 || sy >= H) return null;

  const base = (sy * W + sx) * 4;
  const tr = d[base],
    tg = d[base + 1],
    tb = d[base + 2],
    ta = d[base + 3];
  const mask = new Uint8Array(W * H);
  let minX = sx,
    maxX = sx,
    minY = sy,
    maxY = sy;

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
        const px = i % W,
          py = (i / W) | 0;
        if (!any) {
          minX = maxX = px;
          minY = maxY = py;
          any = true;
        } else {
          if (px < minX) minX = px;
          if (px > maxX) maxX = px;
          if (py < minY) minY = py;
          if (py > maxY) maxY = py;
        }
      }
    }
    if (!any) return null;
    return { mask, x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  }

  // seen marks queued pixels; mask gets only the ones that pass matches().
  const seen = new Uint8Array(W * H);
  const stack = [sx + sy * W];
  seen[sx + sy * W] = 1;

  while (stack.length) {
    const idx = stack.pop();
    if (!matches(idx * 4)) continue;
    mask[idx] = 1;

    const px = idx % W,
      py = (idx / W) | 0;
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;

    if (px > 0 && !seen[idx - 1]) {
      seen[idx - 1] = 1;
      stack.push(idx - 1);
    }
    if (px < W - 1 && !seen[idx + 1]) {
      seen[idx + 1] = 1;
      stack.push(idx + 1);
    }
    if (py > 0 && !seen[idx - W]) {
      seen[idx - W] = 1;
      stack.push(idx - W);
    }
    if (py < H - 1 && !seen[idx + W]) {
      seen[idx + W] = 1;
      stack.push(idx + W);
    }
  }

  return { mask, x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/**
 * Fill imgData with a linear gradient from hex0 at (x0, y0) to hex1 at (x1, y1): the two-stop
 * case of fillLinearGradientStops.
 */
export function fillLinearGradient(imgData, x0, y0, x1, y1, hex0, hex1, mask) {
  return fillLinearGradientStops(
    imgData,
    x0,
    y0,
    x1,
    y1,
    [
      [0, hex0],
      [1, hex1]
    ],
    mask
  );
}

// The Gradient tool's Shape values (PhotoCraft algo paint.rs GradientShape).
export const GRADIENT_SHAPES = ['linear', 'radial', 'angle', 'reflected', 'diamond'];

/**
 * PhotoCraft tool_gradient_t: the gradient parameter at (x, y) for a drag from (x0, y0) to
 * (x1, y1), clamped to 0..1. along / across are the point's coordinates on the drag axis.
 */
export function gradientToolT(shape, x0, y0, x1, y1, x, y) {
  const dx = x1 - x0,
    dy = y1 - y0;
  const len = Math.max(Math.hypot(dx, dy), 1e-6);
  const ux = dx / len,
    uy = dy / len;
  const px = x - x0,
    py = y - y0;
  const along = px * ux + py * uy;
  const across = -px * uy + py * ux;
  let t;
  if (shape === 'radial') t = Math.hypot(px, py) / len;
  else if (shape === 'reflected') t = Math.abs(along) / len;
  else if (shape === 'diamond') t = (Math.abs(along) + Math.abs(across)) / len;
  else if (shape === 'angle') {
    t = Math.atan2(across, along) / (2 * Math.PI);
    t -= Math.floor(t);
  } else t = along / len;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/**
 * PhotoCraft color lib.rs dither_noise: a u32 hash of (x, y) mapped to 0..1, the Gradient
 * tool's Dither noise.
 */
export function ditherNoise(x, y) {
  let h = (Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca77)) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  h = (h ^ (h >>> 12)) >>> 0;
  return Math.fround((h & 0xffff) / 65535);
}

/**
 * Fill imgData with a gradient over resolved [location, '#rrggbb'] stops (sampleStops in
 * paint/gradient-stops.js) from (x0, y0) to (x1, y1). shape is a GRADIENT_SHAPES value
 * (default 'linear'): linear projects each pixel center onto the segment; the others take t
 * from gradientToolT. t clamps to 0..1 and the color is sampleStops(stops, t) mixed in byte
 * space. At full alpha writes opaque pixels; skips pixels where mask[p] is 0. Returns false (and changes
 * nothing) for a zero-length segment. options.reverse samples the stops at 1 - t;
 * options.dither adds ditherNoise(x, y) - 0.5 of one 8-bit step to each RGB channel before
 * rounding (PhotoCraft algo paint.rs fill_gradient). options.mode is a BLEND_MODES value
 * (default 'source-over'); other modes composite through blendRgb with PhotoCraft blend.rs
 * composite: αo = αs + αb(1 − αs), αo·Co = (1 − αs)·αb·Cb + (1 − αb)·αs·Cs + αs·αb·B(Cb, Cs).
 * options.alphaStops are [location, alpha 0..1] opacity stops (default null = opaque): the
 * source alpha at t is their lerp at the same (reversed) t, times opacity.
 */
export function fillLinearGradientStops(
  imgData,
  x0,
  y0,
  x1,
  y1,
  stops,
  mask,
  shape = 'linear',
  options = {}
) {
  const { reverse = false, dither = false, opacity = 1, mode = 'source-over' } = options;
  const blend = mode !== 'source-over' && BLEND_MODES.some((m) => m.value === mode);
  // Below full opacity each pixel is composited source-over (straight alpha) onto what is there.
  const a0 = opacity < 0 ? 0 : opacity > 1 ? 1 : opacity;
  // All-opaque alpha stops are dropped so the fill stays byte-identical to one without them.
  const os = options.alphaStops?.some(([, v]) => v < 1)
    ? options.alphaStops.map(([t, v]) => [t, v < 0 ? 0 : v > 1 ? 1 : v]).sort((p, q) => p[0] - q[0])
    : null;
  const alphaAt = (t) => {
    if (t <= os[0][0]) return os[0][1];
    for (let s = 1; s < os.length; s++) {
      if (t > os[s][0]) continue;
      const [ta, va] = os[s - 1],
        [tb, vb] = os[s];
      return tb > ta ? va + ((vb - va) * (t - ta)) / (tb - ta) : vb;
    }
    return os[os.length - 1][1];
  };
  const dx = x1 - x0,
    dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return false;
  const { width: W, height: H, data: d } = imgData;
  const st = stops
    .map(([t, c]) => [t, ...hexToUnit(c).map((v) => Math.round(v * 255))])
    .sort((a, b) => a[0] - b[0]);
  const last = st.length - 1;
  const rgb = [0, 0, 0];
  const linear = !GRADIENT_SHAPES.includes(shape) || shape === 'linear';
  // gradientMapColor's lookup: the first stop at or before its location, the last past it.
  const sample = (t) => {
    let s = 1;
    while (s < last && t > st[s][0]) s++;
    if (last === 0 || t <= st[0][0]) return st[0].slice(1);
    if (t > st[last][0]) return st[last].slice(1);
    const a = st[s - 1],
      b = st[s];
    const k = b[0] > a[0] ? (t - a[0]) / (b[0] - a[0]) : 0;
    for (let c = 0; c < 3; c++) rgb[c] = a[c + 1] + (b[c + 1] - a[c + 1]) * k;
    return rgb;
  };
  for (let y = 0; y < H; y++) {
    const py = y + 0.5 - y0;
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (mask && !mask[p]) continue;
      let t;
      if (linear) {
        t = ((x + 0.5 - x0) * dx + py * dy) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
      } else t = gradientToolT(shape, x0, y0, x1, y1, x + 0.5, y + 0.5);
      const u = reverse ? 1 - t : t;
      const c = sample(u);
      const a = os ? a0 * alphaAt(u) : a0;
      const n = dither ? ditherNoise(x, y) - 0.5 : 0;
      const i = p * 4;
      if (blend) {
        if (a <= 0) continue;
        const ab = d[i + 3] / 255;
        const ao = a + ab * (1 - a);
        const cb = [d[i] / 255, d[i + 1] / 255, d[i + 2] / 255];
        const cs = [0, 0, 0];
        for (let k = 0; k < 3; k++) {
          const v = c[k] + n;
          cs[k] = (v < 0 ? 0 : v > 255 ? 255 : v) / 255;
        }
        const b = blendRgb(mode, cb, cs);
        for (let k = 0; k < 3; k++) {
          const pre = (1 - a) * ab * cb[k] + (1 - ab) * a * cs[k] + a * ab * b[k];
          d[i + k] = Math.round((pre / ao) * 255);
        }
        d[i + 3] = Math.round(ao * 255);
        continue;
      }
      if (a >= 1) {
        for (let k = 0; k < 3; k++) {
          const v = c[k] + n;
          d[i + k] = Math.round(v < 0 ? 0 : v > 255 ? 255 : v);
        }
        d[i + 3] = 255;
        continue;
      }
      const da = d[i + 3] / 255;
      const keep = da * (1 - a);
      const oa = a + keep;
      if (oa <= 0) continue;
      for (let k = 0; k < 3; k++) {
        let v = c[k] + n;
        v = v < 0 ? 0 : v > 255 ? 255 : v;
        d[i + k] = Math.round((v * a + d[i + k] * keep) / oa);
      }
      d[i + 3] = Math.round(oa * 255);
    }
  }
  return true;
}

// The Gradient tool's Preset values: 'group/preset' names in GRADIENT_PRESET_GROUPS. The first,
// Basics/Foreground to Background, is the default.
const GRADIENT_PRESET_OPTIONS = GRADIENT_PRESET_GROUPS.flatMap((g) =>
  g.presets.map((p) => ({ value: `${g.name}/${p.name}`, label: p.name, group: g.name, preset: p }))
);

/** The preset a Gradient tool Preset value names; unknown values fall back to the first. */
export function gradientToolPreset(value) {
  for (const g of GRADIENT_PRESET_GROUPS) {
    for (const p of g.presets) if (`${g.name}/${p.name}` === value) return p;
  }
  return GRADIENT_PRESET_GROUPS[0].presets[0];
}

function drawGradientPreview(ov, x0, y0, x1, y1) {
  ov.clearRect(0, 0, ov.canvas.width, ov.canvas.height);
  ov.lineWidth = 1;
  ov.setLineDash([4, 4]);
  ov.strokeStyle = '#000';
  ov.beginPath();
  ov.moveTo(x0, y0);
  ov.lineTo(x1, y1);
  ov.stroke();
  ov.strokeStyle = '#fff';
  ov.lineDashOffset = 4;
  ov.stroke();
  ov.lineDashOffset = 0;
  ov.setLineDash([]);
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

// Screen pixels within which a click on the first vertex closes a polygonal lasso.
const POLY_CLOSE_RADIUS = 6;

function drawPolyPreview(ov, path, x, y) {
  ov.clearRect(0, 0, ov.canvas.width, ov.canvas.height);
  ov.strokeStyle = '#fff';
  ov.lineWidth = 1;
  ov.setLineDash([4, 4]);
  ov.beginPath();
  ov.moveTo(path[0][0], path[0][1]);
  for (const [px, py] of path) ov.lineTo(px, py);
  ov.lineTo(x, y);
  ov.stroke();
  ov.setLineDash([]);
}

function drawPenPreview(ov, state, rubber) {
  ov.clearRect(0, 0, ov.canvas.width, ov.canvas.height);
  drawPathOverlay(ov, targetPath(state.paths), 1 / (state.zoom || 1), rubber);
}

// Screen px within which the path tools hit an anchor, handle, or segment.
const PATH_HIT_PX = 6;

// The path tools edit the targeted path (or the Work Path); a label pushes one undo row first.
function setTargetPath(state, path, label) {
  state.setPaths?.(withTargetPath(state.paths ?? emptyPaths(), path), label);
  if (!state.setPaths) state.paths = withTargetPath(state.paths ?? emptyPaths(), path);
}

// The targeted path with its selected anchors' handles, plus a Direct Selection marquee.
function drawPathEdit(ov, state) {
  const px = 1 / (state.zoom || 1);
  ov.clearRect(0, 0, ov.canvas.width, ov.canvas.height);
  drawPathOverlay(ov, targetPath(state.paths), px, null, state.pathAnchors ?? []);
  const box = state.pathDrag?.box;
  if (box) {
    ov.save();
    ov.lineWidth = px;
    ov.strokeStyle = '#378ef0';
    ov.setLineDash([4 * px, 4 * px]);
    ov.strokeRect(box[0], box[1], box[2] - box[0], box[3] - box[1]);
    ov.restore();
  }
}

// The Freeform Pen's trace so far, over the targeted path.
function drawFreeformPreview(ov, state) {
  drawPenPreview(ov, state, null);
  const trace = state.pen?.trace;
  if (!trace?.length) return;
  ov.save();
  ov.strokeStyle = '#378ef0';
  ov.lineWidth = 1 / (state.zoom || 1);
  ov.beginPath();
  ov.moveTo(trace[0][0], trace[0][1]);
  for (const [x, y] of trace.slice(1)) ov.lineTo(x, y);
  ov.stroke();
  ov.restore();
}

// Index of the Curvature Pen point within tol of (x, y), nearest first, or -1.
function curvaturePointAt(points, x, y, tol) {
  let best = -1,
    bestD = tol;
  points.forEach(([px, py], i) => {
    const d = Math.hypot(px - x, py - y);
    if (d < bestD) {
      best = i;
      bestD = d;
    }
  });
  return best;
}

// Write the Curvature Pen's points as the targeted path's last subpath (appended on the first
// press). A label pushes an undo row first.
function setCurvatureSubpath(state, pen, closed, label) {
  const paths = state.paths ?? emptyPaths();
  const path = targetPath(paths) ?? emptyPath();
  const sp = { closed, anchors: curvatureAnchors(pen.points, pen.corners, closed) };
  const subpaths = pen.started ? [...path.subpaths.slice(0, -1), sp] : [...path.subpaths, sp];
  pen.started = true;
  state.setPaths?.(withTargetPath(paths, { ...path, subpaths }), label);
}

// Pressure scales between 30%..100% of base size for stylus input,
// and is a no-op (1.0) for mouse/touch.
function pressureSize(state, baseSize) {
  const p = state.pressure ?? 1;
  if (p >= 1) return baseSize;
  return Math.max(0.5, baseSize * (0.3 + 0.7 * p));
}

/** Exponential lag toward the pointer. strength 0–100 (Kleki-style stabilizer). */
function stabilizePoint(state, x, y, strength) {
  const s = Math.max(0, Math.min(100, strength || 0));
  if (s <= 0) {
    state.stabX = x;
    state.stabY = y;
    return { x, y };
  }
  // Higher strength → smaller step toward the cursor
  const t = 1 - (s / 100) * 0.92;
  if (state.stabX == null || state.stabY == null) {
    state.stabX = x;
    state.stabY = y;
  } else {
    state.stabX += (x - state.stabX) * t;
    state.stabY += (y - state.stabY) * t;
  }
  return { x: state.stabX, y: state.stabY };
}

// PhotoCraft panels.rs selection_mode_buttons. The value is shared by every selection tool
// (state.selectionMode), as PhotoCraft keeps one app.ui.selection_mode.
const SELECTION_MODE_OPTION = {
  key: 'selectionMode',
  type: 'iconButtons',
  label: 'Selection mode',
  default: 'new',
  options: [
    { value: 'new', label: 'New', icon: 'square', title: 'New selection' },
    { value: 'add', label: 'Add', icon: 'plus', title: 'Add to selection (Shift)' },
    { value: 'subtract', label: 'Subtract', icon: 'minus', title: 'Subtract from selection (Alt)' },
    {
      value: 'intersect',
      label: 'Intersect',
      icon: 'squares-subtract',
      title: 'Intersect with selection (Shift+Alt)'
    }
  ]
};

// PhotoCraft panels.rs marquee and lasso Feather (px) and Anti-alias. PhotoCraft greys Anti-alias
// for the Rectangular Marquee, so rectSelect's copy is disabled.
const SELECTION_FEATHER_OPTION = {
  key: 'feather',
  type: 'number',
  label: 'Feather',
  min: 0,
  max: 1000,
  step: 1,
  default: 0
};
const selectionAntiAliasOption = (disabled) => ({
  key: 'antiAlias',
  type: 'checkbox',
  label: 'Anti-alias',
  default: true,
  disabled
});

// PhotoCraft panels.rs marquee Style / Width / Height. Choosing a style resets the size as
// PhotoCraft does: 64 x 64 for Fixed Size, 1 : 1 otherwise.
const MARQUEE_SIZE_DISABLED = { key: 'marqueeStyle', value: 'normal' };
const MARQUEE_STYLE_OPTIONS = [
  {
    key: 'marqueeStyle',
    type: 'select',
    label: 'Style',
    default: 'normal',
    options: [
      { value: 'normal', label: 'Normal' },
      { value: 'fixedRatio', label: 'Fixed Ratio' },
      { value: 'fixedSize', label: 'Fixed Size' }
    ],
    onSelect: (value) =>
      value === 'fixedSize'
        ? { marqueeWidth: 64, marqueeHeight: 64 }
        : { marqueeWidth: 1, marqueeHeight: 1 }
  },
  {
    key: 'marqueeWidth',
    type: 'number',
    label: 'Width',
    min: 1,
    max: 30000,
    step: 1,
    default: 1,
    disabledWhen: MARQUEE_SIZE_DISABLED
  },
  {
    key: '_marqueeSwap',
    type: 'iconAction',
    icon: 'arrow-left-right',
    title: 'Swaps height and width',
    disabledWhen: MARQUEE_SIZE_DISABLED,
    patch: (values) => ({ marqueeWidth: values.marqueeHeight, marqueeHeight: values.marqueeWidth })
  },
  {
    key: 'marqueeHeight',
    type: 'number',
    label: 'Height',
    min: 1,
    max: 30000,
    step: 1,
    default: 1,
    disabledWhen: MARQUEE_SIZE_DISABLED
  }
];

// The box a Rectangular / Elliptical Marquee drag from (startX, startY) to (x, y) selects
// (PhotoCraft chrome_ui::marquee_end). Fixed Ratio follows the larger drag extent in the drag
// direction; Fixed Size is width x height at the start point whatever the drag.
// The one-pixel line [x0, y0, x1, y1] a Single Row / Single Column Marquee at (px, py) selects
// across a W x H canvas (PhotoCraft canvas.rs single_line_px): the row or column under the point,
// kept on the canvas. null for another tool, an empty canvas, or a point that is not a number.
export function singleLinePx(toolId, px, py, W, H) {
  if (!(W >= 1 && H >= 1) || !Number.isFinite(px) || !Number.isFinite(py)) return null;
  if (toolId === 'singleRowMarquee') {
    const y = Math.min(Math.max(Math.floor(py), 0), H - 1);
    return [0, y, W, y + 1];
  }
  if (toolId === 'singleColumnMarquee') {
    const x = Math.min(Math.max(Math.floor(px), 0), W - 1);
    return [x, 0, x + 1, H];
  }
  return null;
}

// The committed 0/1 mask for a 'rect' or 'ellipse' marquee box on a W x H canvas, feathered
// through featherMask when feather > 0.
export function marqueeMask(shape, box, W, H, feather) {
  const { x, y, w, h } = box;
  const mask =
    shape === 'ellipse'
      ? ellipseMask(x, y, w, h, W, H)
      : selectionToFullMask({ mode: 'active', x, y, w, h }, W, H);
  const r = Number(feather) || 0;
  return r > 0 ? featherMask(mask, W, H, r) : mask;
}

export function marqueeRect(style, width, height, startX, startY, x, y) {
  const w = Number(width),
    h = Number(height);
  if (style === 'fixedSize') {
    return {
      x: startX,
      y: startY,
      w: Math.max(1, Math.round(w) || 1),
      h: Math.max(1, Math.round(h) || 1)
    };
  }
  let ex = x,
    ey = y;
  if (style === 'fixedRatio' && w > 0 && h > 0) {
    const dx = x - startX,
      dy = y - startY;
    const k = Math.max(Math.abs(dx) / w, Math.abs(dy) / h);
    ex = startX + (dx < 0 ? -1 : 1) * Math.round(k * w);
    ey = startY + (dy < 0 ? -1 : 1) * Math.round(k * h);
  }
  return {
    x: Math.min(ex, startX),
    y: Math.min(ey, startY),
    w: Math.abs(ex - startX),
    h: Math.abs(ey - startY)
  };
}

// Per-tool options schema. Renderer in ui.js reads this. Defaults seed state.toolOptions.
// Types: 'range' { min, max, step, default }, 'checkbox' { default }, 'select' { options, default }.
function toneSchema(burn) {
  return [
    { key: 'size', type: 'range', label: 'Size', min: 1, max: 200, step: 1, default: 40 },
    { key: 'hardness', type: 'range', label: 'Hardness', min: 0, max: 100, step: 1, default: 50 },
    {
      key: 'range',
      type: 'select',
      label: 'Range',
      options: [
        { value: 'shadows', label: 'Shadows' },
        { value: 'midtones', label: 'Midtones' },
        { value: 'highlights', label: 'Highlights' }
      ],
      default: 'midtones'
    },
    { key: 'exposure', type: 'range', label: 'Exposure', min: 1, max: 100, step: 1, default: 50 },
    { key: 'protectTones', type: 'checkbox', label: 'Protect Tones', default: true }
  ];
}

function focusSchema(sharpen) {
  const opts = [
    { key: 'size', type: 'range', label: 'Size', min: 1, max: 200, step: 1, default: 40 },
    { key: 'hardness', type: 'range', label: 'Hardness', min: 0, max: 100, step: 1, default: 50 },
    { key: 'strength', type: 'range', label: 'Strength', min: 1, max: 100, step: 1, default: 50 }
  ];
  if (sharpen) {
    opts.push({ key: 'protectDetail', type: 'checkbox', label: 'Protect Detail', default: true });
  }

  return opts;
}

const ERASER_BLOCK = { key: 'eraserMode', value: 'block' };
// Pencil is always hard and at full flow; Block fixes everything but the mode.
const ERASER_ROUND_TIP = { key: 'eraserMode', values: ['pencil', 'block'] };

/** PhotoCraft brush_cmds::block_size: the Block eraser is 16 screen px, i.e. 16 / zoom doc px. */
export function eraserBlockSize(zoom) {
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return Math.max(1, Math.min(5000, Math.round(16 / z)));
}

// The Move tool's align and distribute buttons (align_bar.rs ALIGN / DISTRIBUTE): kind, icon,
// label.
const ALIGN_BAR = [
  ['leftEdges', 'align-edge-left', 'Left Edges'],
  ['horizontalCenters', 'align-edge-hcenter', 'Horizontal Centers'],
  ['rightEdges', 'align-edge-right', 'Right Edges'],
  ['topEdges', 'align-edge-top', 'Top Edges'],
  ['verticalCenters', 'align-edge-vcenter', 'Vertical Centers'],
  ['bottomEdges', 'align-edge-bottom', 'Bottom Edges']
];
const DISTRIBUTE_BAR = [
  ['topEdges', 'distribute-top', 'Top Edges'],
  ['verticalCenters', 'distribute-vcenter', 'Vertical Centers'],
  ['bottomEdges', 'distribute-bottom', 'Bottom Edges'],
  ['leftEdges', 'distribute-left', 'Left Edges'],
  ['horizontalCenters', 'distribute-hcenter', 'Horizontal Centers'],
  ['rightEdges', 'distribute-right', 'Right Edges'],
  ['horizontally', 'distribute-horizontal', 'Horizontally'],
  ['vertically', 'distribute-vertical', 'Vertically']
];

const SHAPE_PAINT_OPTIONS = [
  { key: 'fill', type: 'checkbox', label: 'Fill', default: true },
  { key: 'fillColor', type: 'color', label: '', default: '#000000' },
  { key: 'strokeColor', type: 'color', label: 'Stroke', default: '#ffffff' },
  { key: 'strokeWidth', type: 'number', label: 'px', min: 0, max: 288, step: 1, default: 0 },
  {
    key: 'strokeAlign',
    type: 'select',
    label: 'Align',
    default: 'center',
    options: STROKE_ALIGNS.map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) }))
  }
];
const SHAPE_RADIUS_OPTION = {
  key: 'radius',
  type: 'number',
  label: 'Radius',
  min: 0,
  max: 10000,
  step: 1,
  default: 0
};

/** The Custom Shape tool's Shape list after Define Custom Shape adds or replaces one. */
export function syncCustomShapeOptions(custom = []) {
  const field = TOOL_OPTION_SCHEMA.customShape.find((f) => f.key === 'shape');
  field.options = customShapeNames(custom).map((n) => ({ value: n, label: n }));
}

export const TOOL_OPTION_SCHEMA = {
  // PhotoCraft panels.rs Tool::Pencil (non-pro branch).
  pencil: [
    { key: 'size', type: 'range', label: 'Size', min: 1, max: 100, step: 1, default: 1 },
    { key: 'opacity', type: 'number', label: 'Opacity', min: 0, max: 100, step: 1, default: 100 },
    {
      key: 'smoothing',
      type: 'range',
      label: 'Smoothing',
      min: 0,
      max: 100,
      step: 1,
      default: 0
    },
    { key: 'autoErase', type: 'checkbox', label: 'Auto Erase', default: false },
    { key: 'lockAlpha', type: 'checkbox', label: 'Lock alpha', default: false }
  ],
  // PhotoCraft panels.rs Tool::Brush | Tool::Eraser (non-pro branch).
  brush: [
    { key: 'size', type: 'range', label: 'Size', min: 1, max: 100, step: 1, default: 20 },
    { key: 'hardness', type: 'number', label: 'Hardness', min: 0, max: 100, step: 1, default: 100 },
    { key: 'opacity', type: 'number', label: 'Opacity', min: 0, max: 100, step: 1, default: 100 },
    { key: 'flow', type: 'number', label: 'Flow', min: 1, max: 100, step: 1, default: 100 },
    {
      key: 'smoothing',
      type: 'range',
      label: 'Smoothing',
      min: 0,
      max: 100,
      step: 1,
      default: 0
    },
    { key: 'lockAlpha', type: 'checkbox', label: 'Lock alpha', default: false }
  ],
  mixerBrush: [
    { key: 'size', type: 'range', label: 'Size', min: 1, max: 200, step: 1, default: 20 },
    { key: 'wet', type: 'range', label: 'Wet', min: 0, max: 100, step: 1, default: 50 },
    { key: 'load', type: 'range', label: 'Load', min: 0, max: 100, step: 1, default: 50 },
    { key: 'mix', type: 'range', label: 'Mix', min: 0, max: 100, step: 1, default: 50 },
    { key: 'flow', type: 'range', label: 'Flow', min: 0, max: 100, step: 1, default: 100 },
    { key: 'sampleAllLayers', type: 'checkbox', label: 'Sample All Layers', default: false },
    { key: 'loadAfterStroke', type: 'checkbox', label: 'Load After Stroke', default: true },
    { key: 'cleanAfterStroke', type: 'checkbox', label: 'Clean After Stroke', default: true }
  ],
  colorReplacement: [
    { key: 'size', type: 'range', label: 'Size', min: 1, max: 200, step: 1, default: 20 },
    { key: 'hardness', type: 'range', label: 'Hardness', min: 0, max: 100, step: 1, default: 100 },
    {
      key: 'mode',
      type: 'select',
      label: 'Mode',
      options: [
        { value: 'hue', label: 'Hue' },
        { value: 'saturation', label: 'Saturation' },
        { value: 'color', label: 'Color' },
        { value: 'luminosity', label: 'Luminosity' }
      ],
      default: 'color'
    },
    {
      key: 'sampling',
      type: 'select',
      label: 'Sampling',
      options: [
        { value: 'continuous', label: 'Continuous' },
        { value: 'once', label: 'Once' },
        { value: 'background', label: 'Background Swatch' }
      ],
      default: 'continuous'
    },
    {
      key: 'limits',
      type: 'select',
      label: 'Limits',
      options: [
        { value: 'contiguous', label: 'Contiguous' },
        { value: 'discontiguous', label: 'Discontiguous' }
      ],
      default: 'contiguous'
    },
    { key: 'tolerance', type: 'range', label: 'Tolerance', min: 0, max: 100, step: 1, default: 30 },
    { key: 'antiAlias', type: 'checkbox', label: 'Anti-alias', default: true }
  ],
  // PhotoCraft panels.rs Tool::Eraser + eraser_ui.rs mode_dropdown: Block ignores Size, Opacity,
  // Flow, and Hardness; Pencil ignores Flow and Hardness.
  eraser: [
    {
      key: 'size',
      type: 'range',
      label: 'Size',
      min: 1,
      max: 100,
      step: 1,
      default: 20,
      disabledWhen: ERASER_BLOCK
    },
    {
      key: 'eraserMode',
      type: 'select',
      label: 'Mode',
      options: [
        { value: 'brush', label: 'Brush' },
        { value: 'pencil', label: 'Pencil' },
        { value: 'block', label: 'Block' }
      ],
      default: 'brush'
    },
    {
      key: 'opacity',
      type: 'number',
      label: 'Opacity',
      min: 0,
      max: 100,
      step: 1,
      default: 100,
      disabledWhen: ERASER_BLOCK
    },
    {
      key: 'flow',
      type: 'number',
      label: 'Flow',
      min: 1,
      max: 100,
      step: 1,
      default: 100,
      disabledWhen: ERASER_ROUND_TIP
    },
    {
      key: 'hardness',
      type: 'range',
      label: 'Hardness',
      min: 0,
      max: 100,
      step: 1,
      default: 100,
      disabledWhen: ERASER_ROUND_TIP
    }
  ],
  // PhotoCraft eraser_ui.rs options_bar for Tool::MagicEraser.
  magicEraser: [
    {
      key: 'tolerance',
      type: 'number',
      label: 'Tolerance',
      min: 0,
      max: 255,
      step: 1,
      default: 32
    },
    { key: 'antiAlias', type: 'checkbox', label: 'Anti-alias', default: true },
    { key: 'contiguous', type: 'checkbox', label: 'Contiguous', default: true },
    { key: 'sampleAllLayers', type: 'checkbox', label: 'Sample All Layers', default: false },
    { key: 'opacity', type: 'number', label: 'Opacity', min: 1, max: 100, step: 1, default: 100 }
  ],
  // PhotoCraft eraser_ui.rs options_bar for Tool::BackgroundEraser (Size is the shared brush).
  backgroundEraser: [
    { key: 'size', type: 'range', label: 'Size', min: 1, max: 100, step: 1, default: 20 },
    {
      key: 'sampling',
      type: 'iconButtons',
      label: 'Sampling',
      options: [
        {
          value: 'continuous',
          label: 'Continuous',
          icon: 'pipette',
          title: 'Sampling: Continuous'
        },
        { value: 'once', label: 'Once', icon: 'circle-dot', title: 'Sampling: Once' },
        {
          value: 'backgroundSwatch',
          label: 'Background Swatch',
          icon: 'square',
          title: 'Sampling: Background Swatch'
        }
      ],
      default: 'continuous'
    },
    {
      key: 'limits',
      type: 'select',
      label: 'Limits',
      options: [
        { value: 'discontiguous', label: 'Discontiguous' },
        { value: 'contiguous', label: 'Contiguous' },
        { value: 'findEdges', label: 'Find Edges' }
      ],
      default: 'contiguous'
    },
    {
      key: 'tolerance',
      type: 'number',
      label: 'Tolerance',
      min: 0,
      max: 100,
      step: 1,
      default: 50
    },
    {
      key: 'protectForeground',
      type: 'checkbox',
      label: 'Protect Foreground Color',
      default: false
    }
  ],
  fill: [
    {
      key: 'fillSource',
      type: 'select',
      label: 'Fill',
      options: [
        { value: 'foreground', label: 'Foreground' },
        { value: 'pattern', label: 'Pattern' }
      ],
      default: 'foreground'
    },
    { key: 'opacity', type: 'number', label: 'Opacity', min: 1, max: 100, step: 1, default: 100 },
    {
      key: 'tolerance',
      type: 'number',
      label: 'Tolerance',
      min: 0,
      max: 255,
      step: 1,
      default: 32
    },
    selectionAntiAliasOption(false),
    { key: 'contiguous', type: 'checkbox', label: 'Contiguous', default: true },
    { key: 'sampleAllLayers', type: 'checkbox', label: 'All Layers', default: false }
  ],
  gradient: [
    {
      key: 'preset',
      type: 'gradientSwatch',
      label: 'Preset',
      options: GRADIENT_PRESET_OPTIONS,
      default: GRADIENT_PRESET_OPTIONS[0].value
    },
    {
      key: 'shape',
      type: 'iconButtons',
      label: 'Shape',
      options: [
        { value: 'linear', label: 'Linear', icon: 'gradient', title: 'Linear Gradient' },
        { value: 'radial', label: 'Radial', icon: 'circle', title: 'Radial Gradient' },
        { value: 'angle', label: 'Angle', icon: 'rotate-cw', title: 'Angle Gradient' },
        {
          value: 'reflected',
          label: 'Reflected',
          icon: 'arrow-left-right',
          title: 'Reflected Gradient'
        },
        { value: 'diamond', label: 'Diamond', icon: 'diamond', title: 'Diamond Gradient' }
      ],
      default: 'linear'
    },
    {
      key: 'mode',
      type: 'select',
      label: 'Mode',
      options: BLEND_MODES.map(({ value, label }) => ({ value, label })),
      default: 'source-over'
    },
    { key: 'opacity', type: 'range', label: 'Opacity', min: 1, max: 100, step: 1, default: 100 },
    { key: 'reverse', type: 'checkbox', label: 'Reverse', default: false },
    { key: 'dither', type: 'checkbox', label: 'Dither', default: false }
  ],
  eyedropper: [],
  // PhotoCraft analysis_ui.rs options_bar Tool::ColorSampler; values.samplers is state.samplers.
  // Sample Size is Photoshop's Color Sampler option; the Info panel averages with it.
  colorSampler: [
    {
      key: 'samplerCount',
      type: 'readout',
      label: 'Samplers:',
      text: (values) => `${values.samplers?.length ?? 0} of ${MAX_SAMPLERS} sample points`
    },
    {
      key: 'sampleSize',
      type: 'select',
      label: 'Sample Size',
      options: SAMPLER_SIZES,
      default: '1'
    },
    {
      key: '_samplerClear',
      type: 'action',
      label: 'Clear All',
      title: 'Remove every sample point',
      disabledWhen: { key: 'samplersEmpty', value: true },
      patch: () => ({ _samplerAction: 'clear', samplers: [], samplersEmpty: true })
    }
  ],
  // PhotoCraft analysis_ui.rs options_bar Tool::Note: Author and Color of new notes (and of the
  // selected one), the Notes list, the selected note's text, Delete, and Clear All. values.notes
  // is state.notes and values.noteSelected the selected index as a string ('-1' for none).
  note: [
    { key: 'noteAuthor', type: 'text', label: 'Author:', inputMode: 'text', size: 10, default: '' },
    { key: 'noteColor', type: 'color', label: 'Color', default: NOTE_COLOR },
    {
      key: 'noteSelected',
      type: 'select',
      label: 'Notes',
      optionsFrom: (values) => [
        { value: '-1', label: values.notes?.length ? 'Select a note' : 'No notes' },
        ...(values.notes ?? []).map((n, i) => ({ value: String(i), label: noteLabel(n, i) }))
      ],
      default: '-1',
      disabledWhen: { key: 'notesEmpty', value: true }
    },
    {
      key: 'noteText',
      type: 'text',
      label: 'Text',
      inputMode: 'text',
      size: 24,
      default: '',
      disabledWhen: { key: 'noteSelected', value: '-1' }
    },
    {
      key: '_noteDelete',
      type: 'action',
      label: 'Delete',
      title: 'Delete the selected note',
      disabledWhen: { key: 'noteSelected', value: '-1' },
      patch: () => ({ _noteAction: 'delete' })
    },
    {
      key: '_noteClear',
      type: 'action',
      label: 'Clear All',
      title: 'Delete every note',
      disabledWhen: { key: 'notesEmpty', value: true },
      patch: () => ({ _noteAction: 'clear' })
    }
  ],
  // PhotoCraft analysis_ui.rs options_bar Tool::Ruler; values.ruler is state.ruler (or null).
  // Use Measurement Scale shows every readout but A in values.measurementScale's units.
  ruler: [
    ...[
      ['X', 'x'],
      ['Y', 'y'],
      ['W', 'w'],
      ['H', 'h'],
      ['A', 'angle'],
      ['L1', 'l1'],
      ['L2', 'l2']
    ].map(([label, field]) => ({
      key: 'ruler' + label,
      type: 'readout',
      label: label + ':',
      text: (values) => {
        const v = values.ruler ? rulerInfo(values.ruler)[field] : null;
        if (v == null) return '';
        const scaled = values.rulerUseScale && field !== 'angle' && values.measurementScale;
        return (scaled ? v * measurementScaleFactor(values.measurementScale) : v).toFixed(2);
      }
    })),
    { key: 'rulerUseScale', type: 'checkbox', label: 'Use Measurement Scale', default: false },
    {
      key: '_rulerStraighten',
      type: 'action',
      label: 'Straighten Layer',
      title: 'Turn the active layer so the ruler line lies on its nearest axis',
      disabledWhen: { key: 'ruler', values: [null, undefined] },
      // A level line leaves the ruler in place (paint.js does nothing for it).
      patch: (values) => ({
        _rulerAction: 'straighten',
        ruler: Math.abs(straightenAngle(values.ruler)) < 1e-9 ? values.ruler : null
      })
    },
    {
      key: '_rulerClear',
      type: 'action',
      label: 'Clear',
      title: 'Clear the ruler line',
      // The disabledWhen lookup falls back to undefined for a null value.
      disabledWhen: { key: 'ruler', values: [null, undefined] },
      patch: () => ({ _rulerAction: 'clear', ruler: null })
    }
  ],
  // PhotoCraft analysis_ui.rs options_bar Tool::Count; values.count is state.count, countColor
  // the active group's colour (paint.js writes it back to the group).
  count: [
    {
      key: 'countTotal',
      type: 'readout',
      label: 'Count:',
      text: (values) => String(values.count ? countTotal(values.count) : 0)
    },
    { key: 'countColor', type: 'color', label: 'Color', default: '#ff0000' },
    {
      key: '_countClear',
      type: 'action',
      label: 'Clear',
      title: "Clear the active count group's markers",
      disabledWhen: { key: 'countEmpty', value: true },
      // The bar re-renders from this patch, so it carries the cleared count too.
      patch: (values) => {
        const count = clearCount(values.count);
        return { _countAction: 'clear', count, countEmpty: countTotal(count) === 0 };
      }
    }
  ],
  cloneStamp: [
    { key: 'size', type: 'range', label: 'Size', min: 1, max: 200, step: 1, default: 20 },
    { key: 'hardness', type: 'range', label: 'Hardness', min: 0, max: 100, step: 1, default: 80 },
    { key: 'opacity', type: 'range', label: 'Opacity', min: 1, max: 100, step: 1, default: 100 },
    { key: 'aligned', type: 'checkbox', label: 'Aligned', default: true }
  ],
  patternStamp: [
    { key: 'size', type: 'range', label: 'Size', min: 1, max: 200, step: 1, default: 20 },
    { key: 'hardness', type: 'range', label: 'Hardness', min: 0, max: 100, step: 1, default: 80 },
    { key: 'opacity', type: 'range', label: 'Opacity', min: 1, max: 100, step: 1, default: 100 },
    { key: 'aligned', type: 'checkbox', label: 'Aligned', default: true },
    { key: 'scale', type: 'range', label: 'Scale', min: 10, max: 400, step: 1, default: 100 }
  ],
  spotHealing: [
    { key: 'size', type: 'range', label: 'Size', min: 1, max: 200, step: 1, default: 20 },
    { key: 'hardness', type: 'range', label: 'Hardness', min: 0, max: 100, step: 1, default: 80 }
  ],
  healingBrush: [
    { key: 'size', type: 'range', label: 'Size', min: 1, max: 200, step: 1, default: 20 },
    { key: 'hardness', type: 'range', label: 'Hardness', min: 0, max: 100, step: 1, default: 80 },
    { key: 'aligned', type: 'checkbox', label: 'Aligned', default: true }
  ],
  patch: [
    {
      key: 'patchMode',
      type: 'iconButtons',
      label: 'Patch',
      options: [
        {
          value: 'source',
          label: 'Source',
          icon: 'square-dashed',
          title: 'Source: repair the selection with the dragged-to area'
        },
        {
          value: 'destination',
          label: 'Destination',
          icon: 'copy',
          title: 'Destination: repair the dragged-to area with the selection'
        }
      ],
      default: 'source'
    }
  ],
  redEye: [
    {
      key: 'pupilSize',
      type: 'range',
      label: 'Pupil Size',
      min: 1,
      max: 100,
      step: 1,
      default: 50
    },
    {
      key: 'darken',
      type: 'range',
      label: 'Darken Amount',
      min: 0,
      max: 100,
      step: 1,
      default: 50
    }
  ],
  historyBrush: [
    { key: 'size', type: 'range', label: 'Size', min: 1, max: 200, step: 1, default: 20 },
    { key: 'hardness', type: 'range', label: 'Hardness', min: 0, max: 100, step: 1, default: 80 },
    { key: 'opacity', type: 'range', label: 'Opacity', min: 1, max: 100, step: 1, default: 100 }
  ],
  dodge: toneSchema(false),
  burn: toneSchema(true),
  sponge: [
    { key: 'size', type: 'range', label: 'Size', min: 1, max: 200, step: 1, default: 40 },
    { key: 'hardness', type: 'range', label: 'Hardness', min: 0, max: 100, step: 1, default: 50 },
    {
      key: 'mode',
      type: 'select',
      label: 'Mode',
      options: [
        { value: 'desaturate', label: 'Desaturate' },
        { value: 'saturate', label: 'Saturate' }
      ],
      default: 'desaturate'
    },
    { key: 'flow', type: 'range', label: 'Flow', min: 1, max: 100, step: 1, default: 50 },
    { key: 'vibrance', type: 'checkbox', label: 'Vibrance', default: true }
  ],
  blur: focusSchema(false),
  sharpen: focusSchema(true),
  smudge: [
    { key: 'size', type: 'range', label: 'Size', min: 1, max: 200, step: 1, default: 40 },
    { key: 'hardness', type: 'range', label: 'Hardness', min: 0, max: 100, step: 1, default: 50 },
    { key: 'strength', type: 'range', label: 'Strength', min: 1, max: 100, step: 1, default: 50 },
    { key: 'fingerPainting', type: 'checkbox', label: 'Finger Painting', default: false }
  ],
  // PhotoCraft move_ui.rs options_bar: Auto-Select and Show Transform Controls (tool_reset.rs
  // defaults false and true).
  select: [
    { key: 'autoSelect', type: 'checkbox', label: 'Auto-Select', default: false },
    { key: 'showTransform', type: 'checkbox', label: 'Show Transform Controls', default: true },
    // align_bar.rs: the six align icons, then a menu holding Align and Distribute. Each runs the
    // Layer menu command through _layerCommand.
    ...ALIGN_BAR.map(([kind, icon, label]) => ({
      key: `align-${kind}`,
      type: 'iconAction',
      icon,
      title: `Align: ${label}`,
      disabledWhen: { key: 'canAlign', value: false },
      patch: () => ({ _layerCommand: `layer.align.${kind}` })
    })),
    {
      key: 'alignMenu',
      type: 'iconMenu',
      icon: 'ellipsis',
      title: 'Align and distribute',
      sections: [
        { label: 'Align', prefix: 'layer.align.', when: 'canAlign', items: ALIGN_BAR },
        {
          label: 'Distribute',
          prefix: 'layer.distribute.',
          when: 'canDistribute',
          items: DISTRIBUTE_BAR
        }
      ]
    }
  ],
  text: [
    { key: 'size', type: 'range', label: 'Font size', min: 8, max: 200, step: 1, default: 16 },
    {
      key: 'family',
      type: 'select',
      label: 'Font',
      options: [
        { value: 'sans-serif', label: 'Sans' },
        { value: 'serif', label: 'Serif' },
        { value: 'monospace', label: 'Mono' },
        { value: 'cursive', label: 'Cursive' },
        { value: 'fantasy', label: 'Display' }
      ],
      default: 'sans-serif'
    },
    { key: 'bold', type: 'checkbox', label: 'Bold', default: false },
    { key: 'italic', type: 'checkbox', label: 'Italic', default: false },
    // PhotoCraft's type options bar: alignment, the text colour, then cancel and commit.
    {
      key: 'align',
      type: 'iconButtons',
      label: 'Alignment',
      default: 'left',
      options: [
        { value: 'left', label: 'Left', icon: 'align-left', title: 'Left align text' },
        { value: 'center', label: 'Center', icon: 'align-center', title: 'Center text' },
        { value: 'right', label: 'Right', icon: 'align-right', title: 'Right align text' }
      ]
    },
    { key: 'color', type: 'color', label: 'Color', default: '#000000' },
    {
      key: '_typeCancel',
      type: 'iconAction',
      icon: 'x',
      title: 'Cancel any current edits',
      patch: () => ({ _typeAction: 'cancel' })
    },
    {
      key: '_typeCommit',
      type: 'iconAction',
      icon: 'check',
      title: 'Commit any current edits',
      patch: () => ({ _typeAction: 'commit' })
    }
  ],
  // The Shape tools (shape_options.rs): Fill and its well (the foreground), the stroke's well
  // (the background), width, and alignment, then each tool's geometry.
  rect: [...SHAPE_PAINT_OPTIONS, SHAPE_RADIUS_OPTION],
  ellipse: [...SHAPE_PAINT_OPTIONS],
  triangle: [...SHAPE_PAINT_OPTIONS, SHAPE_RADIUS_OPTION],
  polygon: [
    ...SHAPE_PAINT_OPTIONS,
    { key: 'sides', type: 'number', label: 'Sides', min: 3, max: 100, step: 1, default: 5 },
    { key: 'starRatio', type: 'number', label: 'Star %', min: 1, max: 100, step: 1, default: 100 }
  ],
  line: [
    ...SHAPE_PAINT_OPTIONS,
    { key: 'weight', type: 'number', label: 'Weight', min: 1, max: 1000, step: 1, default: 3 }
  ],
  customShape: [
    ...SHAPE_PAINT_OPTIONS,
    {
      key: 'shape',
      type: 'select',
      label: 'Shape',
      default: DEFAULT_CUSTOM_SHAPE,
      options: customShapeNames().map((n) => ({ value: n, label: n }))
    }
  ],
  rectSelect: [
    SELECTION_MODE_OPTION,
    SELECTION_FEATHER_OPTION,
    selectionAntiAliasOption(true),
    ...MARQUEE_STYLE_OPTIONS
  ],
  ellipseSelect: [
    SELECTION_MODE_OPTION,
    SELECTION_FEATHER_OPTION,
    selectionAntiAliasOption(false),
    ...MARQUEE_STYLE_OPTIONS
  ],
  // PhotoCraft tool_reset.rs: the single-pixel marquees are never anti-aliased; Feather is
  // their only option besides the selection mode.
  singleRowMarquee: [SELECTION_MODE_OPTION, SELECTION_FEATHER_OPTION],
  singleColumnMarquee: [SELECTION_MODE_OPTION, SELECTION_FEATHER_OPTION],
  lasso: [SELECTION_MODE_OPTION, SELECTION_FEATHER_OPTION, selectionAntiAliasOption(false)],
  polyLasso: [SELECTION_MODE_OPTION, SELECTION_FEATHER_OPTION, selectionAntiAliasOption(false)],
  // PhotoCraft panels.rs Tool::MagneticLasso: Width (px), Contrast (%), Frequency (state.rs
  // defaults 10, 10, 57) after the lasso options.
  // PhotoCraft vector_ui.rs Tool::FreeformPen: Curve Fit, 0.5–10 px (state.rs default 2).
  freeformPen: [
    {
      key: 'curveFit',
      type: 'number',
      label: 'Curve Fit',
      min: 0.5,
      max: 10,
      step: 0.5,
      default: 2
    }
  ],
  magneticLasso: [
    SELECTION_MODE_OPTION,
    SELECTION_FEATHER_OPTION,
    selectionAntiAliasOption(false),
    { key: 'width', type: 'number', label: 'Width', min: 1, max: 256, step: 1, default: 10 },
    { key: 'contrast', type: 'number', label: 'Contrast', min: 1, max: 100, step: 1, default: 10 },
    { key: 'frequency', type: 'number', label: 'Frequency', min: 0, max: 100, step: 1, default: 57 }
  ],
  // PhotoCraft Tool::QuickSelection: the selection mode and the brush Size.
  quickSelection: [
    SELECTION_MODE_OPTION,
    { key: 'size', type: 'range', label: 'Size', min: 1, max: 500, step: 1, default: 30 }
  ],
  // PhotoCraft panels.rs Tool::MagicWand: Tolerance value field (state.rs default 32),
  // Anti-alias, Contiguous, Sample All Layers.
  magicWand: [
    SELECTION_MODE_OPTION,
    {
      key: 'tolerance',
      type: 'number',
      label: 'Tolerance',
      min: 0,
      max: 255,
      step: 1,
      default: 32
    },
    selectionAntiAliasOption(false),
    { key: 'contiguous', type: 'checkbox', label: 'Contiguous', default: true },
    { key: 'sampleAllLayers', type: 'checkbox', label: 'Sample All Layers', default: false }
  ],
  // PhotoCraft crop_ui.rs Classic Mode: the frame is edited until Commit (Enter) or Cancel (Esc).
  crop: [
    {
      key: 'ratio',
      type: 'select',
      label: 'Ratio',
      default: '',
      // The ratio presets, the px size presets, Front Image, Clear (crop_size.rs
      // dropdown_options). The last three are applied at once and leave W x H selected.
      options: [
        ...CROP_RATIOS,
        ...CROP_SIZE_PRESETS,
        { value: CROP_FRONT, label: 'Front Image' },
        { value: CROP_CLEAR, label: 'Clear' }
      ],
      // A W x H choice runs TOOLS.crop.choose first (one refit), then its keys ride along so
      // the bar re-renders with them (fitting again to the same target is a no-op).
      onSelect: (value, values) => {
        const [w, h] = values?.docSize ?? [1, 1];
        const patch = cropChosen(value, values, w, h);
        return patch.ratio === value ? null : { _cropAction: `choose:${value}`, ...patch };
      },
      // A swapped key ("5:4") is not a preset; list it so the bar shows what is held.
      extraOption: (value) =>
        cropRatio(value, 1, 1) && value.includes(':')
          ? { value, label: value.replace(':', ' : ') }
          : null
    },
    // W x H mode (crop_size.rs WHR): the output size in px; empty fields leave a free frame.
    {
      key: 'cropW',
      type: 'text',
      label: 'W',
      title: 'Width in px',
      default: '',
      shownWhen: { key: 'ratio', value: CROP_WXH }
    },
    {
      key: '_cropSwap',
      type: 'iconAction',
      icon: 'arrow-left-right',
      title: 'Swaps height and width',
      // paint.js runs TOOLS.crop.swap; the swapped key rides along so the bar re-renders with
      // it (fitting again to the same ratio is a no-op). docSize comes from refreshToolOptions.
      patch: (values) => {
        if (values.ratio === CROP_WXH) {
          return { _cropAction: 'swap', cropW: values.cropH ?? '', cropH: values.cropW ?? '' };
        }
        const [w, h] = values.docSize ?? [1, 1];
        const ratio = cropSwappedRatio(values.ratio ?? '', w, h);
        return ratio ? { _cropAction: 'swap', ratio } : { _cropAction: 'swap' };
      }
    },
    {
      key: 'cropH',
      type: 'text',
      label: 'H',
      title: 'Height in px',
      default: '',
      shownWhen: { key: 'ratio', value: CROP_WXH }
    },
    // Straighten (crop_straighten.rs options_button): arms one level line; paint.js passes
    // state.cropStraighten as the value and routes the key to TOOLS.crop.setStraighten.
    {
      key: '_cropStraighten',
      type: 'iconAction',
      icon: 'ruler',
      title: 'Straighten the image by drawing a line on it',
      pressedKey: 'cropStraighten',
      patch: (values) => ({ cropStraighten: !values.cropStraighten })
    },
    // The composition guide inside the frame (crop_overlay.rs options_button); O cycles it
    // and Shift+O its orientation (cropOverlayOrientation, kept off the bar).
    {
      key: 'cropOverlay',
      type: 'select',
      label: 'Overlay',
      title: 'Set the overlay options for the Crop tool (O cycles, Shift+O turns)',
      default: 'thirds',
      options: CROP_OVERLAYS,
      onSelect: (value) => ({ cropOverlay: value, cropOverlayOrientation: 0 })
    },
    {
      key: 'cropOverlayShow',
      type: 'select',
      label: 'Show',
      default: 'auto',
      options: CROP_OVERLAY_SHOW
    },
    // The shield over the area outside the frame (crop_shield.rs options_button); H toggles
    // Show Cropped Area.
    {
      key: 'cropShieldShow',
      type: 'checkbox',
      label: 'Show Cropped Area',
      title: 'Show Cropped Area (H)',
      default: CROP_SHIELD_DEFAULTS.showCroppedArea
    },
    {
      key: 'cropShield',
      type: 'checkbox',
      label: 'Enable Crop Shield',
      default: CROP_SHIELD_DEFAULTS.enabled
    },
    {
      key: 'cropShieldColor',
      type: 'select',
      label: 'Shield Color',
      default: CROP_SHIELD_DEFAULTS.color,
      options: [
        { value: 'canvas', label: 'Match Canvas' },
        { value: 'custom', label: 'Custom' }
      ]
    },
    {
      key: 'cropShieldCustom',
      type: 'color',
      label: 'Crop Shield color',
      default: CROP_SHIELD_DEFAULTS.customColor,
      shownWhen: { key: 'cropShieldColor', value: 'custom' }
    },
    {
      key: 'cropShieldOpacity',
      type: 'number',
      label: 'Opacity',
      min: 0,
      max: 100,
      step: 1,
      default: CROP_SHIELD_DEFAULTS.opacity
    },
    {
      key: 'cropShieldAuto',
      type: 'checkbox',
      label: 'Auto Adjust Opacity',
      default: CROP_SHIELD_DEFAULTS.autoAdjust
    },
    {
      key: '_cropCommit',
      type: 'iconAction',
      icon: 'check',
      title: 'Commit current crop operation',
      patch: () => ({ _cropAction: 'commit', cropStraighten: false })
    },
    {
      key: '_cropCancel',
      type: 'iconAction',
      icon: 'x',
      title: 'Cancel current crop operation',
      patch: () => ({ _cropAction: 'cancel', cropStraighten: false })
    }
  ],
  // PhotoCraft perspective_crop_ui.rs options_bar: W and H are the Crop tool's fields (paint.js
  // reads and writes state.toolOptions.crop, whatever the Crop Ratio), Front Image, Clear, Show
  // Grid, then cancel and commit.
  perspectiveCrop: [
    { key: 'cropW', type: 'text', label: 'W', title: 'Width in px', default: '' },
    {
      key: '_pcropSwap',
      type: 'iconAction',
      icon: 'arrow-left-right',
      title: 'Swaps height and width',
      patch: (values) => ({ cropW: values.cropH ?? '', cropH: values.cropW ?? '' })
    },
    { key: 'cropH', type: 'text', label: 'H', title: 'Height in px', default: '' },
    {
      key: '_pcropFront',
      type: 'action',
      label: 'Front Image',
      title: "Fill W and H with the document's size",
      patch: (values) => {
        const [w, h] = values.docSize ?? [1, 1];
        return { cropW: String(w), cropH: String(h) };
      }
    },
    {
      key: '_pcropClear',
      type: 'action',
      label: 'Clear',
      title: 'Clear W and H',
      patch: () => ({ cropW: '', cropH: '' })
    },
    { key: 'pcropGrid', type: 'checkbox', label: 'Show Grid', default: true },
    {
      key: '_pcropCancel',
      type: 'iconAction',
      icon: 'x',
      title: 'Cancel current crop operation (Esc)',
      patch: () => ({ _perspectiveCropAction: 'cancel' })
    },
    {
      key: '_pcropCommit',
      type: 'iconAction',
      icon: 'check',
      title: 'Commit current crop operation (Enter)',
      patch: () => ({ _perspectiveCropAction: 'commit' })
    }
  ]
};

// The Vertical Type and Type Mask tools' options bar is the Horizontal Type tool's.
TOOL_OPTION_SCHEMA.verticalType = TOOL_OPTION_SCHEMA.text;
TOOL_OPTION_SCHEMA.horizontalTypeMask = TOOL_OPTION_SCHEMA.text;
TOOL_OPTION_SCHEMA.verticalTypeMask = TOOL_OPTION_SCHEMA.text;

// Lay dabs from (x0, y0) to (x1, y1) every `step` px; dab(cx, cy) returns its touched box or
// null. Returns the union box or null.
function dabSegment(x0, y0, x1, y1, step, dab) {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step));
  let box = null;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const r = dab(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
    if (!r) continue;
    box = box
      ? [
          Math.min(box[0], r[0]),
          Math.min(box[1], r[1]),
          Math.max(box[2], r[2]),
          Math.max(box[3], r[3])
        ]
      : r;
  }
  return box;
}

function putBox(ctx, img, box) {
  if (box) ctx.putImageData(img, 0, 0, box[0], box[1], box[2] - box[0], box[3] - box[1]);
}

// Clone Stamp / Healing Brush: lay dabs from (x0, y0) to (x1, y1) at a quarter-radius spacing and
// put back the touched box.
function cloneStampSegment(ctx, state, x0, y0, x1, y1) {
  const { img, src, cov, mask, off, radius, hardness, opacity, sample } = state.cloneStroke;
  const W = img.width,
    H = img.height;
  const box = dabSegment(x0, y0, x1, y1, Math.max(1, radius / 4), (cx, cy) =>
    cloneDab(
      img.data,
      src,
      W,
      H,
      cx,
      cy,
      off.dx,
      off.dy,
      radius,
      hardness,
      opacity,
      mask,
      cov,
      sample
    )
  );
  putBox(ctx, img, box);
}

// The Eraser on the Background's pixels (not its mask), or on a layer with Lock Transparent
// Pixels, paints the background colour (PhotoCraft eraser_locked).
function erasesToBackground(state) {
  const layer = state.layers?.[state.activeLayerIdx];
  if (state.editMask || !layer) return false;
  return isBackgroundLayer(layer) || transparencyLocked(state.layers, layer);
}

// PhotoCraft render_stroke clips to doc.selection: the active selection's full mask, or null.
// Undo is already pushed on down, so a float drawn on the layer drops its baseData (see gradient).
function strokeSelectionMask(state, W, H) {
  const sel = state.sel;
  if (!sel || sel.mode !== 'active') return null;
  if (sel.data) {
    sel.data = null;
    sel.baseData = null;
  }
  return selectionToFullMask(sel, W, H);
}

// Brush-mode Eraser: round-tip dabs at a quarter-radius spacing (PhotoCraft's brush spacing).
function eraseSegment(ctx, st, x0, y0, x1, y1) {
  const { img, src, cov, mask, radius, hardness, flow, opacity } = st;
  const box = dabSegment(x0, y0, x1, y1, Math.max(1, radius / 4), (cx, cy) =>
    eraseDab(
      img.data,
      src,
      img.width,
      img.height,
      cx,
      cy,
      radius,
      hardness,
      flow,
      opacity,
      mask,
      cov,
      st.fill
    )
  );
  putBox(ctx, img, box);
}

// Background Eraser: hard round-tip dabs at a quarter-radius spacing (PhotoCraft's brush spacing).
// Continuous samples the hotspot per dab, Once keeps the first dab's hotspot (undefined until
// then), Background Swatch keeps st.sample.
function backgroundEraseSegment(ctx, st, x0, y0, x1, y1) {
  const { img, src, cov, mask, radius } = st;
  const W = img.width,
    H = img.height;
  const box = dabSegment(x0, y0, x1, y1, Math.max(1, radius / 4), (cx, cy) => {
    let sample = st.sample;
    if (st.sampling === 'continuous') sample = hotspotColor(src, W, H, cx, cy);
    else if (sample === undefined) sample = st.sample = hotspotColor(src, W, H, cx, cy);
    return backgroundEraseDab(
      img.data,
      src,
      W,
      H,
      cx,
      cy,
      radius,
      1,
      sample,
      st.tol,
      st.limits,
      st.protect,
      mask,
      cov
    );
  });
  putBox(ctx, img, box);
}

// Pencil / Block-mode Eraser: hard squares of side st.size at a quarter-side spacing (at most half
// a pixel), each rewriting from the pre-stroke pixels.
function eraseSquareSegment(ctx, st, x0, y0, x1, y1) {
  const { img, src, cov, mask, size, opacity } = st;
  const box = dabSegment(x0, y0, x1, y1, Math.max(0.5, size / 4), (cx, cy) =>
    eraseSquareDab(img.data, src, img.width, img.height, cx, cy, size, opacity, mask, cov, st.fill)
  );
  putBox(ctx, img, box);
}

// Brush: the stroke's path walker lays Brush Settings dabs (spacing, angle, roundness, jitters),
// each rewriting from the pre-stroke pixels. Moving to (x, y) puts back the touched box.
function paintStroke(ctx, st, x, y) {
  st.box = null;
  if (st.walker) st.walker.push(x, y);
  else {
    st.walker = pathWalker(x, y, () => st.builder.stepLen(st.size), (px, py, dir) => {
      for (const dab of st.builder.dabsAt(px, py, dir, st.size, st.flow)) {
        const r = paintTipDab(
          st.img.data,
          st.src,
          st.img.width,
          st.img.height,
          dab,
          st.hardness,
          st.opacity,
          st.rgb,
          st.lockAlpha,
          st.mask,
          st.cov
        );
        if (!r) continue;
        const b = st.box;
        st.box = b
          ? [Math.min(b[0], r[0]), Math.min(b[1], r[1]), Math.max(b[2], r[2]), Math.max(b[3], r[3])]
          : r;
      }
    });
  }
  putBox(ctx, st.img, st.box);
}

// Pencil: aliased grid-snapped dabs at a quarter-size spacing (at most half a pixel), each
// rewriting from the pre-stroke pixels.
function pencilSegment(ctx, st, x0, y0, x1, y1) {
  const { img, src, cov, mask, size, opacity, rgb, lockAlpha } = st;
  const box = dabSegment(x0, y0, x1, y1, Math.max(0.5, size / 4), (cx, cy) =>
    pencilDab(
      img.data,
      src,
      img.width,
      img.height,
      cx,
      cy,
      size,
      opacity,
      rgb,
      lockAlpha,
      mask,
      cov
    )
  );
  putBox(ctx, img, box);
}

// Dodge / Burn: same spacing as Clone Stamp, each dab toning from the pre-stroke pixels.
function toneSegment(ctx, state, x0, y0, x1, y1) {
  const st = state.toneStroke;
  const { img, src, cov, mask, radius, hardness, tone } = st;
  const box = dabSegment(x0, y0, x1, y1, Math.max(1, radius / 4), (cx, cy) =>
    toneDab(img.data, src, img.width, img.height, cx, cy, radius, hardness, tone, mask, cov)
  );
  putBox(ctx, img, box);
}

// Sponge: dabs edit the stroke's f32 working copy in order (PhotoCraft color_dab), and the
// touched box is written back to the layer bytes with alpha left alone.
function spongeSegment(ctx, state, x0, y0, x1, y1) {
  const st = state.spongeStroke;
  const { img, work, mask, radius, hardness, strength, f } = st;
  const W = img.width,
    H = img.height;
  const step = Math.max(1, radius / 4);
  const spacing = step / (2 * radius);
  const box = dabSegment(x0, y0, x1, y1, step, (cx, cy) =>
    colorDab(work, W, H, cx, cy, radius, hardness, strength, spacing, f, mask)
  );
  putWork(ctx, img, work, 3, box);
}

// Color Replacement: dabs edit the stroke's RGBA f32 working copy in order, each matching
// against the pre-stroke bytes (PhotoCraft color_replacement_effect).
function colorReplaceSegment(ctx, st, x0, y0, x1, y1) {
  const { img, pre, work, mask, radius, hardness, sample, fg, mode, tol, antiAlias, contiguous } =
    st;
  const W = img.width,
    H = img.height;
  const box = dabSegment(x0, y0, x1, y1, Math.max(1, radius / 4), (cx, cy) =>
    colorReplaceDab(
      work,
      pre,
      W,
      H,
      cx,
      cy,
      radius,
      hardness,
      sample,
      fg,
      mode,
      tol,
      antiAlias,
      contiguous,
      mask
    )
  );
  putWork(ctx, img, work, 4, box);
}

// Write the box of a stroke's f32 working copy (n channels, 0..1) back to the layer bytes. With
// n = 3 alpha is left alone.
function putWork(ctx, img, work, n, box) {
  if (!box) return;
  const d = img.data;
  const W = img.width;
  for (let y = box[1]; y < box[3]; y++) {
    for (let x = box[0]; x < box[2]; x++) {
      const p = y * W + x;
      for (let c = 0; c < n; c++) d[p * 4 + c] = work[p * n + c] * 255;
    }
  }
  putBox(ctx, img, box);
}

// A stroke's RGBA f32 working copy (0..1) of the layer bytes.
function rgbaWork(img) {
  const work = new Float32Array(img.data.length);
  for (let i = 0; i < work.length; i++) work[i] = img.data[i] / 255;
  return work;
}

// Blur / Sharpen: like Sponge, but each dab filters a window of the RGBA working copy.
function focusSegment(ctx, state, x0, y0, x1, y1) {
  const st = state.focusStroke;
  const { img, work, mask, radius, hardness, strength, filter } = st;
  const W = img.width,
    H = img.height;
  const step = Math.max(1, radius / 4);
  const spacing = step / (2 * radius);
  const box = dabSegment(x0, y0, x1, y1, step, (cx, cy) =>
    focusDab(work, W, H, 4, cx, cy, radius, hardness, strength, spacing, filter, mask)
  );
  putWork(ctx, img, work, 4, box);
}

// The Blur (sharpen = false) or Sharpen tool (PhotoCraft paint.blur / paint.sharpen). Undo is
// pushed on down, before any pixel changes.
function focusTool(sharpen) {
  const id = sharpen ? 'sharpen' : 'blur';
  const label = sharpen ? 'Sharpen' : 'Blur';
  return {
    label,
    icon: sharpen ? 'triangle' : 'droplet',
    cursor: 'crosshair',
    onDown(ctx, ov, state, x, y) {
      state.drawing = true;
      const opts = toolOpts(state, id);
      const W = ctx.canvas.width,
        H = ctx.canvas.height;
      const sel = state.sel;
      const mask = sel && sel.mode === 'active' ? selectionToFullMask(sel, W, H) : null;
      state.pushUndo?.(label);
      // A float is already drawn on the layer; drop its baseData (see gradient).
      if (sel?.data) {
        sel.data = null;
        sel.baseData = null;
      }
      const size = opts.size ?? state.brushSize;
      const strength = Math.min(100, Math.max(1, opts.strength ?? 50)) / 100;
      const protect = opts.protectDetail !== false;
      const sigma = Math.min(4, Math.max(1, size * 0.03));
      const img = ctx.getImageData(0, 0, W, H);
      const work = rgbaWork(img);
      state.focusStroke = {
        img,
        work,
        mask,
        radius: Math.max(0.5, size / 2),
        hardness: (opts.hardness ?? 50) / 100,
        strength,
        filter: sharpen
          ? (win) => localSharpen(work, W, H, 4, 3, win, 1, protect)
          : (win) => localBlur(work, W, H, 4, 3, win, sigma),
        lastX: x,
        lastY: y
      };
      focusSegment(ctx, state, x, y, x, y);
    },
    onMove(ctx, ov, state, x, y) {
      const st = state.focusStroke;
      if (!state.drawing || !st) return;
      focusSegment(ctx, state, st.lastX, st.lastY, x, y);
      st.lastX = x;
      st.lastY = y;
    },
    onUp(ctx, ov, state) {
      state.drawing = false;
      state.focusStroke = null;
    }
  };
}

// Smudge: dabs carry colour along the RGBA working copy in order (PhotoCraft Smudge).
function smudgeSegment(ctx, state, x0, y0, x1, y1) {
  const st = state.smudgeStroke;
  const { img, work, mask, radius, hardness, sm } = st;
  const W = img.width,
    H = img.height;
  const box = dabSegment(x0, y0, x1, y1, Math.max(1, radius / 4), (cx, cy) =>
    smudgeDab(sm, work, W, H, cx, cy, radius, hardness, mask)
  );
  putWork(ctx, img, work, 4, box);
}

// Mixer Brush: dabs mix the reservoir with paint picked up from the RGBA working copy, in order
// (PhotoCraft apply_mixer_stroke).
function mixerSegment(ctx, state, x0, y0, x1, y1) {
  const { img, work, sample, mask, radius, settings } = state.mixerStroke;
  const W = img.width,
    H = img.height;
  const ms = state.mixer;
  const box = dabSegment(x0, y0, x1, y1, Math.max(1, radius / 4), (cx, cy) =>
    mixerDab(ms, work, sample, W, H, cx, cy, radius, 1, settings, mask)
  );
  putWork(ctx, img, work, 4, box);
}

// The Dodge (burn = false) or Burn tool. Undo is pushed on down, before any pixel changes.
function toneTool(burn) {
  const id = burn ? 'burn' : 'dodge';
  const label = burn ? 'Burn' : 'Dodge';
  return {
    label,
    icon: burn ? 'flame' : 'lollipop',
    cursor: 'crosshair',
    onDown(ctx, ov, state, x, y) {
      state.drawing = true;
      const opts = toolOpts(state, id);
      const W = ctx.canvas.width,
        H = ctx.canvas.height;
      const sel = state.sel;
      const mask = sel && sel.mode === 'active' ? selectionToFullMask(sel, W, H) : null;
      state.pushUndo?.(label);
      // A float is already drawn on the layer; drop its baseData (see gradient).
      if (sel?.data) {
        sel.data = null;
        sel.baseData = null;
      }
      const exposure = Math.min(100, Math.max(1, opts.exposure ?? 50)) / 100;
      const range = opts.range ?? 'midtones';
      const protect = opts.protectTones !== false;
      const img = ctx.getImageData(0, 0, W, H);
      state.toneStroke = {
        img,
        src: new Uint8ClampedArray(img.data),
        cov: new Float32Array(W * H),
        mask,
        radius: Math.max(0.5, (opts.size ?? state.brushSize) / 2),
        hardness: (opts.hardness ?? 50) / 100,
        tone: (rgb) => dodgeBurn(rgb, exposure, range, burn, protect),
        lastX: x,
        lastY: y
      };
      toneSegment(ctx, state, x, y, x, y);
    },
    onMove(ctx, ov, state, x, y) {
      const st = state.toneStroke;
      if (!state.drawing || !st) return;
      toneSegment(ctx, state, st.lastX, st.lastY, x, y);
      st.lastX = x;
      st.lastY = y;
    },
    onUp(ctx, ov, state) {
      state.drawing = false;
      state.toneStroke = null;
    }
  };
}

function drawCloneHint(ov, x, y, text = 'Alt-click to set a clone source') {
  ov.clearRect(0, 0, ov.canvas.width, ov.canvas.height);
  ov.save();
  ov.font = '12px sans-serif';
  ov.fillStyle = 'rgba(0,0,0,0.75)';
  ov.fillText(text, x + 12, y - 10);
  ov.restore();
}

// Clone Stamp and Healing Brush. Alt-click sets the source; a stroke paints the cloned source
// (cloneDab). With heal, pointer up re-solves the stroke coverage as a seamless clone
// (healStroke, PhotoCraft healing_brush) so it keeps the source texture and the local colour.
function cloneTool(id, label, icon, heal) {
  return {
    label,
    icon,
    cursor: 'crosshair',
    onDown(ctx, ov, state, x, y) {
      state.clone ||= { source: null, offset: null };
      if (state.altKey) {
        state.clone.source = { x: Math.floor(x), y: Math.floor(y) };
        state.clone.offset = null;
        state.clone.anchor = null;
        state.onCloneSourceChange?.();
        return;
      }
      state.drawing = true;
      const opts = toolOpts(state, id);
      const aligned = opts.aligned !== false;
      // An aligned stroke keeps the first stroke's anchor; any other starts at its own pixel.
      const paired = aligned && state.clone.offset && state.clone.anchor;
      const off = cloneStrokeOffset(state.clone, x, y, aligned);
      if (!off) {
        state.cloneStroke = null;
        drawCloneHint(ov, x, y);
        return;
      }
      const anchor = paired ? state.clone.anchor : { x: Math.floor(x), y: Math.floor(y) };
      if (aligned) state.clone.anchor = anchor;
      state.onCloneSourceChange?.();
      const W = ctx.canvas.width,
        H = ctx.canvas.height;
      const transform = state.clone.transform;
      const sample = isIdentityTransform(transform)
        ? null
        : cloneSampler(anchor, off, transform, W, H);
      const sel = state.sel;
      const mask = sel && sel.mode === 'active' ? selectionToFullMask(sel, W, H) : null;
      state.pushUndo?.(label);
      // A float is already drawn on the layer; drop its baseData (see gradient).
      if (sel?.data) {
        sel.data = null;
        sel.baseData = null;
      }
      const img = ctx.getImageData(0, 0, W, H);
      state.cloneStroke = {
        img,
        src: new Uint8ClampedArray(img.data),
        cov: new Float32Array(W * H),
        mask,
        off,
        sample,
        radius: Math.max(0.5, (opts.size ?? state.brushSize) / 2),
        hardness: (opts.hardness ?? 80) / 100,
        opacity: (opts.opacity ?? 100) / 100,
        lastX: x,
        lastY: y
      };
      cloneStampSegment(ctx, state, x, y, x, y);
    },
    onMove(ctx, ov, state, x, y) {
      if (!state.drawing) return;
      const st = state.cloneStroke;
      if (!st) {
        drawCloneHint(ov, x, y);
        return;
      }
      cloneStampSegment(ctx, state, st.lastX, st.lastY, x, y);
      st.lastX = x;
      st.lastY = y;
    },
    onUp(ctx, ov, state) {
      const st = state.cloneStroke;
      if (heal && st) {
        const { img, src, cov, mask, off, opacity, sample } = st;
        const box = healStroke(
          img.data,
          src,
          img.width,
          img.height,
          off.dx,
          off.dy,
          cov,
          mask,
          opacity,
          sample
        );
        putBox(ctx, img, box);
      }
      state.drawing = false;
      state.cloneStroke = null;
      ov.clearRect(0, 0, ov.canvas.width, ov.canvas.height);
    }
  };
}

// Release of a freehand lasso (Lasso, and the Patch tool's lasso): close state.lassoPath into
// a mask and replace or combine the selection.
function finishLasso(ctx, ov, state, feather) {
  if (!state.drawing) return;
  state.drawing = false;
  ov.clearRect(0, 0, ov.canvas.width, ov.canvas.height);
  if (state.lassoPath.length < 3) {
    state.sel.mode = 'none';
    return;
  }
  const { scanlineFill: fill } = state;
  if (!fill) {
    state.sel.mode = 'none';
    return;
  }
  const W = ctx.canvas.width,
    H = ctx.canvas.height;
  const raw = fill(state.lassoPath, W, H);
  const mask = feather > 0 ? featherMask(raw, W, H, feather) : raw;
  commitToolSelection(state, mask, W, H, selectionMode(state));
}

// Patch Tool (PhotoCraft retouch_ui.rs patch_offset): the whole-pixel drag delta from start to
// end, clamped so the selection's bounding box bbox ({ x, y, w, h }, or null) stays on the
// W x H canvas.
export function patchOffset(start, end, bbox, W, H) {
  const delta = (a, b) => {
    const v = Math.round(b - a);
    return Number.isFinite(v) ? v + 0 : 0;
  };
  const dx = delta(start[0], end[0]),
    dy = delta(start[1], end[1]);
  if (!bbox) return [dx, dy];
  const clamp = (v, lo, hi) => (lo > hi ? 0 : Math.min(hi, Math.max(lo, v)) + 0);
  return [clamp(dx, -bbox.x, W - bbox.x - bbox.w), clamp(dy, -bbox.y, H - bbox.y - bbox.h)];
}

// The selection outline moved by the patch offset, drawn as alternating white / black pixels
// over the live preview of the heal (drag.preview from patchPreview), if any.
function drawPatchOutline(ov, drag) {
  const [dx, dy] = drag.offset;
  const pts = drag.edge;
  ov.clearRect(0, 0, ov.canvas.width, ov.canvas.height);
  if (drag.preview) {
    const [x0, y0, x1, y1] = drag.preview.box;
    const img = ov.createImageData(x1 - x0, y1 - y0);
    img.data.set(drag.preview.data);
    ov.putImageData(img, x0, y0);
  }
  for (const [color, parity] of [
    ['#fff', 0],
    ['#000', 1]
  ]) {
    ov.beginPath();
    for (let i = 0; i < pts.length; i += 2) {
      if (((pts[i] + pts[i + 1]) >> 2) % 2 === parity) ov.rect(pts[i] + dx, pts[i + 1] + dy, 1, 1);
    }
    ov.fillStyle = color;
    ov.fill();
  }
}

// Patch Tool, Normal (PhotoCraft retouch_ui.rs patch_drags_selection / finish_patch). A drag that
// starts inside the selection without Shift or Alt drags the patch outline, and release heals
// through patchHeal (Source or Destination); the selection stays where it was. Any other drag
// draws a freehand lasso with the Lasso's add / subtract / intersect behavior.
const patchTool = {
  label: 'Patch',
  icon: 'lasso-select',
  cursor: 'crosshair',
  onDown(ctx, ov, state, x, y) {
    const sel = state.sel;
    const W = ctx.canvas.width,
      H = ctx.canvas.height;
    if (
      !state.shiftKey &&
      !state.altKey &&
      sel?.mode === 'active' &&
      isInsideSelection(sel, x, y, W)
    ) {
      const mask = selectionToFullMask(sel, W, H);
      state.patchDrag = {
        start: [x, y],
        mask,
        bbox: maskBBox(mask, W, H),
        edge: buildBoundaryPixels(mask, W, H),
        offset: [0, 0],
        src: null,
        preview: null
      };
      state.drawing = true;
      drawPatchOutline(ov, state.patchDrag);
      return;
    }
    state.patchDrag = null;
    TOOLS.lasso.onDown(ctx, ov, state, x, y);
  },
  onMove(ctx, ov, state, x, y) {
    if (!state.drawing) return;
    const drag = state.patchDrag;
    if (!drag) {
      TOOLS.lasso.onMove(ctx, ov, state, x, y);
      return;
    }
    const W = ctx.canvas.width,
      H = ctx.canvas.height;
    const offset = patchOffset(drag.start, [x, y], drag.bbox, W, H);
    if (offset[0] === drag.offset[0] && offset[1] === drag.offset[1]) return;
    drag.offset = offset;
    // PhotoCraft patch_preview display_doc: heal at the new offset, coarsely for large patches.
    // Release still commits the exact patchHeal.
    if (offset[0] || offset[1]) {
      drag.src ??= new Uint8ClampedArray(ctx.getImageData(0, 0, W, H).data);
      const mode = toolOpts(state, 'patch').patchMode;
      drag.preview = patchPreview(drag.src, W, H, drag.mask, offset[0], offset[1], mode);
    } else {
      drag.preview = null;
    }
    drawPatchOutline(ov, drag);
  },
  onUp(ctx, ov, state, x, y) {
    const drag = state.patchDrag;
    if (!drag) {
      finishLasso(ctx, ov, state, 0);
      return;
    }
    state.drawing = false;
    state.patchDrag = null;
    ov.clearRect(0, 0, ov.canvas.width, ov.canvas.height);
    const W = ctx.canvas.width,
      H = ctx.canvas.height;
    const [dx, dy] = x == null ? drag.offset : patchOffset(drag.start, [x, y], drag.bbox, W, H);
    if (!dx && !dy) return;
    state.pushUndo?.('Patch');
    // A float is already drawn on the layer; drop its baseData (see gradient).
    if (state.sel?.data) {
      state.sel.data = null;
      state.sel.baseData = null;
    }
    const img = ctx.getImageData(0, 0, W, H);
    const src = new Uint8ClampedArray(img.data);
    const mode = toolOpts(state, 'patch').patchMode;
    putBox(ctx, img, patchHeal(img.data, src, W, H, drag.mask, dx, dy, mode));
  }
};

// Spot Healing Brush (PhotoCraft spotHealing, Type: Proximity Match). A stroke only builds up
// coverage, shown as a translucent trail on the overlay; pointer up heals the whole stroke once
// (spotHealStroke).
function spotHealSegment(ov, st, x0, y0, x1, y1) {
  const { cov, W, H, radius, hardness } = st;
  dabSegment(x0, y0, x1, y1, Math.max(1, radius / 4), (cx, cy) =>
    coverageDab(cov, W, H, cx, cy, radius, hardness)
  );
  ov.save();
  ov.strokeStyle = 'rgba(0, 0, 0, 0.35)';
  ov.lineWidth = radius * 2;
  ov.lineCap = 'round';
  ov.beginPath();
  ov.moveTo(x0, y0);
  ov.lineTo(x1, y1);
  ov.stroke();
  ov.restore();
}

const spotHealingTool = {
  label: 'Spot Healing Brush',
  icon: 'bandage',
  cursor: 'crosshair',
  onDown(ctx, ov, state, x, y) {
    state.drawing = true;
    const opts = toolOpts(state, 'spotHealing');
    const W = ctx.canvas.width,
      H = ctx.canvas.height;
    const sel = state.sel;
    const mask = sel && sel.mode === 'active' ? selectionToFullMask(sel, W, H) : null;
    state.pushUndo?.('Spot Healing Brush');
    // A float is already drawn on the layer; drop its baseData (see gradient).
    if (sel?.data) {
      sel.data = null;
      sel.baseData = null;
    }
    const size = opts.size ?? state.brushSize;
    state.spotStroke = {
      W,
      H,
      cov: new Float32Array(W * H),
      mask,
      size,
      radius: Math.max(0.5, size / 2),
      hardness: (opts.hardness ?? 80) / 100,
      lastX: x,
      lastY: y
    };
    spotHealSegment(ov, state.spotStroke, x, y, x, y);
  },
  onMove(ctx, ov, state, x, y) {
    const st = state.spotStroke;
    if (!state.drawing || !st) return;
    spotHealSegment(ov, st, st.lastX, st.lastY, x, y);
    st.lastX = x;
    st.lastY = y;
  },
  onUp(ctx, ov, state) {
    const st = state.spotStroke;
    if (st) {
      const img = ctx.getImageData(0, 0, st.W, st.H);
      const src = new Uint8ClampedArray(img.data);
      putBox(ctx, img, spotHealStroke(img.data, src, st.W, st.H, st.cov, st.size, st.mask));
    }
    state.drawing = false;
    state.spotStroke = null;
    ov.clearRect(0, 0, ov.canvas.width, ov.canvas.height);
  }
};

// Red Eye (PhotoCraft paint.redEye). One click corrects the red pupil nearest the click
// (redEyeFix); a miss pushes no undo and shows a hint.
const RED_EYE_HINT = 'No red-eye pixels near the click';

const redEyeTool = {
  label: 'Red Eye',
  icon: 'eye',
  cursor: 'crosshair',
  onDown(ctx, ov, state, x, y) {
    const opts = toolOpts(state, 'redEye');
    const W = ctx.canvas.width,
      H = ctx.canvas.height;
    const sel = state.sel;
    const mask = sel && sel.mode === 'active' ? selectionToFullMask(sel, W, H) : null;
    const img = ctx.getImageData(0, 0, W, H);
    const n = redEyeFix(img.data, W, H, x, y, opts.pupilSize ?? 50, opts.darken ?? 50, mask);
    if (!n) {
      drawCloneHint(ov, x, y, RED_EYE_HINT);
      return;
    }
    ov.clearRect(0, 0, ov.canvas.width, ov.canvas.height);
    state.pushUndo?.('Red Eye');
    // A float is already drawn on the layer; drop its baseData (see gradient).
    if (sel?.data) {
      sel.data = null;
      sel.baseData = null;
    }
    ctx.putImageData(img, 0, 0);
  },
  onMove() {},
  onUp() {}
};

// Pattern Stamp (PhotoCraft paint.patternStamp, aligned strokes). Paints state.pattern, or a
// fg / bg checkerboard before Edit > Define Pattern, through the round tip (patternDab). Aligned
// anchors the tile at the document origin; unaligned restarts it at each stroke's first point.
function patternStampSegment(ctx, st, x0, y0, x1, y1) {
  const { img, base, tile, cov, mask, radius, hardness, opacity, phaseX, phaseY, scale } = st;
  const W = img.width,
    H = img.height;
  const box = dabSegment(x0, y0, x1, y1, Math.max(1, radius / 4), (cx, cy) =>
    patternDab(
      img.data,
      base,
      tile.data,
      tile.width,
      tile.height,
      W,
      H,
      cx,
      cy,
      radius,
      hardness,
      opacity,
      phaseX,
      phaseY,
      scale,
      mask,
      cov
    )
  );
  putBox(ctx, img, box);
}

const patternStampTool = {
  label: 'Pattern Stamp',
  icon: 'grid-3x3',
  cursor: 'crosshair',
  onDown(ctx, ov, state, x, y) {
    state.drawing = true;
    const opts = toolOpts(state, 'patternStamp');
    const W = ctx.canvas.width,
      H = ctx.canvas.height;
    const sel = state.sel;
    const mask = sel && sel.mode === 'active' ? selectionToFullMask(sel, W, H) : null;
    const tile =
      state.pattern ??
      checkerPattern(hexToRgba(state.color), hexToRgba(state.bgColor ?? '#ffffff'));
    const aligned = opts.aligned !== false;
    state.pushUndo?.('Pattern Stamp');
    // A float is already drawn on the layer; drop its baseData (see gradient).
    if (sel?.data) {
      sel.data = null;
      sel.baseData = null;
    }
    const img = ctx.getImageData(0, 0, W, H);
    state.patternStroke = {
      img,
      base: new Uint8ClampedArray(img.data),
      tile,
      cov: new Float32Array(W * H),
      mask,
      radius: Math.max(0.5, (opts.size ?? state.brushSize) / 2),
      hardness: (opts.hardness ?? 80) / 100,
      opacity: (opts.opacity ?? 100) / 100,
      phaseX: aligned ? 0 : x,
      phaseY: aligned ? 0 : y,
      scale: (opts.scale ?? 100) / 100,
      lastX: x,
      lastY: y
    };
    patternStampSegment(ctx, state.patternStroke, x, y, x, y);
  },
  onMove(ctx, ov, state, x, y) {
    const st = state.patternStroke;
    if (!state.drawing || !st) return;
    patternStampSegment(ctx, st, st.lastX, st.lastY, x, y);
    st.lastX = x;
    st.lastY = y;
  },
  onUp(ctx, ov, state) {
    state.drawing = false;
    state.patternStroke = null;
  }
};

// History Brush (PhotoCraft paint.historyBrush). Paints the active layer's history source,
// state.historySource.get(layer id), back over the pre-stroke pixels (historyDab). Without a
// snapshot of the right size the stroke does nothing and shows a hint.
const HISTORY_HINT = 'No History Brush source for this layer';

function historyBrushSource(state, W, H) {
  const layer = state.layers?.[state.activeLayerIdx];
  const snap = layer && state.historySource?.get(layer.id);
  return snap && snap.width === W && snap.height === H ? snap.data : null;
}

function historyBrushSegment(ctx, st, x0, y0, x1, y1) {
  const { img, base, source, cov, mask, radius, hardness, opacity } = st;
  const W = img.width,
    H = img.height;
  const box = dabSegment(x0, y0, x1, y1, Math.max(1, radius / 4), (cx, cy) =>
    historyDab(img.data, base, source, W, H, cx, cy, radius, hardness, opacity, mask, cov)
  );
  putBox(ctx, img, box);
}

const historyBrushTool = {
  label: 'History Brush',
  icon: 'clock',
  cursor: 'crosshair',
  onDown(ctx, ov, state, x, y) {
    state.drawing = true;
    const W = ctx.canvas.width,
      H = ctx.canvas.height;
    const source = historyBrushSource(state, W, H);
    if (!source) {
      state.historyStroke = null;
      drawCloneHint(ov, x, y, HISTORY_HINT);
      return;
    }
    const opts = toolOpts(state, 'historyBrush');
    const sel = state.sel;
    const mask = sel && sel.mode === 'active' ? selectionToFullMask(sel, W, H) : null;
    state.pushUndo?.('History Brush');
    // A float is already drawn on the layer; drop its baseData (see gradient).
    if (sel?.data) {
      sel.data = null;
      sel.baseData = null;
    }
    const img = ctx.getImageData(0, 0, W, H);
    state.historyStroke = {
      img,
      base: new Uint8ClampedArray(img.data),
      source,
      cov: new Float32Array(W * H),
      mask,
      radius: Math.max(0.5, (opts.size ?? state.brushSize) / 2),
      hardness: (opts.hardness ?? 80) / 100,
      opacity: (opts.opacity ?? 100) / 100,
      lastX: x,
      lastY: y
    };
    historyBrushSegment(ctx, state.historyStroke, x, y, x, y);
  },
  onMove(ctx, ov, state, x, y) {
    if (!state.drawing) return;
    const st = state.historyStroke;
    if (!st) {
      drawCloneHint(ov, x, y, HISTORY_HINT);
      return;
    }
    historyBrushSegment(ctx, st, st.lastX, st.lastY, x, y);
    st.lastX = x;
    st.lastY = y;
  },
  onUp(ctx, ov, state) {
    state.drawing = false;
    state.historyStroke = null;
    ov.clearRect(0, 0, ov.canvas.width, ov.canvas.height);
  }
};

/**
 * Offset RGBA pixels by (dx, dy), like PhotoCraft's Move tool on a layer. Pixels shifted
 * off the canvas are dropped; vacated pixels get `fill` ([r, g, b, a], transparent by default).
 * Returns a new Uint8ClampedArray of length W * H * 4.
 */
export function offsetLayerPixels(src, W, H, dx, dy, fill = [0, 0, 0, 0]) {
  const out = new Uint8ClampedArray(W * H * 4);
  dx = Math.round(dx);
  dy = Math.round(dy);
  if (fill[0] || fill[1] || fill[2] || fill[3]) {
    for (let p = 0; p < out.length; p += 4) {
      out[p] = fill[0];
      out[p + 1] = fill[1];
      out[p + 2] = fill[2];
      out[p + 3] = fill[3];
    }
  }
  const x0 = Math.max(0, dx);
  const x1 = Math.min(W, W + dx);
  if (x1 <= x0) return out;
  for (let y = Math.max(0, dy); y < Math.min(H, H + dy); y++) {
    const from = ((y - dy) * W + (x0 - dx)) * 4;
    out.set(src.subarray(from, from + (x1 - x0) * 4), (y * W + x0) * 4);
  }
  return out;
}

// The marquee box for the current drag point from the tool's Style options. Shift squares the
// box only in Normal, as PhotoCraft's marquee_end does.
function marqueeBox(state, toolId, x, y) {
  const o = toolOpts(state, toolId);
  const style = o.marqueeStyle ?? 'normal';
  const pt =
    style === 'normal' && state.shiftKey
      ? state.constrainSquare?.(state.startX, state.startY, x, y) || { x, y }
      : { x, y };
  return marqueeRect(
    style,
    o.marqueeWidth ?? 1,
    o.marqueeHeight ?? 1,
    state.startX,
    state.startY,
    pt.x,
    pt.y
  );
}

// Fixed Size places its box on a plain click; the other styles need a 2px drag.
function marqueeTooSmall(state, toolId, sel) {
  if (toolOpts(state, toolId).marqueeStyle === 'fixedSize') return sel.w < 1 || sel.h < 1;
  return sel.w < 2 || sel.h < 2;
}

function drawEllipseMarquee(ov, sel) {
  ov.clearRect(0, 0, ov.canvas.width, ov.canvas.height);
  ov.strokeStyle = '#fff';
  ov.lineWidth = 1;
  ov.setLineDash([4, 4]);
  ov.beginPath();
  ov.ellipse(
    sel.x + sel.w / 2,
    sel.y + sel.h / 2,
    Math.max(sel.w / 2, 0.5),
    Math.max(sel.h / 2, 0.5),
    0,
    0,
    Math.PI * 2
  );
  ov.stroke();
  ov.setLineDash([]);
}

// Point sel's box at the line a single-row / single-column marquee selects under (x, y).
function placeSingleLine(sel, toolId, x, y, W, H) {
  const line = singleLinePx(toolId, x, y, W, H);
  if (!line) return false;
  sel.x = line[0];
  sel.y = line[1];
  sel.w = line[2] - line[0];
  sel.h = line[3] - line[1];
  return true;
}

// Single Row / Single Column Marquee: the line follows the pointer until release
// (PhotoCraft single_line_drag_px) and a click selects it, never deselects.
function singleLineMarquee(toolId, label, icon) {
  return {
    label,
    icon,
    cursor: 'crosshair',
    onDown(ctx, ov, state, x, y) {
      const sel = state.sel;
      const combine = !!selectionMode(state);
      if (!combine && state.tryBeginMove?.(state, ctx, x, y)) return;
      if (!combine) state.commitSelection?.();
      if (!placeSingleLine(sel, toolId, x, y, ctx.canvas.width, ctx.canvas.height)) return;
      sel.mode = 'drawing';
      if (!combine) {
        sel.data = null;
        sel.mask = null;
        sel.baseData = null;
      }
      state.drawing = true;
    },
    onMove(ctx, ov, state, x, y) {
      const sel = state.sel;
      if (sel.mode !== 'drawing' || !state.drawing) return;
      placeSingleLine(sel, toolId, x, y, ctx.canvas.width, ctx.canvas.height);
    },
    onUp(ctx, ov, state, x, y) {
      const sel = state.sel;
      if (sel.mode !== 'drawing') return;
      state.drawing = false;
      const W = ctx.canvas.width,
        H = ctx.canvas.height;
      placeSingleLine(sel, toolId, x, y, W, H);
      const feather = toolOpts(state, toolId).feather;
      commitToolSelection(
        state,
        marqueeMask('rect', sel, W, H, feather),
        W,
        H,
        selectionMode(state)
      );
    }
  };
}

// Magnetic Lasso options in document units: Width px, Contrast 0..1, auto-fasten spacing.
function magneticSettings(state) {
  const o = toolOpts(state, 'magneticLasso');
  const width = Number(o.width) || 10;
  const contrast = (Number(o.contrast) || 10) / 100;
  const frequency = o.frequency == null ? 57 : Number(o.frequency);
  return { width, contrast, spacing: magneticSpacing(frequency, state.zoom || 1) };
}

// The live wire from the last fastening point to the edge near (x, y); points fasten by
// themselves each time the live wire runs past the Frequency spacing.
export function magneticFollow(state, x, y) {
  const m = state.magnetic;
  const o = magneticSettings(state);
  const target = snapToEdge(m.edges, m.W, m.H, x, y, o.width, o.contrast);
  for (let guard = 0; guard < 256; guard++) {
    const from = m.path[m.path.length - 1];
    m.live = liveWire(m.edges, m.W, m.H, from, target, o.width, o.contrast);
    if (pathLength(m.live) <= o.spacing) return;
    let len = 0,
      k = 1;
    for (; k < m.live.length - 1; k++) {
      len += Math.hypot(m.live[k][0] - m.live[k - 1][0], m.live[k][1] - m.live[k - 1][1]);
      if (len >= o.spacing) break;
    }
    m.live = m.live.slice(0, k + 1);
    magneticFasten(m);
  }
}

// Fasten the live wire's end: its points join the border and the end becomes an anchor.
function magneticFasten(m) {
  if (m.live.length < 2) return;
  for (const p of m.live.slice(1)) m.path.push(p);
  m.anchors.push(m.path.length - 1);
  m.live = [];
}

function drawMagnetic(ov, m) {
  const pts = m.path.concat(m.live.slice(1));
  const [x, y] = pts[pts.length - 1];
  drawPolyPreview(ov, pts, x, y);
  ov.fillStyle = '#fff';
  for (const i of m.anchors) ov.fillRect(m.path[i][0] - 2, m.path[i][1] - 2, 4, 4);
}

// One Quick Selection dab of the current stroke: add (or subtract) the pixels it newly takes.
function quickDab(state, x, y) {
  const q = state.quickStroke;
  const size = Number(toolOpts(state, 'quickSelection').size) || 30;
  const got = quickSelectDab(q.img, q.edges, x, y, size, q.taken);
  if (!got) return;
  let any = false;
  for (let p = 0; p < got.length; p++) {
    if (!got[p]) continue;
    q.taken[p] = 1;
    any = true;
  }
  if (!any) return;
  const mode = q.first ? q.mode : q.mode === 'subtract' ? 'subtract' : 'add';
  q.first = false;
  commitToolSelection(state, got, q.img.width, q.img.height, mode);
}

// The selection tools' effective combine mode: held modifiers, then the options-bar choice.
function selectionMode(state) {
  return resolveSelectionMode(state.selectionMode, state);
}

// Build the default state.toolOptions object from the schema.
export function defaultToolOptions() {
  const out = {};
  for (const [tool, opts] of Object.entries(TOOL_OPTION_SCHEMA)) {
    out[tool] = {};
    for (const o of opts) {
      // The shared selection mode lives on state.selectionMode, not per tool.
      if (
        ['hint', 'readout', 'iconAction', 'action', 'iconMenu'].includes(o.type) ||
        o === SELECTION_MODE_OPTION
      ) {
        continue;
      }
      out[tool][o.key] = o.default;
    }
  }
  return out;
}

// The Crop options-bar ratio (width / height) for a W x H document, or null (crop_ui.rs
// preset_ratio). W x H mode holds the target's w / h; without both fields the frame is free.
function cropOptionRatio(state, W, H) {
  const opts = state.toolOptions?.crop ?? {};
  if (opts.ratio === CROP_WXH) {
    const t = cropTargetSize(opts.cropW, opts.cropH);
    return t ? t.w / t.h : null;
  }
  return cropRatio(opts.ratio ?? '', W, H);
}

/** The Crop options-bar ratio for the document the overlay covers, or null. */
/**
 * The guides the pending crop frame shows now (crop_overlay.rs current_guides): frame-local px,
 * none when the Show option says not to (Auto shows them only while state.cropDrag is set).
 */
export function cropToolGuides(state) {
  const opts = state.toolOptions?.crop ?? {};
  const f = state.cropFrame;
  if (!f || !cropOverlayShows(opts.cropOverlayShow ?? 'auto', !!state.cropDrag)) return [];
  const zoom = state.zoom || 1;
  const orient = opts.cropOverlayOrientation ?? 0;
  return cropGuides(opts.cropOverlay ?? 'thirds', orient, f[2] - f[0], f[3] - f[1], zoom);
}

/** The pending frame as a crop box history step (crop_ui.rs step_of), the frame copied. */
function cropStep(state) {
  const f = state.cropFrame;
  return {
    frame: f ? f.slice() : null,
    angle: state.cropAngle || 0,
    isDefault: !!state.cropDefault
  };
}

/**
 * On release, the step from the press goes on the crop box Undo stack and Redo clears, when the
 * gesture changed the frame (crop_ui.rs push_press_step).
 */
function pushCropStep(state, before) {
  const now = cropStep(state);
  const a = before.frame;
  const b = now.frame;
  const sameFrame = a === b || (a && b && a.every((v, i) => v === b[i]));
  if (sameFrame && before.angle === now.angle && before.isDefault === now.isDefault) return;
  (state.cropUndo ??= []).push({ ...before, frame: a ? a.slice() : null });
  state.cropRedo = [];
  state.onCropHistory?.();
}

/** The Crop options as a crop_shield.rs CropShield (cropShieldFill's first argument). */
export function cropToolShield(state) {
  const opts = state.toolOptions?.crop ?? {};
  const d = CROP_SHIELD_DEFAULTS;
  return {
    showCroppedArea: opts.cropShieldShow ?? d.showCroppedArea,
    enabled: opts.cropShield ?? d.enabled,
    color: opts.cropShieldColor ?? d.color,
    customColor: opts.cropShieldCustom ?? d.customColor,
    opacity: opts.cropShieldOpacity ?? d.opacity,
    autoAdjust: opts.cropShieldAuto ?? d.autoAdjust
  };
}

// state.canvasRgb is the #canvas-area background (paint.js), black until it is read.
function drawCropTool(ov, state) {
  const guides = cropToolGuides(state);
  const shade = cropShieldFill(
    cropToolShield(state),
    state.canvasRgb ?? [0, 0, 0],
    !!state.cropDrag
  );
  drawCropOverlay(ov, state.cropFrame, state.zoom, state.cropAngle || 0, guides, shade);
  const px = 1 / (state.zoom || 1);
  const rows = cropDragReadout(state);
  if (rows) drawReadout(ov, rows, state.cropDrag.x, state.cropDrag.y, px);
  const line = state.cropStraightenLine;
  if (!line) return;
  // The Straighten line: a dark 3 px stroke under a light 1 px one (crop_straighten.rs draw).
  for (const [color, w] of [
    ['rgba(0, 0, 0, 0.6)', 3],
    ['#fff', 1]
  ]) {
    ov.strokeStyle = color;
    ov.lineWidth = w * px;
    ov.beginPath();
    ov.moveTo(line[0][0], line[0][1]);
    ov.lineTo(line[1][0], line[1][1]);
    ov.stroke();
  }
  // The line's own angle beside its end (crop_straighten.rs draw, canvas::angle_readout).
  const [dx, dy] = [line[1][0] - line[0][0], line[1][1] - line[0][1]];
  const deg = (Math.atan2(-dy, dx) * 180) / Math.PI;
  if ((dx === 0 && dy === 0) || !Number.isFinite(deg)) return;
  drawReadout(ov, [`Angle: ${cropAngleReadout(deg)}`], line[1][0], line[1][1], px);
}

/**
 * The frame's readout rows while it is dragged (crop_ui.rs sizing, turning): W and H while a
 * draw has moved off its anchor or a handle resizes it, the Angle while it turns, else none.
 */
function cropDragReadout(state) {
  const drag = state.cropDrag;
  if (!drag || drag.x === undefined || !state.cropFrame) return null;
  if (drag.hit === 'turn') return [`Angle: ${cropAngleReadout(state.cropAngle || 0)}`];
  if (drag.hit === 'inside') return null;
  if (drag.hit === 'draw' && drag.x === drag.x0 && drag.y === drag.y0) return null;
  const size = cropFrameSize(state.cropFrame);
  return size && [`W: ${size[0]} px`, `H: ${size[1]} px`];
}

/**
 * Readout rows beside the pointer (x, y) at a constant screen size, px being one screen pixel
 * in document units: a dark stroke under light text (canvas::draw_readout).
 */
function drawReadout(ov, rows, x, y, px) {
  ov.font = `${11.5 * px}px sans-serif`;
  ov.textBaseline = 'middle';
  ov.lineWidth = 3 * px;
  ov.strokeStyle = 'rgba(0, 0, 0, 0.6)';
  ov.fillStyle = '#fff';
  rows.forEach((text, i) => {
    const [tx, ty] = [x + 14 * px, y + (18 + 14 * i) * px];
    ov.strokeText(text, tx, ty);
    ov.fillText(text, tx, ty);
  });
}

// ── Perspective Crop (perspective_crop_ui.rs inside, draw_overlay, grid_steps) ──────────────

// The click markers' accent (brand.css --accent-blue).
const PERSPECTIVE_ACCENT = '#1a73e8';

// A press and release within this share of the corner reach is a click (perspective_crop_ui.rs
// CLICK_PX / 8).
const PERSPECTIVE_CLICK = 3 / 8;

/** Whether (x, y) lies inside quad (TL, TR, BR, BL, clockwise on screen). */
function quadContains(q, x, y) {
  return q.every((a, i) => {
    const b = q[(i + 1) % 4];
    return (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) >= 0;
  });
}

/** The box a drag from a to b spans as a quad, or null when it has no width or no height. */
function boxQuad(a, b) {
  const [x0, y0] = [Math.min(a[0], b[0]), Math.min(a[1], b[1])];
  const [x1, y1] = [Math.max(a[0], b[0]), Math.max(a[1], b[1])];
  if (!(x1 > x0 && y1 > y0)) return null;
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1]
  ];
}

/**
 * Four clicked corners in TL, TR, BR, BL order (perspective_crop_ui.rs ordered): sorted by
 * atan2 about their centroid (clockwise on screen, y grows down), then rotated so the point
 * with the least x + y comes first.
 */
export function perspectiveOrdered(points) {
  const cx = points.reduce((s, p) => s + p[0], 0) / points.length;
  const cy = points.reduce((s, p) => s + p[1], 0) / points.length;
  const angle = (p) => Math.atan2(p[1] - cy, p[0] - cx);
  const v = points.map((p) => p.slice()).sort((a, b) => angle(a) - angle(b));
  let first = 0;
  v.forEach((p, i) => {
    if (p[0] + p[1] < v[first][0] + v[first][1]) first = i;
  });
  return [...v.slice(first), ...v.slice(0, first)];
}

/**
 * The pending quad (or the box being drawn), its perspective grid, and its corner handles; red
 * while it is not a convexQuad. Grid lines per side grow with the quad's screen size; Show Grid
 * (pcropGrid) off leaves the outline and handles. Corners
 * clicked so far (state.perspectiveClicks) show as white dots joined by an accent line.
 */
export function drawPerspectiveCrop(ov, state) {
  ov.clearRect(0, 0, ov.canvas.width, ov.canvas.height);
  const zoom = state.zoom || 1;
  const px = 1 / zoom;
  const clicks = state.perspectiveClicks ?? [];
  if (clicks.length) {
    ov.save();
    ov.strokeStyle = PERSPECTIVE_ACCENT;
    if (clicks.length > 1) {
      ov.lineWidth = 1.5 * px;
      ov.beginPath();
      ov.moveTo(...clicks[0]);
      for (const c of clicks.slice(1)) ov.lineTo(...c);
      ov.stroke();
    }
    ov.fillStyle = '#fff';
    ov.lineWidth = 1.25 * px;
    for (const [cx, cy] of clicks) {
      ov.beginPath();
      ov.arc(cx, cy, 4 * px, 0, Math.PI * 2);
      ov.fill();
      ov.stroke();
    }
    ov.restore();
  }
  const drag = state.perspectiveDrag;
  const q = drag?.kind === 'new' ? boxQuad(drag.start, drag.cur) : state.perspectiveQuad;
  if (!q || q.flat().some((v) => !Number.isFinite(v))) return;
  const ok = convexQuad(q);
  const color = ok ? '#fff' : '#e53e3e';
  ov.save();
  const grid = state.toolOptions?.perspectiveCrop?.pcropGrid !== false;
  const m = ok && grid ? homographyFromQuad(q, 1, 1) : null;
  if (m) {
    const side = Math.max(
      ...q.map((a, i) => Math.hypot(...a.map((v, k) => v - q[(i + 1) % 4][k])))
    );
    const n = Math.min(12, Math.max(2, Math.round((side * zoom) / 48)));
    ov.lineWidth = 0.75 * px;
    ov.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ov.beginPath();
    for (let k = 1; k < n; k++) {
      const t = k / n;
      ov.moveTo(...applyHomography(m, t, 0));
      ov.lineTo(...applyHomography(m, t, 1));
      ov.moveTo(...applyHomography(m, 0, t));
      ov.lineTo(...applyHomography(m, 1, t));
    }
    ov.stroke();
  }
  ov.lineWidth = 1.5 * px;
  ov.strokeStyle = color;
  ov.beginPath();
  ov.moveTo(...q[0]);
  for (const c of q.slice(1)) ov.lineTo(...c);
  ov.closePath();
  ov.stroke();
  if (drag?.kind !== 'new') {
    const s = 8 * px;
    ov.fillStyle = '#fff';
    ov.strokeStyle = ok ? '#000' : color;
    ov.lineWidth = 1.25 * px;
    for (const [cx, cy] of q) {
      ov.fillRect(cx - s / 2, cy - s / 2, s, s);
      ov.strokeRect(cx - s / 2, cy - s / 2, s, s);
    }
  }
  ov.restore();
}

/** PhotoCraft analysis_cmds round4: four decimals, half away from zero, never −0. */
const round4 = (v) => Math.sign(v) * (Math.round(Math.abs(v) * 1e4) / 1e4) + 0;

/**
 * Ruler readout (PhotoCraft analysis_cmds ruler_info): (x, y) is the start, (w, h) the end minus
 * the start, l1 the length. Without a protractor the angle is counter-clockwise from +x with y up
 * (−180..180) and l2 is null; with one it is the angle between the two arms (0..180) and l2 the
 * protractor arm's length. Angle and lengths are rounded to 4 decimals.
 */
export function rulerInfo(ruler) {
  const [x, y] = ruler.start;
  const w = ruler.end[0] - x;
  const h = ruler.end[1] - y;
  const l1 = round4(Math.hypot(w, h));
  const q = ruler.protractor;
  if (!q) return { x, y, w, h, angle: round4((Math.atan2(-h, w) * 180) / Math.PI), l1, l2: null };
  const [ex, ey] = [q[0] - x, q[1] - y];
  let angle = Math.abs(((Math.atan2(-h, w) - Math.atan2(-ey, ex)) * 180) / Math.PI);
  if (angle > 180) angle = 360 - angle;
  return { x, y, w, h, angle: round4(angle), l1, l2: round4(Math.hypot(ex, ey)) };
}

/**
 * Straighten Layer's turn (PhotoCraft analysis_cmds straighten_angle): the clockwise degrees
 * that bring the ruler line onto its nearest axis. The protractor is ignored.
 */
export function straightenAngle(ruler) {
  const a =
    (Math.atan2(-(ruler.end[1] - ruler.start[1]), ruler.end[0] - ruler.start[0]) * 180) / Math.PI;
  return a - 90 * Math.round(a / 90);
}

// Shift constrains `to` to 45° steps around `from` (analysis_ui.rs constrain).
function rulerConstrain(from, to, shift) {
  if (!shift) return to;
  const [dx, dy] = [to[0] - from[0], to[1] - from[1]];
  const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  const l = Math.hypot(dx, dy);
  return [from[0] + l * Math.cos(a), from[1] + l * Math.sin(a)];
}

// Count tool hit radius in screen px (analysis_ui.rs tolerance).
const COUNT_HIT_PX = 7;

/** Clear the overlay and draw the count markers (state.count). */
export function drawCount(ov, state) {
  ov.clearRect(0, 0, ov.canvas.width, ov.canvas.height);
  drawCountMarkers(ov, state.count, state.zoom);
}

/** Clear the overlay and draw the Color Sampler points (state.samplers). */
export function drawSamplers(ov, state) {
  ov.clearRect(0, 0, ov.canvas.width, ov.canvas.height);
  drawSamplerMarkers(ov, state.samplers, state.zoom);
}

/** Clear the overlay and draw the notes (state.notes), the selected one outlined. */
export function drawNotes(ov, state) {
  ov.clearRect(0, 0, ov.canvas.width, ov.canvas.height);
  drawNoteMarkers(ov, state.notes, state.zoom, state.noteSelected ?? -1);
}

/** Clear the overlay and draw the ruler line (state.ruler), if any. */
export function drawRuler(ov, state) {
  ov.clearRect(0, 0, ov.canvas.width, ov.canvas.height);
  strokeRuler(ov, state);
}

/** The ruler line with a cross at each end: dark under white, sized in screen px (draw_overlay). */
export function strokeRuler(ov, state) {
  const r = state.ruler;
  if (!r) return;
  const px = 1 / (state.zoom || 1);
  const arm = 5 * px;
  ov.save();
  for (const [width, color] of [
    [3, 'rgba(0, 0, 0, 0.63)'],
    [1, '#fff']
  ]) {
    ov.lineWidth = width * px;
    ov.strokeStyle = color;
    ov.beginPath();
    const ends = r.protractor ? [r.end, r.protractor] : [r.end];
    for (const q of ends) {
      ov.moveTo(...r.start);
      ov.lineTo(...q);
    }
    for (const [cx, cy] of [r.start, ...ends]) {
      ov.moveTo(cx - arm, cy);
      ov.lineTo(cx + arm, cy);
      ov.moveTo(cx, cy - arm);
      ov.lineTo(cx, cy + arm);
    }
    ov.stroke();
  }
  ov.restore();
}

export function cropToolRatio(ov, state) {
  return cropOptionRatio(state, ov.canvas.width, ov.canvas.height);
}

/** The W x H mode's output size { w, h } while it is picked and both fields are set, or null. */
export function cropToolTarget(state) {
  const opts = state.toolOptions?.crop ?? {};
  return opts.ratio === CROP_WXH ? cropTargetSize(opts.cropW, opts.cropH) : null;
}

/**
 * PhotoCraft pick_cmds.rs auto_select_target: the index of the topmost visible pixel layer with a
 * non-transparent pixel at (x, y), its mask (when enabled) not hiding it, or -1.
 */
export function autoSelectLayerAt(layers, x, y) {
  const px = Math.floor(x),
    py = Math.floor(y);
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    if (!layer.visible || (layer.kind ?? 'pixel') !== 'pixel') continue;
    const { width: W, height: H } = layer.canvas;
    if (px < 0 || py < 0 || px >= W || py >= H) continue;
    if (layer.mask && layer.maskEnabled !== false && !layer.mask[py * W + px]) continue;
    if (layer.ctx.getImageData(px, py, 1, 1).data[3] > 0) return i;
  }
  return -1;
}

/**
 * A Shape tool's options with its wells: Fill takes the foreground, Stroke the background
 * (shape_options.rs swatch fg / bg), as PhotoCraft's options bar shows them.
 */
export function shapeToolOptions(state, id) {
  return { ...toolOpts(state, id), fillColor: state.color, strokeColor: state.bgColor };
}

// The shape record a Shape tool drag from (startX, startY) to (x, y) makes, or null.
function dragShape(state, id, x, y) {
  const pt =
    id === 'line' && state.shiftKey
      ? state.constrainLine?.(state.startX, state.startY, x, y) || { x, y }
      : { x, y };
  return shapeFromDrag(id, shapeToolOptions(state, id), state.startX, state.startY, pt.x, pt.y, {
    square: !!state.shiftKey && id !== 'line',
    custom: state.customShapes ?? []
  });
}

function shapeTool(id, label, icon) {
  return {
    label,
    icon,
    cursor: 'crosshair',
    onDown(ctx, ov, state, x, y) {
      state.drawing = true;
      state.startX = x;
      state.startY = y;
    },
    onMove(ctx, ov, state, x, y) {
      if (!state.drawing) return;
      ov.clearRect(0, 0, ov.canvas.width, ov.canvas.height);
      const shape = dragShape(state, id, x, y);
      if (!shape) return;
      ov.save();
      ov.globalAlpha = 1;
      renderShape(ov, shape);
      // The path outline, so a shape with no fill or stroke still shows where it goes.
      ov.strokeStyle = '#378ef0';
      ov.lineWidth = 1 / (state.zoom || 1);
      tracePath(ov, shape.path);
      ov.stroke();
      ov.restore();
    },
    onUp(ctx, ov, state, x, y) {
      if (!state.drawing) return;
      state.drawing = false;
      ov.clearRect(0, 0, ov.canvas.width, ov.canvas.height);
      const shape = dragShape(state, id, x, y);
      if (shape) state.addShapeLayer?.(id, shape);
    }
  };
}

export const TOOLS = {
  // PhotoCraft Move tool (id stays 'select' for shortcuts) — first in the toolbar.
  // Moves the object, selection, or layer under the pointer.
  select: {
    label: 'Move',
    icon: 'move',
    cursor: 'move',
    onDown(ctx, ov, state, x, y) {
      if (toolOpts(state, 'select').autoSelect) {
        const idx = autoSelectLayerAt(state.layers ?? [], x, y);
        if (idx >= 0 && idx !== state.activeLayerIdx) state.setActiveLayer?.(idx);
      }
      state.beginObjectSelect?.(x, y);
    },
    onMove(ctx, ov, state, x, y) {
      state.dragObjectSelect?.(x, y);
    },
    onUp(ctx, ov, state, x, y) {
      state.endObjectSelect?.(x, y);
    }
  },

  pencil: {
    label: 'Pencil',
    icon: 'pencil',
    cursor: 'crosshair',
    // PhotoCraft's aliased brush: every pixel is fully painted or untouched, and one stroke never
    // paints past Opacity. Auto Erase picks the colour from the pixel under the first dab.
    onDown(ctx, ov, state, x, y) {
      state.drawing = true;
      state.stabX = x;
      state.stabY = y;
      state.lastX = x;
      state.lastY = y;
      const opts = toolOpts(state, 'pencil');
      const W = ctx.canvas.width,
        H = ctx.canvas.height;
      const img = ctx.getImageData(0, 0, W, H);
      const fg = hexToRgba(state.activeColor ?? '#000000').slice(0, 3);
      const bg = hexToRgba(state.bgColor ?? '#ffffff').slice(0, 3);
      state.pencilStroke = {
        img,
        src: new Uint8ClampedArray(img.data),
        cov: new Float32Array(W * H),
        mask: strokeSelectionMask(state, W, H),
        size: Math.max(1, Math.round(pressureSize(state, opts.size ?? 1))),
        opacity: Math.max(0, Math.min(100, opts.opacity ?? 100)) / 100,
        rgb: opts.autoErase ? autoEraseColor(img.data, W, H, x, y, fg, bg) : fg,
        lockAlpha: !!opts.lockAlpha
      };
      pencilSegment(ctx, state.pencilStroke, x, y, x, y);
    },
    onMove(ctx, ov, state, x, y) {
      const st = state.pencilStroke;
      if (!state.drawing || !st) return;
      const opts = toolOpts(state, 'pencil');
      const pt = stabilizePoint(state, x, y, opts.smoothing);
      st.size = Math.max(1, Math.round(pressureSize(state, opts.size ?? 1)));
      pencilSegment(ctx, st, state.lastX, state.lastY, pt.x, pt.y);
      state.lastX = pt.x;
      state.lastY = pt.y;
    },
    onUp(ctx, ov, state) {
      state.drawing = false;
      state.pencilStroke = null;
      state.stabX = null;
      state.stabY = null;
    }
  },

  brush: {
    label: 'Brush',
    icon: 'brush',
    cursor: 'crosshair',
    // The Brush Settings tip: coverage builds up with Flow per stroke and every dab rewrites the
    // layer from the pre-stroke pixels, so one stroke never paints past Opacity.
    onDown(ctx, ov, state, x, y) {
      state.drawing = true;
      state.stabX = x;
      state.stabY = y;
      state.lastX = x;
      state.lastY = y;
      const opts = toolOpts(state, 'brush');
      const W = ctx.canvas.width,
        H = ctx.canvas.height;
      const img = ctx.getImageData(0, 0, W, H);
      const pct = (v, d) => Math.max(0, Math.min(100, v ?? d)) / 100;
      state.paintStroke = {
        img,
        src: new Uint8ClampedArray(img.data),
        cov: new Float32Array(W * H),
        mask: strokeSelectionMask(state, W, H),
        size: Math.max(1, pressureSize(state, opts.size ?? 20)),
        hardness: pct(opts.hardness, 100),
        flow: pct(opts.flow, 100),
        opacity: pct(opts.opacity, 100),
        rgb: hexToRgba(state.activeColor ?? '#000000').slice(0, 3),
        lockAlpha: !!opts.lockAlpha,
        builder: dabBuilder(brushSettingsOf(state.brushSettings), strokeSeed(x, y)),
        walker: null
      };
      paintStroke(ctx, state.paintStroke, x, y);
    },
    onMove(ctx, ov, state, x, y) {
      const st = state.paintStroke;
      if (!state.drawing || !st) return;
      const opts = toolOpts(state, 'brush');
      const pt = stabilizePoint(state, x, y, opts.smoothing);
      st.size = Math.max(1, pressureSize(state, opts.size ?? 20));
      paintStroke(ctx, st, pt.x, pt.y);
      state.lastX = pt.x;
      state.lastY = pt.y;
    },
    onUp(ctx, ov, state) {
      state.drawing = false;
      state.paintStroke = null;
      state.stabX = null;
      state.stabY = null;
    }
  },

  // PhotoCraft paint.mixerBrush. The loaded paint (state.mixer) carries between strokes; undo is
  // pushed on down, before any pixel changes.
  mixerBrush: {
    label: 'Mixer Brush',
    icon: 'palette',
    cursor: 'crosshair',
    onDown(ctx, ov, state, x, y) {
      state.drawing = true;
      const opts = toolOpts(state, 'mixerBrush');
      const W = ctx.canvas.width,
        H = ctx.canvas.height;
      state.pushUndo?.('Mixer Brush');
      const mask = strokeSelectionMask(state, W, H);
      const pct = (v, d) => Math.max(0, Math.min(100, v ?? d)) / 100;
      const color = hexToRgba(state.activeColor ?? state.color ?? '#000000').map((v) => v / 255);
      color[3] = 1;
      state.mixer ??= mixerState();
      mixerBeginStroke(state.mixer, color);
      const img = ctx.getImageData(0, 0, W, H);
      const all = opts.sampleAllLayers && state.sampleVisible?.(W, H);
      state.mixerStroke = {
        img,
        work: rgbaWork(img),
        sample: all ? rgbaWork(all) : null,
        mask,
        radius: Math.max(0.5, (opts.size ?? 20) / 2),
        settings: {
          wet: pct(opts.wet, 50),
          load: pct(opts.load, 50),
          mix: pct(opts.mix, 50),
          flow: pct(opts.flow, 100)
        },
        color,
        clean: opts.cleanAfterStroke !== false,
        load: opts.loadAfterStroke !== false,
        lastX: x,
        lastY: y
      };
      mixerSegment(ctx, state, x, y, x, y);
    },
    onMove(ctx, ov, state, x, y) {
      const st = state.mixerStroke;
      if (!state.drawing || !st) return;
      mixerSegment(ctx, state, st.lastX, st.lastY, x, y);
      st.lastX = x;
      st.lastY = y;
    },
    onUp(ctx, ov, state) {
      state.drawing = false;
      const st = state.mixerStroke;
      if (st) mixerEndStroke(state.mixer, st.color, st.clean, st.load);
      state.mixerStroke = null;
    }
  },

  // PhotoCraft paint.colorReplacement. Undo is pushed on down, before any pixel changes.
  colorReplacement: {
    label: 'Color Replacement',
    icon: 'brush-replace',
    cursor: 'crosshair',
    onDown(ctx, ov, state, x, y) {
      state.drawing = true;
      const opts = toolOpts(state, 'colorReplacement');
      const W = ctx.canvas.width,
        H = ctx.canvas.height;
      const sel = state.sel;
      const mask = sel && sel.mode === 'active' ? selectionToFullMask(sel, W, H) : null;
      state.pushUndo?.('Color Replacement');
      // A float is already drawn on the layer; drop its baseData (see gradient).
      if (sel?.data) {
        sel.data = null;
        sel.baseData = null;
      }
      const img = ctx.getImageData(0, 0, W, H);
      const pre = new Uint8ClampedArray(img.data);
      const toRgb = (hex) =>
        hexToRgba(hex)
          .slice(0, 3)
          .map((v) => v / 255);
      let sample = null;
      if (opts.sampling === 'once') sample = samplePre(pre, W, H, x, y);
      else if (opts.sampling === 'background') sample = toRgb(state.bgColor ?? '#ffffff');
      state.replaceStroke = {
        img,
        pre,
        work: rgbaWork(img),
        mask,
        radius: Math.max(0.5, (opts.size ?? state.brushSize) / 2),
        hardness: (opts.hardness ?? 100) / 100,
        sample,
        fg: toRgb(state.color),
        mode: opts.mode ?? 'color',
        tol: (opts.tolerance ?? 30) / 100,
        antiAlias: opts.antiAlias !== false,
        contiguous: opts.limits !== 'discontiguous',
        lastX: x,
        lastY: y
      };
      colorReplaceSegment(ctx, state.replaceStroke, x, y, x, y);
    },
    onMove(ctx, ov, state, x, y) {
      const st = state.replaceStroke;
      if (!state.drawing || !st) return;
      colorReplaceSegment(ctx, st, st.lastX, st.lastY, x, y);
      st.lastX = x;
      st.lastY = y;
    },
    onUp(ctx, ov, state) {
      state.drawing = false;
      state.replaceStroke = null;
    }
  },

  eraser: {
    label: 'Eraser',
    icon: 'eraser',
    cursor: 'crosshair',
    onDown(ctx, ov, state, x, y) {
      const opts = toolOpts(state, 'eraser');
      const mode = opts.eraserMode ?? 'brush';
      state.drawing = true;
      state.lastX = x;
      state.lastY = y;
      state.eraserMode = mode;
      // Every mode snapshots the layer and rewrites from the pre-stroke pixels inside the
      // selection mask, so one stroke never erases past Opacity or outside the marquee.
      const W = ctx.canvas.width,
        H = ctx.canvas.height;
      const img = ctx.getImageData(0, 0, W, H);
      const stroke = {
        img,
        src: new Uint8ClampedArray(img.data),
        mask: strokeSelectionMask(state, W, H),
        opacity: Math.max(0, Math.min(100, opts.opacity ?? 100)) / 100,
        // The Background's transparency is locked: erasing paints the background colour.
        fill: erasesToBackground(state) ? hexToRgba(state.bgColor ?? '#ffffff').slice(0, 3) : null
      };
      if (mode !== 'brush') {
        // Block: a 16 / zoom square at full opacity. Pencil: an aliased Size square.
        stroke.cov = new Uint8Array(W * H);
        if (mode === 'block') {
          stroke.size = eraserBlockSize(state.zoom);
          stroke.opacity = 1;
        } else {
          stroke.size = Math.max(1, Math.round(pressureSize(state, opts.size ?? state.brushSize)));
        }
        state.eraseStroke = stroke;
        eraseSquareSegment(ctx, stroke, x, y, x, y);
        return;
      }
      // Brush: the shared round tip, coverage built up per stroke.
      const sz = pressureSize(state, opts.size ?? state.brushSize);
      state.eraseStroke = Object.assign(stroke, {
        cov: new Float32Array(W * H),
        radius: Math.max(0.5, sz / 2),
        hardness: Math.max(0, Math.min(100, opts.hardness ?? 100)) / 100,
        flow: Math.max(0, Math.min(100, opts.flow ?? 100)) / 100
      });
      eraseSegment(ctx, state.eraseStroke, x, y, x, y);
    },
    onMove(ctx, ov, state, x, y) {
      if (!state.drawing) return;
      const st = state.eraseStroke;
      if (!st) return;
      const size = pressureSize(state, toolOpts(state, 'eraser').size ?? state.brushSize);
      if (state.eraserMode === 'brush') {
        st.radius = Math.max(0.5, size / 2);
        eraseSegment(ctx, st, state.lastX, state.lastY, x, y);
      } else {
        if (state.eraserMode === 'pencil') st.size = Math.max(1, Math.round(size));
        eraseSquareSegment(ctx, st, state.lastX, state.lastY, x, y);
      }
      state.lastX = x;
      state.lastY = y;
    },
    onUp(ctx, ov, state) {
      state.drawing = false;
      state.eraserMode = null;
      state.eraseStroke = null;
    }
  },

  // PhotoCraft paint.magicEraser: one click, one undo step; off-canvas clicks record nothing.
  magicEraser: {
    label: 'Magic Eraser',
    icon: 'eraser-magic',
    cursor: 'crosshair',
    onDown(ctx, ov, state, x, y) {
      const { width, height } = ctx.canvas;
      const fx = Math.round(x),
        fy = Math.round(y);
      if (fx < 0 || fy < 0 || fx >= width || fy >= height) return;
      const opts = toolOpts(state, 'magicEraser');
      state.pushUndo?.('Magic Eraser');
      // Erasing to transparency turns the Background into Layer 0 first (PhotoCraft).
      if (!state.editMask) state.unlockBackground?.();
      const mask = strokeSelectionMask(state, width, height);
      const img = ctx.getImageData(0, 0, width, height);
      const sample = (opts.sampleAllLayers && state.sampleVisible?.(width, height)) || img;
      magicEraseImage(img, sample, fx, fy, opts, mask);
      ctx.putImageData(img, 0, 0);
    },
    onMove() {},
    onUp() {}
  },

  // PhotoCraft paint.backgroundEraser: one undo step per stroke, pushed on down.
  backgroundEraser: {
    label: 'Background Eraser',
    icon: 'eraser-background',
    cursor: 'crosshair',
    onDown(ctx, ov, state, x, y) {
      state.drawing = true;
      const opts = toolOpts(state, 'backgroundEraser');
      const W = ctx.canvas.width,
        H = ctx.canvas.height;
      state.pushUndo?.('Background Eraser');
      // Erasing to transparency turns the Background into Layer 0 first (PhotoCraft).
      if (!state.editMask) state.unlockBackground?.();
      const mask = strokeSelectionMask(state, W, H);
      const img = ctx.getImageData(0, 0, W, H);
      const toRgb = (hex) =>
        hexToRgba(hex)
          .slice(0, 3)
          .map((v) => v / 255);
      const sampling = opts.sampling ?? 'continuous';
      state.bgEraseStroke = {
        img,
        src: new Uint8ClampedArray(img.data),
        cov: new Float32Array(W * H),
        mask,
        radius: Math.max(0.5, (opts.size ?? 20) / 2),
        sampling,
        sample: sampling === 'backgroundSwatch' ? toRgb(state.bgColor ?? '#ffffff') : undefined,
        tol: Math.max(0, Math.min(100, opts.tolerance ?? 50)) / 100,
        limits: opts.limits ?? 'contiguous',
        protect: opts.protectForeground ? toRgb(state.color ?? '#000000') : null,
        lastX: x,
        lastY: y
      };
      backgroundEraseSegment(ctx, state.bgEraseStroke, x, y, x, y);
    },
    onMove(ctx, ov, state, x, y) {
      const st = state.bgEraseStroke;
      if (!state.drawing || !st) return;
      backgroundEraseSegment(ctx, st, st.lastX, st.lastY, x, y);
      st.lastX = x;
      st.lastY = y;
    },
    onUp(ctx, ov, state) {
      state.drawing = false;
      state.bgEraseStroke = null;
    }
  },

  fill: {
    label: 'Paint Bucket',
    icon: 'paint-bucket',
    cursor: 'crosshair',
    onDown(ctx, ov, state, x, y) {
      const opts = toolOpts(state, 'fill');
      const { width, height } = ctx.canvas;
      const img = ctx.getImageData(0, 0, width, height);
      // PhotoCraft All Layers: the region comes from the visible composite, pixels go on the layer.
      const sample = (opts.sampleAllLayers && state.sampleVisible?.(width, height)) || img;
      const region = floodSelectImage(
        sample,
        x,
        y,
        opts.tolerance ?? 32,
        opts.contiguous !== false
      );
      if (!region) return;
      const sel = state.sel;
      let selMask = null;
      if (sel && sel.mode === 'active') {
        selMask = selectionToFullMask(sel, width, height);
        for (let p = 0; p < selMask.length; p++) if (!selMask[p]) region.mask[p] = 0;
        // A float is already drawn on the layer; drop its baseData (see gradient).
        if (sel.data) {
          sel.data = null;
          sel.baseData = null;
        }
      }
      const src =
        opts.fillSource === 'pattern'
          ? state.pattern ??
            checkerPattern(hexToRgba(state.color), hexToRgba(state.bgColor ?? '#ffffff'))
          : state.activeColor;
      // PhotoCraft Anti-alias: a soft fringe on the matched region, still clipped to the selection.
      let cover = region.mask;
      if (opts.antiAlias) {
        cover = antialiasCoverage(region.mask, width, height);
        if (selMask) for (let p = 0; p < selMask.length; p++) if (!selMask[p]) cover[p] = 0;
      }
      bucketFillImage(img, cover, src, opts.opacity ?? 100);
      ctx.putImageData(img, 0, 0);
    },
    onMove() {},
    onUp() {}
  },

  gradient: {
    label: 'Gradient',
    icon: 'gradient',
    cursor: 'crosshair',
    onDown(ctx, ov, state, x, y) {
      state.drawing = true;
      state.startX = x;
      state.startY = y;
    },
    onMove(ctx, ov, state, x, y) {
      if (!state.drawing) return;
      const pt = state.shiftKey
        ? state.constrainLine?.(state.startX, state.startY, x, y) || { x, y }
        : { x, y };
      drawGradientPreview(ov, state.startX, state.startY, pt.x, pt.y);
    },
    onUp(ctx, ov, state, x, y) {
      if (!state.drawing) return;
      state.drawing = false;
      ov.clearRect(0, 0, ov.canvas.width, ov.canvas.height);
      const pt = state.shiftKey
        ? state.constrainLine?.(state.startX, state.startY, x, y) || { x, y }
        : { x, y };
      if (pt.x === state.startX && pt.y === state.startY) return;
      const W = ctx.canvas.width,
        H = ctx.canvas.height;
      const sel = state.sel;
      const mask = sel && sel.mode === 'active' ? selectionToFullMask(sel, W, H) : null;
      state.pushUndo?.('Gradient');
      // A pasted or moved float is already drawn on the layer. Drop its baseData so
      // a later stamp doesn't restore the pre-gradient pixels.
      if (sel?.data) {
        sel.data = null;
        sel.baseData = null;
      }
      const img = ctx.getImageData(0, 0, W, H);
      const opts = toolOpts(state, 'gradient');
      const preset = gradientToolPreset(opts.preset);
      const stops = resolvePresetStops(preset, state.color, state.bgColor);
      fillLinearGradientStops(
        img,
        state.startX,
        state.startY,
        pt.x,
        pt.y,
        stops,
        mask,
        opts.shape,
        {
          reverse: opts.reverse,
          dither: opts.dither,
          mode: opts.mode,
          opacity: (opts.opacity ?? 100) / 100,
          alphaStops: resolvePresetOpacity(preset)
        }
      );
      ctx.putImageData(img, 0, 0);
    }
  },

  eyedropper: {
    label: 'Eyedropper',
    icon: 'pipette',
    cursor: 'crosshair',
    onDown(ctx, ov, state, x, y, isRight) {
      const px = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
      const sampled = rgbToHex(px[0], px[1], px[2]);
      const hex = state.pickColor ? state.pickColor(sampled) : sampled;
      if (isRight) {
        state.bgColor = hex;
        state.onBgColorChange?.(hex);
      } else {
        state.color = hex;
        state.activeColor = hex;
        state.onColorChange?.(hex);
      }
    },
    onMove() {},
    onUp() {}
  },

  ruler: {
    label: 'Ruler',
    icon: 'ruler',
    cursor: 'crosshair',
    // PhotoCraft analysis_ui.rs pointer Tool::Ruler. The line is not pixels and takes no undo.
    onDown(ctx, ov, state, x, y) {
      const r = state.ruler;
      const tol = CROP_HANDLE_PX / (state.zoom || 1);
      const near = (q) => Math.hypot(q[0] - x, q[1] - y) <= tol;
      if (r && state.altKey && (near(r.start) || near(r.end))) {
        // ⌥-drag from an end point starts the protractor arm at that vertex (always the start).
        const swap = near(r.end) && !near(r.start);
        state.ruler = {
          start: swap ? r.end : r.start,
          end: swap ? r.start : r.end,
          protractor: [x, y]
        };
        state.rulerDrag = 'protractor';
      } else if (r?.protractor && near(r.protractor)) state.rulerDrag = 'protractor';
      else if (r && near(r.end)) state.rulerDrag = 'end';
      else if (r && near(r.start)) state.rulerDrag = 'start';
      else {
        state.ruler = { start: [x, y], end: [x, y] };
        state.rulerDrag = 'new';
      }
      state.drawing = true;
      drawRuler(ov, state);
      state.onRulerChange?.();
    },
    onMove(ctx, ov, state, x, y) {
      const r = state.ruler;
      if (!state.rulerDrag || !r) return;
      const shift = !!state.shiftKey;
      const to = state.rulerDrag === 'start' ? r.end : r.start;
      const key = { start: 'start', protractor: 'protractor' }[state.rulerDrag] ?? 'end';
      state.ruler = { ...r, [key]: rulerConstrain(to, [x, y], shift) };
      drawRuler(ov, state);
      state.onRulerChange?.();
    },
    onUp(ctx, ov, state) {
      const r = state.ruler;
      // A click that draws no line clears the ruler.
      if (
        state.rulerDrag === 'new' &&
        r &&
        Math.hypot(...r.end.map((v, k) => v - r.start[k])) < 0.5
      ) {
        state.ruler = null;
      }
      state.rulerDrag = null;
      state.drawing = false;
      drawRuler(ov, state);
      state.onRulerChange?.();
    },
    // Redrawn over the marching ants (selection.js drawSelectionOverlay).
    overlay: strokeRuler,
    /** The options bar's Clear: drop the line. */
    clear(ov, state) {
      state.ruler = null;
      state.rulerDrag = null;
      ov.clearRect(0, 0, ov.canvas.width, ov.canvas.height);
      state.onRulerChange?.();
    }
  },

  count: {
    label: 'Count',
    icon: 'circle-dot',
    cursor: 'crosshair',
    // PhotoCraft analysis_ui.rs pointer Tool::Count: a click adds the next number, ⌥-click on a
    // marker removes it, and dragging a marker moves it. Markers are not pixels and take no undo.
    onDown(ctx, ov, state, x, y) {
      const hit = nearestCountMarker(state.count, x, y, COUNT_HIT_PX / (state.zoom || 1));
      if (hit && state.altKey) state.count = removeCountMarker(state.count, ...hit);
      else if (hit) state.countDrag = { at: hit, from: [x, y] };
      else if (!state.altKey) state.count = addCountMarker(state.count, x, y);
      state.drawing = true;
      drawCount(ov, state);
      state.onCountChange?.();
    },
    onMove() {},
    onUp(ctx, ov, state, x, y) {
      const drag = state.countDrag;
      state.countDrag = null;
      state.drawing = false;
      if (drag && Math.hypot(x - drag.from[0], y - drag.from[1]) > 0.5) {
        state.count = moveCountMarker(state.count, ...drag.at, [x, y]);
        drawCount(ov, state);
        state.onCountChange?.();
      }
    },
    // Redrawn over the marching ants (selection.js drawSelectionOverlay).
    overlay: (ov, state) => drawCountMarkers(ov, state.count, state.zoom),
    /** The options bar's Clear: the active group's markers. */
    clear(ov, state) {
      state.count = clearCount(state.count);
      drawCount(ov, state);
      state.onCountChange?.();
    }
  },

  colorSampler: {
    label: 'Color Sampler',
    icon: 'sampler',
    cursor: 'crosshair',
    // PhotoCraft analysis_ui.rs pointer Tool::ColorSampler: a click inside the canvas places the
    // next point (at most MAX_SAMPLERS), ⌥-click on a point removes it, and dragging a point
    // moves it (dropped off the canvas, it is removed). Points are not pixels and take no undo.
    onDown(ctx, ov, state, x, y) {
      const i = nearestSampler(state.samplers, x, y, COUNT_HIT_PX / (state.zoom || 1));
      if (i >= 0 && state.altKey) state.samplers = removeSampler(state.samplers, i);
      else if (i >= 0) state.samplerDrag = { i, from: [x, y] };
      else if (!state.altKey) {
        state.samplers = addSampler(state.samplers, x, y, ctx.canvas.width, ctx.canvas.height);
      }
      state.drawing = true;
      drawSamplers(ov, state);
      state.onSamplersChange?.();
    },
    onMove() {},
    onUp(ctx, ov, state, x, y) {
      const drag = state.samplerDrag;
      state.samplerDrag = null;
      state.drawing = false;
      if (drag && Math.hypot(x - drag.from[0], y - drag.from[1]) > 0.5) {
        const { width, height } = ctx.canvas;
        state.samplers = moveSampler(state.samplers, drag.i, x, y, width, height);
        drawSamplers(ov, state);
        state.onSamplersChange?.();
      }
    },
    overlay: (ov, state) => drawSamplerMarkers(ov, state.samplers, state.zoom),
    /** The options bar's Clear All. */
    clear(ov, state) {
      state.samplers = [];
      drawSamplers(ov, state);
      state.onSamplersChange?.();
    }
  },

  note: {
    label: 'Note',
    icon: 'message-square',
    cursor: 'crosshair',
    // PhotoCraft analysis_ui.rs pointer Tool::Note: a click on a note selects it (and a drag
    // moves it); a click elsewhere adds a note with the options bar's Author and Color.
    onDown(ctx, ov, state, x, y) {
      const hit = noteAt(state.notes, x, y, state.zoom);
      if (hit >= 0) {
        state.noteSelected = hit;
        state.noteDrag = { i: hit, off: [x - state.notes[hit].x, y - state.notes[hit].y] };
      } else {
        const opts = toolOpts(state, 'note');
        const r = addNote(state.notes, x, y, opts.noteAuthor ?? '', opts.noteColor ?? NOTE_COLOR);
        state.notes = r.notes;
        state.noteSelected = r.index;
      }
      state.drawing = true;
      drawNotes(ov, state);
      state.onNotesChange?.();
    },
    onMove(ctx, ov, state, x, y) {
      const drag = state.noteDrag;
      if (!drag) return;
      const to = { x: Math.round(x - drag.off[0]), y: Math.round(y - drag.off[1]) };
      state.notes = setNote(state.notes, drag.i, to);
      drawNotes(ov, state);
    },
    onUp(ctx, ov, state) {
      if (state.noteDrag) state.onNotesChange?.();
      state.noteDrag = null;
      state.drawing = false;
    },
    overlay: (ov, state) => drawNoteMarkers(ov, state.notes, state.zoom, state.noteSelected ?? -1)
  },

  cloneStamp: cloneTool('cloneStamp', 'Clone Stamp', 'stamp', false),
  patternStamp: patternStampTool,
  spotHealing: spotHealingTool,
  healingBrush: cloneTool('healingBrush', 'Healing Brush', 'bandage', true),
  patch: patchTool,
  redEye: redEyeTool,
  historyBrush: historyBrushTool,

  dodge: toneTool(false),
  burn: toneTool(true),

  sponge: {
    label: 'Sponge',
    icon: 'cloud',
    cursor: 'crosshair',
    onDown(ctx, ov, state, x, y) {
      state.drawing = true;
      const opts = toolOpts(state, 'sponge');
      const W = ctx.canvas.width,
        H = ctx.canvas.height;
      const sel = state.sel;
      const mask = sel && sel.mode === 'active' ? selectionToFullMask(sel, W, H) : null;
      state.pushUndo?.('Sponge');
      // A float is already drawn on the layer; drop its baseData (see gradient).
      if (sel?.data) {
        sel.data = null;
        sel.baseData = null;
      }
      const saturate = opts.mode === 'saturate';
      const vibrance = opts.vibrance !== false;
      const flow = Math.min(100, Math.max(1, opts.flow ?? 50)) / 100;
      const img = ctx.getImageData(0, 0, W, H);
      const work = new Float32Array(W * H * 3);
      for (let p = 0; p < W * H; p++) {
        work[p * 3] = img.data[p * 4] / 255;
        work[p * 3 + 1] = img.data[p * 4 + 1] / 255;
        work[p * 3 + 2] = img.data[p * 4 + 2] / 255;
      }
      state.spongeStroke = {
        img,
        work,
        mask,
        radius: Math.max(0.5, (opts.size ?? state.brushSize) / 2),
        hardness: (opts.hardness ?? 50) / 100,
        // Flow scales each dab's coverage; a full-flow pass moves colours half-way (PhotoCraft).
        strength: flow * 0.5,
        f: (rgb, k) => sponge(rgb, k, saturate, vibrance),
        lastX: x,
        lastY: y
      };
      spongeSegment(ctx, state, x, y, x, y);
    },
    onMove(ctx, ov, state, x, y) {
      const st = state.spongeStroke;
      if (!state.drawing || !st) return;
      spongeSegment(ctx, state, st.lastX, st.lastY, x, y);
      st.lastX = x;
      st.lastY = y;
    },
    onUp(ctx, ov, state) {
      state.drawing = false;
      state.spongeStroke = null;
    }
  },

  blur: focusTool(false),
  sharpen: focusTool(true),

  // PhotoCraft paint.smudge. Undo is pushed on down, before any pixel changes.
  smudge: {
    label: 'Smudge',
    icon: 'pointer',
    cursor: 'crosshair',
    onDown(ctx, ov, state, x, y) {
      state.drawing = true;
      const opts = toolOpts(state, 'smudge');
      const W = ctx.canvas.width,
        H = ctx.canvas.height;
      const sel = state.sel;
      const mask = sel && sel.mode === 'active' ? selectionToFullMask(sel, W, H) : null;
      state.pushUndo?.('Smudge');
      // A float is already drawn on the layer; drop its baseData (see gradient).
      if (sel?.data) {
        sel.data = null;
        sel.baseData = null;
      }
      const size = opts.size ?? state.brushSize;
      const strength = Math.min(100, Math.max(1, opts.strength ?? 50)) / 100;
      const finger = opts.fingerPainting ? hexToRgba(state.color).map((v) => v / 255) : null;
      const img = ctx.getImageData(0, 0, W, H);
      state.smudgeStroke = {
        img,
        work: rgbaWork(img),
        mask,
        radius: Math.max(0.5, size / 2),
        hardness: (opts.hardness ?? 50) / 100,
        sm: smudgeStroke(strength, finger, size),
        lastX: x,
        lastY: y
      };
      smudgeSegment(ctx, state, x, y, x, y);
    },
    onMove(ctx, ov, state, x, y) {
      const st = state.smudgeStroke;
      if (!state.drawing || !st) return;
      smudgeSegment(ctx, state, st.lastX, st.lastY, x, y);
      st.lastX = x;
      st.lastY = y;
    },
    onUp(ctx, ov, state) {
      state.drawing = false;
      state.smudgeStroke = null;
    }
  },

  text: {
    label: 'Horizontal Type',
    icon: 'type',
    cursor: 'text',
    // A click on a type layer's text edits it again; anywhere else starts a new type layer. A
    // drag draws a paragraph text box instead (PhotoCraft type_tool.rs), its text wrapping in it.
    onDown(ctx, ov, state, x, y) {
      state.beginType?.(x, y, 'horizontal');
      state.typeDrag = { x, y };
      state.drawing = true;
    },
    onMove(ctx, ov, state, x, y) {
      const d = state.typeDrag;
      if (!d || !ov) return;
      ov.clearRect(0, 0, ov.canvas.width, ov.canvas.height);
      const box = paragraphBoxFromDrag(d.x, d.y, x, y);
      if (!box) return;
      ov.save();
      const z = state.zoom || 1;
      ov.setLineDash([4 / z, 4 / z]);
      ov.lineWidth = 1 / z;
      ov.strokeStyle = '#000';
      ov.strokeRect(box.x, box.y, box.w, box.h);
      ov.restore();
    },
    onUp(ctx, ov, state, x, y) {
      const d = state.typeDrag;
      state.typeDrag = null;
      state.drawing = false;
      if (!d) return;
      ov?.clearRect(0, 0, ov.canvas.width, ov.canvas.height);
      const box = paragraphBoxFromDrag(d.x, d.y, x, y);
      if (box) state.beginParagraph?.(box);
    }
  },

  // Tool::VerticalType: the same type layer, its glyphs stacked in columns.
  verticalType: {
    label: 'Vertical Type',
    icon: 'type',
    cursor: 'vertical-text',
    onDown(ctx, ov, state, x, y) {
      state.beginType?.(x, y, 'vertical');
    },
    onMove() {},
    onUp() {}
  },

  // Tool::HorizontalTypeMask / VerticalTypeMask: the same text box, but committing turns the
  // glyphs into the selection (combined by the held modifiers) and no layer is made.
  horizontalTypeMask: {
    label: 'Horizontal Type Mask',
    icon: 'type-mask',
    cursor: 'text',
    onDown(ctx, ov, state, x, y) {
      state.beginType?.(x, y, 'horizontal', selectionMode(state) ?? 'new');
    },
    onMove() {},
    onUp() {}
  },
  verticalTypeMask: {
    label: 'Vertical Type Mask',
    icon: 'type-mask-vertical',
    cursor: 'vertical-text',
    onDown(ctx, ov, state, x, y) {
      state.beginType?.(x, y, 'vertical', selectionMode(state) ?? 'new');
    },
    onMove() {},
    onUp() {}
  },

  // PhotoCraft Tool::Pen (Path mode): a click places a corner anchor, a drag pulls out smooth
  // handles, and a click on the first anchor closes the subpath. Anchors go into the targeted
  // path in the Paths panel, or a new Work Path when none is targeted. state.drawing stays true
  // between clicks; Enter, Escape, or another tool ends the subpath open (paint.js).
  pen: {
    label: 'Pen',
    icon: 'pen-tool',
    cursor: 'crosshair',
    onDown(ctx, ov, state, x, y) {
      const continuing = !!(state.drawing && state.pen);
      const paths = state.paths ?? emptyPaths();
      const closeRadius = POLY_CLOSE_RADIUS / (state.zoom || 1);
      const r = penPress(targetPath(paths), x, y, { continuing, closeRadius });
      state.setPaths?.(withTargetPath(paths, r.path), 'Pen');
      state.pen = { dragging: true, anchor: r.anchor, closed: r.closed, x, y };
      state.drawing = true;
      drawPenPreview(ov, state, null);
    },
    onMove(ctx, ov, state, x, y) {
      const pen = state.pen;
      if (!pen) return;
      if (pen.dragging && Math.hypot(x - pen.x, y - pen.y) >= 1) {
        const path = penDrag(targetPath(state.paths), pen.anchor, x, y);
        state.setPaths?.(withTargetPath(state.paths, path), null);
      }
      drawPenPreview(ov, state, pen.dragging || pen.closed ? null : [x, y]);
    },
    onUp(ctx, ov, state) {
      if (!state.pen) return;
      if (state.pen.closed) TOOLS.pen.end(ov, state);
      else state.pen.dragging = false;
    },
    /** End the subpath being drawn (open unless it was just closed). */
    end(ov, state) {
      state.drawing = false;
      state.pen = null;
      drawPenPreview(ov, state, null);
    }
  },

  // PhotoCraft Tool::FreeformPen: a drag draws freehand, and the release fits the trace with
  // Béziers within the options bar's Curve Fit (px). Releasing on the start point closes the
  // subpath. The subpath goes into the targeted path, or a new Work Path.
  freeformPen: {
    label: 'Freeform Pen',
    icon: 'pen-freeform',
    cursor: 'crosshair',
    onDown(ctx, ov, state, x, y) {
      state.pen = { trace: [[x, y]] };
      state.drawing = true;
      drawFreeformPreview(ov, state);
    },
    onMove(ctx, ov, state, x, y) {
      if (!state.pen?.trace) return;
      state.pen.trace.push([x, y]);
      drawFreeformPreview(ov, state);
    },
    onUp(ctx, ov, state, x, y) {
      const trace = state.pen?.trace;
      state.drawing = false;
      state.pen = null;
      if (trace) {
        if (Number.isFinite(x) && Number.isFinite(y)) trace.push([x, y]);
        const fit = Number(toolOpts(state, 'freeformPen').curveFit) || 2;
        const sp = freeformSubpath(trace, fit, POLY_CLOSE_RADIUS / (state.zoom || 1));
        if (sp) {
          const paths = state.paths ?? emptyPaths();
          const path = targetPath(paths) ?? emptyPath();
          const next = { ...path, subpaths: [...path.subpaths, sp] };
          state.setPaths?.(withTargetPath(paths, next), 'Freeform Pen');
        }
      }
      drawPenPreview(ov, state, null);
    }
  },

  // PhotoCraft Tool::CurvaturePen (vector_ui.rs curvature_down): each click adds a point and the
  // curve flows smoothly through all of them (curvatureAnchors); a drag moves the point just
  // placed, a press on an earlier point grabs it, and a click on the first point (three or
  // more) closes the subpath. Double-click toggles a point between smooth and corner. Enter,
  // Escape, or another tool ends the subpath open (paint.js).
  curvaturePen: {
    label: 'Curvature Pen',
    icon: 'pen-curvature',
    cursor: 'crosshair',
    onDown(ctx, ov, state, x, y) {
      const tol = POLY_CLOSE_RADIUS / (state.zoom || 1);
      const pen = state.drawing && state.pen?.points ? state.pen : null;
      const hit = pen ? curvaturePointAt(pen.points, x, y, tol) : -1;
      if (pen && hit === 0 && pen.points.length >= 3) {
        setCurvatureSubpath(state, pen, true, 'Curvature Pen');
        TOOLS.curvaturePen.end(ov, state);
        return;
      }
      const next = pen ?? { points: [], corners: [], started: false };
      if (hit < 0) next.points = [...next.points, [x, y]];
      next.moving = hit >= 0 ? hit : next.points.length - 1;
      state.pen = next;
      state.drawing = true;
      setCurvatureSubpath(state, next, false, 'Curvature Pen');
      drawPenPreview(ov, state, null);
    },
    onMove(ctx, ov, state, x, y) {
      const pen = state.pen;
      if (!pen?.points || pen.moving == null) return;
      pen.points = pen.points.map((p, i) => (i === pen.moving ? [x, y] : p));
      setCurvatureSubpath(state, pen, false, null);
      drawPenPreview(ov, state, null);
    },
    onUp(ctx, ov, state) {
      if (state.pen?.points) state.pen.moving = null;
    },
    /** Double-click: the point under (x, y) turns smooth ↔ corner and the curve reflows. */
    toggle(ov, state, x, y) {
      const pen = state.pen;
      if (!pen?.points) return;
      const i = curvaturePointAt(pen.points, x, y, POLY_CLOSE_RADIUS / (state.zoom || 1));
      if (i < 0) return;
      pen.corners = pen.points.map((_, k) => (k === i ? !pen.corners[k] : !!pen.corners[k]));
      setCurvatureSubpath(state, pen, false, 'Curvature Pen');
      drawPenPreview(ov, state, null);
    },
    /** End the subpath being drawn (open). */
    end(ov, state) {
      state.drawing = false;
      state.pen = null;
      drawPenPreview(ov, state, null);
    }
  },

  // PhotoCraft anchor_tools.rs: a click on a segment of the targeted path inserts an anchor there
  // (a curve is split without changing its shape). One click, one history step.
  addAnchorPoint: {
    label: 'Add Anchor Point',
    icon: 'pen-add-anchor',
    cursor: 'crosshair',
    onDown(ctx, ov, state, x, y) {
      const path = targetPath(state.paths);
      const hit = hitPath(path, x, y, PATH_HIT_PX / (state.zoom || 1));
      if (hit?.type !== 'segment') return;
      const r = addAnchor(path, hit.s, hit.k, hit.t);
      if (!r) return;
      setTargetPath(state, r.path, 'Add Anchor Point');
      state.pathAnchors = [r.anchor];
      drawPathEdit(ov, state);
    },
    onMove() {},
    onUp() {}
  },

  // Delete Anchor Point: a click on an anchor removes it, joining its neighbours.
  deleteAnchorPoint: {
    label: 'Delete Anchor Point',
    icon: 'pen-delete-anchor',
    cursor: 'crosshair',
    onDown(ctx, ov, state, x, y) {
      const path = targetPath(state.paths);
      const hit = hitPath(path, x, y, PATH_HIT_PX / (state.zoom || 1));
      if (hit?.type !== 'anchor') return;
      const next = deleteAnchor(path, hit.s, hit.k);
      if (!next) return;
      setTargetPath(state, next, 'Delete Anchor Point');
      state.pathAnchors = [];
      drawPathEdit(ov, state);
    },
    onMove() {},
    onUp() {}
  },

  // Convert Point (direct_select.rs): a click on an anchor makes it a corner, a drag from it pulls
  // out smooth mirrored handles, and a drag on a shown handle moves that handle alone.
  convertPoint: {
    label: 'Convert Point',
    icon: 'convert-point',
    cursor: 'default',
    onDown(ctx, ov, state, x, y) {
      const path = targetPath(state.paths);
      const handles = shownHandles(path, state.pathAnchors ?? []);
      const hit = hitPath(path, x, y, PATH_HIT_PX / (state.zoom || 1), handles);
      if (hit?.type !== 'anchor' && hit?.type !== 'handle') return;
      state.pathAnchors = [[hit.s, hit.k]];
      state.pathDrag = { hit, from: path, x, y, moved: false };
      state.drawing = true;
      drawPathEdit(ov, state);
    },
    onMove(ctx, ov, state, x, y) {
      const d = state.pathDrag;
      if (!d || (!d.moved && Math.hypot(x - d.x, y - d.y) < 1)) return;
      const { s, k, h } = d.hit;
      const next =
        d.hit.type === 'handle'
          ? moveHandle(d.from, s, k, h, x, y, true)
          : convertPoint(d.from, s, k, [x, y]);
      setTargetPath(state, next, d.moved ? null : 'Convert Point');
      d.moved = true;
      drawPathEdit(ov, state);
    },
    onUp(ctx, ov, state) {
      const d = state.pathDrag;
      state.drawing = false;
      state.pathDrag = null;
      if (d && !d.moved && d.hit.type === 'anchor') {
        setTargetPath(state, convertPoint(d.from, d.hit.s, d.hit.k), 'Convert Point');
      }
      drawPathEdit(ov, state);
    }
  },

  // PhotoCraft Tool::PathSelection (vector_ui.rs path_selection_finish): a press on a subpath (its
  // outline or interior) selects it and a drag moves it, whole-pixel steps, one history step.
  // ⇧ adds subpaths to the selection.
  pathSelection: {
    label: 'Path Selection',
    icon: 'mouse-pointer-2',
    cursor: 'default',
    onDown(ctx, ov, state, x, y) {
      const path = targetPath(state.paths);
      const s = subpathAt(path, x, y, PATH_HIT_PX / (state.zoom || 1));
      if (s < 0) {
        state.pathAnchors = [];
        drawPathEdit(ov, state);
        return;
      }
      const picked = new Set(state.shiftKey ? (state.pathAnchors ?? []).map((a) => a[0]) : []);
      picked.add(s);
      state.pathAnchors = [...picked].flatMap((i) => subpathAnchors(path, i));
      state.pathDrag = { subpaths: [...picked], from: path, x, y, moved: false };
      state.drawing = true;
      drawPathEdit(ov, state);
    },
    onMove(ctx, ov, state, x, y) {
      const d = state.pathDrag;
      if (!d) return;
      const dx = Math.round(x - d.x),
        dy = Math.round(y - d.y);
      if (!d.moved && !dx && !dy) return;
      const next = moveSubpaths(d.from, d.subpaths, dx, dy);
      setTargetPath(state, next, d.moved ? null : 'Path Selection');
      d.moved = true;
      drawPathEdit(ov, state);
    },
    onUp(ctx, ov, state) {
      state.drawing = false;
      state.pathDrag = null;
    }
  },

  // PhotoCraft Tool::DirectSelection (direct_select.rs): click an anchor to select it (⇧ toggles,
  // ⌥ takes its whole subpath), drag selected anchors to move them, a shown handle to turn it (a
  // smooth point stays smooth; ⌥ breaks it), or a segment to bend it. A drag on empty canvas
  // marquee-selects anchors; a click there deselects. One history step per drag.
  directSelection: {
    label: 'Direct Selection',
    icon: 'direct-select',
    cursor: 'default',
    onDown(ctx, ov, state, x, y) {
      const path = targetPath(state.paths);
      const sel = state.pathAnchors ?? [];
      const hit = hitPath(path, x, y, PATH_HIT_PX / (state.zoom || 1), shownHandles(path, sel));
      state.drawing = true;
      state.pathDrag = { hit, from: path, x, y, moved: false };
      if (hit?.type === 'anchor') {
        const has = sel.some(([s, k]) => s === hit.s && k === hit.k);
        if (state.altKey) state.pathAnchors = subpathAnchors(path, hit.s);
        else if (state.shiftKey) {
          state.pathAnchors = has
            ? sel.filter(([s, k]) => s !== hit.s || k !== hit.k)
            : [...sel, [hit.s, hit.k]];
        } else if (!has) state.pathAnchors = [[hit.s, hit.k]];
      } else if (!hit && !state.shiftKey) state.pathAnchors = [];
      drawPathEdit(ov, state);
    },
    onMove(ctx, ov, state, x, y) {
      const d = state.pathDrag;
      if (!d || (!d.moved && Math.hypot(x - d.x, y - d.y) < 1)) return;
      const hit = d.hit;
      d.moved = true;
      if (!hit) {
        d.box = [d.x, d.y, x, y];
        drawPathEdit(ov, state);
        return;
      }
      const dx = x - d.x,
        dy = y - d.y;
      let next;
      if (hit.type === 'handle') next = moveHandle(d.from, hit.s, hit.k, hit.h, x, y, state.altKey);
      else if (hit.type === 'segment') next = bendSegment(d.from, hit.s, hit.k, hit.t, dx, dy);
      else next = moveAnchors(d.from, state.pathAnchors ?? [], dx, dy);
      setTargetPath(state, next, d.pushed ? null : 'Direct Selection');
      d.pushed = true;
      drawPathEdit(ov, state);
    },
    onUp(ctx, ov, state) {
      const d = state.pathDrag;
      state.drawing = false;
      state.pathDrag = null;
      if (d?.box) {
        const found = anchorsInBox(d.from, ...d.box);
        state.pathAnchors = state.shiftKey ? [...(state.pathAnchors ?? []), ...found] : found;
      }
      drawPathEdit(ov, state);
    }
  },

  // PhotoCraft's Shape tools (vector_ui.rs): a drag makes a new shape layer from the options
  // bar's fill and stroke. ⇧ keeps a 1:1 box (Line: 45° steps); the preview is on the overlay.
  rect: shapeTool('rect', 'Rectangle', 'rectangle-horizontal'),
  ellipse: shapeTool('ellipse', 'Ellipse', 'circle'),
  triangle: shapeTool('triangle', 'Triangle', 'triangle'),
  polygon: shapeTool('polygon', 'Polygon', 'pentagon'),
  line: shapeTool('line', 'Line', 'slash'),
  customShape: shapeTool('customShape', 'Custom Shape', 'cloud'),

  // ── Selection tools ─────────────────────────────────────────────

  rectSelect: {
    label: 'Rectangular Marquee',
    icon: 'square-dashed',
    cursor: 'crosshair',
    onDown(ctx, ov, state, x, y) {
      const sel = state.sel;
      const combine = !!selectionMode(state);
      if (!combine && state.tryBeginMove?.(state, ctx, x, y)) return;
      if (!combine) state.commitSelection?.();
      sel.mode = 'drawing';
      sel.x = x;
      sel.y = y;
      sel.w = 0;
      sel.h = 0;
      if (!combine) {
        sel.data = null;
        sel.mask = null;
        sel.baseData = null;
      }
      state.startX = x;
      state.startY = y;
      Object.assign(sel, marqueeBox(state, 'rectSelect', x, y));
      state.drawing = true;
    },
    onMove(ctx, ov, state, x, y) {
      const sel = state.sel;
      if (sel.mode === 'drawing' && state.drawing) {
        Object.assign(sel, marqueeBox(state, 'rectSelect', x, y));
      }
    },
    onUp(ctx, ov, state) {
      const sel = state.sel;
      if (sel.mode !== 'drawing') return;
      state.drawing = false;
      if (marqueeTooSmall(state, 'rectSelect', sel)) {
        sel.mode = 'none';
        return;
      }
      const W = ctx.canvas.width,
        H = ctx.canvas.height;
      const feather = toolOpts(state, 'rectSelect').feather;
      // Always through the mask path so sel.mask holds feather / combine results.
      commitToolSelection(
        state,
        marqueeMask('rect', sel, W, H, feather),
        W,
        H,
        selectionMode(state)
      );
    }
  },

  ellipseSelect: {
    label: 'Elliptical Marquee',
    icon: 'ellipse-dashed',
    cursor: 'crosshair',
    onDown(ctx, ov, state, x, y) {
      const sel = state.sel;
      const combine = !!selectionMode(state);
      if (!combine && state.tryBeginMove?.(state, ctx, x, y)) return;
      if (!combine) state.commitSelection?.();
      sel.mode = 'drawing';
      state.startX = x;
      state.startY = y;
      Object.assign(sel, marqueeBox(state, 'ellipseSelect', x, y));
      if (sel.w > 0 && sel.h > 0) drawEllipseMarquee(ov, sel);
      state.drawing = true;
    },
    onMove(ctx, ov, state, x, y) {
      const sel = state.sel;
      if (sel.mode !== 'drawing' || !state.drawing) return;
      Object.assign(sel, marqueeBox(state, 'ellipseSelect', x, y));
      drawEllipseMarquee(ov, sel);
    },
    onUp(ctx, ov, state) {
      const sel = state.sel;
      if (sel.mode !== 'drawing') return;
      state.drawing = false;
      ov.clearRect(0, 0, ov.canvas.width, ov.canvas.height);
      if (marqueeTooSmall(state, 'ellipseSelect', sel)) {
        sel.mode = 'none';
        return;
      }
      const W = ctx.canvas.width,
        H = ctx.canvas.height;
      const mask = marqueeMask('ellipse', sel, W, H, toolOpts(state, 'ellipseSelect').feather);
      commitToolSelection(state, mask, W, H, selectionMode(state));
    }
  },

  singleRowMarquee: singleLineMarquee('singleRowMarquee', 'Single Row Marquee', 'marquee-row'),
  singleColumnMarquee: singleLineMarquee(
    'singleColumnMarquee',
    'Single Column Marquee',
    'marquee-column'
  ),

  lasso: {
    label: 'Lasso',
    icon: 'lasso',
    cursor: 'crosshair',
    onDown(ctx, ov, state, x, y) {
      const combine = !!selectionMode(state);
      if (!combine && state.tryBeginMove?.(state, ctx, x, y)) return;
      if (!combine) state.commitSelection?.();
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
      finishLasso(ctx, ov, state, Number(toolOpts(state, 'lasso').feather) || 0);
    }
  },

  polyLasso: {
    label: 'Polygonal Lasso',
    icon: 'pentagon',
    cursor: 'crosshair',
    onDown(ctx, ov, state, x, y) {
      const path = state.polyPath;
      if (state.drawing && path?.length) {
        const [fx, fy] = path[0];
        const [lx, ly] = path[path.length - 1];
        const near = POLY_CLOSE_RADIUS / (state.zoom || 1);
        if (path.length >= 3 && Math.hypot(x - fx, y - fy) <= near) {
          TOOLS.polyLasso.close(ctx, ov, state);
          return;
        }
        // The second pointerdown of a double-click lands on the point just placed.
        if (Math.hypot(x - lx, y - ly) >= 1) path.push([x, y]);
        drawPolyPreview(ov, path, x, y);
        return;
      }
      // The modifier on the first click picks add/subtract/intersect for the
      // whole polygon. The old selection stays until close, so Escape keeps it.
      const mode = selectionMode(state);
      if (!mode && state.tryBeginMove?.(state, ctx, x, y)) return;
      state.polyMode = mode;
      state.polyPath = [[x, y]];
      state.drawing = true;
      drawPolyPreview(ov, state.polyPath, x, y);
    },
    onMove(ctx, ov, state, x, y) {
      if (!state.drawing || !state.polyPath) return;
      drawPolyPreview(ov, state.polyPath, x, y);
    },
    onUp() {},
    /** Close the polygon and select its interior. Returns false if it had < 3 points. */
    close(ctx, ov, state) {
      const path = state.polyPath;
      const mode = state.polyMode ?? null;
      TOOLS.polyLasso.cancel(ov, state);
      if (!path || path.length < 3) return false;
      const W = ctx.canvas.width,
        H = ctx.canvas.height;
      const raw = (state.scanlineFill || scanlineFill)(path, W, H);
      const feather = Number(toolOpts(state, 'polyLasso').feather) || 0;
      const mask = feather > 0 ? featherMask(raw, W, H, feather) : raw;
      if (!mode) state.commitSelection?.();
      commitToolSelection(state, mask, W, H, mode);
      return true;
    },
    cancel(ov, state) {
      state.drawing = false;
      state.polyPath = null;
      state.polyMode = null;
      ov.clearRect(0, 0, ov.canvas.width, ov.canvas.height);
    }
  },

  // PhotoCraft Tool::MagneticLasso. state.magnetic is the border being drawn: path (fastened
  // points), anchors (indices into path), live (last anchor to the edge near the pointer), the
  // selection mode the first click set, and the active layer's edge map.
  magneticLasso: {
    label: 'Magnetic Lasso',
    icon: 'lasso-magnetic',
    cursor: 'crosshair',
    onDown(ctx, ov, state, x, y) {
      const m = state.magnetic;
      if (state.drawing && m) {
        const [fx, fy] = m.path[0];
        const near = POLY_CLOSE_RADIUS / (state.zoom || 1);
        if (m.path.length >= 3 && Math.hypot(x - fx, y - fy) <= near) {
          TOOLS.magneticLasso.close(ctx, ov, state);
          return;
        }
        magneticFollow(state, x, y);
        magneticFasten(m);
        drawMagnetic(ov, m);
        return;
      }
      const mode = selectionMode(state);
      if (!mode && state.tryBeginMove?.(state, ctx, x, y)) return;
      const W = ctx.canvas.width,
        H = ctx.canvas.height;
      const edges = edgeMap(ctx.getImageData(0, 0, W, H));
      const o = magneticSettings(state);
      const start = snapToEdge(edges, W, H, x, y, o.width, o.contrast);
      state.magnetic = { path: [start], anchors: [0], live: [], mode, edges, W, H };
      state.drawing = true;
      drawMagnetic(ov, state.magnetic);
    },
    onMove(ctx, ov, state, x, y) {
      if (!state.drawing || !state.magnetic) return;
      magneticFollow(state, x, y);
      drawMagnetic(ov, state.magnetic);
    },
    onUp() {},
    /** Close the border along the edges and select its interior. False under 3 points. */
    close(ctx, ov, state) {
      const m = state.magnetic;
      if (!m) return false;
      const o = magneticSettings(state);
      const last = m.path[m.path.length - 1];
      const closing = liveWire(m.edges, m.W, m.H, last, m.path[0], o.width, o.contrast);
      const path = m.path.concat(m.live.slice(1), closing.slice(1));
      TOOLS.magneticLasso.cancel(ov, state);
      if (path.length < 3) return false;
      const W = ctx.canvas.width,
        H = ctx.canvas.height;
      const raw = (state.scanlineFill || scanlineFill)(path, W, H);
      const feather = Number(toolOpts(state, 'magneticLasso').feather) || 0;
      const mask = feather > 0 ? featherMask(raw, W, H, feather) : raw;
      if (!m.mode) state.commitSelection?.();
      commitToolSelection(state, mask, W, H, m.mode);
      return true;
    },
    /** Backspace / Delete: drop the last fastening point (never the first). */
    removeAnchor(ov, state) {
      const m = state.magnetic;
      if (!m || m.anchors.length < 2) return;
      m.anchors.pop();
      m.path.length = m.anchors[m.anchors.length - 1] + 1;
      m.live = [];
      drawMagnetic(ov, m);
    },
    cancel(ov, state) {
      state.drawing = false;
      state.magnetic = null;
      ov.clearRect(0, 0, ov.canvas.width, ov.canvas.height);
    }
  },

  // PhotoCraft Tool::QuickSelection. Each dab selects its disc and floods to similar colours
  // up to the edges (quickSelectDab). With a selection already active a plain stroke adds;
  // Alt subtracts. state.quickStroke holds the stroke's source, edge map, and taken pixels.
  quickSelection: {
    label: 'Quick Selection',
    icon: 'quick-selection',
    cursor: 'crosshair',
    onDown(ctx, ov, state, x, y) {
      const held = selectionMode(state);
      const mode = held ?? (state.sel?.mode === 'active' ? 'add' : null);
      if (!mode) state.commitSelection?.();
      const W = ctx.canvas.width,
        H = ctx.canvas.height;
      const img = ctx.getImageData(0, 0, W, H);
      state.quickStroke = {
        img,
        edges: edgeMap(img),
        taken: new Uint8Array(W * H),
        mode,
        first: true,
        x,
        y
      };
      state.drawing = true;
      quickDab(state, x, y);
    },
    onMove(ctx, ov, state, x, y) {
      const q = state.quickStroke;
      if (!state.drawing || !q) return;
      const size = Number(toolOpts(state, 'quickSelection').size) || 30;
      dabSegment(q.x, q.y, x, y, Math.max(1, size / 4), (cx, cy) => {
        quickDab(state, cx, cy);
        return null;
      });
      q.x = x;
      q.y = y;
    },
    onUp(ctx, ov, state) {
      state.drawing = false;
      state.quickStroke = null;
    }
  },

  magicWand: {
    label: 'Magic Wand',
    icon: 'wand-sparkles',
    cursor: 'crosshair',
    onDown(ctx, ov, state, x, y) {
      const combine = !!selectionMode(state);
      if (!combine && state.tryBeginMove?.(state, ctx, x, y)) return;
      if (!combine) state.commitSelection?.();
      const result = state.doMagicWand?.(ctx, x, y);
      if (!result) return;
      const W = ctx.canvas.width,
        H = ctx.canvas.height;
      commitToolSelection(state, result.mask, W, H, selectionMode(state));
    },
    onMove() {},
    onUp() {}
  },

  // PhotoCraft Tool::Crop, Classic Mode. state.cropFrame is the pending frame ([x0, y0, x1, y1])
  // and state.cropAngle its turn about the centre (degrees, clockwise); paint.js commits it
  // (Enter, double-click, the options bar check).
  crop: {
    label: 'Crop',
    icon: 'crop',
    cursor: 'crosshair',
    onDown(ctx, ov, state, x, y) {
      // A line whose release went elsewhere never continues here.
      state.cropStraightenLine = null;
      // The armed button, or Ctrl/Cmd held, makes the drag a line (crop_straighten.rs pointer).
      if ((state.cropStraighten || state.ctrlKey) && !state.cropDrag) {
        state.cropStraightenLine = [
          [x, y],
          [x, y]
        ];
        state.drawing = true;
        drawCropTool(ov, state);
        return;
      }
      const prev = state.cropFrame ?? null;
      const deg = state.cropAngle || 0;
      const hit = prev
        ? cropHitTurned(prev, deg, x, y, CROP_HANDLE_PX / (state.zoom || 1))
        : 'draw';
      const drag = { hit, x0: x, y0: y, prev, deg, wasDefault: !!state.cropDefault, x, y };
      // The corner being drawn; Space moves it with the anchor (crop_ui.rs CropDrag::Draw).
      if (hit === 'draw') drag.cur = [x, y];
      if (hit === 'outside') {
        // Outside the frame a drag turns it about its centre (crop_ui.rs CropDrag::Rotate).
        drag.hit = 'turn';
        drag.cx = (prev[0] + prev[2]) / 2;
        drag.cy = (prev[1] + prev[3]) / 2;
        drag.grab = Math.atan2(y - drag.cy, x - drag.cx);
      } else if (hit === 'draw') state.cropAngle = 0;
      state.cropDrag = drag;
      state.drawing = true;
    },
    onMove(ctx, ov, state, x, y) {
      const line = state.cropStraightenLine;
      if (line) {
        line[1] = [x, y];
        drawCropTool(ov, state);
        return;
      }
      const drag = state.cropDrag;
      if (!drag) return;
      const opts = {
        shift: !!state.shiftKey,
        alt: !!state.altKey,
        ratio: cropToolRatio(ov, state)
      };
      // Any draw, move, resize, or turn makes the frame the user's own.
      state.cropDefault = false;
      const [px, py] = [drag.x, drag.y];
      // The pointer, for the readout beside it.
      [drag.x, drag.y] = [x, y];
      if (drag.hit === 'turn') {
        state.cropAngle = cropTurnedAngle(drag.cx, drag.cy, drag.grab, drag.deg, x, y, opts.shift);
      } else if (drag.hit === 'draw') {
        if (state.cropSpace) {
          // Space: the frame being drawn follows the pointer, keeping its size.
          const [dx, dy] = [x - px, y - py];
          drag.x0 += dx;
          drag.y0 += dy;
          drag.cur = [drag.cur[0] + dx, drag.cur[1] + dy];
        } else drag.cur = [x, y];
        state.cropFrame = cropDraw(drag.x0, drag.y0, drag.cur[0], drag.cur[1], opts);
      } else {
        const [dx, dy] = [x - drag.x0, y - drag.y0];
        state.cropFrame = cropResizedTurned(drag.prev, drag.deg, drag.hit, dx, dy, opts);
      }
      drawCropTool(ov, state);
    },
    onUp(ctx, ov, state, x, y) {
      if (state.cropStraightenLine) {
        TOOLS.crop.straighten(ov, state, state.cropStraightenLine[0], [x, y]);
        return;
      }
      const drag = state.cropDrag;
      if (!drag) return;
      TOOLS.crop.onMove(ctx, ov, state, x, y);
      const f = state.cropFrame;
      // A click (an empty drawn frame) keeps the frame there was, at its angle.
      if (drag.hit === 'draw' && (f[2] - f[0] < 1 || f[3] - f[1] < 1)) {
        state.cropFrame = drag.prev;
        state.cropAngle = drag.deg;
      }
      // A drag that changed nothing leaves an untouched default frame untouched.
      const f1 = state.cropFrame;
      const same = drag.prev && f1 && f1.every((v, i) => v === drag.prev[i]);
      if (same && (state.cropAngle || 0) === drag.deg) state.cropDefault = drag.wasDefault;
      state.cropDrag = null;
      state.cropSpace = false;
      state.drawing = false;
      pushCropStep(state, { frame: drag.prev, angle: drag.deg, isDefault: drag.wasDefault });
      drawCropTool(ov, state);
    },
    /**
     * Space held or released (crop_ui.rs set_space). While a draw drag is in progress, moves
     * shift the frame being drawn at its size; move, resize, and turn drags ignore it.
     */
    setSpace(ov, state, down) {
      state.cropSpace = !!down;
    },
    /** CSS cursor over (x, y) while no drag is in progress. */
    cursorAt(state, x, y) {
      const f = state.cropFrame;
      if (!f || state.cropStraighten || state.ctrlKey) return 'crosshair';
      const deg = state.cropAngle || 0;
      return cropCursor(cropHitTurned(f, deg, x, y, CROP_HANDLE_PX / (state.zoom || 1)), true, deg);
    },
    /**
     * With no pending frame, show the default one (crop_ui.rs ensure_frame): the selection's
     * bounds (selBox { x, y, w, h }) or the whole W x H canvas, upright, fitted to the
     * options-bar ratio. It stays state.cropDefault until an edit; a ratio fit is not one.
     */
    ensureFrame(ov, state, W, H, selBox) {
      if (state.cropFrame || state.cropDrag) return;
      state.cropFrame = cropDefaultFrame(W, H, selBox);
      state.cropAngle = 0;
      state.cropDefault = true;
      const k = cropOptionRatio(state, W, H);
      if (k) state.cropFrame = cropFittedRatio(state.cropFrame, k) ?? state.cropFrame;
      drawCropTool(ov, state);
    },
    /**
     * Fit the pending frame to the options-bar ratio about its centre, keeping its angle
     * (crop_ui.rs apply_ratio). No-op without a frame, a ratio, or mid-drag.
     */
    fitRatio(ov, state) {
      const k = cropToolRatio(ov, state);
      if (!state.cropFrame || state.cropDrag || !k) return;
      state.cropFrame = cropFittedRatio(state.cropFrame, k) ?? state.cropFrame;
      drawCropTool(ov, state);
    },
    /**
     * Swap the pending frame between portrait and landscape about its centre, keeping its
     * angle (crop_ui.rs swap_orientation). Swap the ratio key first; with a ratio set the frame
     * is fitted to it, without one its sides swap.
     */
    swap(ov, state) {
      const opts = (state.toolOptions.crop ??= {});
      if (opts.ratio === CROP_WXH) {
        // W x H mode swaps the fields (crop_size.rs swap); a held target refits the frame.
        [opts.cropW, opts.cropH] = [opts.cropH ?? '', opts.cropW ?? ''];
        state.cropDefault = false;
        if (cropToolRatio(ov, state)) {
          TOOLS.crop.fitRatio(ov, state);
          return;
        }
      }
      const key = cropSwappedRatio(opts.ratio ?? '', ov.canvas.width, ov.canvas.height);
      if (key) {
        opts.ratio = key;
        state.cropDefault = false;
        TOOLS.crop.fitRatio(ov, state);
        return;
      }
      if (!state.cropFrame || state.cropDrag) return;
      state.cropDefault = false;
      state.cropFrame = cropSwapped(state.cropFrame);
      drawCropTool(ov, state);
    },
    /**
     * Apply a Ratio select key (cropChosen: a size preset, Front Image, Clear, or a ratio) to
     * the crop options and refit the frame once (crop_size.rs chosen). No-op mid-drag.
     */
    choose(ov, state, key) {
      if (state.cropDrag) return;
      const opts = (state.toolOptions.crop ??= {});
      Object.assign(opts, cropChosen(key, opts, ov.canvas.width, ov.canvas.height));
      TOOLS.crop.fitRatio(ov, state);
    },
    /** O: the next overlay, its orientation starting over (crop_overlay.rs cycle). */
    cycleOverlay(ov, state) {
      const opts = (state.toolOptions.crop ??= {});
      opts.cropOverlay = cropNextOverlay(opts.cropOverlay ?? 'thirds');
      opts.cropOverlayOrientation = 0;
      TOOLS.crop.redraw(ov, state);
    },
    /** Shift+O: the overlay's next orientation (crop_overlay.rs cycle_orientation). */
    cycleOrientation(ov, state) {
      const opts = (state.toolOptions.crop ??= {});
      const n = cropOverlayOrientations(opts.cropOverlay ?? 'thirds');
      opts.cropOverlayOrientation = (((opts.cropOverlayOrientation ?? 0) % n) + 1) % n;
      TOOLS.crop.redraw(ov, state);
    },
    /** H: toggle Show Cropped Area (crop_shield.rs keys). No-op without a frame or mid-drag. */
    toggleCroppedArea(ov, state) {
      if (!state.cropFrame || state.cropDrag) return false;
      const opts = (state.toolOptions.crop ??= {});
      opts.cropShieldShow = !(opts.cropShieldShow ?? CROP_SHIELD_DEFAULTS.showCroppedArea);
      TOOLS.crop.redraw(ov, state);
      return true;
    },
    /**
     * The Straighten button (crop_straighten.rs toggle): arm or disarm one line. paint.js
     * re-renders the options bar through state.onCropStraighten when a line disarms it.
     */
    setStraighten(ov, state, on) {
      state.cropStraighten = !!on;
      state.cropStraightenLine = null;
      TOOLS.crop.redraw(ov, state);
    },
    /**
     * Release of a Straighten line a → b (crop_straighten.rs pointer Up / apply): disarm, then
     * turn the frame so the line is level or plumb and fit it inside the image, keeping its
     * proportions. A line under CROP_STRAIGHTEN_MIN_PX screen px only disarms. A pending edit:
     * Enter commits and Escape cancels it.
     */
    straighten(ov, state, a, b) {
      state.cropStraighten = false;
      state.cropStraightenLine = null;
      state.drawing = false;
      const before = cropStep(state);
      const zoom = state.zoom > 0 && Number.isFinite(state.zoom) ? state.zoom : 1;
      const deg = cropStraightenAngle(a, b, CROP_STRAIGHTEN_MIN_PX / zoom);
      const [W, H] = [ov.canvas.width, ov.canvas.height];
      const f = state.cropFrame;
      const [w, h] = f && f.every(Number.isFinite) ? [f[2] - f[0], f[3] - f[1]] : [W, H];
      const r = deg === null ? null : cropStraightenFitted(w, h, W, H, deg);
      const same = r && f && r.every((v, i) => v === f[i]) && (state.cropAngle || 0) === deg;
      if (r && !same) {
        state.cropFrame = r;
        state.cropAngle = deg;
        state.cropDefault = false;
      }
      pushCropStep(state, before);
      TOOLS.crop.redraw(ov, state);
      state.onCropStraighten?.();
    },
    /**
     * Undo (or redo) one frame step (crop_ui.rs step): the popped step comes back and the
     * current one goes on the other stack. False, changing nothing, when there is none.
     */
    stepHistory(ov, state, redo) {
      const from = redo ? state.cropRedo : state.cropUndo;
      const s = from?.pop();
      if (!s) return false;
      const now = cropStep(state);
      (redo ? (state.cropUndo ??= []) : (state.cropRedo ??= [])).push(now);
      state.cropFrame = s.frame ? s.frame.slice() : null;
      state.cropAngle = s.angle;
      state.cropDefault = s.isDefault;
      if (state.cropFrame) drawCropTool(ov, state);
      else ov.clearRect(0, 0, ov.canvas.width, ov.canvas.height);
      state.onCropHistory?.();
      return true;
    },
    /**
     * Whether Undo ('undo') or Redo ('redo') steps the frame (crop_ui.rs is_enabled): null while
     * both stacks are empty (the document's history applies), else whether that stack has one.
     */
    historyEnabled(state, which) {
      const [u, r] = [state.cropUndo?.length ?? 0, state.cropRedo?.length ?? 0];
      if (!u && !r) return null;
      return (which === 'redo' ? r : u) > 0;
    },
    /** Redraw the pending frame (after an overlay or shield option changes). */
    redraw(ov, state) {
      if (state.cropFrame) drawCropTool(ov, state);
    },
    /** Drop the pending frame without cropping. */
    cancel(ov, state) {
      state.cropFrame = null;
      state.cropAngle = 0;
      state.cropDefault = false;
      state.cropDrag = null;
      state.cropSpace = false;
      state.cropStraighten = false;
      state.cropStraightenLine = null;
      state.drawing = false;
      state.cropUndo = [];
      state.cropRedo = [];
      ov.clearRect(0, 0, ov.canvas.width, ov.canvas.height);
      state.onCropHistory?.();
    }
  },

  // PhotoCraft Tool::PerspectiveCrop (perspective_crop_ui.rs pointer). state.perspectiveQuad is
  // the pending quad, [[x, y] x 4] TL, TR, BR, BL in document px, or null; state.perspectiveClicks
  // holds corners clicked before the fourth. paint.js commits the quad (Enter, the options bar
  // check) through perspectiveCropImageData.
  perspectiveCrop: {
    label: 'Perspective Crop',
    icon: 'perspective-crop',
    cursor: 'crosshair',
    onDown(ctx, ov, state, x, y) {
      const q = state.perspectiveQuad;
      const tol = CROP_HANDLE_PX / (state.zoom || 1);
      let drag = null;
      if (!q) drag = { kind: 'new', start: [x, y], cur: [x, y] };
      else {
        // The nearest corner within reach moves alone, keeping the press offset.
        let index = -1;
        let best = Infinity;
        q.forEach(([cx, cy], i) => {
          const d = Math.hypot(cx - x, cy - y);
          if (d <= tol && d < best) [index, best] = [i, d];
        });
        if (index >= 0)
          drag = { kind: 'corner', index, offset: [x - q[index][0], y - q[index][1]] };
        else if (quadContains(q, x, y)) {
          drag = { kind: 'move', start: [x, y], quad: q.map((c) => c.slice()) };
        }
      }
      state.perspectiveDrag = drag;
      state.drawing = !!drag;
    },
    onMove(ctx, ov, state, x, y) {
      const drag = state.perspectiveDrag;
      if (!drag) return;
      if (drag.kind === 'new') drag.cur = [x, y];
      else if (drag.kind === 'corner') {
        state.perspectiveQuad[drag.index] = [x - drag.offset[0], y - drag.offset[1]];
      } else {
        const [dx, dy] = [x - drag.start[0], y - drag.start[1]];
        state.perspectiveQuad = drag.quad.map(([cx, cy]) => [cx + dx, cy + dy]);
      }
      drawPerspectiveCrop(ov, state);
    },
    onUp(ctx, ov, state, x, y) {
      const drag = state.perspectiveDrag;
      if (drag) TOOLS.perspectiveCrop.onMove(ctx, ov, state, x, y);
      if (drag?.kind === 'new') {
        // A press that barely moves places a corner; the fourth makes the quad in TL, TR, BR,
        // BL order. A drag drops the clicks and makes the box, or none when it has no width or
        // no height (a_drag_without_area_leaves_no_quad).
        const click = (CROP_HANDLE_PX * PERSPECTIVE_CLICK) / (state.zoom || 1);
        const [sx, sy] = drag.start;
        const clicks = state.perspectiveClicks ?? [];
        if (Math.abs(drag.cur[0] - sx) <= click && Math.abs(drag.cur[1] - sy) <= click) {
          clicks.push([sx, sy]);
          if (clicks.length === 4) {
            state.perspectiveQuad = perspectiveOrdered(clicks);
            state.perspectiveClicks = [];
          } else state.perspectiveClicks = clicks;
        } else {
          state.perspectiveClicks = [];
          state.perspectiveQuad = boxQuad(drag.start, drag.cur);
        }
      }
      state.perspectiveDrag = null;
      state.drawing = false;
      drawPerspectiveCrop(ov, state);
    },
    /** Drop the pending quad without cropping (Esc, the options bar cancel, leaving the tool). */
    cancel(ov, state) {
      state.perspectiveQuad = null;
      state.perspectiveClicks = [];
      state.perspectiveDrag = null;
      state.drawing = false;
      ov.clearRect(0, 0, ov.canvas.width, ov.canvas.height);
    }
  },

  // Navigation tools change the view, not the document. pointer.js handles their drags in view
  // points (paint/view.js) before any document tool runs, so these handlers never fire.
  hand: viewTool('Hand', 'hand', 'grab'),
  rotateView: viewTool('Rotate View', 'compass', 'grab'),
  zoom: viewTool('Zoom', 'zoom-in', 'zoom-in')
};

function viewTool(label, icon, cursor) {
  return { label, icon, cursor, view: true, onDown() {}, onMove() {}, onUp() {} };
}

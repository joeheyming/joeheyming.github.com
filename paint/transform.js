// Canvas and layer transforms. Image Rotation is a port of PhotoCraft
// crates/engine/src/mode_cmds.rs rotated_size / rotate_arbitrary; Free Transform follows
// PhotoCraft edit.freeTransform (eight scale handles, rotate outside the box, Enter / Escape).

// The canvas size that holds a W × H image turned by deg degrees.
export function rotatedSize(W, H, deg) {
  const r = (deg * Math.PI) / 180;
  const s = Math.abs(Math.sin(r));
  const c = Math.abs(Math.cos(r));
  return {
    width: Math.max(1, Math.ceil(W * c + H * s - 1e-6)),
    height: Math.max(1, Math.ceil(W * s + H * c - 1e-6))
  };
}

// Bilinear sample of the bw × bh box at (bx, by) in src (row stride W pixels) at box-local
// (u, v), where pixel centres sit on integers. Writes premultiplied 0..255 colour and 0..1
// alpha into acc. clamp repeats the box's edge pixels; otherwise taps outside are transparent.
function bilinear(src, W, bx, by, bw, bh, u, v, clamp, acc) {
  if (clamp) {
    u = Math.min(Math.max(u, 0), bw - 1);
    v = Math.min(Math.max(v, 0), bh - 1);
  }
  const x0 = Math.floor(u);
  const y0 = Math.floor(v);
  const tx = u - x0;
  const ty = v - y0;
  let pr = 0;
  let pg = 0;
  let pb = 0;
  let a = 0;
  for (let j = 0; j < 2; j++) {
    const sy = y0 + j;
    if (sy < 0 || sy >= bh) continue;
    const wy = j ? ty : 1 - ty;
    for (let k = 0; k < 2; k++) {
      const sx = x0 + k;
      if (sx < 0 || sx >= bw) continue;
      const w = wy * (k ? tx : 1 - tx);
      if (w === 0) continue;
      const i = ((by + sy) * W + bx + sx) * 4;
      const wa = (w * src[i + 3]) / 255;
      pr += src[i] * wa;
      pg += src[i + 1] * wa;
      pb += src[i + 2] * wa;
      a += wa;
    }
  }
  acc[0] = pr;
  acc[1] = pg;
  acc[2] = pb;
  acc[3] = a;
}

// Quarter turns clockwise (0..3) when deg is a multiple of 90, else -1.
function quarterTurns(deg) {
  const k = deg / 90;
  const n = Math.round(k);
  if (Math.abs(k - n) > 1e-9 / 90) return -1;
  return ((n % 4) + 4) % 4;
}

// Mirror img ({ width, height, data }) left-right (horizontal) or top-bottom, in a new buffer
// (PhotoCraft Image › Image Rotation › Flip Canvas).
export function flipImageData(img, horizontal) {
  const { width: W, height: H, data: src } = img;
  const out = new Uint8ClampedArray(src.length);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const sx = horizontal ? W - 1 - x : x;
      const sy = horizontal ? y : H - 1 - y;
      const s = (sy * W + sx) * 4;
      const o = (y * W + x) * 4;
      out[o] = src[s];
      out[o + 1] = src[s + 1];
      out[o + 2] = src[s + 2];
      out[o + 3] = src[s + 3];
    }
  }
  return { width: W, height: H, data: out };
}

// Rotate img ({ width, height, data }) clockwise on screen by deg about its centre.
// The result is rotatedSize big, sampled bilinearly (premultiplied) at the inverse-mapped
// pixel centre, transparent outside the source. fill (RGBA bytes or null) is composited
// under the result, the way PhotoCraft keeps the Background opaque.
export function rotateImageData(img, deg, fill = null) {
  const { width: W, height: H, data: src } = img;
  const { width: NW, height: NH } = rotatedSize(W, H, deg);
  const out = new Uint8ClampedArray(NW * NH * 4);
  const fa = fill ? fill[3] / 255 : 0;
  const put = (o, pr, pg, pb, a) => {
    // pr..pb are premultiplied 0..255, a is 0..1.
    if (fa > 0) {
      const k = fa * (1 - a);
      pr += fill[0] * k;
      pg += fill[1] * k;
      pb += fill[2] * k;
      a += k;
    }
    if (a <= 0) return;
    out[o] = pr / a;
    out[o + 1] = pg / a;
    out[o + 2] = pb / a;
    out[o + 3] = a * 255;
  };

  const q = quarterTurns(deg);
  if (q >= 0) {
    // Exact pixel moves: no resampling blur.
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let X, Y;
        if (q === 0) [X, Y] = [x, y];
        else if (q === 1) [X, Y] = [H - 1 - y, x];
        else if (q === 2) [X, Y] = [W - 1 - x, H - 1 - y];
        else [X, Y] = [y, W - 1 - x];
        const i = (y * W + x) * 4;
        const o = (Y * NW + X) * 4;
        if (!fill) {
          out[o] = src[i];
          out[o + 1] = src[i + 1];
          out[o + 2] = src[i + 2];
          out[o + 3] = src[i + 3];
          continue;
        }
        const a = src[i + 3] / 255;
        put(o, src[i] * a, src[i + 1] * a, src[i + 2] * a, a);
      }
    }
    return { width: NW, height: NH, data: out };
  }

  const r = (deg * Math.PI) / 180;
  const s = Math.sin(r);
  const c = Math.cos(r);
  const cx = W / 2;
  const cy = H / 2;
  const nx = NW / 2;
  const ny = NH / 2;
  const acc = [0, 0, 0, 0];
  for (let Y = 0; Y < NH; Y++) {
    for (let X = 0; X < NW; X++) {
      // Inverse of x' = c·x − s·y, y' = s·x + c·y about the centres.
      const dx = X + 0.5 - nx;
      const dy = Y + 0.5 - ny;
      const u = c * dx + s * dy + cx - 0.5;
      const v = -s * dx + c * dy + cy - 0.5;
      bilinear(src, W, 0, 0, W, H, u, v, false, acc);
      put((Y * NW + X) * 4, acc[0], acc[1], acc[2], acc[3]);
    }
  }
  return { width: NW, height: NH, data: out };
}

// Straighten Layer (PhotoCraft analysis_cmds.rs straighten, the edit.transform path): img
// turned clockwise on screen by deg about its centre, same size, sampled bilinearly
// (premultiplied) at the inverse-mapped pixel centre; uncovered pixels are transparent.
export function straightenImageData(img, deg) {
  const { width: W, height: H, data: src } = img;
  const out = new Uint8ClampedArray(W * H * 4);
  const r = (deg * Math.PI) / 180;
  const s = Math.sin(r);
  const c = Math.cos(r);
  const cx = W / 2;
  const cy = H / 2;
  const acc = [0, 0, 0, 0];
  for (let Y = 0; Y < H; Y++) {
    for (let X = 0; X < W; X++) {
      const dx = X + 0.5 - cx;
      const dy = Y + 0.5 - cy;
      bilinear(
        src,
        W,
        0,
        0,
        W,
        H,
        c * dx + s * dy + cx - 0.5,
        -s * dx + c * dy + cy - 0.5,
        false,
        acc
      );
      const a = acc[3];
      if (a <= 0) continue;
      const o = (Y * W + X) * 4;
      out[o] = acc[0] / a;
      out[o + 1] = acc[1] / a;
      out[o + 2] = acc[2] / a;
      out[o + 3] = a * 255;
    }
  }
  return { width: W, height: H, data: out };
}

// PhotoCraft analysis_cmds.rs inscribed: the largest axis-aligned rectangle inside a w × h
// image turned rad radians, as [width, height] (unfloored).
export function inscribedSize(w, h, rad) {
  const sa = Math.abs(Math.sin(rad));
  const ca = Math.abs(Math.cos(rad));
  const longW = w >= h;
  const long = longW ? w : h;
  const short = longW ? h : w;
  if (short <= 2 * sa * ca * long || Math.abs(sa - ca) < 1e-10) {
    const x = 0.5 * short;
    return longW ? [x / sa, x / ca] : [x / ca, x / sa];
  }
  const c2 = ca * ca - sa * sa;
  return [(w * ca - h * sa) / c2, (h * ca - w * sa) / c2];
}

// The centred crop Straighten takes from the newW × newH turned canvas of a w0 × h0 image.
export function straightenCropRect(w0, h0, newW, newH, deg) {
  const [iw, ih] = inscribedSize(w0, h0, (deg * Math.PI) / 180);
  const width = Math.min(Math.max(Math.floor(iw), 1), newW);
  const height = Math.min(Math.max(Math.floor(ih), 1), newH);
  return {
    x: Math.round((newW - width) / 2),
    y: Math.round((newH - height) / 2),
    width,
    height
  };
}

// The Crop tool's turned frame (PhotoCraft image_cmds.rs rotated_crop): frame [x0, y0, x1, y1]
// turned deg degrees clockwise about its centre. The result is the frame's whole-pixel size;
// each pixel samples img bilinearly (premultiplied) at its centre carried onto the turned frame,
// transparent where the image does not reach. fill (RGBA bytes or null) is composited under it.
export function turnedCropImageData(img, frame, deg, fill = null) {
  const { width: W, height: H, data: src } = img;
  const w = Math.max(1, Math.round(frame[2] - frame[0]));
  const h = Math.max(1, Math.round(frame[3] - frame[1]));
  const cx = (frame[0] + frame[2]) / 2;
  const cy = (frame[1] + frame[3]) / 2;
  const r = (deg * Math.PI) / 180;
  const s = Math.sin(r);
  const c = Math.cos(r);
  const out = new Uint8ClampedArray(w * h * 4);
  const fa = fill ? fill[3] / 255 : 0;
  const acc = [0, 0, 0, 0];
  for (let Y = 0; Y < h; Y++) {
    for (let X = 0; X < w; X++) {
      const dx = X + 0.5 - w / 2;
      const dy = Y + 0.5 - h / 2;
      const u = cx + c * dx - s * dy - 0.5;
      const v = cy + s * dx + c * dy - 0.5;
      bilinear(src, W, 0, 0, W, H, u, v, false, acc);
      let [pr, pg, pb, a] = acc;
      if (fa > 0) {
        const k = fa * (1 - a);
        pr += fill[0] * k;
        pg += fill[1] * k;
        pb += fill[2] * k;
        a += k;
      }
      if (a <= 0) continue;
      const o = (Y * w + X) * 4;
      out[o] = pr / a;
      out[o + 1] = pg / a;
      out[o + 2] = pb / a;
      out[o + 3] = a * 255;
    }
  }
  return { width: w, height: h, data: out };
}

// Resample img to exactly w × h (the Crop tool's W x H commit, PhotoCraft commit_params
// targetWidth / targetHeight): each output pixel centre maps onto the source and samples it
// bilinearly (premultiplied), repeating edge pixels.
export function resampleImageData(img, w, h) {
  const { width: W, height: H, data: src } = img;
  w = Math.max(1, Math.round(w));
  h = Math.max(1, Math.round(h));
  const out = new Uint8ClampedArray(w * h * 4);
  const sx = W / w;
  const sy = H / h;
  const acc = [0, 0, 0, 0];
  for (let Y = 0; Y < h; Y++) {
    for (let X = 0; X < w; X++) {
      bilinear(src, W, 0, 0, W, H, (X + 0.5) * sx - 0.5, (Y + 0.5) * sy - 0.5, true, acc);
      const a = acc[3];
      if (a <= 0) continue;
      const o = (Y * w + X) * 4;
      out[o] = acc[0] / a;
      out[o + 1] = acc[1] / a;
      out[o + 2] = acc[2] / a;
      out[o + 3] = a * 255;
    }
  }
  return { width: w, height: h, data: out };
}

// ── Free Transform ───────────────────────────────────────────────────────────
// A transform is { tx, ty, sx, sy, angle } about the source box: scale by (sx, sy) about the
// box centre, turn clockwise on screen by angle radians, then move the centre by (tx, ty).

export const IDENTITY_TRANSFORM = Object.freeze({ tx: 0, ty: 0, sx: 1, sy: 1, angle: 0 });

// The 2x3 affine [a, b, c, d, e, f] (canvas setTransform order: X = a·x + c·y + e,
// Y = b·x + d·y + f) that takes source canvas coordinates through t.
export function freeTransformAffine(box, t) {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const cos = Math.cos(t.angle);
  const sin = Math.sin(t.angle);
  const a = cos * t.sx;
  const b = sin * t.sx;
  const c = -sin * t.sy;
  const d = cos * t.sy;
  return [a, b, c, d, cx + t.tx - a * cx - c * cy, cy + t.ty - b * cx - d * cy];
}

function invertAffine([a, b, c, d, e, f]) {
  const det = a * d - b * c;
  if (!det) return null;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

function applyAffine(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

// The box's corners through the affine, clockwise from the top-left.
export function transformedCorners(box, affine) {
  const { x, y, w, h } = box;
  return [
    applyAffine(affine, x, y),
    applyAffine(affine, x + w, y),
    applyAffine(affine, x + w, y + h),
    applyAffine(affine, x, y + h)
  ];
}

// Map img's box ({ x, y, w, h }) through affine onto a width × height { width, height, data }.
// Each output pixel centre is inverse-mapped into the box and sampled bilinearly in
// premultiplied alpha (edge pixels repeat inside the box); everything outside the transformed
// box is transparent. nearest takes the source pixel under the centre instead (PhotoCraft's
// "nearest" interpolation, which keeps the Edit › Transform presets exact).
export function transformImageData(
  img,
  box,
  affine,
  width = img.width,
  height = img.height,
  nearest = false
) {
  const out = new Uint8ClampedArray(width * height * 4);
  const inv = invertAffine(affine);
  if (!inv || box.w <= 0 || box.h <= 0) return { width, height, data: out };
  const xs = [];
  const ys = [];
  for (const [px, py] of transformedCorners(box, affine)) {
    xs.push(px);
    ys.push(py);
  }
  const X0 = Math.max(0, Math.floor(Math.min(...xs)));
  const X1 = Math.min(width, Math.ceil(Math.max(...xs)));
  const Y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const Y1 = Math.min(height, Math.ceil(Math.max(...ys)));
  const eps = 1e-9;
  const acc = [0, 0, 0, 0];
  for (let Y = Y0; Y < Y1; Y++) {
    for (let X = X0; X < X1; X++) {
      const [sx, sy] = applyAffine(inv, X + 0.5, Y + 0.5);
      const u = sx - box.x;
      const v = sy - box.y;
      if (u < -eps || v < -eps || u >= box.w + eps || v >= box.h + eps) continue;
      const o = (Y * width + X) * 4;
      if (nearest) {
        const ix = box.x + Math.min(box.w - 1, Math.max(0, Math.floor(u)));
        const iy = box.y + Math.min(box.h - 1, Math.max(0, Math.floor(v)));
        const s = (iy * img.width + ix) * 4;
        if (!img.data[s + 3]) continue;
        for (let k = 0; k < 4; k++) out[o + k] = img.data[s + k];
        continue;
      }
      bilinear(img.data, img.width, box.x, box.y, box.w, box.h, u - 0.5, v - 0.5, true, acc);
      const a = acc[3];
      if (a <= 0) continue;
      out[o] = acc[0] / a;
      out[o + 1] = acc[1] / a;
      out[o + 2] = acc[2] / a;
      out[o + 3] = a * 255;
    }
  }
  return { width, height, data: out };
}

// Split a W × H layer for Free Transform: source keeps the pixels under mask (null = all),
// base is the layer with them removed (filled with fill RGBA bytes, or transparent).
export function liftForTransform(img, mask, fill = null) {
  const { width: W, height: H, data } = img;
  const source = new Uint8ClampedArray(data);
  const base = new Uint8ClampedArray(data);
  for (let p = 0; p < W * H; p++) {
    const i = p * 4;
    if (mask && !mask[p]) {
      source[i + 3] = 0;
      continue;
    }
    base[i] = fill ? fill[0] : 0;
    base[i + 1] = fill ? fill[1] : 0;
    base[i + 2] = fill ? fill[2] : 0;
    base[i + 3] = fill ? fill[3] : 0;
  }
  return {
    source: { width: W, height: H, data: source },
    base: { width: W, height: H, data: base }
  };
}

// ── Edit › Transform ─────────────────────────────────────────────────────────

// Rust f64::round: halves go away from zero.
const roundAway = (v) => Math.sign(v) * Math.round(Math.abs(v));

// Rotate 180° / 90° CW / 90° CCW, Flip Horizontal / Vertical about the centre of box, as an
// affine (PhotoCraft extra_cmds.rs transform_preset). Integer offsets keep these exact pixel
// permutations on the grid under nearest sampling.
export function transformPresetAffine(kind, box) {
  const sx = 2 * box.x + box.w;
  const sy = 2 * box.y + box.h;
  const cx = sx / 2;
  const cy = sy / 2;
  switch (kind) {
    case 'rotate180':
      return [-1, 0, 0, -1, sx, sy];
    case 'rotate90Cw':
      return [0, 1, -1, 0, roundAway(cx + cy), roundAway(cy - cx)];
    case 'rotate90Ccw':
      return [0, -1, 1, 0, roundAway(cx - cy), roundAway(cx + cy)];
    case 'flipHorizontal':
      return [-1, 0, 0, 1, sx, 0];
    case 'flipVertical':
      return [1, 0, 0, -1, 0, sy];
    default:
      return null;
  }
}

// What a preset does to an open Free Transform box (transform_tool.rs box_preset): scale along
// the box's own axes by (kx, ky), then turn clockwise by angle, both about its centre.
const BOX_PRESETS = {
  rotate180: [1, 1, Math.PI],
  rotate90Cw: [1, 1, Math.PI / 2],
  rotate90Ccw: [1, 1, -Math.PI / 2],
  flipHorizontal: [-1, 1, 0],
  flipVertical: [1, -1, 0]
};

/** The Free Transform t after the preset kind turns or flips its box. */
export function presetFreeTransform(t, kind) {
  const [kx, ky, angle] = BOX_PRESETS[kind] ?? [1, 1, 0];
  return { ...t, sx: t.sx * kx, sy: t.sy * ky, angle: t.angle + angle };
}

// Edit › Transform › Scale / Rotate restrict the box to one gesture: Scale keeps the handles
// and the move inside but does not turn; Rotate turns from the handles and from outside.
// null means the press does nothing.
export function restrictFreeTransformGrab(grab, mode) {
  if (mode === 'scale') return grab === 'rotate' ? null : grab;
  if (mode === 'rotate') return grab === 'move' ? 'move' : 'rotate';
  return grab;
}

// A 6-entry affine goes through transformImageData; a 9-entry document homography (a skewed,
// distorted, or perspective box) through warpQuad.
function mapThrough(img, box, m, W, H, nearest) {
  if (m.length === 9) return warpQuad(img, homographyCorners(box, m), W, H, box, nearest);
  return transformImageData(img, box, m, W, H, nearest);
}

// Move img's pixels under mask (null = all) through affine (or a homography), where box bounds what moves: the
// rest of the layer stays, the uncovered area becomes fill (RGBA bytes) or transparent, and the
// moved pixels land over it. Returns a new { width, height, data }.
export function transformLayerPixels(
  img,
  mask,
  box,
  affine,
  { nearest = false, fill = null } = {}
) {
  const { width: W, height: H } = img;
  const { source, base } = liftForTransform(img, mask, fill);
  const moved = mapThrough(source, box, affine, W, H, nearest).data;
  const out = base.data;
  for (let i = 0; i < out.length; i += 4) {
    const sa = moved[i + 3] / 255;
    if (!sa) continue;
    const da = (out[i + 3] / 255) * (1 - sa);
    const a = sa + da;
    for (let k = 0; k < 3; k++) out[i + k] = (moved[i + k] * sa + out[i + k] * da) / a;
    out[i + 3] = a * 255;
  }
  return { width: W, height: H, data: out };
}

// A 0/1 selection mask moved through the same affine (nearest), so the outline follows its pixels.
export function transformMask(mask, W, H, box, affine) {
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let p = 0; p < W * H; p++) rgba[p * 4 + 3] = mask[p] ? 255 : 0;
  const moved = mapThrough({ width: W, height: H, data: rgba }, box, affine, W, H, true);
  const out = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p++) out[p] = moved.data[p * 4 + 3] ? 1 : 0;
  return out;
}

// Select › Transform Selection: the 0/1 mask through a Free Transform box ({ box, t, quad, mesh }
// as on state.freeTransform), sampled like the pixels would be and kept where coverage is half.
export function transformSelectionMask(mask, W, H, { box, t, quad = null, mesh = null }) {
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let p = 0; p < W * H; p++) rgba[p * 4 + 3] = mask[p] ? 255 : 0;
  const src = { width: W, height: H, data: rgba };
  const moved = mesh
    ? meshWarp(src, mesh, W, H, box)
    : quad
    ? warpQuad(src, quad, W, H, box)
    : transformImageData(src, box, freeTransformAffine(box, t), W, H);
  const out = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p++) out[p] = moved.data[p * 4 + 3] >= 128 ? 1 : 0;
  return out;
}

// Bounding box of pixels with alpha > 0, or null.
export function opaqueBBox(img) {
  const { width: W, height: H, data } = img;
  let x0 = W;
  let y0 = H;
  let x1 = -1;
  let y1 = -1;
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

// Pointer (x, y) in the box's local frame, in source pixels from the box centre.
function toLocal(box, t, x, y) {
  const dx = x - (box.x + box.w / 2 + t.tx);
  const dy = y - (box.y + box.h / 2 + t.ty);
  const cos = Math.cos(t.angle);
  const sin = Math.sin(t.angle);
  return [(cos * dx + sin * dy) / t.sx, (-sin * dx + cos * dy) / t.sy];
}

// What a press at (x, y) grabs: { hx, hy } for one of the eight handles (each −1, 0, or 1),
// 'move' inside the box, or 'rotate' outside it. tol is the handle reach in canvas pixels.
export function hitFreeTransform(box, t, x, y, tol) {
  const [lx, ly] = toLocal(box, t, x, y);
  const hw = box.w / 2;
  const hh = box.h / 2;
  const tx = tol / Math.abs(t.sx);
  const ty = tol / Math.abs(t.sy);
  for (const hy of [-1, 0, 1]) {
    for (const hx of [-1, 0, 1]) {
      if (!hx && !hy) continue;
      if (Math.abs(lx - hx * hw) <= tx && Math.abs(ly - hy * hh) <= ty) return { hx, hy };
    }
  }
  return Math.abs(lx) <= hw && Math.abs(ly) <= hh ? 'move' : 'rotate';
}

// The transform after dragging grab (from hitFreeTransform) from start to point, given the
// transform t0 at the press. A handle drag keeps the opposite handle fixed; shift keeps the
// aspect ratio on a scale and snaps a rotation to 15°.
export function dragFreeTransform(box, t0, grab, start, point, shift = false) {
  if (grab === 'move') {
    return { ...t0, tx: t0.tx + point.x - start.x, ty: t0.ty + point.y - start.y };
  }
  const cx = box.x + box.w / 2 + t0.tx;
  const cy = box.y + box.h / 2 + t0.ty;
  if (grab === 'rotate') {
    let angle =
      t0.angle + Math.atan2(point.y - cy, point.x - cx) - Math.atan2(start.y - cy, start.x - cx);
    if (shift) angle = Math.round(angle / (Math.PI / 12)) * (Math.PI / 12);
    return { ...t0, angle };
  }
  const { hx, hy } = grab;
  const cos = Math.cos(t0.angle);
  const sin = Math.sin(t0.angle);
  // Pointer in the turned (unscaled) frame about the current centre.
  const qx = cos * (point.x - cx) + sin * (point.y - cy);
  const qy = -sin * (point.x - cx) + cos * (point.y - cy);
  const ax = (-hx * t0.sx * box.w) / 2;
  const ay = (-hy * t0.sy * box.h) / 2;
  let sx = hx ? (qx - ax) / (hx * box.w) : t0.sx;
  let sy = hy ? (qy - ay) / (hy * box.h) : t0.sy;
  if (shift) {
    const kx = sx / t0.sx;
    const ky = sy / t0.sy;
    const k = !hy || (hx && Math.abs(kx) > Math.abs(ky)) ? kx : ky;
    sx = t0.sx * k;
    sy = t0.sy * k;
  }
  // Keep a sliver so the affine stays invertible.
  if (Math.abs(sx * box.w) < 1) sx = (sx < 0 ? -1 : 1) / box.w;
  if (Math.abs(sy * box.h) < 1) sy = (sy < 0 ? -1 : 1) / box.h;
  // The new centre sits halfway between the anchor and the dragged edge.
  const lx = hx ? ax + (hx * sx * box.w) / 2 : 0;
  const ly = hy ? ay + (hy * sy * box.h) / 2 : 0;
  return {
    ...t0,
    sx,
    sy,
    tx: t0.tx + cos * lx - sin * ly,
    ty: t0.ty + sin * lx + cos * ly
  };
}

// ── Perspective Crop (PhotoCraft transform.rs Homography, convex_quad, quad_size) ─────────
// A quad is [[x, y] x 4] in TL, TR, BR, BL order, document px. A homography is the 3x3 matrix
// [m0..m8] row-major: X = (m0·x + m1·y + m2) / w, Y = (m3·x + m4·y + m5) / w, w = m6·x + m7·y + m8.

/** (x, y) through the homography m. */
export function applyHomography(m, x, y) {
  const w = m[6] * x + m[7] * y + m[8];
  return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w];
}

/** The inverse homography (transform.rs Homography::inverse), or null when singular. */
export function invertHomography(m) {
  const c = [
    m[4] * m[8] - m[5] * m[7],
    m[2] * m[7] - m[1] * m[8],
    m[1] * m[5] - m[2] * m[4],
    m[5] * m[6] - m[3] * m[8],
    m[0] * m[8] - m[2] * m[6],
    m[2] * m[3] - m[0] * m[5],
    m[3] * m[7] - m[4] * m[6],
    m[1] * m[6] - m[0] * m[7],
    m[0] * m[4] - m[1] * m[3]
  ];
  const det = m[0] * c[0] + m[1] * c[3] + m[2] * c[6];
  if (!(Math.abs(det) >= 1e-12)) return null;
  return c.map((v) => v / det);
}

// Unit square → quad (transform.rs square_to_quad), or null for a degenerate quad.
function squareToQuad(q) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const sx = x0 - x1 + x2 - x3;
  const sy = y0 - y1 + y2 - y3;
  if (Math.abs(sx) < 1e-12 && Math.abs(sy) < 1e-12) {
    return [x1 - x0, x3 - x0, x0, y1 - y0, y3 - y0, y0, 0, 0, 1];
  }
  const [dx1, dx2, dy1, dy2] = [x1 - x2, x3 - x2, y1 - y2, y3 - y2];
  const den = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(den) < 1e-12) return null;
  const g = (sx * dy2 - dx2 * sy) / den;
  const h = (dx1 * sy - sx * dy1) / den;
  return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h, 1];
}

/**
 * The homography taking the w x h rectangle (0, 0)–(w, h) onto quad, corner to corner
 * (transform.rs Homography::rect_to_quad). null for a degenerate quad or a size not above 0.
 */
export function homographyFromQuad(quad, w, h) {
  if (!(w > 0 && h > 0)) return null;
  const s = squareToQuad(quad);
  if (!s) return null;
  // s · diag(1 / w, 1 / h, 1).
  return [s[0] / w, s[1] / h, s[2], s[3] / w, s[4] / h, s[5], s[6] / w, s[7] / h, s[8]];
}

/**
 * Is quad a usable Perspective Crop quad (transform.rs convex_quad): finite, strictly convex
 * with every corner angle above ~0.06°, wound clockwise on screen (y down), at least 1 px² in area.
 */
export function convexQuad(q) {
  if (q.flat().some((v) => !Number.isFinite(v))) return false;
  let area2 = 0;
  for (let i = 0; i < 4; i++) {
    const [a, b, c] = [q[i], q[(i + 1) % 4], q[(i + 2) % 4]];
    const e1 = [b[0] - a[0], b[1] - a[1]];
    const e2 = [c[0] - b[0], c[1] - b[1]];
    const cross = e1[0] * e2[1] - e1[1] * e2[0];
    if (!(cross > 1e-3 * Math.hypot(...e1) * Math.hypot(...e2))) return false;
    area2 += a[0] * b[1] - b[0] * a[1];
  }
  return Number.isFinite(area2) && area2 >= 2;
}

/** The mean top / bottom by the mean left / right side length (transform.rs quad_size). */
export function quadSize(q) {
  const len = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  const [tl, tr, br, bl] = q;
  return [(len(tl, tr) + len(bl, br)) / 2, (len(tl, bl) + len(tr, br)) / 2];
}

/**
 * The Perspective Crop's output { w, h } (perspective_crop_cmds.rs out_size) from the Crop W x H
 * field texts: both set give that size, one alone keeps the quad's proportions, neither takes
 * the quad's mean side lengths, rounded, each at least 1.
 */
export function perspectiveCropSize(quad, wText, hText) {
  const side = (t) => {
    const s = String(t ?? '').trim();
    const v = s === '' ? NaN : Number(s);
    return Number.isFinite(v) && v > 0 ? Math.max(1, Math.round(v)) : null;
  };
  const [qw, qh] = quadSize(quad);
  let w = side(wText);
  let h = side(hText);
  if (w && !h) h = (w * qh) / qw;
  else if (h && !w) w = (h * qw) / qh;
  else if (!w && !h) [w, h] = [qw, qh];
  return { w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) };
}

/**
 * The quad mapped onto an upright w x h image (perspective_crop_cmds.rs apply): each output
 * pixel centre goes through homographyFromQuad onto the source and samples it bilinearly
 * (premultiplied), transparent where the image does not reach. fill (RGBA bytes or null) is
 * composited under it.
 */
export function perspectiveCropImageData(img, quad, w, h, fill = null) {
  const { width: W, height: H, data: src } = img;
  w = Math.max(1, Math.round(w));
  h = Math.max(1, Math.round(h));
  const out = new Uint8ClampedArray(w * h * 4);
  const m = homographyFromQuad(quad, w, h);
  if (!m) return { width: w, height: h, data: out };
  const fa = fill ? fill[3] / 255 : 0;
  const acc = [0, 0, 0, 0];
  for (let Y = 0; Y < h; Y++) {
    for (let X = 0; X < w; X++) {
      const [sx, sy] = applyHomography(m, X + 0.5, Y + 0.5);
      if (!Number.isFinite(sx) || !Number.isFinite(sy)) continue;
      bilinear(src, W, 0, 0, W, H, sx - 0.5, sy - 0.5, false, acc);
      let [pr, pg, pb, a] = acc;
      if (fa > 0) {
        const k = fa * (1 - a);
        pr += fill[0] * k;
        pg += fill[1] * k;
        pb += fill[2] * k;
        a += k;
      }
      if (!(a > 0)) continue;
      const o = (Y * w + X) * 4;
      out[o] = pr / a;
      out[o + 1] = pg / a;
      out[o + 2] = pb / a;
      out[o + 3] = a * 255;
    }
  }
  return { width: w, height: h, data: out };
}

// ── Skew / Distort / Perspective (PhotoCraft transform_tool.rs apply_mode_drag) ─────────────
// Once a Free Transform box is skewed, distorted, or given perspective it is a quad (TL, TR,
// BR, BL, document px) and the source box maps onto it through a homography. Edge i runs from
// corner i to corner i + 1 (0 top, 1 right, 2 bottom, 3 left).

/** The homography taking document points in box onto quad, corner to corner, or null. */
export function quadHomography(box, quad) {
  const m = homographyFromQuad(quad, box.w, box.h);
  if (!m) return null;
  // m · translate(−box.x, −box.y).
  const { x, y } = box;
  return [
    m[0],
    m[1],
    m[2] - m[0] * x - m[1] * y,
    m[3],
    m[4],
    m[5] - m[3] * x - m[4] * y,
    m[6],
    m[7],
    m[8] - m[6] * x - m[7] * y
  ];
}

/** box's corners through the document homography m (TL, TR, BR, BL). */
export function homographyCorners(box, m) {
  const { x, y, w, h } = box;
  return [
    applyHomography(m, x, y),
    applyHomography(m, x + w, y),
    applyHomography(m, x + w, y + h),
    applyHomography(m, x, y + h)
  ];
}

/**
 * The projective warp (transform.rs warp through Homography::rect_to_quad): src's box (default
 * the whole image) lands on quad in a new W x H { width, height, data }. Each output pixel centre
 * inside the quad maps back into the box and samples it bilinearly (premultiplied, edge pixels
 * repeat inside the box); nearest takes the pixel under the centre. Outside the quad is transparent.
 */
export function warpQuad(
  src,
  quad,
  W,
  H,
  box = { x: 0, y: 0, w: src.width, h: src.height },
  nearest = false
) {
  const out = new Uint8ClampedArray(W * H * 4);
  const m = homographyFromQuad(quad, box.w, box.h);
  const inv = m && invertHomography(m);
  if (!inv) return { width: W, height: H, data: out };
  const xs = quad.map((c) => c[0]);
  const ys = quad.map((c) => c[1]);
  const X0 = Math.max(0, Math.floor(Math.min(...xs)));
  const X1 = Math.min(W, Math.ceil(Math.max(...xs)));
  const Y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const Y1 = Math.min(H, Math.ceil(Math.max(...ys)));
  const eps = 1e-9;
  const acc = [0, 0, 0, 0];
  for (let Y = Y0; Y < Y1; Y++) {
    for (let X = X0; X < X1; X++) {
      const [u, v] = applyHomography(inv, X + 0.5, Y + 0.5);
      if (!(u >= -eps && v >= -eps && u < box.w + eps && v < box.h + eps)) continue;
      const o = (Y * W + X) * 4;
      if (nearest) {
        const ix = box.x + Math.min(box.w - 1, Math.max(0, Math.floor(u)));
        const iy = box.y + Math.min(box.h - 1, Math.max(0, Math.floor(v)));
        const s = (iy * src.width + ix) * 4;
        if (!src.data[s + 3]) continue;
        for (let k = 0; k < 4; k++) out[o + k] = src.data[s + k];
        continue;
      }
      bilinear(src.data, src.width, box.x, box.y, box.w, box.h, u - 0.5, v - 0.5, true, acc);
      const a = acc[3];
      if (a <= 0) continue;
      out[o] = acc[0] / a;
      out[o + 1] = acc[1] / a;
      out[o + 2] = acc[2] / a;
      out[o + 3] = a * 255;
    }
  }
  return { width: W, height: H, data: out };
}

// The turn at each corner (cross products of consecutive edges): one sign for a convex quad.
function quadTurns(q) {
  return q.map((a, k) => {
    const b = q[(k + 1) % 4];
    const c = q[(k + 2) % 4];
    return (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
  });
}

const convexWith = (q, sign, minTurn) => quadTurns(q).every((t) => t * sign > minTurn);

/**
 * Distort and Perspective stop where the box would turn concave or fold (transform_tool.rs
 * keep_convex): the quad moves from `from` toward `to` as far as it stays convex.
 */
export function keepConvex(from, to) {
  const t0 = quadTurns(from);
  const sign = Math.sign(t0[0]);
  const minTurn = Math.min(...t0.map(Math.abs)) * 1e-3;
  if (!(Number.isFinite(minTurn) && minTurn > 0 && convexWith(from, sign, 0))) return to;
  if (convexWith(to, sign, minTurn)) return to;
  const lerp = (t) =>
    from.map((p, k) => [p[0] + (to[k][0] - p[0]) * t, p[1] + (to[k][1] - p[1]) * t]);
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (convexWith(lerp(mid), sign, minTurn)) lo = mid;
    else hi = mid;
  }
  return lerp(lo);
}

const quadCentre = (q) => [
  (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4,
  (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4
];

/**
 * What a press at (x, y) grabs on a quad box: { corner: i }, { edge: i } (the edge's middle
 * handle), 'move' inside, or 'rotate' outside. tol is the handle reach in document px.
 */
export function hitQuad(quad, x, y, tol) {
  const near = ([px, py]) => Math.abs(x - px) <= tol && Math.abs(y - py) <= tol;
  for (let i = 0; i < 4; i++) if (near(quad[i])) return { corner: i };
  for (let i = 0; i < 4; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    if (near([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2])) return { edge: i };
  }
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    const c = Math.sign((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]));
    if (!c) continue;
    if (sign && c !== sign) return 'rotate';
    sign = c;
  }
  return 'move';
}

// The gesture a quad grab makes in an Edit › Transform mode (null = Free Transform, 'scale',
// 'rotate', 'skew', 'distort', 'perspective'), with mods { shift, ctrl, alt } held. In Free
// Transform ⌘-drag a corner distorts, ⌘⌥⇧-drag a corner adds perspective, ⌘-drag an edge skews.
// Distort only moves corners (and the box from inside); Skew never rotates from outside.
// null: the press does nothing.
export function quadGesture(grab, mode, mods = {}) {
  if (grab === 'move') return 'move';
  const corner = grab !== 'rotate' && grab.corner !== undefined;
  const edge = grab !== 'rotate' && grab.edge !== undefined;
  switch (mode) {
    case 'distort':
      return corner ? 'distort' : null;
    case 'skew':
      return corner ? 'skewCorner' : edge ? 'skewEdgeAlong' : null;
    case 'perspective':
      return corner ? 'perspective' : edge ? 'scale' : 'rotate';
    case 'scale':
      return grab === 'rotate' ? null : 'scale';
    case 'rotate':
      return 'rotate';
  }
  if (corner && mods.ctrl && mods.alt && mods.shift) return 'perspective';
  if (corner && mods.ctrl) return 'distort';
  if (edge && mods.ctrl) return mods.shift ? 'skewEdgeAlong' : 'skewEdge';
  return grab === 'rotate' ? 'rotate' : 'scale';
}

/** Gestures only a quad box can make; the first one turns an affine box into a quad. */
export const QUAD_GESTURES = new Set([
  'distort',
  'perspective',
  'skewCorner',
  'skewEdge',
  'skewEdgeAlong'
]);

// Unit-frame scale of a quad box from a corner or edge handle (transform_tool.rs apply_drag,
// the Corner / Edge arm): the opposite side stays; shift keeps the proportions.
function scaleQuad(q0, grab, p, shift) {
  const h = homographyFromQuad(q0, 1, 1);
  const inv = h && invertHomography(h);
  if (!inv) return q0;
  const [u, v] = applyHomography(inv, p.x, p.y);
  // Which side of the unit box moves on each axis: [at 0, at 1].
  const SIDES = grab.corner !== undefined ? CORNER_SIDES[grab.corner] : EDGE_SIDES[grab.edge];
  const axis = (moving, at) => {
    if (!moving[0] && !moving[1]) return [0.5, 1];
    const handle = moving[0] ? 0 : 1;
    const anchor = 1 - handle;
    const k = (at - anchor) / (handle - anchor);
    return [anchor, Number.isFinite(k) ? k : 1];
  };
  let [au, ku] = axis(SIDES[0], u);
  let [av, kv] = axis(SIDES[1], v);
  if (shift) {
    if (grab.corner !== undefined) {
      const k = Math.max(Math.abs(ku), Math.abs(kv));
      ku = k * Math.sign(ku || 1);
      kv = k * Math.sign(kv || 1);
    } else if (SIDES[0][0] || SIDES[0][1]) [av, kv] = [0.5, Math.abs(ku)];
    else [au, ku] = [0.5, Math.abs(kv)];
  }
  const r = [au - au * ku, av - av * kv, au + (1 - au) * ku, av + (1 - av) * kv];
  return [
    applyHomography(h, r[0], r[1]),
    applyHomography(h, r[2], r[1]),
    applyHomography(h, r[2], r[3]),
    applyHomography(h, r[0], r[3])
  ];
}

const CORNER_SIDES = [
  [
    [true, false],
    [true, false]
  ],
  [
    [false, true],
    [true, false]
  ],
  [
    [false, true],
    [false, true]
  ],
  [
    [true, false],
    [false, true]
  ]
];
const EDGE_SIDES = [
  [
    [false, false],
    [true, false]
  ],
  [
    [false, true],
    [false, false]
  ],
  [
    [false, false],
    [false, true]
  ],
  [
    [true, false],
    [false, false]
  ]
];

/**
 * The quad after dragging with gesture (from quadGesture) on grab from start to point, given
 * the quad q0 at the press. mods { shift, alt }: shift snaps a rotation to 15° and keeps a scale
 * proportional; alt moves the opposite corner (Skew) or edge (⌘-edge skew) the other way.
 */
export function dragQuad(q0, gesture, grab, start, point, mods = {}) {
  const dx = point.x - start.x;
  const dy = point.y - start.y;
  const shifted = (k, mx, my) => [q0[k][0] + mx, q0[k][1] + my];
  switch (gesture) {
    case 'move':
      return q0.map((c) => [c[0] + dx, c[1] + dy]);
    case 'rotate': {
      const [cx, cy] = quadCentre(q0);
      let da = Math.atan2(point.y - cy, point.x - cx) - Math.atan2(start.y - cy, start.x - cx);
      if (mods.shift) {
        const base = Math.atan2(q0[1][1] - q0[0][1], q0[1][0] - q0[0][0]);
        const step = Math.PI / 12;
        da = Math.round((base + da) / step) * step - base;
      }
      const s = Math.sin(da);
      const c = Math.cos(da);
      return q0.map(([x, y]) => [
        cx + (x - cx) * c - (y - cy) * s,
        cy + (x - cx) * s + (y - cy) * c
      ]);
    }
    case 'scale':
      return scaleQuad(q0, grab, point, mods.shift);
    case 'distort': {
      const q = q0.map((c) => [...c]);
      q[grab.corner] = shifted(grab.corner, dx, dy);
      return keepConvex(q0, q);
    }
    case 'perspective': {
      // The corner moves along the drag's main axis; the corner sharing that side mirrors it.
      const i = grab.corner;
      const horizontal = Math.abs(dx) >= Math.abs(dy);
      const j = horizontal ? [1, 0, 3, 2][i] : [3, 2, 1, 0][i];
      const [mx, my] = horizontal ? [dx, 0] : [0, dy];
      const q = q0.map((c) => [...c]);
      q[i] = shifted(i, mx, my);
      q[j] = shifted(j, -mx, -my);
      return keepConvex(q0, q);
    }
    case 'skewCorner': {
      // The corner slides alone along whichever of its two edges the drag mostly follows.
      const i = grab.corner;
      const along = (j) => {
        const ex = q0[i][0] - q0[j][0];
        const ey = q0[i][1] - q0[j][1];
        const l = Math.hypot(ex, ey);
        const t = l > 0 ? (dx * ex + dy * ey) / l : 0;
        return l > 0 ? [(t * ex) / l, (t * ey) / l] : [0, 0];
      };
      const hm = along([1, 0, 3, 2][i]);
      const vm = along([3, 2, 1, 0][i]);
      const [mx, my] = Math.hypot(...hm) >= Math.hypot(...vm) ? hm : vm;
      const q = q0.map((c) => [...c]);
      q[i] = shifted(i, mx, my);
      if (mods.alt) q[(i + 2) % 4] = shifted((i + 2) % 4, -mx, -my);
      return keepConvex(q0, q);
    }
    case 'skewEdge':
    case 'skewEdgeAlong': {
      // The edge's two corners move together; Skew's edge (⌘⇧ in Free Transform) only along itself.
      const a = grab.edge;
      const b = (a + 1) % 4;
      let mx = dx;
      let my = dy;
      if (gesture === 'skewEdgeAlong') {
        const ex = q0[b][0] - q0[a][0];
        const ey = q0[b][1] - q0[a][1];
        const l2 = ex * ex + ey * ey;
        const t = l2 > 0 ? (dx * ex + dy * ey) / l2 : 0;
        mx = t * ex;
        my = t * ey;
      }
      const q = q0.map((c) => [...c]);
      q[a] = shifted(a, mx, my);
      q[b] = shifted(b, mx, my);
      if (mods.alt) {
        q[(a + 2) % 4] = shifted((a + 2) % 4, -mx, -my);
        q[(a + 3) % 4] = shifted((a + 3) % 4, -mx, -my);
      }
      return q;
    }
    default:
      return q0;
  }
}

/**
 * Edit › Transform's turns and flips on an open quad box (transform_tool.rs box_preset): the
 * flips swap corners in the box's own frame; the turns rotate the corners about the centre.
 */
export function presetQuad(q, kind) {
  if (kind === 'flipHorizontal') return [q[1], q[0], q[3], q[2]];
  if (kind === 'flipVertical') return [q[3], q[2], q[1], q[0]];
  const angle = { rotate180: Math.PI, rotate90Cw: Math.PI / 2, rotate90Ccw: -Math.PI / 2 }[kind];
  if (angle === undefined) return q;
  const [cx, cy] = quadCentre(q);
  const s = Math.round(Math.sin(angle));
  const c = Math.round(Math.cos(angle));
  return q.map(([x, y]) => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c]);
}

// ── Warp (PhotoCraft geom warp.rs BezierMesh, algo warp.rs warp_mesh_surface) ─────────────────
// Edit › Transform › Warp bends the box through one bicubic Bezier patch: 16 control points
// (document px), row-major, index j · 4 + i, whose border rows and columns are the outline and
// its handles. The identity mesh sits at the box's thirds.

/** Cubic Bernstein weights at t. */
function bernstein(t) {
  const s = 1 - t;
  return [s * s * s, 3 * s * s * t, 3 * s * t * t, t * t * t];
}

/** The mesh surface at normalised (s, t): s across the box, t down it. */
export function evalMesh(points, s, t) {
  const ba = bernstein(s);
  const bb = bernstein(t);
  let x = 0;
  let y = 0;
  for (let j = 0; j < 4; j++) {
    for (let i = 0; i < 4; i++) {
      const k = ba[i] * bb[j];
      x += points[j * 4 + i][0] * k;
      y += points[j * 4 + i][1] * k;
    }
  }
  return [x, y];
}

/**
 * The identity mesh over box carried through m (a 6-entry affine, a 9-entry homography, or null),
 * so a box scaled, turned, or distorted first keeps its shape when it turns into a warp
 * (transform_tool.rs enter_warp). Exact for affine maps; a perspective box is fitted at the thirds.
 */
export function meshFromBox(box, m = null) {
  const points = [];
  for (let j = 0; j < 4; j++) {
    for (let i = 0; i < 4; i++) {
      const x = box.x + (box.w * i) / 3;
      const y = box.y + (box.h * j) / 3;
      points.push(!m ? [x, y] : m.length === 9 ? applyHomography(m, x, y) : applyAffine(m, x, y));
    }
  }
  return points;
}

// The grid the surface is forward-mapped through: cells of about MESH_CELL px on both sides of
// the map, at most MESH_MAX_CELLS per axis (warp.rs CELL / MAX_CELLS).
const MESH_CELL = 4;
const MESH_MAX_CELLS = 512;
const MESH_PROBE = 16;

// The longest output length of a row and of a column of the surface, along MESH_PROBE-step
// polylines (warp.rs mapped_lengths).
function meshLengths(points) {
  const n = MESH_PROBE + 1;
  const pts = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) pts.push(evalMesh(points, i / MESH_PROBE, j / MESH_PROBE));
  }
  const step = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]) || 0;
  let lu = 0;
  let lv = 0;
  for (let k = 0; k < n; k++) {
    let row = 0;
    let col = 0;
    for (let m = 1; m < n; m++) {
      row += step(pts[k * n + m - 1], pts[k * n + m]);
      col += step(pts[(m - 1) * n + k], pts[m * n + k]);
    }
    lu = Math.max(lu, row);
    lv = Math.max(lv, col);
  }
  return [lu, lv];
}

/**
 * Warps src's box (default the whole image) through the mesh into a new W x H
 * { width, height, data }. The surface is evaluated on a grid, each cell is split into two
 * triangles, and every output pixel centre inside a triangle samples the box at the
 * barycentric mix of its source corners (bilinear, premultiplied, edge pixels repeat; nearest
 * takes the pixel under it). Later triangles draw over earlier ones where the mesh folds.
 * Outside the surface is transparent. The identity mesh reproduces the box exactly.
 */
export function meshWarp(
  src,
  points,
  W,
  H,
  box = { x: 0, y: 0, w: src.width, h: src.height },
  nearest = false
) {
  const out = new Uint8ClampedArray(W * H * 4);
  const [lu, lv] = meshLengths(points);
  const cells = (s, d) =>
    Math.min(MESH_MAX_CELLS, Math.max(1, Math.ceil(Math.max(s, d) / MESH_CELL)));
  const nu = cells(box.w, lu);
  const nv = cells(box.h, lv);
  const grid = [];
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const [X, Y] = evalMesh(points, i / nu, j / nv);
      grid.push([X, Y, (box.w * i) / nu, (box.h * j) / nv]);
    }
  }
  const acc = [0, 0, 0, 0];
  const sample = (o, u, v) => {
    if (nearest) {
      const ix = box.x + Math.min(box.w - 1, Math.max(0, Math.floor(u)));
      const iy = box.y + Math.min(box.h - 1, Math.max(0, Math.floor(v)));
      const s = (iy * src.width + ix) * 4;
      for (let k = 0; k < 4; k++) out[o + k] = src.data[s + k];
      return;
    }
    bilinear(src.data, src.width, box.x, box.y, box.w, box.h, u - 0.5, v - 0.5, true, acc);
    const a = acc[3];
    if (a <= 0) {
      out[o + 3] = 0;
      return;
    }
    out[o] = acc[0] / a;
    out[o + 1] = acc[1] / a;
    out[o + 2] = acc[2] / a;
    out[o + 3] = a * 255;
  };
  const eps = 1e-9;
  const triangle = (p0, p1, p2) => {
    const det = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1]);
    if (!(Math.abs(det) > 1e-12)) return;
    const X0 = Math.max(0, Math.floor(Math.min(p0[0], p1[0], p2[0])));
    const X1 = Math.min(W, Math.ceil(Math.max(p0[0], p1[0], p2[0])));
    const Y0 = Math.max(0, Math.floor(Math.min(p0[1], p1[1], p2[1])));
    const Y1 = Math.min(H, Math.ceil(Math.max(p0[1], p1[1], p2[1])));
    for (let Y = Y0; Y < Y1; Y++) {
      const py = Y + 0.5 - p0[1];
      for (let X = X0; X < X1; X++) {
        const px = X + 0.5 - p0[0];
        const l1 = (px * (p2[1] - p0[1]) - (p2[0] - p0[0]) * py) / det;
        const l2 = ((p1[0] - p0[0]) * py - px * (p1[1] - p0[1])) / det;
        const l0 = 1 - l1 - l2;
        if (l0 < -eps || l1 < -eps || l2 < -eps) continue;
        const u = l0 * p0[2] + l1 * p1[2] + l2 * p2[2];
        const v = l0 * p0[3] + l1 * p1[3] + l2 * p2[3];
        sample((Y * W + X) * 4, u, v);
      }
    }
  };
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = grid[j * (nu + 1) + i];
      const b = grid[j * (nu + 1) + i + 1];
      const c = grid[(j + 1) * (nu + 1) + i];
      const d = grid[(j + 1) * (nu + 1) + i + 1];
      triangle(a, b, d);
      triangle(a, d, c);
    }
  }
  return { width: W, height: H, data: out };
}

// The four points inside the patch have no handle of their own (transform_tool.rs
// on_section_edge); the twelve on the border rows and columns are what a press can grab.
const MESH_INNER = new Set([5, 6, 9, 10]);

/** The grabbable control point nearest (x, y) within tol, or -1 (transform_tool.rs warp_hit). */
export function meshHit(points, x, y, tol) {
  let best = -1;
  let bestD = tol;
  points.forEach(([px, py], i) => {
    if (MESH_INNER.has(i)) return;
    const dist = Math.hypot(px - x, py - y);
    if (dist < bestD) {
      best = i;
      bestD = dist;
    }
  });
  return best;
}

/**
 * pts0 with control point index dragged by d (warp.rs drag_point on a one-patch mesh): an
 * anchor carries its handles and the inner point beside it; a handle carries the points across
 * its line; an inner point moves alone.
 */
export function dragMeshPoint(pts0, index, [dx, dy]) {
  const points = pts0.map((p) => [...p]);
  const i0 = index % 4;
  const j0 = Math.floor(index / 4);
  const shift = (i, j) => {
    if (i < 0 || j < 0 || i > 3 || j > 3) return;
    points[j * 4 + i][0] += dx;
    points[j * 4 + i][1] += dy;
  };
  const anchorCol = i0 % 3 === 0;
  const anchorRow = j0 % 3 === 0;
  for (let dj = -1; dj <= 1; dj++) {
    for (let di = -1; di <= 1; di++) {
      if (anchorCol && anchorRow ? true : anchorCol ? !dj : anchorRow ? !di : !di && !dj) {
        shift(i0 + di, j0 + dj);
      }
    }
  }
  return points;
}

/** The (s, t) whose surface point is nearest p: a coarse search, then Newton steps (param_at). */
export function meshParamAt(points, [x, y]) {
  const n = 48;
  let s = 0.5;
  let t = 0.5;
  let best = Infinity;
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const [qx, qy] = evalMesh(points, i / n, j / n);
      const d = (qx - x) ** 2 + (qy - y) ** 2;
      if (d < best) [s, t, best] = [i / n, j / n, d];
    }
  }
  const h = 1e-5;
  for (let k = 0; k < 12; k++) {
    const [qx, qy] = evalMesh(points, s, t);
    const [sx, sy] = evalMesh(points, s + h, t);
    const [tx, ty] = evalMesh(points, s, t + h);
    const a = (sx - qx) / h;
    const b = (tx - qx) / h;
    const c = (sy - qy) / h;
    const d = (ty - qy) / h;
    const det = a * d - b * c;
    if (Math.abs(det) < 1e-12) break;
    const ex = x - qx;
    const ey = y - qy;
    s = Math.min(1, Math.max(0, s + (d * ex - b * ey) / det));
    t = Math.min(1, Math.max(0, t + (a * ey - c * ex) / det));
  }
  return [s, t];
}

// Within this distance of the border (box units) a pull starts to bend the border too.
const PULL_BORDER_ZONE = 0.12;

/**
 * pts0 with the surface point at (s, t) pulled by d (warp.rs pull, one patch): the four inner
 * points always share the move, the border handles join as the grab nears the border, and the
 * four corners never move. The share is the least-squares one, so the grabbed point lands on
 * the pointer exactly.
 */
export function pullMesh(pts0, s, t, [dx, dy]) {
  const ba = bernstein(s);
  const bb = bernstein(t);
  const nearBorder = Math.min(1, Math.max(0, 1 - Math.min(s, 1 - s, t, 1 - t) / PULL_BORDER_ZONE));
  const share = pts0.map((_, k) => {
    const i = k % 4;
    const j = Math.floor(k / 4);
    if (i % 3 === 0 && j % 3 === 0) return 0;
    return (MESH_INNER.has(k) ? 1 : nearBorder) * ba[i] * bb[j];
  });
  const norm = share.reduce((sum, c, k) => sum + c * ba[k % 4] * bb[Math.floor(k / 4)], 0);
  if (!(norm > 1e-12)) return pts0.map((p) => [...p]);
  return pts0.map(([x, y], k) => [x + (dx * share[k]) / norm, y + (dy * share[k]) / norm]);
}

/** Live corners of a Free Transform session (quad if distorted, else affine box). */
export function freeTransformCorners(ft) {
  return ft.quad ?? transformedCorners(ft.box, freeTransformAffine(ft.box, ft.t));
}

/** Promote an affine Free Transform box to a quad where it stands. */
export function ensureFreeTransformQuad(ft) {
  if (!ft.quad) ft.quad = freeTransformCorners(ft);
  return ft.quad;
}

function freeTransformHandleCursor({ hx, hy }) {
  if (!hx) return 'ns-resize';
  if (!hy) return 'ew-resize';
  return hx === hy ? 'nwse-resize' : 'nesw-resize';
}

/**
 * Warp-mode pointer (transform_tool.rs warp_pointer). ports: { zoom, setCursor, redraw }.
 */
export function warpPointer(ft, type, x, y, tol, ports) {
  const grab = () => {
    const index = meshHit(ft.mesh, x, y, tol);
    if (index >= 0) return { index };
    const [s, t] = meshParamAt(ft.mesh, [x, y]);
    const [qx, qy] = evalMesh(ft.mesh, s, t);
    return Math.hypot(qx - x, qy - y) < Math.max(1, 1 / ports.zoom) ? { s, t } : null;
  };
  if (type === 'down') {
    const g = grab();
    ft.drag = g ? { ...g, start: { x, y }, pts0: ft.mesh } : null;
    return;
  }
  if (type === 'up') {
    ft.drag = null;
    return;
  }
  const d = ft.drag;
  if (!d) {
    const g = grab();
    ports.setCursor?.(!g ? 'default' : g.index !== undefined ? 'crosshair' : 'move');
    return;
  }
  const delta = [x - d.start.x, y - d.start.y];
  ft.mesh =
    d.index !== undefined
      ? dragMeshPoint(d.pts0, d.index, delta)
      : pullMesh(d.pts0, d.s, d.t, delta);
  ports.redraw?.(ft);
}

/**
 * Free Transform pointer Seam while the session owns the canvas.
 * keys: { shift, ctrl, alt }. ports: { zoom, handlePx?, setCursor, redraw }.
 */
export function freeTransformPointer(ft, type, x, y, keys, ports) {
  const handlePx = ports.handlePx ?? 4;
  const tol = (handlePx + 2) / ports.zoom;
  if (ft.mesh) {
    warpPointer(ft, type, x, y, tol, ports);
    return;
  }
  const quadHit = () => {
    const grab = hitQuad(freeTransformCorners(ft), x, y, tol);
    const gesture = quadGesture(grab, ft.mode, keys);
    return gesture ? { grab, gesture } : null;
  };
  const hit = () => {
    if (ft.quad) return quadHit();
    const q = quadHit();
    if (q && QUAD_GESTURES.has(q.gesture)) return q;
    const grab = restrictFreeTransformGrab(hitFreeTransform(ft.box, ft.t, x, y, tol), ft.mode);
    return grab ? { grab } : null;
  };
  if (type === 'down') {
    const h = hit();
    if (h?.gesture && QUAD_GESTURES.has(h.gesture)) ensureFreeTransformQuad(ft);
    ft.drag = h ? { ...h, start: { x, y }, t0: ft.t, q0: ft.quad } : null;
    return;
  }
  if (type === 'up') {
    ft.drag = null;
    return;
  }
  if (!ft.drag) {
    const h = hit();
    ports.setCursor?.(
      !h
        ? 'default'
        : h.grab === 'move'
          ? 'move'
          : h.grab === 'rotate' || h.gesture === 'rotate'
            ? 'alias'
            : h.gesture
              ? 'crosshair'
              : freeTransformHandleCursor(h.grab)
    );
    return;
  }
  const d = ft.drag;
  if (d.q0) ft.quad = dragQuad(d.q0, d.gesture, d.grab, d.start, { x, y }, keys);
  else ft.t = dragFreeTransform(ft.box, d.t0, d.grab, d.start, { x, y }, !!keys.shift);
  ports.redraw?.(ft);
}

// Retouch brushes (Clone Stamp, Dodge, Burn, Sponge, Blur, Sharpen, Smudge, Mixer Brush, Healing Brush, Spot
// Healing Brush, History Brush, Red Eye, Color Replacement). Pure pixel functions on RGBA Uint8ClampedArray buffers so they can be tested without a canvas.
//
// Tip shape follows PhotoCraft crates/paint/src/lib.rs (tip_shape / tip_falloff / dab_coverage):
// a solid core of radius r0·R, then a shoulder (1 − u/64)^64 ≈ exp(−u) of width s·R, both by hardness.

const TIP_SHAPE = [
  [0.0, 0.664],
  [0.14, 0.58],
  [0.28, 0.5],
  [0.4, 0.44],
  [0.52, 0.36],
  [0.63, 0.29],
  [0.7, 0.24],
  [0.78, 0.19],
  [0.84, 0.15],
  [0.89, 0.11],
  [1.0, 0.0]
];
const TIP_EDGE_PX = 1.2;

// Core radius and shoulder width (pixels) of a round tip. hardness is 0..1.
export function tipShape(radius, hardness) {
  const h = (Number.isNaN(hardness) ? 0 : Math.min(1, Math.max(0, hardness))) * 10;
  const i = Math.min(9, Math.floor(h));
  const t = h - i;
  const [a0, a1] = TIP_SHAPE[i];
  const [b0, b1] = TIP_SHAPE[i + 1];
  const r0 = a0 + (b0 - a0) * t;
  const s = a1 + (b1 - a1) * t;
  const R = Number.isFinite(radius) ? Math.max(0, radius) : 0;
  const edge = Math.max(0.25, Math.min(TIP_EDGE_PX, 0.3 * R));
  return [Math.max(0, Math.min(r0 * R, R - edge)), Math.max(1e-3, s * R, edge)];
}

function softExp(u) {
  let g = Math.min(1, Math.max(0, 1 - u / 64));
  for (let i = 0; i < 6; i++) g *= g;
  return g;
}

// How far from its centre a round tip still paints.
export function tipReach(radius, hardness) {
  const [r0, s] = tipShape(radius, hardness);
  return r0 + 2.6 * s;
}

// Coverage (0..1) of a round dab at distance d from its centre.
export function dabCoverage(d, radius, hardness) {
  if (Number.isNaN(d) || d >= tipReach(radius, hardness) + 0.5) return 0;
  const [r0, s] = tipShape(radius, hardness);
  if (d <= r0) return 1;
  const x = (d - r0) / s;
  return softExp(x * x);
}

// The offset (dx, dy) a new Clone Stamp stroke starting at (x, y) samples from, in whole pixels
// (the pixel under the cursor maps to the pixel under the source point).
// clone = { source: {x, y} | null, offset: {dx, dy} | null }. Aligned keeps the first stroke's
// offset for later strokes; unaligned restarts every stroke from the source point.
// Returns null when no source is set.
export function cloneStrokeOffset(clone, x, y, aligned) {
  if (!clone || !clone.source) return null;
  if (aligned && clone.offset) return clone.offset;
  const off = { dx: clone.source.x - Math.floor(x), dy: clone.source.y - Math.floor(y) };
  clone.offset = aligned ? off : null;
  return off;
}

// One Clone Stamp dab centred at (cx, cy). Writes dst; reads only src, the pre-stroke pixels,
// so pixels painted earlier in the stroke are never re-sampled. Each pixel p gets src[p + offset]
// composited over src[p] at k = coverage × opacity. With cov (a Float32Array W*H for the stroke),
// coverage builds up across dabs (c ← c + d·(1 − c)) and each dab rewrites from src, so overlap
// never compounds past that. Source pixels off the canvas leave dst untouched; mask (0/1, or null
// for everywhere) limits writes. hardness and opacity are 0..1. sample (cloneSampler in
// clone-source.js, or null for the plain offset) maps a pixel to its source pixel index under the
// Clone Source transform. Returns the touched box [x0, y0, x1, y1) or null.
export function cloneDab(
  dst,
  src,
  W,
  H,
  cx,
  cy,
  dx,
  dy,
  radius,
  hardness,
  opacity,
  mask,
  cov,
  sample = null
) {
  const at = sample
    ? (x, y) => {
        const q = sample(x, y);
        return q < 0 ? -1 : q * 4;
      }
    : (x, y) => {
        const sx = x + dx,
          sy = y + dy;
        return sx < 0 || sx >= W || sy < 0 || sy >= H ? -1 : (sy * W + sx) * 4;
      };
  return coverDab(dst, src, src, W, H, cx, cy, radius, hardness, opacity, mask, cov, at);
}

// One History Brush dab (PhotoCraft history_brush: apply_coverage of the source state). Like
// cloneDab with no offset, but the paint comes from source, a snapshot of the layer, composited
// over base, the pre-stroke pixels.
export function historyDab(dst, base, source, W, H, cx, cy, radius, hardness, opacity, mask, cov) {
  const at = (x, y) => (y * W + x) * 4;
  return coverDab(dst, base, source, W, H, cx, cy, radius, hardness, opacity, mask, cov, at);
}

// One Pattern Stamp dab (PhotoCraft paint.patternStamp, aligned: apply_coverage of the rendered
// pattern). tile is RGBA tw × th; pixel (x, y) paints tile pixel
// (floor((x + 0.5 − phaseX) / scale) mod tw, floor((y + 0.5 − phaseY) / scale) mod th), nearest
// neighbour, composited over base like historyDab. scale is a factor (1 = 100 %).
export function patternDab(
  dst,
  base,
  tile,
  tw,
  th,
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
) {
  const at = (x, y) => {
    const u = Math.floor((x + 0.5 - phaseX) / scale);
    const v = Math.floor((y + 0.5 - phaseY) / scale);
    return ((((v % th) + th) % th) * tw + (((u % tw) + tw) % tw)) * 4;
  };
  return coverDab(dst, base, tile, W, H, cx, cy, radius, hardness, opacity, mask, cov, at);
}

// The built-in pattern before Edit > Define Pattern: a 2 × 2 checkerboard of fg and bg
// ([r, g, b] 0..255) with cell-px squares. Returns { width, height, data }.
export function checkerPattern(fg, bg, cell = 8) {
  const n = cell * 2;
  const data = new Uint8ClampedArray(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const c = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 ? bg : fg;
      data.set([c[0], c[1], c[2], 255], (y * n + x) * 4);
    }
  }
  return { width: n, height: n, data };
}

// Edit > Define Pattern: the pixels of mask's bounding box (or the whole W × H image with no
// mask), copied as { width, height, data }. An empty mask gives null.
export function definePattern(data, W, H, mask) {
  let x0 = 0,
    y0 = 0,
    x1 = W,
    y1 = H;
  if (mask) {
    [x0, y0, x1, y1] = [W, H, 0, 0];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!mask[y * W + x]) continue;
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x + 1);
        y1 = Math.max(y1, y + 1);
      }
    }
    if (x0 >= x1) return null;
  }
  const w = x1 - x0,
    h = y1 - y0;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    out.set(data.subarray(((y0 + y) * W + x0) * 4, ((y0 + y) * W + x1) * 4), y * w * 4);
  }
  return { width: w, height: h, data: out };
}

// Shared by cloneDab, historyDab, and patternDab: source[at(x, y)] over base[p] at the dab's
// coverage. at returns a byte index into source, or −1 to leave the pixel untouched.
function coverDab(dst, base, source, W, H, cx, cy, radius, hardness, opacity, mask, cov, at) {
  const reach = tipReach(radius, hardness) + 0.5;
  const x0 = Math.max(0, Math.floor(cx - reach));
  const y0 = Math.max(0, Math.floor(cy - reach));
  const x1 = Math.min(W, Math.ceil(cx + reach));
  const y1 = Math.min(H, Math.ceil(cy + reach));
  if (x0 >= x1 || y0 >= y1 || opacity <= 0) return null;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const q = at(x, y);
      if (q < 0) continue;
      const p = y * W + x;
      if (mask && !mask[p]) continue;
      const d = dabCoverage(Math.hypot(x + 0.5 - cx, y + 0.5 - cy), radius, hardness);
      if (d <= 0) continue;
      let c = d;
      if (cov) {
        c = cov[p] + d * (1 - cov[p]);
        cov[p] = c;
      }
      const k = Math.min(1, c * opacity);
      const i = p * 4;
      const sa = (source[q + 3] / 255) * k;
      const da = base[i + 3] / 255;
      const oa = sa + da * (1 - sa);
      if (oa > 0) {
        const wd = da * (1 - sa);
        dst[i] = (source[q] * sa + base[i] * wd) / oa;
        dst[i + 1] = (source[q + 1] * sa + base[i + 1] * wd) / oa;
        dst[i + 2] = (source[q + 2] * sa + base[i + 2] * wd) / oa;
      }
      dst[i + 3] = oa * 255;
    }
  }
  return [x0, y0, x1, y1];
}

// Healing Brush: gradient-domain ("Poisson") blending, from PhotoCraft crates/algo/src/poisson.rs
// (Pérez, Gangnet, Blake 2003). Seamless cloning keeps the source's gradients inside the mask and
// takes the destination's values on its boundary: f = src + h, where h is the membrane (Δh = 0)
// of dst − src on the boundary. Laplace is solved by SOR, cascaded through half-resolution levels.

const MEMBRANE_TOL = 2e-5;
const MEMBRANE_FINE_ITERS = 30;
const MEMBRANE_FINE_OMEGA = 1.7;

// SOR sweeps over the unknown pixels until the largest update drops below MEMBRANE_TOL.
// Out-of-grid neighbours are ignored (a Neumann boundary).
function membraneSor(w, h, unknown, v, maxIter, omega) {
  const cells = [];
  for (let i = 0; i < w * h; i++) {
    if (!unknown[i]) continue;
    const x = i % w,
      y = (i - x) / w;
    cells.push(i, (x > 0) | ((x + 1 < w) << 1) | ((y > 0) << 2) | ((y + 1 < h) << 3));
  }
  for (let it = 0; it < maxIter; it++) {
    let maxD = 0;
    for (let k = 0; k < cells.length; k += 2) {
      const i = cells[k],
        m = cells[k + 1];
      let s, n;
      if (m === 15) {
        s = v[i - 1] + v[i + 1] + v[i - w] + v[i + w];
        n = 4;
      } else {
        s = 0;
        n = 0;
        if (m & 1) (s += v[i - 1]), n++;
        if (m & 2) (s += v[i + 1]), n++;
        if (m & 4) (s += v[i - w]), n++;
        if (m & 8) (s += v[i + w]), n++;
        if (n === 0) continue;
      }
      const d = omega * (s / n - v[i]);
      v[i] += d;
      maxD = Math.max(maxD, Math.abs(d));
    }
    if (maxD < MEMBRANE_TOL) break;
  }
}

function membraneRec(w, h, unknown, v, depth) {
  let nUnknown = 0,
    sum = 0,
    nKnown = 0;
  for (let i = 0; i < w * h; i++) {
    if (unknown[i]) nUnknown++;
    else (sum += v[i]), nKnown++;
  }
  if (nUnknown === 0 || nKnown === 0) return;
  if (w >= 8 && h >= 8 && nUnknown > 64 && depth < 16) {
    // Restrict: a coarse pixel is known if any child is (value = mean of the known children).
    const cw = Math.ceil(w / 2),
      chh = Math.ceil(h / 2);
    const cu = new Uint8Array(cw * chh).fill(1);
    const cv = new Float32Array(cw * chh);
    for (let cy = 0; cy < chh; cy++) {
      for (let cx = 0; cx < cw; cx++) {
        let s = 0,
          n = 0;
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const x = cx * 2 + dx,
              y = cy * 2 + dy;
            if (x < w && y < h && !unknown[y * w + x]) (s += v[y * w + x]), n++;
          }
        }
        if (n > 0) {
          cu[cy * cw + cx] = 0;
          cv[cy * cw + cx] = s / n;
        }
      }
    }
    membraneRec(cw, chh, cu, cv, depth + 1);
    // Prolong: bilinear sample of the coarse solution as the initial guess.
    for (let y = 0; y < h; y++) {
      const fy = Math.min(chh - 1, Math.max(0, (y + 0.5) / 2 - 0.5));
      const y0 = Math.floor(fy),
        y1 = Math.min(y0 + 1, chh - 1),
        ty = fy - y0;
      for (let x = 0; x < w; x++) {
        if (!unknown[y * w + x]) continue;
        const fx = Math.min(cw - 1, Math.max(0, (x + 0.5) / 2 - 0.5));
        const x0 = Math.floor(fx),
          x1 = Math.min(x0 + 1, cw - 1),
          tx = fx - x0;
        const a = cv[y0 * cw + x0] + (cv[y0 * cw + x1] - cv[y0 * cw + x0]) * tx;
        const b = cv[y1 * cw + x0] + (cv[y1 * cw + x1] - cv[y1 * cw + x0]) * tx;
        v[y * w + x] = a + (b - a) * ty;
      }
    }
    membraneSor(w, h, unknown, v, MEMBRANE_FINE_ITERS, MEMBRANE_FINE_OMEGA);
  } else {
    const mean = sum / nKnown;
    for (let i = 0; i < w * h; i++) if (unknown[i]) v[i] = mean;
    membraneSor(w, h, unknown, v, 2000, 1.85);
  }
}

// Solve Δv = 0 on the `unknown` pixels (truthy entries, length w*h) with the known pixels of `v`
// as a Dirichlet boundary. v (Float32Array w*h) holds the known values on entry and the solution
// on exit.
export function solveMembrane(w, h, unknown, v) {
  membraneRec(w, h, unknown, v, 0);
}

// Seamless clone: src and dst are interleaved w*h*ch floats, mask (w*h, truthy = healed). Returns
// a Float32Array equal to dst outside the mask and src + membrane(dst − src) inside it. Callers
// should leave a one-pixel unmasked ring so the boundary is fully Dirichlet.
export function seamlessClone(w, h, ch, src, dst, mask) {
  const out = new Float32Array(w * h * ch);
  const hv = new Float32Array(w * h);
  for (let c = 0; c < ch; c++) {
    for (let i = 0; i < w * h; i++) hv[i] = mask[i] ? 0 : dst[i * ch + c] - src[i * ch + c];
    solveMembrane(w, h, mask, hv);
    for (let i = 0; i < w * h; i++) {
      out[i * ch + c] = mask[i] ? src[i * ch + c] + hv[i] : dst[i * ch + c];
    }
  }
  return out;
}

// Seamless clone with the membrane solved `step` times coarser (PhotoCraft retouch_cmds/patch.rs
// heal_region_coarse): the result is src plus a smooth correction of the boundary mismatch, so the
// correction is solved on a ceil(w / step) x ceil(h / step) grid of cells (a cell is unknown when
// every pixel in it is masked, else it holds the mean dst − src of its unmasked pixels) and added
// back bilinearly, while the texture stays the full-resolution src. Step 1 is seamlessClone.
export function healCoarse(w, h, ch, src, dst, mask, step) {
  if (!(step > 1)) return seamlessClone(w, h, ch, src, dst, mask);
  const cw = Math.ceil(w / step),
    chh = Math.ceil(h / step);
  const diff = new Float32Array(cw * chh * ch);
  const hole = new Uint8Array(cw * chh).fill(1);
  const count = new Uint32Array(cw * chh);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (mask[i]) continue;
      const c = Math.floor(y / step) * cw + Math.floor(x / step);
      hole[c] = 0;
      count[c]++;
      for (let k = 0; k < ch; k++) diff[c * ch + k] += dst[i * ch + k] - src[i * ch + k];
    }
  }
  for (let c = 0; c < cw * chh; c++) {
    if (count[c]) for (let k = 0; k < ch; k++) diff[c * ch + k] /= count[c];
  }
  const m = membraneFill(cw, chh, ch, diff, hole);
  // Cell centres sit at (c + 0.5) · step: the two cells and the weight along one axis.
  const lerpAt = (p, cells) => {
    const f = Math.min(cells - 1, Math.max(0, (p + 0.5) / step - 0.5));
    const c0 = Math.floor(f);
    return [c0, Math.min(c0 + 1, cells - 1), f - c0];
  };
  const xs = Array.from({ length: w }, (_, x) => lerpAt(x, cw));
  const out = Float32Array.from(dst);
  for (let y = 0; y < h; y++) {
    const [y0, y1, ty] = lerpAt(y, chh);
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      const [x0, x1, tx] = xs[x];
      for (let k = 0; k < ch; k++) {
        const v = (cx, cy) => m[(cy * cw + cx) * ch + k];
        const a = v(x0, y0) * (1 - tx) + v(x1, y0) * tx;
        const b = v(x0, y1) * (1 - tx) + v(x1, y1) * tx;
        out[i * ch + k] = src[i * ch + k] + a * (1 - ty) + b * ty;
      }
    }
  }
  return out;
}

// The solve box of a heal: the bounding box of cov plus a one-pixel ring, or null.
function healBox(cov, W, H) {
  const b = coverBounds(cov, W, H);
  if (!b) return null;
  return [
    Math.max(0, b[0] - 1),
    Math.max(0, b[1] - 1),
    Math.min(W, b[2] + 1),
    Math.min(H, b[3] + 1)
  ];
}

// Heal cov over box from src read (dx, dy) away (healCoarse at step). Source reads clamp to the
// canvas and pixels whose source is off the canvas are not healed. Returns { heal, healed }.
function healSolve(src, W, H, dx, dy, cov, box, step, sample = null) {
  const [x0, y0, x1, y1] = box;
  const w = x1 - x0,
    h = y1 - y0;
  const s = new Float32Array(w * h * 4);
  const d = new Float32Array(w * h * 4);
  const heal = new Uint8Array(w * h);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const r = (y - y0) * w + (x - x0);
      const p = y * W + x;
      let q;
      if (sample) {
        const sp = sample(x, y);
        heal[r] = cov[p] > 0 && sp >= 0 ? 1 : 0;
        q = (sp < 0 ? p : sp) * 4;
      } else {
        const sx = x + dx,
          sy = y + dy;
        heal[r] = cov[p] > 0 && sx >= 0 && sx < W && sy >= 0 && sy < H ? 1 : 0;
        q = (Math.min(H - 1, Math.max(0, sy)) * W + Math.min(W - 1, Math.max(0, sx))) * 4;
      }
      for (let c = 0; c < 4; c++) {
        s[r * 4 + c] = src[q + c] / 255;
        d[r * 4 + c] = src[p * 4 + c] / 255;
      }
    }
  }
  return { heal, healed: healCoarse(w, h, 4, s, d, heal, step) };
}

// Heal a finished stroke (PhotoCraft heal_region). src is the pre-stroke RGBA bytes, cov the
// stroke's coverage (Float32Array W*H), (dx, dy) the clone offset. The solve runs over the bounding
// box of the coverage plus a one-pixel ring (healSolve). The healed pixels are composited over src
// into dst at k = coverage × opacity; mask (0/1, or null) limits writes. sample is cloneDab's
// Clone Source sampler (or null). Returns the touched box or null.
export function healStroke(dst, src, W, H, dx, dy, cov, mask, opacity = 1, sample = null) {
  const box = opacity > 0 && healBox(cov, W, H);
  if (!box) return null;
  const [x0, y0, x1, y1] = box;
  const w = x1 - x0;
  const { heal, healed } = healSolve(src, W, H, dx, dy, cov, box, 1, sample);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const r = (y - y0) * w + (x - x0);
      const p = y * W + x;
      const i = p * 4;
      if (mask && !mask[p]) continue;
      if (!heal[r]) {
        dst.set(src.subarray(i, i + 4), i);
        continue;
      }
      healOver(dst, i, src, i, healed, r * 4, Math.min(1, cov[p] * opacity));
    }
  }
  return box;
}

// The coverage and source shift of a patch (PhotoCraft patch.rs plan): 'source' heals the
// selection from (dx, dy); 'destination' heals the selection moved by (dx, dy) from (-dx, -dy).
function patchPlan(mask, W, H, dx, dy, mode) {
  if (mode !== 'destination') return { cov: Float32Array.from(mask, (m) => (m ? 1 : 0)), dx, dy };
  const cov = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const ty = y + dy;
    if (ty < 0 || ty >= H) continue;
    for (let x = 0; x < W; x++) {
      const tx = x + dx;
      if (mask[y * W + x] && tx >= 0 && tx < W) cov[ty * W + tx] = 1;
    }
  }
  return { cov, dx: -dx, dy: -dy };
}

// Patch Tool, Normal (PhotoCraft retouch_cmds/patch.rs). mask (0/1, W*H) is the selection,
// [dx, dy] the whole-pixel drag offset. 'source' heals the selected pixels with the pixels under
// the dragged outline; 'destination' heals the dragged-to place with the selected pixels. Both
// go through healStroke with the (moved) selection as coverage. Returns the touched box or null.
export function patchHeal(dst, src, W, H, mask, dx, dy, mode = 'source') {
  if (!dx && !dy) return null;
  const plan = patchPlan(mask, W, H, dx, dy, mode);
  return healStroke(dst, src, W, H, plan.dx, plan.dy, plan.cov, null);
}

// The live Patch preview (PhotoCraft patch.rs preview): the healed area at offset (dx, dy) as
// { box: [x0, y0, x1, y1), data: RGBA bytes of the box }, solved through healCoarse at the
// smallest step whose cell grid fits maxCells (clamped 1..64). null for a zero offset or an empty
// selection. src is never written.
export function patchPreview(src, W, H, mask, dx, dy, mode, maxCells = 128 * 128) {
  if (!dx && !dy) return null;
  const plan = patchPlan(mask, W, H, dx, dy, mode);
  const box = healBox(plan.cov, W, H);
  if (!box) return null;
  const [x0, y0, x1, y1] = box;
  const w = x1 - x0,
    h = y1 - y0;
  const need = Math.ceil(Math.sqrt((w * h) / Math.max(1, maxCells)));
  const step = Math.min(64, Math.max(1, need));
  const { heal, healed } = healSolve(src, W, H, plan.dx, plan.dy, plan.cov, box, step);
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const r = (y - y0) * w + (x - x0);
      const i = (y * W + x) * 4;
      data.set(src.subarray(i, i + 4), r * 4);
      if (heal[r]) healOver(data, r * 4, src, i, healed, r * 4, Math.min(1, plan.cov[y * W + x]));
    }
  }
  return { box, data };
}

// The bounding box [x0, y0, x1, y1) of the entries of m (length w*h) that are > 0, or null.
function coverBounds(m, w, h) {
  let x0 = w,
    y0 = h,
    x1 = 0,
    y1 = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!(m[y * w + x] > 0)) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x + 1);
      y1 = Math.max(y1, y + 1);
    }
  }
  return x0 < x1 ? [x0, y0, x1, y1] : null;
}

// Composite the healed straight RGBA pixel healed[o..o + 4) (0..1, clamped here) over the bytes
// src[i..i + 4) into dst[di..di + 4) at k.
function healOver(dst, di, src, i, healed, o, k) {
  const hc = (c) => Math.min(1, Math.max(0, healed[o + c]));
  const sa = hc(3) * k;
  const da = src[i + 3] / 255;
  const oa = sa + da * (1 - sa);
  if (oa > 0) {
    const wd = da * (1 - sa);
    for (let c = 0; c < 3; c++) dst[di + c] = (hc(c) * 255 * sa + src[i + c] * wd) / oa;
  }
  dst[di + 3] = oa * 255;
}

// Spot Healing Brush (Type: Proximity Match), from PhotoCraft spot_heal_surface and
// proximity_source_patch (crates/engine/src/retouch_cmds.rs), inpaint::best_offset, and
// poisson::membrane_fill. Images here are interleaved w*h*ch floats; masks are w*h, truthy = set.

// Grow a mask by r pixels (a square structuring element). Returns a new Uint8Array.
export function dilateMask(w, h, m, r) {
  const tmp = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!m[y * w + x]) continue;
      for (let xx = Math.max(0, x - r); xx < Math.min(w, x + r + 1); xx++) tmp[y * w + xx] = 1;
    }
  }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!tmp[y * w + x]) continue;
      for (let yy = Math.max(0, y - r); yy < Math.min(h, y + r + 1); yy++) out[yy * w + x] = 1;
    }
  }
  return out;
}

// PhotoCraft's Content-Aware sampling window (content_aware::sampling_window) for a stroke with
// bounds b = [x0, y0, x1, y1) on a W × H canvas: the square of side 4·√(max(w, 50)·max(h, 50))
// centred on it, slid inside the canvas and clipped only where the canvas is smaller. A side
// never drops below the stroke's own extent.
export function spotSamplingWindow(b, W, H) {
  const [x0, y0, x1, y1] = b;
  const side = Math.round(4 * Math.sqrt(Math.max(x1 - x0, 50) * Math.max(y1 - y0, 50)));
  const span = (c2, extent, len) => {
    const s = Math.max(side, extent);
    if (s >= len) return [0, len];
    const a = Math.min(len - s, Math.max(0, Math.trunc((c2 - s) / 2)));
    return [a, a + s];
  };
  const [wx0, wx1] = span(x0 + x1, x1 - x0, W);
  const [wy0, wy1] = span(y0 + y1, y1 - y0, H);
  return [wx0, wy0, wx1, wy1];
}

// Proximity match (PhotoCraft inpaint::best_offset): the displacement { dx, dy } within margin
// whose surroundings best match, by mean squared difference, the ring of `ring` pixels around
// the domain, with the displaced domain bounds (plus the ring) inside the grid and clear of the
// domain. The search is a coarse grid, then a full-resolution pass around the winner. Ties go to
// the nearer source. null if no displacement fits.
export function bestOffset(w, h, ch, img, domain, ring, margin) {
  const bb = coverBounds(domain, w, h);
  if (!bb) return null;
  const extent = Math.max(w, h);
  const maxR = Math.min(extent, Math.max(0, Math.trunc(margin)));
  if (maxR === 0) return null;
  const rg = Math.min(extent, Math.max(1, Math.trunc(ring)));
  // Summed-area table of the domain, for "how many domain pixels in this rectangle".
  const sw = w + 1;
  const sat = new Int32Array(sw * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += domain[y * w + x] ? 1 : 0;
      sat[(y + 1) * sw + x + 1] = sat[y * sw + x + 1] + row;
    }
  }
  const count = (ax0, ay0, ax1, ay1) => {
    ax0 = Math.max(0, ax0);
    ay0 = Math.max(0, ay0);
    ax1 = Math.min(w, ax1);
    ay1 = Math.min(h, ay1);
    if (ax0 >= ax1 || ay0 >= ay1) return 0;
    return sat[ay1 * sw + ax1] - sat[ay0 * sw + ax1] - sat[ay1 * sw + ax0] + sat[ay0 * sw + ax0];
  };
  const x0 = bb[0] - rg,
    y0 = bb[1] - rg,
    x1 = bb[2] + rg,
    y1 = bb[3] + rg;
  // Sample points: the domain's ring, subsampled to about 2000.
  let pts = [];
  for (let y = Math.max(0, y0); y < Math.min(h, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) {
      if (domain[y * w + x]) continue;
      if (count(x - rg, y - rg, x + rg + 1, y + rg + 1) > 0) pts.push(y * w + x);
    }
  }
  const stride = Math.max(1, Math.floor(pts.length / 2000));
  if (stride > 1) pts = pts.filter((_, i) => i % stride === 0);
  const n = Math.max(1, pts.length);
  const evaluate = (dx, dy, cutoff) => {
    const inside = x0 + dx >= 0 && y0 + dy >= 0 && x1 + dx <= w && y1 + dy <= h;
    if ((dx === 0 && dy === 0) || !inside || count(x0 + dx, y0 + dy, x1 + dx, y1 + dy) !== 0) {
      return null;
    }
    const penalty = 1 + 1e-3 * (Math.hypot(dx, dy) / maxR);
    const shift = (dy * w + dx) * ch;
    let e = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i] * ch;
      for (let c = 0; c < ch; c++) {
        const d = img[a + c] - img[a + shift + c];
        e += d * d;
      }
      if (i % 32 === 31 && (e / n) * penalty >= cutoff) return null;
    }
    return (e / n) * penalty;
  };
  let best = null;
  const consider = (dx, dy) => {
    const e = evaluate(dx, dy, best ? best.e : Infinity);
    if (e !== null && (!best || e < best.e)) best = { dx, dy, e };
  };
  const step = Math.max(1, Math.trunc(maxR / 24));
  for (let dy = -maxR; dy <= maxR; dy += step) {
    for (let dx = -maxR; dx <= maxR; dx += step) consider(dx, dy);
  }
  if (step > 1 && best) {
    const { dx: bx, dy: by } = best;
    for (let dy = by - step; dy <= by + step; dy++) {
      for (let dx = bx - step; dx <= bx + step; dx++) consider(dx, dy);
    }
  }
  return best && { dx: best.dx, dy: best.dy };
}

// Copy the domain from (dx, dy) away, reading the pre-heal pixels only (so overlapping offsets
// never re-copy what was just written and streak). Returns a new Float32Array, or null when a
// source pixel falls off the grid.
export function proximitySourcePatch(img, w, h, ch, domain, dx, dy) {
  if (!(w > 0 && h > 0 && ch > 0) || domain.length !== w * h || img.length !== w * h * ch) {
    return null;
  }
  const out = Float32Array.from(img);
  for (let p = 0; p < w * h; p++) {
    if (!domain[p]) continue;
    const x = (p % w) + dx,
      y = Math.floor(p / w) + dy;
    if (x < 0 || y < 0 || x >= w || y >= h) return null;
    const s = (y * w + x) * ch;
    for (let c = 0; c < ch; c++) out[p * ch + c] = img[s + c];
  }
  return out;
}

// Membrane fill (no source texture): the harmonic interpolation of the known pixels into the
// domain, per channel, through solveMembrane. Returns a new Float32Array.
export function membraneFill(w, h, ch, img, domain) {
  const out = new Float32Array(w * h * ch);
  const v = new Float32Array(w * h);
  for (let c = 0; c < ch; c++) {
    for (let i = 0; i < w * h; i++) v[i] = domain[i] ? 0 : img[i * ch + c];
    solveMembrane(w, h, domain, v);
    for (let i = 0; i < w * h; i++) out[i * ch + c] = v[i];
  }
  return out;
}

// Heal a finished Spot Healing stroke (PhotoCraft spot_heal_surface, Proximity Match). src is
// the pre-stroke RGBA bytes, cov the stroke's coverage (Float32Array W*H), size the brush size.
// Over the sampling window around the coverage bounds: the domain is the coverage dilated by 2,
// filled from the best-matching offset (or by membraneFill when none fits), then seamlessClone
// over the coverage dilated by 1 (and a one-pixel ring) fits it to its surroundings. The result
// is composited over src into dst at k = coverage × opacity; mask (0/1, or null) limits writes.
// Returns the touched box or null.
export function spotHealStroke(dst, src, W, H, cov, size, mask, opacity = 1) {
  const b = coverBounds(cov, W, H);
  if (!b || opacity <= 0) return null;
  const [rx0, ry0, rx1, ry1] = spotSamplingWindow(b, W, H);
  const w = rx1 - rx0,
    h = ry1 - ry0;
  const img = new Float32Array(w * h * 4);
  const hole = new Uint8Array(w * h);
  for (let y = ry0; y < ry1; y++) {
    for (let x = rx0; x < rx1; x++) {
      const r = (y - ry0) * w + (x - rx0);
      const p = y * W + x;
      hole[r] = cov[p] > 0 ? 1 : 0;
      for (let c = 0; c < 4; c++) img[r * 4 + c] = src[p * 4 + c] / 255;
    }
  }
  // Synthesise over a slightly larger domain than the solve, so the solve's boundary carries
  // synthesised values that differ from the surroundings; that mismatch is what the membrane fixes.
  const domain = dilateMask(w, h, hole, 2);
  const healMask = dilateMask(w, h, hole, 1);
  const ring = Math.trunc(Math.min(16, Math.max(3, size / 8)));
  const off = bestOffset(w, h, 4, img, domain, ring, Math.floor(Math.max(w, h) / 2));
  const filled =
    (off && proximitySourcePatch(img, w, h, 4, domain, off.dx, off.dy)) ||
    membraneFill(w, h, 4, img, domain);
  // heal_region: the seamless clone over the heal mask's bounds plus a one-pixel ring.
  const hb = coverBounds(healMask, w, h);
  const hx0 = Math.max(0, hb[0] - 1),
    hy0 = Math.max(0, hb[1] - 1);
  const hw = Math.min(w, hb[2] + 1) - hx0,
    hh = Math.min(h, hb[3] + 1) - hy0;
  const s = new Float32Array(hw * hh * 4);
  const d = new Float32Array(hw * hh * 4);
  const m = new Uint8Array(hw * hh);
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < hw; x++) {
      const q = y * hw + x;
      const r = (y + hy0) * w + x + hx0;
      m[q] = healMask[r];
      for (let c = 0; c < 4; c++) {
        s[q * 4 + c] = filled[r * 4 + c];
        d[q * 4 + c] = img[r * 4 + c];
      }
    }
  }
  const healed = seamlessClone(hw, hh, 4, s, d, m);
  for (let y = b[1]; y < b[3]; y++) {
    for (let x = b[0]; x < b[2]; x++) {
      const p = y * W + x;
      if (!(cov[p] > 0) || (mask && !mask[p])) continue;
      const q = (y - ry0 - hy0) * hw + (x - rx0 - hx0);
      healOver(dst, p * 4, src, p * 4, healed, q * 4, Math.min(1, cov[p] * opacity));
    }
  }
  return b;
}

// Build up a stroke's coverage (Float32Array W*H) with one round dab at (cx, cy): c ← c + d·(1 − c).
// Returns the touched box or null.
export function coverageDab(cov, W, H, cx, cy, radius, hardness) {
  const reach = tipReach(radius, hardness) + 0.5;
  const x0 = Math.max(0, Math.floor(cx - reach));
  const y0 = Math.max(0, Math.floor(cy - reach));
  const x1 = Math.min(W, Math.ceil(cx + reach));
  const y1 = Math.min(H, Math.ceil(cy + reach));
  if (x0 >= x1 || y0 >= y1) return null;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const d = dabCoverage(Math.hypot(x + 0.5 - cx, y + 0.5 - cy), radius, hardness);
      if (d > 0) cov[y * W + x] += d * (1 - cov[y * W + x]);
    }
  }
  return [x0, y0, x1, y1];
}

// Brush-mode Eraser (PhotoCraft render.rs: a stroke buffer built up with flow, composited once at
// the stroke opacity). Rewrites dst alpha from the pre-stroke src: a ← src_a · (1 − cov · opacity),
// so overlapping dabs never take a pixel past opacity. opacity is 0..1; mask (0/1 or null) limits
// writes.
export function eraseCoverage(src, dst, cov, opacity, mask = null) {
  for (let p = 0; p < cov.length; p++) {
    if (cov[p] > 0 && !(mask && !mask[p])) {
      dst[p * 4 + 3] = src[p * 4 + 3] * (1 - Math.min(1, cov[p] * opacity));
    }
  }
}

// The round-tip stroke dab shared by the Brush, the Pencil, and the Brush-mode Eraser: coverage
// builds up by tip(d) × flow (c ← c + d·flow·(1 − c), PhotoCraft render.rs accumulate) out to
// reach pixels, then write(p, c) rewrites pixel p from the pre-stroke src. Returns the touched
// box or null.
// dist(dx, dy) is the tip-space distance of a pixel offset (round by default); coverage builds
// toward ceil (Transfer's per-dab opacity, c ← c + d·flow·(ceil − c)).
function roundTipDab(W, H, cx, cy, reach, tip, flow, mask, cov, write, dist = Math.hypot, ceil = 1) {
  const x0 = Math.max(0, Math.floor(cx - reach));
  const y0 = Math.max(0, Math.floor(cy - reach));
  const x1 = Math.min(W, Math.ceil(cx + reach));
  const y1 = Math.min(H, Math.ceil(cy + reach));
  if (x0 >= x1 || y0 >= y1 || flow <= 0) return null;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const p = y * W + x;
      if (mask && !mask[p]) continue;
      const d = tip(dist(x + 0.5 - cx, y + 0.5 - cy)) * flow;
      if (d <= 0) continue;
      if (cov[p] < ceil) cov[p] += d * (ceil - cov[p]);
      write(p, cov[p]);
    }
  }
  return [x0, y0, x1, y1];
}

// PhotoCraft render.rs computed tip with Angle and Roundness: an offset turns into tip space
// (y-up, rotated by −angle) and the tip's height is squashed to roundness × radius.
function ellipseTip(W, H, dab, hardness, mask, cov, write) {
  const { x, y, radius, angle = 0, roundness = 1, flow, ceil = 1 } = dab;
  const ro = Math.min(1, Math.max(0.5 / radius, roundness));
  const rm = Math.max(0.5, radius * ro);
  const reach = (tipReach(rm, hardness) + 0.5) / ro;
  const a = (angle * Math.PI) / 180;
  const cs = Math.cos(a),
    sn = Math.sin(a);
  const dist = (dx, dy) => {
    const u = dx * cs - dy * sn;
    const v = -dx * sn - dy * cs;
    return Math.hypot(u * ro, v);
  };
  const tip = (d) => dabCoverage(d, rm, hardness);
  return roundTipDab(W, H, x, y, reach, tip, flow, mask, cov, write, dist, ceil);
}

/**
 * One Brush Settings dab (brush-dynamics.js dabBuilder: { x, y, radius, angle, roundness, flow,
 * ceil }) through paintWrite. hardness and opacity are 0..1. Returns the touched box or null.
 */
export function paintTipDab(dst, src, W, H, dab, hardness, opacity, rgb, lockAlpha, mask, cov) {
  if (opacity <= 0) return null;
  const write = paintWrite(dst, src, opacity, rgb, lockAlpha);
  return ellipseTip(W, H, dab, hardness, mask, cov, write);
}

// PhotoCraft's soft round tip for roundTipDab: its reach and coverage at distance d.
function softTip(W, H, cx, cy, radius, hardness, flow, mask, cov, write) {
  const reach = tipReach(radius, hardness) + 0.5;
  const tip = (d) => dabCoverage(d, radius, hardness);
  return roundTipDab(W, H, cx, cy, reach, tip, flow, mask, cov, write);
}

// One Brush-mode Eraser dab, rewritten like eraseCoverage. flow, hardness, and opacity are 0..1.
// fill ([r, g, b] bytes) is the Background's locked transparency: the dab paints that colour
// instead of clearing alpha. Returns the touched box or null.
export function eraseDab(
  dst,
  src,
  W,
  H,
  cx,
  cy,
  radius,
  hardness,
  flow,
  opacity,
  mask,
  cov,
  fill = null
) {
  if (opacity <= 0) return null;
  return softTip(W, H, cx, cy, radius, hardness, flow, mask, cov, (p, c) =>
    erasePixel(dst, src, p, Math.min(1, c * opacity), fill)
  );
}

// Erase pixel p by k (0..1) from the pre-stroke src: alpha toward 0, or the colour toward fill.
function erasePixel(dst, src, p, k, fill) {
  const i = p * 4;
  if (!fill) {
    dst[i + 3] = src[i + 3] * (1 - k);
    return;
  }
  for (let c = 0; c < 3; c++) dst[i + c] = src[i + c] + (fill[c] - src[i + c]) * k;
  dst[i + 3] = src[i + 3];
}

// One Pencil / Block-mode Eraser dab: the hard, pixel-aligned square of side s whose top-left is
// round(x - s / 2), round(y - s / 2). cov marks erased pixels, so overlapping dabs in one stroke
// never erase past opacity (0..1); fill is eraseDab's. Returns the touched box or null.
export function eraseSquareDab(dst, src, W, H, x, y, s, opacity, mask, cov, fill = null) {
  if (opacity <= 0) return null;
  const left = Math.round(x - s / 2),
    top = Math.round(y - s / 2);
  const x0 = Math.max(0, left),
    y0 = Math.max(0, top);
  const x1 = Math.min(W, left + s),
    y1 = Math.min(H, top + s);
  if (x0 >= x1 || y0 >= y1) return null;
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const p = py * W + px;
      if ((mask && !mask[p]) || cov[p]) continue;
      cov[p] = 1;
      erasePixel(dst, src, p, opacity, fill);
    }
  }
  return [x0, y0, x1, y1];
}

// The colour rgb ([r, g, b] bytes) source-over the pre-stroke src at k = coverage × opacity, so
// overlapping dabs in one stroke never paint past opacity. lockAlpha keeps the src alpha
// (source-atop).
function paintWrite(dst, src, opacity, rgb, lockAlpha) {
  return (p, c) => {
    const i = p * 4;
    const k = Math.min(1, c * opacity);
    const sa = src[i + 3] / 255;
    if (lockAlpha) {
      for (let ch = 0; ch < 3; ch++) dst[i + ch] = src[i + ch] + (rgb[ch] - src[i + ch]) * k;
      dst[i + 3] = src[i + 3];
      return;
    }
    const a = k + sa * (1 - k);
    for (let ch = 0; ch < 3; ch++) {
      dst[i + ch] = a > 0 ? (rgb[ch] * k + src[i + ch] * sa * (1 - k)) / a : 0;
    }
    dst[i + 3] = a * 255;
  };
}

// One Brush dab through paintWrite. flow, hardness, and opacity are 0..1. Returns the touched
// box or null.
export function paintDab(
  dst,
  src,
  W,
  H,
  cx,
  cy,
  radius,
  hardness,
  flow,
  opacity,
  rgb,
  lockAlpha,
  mask,
  cov
) {
  if (opacity <= 0) return null;
  const write = paintWrite(dst, src, opacity, rgb, lockAlpha);
  return softTip(W, H, cx, cy, radius, hardness, flow, mask, cov, write);
}

// Where a Pencil dab of diameter size sits on the pixel grid: odd sizes centre on a pixel centre,
// even sizes on a pixel corner (PhotoCraft's aliased brush puts dabs on the grid).
export function pencilSnap(v, size) {
  return Math.round(size) % 2 ? Math.floor(v) + 0.5 : Math.round(v);
}

// One Pencil dab: an aliased disc (coverage exactly 0 or 1, every pixel whose centre lies within
// size / 2 of the snapped centre) painted through paintWrite at full flow. opacity is 0..1.
// Returns the touched box or null.
export function pencilDab(dst, src, W, H, x, y, size, opacity, rgb, lockAlpha, mask, cov) {
  if (opacity <= 0) return null;
  const r = Math.max(0.5, size / 2);
  const tip = (d) => (d <= r + 1e-6 ? 1 : 0);
  const write = paintWrite(dst, src, opacity, rgb, lockAlpha);
  const cx = pencilSnap(x, size);
  const cy = pencilSnap(y, size);
  return roundTipDab(W, H, cx, cy, r + 0.5, tip, 1, mask, cov, write);
}

// Pencil Auto Erase (PhotoCraft brush_cmds apply_auto_erase): a stroke that starts on a pixel of
// the foreground colour fg paints the background colour bg instead. Colours are [r, g, b] bytes.
export function autoEraseColor(data, W, H, x, y, fg, bg) {
  const px = Math.floor(x),
    py = Math.floor(y);
  if (px < 0 || py < 0 || px >= W || py >= H) return fg;
  const i = (py * W + px) * 4;
  const match = data[i + 3] > 0 && [0, 1, 2].every((c) => Math.abs(data[i + c] - fg[c]) < 1.5);
  return match ? bg : fg;
}

// Dodge / Burn tone curves, from PhotoCraft crates/algo/src/retouch.rs (tone_curve / dodge_burn).
// Values are 0..1; exposure is 0..1; range is 'shadows' | 'midtones' | 'highlights'.

function luma(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

// The dodge (burn = false) or burn transfer for one value v.
export function toneCurve(v, e, range, burn) {
  v = Math.max(0, v);
  e = Math.min(1, Math.max(0, e));
  const c = Math.min(1, v);
  if (range === 'shadows') {
    // (1 − v)² weight: the dark end moves most.
    return burn ? v - e * (1 - c) ** 2 * v : v + e * (1 - c) ** 2 * (1 - c);
  }
  if (range === 'highlights') {
    return burn ? v - e * c * c * v : v + e * c * c * (1 - c);
  }
  // Midtones: a gamma bend weighted to peak at mid-grey, so 0 and 1 stay put.
  const w = Math.min(1, Math.max(0, 4 * v * (1 - v)));
  return v + w * (c ** (burn ? 1 + e : 1 / (1 + e)) - v);
}

// Bring [r, g, b] back into 0..1 by mixing toward luma l rather than clipping each channel.
function compressGamut(c, l) {
  l = Math.min(1, Math.max(0, l));
  const lo = Math.min(c[0], c[1], c[2]),
    hi = Math.max(c[0], c[1], c[2]);
  let t = 1;
  if (hi > 1 && hi - l > 1e-9) t = Math.min(t, (1 - l) / (hi - l));
  if (lo < 0 && l - lo > 1e-9) t = Math.min(t, l / (l - lo));
  return [l + (c[0] - l) * t, l + (c[1] - l) * t, l + (c[2] - l) * t];
}

// Dodge (burn = false) or Burn one straight-RGB colour [r, g, b] (0..1) at exposure e (0..1).
// protectTones runs the curve on luma and scales the colour to the new luma (hue kept,
// gamut-compressed); otherwise each channel goes through the curve.
export function dodgeBurn(rgb, e, range, burn, protectTones) {
  if (!(e > 0)) return [rgb[0], rgb[1], rgb[2]];
  if (protectTones) {
    const l = luma(rgb[0], rgb[1], rgb[2]);
    const nl = toneCurve(l, e, range, burn);
    const out = l > 1e-6 ? [(rgb[0] * nl) / l, (rgb[1] * nl) / l, (rgb[2] * nl) / l] : [nl, nl, nl];
    return compressGamut(out, nl);
  }
  return rgb.slice(0, 3).map((v) => toneCurve(v, e, range, burn));
}

// One Dodge / Burn dab centred at (cx, cy), like PhotoCraft tone_stroke. Each pixel is toned once
// from src (the pre-stroke pixels) and mixed in by the stroke's coverage there: cov (a
// Float32Array W*H per stroke) builds up c ← c + d·(1 − c) and caps at 1, so overlapping dabs never
// compound past the stroke's exposure. tone([r, g, b]) gives the full-exposure colour (0..1).
// Alpha is never changed; mask (0/1, or null) limits writes. Returns the touched box or null.
export function toneDab(dst, src, W, H, cx, cy, radius, hardness, tone, mask, cov) {
  const reach = tipReach(radius, hardness) + 0.5;
  const x0 = Math.max(0, Math.floor(cx - reach));
  const y0 = Math.max(0, Math.floor(cy - reach));
  const x1 = Math.min(W, Math.ceil(cx + reach));
  const y1 = Math.min(H, Math.ceil(cy + reach));
  if (x0 >= x1 || y0 >= y1) return null;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const p = y * W + x;
      if (mask && !mask[p]) continue;
      const d = dabCoverage(Math.hypot(x + 0.5 - cx, y + 0.5 - cy), radius, hardness);
      if (d <= 0) continue;
      let k = d;
      if (cov) {
        k = cov[p] + d * (1 - cov[p]);
        if (k <= cov[p]) continue;
        cov[p] = k;
      }
      const i = p * 4;
      const o = [src[i] / 255, src[i + 1] / 255, src[i + 2] / 255];
      const t = tone(o);
      dst[i] = (o[0] + (t[0] - o[0]) * k) * 255;
      dst[i + 1] = (o[1] + (t[1] - o[1]) * k) * 255;
      dst[i + 2] = (o[2] + (t[2] - o[2]) * k) * 255;
    }
  }
  return [x0, y0, x1, y1];
}

// HSV-style saturation (chroma / max) of [r, g, b] (0..1).
export function saturation(rgb) {
  const lo = Math.min(rgb[0], rgb[1], rgb[2]),
    hi = Math.max(rgb[0], rgb[1], rgb[2]);
  return hi <= 1e-6 ? 0 : Math.min(1, Math.max(0, (hi - lo) / hi));
}

// Sponge, from PhotoCraft crates/algo/src/retouch.rs: move [r, g, b] (0..1) away from (saturate)
// or toward its Rec. 601 luma grey by amount (0..1). vibrance damps the change: saturating moves
// already-saturated colours less, desaturating moves near-greys less. The result is
// gamut-compressed around luma, never clipped per channel, so luma is kept.
export function sponge(rgb, amount, saturate, vibrance) {
  let a = Math.min(1, Math.max(0, amount));
  if (!(a > 0)) return [rgb[0], rgb[1], rgb[2]];
  if (vibrance) {
    const s = saturation(rgb);
    a *= saturate ? 1 - s : 0.25 + 0.75 * s;
  }
  const l = luma(rgb[0], rgb[1], rgb[2]);
  const k = saturate ? 1 + a : 1 - a;
  return compressGamut([l + (rgb[0] - l) * k, l + (rgb[1] - l) * k, l + (rgb[2] - l) * k], l);
}

// PhotoCraft per_dab: the per-dab strength that totals about e over one pass, given that about
// 1 / spacing dabs overlap each point (spacing is the dab step as a fraction of the brush size).
export function perDab(e, spacing) {
  const s = Math.min(1, Math.max(0.01, spacing));
  return 1 - (1 - Math.min(1, Math.max(0, e))) ** s;
}

// One sequential colour dab centred at (cx, cy), like PhotoCraft color_dab: each covered pixel of
// work (a Float32Array W*H*3 of straight RGB 0..1, the stroke's working copy) becomes
// f([r, g, b], k) with k = perDab(coverage × strength, spacing). Dabs edit work in order, so a
// stroke builds up. Alpha is not stored; mask (0/1, or null) limits writes. Returns the touched
// box [x0, y0, x1, y1) or null.
export function colorDab(work, W, H, cx, cy, radius, hardness, strength, spacing, f, mask) {
  const reach = tipReach(radius, hardness) + 0.5;
  const x0 = Math.max(0, Math.floor(cx - reach));
  const y0 = Math.max(0, Math.floor(cy - reach));
  const x1 = Math.min(W, Math.ceil(cx + reach));
  const y1 = Math.min(H, Math.ceil(cy + reach));
  if (x0 >= x1 || y0 >= y1 || !(strength > 0)) return null;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const p = y * W + x;
      if (mask && !mask[p]) continue;
      const d = dabCoverage(Math.hypot(x + 0.5 - cx, y + 0.5 - cy), radius, hardness);
      const k = perDab(d * strength, spacing);
      if (k <= 0) continue;
      const i = p * 3;
      const o = f([work[i], work[i + 1], work[i + 2]], k);
      work[i] = o[0];
      work[i + 1] = o[1];
      work[i + 2] = o[2];
    }
  }
  return [x0, y0, x1, y1];
}

// Gaussian blur of the window [x0, y0, x1, y1) of an interleaved W × H × ch Float32Array, reading
// neighbours with edge clamping (PhotoCraft local_blur). With an alpha channel index, colour is
// blurred premultiplied so transparent pixels don't bleed their colour; where the blurred alpha is
// ~0 the original colour is kept. Returns the window's pixels ((x1 − x0) × (y1 − y0) × ch).
export function localBlur(data, W, H, ch, alpha, win, sigma) {
  const [x0, y0, x1, y1] = win;
  const ow = x1 - x0,
    oh = y1 - y0;
  if (ow <= 0 || oh <= 0 || ch <= 0) return new Float32Array(0);
  const hasA = alpha != null && alpha >= 0;
  const r = Math.max(1, Math.ceil(sigma * 3));
  const den = Math.max(1e-6, 2 * sigma * sigma);
  const k = new Float32Array(2 * r + 1);
  let ks = 0;
  for (let i = -r; i <= r; i++) ks += k[i + r] = Math.exp(-(i * i) / den);
  for (let i = 0; i < k.length; i++) k[i] /= ks;
  // Horizontal pass over the window rows extended vertically by r, then a vertical pass.
  const stride = ow * ch;
  const th = oh + 2 * r;
  const tmp = new Float32Array(stride * th);
  const row = new Float32Array((ow + 2 * r) * ch);
  for (let ty = 0; ty < th; ty++) {
    const y = Math.min(H - 1, Math.max(0, y0 + ty - r));
    for (let rx = 0; rx < ow + 2 * r; rx++) {
      const x = Math.min(W - 1, Math.max(0, x0 + rx - r));
      const i = (y * W + x) * ch;
      const av = hasA ? data[i + alpha] : 1;
      for (let c = 0; c < ch; c++) row[rx * ch + c] = c === alpha ? data[i + c] : data[i + c] * av;
    }
    const o = ty * stride;
    for (let t = 0; t < k.length; t++) {
      const kv = k[t];
      const s = t * ch;
      for (let j = 0; j < stride; j++) tmp[o + j] += row[s + j] * kv;
    }
  }
  const out = new Float32Array(stride * oh);
  for (let oy = 0; oy < oh; oy++) {
    const o = oy * stride;
    for (let t = 0; t < k.length; t++) {
      const kv = k[t];
      const s = (oy + t) * stride;
      for (let j = 0; j < stride; j++) out[o + j] += tmp[s + j] * kv;
    }
    if (!hasA) continue;
    for (let ox = 0; ox < ow; ox++) {
      const q = o + ox * ch;
      const av = out[q + alpha];
      const i = ((y0 + oy) * W + x0 + ox) * ch;
      for (let c = 0; c < ch; c++) {
        if (c !== alpha) out[q + c] = av > 1e-6 ? out[q + c] / av : data[i + c];
      }
    }
  }
  return out;
}

// Unsharp-mask sharpen of a window (same layout as localBlur, PhotoCraft local_sharpen):
// v + amount · (v − blur(v)) with a sigma-1 blur. protectDetail clamps each result to its 3×3
// neighbourhood's range so halos and noise never become new extremes. Alpha is unchanged.
export function localSharpen(data, W, H, ch, alpha, win, amount, protectDetail) {
  const [x0, y0, x1, y1] = win;
  const ow = x1 - x0;
  const out = localBlur(data, W, H, ch, alpha, win, 1);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const o = ((y - y0) * ow + (x - x0)) * ch;
      const i = (y * W + x) * ch;
      for (let c = 0; c < ch; c++) {
        const v = data[i + c];
        if (c === alpha) {
          out[o + c] = v;
          continue;
        }
        let s = v + amount * (v - out[o + c]);
        if (protectDetail) {
          let lo = v,
            hi = v;
          for (let dy = -1; dy <= 1; dy++) {
            const ny = Math.min(H - 1, Math.max(0, y + dy));
            for (let dx = -1; dx <= 1; dx++) {
              const nx = Math.min(W - 1, Math.max(0, x + dx));
              const nv = data[(ny * W + nx) * ch + c];
              if (nv < lo) lo = nv;
              if (nv > hi) hi = nv;
            }
          }
          s = Math.min(hi, Math.max(lo, s));
        }
        out[o + c] = s;
      }
    }
  }
  return out;
}

// One Blur / Sharpen dab centred at (cx, cy), like PhotoCraft's Focus dab: filter(win) runs
// localBlur or localSharpen over the dab's box of work (a W × H × ch Float32Array, the stroke's
// working copy), and each covered pixel moves toward the result by k = perDab(coverage ×
// strength, spacing). Dabs edit work in order, so a stroke builds up. mask (0/1, or null) limits
// writes. Returns the touched box [x0, y0, x1, y1) or null.
export function focusDab(
  work,
  W,
  H,
  ch,
  cx,
  cy,
  radius,
  hardness,
  strength,
  spacing,
  filter,
  mask
) {
  const reach = tipReach(radius, hardness) + 0.5;
  const x0 = Math.max(0, Math.floor(cx - reach));
  const y0 = Math.max(0, Math.floor(cy - reach));
  const x1 = Math.min(W, Math.ceil(cx + reach));
  const y1 = Math.min(H, Math.ceil(cy + reach));
  if (x0 >= x1 || y0 >= y1 || !(strength > 0)) return null;
  const out = filter([x0, y0, x1, y1]);
  const ow = x1 - x0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const p = y * W + x;
      if (mask && !mask[p]) continue;
      const d = dabCoverage(Math.hypot(x + 0.5 - cx, y + 0.5 - cy), radius, hardness);
      const k = perDab(d * strength, spacing);
      if (k <= 0) continue;
      const o = ((y - y0) * ow + (x - x0)) * ch;
      const i = p * ch;
      for (let c = 0; c < ch; c++) work[i + c] += (out[o + c] - work[i + c]) * k;
    }
  }
  return [x0, y0, x1, y1];
}

// PhotoCraft mix_premultiplied: dst ← lerp(dst, src, k) in premultiplied space, straight RGBA in
// and out (alpha at index 3, read at offsets di / si). Where the result is fully transparent the
// colour is mixed straight, so it stays defined.
export function mixPremultiplied(dst, src, k, di = 0, si = 0) {
  const da = dst[di + 3],
    sa = src[si + 3];
  const oa = da + (sa - da) * k;
  for (let c = 0; c < 3; c++) {
    const d = dst[di + c],
      s = src[si + c];
    dst[di + c] = oa > 1e-6 ? (d * da + (s * sa - d * da) * k) / oa : d + (s - d) * k;
  }
  dst[di + 3] = oa;
}

// A Smudge stroke's state (PhotoCraft Smudge): strength 0..1, finger an [r, g, b, a] 0..1 colour
// for Finger Painting or null, and the carried premultiplied colour buffer of (2r + 1)² pixels,
// r = ceil(maxSize / 2) + 2, filled by the first dab.
export function smudgeStroke(strength, finger, maxSize) {
  return {
    strength: Math.min(1, Math.max(0, strength)),
    finger,
    radius: Math.ceil(maxSize / 2) + 2,
    carry: null
  };
}

// One Smudge dab centred at (cx, cy) on work (a W × H × 4 straight RGBA Float32Array, the stroke's
// working copy): lay the carried colour down at coverage × strength through mixPremultiplied, then
// pick up, carry = carry · strength + pixel · (1 − strength). mask (0/1, or null) limits writes,
// not the pickup. Returns the touched box [x0, y0, x1, y1) or null.
export function smudgeDab(sm, work, W, H, cx, cy, radius, hardness, mask) {
  const r = sm.radius;
  const side = 2 * r + 1;
  const ix = Math.floor(cx),
    iy = Math.floor(cy);
  if (!sm.carry) {
    const carry = new Float32Array(side * side * 4);
    for (let qy = 0; qy < side; qy++) {
      for (let qx = 0; qx < side; qx++) {
        const q = (qy * side + qx) * 4;
        let v = sm.finger;
        if (!v) {
          const x = Math.min(W - 1, Math.max(0, ix + qx - r));
          const y = Math.min(H - 1, Math.max(0, iy + qy - r));
          const i = (y * W + x) * 4;
          v = work.subarray(i, i + 4);
        }
        const a = v[3];
        carry.set([v[0] * a, v[1] * a, v[2] * a, a], q);
      }
    }
    sm.carry = carry;
  }
  const carry = sm.carry;
  const reach = tipReach(radius, hardness) + 0.5;
  const x0 = Math.max(0, Math.floor(cx - reach));
  const y0 = Math.max(0, Math.floor(cy - reach));
  const x1 = Math.min(W, Math.ceil(cx + reach));
  const y1 = Math.min(H, Math.ceil(cy + reach));
  if (x0 >= x1 || y0 >= y1) return null;
  // Lay down the carried colour, back to straight for the mix.
  const src = new Float32Array(4);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const p = y * W + x;
      if (mask && !mask[p]) continue;
      const qx = x - ix + r,
        qy = y - iy + r;
      if (qx < 0 || qy < 0 || qx >= side || qy >= side) continue;
      const k = dabCoverage(Math.hypot(x + 0.5 - cx, y + 0.5 - cy), radius, hardness) * sm.strength;
      if (k <= 0) continue;
      const q = (qy * side + qx) * 4;
      const ca = carry[q + 3];
      for (let c = 0; c < 3; c++) src[c] = ca > 1e-6 ? carry[q + c] / ca : carry[q + c];
      src[3] = ca;
      mixPremultiplied(work, src, k, p * 4);
    }
  }
  // Pick up: the carried colour keeps strength of itself.
  const keep = sm.strength;
  for (let qy = 0; qy < side; qy++) {
    const y = iy + qy - r;
    if (y < 0 || y >= H) continue;
    for (let qx = 0; qx < side; qx++) {
      const x = ix + qx - r;
      if (x < 0 || x >= W) continue;
      const q = (qy * side + qx) * 4;
      const i = (y * W + x) * 4;
      const a = work[i + 3];
      for (let c = 0; c < 4; c++) {
        const v = c === 3 ? a : work[i + c] * a;
        carry[q + c] = carry[q + c] * keep + v * (1 - keep);
      }
    }
  }
  return [x0, y0, x1, y1];
}

// Mixer Brush, from PhotoCraft crates/paint/src/mixer.rs. The session state carries loaded paint
// between strokes: reservoir (straight [r, g, b, a] 0..1, or null when clean), its amount 0..1,
// the pickup well (colour taken up from the canvas, or null), and the colour of the last stroke,
// Load, or Clean (null before any).

// Fraction of the way the pickup colour moves toward the canvas colour per dab at 100 % Wet.
export const PICKUP_RATE = 0.25;

export function mixerState() {
  return { reservoir: null, amount: 0, pickup: null, color: null };
}

const sameColor = (a, b) => !!a && !!b && a.every((v, i) => v === b[i]);

// Load Brush: fill the reservoir with a colour (full).
export function mixerLoad(ms, color) {
  ms.reservoir = color.slice();
  ms.amount = 1;
}

// Clean Brush: empty the reservoir and the pickup well.
export function mixerClean(ms) {
  ms.reservoir = null;
  ms.amount = 0;
  ms.pickup = null;
}

// Before a stroke in color: a colour other than the last one loads the reservoir with it.
export function mixerBeginStroke(ms, color) {
  if (sameColor(ms.color, color)) return;
  mixerLoad(ms, color);
  ms.color = color.slice();
}

// After a stroke in color: the automatic Clean empties the brush, then the automatic Load refills
// the reservoir.
export function mixerEndStroke(ms, color, clean, load) {
  if (clean) mixerClean(ms);
  if (load) mixerLoad(ms, color);
  ms.color = color.slice();
}

// One Mixer Brush dab centred at (cx, cy) on work (the stroke's W × H × 4 straight RGBA
// Float32Array working copy), in mixer.rs order: sample the alpha-weighted canvas colour under the
// tip from sample (a same-layout array, or work when null), move the pickup toward it by
// PICKUP_RATE × wet × coverage-weighted alpha, deposit reservoir (weight amount × (1 − mix·wet))
// mixed with pickup (weight mix·wet) source-over at coverage × flow × min(1, total weight), then
// drain the reservoir unless load is 1. m = { wet, load, mix, flow } 0..1. mask (0/1, or null)
// limits writes, not the sampling. Returns the touched box [x0, y0, x1, y1) or null.
export function mixerDab(ms, work, sample, W, H, cx, cy, radius, hardness, m, mask) {
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const wet = clamp01(m.wet),
    mix = clamp01(m.mix),
    flow = clamp01(m.flow),
    load = clamp01(m.load);
  const reach = tipReach(radius, hardness) + 0.5;
  const x0 = Math.max(0, Math.floor(cx - reach));
  const y0 = Math.max(0, Math.floor(cy - reach));
  const x1 = Math.min(W, Math.ceil(cx + reach));
  const y1 = Math.min(H, Math.ceil(cy + reach));
  if (x0 >= x1 || y0 >= y1) return null;
  const bw = x1 - x0;
  const cov = new Float32Array(bw * (y1 - y0));
  const from = sample ?? work;
  const acc = [0, 0, 0];
  let wsum = 0,
    asum = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const w = dabCoverage(Math.hypot(x + 0.5 - cx, y + 0.5 - cy), radius, hardness);
      cov[(y - y0) * bw + x - x0] = w;
      if (w <= 0) continue;
      const i = (y * W + x) * 4;
      const al = from[i + 3];
      for (let c = 0; c < 3; c++) acc[c] += from[i + c] * w * al;
      wsum += w;
      asum += w * al;
    }
  }
  if (asum > 1e-6 && wet > 0) {
    const ca = asum / Math.max(1e-6, wsum);
    const canvas = [acc[0] / asum, acc[1] / asum, acc[2] / asum, 1];
    const p = ms.pickup;
    ms.pickup = p ? p.map((v, c) => v + (canvas[c] - v) * PICKUP_RATE * wet * ca) : canvas;
  }
  const res = ms.reservoir;
  if (!res) ms.amount = 0;
  const wr = res ? Math.min(1, Math.max(0, ms.amount)) * (1 - mix * wet) : 0;
  const wp = ms.pickup ? mix * wet : 0;
  const total = wr + wp;
  if (total > 1e-6) {
    const paint = [0, 1, 2].map(
      (c) => ((res ? res[c] : 0) * wr + (ms.pickup ? ms.pickup[c] : 0) * wp) / total
    );
    const dep = Math.min(1, total) * flow;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const p = y * W + x;
        if (mask && !mask[p]) continue;
        const k = cov[(y - y0) * bw + x - x0] * dep;
        if (k <= 0) continue;
        // over_native with an opaque source: alpha k over the work pixel.
        const i = p * 4;
        const da = work[i + 3];
        const oa = k + da * (1 - k);
        for (let c = 0; c < 3; c++) work[i + c] = (paint[c] * k + work[i + c] * da * (1 - k)) / oa;
        work[i + 3] = oa;
      }
    }
  }
  if (res) ms.amount *= 1 - 0.08 * (1 - load);
  return [x0, y0, x1, y1];
}

// Red Eye, from PhotoCraft crates/algo/src/redeye.rs (apply) and engine redeye_cmds.rs
// (read_rect, mix_selection). Values are 0..1 straight RGBA; only the window around the click
// (search radius plus the erode / blur halo) is read and written.
const RED_EYE_SIGMA = 0.8;
const RED_EYE_HALO = 1 + Math.ceil(RED_EYE_SIGMA * 3) + 1;

export function redEyeSearchRadius(pupilSize) {
  const p = Number.isFinite(pupilSize) ? Math.min(100, Math.max(1, pupilSize)) : 50;
  return Math.min(128, Math.max(8, 4 + 1.2 * p));
}

function redEyeLuma(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function isRedEye(r, g, b) {
  if (r <= g + 0.15 || r <= b + 0.15) return false;
  if (redEyeLuma(r, g, b) >= 0.92) return false;
  return Math.max(r, g, b) - Math.min(r, g, b) >= 0.08;
}

// Separable Gaussian with edge-clamped taps (redeye.rs blur).
function redEyeBlur(src, w, h, sigma) {
  const r = Math.min(32, Math.max(1, Math.ceil(sigma * 3)));
  const k = [];
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const wgt = Math.exp(-(i * i) / (2 * sigma * sigma));
    k.push(wgt);
    sum += wgt;
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let a = 0;
      for (let t = 0; t < k.length; t++) {
        const xx = Math.min(w - 1, Math.max(0, x + t - r));
        a += src[y * w + xx] * k[t];
      }
      tmp[y * w + x] = a;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let a = 0;
      for (let t = 0; t < k.length; t++) {
        const yy = Math.min(h - 1, Math.max(0, y + t - r));
        a += tmp[yy * w + x] * k[t];
      }
      out[y * w + x] = a;
    }
  }
  return out;
}

// Neutralize the red pupil nearest (cx, cy) in data (RGBA, W × H). Returns the pixels changed.
export function redEyeFix(data, W, H, cx, cy, pupilSize, darken, mask) {
  if (!(W > 0 && H > 0) || !Number.isFinite(cx) || !Number.isFinite(cy)) return 0;
  const clickX = Math.floor(cx),
    clickY = Math.floor(cy);
  const radius = redEyeSearchRadius(pupilSize);
  const tAmt = Number.isFinite(darken) ? Math.min(100, Math.max(0, darken)) / 100 : 0.5;
  const ext = Math.ceil(radius) + RED_EYE_HALO;
  const x0 = Math.max(0, clickX - ext),
    y0 = Math.max(0, clickY - ext);
  const x1 = Math.min(W, clickX + ext + 1),
    y1 = Math.min(H, clickY + ext + 1);
  const w = x1 - x0,
    h = y1 - y0;
  if (w <= 0 || h <= 0) return 0;
  const n = w * h;
  const within = (x, y) => Math.hypot(x0 + x - clickX, y0 + y - clickY) <= radius;
  const at = (x, y) => ((y0 + y) * W + x0 + x) * 4;

  // Hard mask of red pixels in the search disc, and the one nearest the click.
  const hard = new Uint8Array(n);
  let seed = -1,
    best = Infinity;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!within(x, y)) continue;
      const i = at(x, y);
      if (!isRedEye(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255)) continue;
      hard[y * w + x] = 1;
      const dx = x0 + x - clickX,
        dy = y0 + y - clickY;
      const d2 = dx * dx + dy * dy;
      if (d2 < best) {
        best = d2;
        seed = y * w + x;
      }
    }
  }
  if (seed < 0) return 0;

  // Keep the 4-connected region around the seed (flood_keep).
  const keep = new Uint8Array(n);
  const stack = [seed];
  while (stack.length) {
    const i = stack.pop();
    if (keep[i] || !hard[i]) continue;
    keep[i] = 1;
    const x = i % w,
      y = (i - x) / w;
    if (x > 0) stack.push(i - 1);
    if (x + 1 < w) stack.push(i + 1);
    if (y > 0) stack.push(i - w);
    if (y + 1 < h) stack.push(i + w);
  }

  // 1 px erode (window edges count as off), then soften.
  const soft = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let on = 1;
      for (let dy = -1; dy <= 1 && on; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx,
            yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h || !keep[yy * w + xx]) {
            on = 0;
            break;
          }
        }
      }
      soft[y * w + x] = on;
    }
  }
  const m = redEyeBlur(soft, w, h, RED_EYE_SIGMA);

  let changed = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!within(x, y)) continue;
      const p = (y0 + y) * W + x0 + x;
      if (mask && !mask[p]) continue;
      const i = p * 4;
      const r0 = data[i] / 255,
        g0 = data[i + 1] / 255,
        b0 = data[i + 2] / 255;
      if (redEyeLuma(r0, g0, b0) >= 0.92) continue;
      const t = Math.min(1, Math.max(0, m[y * w + x])) * tAmt;
      if (t <= 1e-4) continue;
      const neut = (g0 + b0) * 0.5;
      const scale = 1 - 0.45 * t;
      const r = Math.round((r0 + (neut - r0) * t) * scale * 255);
      const g = Math.round(g0 * scale * 255);
      const b = Math.round(b0 * scale * 255);
      if (r === data[i] && g === data[i + 1] && b === data[i + 2]) continue;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      changed++;
    }
  }
  return changed;
}

// Non-separable blend helpers (PhotoCraft crates/color/src/blend.rs, W3C compositing): Rec. 601
// lum, SetLum + ClipColor toward grey, and SetSat on [r, g, b] in 0..1.
export function blendLum(c) {
  return 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
}

function clipColor(c) {
  const l = blendLum(c);
  const n = Math.min(c[0], c[1], c[2]);
  const x = Math.max(c[0], c[1], c[2]);
  let out = c;
  if (n < 0) {
    const d = l - n;
    out = out.map((v) => (l > 0 && d > 0 ? l + ((v - l) * l) / d : l));
  }
  if (x > 1) {
    const d = x - l;
    out = out.map((v) => (l < 1 && d > 0 ? l + ((v - l) * (1 - l)) / d : l));
  }
  return out;
}

export function setLum(c, l) {
  const d = l - blendLum(c);
  return clipColor([c[0] + d, c[1] + d, c[2] + d]);
}

function blendSat(c) {
  return Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);
}

export function setSat(c, s) {
  const [imin, imid, imax] = [0, 1, 2].sort((a, b) => c[a] - c[b]);
  const out = [0, 0, 0];
  if (c[imax] > c[imin]) {
    out[imid] = ((c[imid] - c[imin]) * s) / (c[imax] - c[imin]);
    out[imax] = s;
  }
  return out;
}

// B(cb, cs) for the Hue, Saturation, Color, and Luminosity blend modes (blend_rgb).
export function blendNonSeparable(mode, cb, cs) {
  if (mode === 'hue') return setLum(setSat(cs, blendSat(cb)), blendLum(cb));
  if (mode === 'saturation') return setLum(setSat(cb, blendSat(cs)), blendLum(cb));
  if (mode === 'luminosity') return setLum(cb, blendLum(cs));
  return setLum(cs, blendLum(cb));
}

// PhotoCraft blend.rs channel helpers for the separable modes, on 0..1 values.
function colorBurn(cb, cs) {
  return cb >= 1 ? 1 : cs <= 0 ? 0 : 1 - Math.min((1 - cb) / cs, 1);
}

function colorDodge(cb, cs) {
  return cb <= 0 ? 0 : cs >= 1 ? 1 : Math.min(cb / (1 - cs), 1);
}

function hardLight(cb, cs) {
  if (cs <= 0.5) return cb * 2 * cs;
  const s = 2 * cs - 1;
  return cb + s - cb * s;
}

function softLight(cb, cs) {
  if (cs <= 0.5) return 2 * cb * cs + cb * cb * (1 - 2 * cs);
  const b = Math.max(cb, 0);
  const d = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b);
  return 2 * cb * (1 - cs) + d * (2 * cs - 1);
}

// B(cb, cs) for one channel of a separable BLEND_MODES value (blend_channel); unknown modes
// (and 'source-over') return cs.
export function blendChannel(mode, cb, cs) {
  switch (mode) {
    case 'multiply':
      return cb * cs;
    case 'screen':
      return cb + cs - cb * cs;
    case 'overlay':
      return hardLight(cs, cb);
    case 'darken':
      return Math.min(cb, cs);
    case 'lighten':
      return Math.max(cb, cs);
    case 'color-dodge':
      return colorDodge(cb, cs);
    case 'color-burn':
      return colorBurn(cb, cs);
    case 'hard-light':
      return hardLight(cb, cs);
    case 'soft-light':
      return softLight(cb, cs);
    case 'difference':
      return Math.abs(cb - cs);
    case 'exclusion':
      return cb + cs - 2 * cb * cs;
    default:
      return cs;
  }
}

const NON_SEPARABLE = ['hue', 'saturation', 'color', 'luminosity'];

// B(cb, cs) on [r, g, b] in 0..1 for any BLEND_MODES value (PhotoCraft blend_rgb).
export function blendRgb(mode, cb, cs) {
  if (NON_SEPARABLE.includes(mode)) return blendNonSeparable(mode, cb, cs);
  return [0, 1, 2].map((i) => blendChannel(mode, cb[i], cs[i]));
}

// The [r, g, b] (0..1) of pre (RGBA bytes) at the pixel holding (x, y); black off the canvas.
export function samplePre(pre, W, H, x, y) {
  const px = Math.floor(x),
    py = Math.floor(y);
  if (px < 0 || py < 0 || px >= W || py >= H) return [0, 0, 0];
  const i = (py * W + px) * 4;
  return [pre[i] / 255, pre[i + 1] / 255, pre[i + 2] / 255];
}

// PhotoCraft keep_connected: zero the footprint weights (w × h, box [x0, y0, x1, y1)) that are
// not 4-connected through non-zero weights to the pixel under the dab centre (clamped into the
// box).
function keepConnected(weight, w, h, x0, y0, x1, y1, cx, cy) {
  const keep = new Uint8Array(w * h);
  const sx = Math.min(x1 - 1, Math.max(x0, Math.floor(cx)));
  const sy = Math.min(y1 - 1, Math.max(y0, Math.floor(cy)));
  const si = (sy - y0) * w + (sx - x0);
  if (weight[si] > 0) {
    const stack = [si];
    keep[si] = 1;
    const visit = (j) => {
      if (!keep[j] && weight[j] > 0) {
        keep[j] = 1;
        stack.push(j);
      }
    };
    while (stack.length) {
      const i = stack.pop();
      const x = i % w;
      if (x > 0) visit(i - 1);
      if (x + 1 < w) visit(i + 1);
      if (i >= w) visit(i - w);
      if (i + w < w * h) visit(i + w);
    }
  }
  for (let j = 0; j < w * h; j++) if (!keep[j]) weight[j] = 0;
}

// One Color Replacement dab (PhotoCraft replace.rs color_replacement_effect). work is the
// stroke's RGBA f32 working copy (0..1); pre is the pre-stroke RGBA bytes, which every dab
// matches against. sample is [r, g, b] (Once / Background Swatch) or null to sample pre under the
// dab centre (Continuous). A covered pixel's weight is 1 within tolerance (max per-channel RGB
// distance, 0..1), softened over the last quarter when antiAlias is on; contiguous keeps only the
// 4-connected region of the footprint holding the centre. The pixel then moves toward
// B(pixel, fg) by coverage × weight; alpha is kept and mask (0/1, or null) limits writes.
// Returns the touched box [x0, y0, x1, y1) or null.
export function colorReplaceDab(
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
  tolerance,
  antiAlias,
  contiguous,
  mask
) {
  const reach = tipReach(radius, hardness) + 0.5;
  const x0 = Math.max(0, Math.floor(cx - reach));
  const y0 = Math.max(0, Math.floor(cy - reach));
  const x1 = Math.min(W, Math.ceil(cx + reach));
  const y1 = Math.min(H, Math.ceil(cy + reach));
  if (x0 >= x1 || y0 >= y1) return null;
  const tol = Math.min(1, Math.max(0, tolerance));
  const soft = antiAlias && tol > 0;
  const s = sample ?? samplePre(pre, W, H, cx, cy);
  const w = x1 - x0,
    h = y1 - y0;
  const cov = new Float32Array(w * h);
  const weight = new Float32Array(w * h);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const j = (y - y0) * w + (x - x0);
      const c = dabCoverage(Math.hypot(x + 0.5 - cx, y + 0.5 - cy), radius, hardness);
      if (c <= 0) continue;
      cov[j] = c;
      const i = (y * W + x) * 4;
      if (pre[i + 3] <= 0) continue;
      const d = Math.max(
        Math.abs(pre[i] / 255 - s[0]),
        Math.abs(pre[i + 1] / 255 - s[1]),
        Math.abs(pre[i + 2] / 255 - s[2])
      );
      if (d > tol) continue;
      weight[j] = soft ? Math.min(1, Math.max(0, (tol - d) / (tol * 0.25))) : 1;
    }
  }
  if (contiguous) keepConnected(weight, w, h, x0, y0, x1, y1, cx, cy);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const p = y * W + x;
      if (mask && !mask[p]) continue;
      const j = (y - y0) * w + (x - x0);
      const k = cov[j] * weight[j];
      if (k <= 0) continue;
      const i = p * 4;
      const c = [work[i], work[i + 1], work[i + 2]];
      const b = blendNonSeparable(mode, c, fg);
      work[i] = c[0] + (b[0] - c[0]) * k;
      work[i + 1] = c[1] + (b[1] - c[1]) * k;
      work[i + 2] = c[2] + (b[2] - c[2]) * k;
    }
  }
  return [x0, y0, x1, y1];
}

// The Background Eraser hotspot (PhotoCraft bg_erase.rs): the [r, g, b] (0..1) of pre (RGBA
// bytes) at the pixel holding (x, y), or null where that pixel is transparent or off the canvas.
export function hotspotColor(pre, W, H, x, y) {
  const px = Math.floor(x),
    py = Math.floor(y);
  if (px < 0 || py < 0 || px >= W || py >= H) return null;
  const i = (py * W + px) * 4;
  if (pre[i + 3] <= 0) return null;
  return [pre[i] / 255, pre[i + 1] / 255, pre[i + 2] / 255];
}

// One Background Eraser dab (PhotoCraft bg_erase.rs background_eraser_effect). src is the
// pre-stroke RGBA bytes every dab samples and matches against; sample is the [r, g, b] (0..1) to
// erase, or null to skip the dab (a transparent hotspot). A covered, non-transparent pixel's weight
// is 0 past tolerance (max per-channel RGB distance, 0..1) or within tolerance of protect ([r, g,
// b], or null), softened over the last quarter of tolerance unless limits is 'findEdges'; 'contiguous'
// and 'findEdges' keep only the 4-connected region holding the centre. Coverage × weight builds up
// in the per-stroke cov (c ← c + k·(1 − c), PhotoCraft's a ← a·(1 − k) per dab), and dst alpha is
// rewritten as src_a · (1 − cov), so a stroke never erases a pixel past its coverage. Colour is
// kept; mask (0/1, or null) limits writes. Returns the touched box [x0, y0, x1, y1) or null.
export function backgroundEraseDab(
  dst,
  src,
  W,
  H,
  cx,
  cy,
  radius,
  hardness,
  sample,
  tolerance,
  limits,
  protect,
  mask,
  cov
) {
  if (!sample) return null;
  const reach = tipReach(radius, hardness) + 0.5;
  const x0 = Math.max(0, Math.floor(cx - reach));
  const y0 = Math.max(0, Math.floor(cy - reach));
  const x1 = Math.min(W, Math.ceil(cx + reach));
  const y1 = Math.min(H, Math.ceil(cy + reach));
  if (x0 >= x1 || y0 >= y1) return null;
  const tol = Number.isFinite(tolerance) ? Math.min(1, Math.max(0, tolerance)) : 0;
  const soft = limits !== 'findEdges' && tol > 0;
  const dist = (i, c) =>
    Math.max(
      Math.abs(src[i] / 255 - c[0]),
      Math.abs(src[i + 1] / 255 - c[1]),
      Math.abs(src[i + 2] / 255 - c[2])
    );
  const w = x1 - x0,
    h = y1 - y0;
  const fp = new Float32Array(w * h);
  const weight = new Float32Array(w * h);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const j = (y - y0) * w + (x - x0);
      const c = dabCoverage(Math.hypot(x + 0.5 - cx, y + 0.5 - cy), radius, hardness);
      if (c <= 0) continue;
      fp[j] = c;
      const i = (y * W + x) * 4;
      if (src[i + 3] <= 0) continue;
      if (protect && dist(i, protect) <= tol) continue;
      const d = dist(i, sample);
      if (d > tol) continue;
      weight[j] = soft ? Math.min(1, Math.max(0, (tol - d) / (tol * 0.25))) : 1;
    }
  }
  if (limits !== 'discontiguous') keepConnected(weight, w, h, x0, y0, x1, y1, cx, cy);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const p = y * W + x;
      if (mask && !mask[p]) continue;
      const k = Math.min(1, fp[(y - y0) * w + (x - x0)] * weight[(y - y0) * w + (x - x0)]);
      if (k <= 0) continue;
      cov[p] += k * (1 - cov[p]);
      dst[p * 4 + 3] = src[p * 4 + 3] * (1 - cov[p]);
    }
  }
  return [x0, y0, x1, y1];
}

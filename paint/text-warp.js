// Type › Warp Text… (PhotoCraft crates/geom/src/warp.rs StyleWarp, warp_text_dialog.rs). A type
// layer's warp is { style, bend, hDistort, vDistort, vertical }: one of Photoshop's fifteen
// presets, bend and the two distortions in percent (-100..100), and the orientation the bend
// runs along. Every preset is one bicubic Bezier patch over the text's bounds; warpField maps a
// point through it and warpImageData resamples drawn text through it.

const PI = Math.PI;

// The presets in Photoshop's menu order, as [id, label]; 'none' is no warp.
export const WARP_STYLES = [
  ['none', 'None'],
  ['arc', 'Arc'],
  ['arcLower', 'Arc Lower'],
  ['arcUpper', 'Arc Upper'],
  ['arch', 'Arch'],
  ['bulge', 'Bulge'],
  ['shellLower', 'Shell Lower'],
  ['shellUpper', 'Shell Upper'],
  ['flag', 'Flag'],
  ['wave', 'Wave'],
  ['fish', 'Fish'],
  ['rise', 'Rise'],
  ['fisheye', 'Fisheye'],
  ['inflate', 'Inflate'],
  ['squeeze', 'Squeeze'],
  ['twist', 'Twist']
];
const STYLE_IDS = WARP_STYLES.map(([id]) => id);

// The dialog's defaults for a newly chosen style (Photoshop opens a style at Bend +50).
export const WARP_DEFAULTS = Object.freeze({
  style: 'none',
  bend: 50,
  hDistort: 0,
  vDistort: 0,
  vertical: false
});

const pctValue = (v) => (Number.isFinite(v) ? Math.max(-100, Math.min(100, v)) : 0);

/** A complete warp record, or null for none (no style, or an unknown one). */
export function normalizeWarp(w) {
  if (!w || typeof w !== 'object' || !STYLE_IDS.includes(w.style) || w.style === 'none') {
    return null;
  }
  return {
    style: w.style,
    bend: pctValue(w.bend),
    hDistort: pctValue(w.hDistort),
    vDistort: pctValue(w.vDistort),
    vertical: w.vertical === true
  };
}

/** The rest grid (no warp): 4 rows of 4 control points in box units. */
function restGrid() {
  return [0, 1, 2, 3].map((j) => [0, 1, 2, 3].map((i) => [i / 3, j / 3]));
}

/**
 * A horizontal edge at height y bent into a circular arc of |b|·π that keeps its chord, bowing
 * up when up === (b > 0). h is the box's height over its width, so the arc is circular in px.
 */
function edgeArc(y, b, up, h) {
  if (Math.abs(b) < 1e-9) return [0, 1, 2, 3].map((i) => [i / 3, y]);
  const th = Math.abs(b) * PI;
  const k = ((4 / 3) * Math.tan(th / 4) * 0.5) / Math.sin(th / 2);
  const s = b > 0 === up ? -1 : 1;
  const c = Math.cos(th / 2);
  const n = Math.sin(th / 2);
  const dy = (s * k * n) / h;
  return [
    [0, y],
    [k * c, y + dy],
    [1 - k * c, y + dy],
    [1, y]
  ];
}

/**
 * Arc: every row is a circular arc of |b|·π around one centre; the edge on the inside of the
 * bend keeps its chord and the rows' radii grow by the box height towards the other edge.
 */
function arcGrid(b, h) {
  if (Math.abs(b) < 1e-9) return restGrid();
  const up = b > 0;
  const th = Math.abs(b) * PI;
  const r = 0.5 / Math.sin(th / 2);
  const k = (4 / 3) * Math.tan(th / 4);
  const s = up ? -1 : 1;
  const cy = up ? h + r * Math.cos(th / 2) : -r * Math.cos(th / 2);
  return [0, 1, 2, 3].map((j) => {
    const v = j / 3;
    const big = r + h * (up ? 1 - v : v);
    const at = (a) => [0.5 + big * Math.sin(a), cy + s * big * Math.cos(a)];
    const tangent = (a) => [Math.cos(a), -s * Math.sin(a)];
    const p0 = at(-th / 2);
    const p3 = at(th / 2);
    const t0 = tangent(-th / 2);
    const t1 = tangent(th / 2);
    const l = k * big;
    const pts = [p0, [p0[0] + l * t0[0], p0[1] + l * t0[1]], [p3[0] - l * t1[0], p3[1] - l * t1[1]], p3];
    return pts.map((p) => [p[0], p[1] / h]);
  });
}

/** Rows blended from top to bottom. */
function blendRows(top, bottom) {
  return [0, 1, 2, 3].map((j) => {
    const t = j / 3;
    return top.map((p, i) => [p[0] + (bottom[i][0] - p[0]) * t, p[1] + (bottom[i][1] - p[1]) * t]);
  });
}

const INNER = [
  [1, 1, -1, -1],
  [1, 2, 1, -1],
  [2, 1, -1, 1],
  [2, 2, 1, 1]
];

/**
 * PhotoCraft preset_grid: the style's 4 × 4 control grid in box units (y down). b, hd, vd are
 * -1..1; aspect is the box's height over its width.
 */
export function warpGrid(style, b, hd, vd, vertical, aspect) {
  const h = vertical ? 1 / aspect : aspect;
  if (vertical) [hd, vd] = [vd, hd];
  let g = restGrid();
  switch (style) {
    case 'arc':
      g = arcGrid(b, h);
      break;
    case 'arch':
      g = [0, 1, 2, 3].map((j) => edgeArc(j / 3, b, true, h));
      break;
    case 'bulge':
      g = blendRows(edgeArc(0, b, true, h), edgeArc(1, b, false, h));
      break;
    case 'arcLower':
      g = blendRows(g[0], edgeArc(1, b, false, h));
      break;
    case 'arcUpper':
      g = blendRows(edgeArc(0, b, true, h), g[3]);
      break;
    case 'shellLower': {
      const a = arcGrid(-b, h);
      g[3] = a[3];
      g[2][0] = a[2][0];
      g[2][3] = a[2][3];
      break;
    }
    case 'shellUpper': {
      const a = arcGrid(b, h);
      g[0] = a[0];
      g[1][0] = a[1][0];
      g[1][3] = a[1][3];
      break;
    }
    case 'flag':
      for (const row of g) {
        row[1][1] -= 2 * b;
        row[2][1] += 2 * b;
      }
      break;
    case 'wave':
      for (const row of g.slice(1, 3)) {
        row[1][1] += (4 / 3) * b;
        row[2][1] -= (4 / 3) * b;
      }
      break;
    case 'fish':
      [-2, -2 / 3, 2 / 3, 2].forEach((f, j) => {
        g[j][1][1] += f * b;
        g[j][2][1] -= f * b;
      });
      break;
    case 'rise':
      for (const row of g) {
        row[0][1] += 2 * b;
        row[1][1] += 2 * b;
      }
      break;
    case 'fisheye':
      for (const [j, i, dx, dy] of INNER) {
        g[j][i][0] += (dx * 2 * b) / 3;
        g[j][i][1] += (dy * 2 * b) / 3;
      }
      break;
    // Edge midpoints move out (Inflate) or the sides in (Squeeze) by b/3, the inner points by b/9.
    case 'inflate':
    case 'squeeze': {
      const s = style === 'inflate' ? 1 : -1;
      for (const p of g[0].slice(1, 3)) p[1] -= b / 3;
      for (const p of g[3].slice(1, 3)) p[1] += b / 3;
      for (const row of g.slice(1, 3)) {
        row[0][0] -= (s * b) / 3;
        row[3][0] += (s * b) / 3;
      }
      for (const [j, i, dx, dy] of INNER) {
        g[j][i][0] += (s * dx * b) / 9;
        g[j][i][1] += (dy * b) / 9;
      }
      break;
    }
    // The inner points turn round the centre (the other way for a negative bend).
    case 'twist': {
      const a = Math.abs(b);
      if (b >= 0) {
        g[1][1][0] += a;
        g[1][2][1] += a;
        g[2][1][1] -= a;
        g[2][2][0] -= a;
      } else {
        g[1][1][1] += a;
        g[1][2][0] -= a;
        g[2][1][0] += a;
        g[2][2][1] -= a;
      }
      break;
    }
  }
  // Vertical distortion: the top and bottom rows scale about their end points' midpoint (by
  // 1 ∓ vd) and the middle rows follow by the blend of those two moves.
  if (vd !== 0) {
    const moved = (row, s) => {
      const m = [(row[0][0] + row[3][0]) / 2, (row[0][1] + row[3][1]) / 2];
      return row.map((p) => [m[0] + (p[0] - m[0]) * s - p[0], m[1] + (p[1] - m[1]) * s - p[1]]);
    };
    const d0 = moved(g[0], 1 - vd);
    const d3 = moved(g[3], 1 + vd);
    g.forEach((row, j) => {
      const t = j / 3;
      row.forEach((p, i) => {
        p[0] += d0[i][0] + (d3[i][0] - d0[i][0]) * t;
        p[1] += d0[i][1] + (d3[i][1] - d0[i][1]) * t;
      });
    });
  }
  // Horizontal distortion: each column scales about its end points' midpoint by 1 + hd·(2i/3 − 1).
  if (hd !== 0) {
    for (let i = 0; i < 4; i++) {
      const s = 1 + hd * ((2 * i) / 3 - 1);
      const m = [(g[0][i][0] + g[3][i][0]) / 2, (g[0][i][1] + g[3][i][1]) / 2];
      for (const row of g) row[i] = [m[0] + (row[i][0] - m[0]) * s, m[1] + (row[i][1] - m[1]) * s];
    }
  }
  // Vertical orientation: the same grid with the axes swapped.
  if (vertical) g = [0, 1, 2, 3].map((j) => [0, 1, 2, 3].map((i) => [g[i][j][1], g[i][j][0]]));
  return g;
}

function bernstein(t) {
  const s = 1 - t;
  return [s * s * s, 3 * s * s * t, 3 * s * t * t, t * t * t];
}

/**
 * The warp over bounds ({ x, y, w, h }) as a point map (x, y) → [x, y], or null when it moves
 * nothing: no style, an empty box, or bend and both distortions at 0.
 */
export function warpField(warp, bounds) {
  const w = normalizeWarp(warp);
  if (!w || !bounds || !(bounds.w > 0 && bounds.h > 0)) return null;
  const b = w.bend / 100;
  const hd = w.hDistort / 100;
  const vd = w.vDistort / 100;
  if (b === 0 && hd === 0 && vd === 0) return null;
  const g = warpGrid(w.style, b, hd, vd, w.vertical, bounds.h / bounds.w);
  return (x, y) => {
    const bu = bernstein((x - bounds.x) / bounds.w);
    const bv = bernstein((y - bounds.y) / bounds.h);
    let px = 0;
    let py = 0;
    for (let j = 0; j < 4; j++) {
      for (let i = 0; i < 4; i++) {
        const k = bu[i] * bv[j];
        px += k * g[j][i][0];
        py += k * g[j][i][1];
      }
    }
    return [bounds.x + px * bounds.w, bounds.y + py * bounds.h];
  };
}

/** Bounds ({ x, y, w, h }) of the box mapped through field, from points along its edges. */
export function warpedBounds(field, bounds, steps = 16) {
  if (!field) return bounds;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let j = 0; j <= steps; j++) {
    for (let i = 0; i <= steps; i++) {
      if (j !== 0 && j !== steps && i !== 0 && i !== steps) continue;
      const [x, y] = field(bounds.x + (bounds.w * i) / steps, bounds.y + (bounds.h * j) / steps);
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// Bilinear RGBA sample of src (premultiplied while blending so clear pixels add no colour).
function sample(src, W, H, x, y, out, o) {
  const fx = x - 0.5;
  const fy = y - 0.5;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = fx - ix;
  const ty = fy - iy;
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  for (let dy = 0; dy < 2; dy++) {
    const yy = iy + dy;
    if (yy < 0 || yy >= H) continue;
    const wy = dy ? ty : 1 - ty;
    for (let dx = 0; dx < 2; dx++) {
      const xx = ix + dx;
      if (xx < 0 || xx >= W) continue;
      const k = wy * (dx ? tx : 1 - tx);
      if (!k) continue;
      const p = (yy * W + xx) * 4;
      const al = src[p + 3] * k;
      r += src[p] * al;
      g += src[p + 1] * al;
      b += src[p + 2] * al;
      a += al;
    }
  }
  if (a <= 0) return;
  out[o] = r / a;
  out[o + 1] = g / a;
  out[o + 2] = b / a;
  out[o + 3] = a;
}

/**
 * Drawn text (RGBA, W × H) resampled through field over bounds: the box is cut into steps ×
 * steps cells, each two triangles, and every destination pixel inside a warped triangle reads
 * the source at its barycentric pre-image. Pixels outside the warped box come out clear.
 * Returns a new Uint8ClampedArray.
 */
export function warpImageData(src, W, H, field, bounds, steps = 24) {
  if (!field) return new Uint8ClampedArray(src);
  const out = new Uint8ClampedArray(W * H * 4);
  const n = steps + 1;
  const sx = new Float64Array(n * n);
  const sy = new Float64Array(n * n);
  const dx = new Float64Array(n * n);
  const dy = new Float64Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      sx[k] = bounds.x + (bounds.w * i) / steps;
      sy[k] = bounds.y + (bounds.h * j) / steps;
      [dx[k], dy[k]] = field(sx[k], sy[k]);
    }
  }
  const tri = (a, b, c) => {
    const x0 = Math.max(0, Math.floor(Math.min(dx[a], dx[b], dx[c])));
    const x1 = Math.min(W - 1, Math.ceil(Math.max(dx[a], dx[b], dx[c])));
    const y0 = Math.max(0, Math.floor(Math.min(dy[a], dy[b], dy[c])));
    const y1 = Math.min(H - 1, Math.ceil(Math.max(dy[a], dy[b], dy[c])));
    const det = (dy[b] - dy[c]) * (dx[a] - dx[c]) + (dx[c] - dx[b]) * (dy[a] - dy[c]);
    if (Math.abs(det) < 1e-12) return;
    for (let y = y0; y <= y1; y++) {
      const py = y + 0.5;
      for (let x = x0; x <= x1; x++) {
        const o = (y * W + x) * 4;
        if (out[o + 3]) continue;
        const px = x + 0.5;
        const l0 = ((dy[b] - dy[c]) * (px - dx[c]) + (dx[c] - dx[b]) * (py - dy[c])) / det;
        const l1 = ((dy[c] - dy[a]) * (px - dx[c]) + (dx[a] - dx[c]) * (py - dy[c])) / det;
        const l2 = 1 - l0 - l1;
        if (l0 < -1e-9 || l1 < -1e-9 || l2 < -1e-9) continue;
        sample(src, W, H, l0 * sx[a] + l1 * sx[b] + l2 * sx[c], l0 * sy[a] + l1 * sy[b] + l2 * sy[c], out, o);
      }
    }
  };
  for (let j = 0; j < steps; j++) {
    for (let i = 0; i < steps; i++) {
      const k = j * n + i;
      tri(k, k + 1, k + n);
      tri(k + 1, k + n + 1, k + n);
    }
  }
  return out;
}

// Layer › Matting (PhotoCraft layer_menu_cmds.rs). Each op edits RGBA bytes in place and keeps
// alpha. A selection mask (0/1, index y * W + x) limits which pixels change; null is the layer.

import { distanceTo } from './layer-style.js';

const NEIGHBORS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1]
];

/**
 * Defringe: pixels within `width` of transparency take the average color of their neighbors
 * further inside, grown outward one pixel per round. Alpha is unchanged.
 */
export function applyDefringe(img, width, mask = null) {
  const { width: W, height: H, data } = img;
  const n = W * H;
  const outside = new Uint8Array(n);
  let any = false;
  for (let p = 0; p < n; p++) {
    // PhotoCraft treats alpha <= 0.01 as transparent.
    if (data[p * 4 + 3] <= 2) outside[p] = any = 1;
  }
  if (!any) return;
  const dist = distanceTo(outside, W, H);
  const known = new Uint8Array(n);
  let todo = [];
  for (let p = 0; p < n; p++) {
    if (outside[p]) continue;
    if (dist[p] > width) known[p] = 1;
    else if (!mask || mask[p]) todo.push(p);
  }
  while (todo.length) {
    const next = [];
    const updates = [];
    for (const p of todo) {
      const x = p % W,
        y = (p - x) / W;
      let r = 0,
        g = 0,
        b = 0,
        count = 0;
      for (const [dx, dy] of NEIGHBORS) {
        const nx = x + dx,
          ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const q = ny * W + nx;
        if (!known[q]) continue;
        r += data[q * 4];
        g += data[q * 4 + 1];
        b += data[q * 4 + 2];
        count++;
      }
      if (count) updates.push(p, r / count, g / count, b / count);
      else next.push(p);
    }
    // An isolated fringe with no core color nearby keeps its color.
    if (!updates.length) break;
    for (let i = 0; i < updates.length; i += 4) {
      const p = updates[i];
      data[p * 4] = Math.round(updates[i + 1]);
      data[p * 4 + 1] = Math.round(updates[i + 2]);
      data[p * 4 + 2] = Math.round(updates[i + 3]);
      known[p] = 1;
    }
    todo = next;
  }
}

/** Remove Black / White Matte: un-premultiply partly transparent colors composited over the matte. */
export function applyRemoveMatte(img, white, mask = null) {
  const { data } = img;
  for (let p = 0, i = 0; i < data.length; p++, i += 4) {
    const a = data[i + 3];
    if (a === 0 || a === 255 || (mask && !mask[p])) continue;
    const af = a / 255;
    for (let c = i; c < i + 3; c++) {
      data[c] = Math.round(white ? (data[c] - 255 * (1 - af)) / af : data[c] / af);
    }
  }
}

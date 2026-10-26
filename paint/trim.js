// Image › Trim… (PhotoCraft engine image_cmds.rs trim). Pure: the crop rectangle from the
// flattened composite; paint.js crops the stack to it.

export const TRIM_BASED_ON = [
  { value: 'transparent', label: 'Transparent Pixels' },
  { value: 'topLeft', label: 'Top Left Pixel Color' },
  { value: 'bottomRight', label: 'Bottom Right Pixel Color' }
];

export const TRIM_SIDES = ['top', 'bottom', 'left', 'right'];

// Premultiplied channels may differ by half a level (PhotoCraft compares f32 at 0.5 / 255).
const TOLERANCE = 0.5 / 255;

/**
 * The rectangle Trim crops to, or null when every pixel would be trimmed away.
 * @param {{ width: number, height: number, data: ArrayLike<number> }} composite RGBA bytes
 * @param {'transparent' | 'topLeft' | 'bottomRight'} basedOn
 * @param {{ top?: boolean, bottom?: boolean, left?: boolean, right?: boolean }} [sides]
 *   a side set to false keeps that canvas edge
 * @returns {{ x: number, y: number, w: number, h: number } | null}
 */
export function trimBounds(composite, basedOn = 'transparent', sides = {}) {
  const { width: W, height: H, data } = composite;
  if (!(W > 0 && H > 0)) return null;
  const refIndex = basedOn === 'topLeft' ? 0 : basedOn === 'bottomRight' ? (W * H - 1) * 4 : -1;
  const ref = [0, 0, 0, 0];
  if (refIndex >= 0) {
    const a = data[refIndex + 3] / 255;
    for (let c = 0; c < 3; c++) ref[c] = (data[refIndex + c] / 255) * a;
    ref[3] = a;
  }
  const differs = (i) => {
    const a = data[i + 3] / 255;
    if (refIndex < 0) return a > 0;
    // Premultiplied colour, then alpha (PhotoCraft also tests alpha once on its own).
    for (let c = 0; c < 3; c++) {
      if (Math.abs((data[i + c] / 255) * a - ref[c]) > TOLERANCE) return true;
    }
    return Math.abs(a * a - ref[3] * ref[3]) > TOLERANCE || Math.abs(a - ref[3]) > TOLERANCE;
  };
  let x0 = W,
    y0 = H,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!differs((y * W + x) * 4)) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  const on = (k) => sides[k] !== false;
  const left = on('left') ? x0 : 0;
  const top = on('top') ? y0 : 0;
  const right = on('right') ? x1 + 1 : W;
  const bottom = on('bottom') ? y1 + 1 : H;
  return { x: left, y: top, w: right - left, h: bottom - top };
}

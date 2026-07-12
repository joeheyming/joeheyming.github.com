/** @param {number} v @param {number} lo @param {number} hi */
export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/** @param {number} t */
export function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/** @param {number} t */
export function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Quadratic bezier.
 * @param {import('three').Vector3} out
 * @param {import('three').Vector3} a
 * @param {import('three').Vector3} b
 * @param {import('three').Vector3} c
 * @param {number} t
 */
export function bezier2(out, a, b, c, t) {
  const u = 1 - t;
  out.set(0, 0, 0);
  out.addScaledVector(a, u * u);
  out.addScaledVector(b, 2 * u * t);
  out.addScaledVector(c, t * t);
  return out;
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {number} r
 */
export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} x
 * @param {number} y
 * @param {number} maxWidth
 * @param {number} lineHeight
 */
export function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(/\s+/);
  let line = '';
  let yy = y;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, yy);
      line = word;
      yy += lineHeight;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, yy);
}

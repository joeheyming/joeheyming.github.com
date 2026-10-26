// Paint — Window › Clone Source: the sample transform for Clone Stamp and Healing Brush
// (PhotoCraft crates/engine/src/presets/clone_source.rs).
//
// state.clone = { source: {x, y} | null, offset: {dx, dy} | null, anchor: {x, y} | null,
// transform }. The transform maps the destination around the anchor (the pixel where the aligned
// stroke started) onto the source around the sample point: a 200 % W paints the source twice as
// wide, a 30° angle paints it turned 30° counter-clockwise on screen (Photoshop's sense).

export const DEFAULT_CLONE_TRANSFORM = Object.freeze({
  width: 100,
  height: 100,
  rotation: 0,
  flipH: false,
  flipV: false,
  linked: false
});

/** A clean transform from anything (a saved file, a partial record). */
export function cloneTransformOf(raw) {
  const t = { ...DEFAULT_CLONE_TRANSFORM };
  if (!raw || typeof raw !== 'object') return t;
  for (const k of ['width', 'height', 'rotation']) {
    const v = Number(raw[k]);
    if (Number.isFinite(v)) t[k] = v;
  }
  for (const k of ['flipH', 'flipV', 'linked']) t[k] = !!raw[k];
  return t;
}

/** True when the transform samples the source 1:1 (plain offset cloning). */
export function isIdentityTransform(t) {
  return (
    !t ||
    (Math.abs(t.width - 100) < 1e-9 &&
      Math.abs(t.height - 100) < 1e-9 &&
      Math.abs(((t.rotation % 360) + 360) % 360) < 1e-9 &&
      !t.flipH &&
      !t.flipV)
  );
}

/**
 * The panel's edit (cloneSource.set): W / H / rotation / flips / linked. With linked on, a new W
 * or H scales the other by the same factor. Returns a new transform.
 */
export function setCloneTransform(t, patch) {
  const out = cloneTransformOf({ ...t, ...patch });
  if (t.linked && patch.width != null && patch.height == null && t.width) {
    out.height = (t.height * out.width) / t.width;
  } else if (t.linked && patch.height != null && patch.width == null && t.height) {
    out.width = (t.width * out.height) / t.height;
  }
  return out;
}

/**
 * Row-major 2 × 2 matrix taking destination offsets to source offsets (transform_matrix): the
 * inverse of scale-then-rotate, rotation counter-clockwise on screen.
 */
export function cloneTransformMatrix(t) {
  const sx = Math.max(1e-3, t.width / 100) * (t.flipH ? -1 : 1);
  const sy = Math.max(1e-3, t.height / 100) * (t.flipV ? -1 : 1);
  const a = (-t.rotation * Math.PI) / 180;
  const s = Math.sin(a),
    c = Math.cos(a);
  const f = [c * sx, -s * sy, s * sx, c * sy];
  const det = f[0] * f[3] - f[1] * f[2];
  return [f[3] / det, -f[1] / det, -f[2] / det, f[0] / det];
}

/**
 * The source pixel index (y * W + x) destination pixel (x, y) samples, or −1 off the canvas.
 * anchor is the stroke's anchor pixel, off the whole-pixel offset source − anchor. Pixel centres
 * map through the matrix, nearest neighbour; the identity transform reads (x + dx, y + dy).
 */
export function cloneSampler(anchor, off, t, W, H) {
  const m = cloneTransformMatrix(t);
  const ax = anchor.x + 0.5,
    ay = anchor.y + 0.5;
  const srcX = ax + off.dx,
    srcY = ay + off.dy;
  return (x, y) => {
    const dx = x + 0.5 - ax,
      dy = y + 0.5 - ay;
    const sx = Math.floor(srcX + m[0] * dx + m[1] * dy + 1e-9);
    const sy = Math.floor(srcY + m[2] * dx + m[3] * dy + 1e-9);
    return sx < 0 || sx >= W || sy < 0 || sy >= H ? -1 : sy * W + sx;
  };
}

/** The panel's Offset X / Y: source − anchor once an aligned stroke paired them, else null. */
export function cloneSourceOffset(clone) {
  return clone?.source && clone.offset ? { x: clone.offset.dx, y: clone.offset.dy } : null;
}

/**
 * The panel's Offset X / Y edit: a new offset for the paired stroke, moving the sample point to
 * anchor + offset. Does nothing until an aligned stroke has paired them.
 */
export function setCloneOffset(clone, dx, dy) {
  if (!clone?.source || !clone.offset || !clone.anchor) return false;
  clone.offset = { dx: Math.round(dx), dy: Math.round(dy) };
  clone.source = { x: clone.anchor.x + clone.offset.dx, y: clone.anchor.y + clone.offset.dy };
  return true;
}

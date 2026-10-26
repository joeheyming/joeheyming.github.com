// Paint — rulers and guides (PhotoCraft crates/ui-egui/src/rulers.rs, engine guide_layout.rs and
// edit_cmds.rs guide_cmd).
//
// Guides are document data: { vertical: [x…], horizontal: [y…] } in document pixels. A guide
// list is never mutated; every edit returns a new object, so undo entries and .paintproj can keep
// the object itself. Everything here is pure.

// PhotoCraft guide_layout.rs MAX_COUNT.
const MAX_COUNT = 1000;
// The ruler strip, in CSS pixels (rulers.rs RULER).
export const RULER_SIZE = 16;
// Labelled ruler ticks sit at least this far apart on screen (rulers.rs tick_step).
const MIN_LABEL_GAP = 60;

export function emptyGuides() {
  return { vertical: [], horizontal: [] };
}

const finiteList = (a) => (Array.isArray(a) ? a.filter((v) => Number.isFinite(v)) : []);

/** Guides as saved in .paintproj; older files (or junk) load as none. */
export function normalizeGuides(g) {
  return { vertical: finiteList(g?.vertical), horizontal: finiteList(g?.horizontal) };
}

export function hasGuides(g) {
  return !!g && (g.vertical.length > 0 || g.horizontal.length > 0);
}

const axisKey = (vertical) => (vertical ? 'vertical' : 'horizontal');

/** View › New Guide: a guide at `pos` (x for a vertical guide, y for a horizontal one). */
export function addGuide(g, vertical, pos) {
  const k = axisKey(vertical);
  return { ...g, [k]: [...g[k], pos] };
}

export function moveGuide(g, vertical, index, pos) {
  const k = axisKey(vertical);
  return { ...g, [k]: g[k].map((v, i) => (i === index ? pos : v)) };
}

export function deleteGuide(g, vertical, index) {
  const k = axisKey(vertical);
  return { ...g, [k]: g[k].filter((_, i) => i !== index) };
}

/**
 * The guide nearest document point (x, y) within `tol` document pixels, as
 * { vertical, index }, or null.
 */
export function guideAt(g, x, y, tol) {
  let best = null;
  let bestD = tol;
  for (const vertical of [true, false]) {
    const at = vertical ? x : y;
    g[axisKey(vertical)].forEach((v, index) => {
      const d = Math.abs(v - at);
      if (d <= bestD) {
        bestD = d;
        best = { vertical, index };
      }
    });
  }
  return best;
}

/**
 * Letting go of a guide drag (rulers.rs finish_drag). `drag` is { vertical, index (null for a
 * guide coming out of a ruler), pos, press, overRuler }. A drop off the document or on a ruler
 * deletes an existing guide and discards a new one; a drag that never moved is a click.
 * Returns { guides, label } for the history row, or null when nothing changes.
 */
export function finishGuideDrag(g, drag, W, H, zoom = 1) {
  const { vertical, index, overRuler } = drag;
  const existing = index != null;
  if (existing && !overRuler && Math.abs(drag.pos - drag.press) * Math.max(zoom, 0.01) < 0.5) {
    return null;
  }
  const extent = vertical ? W : H;
  const inside = !overRuler && drag.pos >= 0 && drag.pos <= extent;
  const pos = Math.round(drag.pos * 1000) / 1000;
  if (!existing) return inside ? { guides: addGuide(g, vertical, pos), label: 'New Guide' } : null;
  if (inside) return { guides: moveGuide(g, vertical, index, pos), label: 'Move Guide' };
  return { guides: deleteGuide(g, vertical, index), label: 'Delete Guide' };
}

/** The New Guide dialog's position: a number of pixels, or a percent of the side ("50%"). */
export function guidePosition(text, vertical, W, H) {
  const m = /^\s*(-?\d*\.?\d+)\s*(px|%)?\s*$/i.exec(String(text));
  if (!m) return null;
  const v = Number(m[1]);
  return m[2] === '%' ? (v / 100) * (vertical ? W : H) : v;
}

// guide_layout.rs push_unique: guides 0.01 px apart are the same guide.
function pushUnique(out, v) {
  if (!Number.isFinite(v)) throw new Error('guide coordinates exceed the supported range');
  if (!out.some((x) => Math.abs(x - v) < 0.01)) out.push(v);
}

// guide_layout.rs axis: both edges of every column; a fixed width packs from `start` (or centres).
function layoutAxis(start, end, count, fixed, gap, center, out) {
  if (count === 0) return;
  const available = end - start;
  const width = fixed > 0 ? fixed : (available - (count - 1) * gap) / count;
  const total = count * width + (count - 1) * gap;
  if (width <= 0 || !Number.isFinite(total) || total > available + 0.001) {
    throw new Error('count, size and gutter must fit inside the target margins');
  }
  const origin = center && fixed > 0 ? start + (available - total) / 2 : start;
  for (let i = 0; i < count; i++) {
    const a = origin + i * (width + gap);
    pushUnique(out, a);
    pushUnique(out, a + width);
  }
}

function layoutCount(v, key) {
  const n = v ?? 0;
  if (!Number.isInteger(n) || n < 0) throw new Error(`${key} must be a whole number`);
  if (n > MAX_COUNT) throw new Error(`${key} must be ${MAX_COUNT} or fewer (got ${n})`);
  return n;
}

function layoutLength(v, key) {
  const n = v ?? 0;
  if (!Number.isFinite(n) || n < 0) throw new Error(`${key} must be a finite non-negative length`);
  return n;
}

/**
 * View › New Guide Layout… on a W × H document (guide_layout.rs calculate). `p` is
 * { columns, width, gutter, rows, height, rowGutter (defaults to gutter), margin (a number or
 * [top, left, bottom, right]), centerColumns, clearExisting }, lengths in pixels. Returns
 * { added, guides }: the new lines and the guide set OK commits. Throws on a layout that does
 * not fit.
 */
export function guideLayout(g, W, H, p) {
  const cols = layoutCount(p.columns, 'columns');
  const rows = layoutCount(p.rows, 'rows');
  const width = layoutLength(p.width, 'width');
  const height = layoutLength(p.height, 'height');
  const gap = layoutLength(p.gutter, 'gutter');
  const rowGap = layoutLength(p.rowGutter ?? p.gutter, 'rowGutter');
  const m = Array.isArray(p.margin) ? p.margin : [p.margin, p.margin, p.margin, p.margin];
  if (m.length !== 4) throw new Error('margin must contain top, left, bottom and right');
  const [top, left, bottom, right] = m.map((v) => layoutLength(v, 'margin'));
  const [x0, y0, x1, y1] = [left, top, W - right, H - bottom];
  if (x0 >= x1 || y0 >= y1) throw new Error('margins must leave space inside the target');
  const added = emptyGuides();
  if (top || left || bottom || right) {
    pushUnique(added.vertical, x0);
    pushUnique(added.vertical, x1);
    pushUnique(added.horizontal, y0);
    pushUnique(added.horizontal, y1);
  }
  layoutAxis(x0, x1, cols, width, gap, !!p.centerColumns, added.vertical);
  layoutAxis(y0, y1, rows, height, rowGap, !!p.centerColumns, added.horizontal);
  if (!added.vertical.length && !added.horizontal.length) {
    throw new Error('give columns, rows or a margin');
  }
  const guides = p.clearExisting
    ? emptyGuides()
    : { vertical: g.vertical.slice(), horizontal: g.horizontal.slice() };
  for (const x of added.vertical) pushUnique(guides.vertical, x);
  for (const y of added.horizontal) pushUnique(guides.horizontal, y);
  return { added, guides };
}

/** Ruler step in document pixels so labels are at least `min` pixels apart: 1, 2, 5, 10, 20… */
export function niceStep(min) {
  let step = 1;
  for (;;) {
    for (const m of [1, 2, 5]) if (step * m >= min) return step * m;
    step *= 10;
  }
}

/** Labelled-tick spacing (document pixels) at `zoom`: at least 60 screen pixels apart. */
export function rulerStep(zoom) {
  return niceStep(MIN_LABEL_GAP / Math.max(zoom, 1e-4));
}

/**
 * Ticks for a ruler `length` CSS pixels long whose document 0 sits at screen `origin`, with
 * `scale` screen pixels per document pixel (negative on a flipped view). Each labelled step has
 * nine minor ticks, the middle one longer (rulers.rs paint). Returns [{ at, value, len, label }]:
 * `at` in ruler pixels, `value` in document pixels, `label` the distance from 0 or null.
 */
export function rulerTicks(origin, scale, length) {
  const step = rulerStep(Math.abs(scale));
  const a = (0 - origin) / scale,
    b = (length - origin) / scale;
  const u0 = Math.min(a, b),
    u1 = Math.max(a, b);
  const ticks = [];
  for (let v = Math.floor(u0 / step) * step; v <= u1; v += step) {
    for (let k = 0; k < 10; k++) {
      const value = v + (step * k) / 10;
      const at = origin + value * scale;
      if (at < 0 || at > length) continue;
      ticks.push({
        at,
        value,
        len: k === 0 ? RULER_SIZE : k === 5 ? 6 : 3,
        label: k === 0 ? String(Math.round(Math.abs(v))) : null
      });
    }
  }
  return ticks;
}

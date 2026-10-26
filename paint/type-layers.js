// Type layers (PhotoCraft doc TextLayer, point text). A type layer is a layer record with kind
// 'type' and layer.type = { text, family, size, color, x, y, align, bold, italic, antialias,
// orientation, box, leading, tracking, fauxBold, fauxItalic, indentLeft, indentRight, indentFirst,
// spaceBefore, spaceAfter }:
//   text    the characters, lines split on '\n'
//   family  a CSS font family; size is in document pixels
//   x, y    the anchor. Horizontal: the first line's baseline at y, aligned to x by align (left /
//           center / right, as Photoshop's point text). Vertical: the first column's centre at x,
//           its glyphs stacked down from y (align reads top / middle / bottom); later lines are
//           columns to the left (tategaki, right to left).
//   antialias  TYPE_ANTIALIAS (Type › Anti-Alias); orientation 'horizontal' or 'vertical'
//   box     null for point text; { w, h } for paragraph text, whose x, y are then the box's
//           top-left and whose lines wrap to the box (wrapLines). Horizontal only.
//   leading line spacing in px (0 is Auto, 120% of size); tracking in 1/1000 em per glyph
//   fauxBold, fauxItalic  the Character panel's synthesized bold (an outline) and slant
//   indent*, space*  the Paragraph panel, in px; paragraph text only
//   warp    null, or Type › Warp Text's { style, bend, hDistort, vDistort, vertical } (text-warp.js)
// The layer's canvas is always drawn from the record with fillText, so the text stays editable
// until Type › Rasterize Type Layer (or Layer › Rasterize › Type) makes it a pixel layer.

import { isPixelSafeTool } from './layer-groups.js';
import { createLayer } from './layer-shell.js';
import { normalizeWarp, warpField, warpImageData, warpedBounds } from './text-warp.js';

export const TYPE_KIND = 'type';

// Justify is Photoshop's Justify Last Left: paragraph lines stretch to the box, the last stays left.
export const TYPE_ALIGNS = ['left', 'center', 'right', 'justify'];

// Auto leading is 120% of the size; ascent and descent are the usual 0.8 / 0.2 split.
export const TYPE_LEADING = 1.2;
const ASCENT = 0.8;
const DESCENT = 0.2;

export const TYPE_DEFAULTS = Object.freeze({
  text: '',
  family: 'sans-serif',
  size: 16,
  color: '#000000',
  x: 0,
  y: 0,
  align: 'left',
  bold: false,
  italic: false,
  antialias: 'smooth',
  orientation: 'horizontal',
  box: null,
  leading: 0,
  tracking: 0,
  fauxBold: false,
  fauxItalic: false,
  indentLeft: 0,
  indentRight: 0,
  indentFirst: 0,
  spaceBefore: 0,
  spaceAfter: 0,
  warp: null
});

// The Character panel's numeric fields and the Paragraph panel's, as record keys.
export const CHARACTER_KEYS = ['family', 'size', 'leading', 'tracking', 'color'];
export const PARAGRAPH_KEYS = ['indentLeft', 'indentRight', 'indentFirst', 'spaceBefore', 'spaceAfter'];

// Faux Italic slants by this much (x shift per px above the baseline); Faux Bold strokes the
// glyphs with this fraction of the size.
export const FAUX_ITALIC_SKEW = 0.2;
export const FAUX_BOLD_WIDTH = 0.04;

// Type › Anti-Alias (PhotoCraft doc AntiAlias; Windows and Windows LCD are not offered here).
export const TYPE_ANTIALIAS = ['none', 'sharp', 'crisp', 'strong', 'smooth'];
export const TYPE_ORIENTATIONS = ['horizontal', 'vertical'];

// PhotoCraft type_extra_cmds.rs LOREM_IPSUM, Photoshop's Paste Lorem Ipsum filler.
export const LOREM_IPSUM =
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut ' +
  'labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco ' +
  'laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in ' +
  'voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat ' +
  'cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.';

// PhotoCraft rasterize_prompt.rs Kind::Type message.
export const RASTERIZE_TYPE_MESSAGE =
  'This type layer must be rasterized before proceeding. Its text will no longer be editable. ' +
  'Rasterize the type?';

export function isTypeLayer(layer) {
  return layer?.kind === TYPE_KIND && !!layer.type;
}

const finite = (v, d) => (Number.isFinite(v) ? v : d);

function normalizeBox(b) {
  if (!b || typeof b !== 'object' || !Number.isFinite(b.w) || !Number.isFinite(b.h)) return null;
  return { w: Math.max(1, b.w), h: Math.max(1, b.h) };
}

/** A complete type record from a partial (or saved) one; unknown values fall back to defaults. */
export function normalizeType(t = {}) {
  return {
    text: typeof t.text === 'string' ? t.text : TYPE_DEFAULTS.text,
    family: typeof t.family === 'string' && t.family ? t.family : TYPE_DEFAULTS.family,
    size: Math.max(1, finite(t.size, TYPE_DEFAULTS.size)),
    color: /^#[0-9a-f]{6}$/i.test(t.color ?? '') ? t.color.toLowerCase() : TYPE_DEFAULTS.color,
    x: finite(t.x, TYPE_DEFAULTS.x),
    y: finite(t.y, TYPE_DEFAULTS.y),
    align: TYPE_ALIGNS.includes(t.align) ? t.align : TYPE_DEFAULTS.align,
    bold: t.bold === true,
    italic: t.italic === true,
    antialias: TYPE_ANTIALIAS.includes(t.antialias) ? t.antialias : TYPE_DEFAULTS.antialias,
    orientation: t.orientation === 'vertical' ? 'vertical' : 'horizontal',
    box: t.orientation === 'vertical' ? null : normalizeBox(t.box),
    leading: Math.max(0, finite(t.leading, 0)),
    tracking: finite(t.tracking, 0),
    fauxBold: t.fauxBold === true,
    fauxItalic: t.fauxItalic === true,
    indentLeft: finite(t.indentLeft, 0),
    indentRight: finite(t.indentRight, 0),
    indentFirst: finite(t.indentFirst, 0),
    spaceBefore: finite(t.spaceBefore, 0),
    spaceAfter: finite(t.spaceAfter, 0),
    warp: normalizeWarp(t.warp)
  };
}

/** Line spacing in px: the record's leading, or Auto (120% of the size). */
export function typeLineHeight(t) {
  return t.leading > 0 ? t.leading : t.size * TYPE_LEADING;
}

/** Tracking in px added after each glyph. */
export function typeTrackPx(t) {
  return ((t.tracking || 0) * t.size) / 1000;
}

/**
 * PhotoCraft render.rs shape_antialias_coverage: raw coverage (0..1) to the opacity an
 * anti-alias mode gives. None thresholds at 50%; exponents above 1 thin the fringe (Sharp,
 * Crisp), below 1 widen it (Strong); Smooth is the coverage itself.
 */
export function antialiasCoverage(cv, mode) {
  if (!Number.isFinite(cv)) return 0;
  const c = Math.min(1, Math.max(0, cv));
  switch (mode) {
    case 'none':
      return c >= 0.5 ? 1 : 0;
    case 'strong':
      return Math.pow(c, 0.55);
    case 'crisp':
      return Math.pow(c, 1.35);
    case 'sharp':
      return Math.pow(c, 2.2);
    default:
      return c;
  }
}

/** Remap the alpha of drawn text (ImageData-like, in place) through antialiasCoverage. */
export function applyTypeAntialias(img, mode) {
  if (!TYPE_ANTIALIAS.includes(mode) || mode === 'smooth') return img;
  const lut = new Uint8ClampedArray(256);
  for (let a = 0; a < 256; a++) lut[a] = Math.round(antialiasCoverage(a / 255, mode) * 255);
  const d = img.data;
  for (let i = 3; i < d.length; i += 4) d[i] = lut[d[i]];
  return img;
}

/** The record with another anti-alias mode (Type › Anti-Alias). */
export function withAntialias(t, mode) {
  return normalizeType({ ...t, antialias: mode });
}

/** The record with another warp (Type › Warp Text…); null or style 'none' removes it. */
export function withWarp(t, warp) {
  return normalizeType({ ...t, warp });
}

/** The text's warp as a point map over its unwarped bounds, or null when it has none. */
export function typeWarpField(t, measure = measureTypeText) {
  if (!t.warp) return null;
  return warpField(t.warp, typeBounds(t, measure));
}

/** The text's bounds after its warp ({ x, y, w, h }), or null when it has no characters. */
export function warpedTypeBounds(t, measure = measureTypeText) {
  const b = typeBounds(t, measure);
  return b && warpedBounds(t.warp ? warpField(t.warp, b) : null, b);
}

/**
 * The Type Mask tools' result (PhotoCraft type.createSelection): drawn text's alpha (RGBA,
 * W × H) as a 0/1 selection mask, set where the glyphs are at least half covered.
 */
export function typeSelectionMask(rgba, W, H) {
  const mask = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p++) mask[p] = rgba[p * 4 + 3] >= 128 ? 1 : 0;
  return mask;
}

/** The record with another orientation (Type › Orientation); the anchor stays put. */
export function withOrientation(t, orientation) {
  return normalizeType({ ...t, orientation });
}

/** Characters of a line as glyphs (code points, so surrogate pairs stay whole). */
const glyphsOf = (line) => Array.from(line);

/**
 * Vertical glyph positions in document pixels: [{ text, x, y }] with x the column's centre and
 * y the glyph's baseline. Each glyph advances one em down; each line is a column one leading
 * to the left of the last.
 */
export function verticalGlyphs(t) {
  const out = [];
  t.text.split('\n').forEach((line, i) => {
    const glyphs = glyphsOf(line);
    const len = glyphs.length * t.size;
    const top =
      t.align === 'center' ? t.y - len / 2 : t.align === 'right' ? t.y - len : t.y;
    const x = t.x - i * typeLineHeight(t);
    glyphs.forEach((ch, j) => {
      out.push({ text: ch, x, y: top + j * t.size + t.size * ASCENT });
    });
  });
  return out;
}

/**
 * One paragraph's lines: words fill a line while measure(line) stays within widthAt(i) for the
 * i-th line; a word wider than a whole line breaks between glyphs. A space at a break is dropped.
 */
function wrapParagraph(para, widthAt, measure) {
  const out = [];
  let line = '';
  const push = () => {
    out.push(line);
    line = '';
  };
  for (const word of para.split(' ')) {
    const next = line ? line + ' ' + word : word;
    if (measure(next) <= widthAt(out.length)) {
      line = next;
      continue;
    }
    if (line) push();
    if (measure(word) <= widthAt(out.length)) {
      line = word;
      continue;
    }
    for (const g of glyphsOf(word)) {
      if (line && measure(line + g) > widthAt(out.length)) push();
      line += g;
    }
  }
  out.push(line);
  return out;
}

/**
 * Paragraph text's wrap: text broken into lines no wider than width, measure(text) → px. Hard
 * breaks ('\n') are kept, words stay whole unless one alone is wider than the line.
 */
export function wrapLines(text, width, measure) {
  return String(text)
    .split('\n')
    .flatMap((para) => wrapParagraph(para, () => width, measure));
}

/**
 * Justify: the extra px each space in line gets so the line spans width. 0 when it has no
 * space or already fills the width.
 */
export function justifyGap(line, width, measure) {
  const spaces = glyphsOf(line).filter((g) => g === ' ').length;
  if (!spaces) return 0;
  return Math.max(0, (width - measure(line)) / spaces);
}

/** Break text into lines no wider than width, as one string (wrapLines with a font measurer). */
export function wrapTypeText(text, font, width, measure = measureTypeText) {
  return wrapLines(text, width, (s) => measure(font, s)).join('\n');
}

/**
 * Type › Paste Lorem Ipsum with no type layer to paste into (PhotoCraft paste_lorem): a new
 * record filling the middle 80% of a W × H canvas, its size H / 20 clamped to 6..72, the filler
 * wrapped to the box. opts carries the type options (family, color, bold…).
 */
export function loremTypeRecord(W, H, opts = {}, measure = measureTypeText) {
  const size = Math.min(72, Math.max(6, Math.round(H / 20)));
  const base = normalizeType({ ...opts, size, align: 'left', orientation: 'horizontal' });
  const text = wrapTypeText(LOREM_IPSUM, typeFont(base), W * 0.8, measure);
  return { ...base, text, x: W * 0.1, y: H * 0.1 + size * ASCENT };
}

/** The filler pasted into text at a character index (end of text by default). */
export function insertLorem(text, at = text.length) {
  const i = Math.max(0, Math.min(text.length, at));
  return text.slice(0, i) + LOREM_IPSUM + text.slice(i);
}

/** The CSS font shorthand the canvas draws with. */
export function typeFont(t) {
  return `${t.italic ? 'italic ' : ''}${t.bold ? 'bold ' : ''}${t.size}px ${t.family}`;
}

/** Photoshop names a new type layer after its text. */
export function typeLayerName(text) {
  const first = String(text ?? '')
    .split('\n')
    .map((l) => l.trim())
    .find(Boolean);
  return first ? first.slice(0, 30) : 'Layer';
}

/**
 * The default measurer: width of `text` in `font`, from a scratch canvas when one can measure,
 * else a 0.6 em per character estimate.
 */
let scratch = null;
export function measureTypeText(font, text) {
  if (scratch === null) {
    scratch = globalThis.document?.createElement?.('canvas')?.getContext?.('2d') ?? false;
  }
  if (scratch && typeof scratch.measureText === 'function') {
    scratch.font = font;
    return scratch.measureText(text).width;
  }
  const size = parseFloat(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? '16');
  return text.length * size * 0.6;
}

/** A line's width with tracking: measure(font, text) plus the tracking after each glyph. */
function trackedWidth(t, font, line, measure) {
  return line ? measure(font, line) + glyphsOf(line).length * typeTrackPx(t) : 0;
}

/**
 * Paragraph text's lines (t.box set): [{ text, x, y, width, gap }] wrapped to the box less the
 * indents (the first line of each paragraph also less indentFirst), aligned in that width, with
 * space before / after between paragraphs. gap is Justify's extra px per space (0 on a
 * paragraph's last line). Lines past the box's bottom are left out, as Photoshop hides overflow.
 */
export function paragraphLayout(t, measure = measureTypeText) {
  const font = typeFont(t);
  const box = t.box;
  const lh = typeLineHeight(t);
  const m = (s) => trackedWidth(t, font, s, measure);
  const out = [];
  let y = t.y + t.size * ASCENT;
  t.text.split('\n').forEach((para, p) => {
    if (p > 0) y += t.spaceAfter + t.spaceBefore;
    const widthAt = (i) => box.w - t.indentLeft - t.indentRight - (i === 0 ? t.indentFirst : 0);
    const lines = wrapParagraph(para, widthAt, m);
    lines.forEach((line, i) => {
      const left = t.x + t.indentLeft + (i === 0 ? t.indentFirst : 0);
      const inner = widthAt(i);
      const width = m(line);
      const slack = inner - width;
      const x = t.align === 'center' ? left + slack / 2 : t.align === 'right' ? left + slack : left;
      const last = i === lines.length - 1;
      const gap = t.align === 'justify' && !last ? justifyGap(line, inner, m) : 0;
      out.push({ text: line, x, y, width: gap ? inner : width, gap });
      y += lh;
    });
  });
  return out.filter((l) => l.y + t.size * DESCENT <= t.y + box.h + 0.5);
}

/**
 * Line boxes in document pixels: [{ text, x, y, width, gap }], x the line's left edge, y its
 * baseline. measure(font, text) → width.
 */
export function typeLayout(t, measure = measureTypeText) {
  if (t.box) return paragraphLayout(t, measure);
  const font = typeFont(t);
  return t.text.split('\n').map((line, i) => {
    const width = trackedWidth(t, font, line, measure);
    const x = t.align === 'center' ? t.x - width / 2 : t.align === 'right' ? t.x - width : t.x;
    return { text: line, x, y: t.y + i * typeLineHeight(t), width, gap: 0 };
  });
}

/**
 * Type › Convert to Paragraph Text: point text becomes paragraph text in a box around its
 * current bounds, so the lines land where they were. Vertical or paragraph text is unchanged.
 */
export function toParagraphText(t, measure = measureTypeText) {
  if (t.box || t.orientation === 'vertical') return t;
  const b = typeBounds(t, measure);
  if (!b) return t;
  return normalizeType({
    ...t,
    x: b.x,
    y: b.y,
    box: { w: Math.ceil(b.w), h: Math.ceil(b.h) }
  });
}

/**
 * Type › Convert to Point Text: each wrapped line of paragraph text ends in a hard break, the
 * box goes, and the anchor sits on the first line's baseline at the aligned edge.
 */
export function toPointText(t, measure = measureTypeText) {
  if (!t.box) return t;
  const lines = paragraphLayout({ ...t, box: { w: t.box.w, h: Infinity } }, measure);
  const left = t.x + t.indentLeft;
  const right = t.x + t.box.w - t.indentRight;
  const align = t.align === 'justify' ? 'left' : t.align;
  const x = align === 'center' ? (left + right) / 2 : align === 'right' ? right : left;
  return normalizeType({
    ...t,
    text: lines.map((l) => l.text).join('\n'),
    x,
    y: lines[0]?.y ?? t.y + t.size * ASCENT,
    align,
    box: null
  });
}

/** The Type tool's drag: a paragraph box { x, y, w, h } from corner to corner, or null for a click. */
export function paragraphBoxFromDrag(x0, y0, x1, y1, min = 4) {
  const w = Math.abs(x1 - x0);
  const h = Math.abs(y1 - y0);
  if (w < min || h < min) return null;
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), w, h };
}

/** The text's bounds in document pixels ({ x, y, w, h }), or null when it has no characters. */
export function typeBounds(t, measure = measureTypeText) {
  if (!t.text.trim()) return null;
  if (t.box) return { x: t.x, y: t.y, w: t.box.w, h: t.box.h };
  if (t.orientation === 'vertical') {
    const glyphs = verticalGlyphs(t);
    const xs = glyphs.map((g) => g.x);
    const ys = glyphs.map((g) => g.y);
    const x0 = Math.min(...xs) - t.size / 2;
    const y0 = Math.min(...ys) - t.size * ASCENT;
    return {
      x: x0,
      y: y0,
      w: Math.max(...xs) + t.size / 2 - x0,
      h: Math.max(...ys) + t.size * DESCENT - y0
    };
  }
  const lines = typeLayout(t, measure);
  const x0 = Math.min(...lines.map((l) => l.x));
  const x1 = Math.max(...lines.map((l) => l.x + l.width));
  const top = t.y - t.size * ASCENT;
  const bottom = lines[lines.length - 1].y + t.size * DESCENT;
  return { x: x0, y: top, w: x1 - x0, h: bottom - top };
}

/**
 * The Type tool's click: the index of the topmost visible type layer whose text bounds hold
 * (x, y), so clicking existing text edits it again; -1 starts a new type layer.
 */
export function typeLayerAt(layers, x, y, measure = measureTypeText) {
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i];
    if (!isTypeLayer(l) || l.visible === false) continue;
    const b = warpedTypeBounds(l.type, measure);
    if (b && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return i;
  }
  return -1;
}

/** One run of text at (x, y) with fillText, slanted for Faux Italic and outlined for Faux Bold. */
function drawGlyphs(ctx, t, text, x, y) {
  let gx = x;
  let gy = y;
  if (t.fauxItalic) {
    ctx.save?.();
    ctx.translate?.(x, y);
    ctx.transform?.(1, 0, -FAUX_ITALIC_SKEW, 1, 0, 0);
    gx = 0;
    gy = 0;
  }
  ctx.fillText(text, gx, gy);
  if (t.fauxBold && ctx.strokeText) {
    ctx.strokeStyle = t.color;
    ctx.lineWidth = t.size * FAUX_BOLD_WIDTH;
    ctx.lineJoin = 'round';
    ctx.strokeText(text, gx, gy);
  }
  if (t.fauxItalic) ctx.restore?.();
}

/** A laid-out line drawn left-aligned; tracking or a justify gap draws it glyph by glyph. */
function drawLine(ctx, t, line, measure) {
  const track = typeTrackPx(t);
  if (!track && !line.gap) {
    drawGlyphs(ctx, t, line.text, line.x, line.y);
    return;
  }
  let x = line.x;
  for (const g of glyphsOf(line.text)) {
    if (g !== ' ') drawGlyphs(ctx, t, g, x, line.y);
    x += measure(ctx.font, g) + track + (g === ' ' ? line.gap : 0);
  }
}

/**
 * Draw the text onto ctx with fillText (the caller clears first), then remap its alpha for the
 * anti-alias mode. Vertical text draws glyph by glyph, centred on its column; paragraph text is
 * clipped to its box.
 */
export function renderType(ctx, t) {
  ctx.save?.();
  ctx.font = typeFont(t);
  ctx.fillStyle = t.color;
  ctx.textBaseline = 'alphabetic';
  const measure = ctx.measureText ? (font, s) => ctx.measureText(s).width : measureTypeText;
  if (t.orientation === 'vertical') {
    ctx.textAlign = 'center';
    for (const g of verticalGlyphs(t)) drawGlyphs(ctx, t, g.text, g.x, g.y);
  } else if (t.box || typeTrackPx(t)) {
    ctx.textAlign = 'left';
    if (t.box && ctx.clip) {
      ctx.beginPath?.();
      ctx.rect?.(t.x, t.y, t.box.w, t.box.h);
      ctx.clip();
    }
    for (const line of typeLayout(t, measure)) if (line.text) drawLine(ctx, t, line, measure);
  } else {
    ctx.textAlign = t.align === 'justify' ? 'left' : t.align;
    t.text.split('\n').forEach((line, i) => {
      if (line) drawGlyphs(ctx, t, line, t.x, t.y + i * typeLineHeight(t));
    });
  }
  ctx.restore?.();
  const mode = t.antialias ?? TYPE_DEFAULTS.antialias;
  const { width, height } = ctx.canvas ?? {};
  // Warp Text: the drawn glyphs bend through the warp over their unwarped bounds.
  const field = t.warp && width > 0 && height > 0 && ctx.getImageData ? typeWarpField(t, measure) : null;
  if (field) {
    const img = ctx.getImageData(0, 0, width, height);
    img.data.set(warpImageData(img.data, width, height, field, typeBounds(t, measure)));
    ctx.putImageData(img, 0, 0);
  }
  if (mode !== 'smooth' && width > 0 && height > 0 && ctx.getImageData) {
    ctx.putImageData(applyTypeAntialias(ctx.getImageData(0, 0, width, height), mode), 0, 0);
  }
}

/** The record with a Character or Paragraph panel field changed. */
export function withTypeField(t, key, value) {
  return normalizeType({ ...t, [key]: value });
}

/** The record moved by (dx, dy): the Move tool and Crop. */
export function translateType(t, dx, dy) {
  return { ...t, x: t.x + dx, y: t.y + dy };
}

/**
 * True when toolId would paint the type layer's pixels, so PhotoCraft asks to rasterize it
 * first. Selections, the eyedropper, crop, the Move tool, and the Type tool itself never do.
 */
export function typeNeedsRasterize(layer, toolId) {
  return isTypeLayer(layer) && toolId !== 'select' && !isPixelSafeTool(toolId);
}

/**
 * The Type tools: Horizontal Type, Vertical Type, and the two Type Masks (Tool::Type,
 * VerticalType, HorizontalTypeMask, VerticalTypeMask). They share one options bar.
 */
export const TYPE_TOOLS = ['text', 'verticalType', 'horizontalTypeMask', 'verticalTypeMask'];
export const TYPE_MASK_TOOLS = ['horizontalTypeMask', 'verticalTypeMask'];
export function isTypeTool(toolId) {
  return TYPE_TOOLS.includes(toolId);
}
export function isTypeMaskTool(toolId) {
  return TYPE_MASK_TOOLS.includes(toolId);
}

/** .paintproj form (the record itself; pixels render again on load). */
export function typeToJSON(t) {
  return normalizeType(t);
}

/** The saved form back, or null when it is not a type record. */
export function typeFromJSON(json) {
  if (!json || typeof json !== 'object' || typeof json.text !== 'string') return null;
  return normalizeType(json);
}

/** A type layer: its canvas draws layer.type with fillText. */
export function createTypeLayer(name, type, w, h) {
  const layer = createLayer(name, w, h);
  layer.kind = 'type';
  layer.type = normalizeType(type);
  renderTypeLayer(layer);
  return layer;
}

/** Redraw a type layer's canvas from layer.type. */
export function renderTypeLayer(layer) {
  if (!isTypeLayer(layer)) return;
  const { width, height } = layer.canvas;
  layer.ctx.clearRect?.(0, 0, width, height);
  renderType(layer.ctx, layer.type);
  layer.typeSize = [width, height];
}

/** Re-render every type layer whose canvas changed size since it was drawn. */
export function refreshTypeLayers(layers) {
  for (const layer of layers) {
    if (!isTypeLayer(layer)) continue;
    const [w, h] = layer.typeSize ?? [];
    if (w !== layer.canvas.width || h !== layer.canvas.height) renderTypeLayer(layer);
  }
}

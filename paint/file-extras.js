// Paint — File › Place Embedded…, File Info…, Export › Layers to Files…, and the
// Scripts › Delete All Empty Layers / Flatten All Masks commands (PhotoCraft file_cmds.rs,
// extra_cmds.rs). Pure helpers; paint.js does the DOM, undo, and downloads.

import { applyLayerMask } from './layer-mask.js';

// ── File Info (PhotoCraft file.fileInfo) ─────────────────────────────────────

/** The File Info fields in dialog order, with the PNG tEXt keyword each is written under. */
export const FILE_INFO_FIELDS = [
  { key: 'title', label: 'Document Title', keyword: 'Title' },
  { key: 'author', label: 'Author', keyword: 'Author' },
  { key: 'description', label: 'Description', keyword: 'Description' },
  { key: 'keywords', label: 'Keywords', keyword: 'Keywords' },
  { key: 'copyright', label: 'Copyright Notice', keyword: 'Copyright' }
];

/** Every File Info field as a string; older .paintproj files have no fileInfo. */
export function normalizeFileInfo(raw) {
  const info = {};
  for (const { key } of FILE_INFO_FIELDS) {
    const v = raw?.[key];
    info[key] = typeof v === 'string' ? v : '';
  }
  return info;
}

/** [keyword, text] pairs for the non-empty File Info fields, in dialog order. */
export function fileInfoTextEntries(info) {
  const norm = normalizeFileInfo(info);
  return FILE_INFO_FIELDS.filter(({ key }) => norm[key].trim() !== '').map(({ key, keyword }) => [
    keyword,
    norm[key]
  ]);
}

// ── PNG tEXt chunks ──────────────────────────────────────────────────────────

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

let crcTable = null;

/** CRC-32 (ISO 3309, as PNG uses it) of bytes. */
export function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// tEXt is Latin-1; anything outside it becomes '?'.
function latin1(s) {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out[i] = c < 256 ? c : 63;
  }
  return out;
}

function textChunk(keyword, text) {
  // Keywords are 1–79 Latin-1 bytes with no NUL.
  const key = latin1(String(keyword).replace(/\0/g, '').slice(0, 79));
  const value = latin1(String(text).replace(/\0/g, ' '));
  const body = new Uint8Array(4 + key.length + 1 + value.length);
  body.set([0x74, 0x45, 0x58, 0x74]); // 'tEXt'
  body.set(key, 4);
  body.set(value, 5 + key.length);
  const chunk = new Uint8Array(12 + key.length + 1 + value.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, body.length - 4);
  chunk.set(body, 4);
  view.setUint32(chunk.length - 4, crc32(body));
  return chunk;
}

/**
 * A copy of PNG bytes with one tEXt chunk per [keyword, text] entry inserted right after IHDR,
 * in entry order. Entries with an empty keyword are skipped; no entries returns the input.
 * @param {Uint8Array} bytes
 * @param {Array<[string, string]>} entries
 */
export function insertPngText(bytes, entries) {
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) throw new Error('not a PNG');
  }
  const chunks = entries.filter(([k]) => k).map(([k, v]) => textChunk(k, v));
  if (!chunks.length) return bytes;
  const ihdrLen = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(8);
  const at = 8 + 12 + ihdrLen;
  const extra = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(bytes.length + extra);
  out.set(bytes.subarray(0, at));
  let o = at;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  out.set(bytes.subarray(at), o);
  return out;
}

/** The chunk types of PNG bytes in file order (for tests and sanity checks). */
export function pngChunkTypes(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const types = [];
  for (let o = 8; o + 8 <= bytes.length; ) {
    const len = view.getUint32(o);
    types.push(String.fromCharCode(...bytes.subarray(o + 4, o + 8)));
    o += 12 + len;
  }
  return types;
}

// ── Scripts › Delete All Empty Layers ────────────────────────────────────────

const isPixelLayer = (layer) => (layer.kind || 'pixel') === 'pixel';

function layerPixels(layer) {
  const { width, height } = layer.canvas;
  return layer.ctx.getImageData(0, 0, width, height);
}

/** True when every alpha byte is 0. */
export function isTransparent(data) {
  for (let i = 3; i < data.length; i += 4) if (data[i]) return false;
  return true;
}

/** PhotoCraft is_empty_layer: a pixel layer with no mask and no visible pixel. */
export function isEmptyLayer(layer) {
  return isPixelLayer(layer) && !layer.mask && isTransparent(layerPixels(layer).data);
}

/**
 * Stack indices Delete All Empty Layers removes. A document keeps at least one layer, so a
 * stack that is all empty removes nothing (PhotoCraft delete_where).
 */
export function emptyLayerIndices(layers) {
  const idx = [];
  layers.forEach((l, i) => isEmptyLayer(l) && idx.push(i));
  return idx.length === layers.length ? [] : idx;
}

// ── Scripts › Flatten All Masks ──────────────────────────────────────────────

/**
 * PhotoCraft flatten_all_masks: every pixel layer with an enabled mask has the mask baked into
 * its alpha and the mask removed. Adjustment layers keep theirs; disabled masks are left alone.
 * Returns the layers it changed (call syncLayerMask on each).
 */
export function flattenAllMasks(layers) {
  const changed = [];
  for (const layer of layers) {
    if (!layer.mask || layer.maskEnabled === false || !isPixelLayer(layer)) continue;
    const img = layerPixels(layer);
    img.data.set(applyLayerMask(img, layer.mask).data);
    layer.ctx.putImageData(img, 0, 0);
    layer.mask = null;
    layer.maskEnabled = true;
    changed.push(layer);
  }
  return changed;
}

// ── Export › Layers to Files ─────────────────────────────────────────────────

/** PhotoCraft file_cmds sanitize: a safe file-name component, 'layer' when nothing is left. */
export function sanitizeFileComponent(name) {
  const s = String(name)
    .replace(/[^\p{L}\p{N}\-_ .]/gu, '_')
    .trim()
    .replace(/^\.+|\.+$/g, '');
  return s || 'layer';
}

/**
 * The files Layers to Files writes: [{ layerIdx, fileName }], top of the stack first, named
 * <doc>_<index>_<layer>.png with a four-digit index. Hidden layers are skipped and take no
 * index; adjustment layers take an index but have no pixels of their own to write.
 */
export function layersToFilesList(layers, docName) {
  const prefix = sanitizeFileComponent(docName);
  const files = [];
  let index = 0;
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    if (!layer.visible) continue;
    const n = index++;
    if (!isPixelLayer(layer)) continue;
    const fileName = `${prefix}_${String(n).padStart(4, '0')}_${sanitizeFileComponent(
      layer.name
    )}.png`;
    files.push({ layerIdx: i, fileName });
  }
  return files;
}

// ── Place Embedded ───────────────────────────────────────────────────────────

/** Placed size and offset: scaled down (never up) to fit the canvas, centred. */
export function placeFit(w, h, W, H) {
  const s = Math.min(1, W / w, H / h);
  const pw = Math.max(1, Math.round(w * s));
  const ph = Math.max(1, Math.round(h * s));
  return { x: Math.round((W - pw) / 2), y: Math.round((H - ph) / 2), w: pw, h: ph };
}

/** Layer name for a placed file: its name without the extension. */
export function placedLayerName(fileName) {
  const name = String(fileName || '').replace(/\.[^.]*$/, '');
  return name || 'Placed Layer';
}

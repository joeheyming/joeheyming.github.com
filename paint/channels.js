// Alpha channels and Select › Save / Load Selection… (PhotoCraft channel_cmds.rs save_selection /
// load_selection). An alpha channel is { name, data }: data is an 8-bit gray plane, length W * H,
// 255 selected. Channel lists are never mutated; every op returns a new array, so undo entries
// and .paintproj can keep the array they were given.

import { decodeMask, encodeMask } from './layer-mask.js';
import { softToSelection } from './color-range.js';
import { iconSvg } from './icons.js';

/** The Channels panel's color rows, above the alpha channels (RGB documents). */
export const COLOR_CHANNELS = ['RGB', 'Red', 'Green', 'Blue'];

/** Save Selection's operations on an existing channel (a new channel is just the selection). */
export const SAVE_OPERATIONS = [
  { value: 'new', label: 'Replace Channel' },
  { value: 'add', label: 'Add to Channel' },
  { value: 'subtract', label: 'Subtract from Channel' },
  { value: 'intersect', label: 'Intersect with Channel' }
];

/** Load Selection's operations on the current selection. */
export const LOAD_OPERATIONS = [
  { value: 'new', label: 'New Selection' },
  { value: 'add', label: 'Add to Selection' },
  { value: 'subtract', label: 'Subtract from Selection' },
  { value: 'intersect', label: 'Intersect with Selection' }
];

/** Every Channels panel row: the color channels, then the alpha channels by name. */
export function channelRows(channels = []) {
  return [
    ...COLOR_CHANNELS.map((name, i) => ({ name, kind: i ? 'color' : 'composite' })),
    ...channels.map((c, index) => ({ name: c.name, kind: 'alpha', index }))
  ];
}

/** The next free "Alpha N" name (next_alpha_name). */
export function nextAlphaName(channels = []) {
  const taken = new Set(channels.map((c) => c.name));
  let n = 1;
  while (taken.has(`Alpha ${n}`)) n++;
  return `Alpha ${n}`;
}

/** Gray levels for a 0/1 selection mask (null = nothing selected, all black). */
export function selectionLevels(selMask, length) {
  const out = new Uint8Array(length);
  if (selMask) for (let p = 0; p < length; p++) out[p] = selMask[p] ? 255 : 0;
  return out;
}

/**
 * Select › Save Selection…: `channel` 'new' (or a missing index) appends a channel named `name`
 * (default the next "Alpha N"); an existing index combines the selection into it by `operation`
 * (new / replace, add = max, subtract = old − sel, intersect = min) and renames it if `name` is
 * given. Returns { channels, index }.
 * @param {Array<{ name: string, data: Uint8Array }>} channels
 * @param {Uint8Array | null} selMask
 * @param {number} length W * H
 * @param {{ channel?: number | 'new', name?: string, operation?: string }} [opts]
 */
export function saveSelectionToChannel(channels, selMask, length, opts = {}) {
  const sel = selectionLevels(selMask, length);
  const name = String(opts.name ?? '').trim();
  const i = typeof opts.channel === 'number' ? opts.channel : -1;
  const existing = channels[i];
  if (!existing || existing.data.length !== length) {
    const next = { name: name || nextAlphaName(channels), data: sel };
    return { channels: [...channels, next], index: channels.length };
  }
  const old = existing.data;
  const op = opts.operation ?? 'new';
  const data = new Uint8Array(length);
  for (let p = 0; p < length; p++) {
    if (op === 'add') data[p] = Math.max(old[p], sel[p]);
    else if (op === 'subtract') data[p] = Math.max(0, old[p] - sel[p]);
    else if (op === 'intersect') data[p] = Math.min(old[p], sel[p]);
    else data[p] = sel[p];
  }
  const out = channels.slice();
  out[i] = { name: name || existing.name, data };
  return { channels: out, index: i };
}

/** A channel as a 0/1 selection mask (selected at half gray and up). */
export function channelSelection(channel) {
  return softToSelection(channel.data);
}

/** Load Selection's operation as an applySelectionWithMask mode (null replaces). */
export function loadSelectionMode(operation) {
  return ['add', 'subtract', 'intersect'].includes(operation) ? operation : null;
}

/** Create new channel: an all-black alpha channel named "Alpha N", appended. */
export function newChannel(channels, length) {
  const next = { name: nextAlphaName(channels), data: new Uint8Array(length) };
  return { channels: [...channels, next], index: channels.length };
}

/** The channels without the one at `index`. */
export function deleteChannel(channels, index) {
  return channels.filter((_, i) => i !== index);
}

/**
 * channel.duplicate: append a copy of the channel at `index` named "<name> copy" with its own
 * plane. A missing index returns { channels: <input>, index: -1 }.
 */
export function duplicateChannel(channels, index) {
  const channel = channels[index];
  if (!channel) return { channels, index: -1 };
  const copy = { name: `${channel.name} copy`, data: new Uint8Array(channel.data) };
  return { channels: [...channels, copy], index: channels.length };
}

/**
 * channel.duplicate on a color row: append an alpha channel named "<name> copy" holding that
 * plane of `img` (the flattened visible composite). Red / Green / Blue copy the byte plane; RGB
 * stores the composite's luminosity (channel_cmds.rs gray_plane, Rec. 601). An unknown name
 * returns { channels: <input>, index: -1 }.
 * @param {Array<{ name: string, data: Uint8Array }>} channels
 * @param {{ data: Uint8ClampedArray | Uint8Array }} img
 * @param {string} name
 */
export function duplicateColorChannel(channels, img, name) {
  const k = COLOR_CHANNELS.indexOf(name);
  if (k < 0 || !img) return { channels, index: -1 };
  const d = img.data;
  const data = new Uint8Array(d.length >> 2);
  for (let p = 0, i = 0; p < data.length; p++, i += 4) {
    data[p] = k ? d[i + k - 1] : Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
  }
  return { channels: [...channels, { name: `${name} copy`, data }], index: channels.length };
}

/**
 * Toggle a color channel's eye (channel_cmds.rs set_visible). `hidden` is [r, g, b], true =
 * hidden, and is never mutated. 'RGB' shows all three if any is hidden, else hides all three.
 * An unknown name returns `hidden` itself.
 * @param {boolean[]} hidden
 * @param {string} name
 */
export function toggleColorVisible(hidden, name) {
  const k = COLOR_CHANNELS.indexOf(name);
  if (k < 0) return hidden;
  if (k === 0) return hidden.map(() => !hidden.some(Boolean));
  return hidden.map((h, i) => (i === k - 1 ? !h : h));
}

/**
 * Toggle an alpha channel's eye (channels_panel.rs channel.setVisible on Row::Alpha). Returns a
 * new list whose record at `index` has `shown` flipped (data shared); a missing index returns
 * `channels` itself. The eye is view state: serializeChannels does not write it.
 */
export function toggleAlphaShown(channels, index) {
  const channel = channels[index];
  if (!channel) return channels;
  const out = channels.slice();
  out[index] = { ...channel, shown: !channel.shown };
  return out;
}

/** Channel Options defaults (channel_options_ui.rs; PhotoCraft's alpha overlay is red 50 %). */
export const CHANNEL_OPTION_DEFAULTS = { indicates: 'masked', color: '#ff0000', opacity: 50 };

// '#rrggbb' as [r, g, b]; anything else is the default red.
function hexRgb(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex ?? ''));
  const n = m ? parseInt(m[1], 16) : 0xff0000;
  return [n >> 16, (n >> 8) & 255, n & 255];
}

// An overlay as { data, rgb, alpha, selected }: a bare plane or a channel record.
function overlayOf(o) {
  const rec = ArrayBuffer.isView(o) ? { data: o } : o;
  const opacity = Number.isFinite(rec.opacity) ? rec.opacity : CHANNEL_OPTION_DEFAULTS.opacity;
  return {
    data: rec.data,
    rgb: hexRgb(rec.color ?? CHANNEL_OPTION_DEFAULTS.color),
    alpha: Math.min(100, Math.max(0, opacity)) / 100,
    selected: rec.indicates === 'selected'
  };
}

/**
 * The view with some color channels hidden or alpha channels shown (channel_view.rs
 * render_with_source). Color rules: none or all hidden is the plain composite, one visible
 * channel is gray, else hidden channels are zeroed. Each overlay is a shown alpha's 0..255 plane
 * or its record { data, color = '#ff0000', opacity = 50, indicates = 'masked' }: coverage is
 * v / 255 for 'selected' and 1 − v / 255 for 'masked' (lib.rs overlay_coverage), and it tints its
 * color at opacity / 100 × coverage. With every color hidden the first overlay is the base, as
 * gray. Null when there is nothing but the plain composite. Alpha is 255.
 * @param {{ width: number, height: number, data: Uint8ClampedArray | Uint8Array }} img
 * @param {boolean[]} hidden
 * @param {Array<Uint8Array | { data: Uint8Array, color?: string, opacity?: number,
 *   indicates?: string }>} [overlays]
 */
export function channelViewPixels(img, hidden, overlays = []) {
  const shown = [0, 1, 2].filter((c) => !hidden[c]);
  if (overlays.length === 0 && (shown.length === 0 || shown.length === 3)) return null;
  const src = img.data;
  const data = new Uint8ClampedArray(src.length);
  const all = overlays.map(overlayOf);
  const solo = shown.length === 0 ? all[0].data : null;
  const tints = solo ? all.slice(1) : all;
  for (let i = 0, p = 0; i < src.length; i += 4, p++) {
    if (solo) {
      data[i] = data[i + 1] = data[i + 2] = solo[p];
    } else if (shown.length === 1) {
      data[i] = data[i + 1] = data[i + 2] = src[i + shown[0]];
    } else {
      for (let c = 0; c < 3; c++) data[i + c] = hidden[c] ? 0 : src[i + c];
    }
    for (const { data: plane, rgb, alpha, selected } of tints) {
      const v = plane[p] / 255;
      const a = alpha * (selected ? v : 1 - v);
      if (!a) continue;
      for (let c = 0; c < 3; c++) data[i + c] = Math.round(data[i + c] * (1 - a) + rgb[c] * a);
    }
    data[i + 3] = 255;
  }
  return { width: img.width, height: img.height, data };
}

/**
 * Channel Options… OK (channel_options_ui.rs params → channel.options): a new list whose record at
 * `index` has the given indicates / color / opacity and the trimmed name (blank keeps the old
 * one); data is shared. A missing index returns `channels` itself.
 * @param {Array<{ name: string, data: Uint8Array }>} channels
 * @param {number} index
 * @param {{ name?: string, indicates?: string, color?: string, opacity?: number }} options
 */
export function setChannelOptions(channels, index, options = {}) {
  const channel = channels[index];
  if (!channel) return channels;
  const name = String(options.name ?? '').trim() || channel.name;
  const next = { ...channel, name };
  if (options.indicates !== undefined) {
    next.indicates = options.indicates === 'selected' ? 'selected' : 'masked';
  }
  if (options.color !== undefined) next.color = options.color;
  if (options.opacity !== undefined) {
    next.opacity = Math.min(100, Math.max(0, Math.round(Number(options.opacity) || 0)));
  }
  const out = channels.slice();
  out[index] = next;
  return out;
}

/**
 * Rename the channel at `index` to the trimmed `name` (channel.rename). A blank or unchanged name,
 * or a missing index, returns `channels` itself so callers can tell nothing happened.
 */
export function renameChannel(channels, index, name) {
  const channel = channels[index];
  const next = String(name ?? '').trim();
  if (!channel || !next || next === channel.name) return channels;
  const out = channels.slice();
  out[index] = { ...channel, name: next };
  return out;
}

/** The channels that still fit a W × H document (a resize leaves the rest unloadable). */
export function fittingChannels(channels = [], length) {
  return channels.filter((c) => c.data.length === length);
}

/**
 * .paintproj form: [{ name, data, indicates, color, opacity }] with data run-length base64, as
 * layer masks are saved.
 */
export function serializeChannels(channels = []) {
  return channels.map((c) => ({
    name: c.name,
    data: encodeMask(c.data),
    indicates: c.indicates ?? CHANNEL_OPTION_DEFAULTS.indicates,
    color: c.color ?? CHANNEL_OPTION_DEFAULTS.color,
    opacity: c.opacity ?? CHANNEL_OPTION_DEFAULTS.opacity
  }));
}

/** Channels from a .paintproj; older files have none, or channels without options. */
export function deserializeChannels(saved, length) {
  if (!Array.isArray(saved)) return [];
  return saved
    .filter((c) => c && typeof c.data === 'string')
    .map((c, i) => ({
      name: typeof c.name === 'string' && c.name ? c.name : `Alpha ${i + 1}`,
      data: decodeMask(c.data, length),
      indicates: c.indicates === 'selected' ? 'selected' : 'masked',
      color: /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : CHANNEL_OPTION_DEFAULTS.color,
      opacity: Number.isFinite(c.opacity)
        ? Math.min(100, Math.max(0, c.opacity))
        : CHANNEL_OPTION_DEFAULTS.opacity
    }));
}

/**
 * A Channels row thumbnail (lib.rs channel_thumbs): a size × size RGBA image with `img` scaled to
 * fit (nearest pixel) and centered; the letterbox is transparent. 'composite' copies RGB, 'color'
 * Red / Green / Blue is that channel as gray, 'alpha' is row.data (0..255, W * H) as gray.
 * @param {{ width: number, height: number, data: Uint8ClampedArray | Uint8Array }} img
 * @param {{ kind: string, name?: string, data?: Uint8Array }} row
 * @param {number} size
 */
export function channelThumbPixels(img, row, size) {
  const data = new Uint8ClampedArray(size * size * 4);
  const { width: W, height: H } = img;
  if (!W || !H) return { width: size, height: size, data };
  const scale = Math.min(size / W, size / H);
  const tw = Math.max(1, Math.round(W * scale));
  const th = Math.max(1, Math.round(H * scale));
  const ox = Math.floor((size - tw) / 2);
  const oy = Math.floor((size - th) / 2);
  const k = row.kind === 'color' ? COLOR_CHANNELS.indexOf(row.name) - 1 : -1;
  const src = img.data;
  for (let y = 0; y < th; y++) {
    const sy = Math.min(H - 1, Math.floor((y * H) / th));
    for (let x = 0; x < tw; x++) {
      const sx = Math.min(W - 1, Math.floor((x * W) / tw));
      const p = sy * W + sx;
      const o = ((oy + y) * size + ox + x) * 4;
      if (row.kind === 'alpha') {
        data[o] = data[o + 1] = data[o + 2] = row.data?.[p] ?? 0;
      } else if (k >= 0) {
        data[o] = data[o + 1] = data[o + 2] = src[p * 4 + k];
      } else {
        data[o] = src[p * 4];
        data[o + 1] = src[p * 4 + 1];
        data[o + 2] = src[p * 4 + 2];
      }
      data[o + 3] = 255;
    }
  }
  return { width: size, height: size, data };
}

export { CHANNEL_OVERLAY_COLORS, renderChannelsPanel } from './channels-panel.js';

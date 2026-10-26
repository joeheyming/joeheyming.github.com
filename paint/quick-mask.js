// Select › Edit in Quick Mask Mode (PhotoCraft channel_cmds.rs quick_mask). The Quick Mask is an
// 8-bit gray plane, length W * H, index y * W + x: 255 is selected, 0 is masked. It shows as a
// 50% red overlay over the masked areas (channel_view.rs), painting black masks, painting white
// selects, and leaving the mode turns the plane back into a selection.

import { softToSelection } from './color-range.js';

/**
 * The Quick Mask for a 0/1 selection mask, or for no selection (null): nothing selected is an
 * all-white plane that shows no color, flagged `unselected` so leaving untouched selects nothing.
 * @param {Uint8Array | null} selMask
 * @param {number} W
 * @param {number} H
 */
export function quickMaskFromSelection(selMask, W, H) {
  const levels = new Uint8Array(W * H);
  if (!selMask) return { levels: levels.fill(255), unselected: true };
  for (let p = 0; p < levels.length; p++) levels[p] = selMask[p] ? 255 : 0;
  return { levels, unselected: false };
}

/**
 * The 0/1 selection a Quick Mask turns back into (selected at half gray and up, as Paint's
 * selections are hard), or null for no selection. All white is Select All unless the mode was
 * entered with no selection and the plane is still that untouched white (selection_from).
 * @param {Uint8Array} levels
 * @param {boolean} [unselected]
 */
export function quickMaskToSelection(levels, unselected = false) {
  if (unselected && levels.every((v) => v === 255)) return null;
  const mask = softToSelection(levels);
  return mask.includes(1) ? mask : null;
}

/** Red over the masked areas, 50% where fully masked: RGBA bytes for an ImageData. */
export function quickMaskOverlay(levels, out = new Uint8ClampedArray(levels.length * 4)) {
  for (let p = 0, i = 0; p < levels.length; p++, i += 4) {
    out[i] = 255;
    out[i + 1] = 0;
    out[i + 2] = 0;
    out[i + 3] = Math.round(((255 - levels[p]) * 128) / 255);
  }
  return out;
}

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ADJUSTMENTS } from '../paint/adjustments.js';
import { COMMANDS } from '../paint/commands.js';
import { CATALOG } from '../paint/menu-catalog.js';

const image = (w, h, pixels) => ({
  width: w,
  height: h,
  data: new Uint8ClampedArray(pixels.flat())
});
const px = (img, p) => Array.from(img.data.slice(p * 4, p * 4 + 4));

test('Image › Adjustments lists the three in catalog order', () => {
  const ids = CATALOG.filter((r) => r[0] === 'Image > Adjustments').map((r) => r[3]);
  for (const id of [
    'image.adjustments.shadowsHighlights',
    'image.adjustments.replaceColor',
    'image.adjustments.equalize'
  ]) {
    assert.ok(ids.includes(id), id);
    assert.ok(
      COMMANDS.some((c) => c.id === id),
      id + ' is a command'
    );
  }
  assert.ok(
    ids.indexOf('image.adjustments.shadowsHighlights') <
      ids.indexOf('image.adjustments.replaceColor')
  );
  assert.ok(
    ids.indexOf('image.adjustments.replaceColor') < ids.indexOf('image.adjustments.equalize')
  );
});

test('Equalize spreads a two-level image to 0 and 255', () => {
  const img = image(4, 1, [
    [100, 100, 100, 255],
    [100, 100, 100, 255],
    [140, 140, 140, 255],
    [140, 140, 140, 255]
  ]);
  ADJUSTMENTS.equalize.apply(img, {}, null);
  assert.deepEqual(px(img, 0), [0, 0, 0, 255]);
  assert.deepEqual(px(img, 1), [0, 0, 0, 255]);
  assert.deepEqual(px(img, 2), [255, 255, 255, 255]);
  assert.deepEqual(px(img, 3), [255, 255, 255, 255]);
});

test('Equalize with a selection reads and writes the selection only', () => {
  // Outside the selection the image has a 0 and a 255; inside, only 100 and 140.
  const img = image(4, 1, [
    [0, 0, 0, 255],
    [100, 100, 100, 255],
    [140, 140, 140, 255],
    [255, 255, 255, 255]
  ]);
  ADJUSTMENTS.equalize.apply(img, {}, new Uint8Array([0, 1, 1, 0]));
  assert.deepEqual(px(img, 0), [0, 0, 0, 255]);
  assert.deepEqual(px(img, 1), [0, 0, 0, 255]);
  assert.deepEqual(px(img, 2), [255, 255, 255, 255]);
  assert.deepEqual(px(img, 3), [255, 255, 255, 255]);
});

test('Replace Color with Fuzziness 0 changes only the exact color', () => {
  const img = image(3, 1, [
    [255, 0, 0, 255],
    [254, 0, 0, 255],
    [0, 0, 255, 255]
  ]);
  ADJUSTMENTS.replaceColor.apply(
    img,
    { color: '#ff0000', fuzziness: 0, hue: 120, saturation: 0, lightness: 0 },
    null
  );
  assert.deepEqual(px(img, 0), [0, 255, 0, 255], 'red turned 120° to green');
  assert.deepEqual(px(img, 1), [254, 0, 0, 255], 'one level off is untouched');
  assert.deepEqual(px(img, 2), [0, 0, 255, 255]);
});

test('Replace Color fades with Fuzziness and honors the selection', () => {
  const img = image(2, 1, [
    [255, 0, 0, 255],
    [255, 0, 0, 255]
  ]);
  ADJUSTMENTS.replaceColor.apply(
    img,
    { color: '#ff0000', fuzziness: 40, hue: 0, saturation: 0, lightness: -100 },
    new Uint8Array([1, 0])
  );
  assert.deepEqual(px(img, 0), [0, 0, 0, 255]);
  assert.deepEqual(px(img, 1), [255, 0, 0, 255]);

  const half = image(1, 1, [[235, 0, 0, 255]]);
  // 20 levels from #ff0000 at Fuzziness 39: k = 1 − 20 / 40 = ½ of the way to black.
  ADJUSTMENTS.replaceColor.apply(
    half,
    { color: '#ff0000', fuzziness: 39, hue: 0, saturation: 0, lightness: -100 },
    null
  );
  assert.deepEqual(px(half, 0), [118, 0, 0, 255]);
});

const toneImage = () => {
  const pixels = [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const v = Math.round(((y * 8 + x) / 63) * 255);
      pixels.push([v, (v * 3) % 256, 255 - v, 255]);
    }
  }
  // Pure black and white so the 0.01% clips stretch nothing.
  pixels[0] = [0, 0, 0, 255];
  pixels[63] = [255, 255, 255, 255];
  return image(8, 8, pixels);
};

test('Shadows/Highlights at amount 0 is identity', () => {
  const img = toneImage();
  const before = Array.from(img.data);
  const params = {};
  for (const f of ADJUSTMENTS.shadowsHighlights.fields) params[f.key] = f.default;
  params.shadowAmount = 0;
  params.highlightAmount = 0;
  ADJUSTMENTS.shadowsHighlights.apply(img, params, null);
  assert.deepEqual(Array.from(img.data), before);
});

test('Shadows/Highlights lifts shadows, darkens highlights, and honors the selection', () => {
  const dark = image(4, 4, Array(16).fill([40, 40, 40, 255]));
  ADJUSTMENTS.shadowsHighlights.apply(
    dark,
    { shadowAmount: 50, highlightAmount: 0, blackClip: 0, whiteClip: 0 },
    null
  );
  assert.ok(dark.data[0] > 40, 'shadows lifted: ' + dark.data[0]);
  assert.equal(dark.data[0], dark.data[1], 'gray stays gray');

  const light = image(4, 4, Array(16).fill([220, 220, 220, 255]));
  ADJUSTMENTS.shadowsHighlights.apply(
    light,
    { shadowAmount: 0, highlightAmount: 50, blackClip: 0, whiteClip: 0 },
    null
  );
  assert.ok(light.data[0] < 220, 'highlights darkened: ' + light.data[0]);

  const masked = image(2, 1, [
    [40, 40, 40, 255],
    [40, 40, 40, 255]
  ]);
  ADJUSTMENTS.shadowsHighlights.apply(
    masked,
    { shadowAmount: 50, blackClip: 0, whiteClip: 0 },
    new Uint8Array([0, 1])
  );
  assert.deepEqual(px(masked, 0), [40, 40, 40, 255]);
  assert.ok(masked.data[4] > 40);
});

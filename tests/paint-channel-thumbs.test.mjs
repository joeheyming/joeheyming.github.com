import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { channelThumbPixels, renderChannelsPanel } from '../paint/channels.js';

// A 4×2 image: left half pure red, right half pure blue.
function image() {
  const data = new Uint8ClampedArray(4 * 2 * 4);
  for (let y = 0; y < 2; y++) {
    for (let x = 0; x < 4; x++) {
      const o = (y * 4 + x) * 4;
      data.set(x < 2 ? [255, 0, 0, 255] : [0, 0, 255, 255], o);
    }
  }
  return { width: 4, height: 2, data };
}

test('thumbnails are letterboxed squares that keep the document aspect', () => {
  const t = channelThumbPixels(image(), { kind: 'composite' }, 4);
  assert.equal(t.width, 4);
  assert.equal(t.height, 4);
  // Rows 0 and 3 are the letterbox (transparent); rows 1-2 hold the 4×2 image.
  assert.equal(t.data[3], 0);
  assert.deepEqual([...t.data.slice((1 * 4 + 0) * 4, (1 * 4 + 0) * 4 + 4)], [255, 0, 0, 255]);
  assert.deepEqual([...t.data.slice((1 * 4 + 3) * 4, (1 * 4 + 3) * 4 + 4)], [0, 0, 255, 255]);
  assert.equal(t.data[(3 * 4 + 0) * 4 + 3], 0);
});

test('color rows are their channel as gray; alpha rows are their plane as gray', () => {
  const red = channelThumbPixels(image(), { kind: 'color', name: 'Red' }, 4);
  assert.deepEqual([...red.data.slice((1 * 4 + 0) * 4, (1 * 4 + 0) * 4 + 4)], [255, 255, 255, 255]);
  assert.deepEqual([...red.data.slice((1 * 4 + 3) * 4, (1 * 4 + 3) * 4 + 4)], [0, 0, 0, 255]);
  const plane = new Uint8Array([0, 0, 0, 0, 128, 128, 128, 128]);
  const alpha = channelThumbPixels(image(), { kind: 'alpha', data: plane }, 4);
  assert.deepEqual([...alpha.data.slice((1 * 4 + 0) * 4, (1 * 4 + 0) * 4 + 4)], [0, 0, 0, 255]);
  assert.deepEqual([...alpha.data.slice((2 * 4 + 0) * 4, (2 * 4 + 0) * 4 + 4)], [128, 128, 128, 255]);
});

function panel() {
  const { window } = new JSDOM('<!doctype html><div id="c"></div>');
  const doc = window.document;
  const container = doc.getElementById('c');
  const calls = { options: [], rename: 0 };
  renderChannelsPanel(container, [{ name: 'Alpha 1', data: new Uint8Array(8) }], {
    target: null,
    canSave: false,
    image: image(),
    onTarget() {},
    onLoad() {},
    onSave() {},
    onNew() {},
    onDelete() {},
    onRename: () => calls.rename++,
    onOptions: (i) => calls.options.push(i)
  });
  return { window, doc, container, calls };
}

test('every row has a thumbnail canvas between its eye and its name', () => {
  const { container } = panel();
  const rows = [...container.querySelectorAll('.channel-row')];
  assert.equal(rows.length, 5);
  for (const row of rows) {
    const thumb = row.querySelector('canvas.channel-thumb');
    assert.ok(thumb, 'thumbnail');
    assert.equal(thumb.previousElementSibling?.className, 'channel-eye');
  }
});

test('double-clicking an alpha thumbnail opens Channel Options instead of renaming', () => {
  const { window, container, calls } = panel();
  const thumb = container.querySelector('[data-channel="0"] canvas.channel-thumb');
  thumb.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
  assert.deepEqual(calls.options, [0]);
  assert.equal(container.querySelector('[data-channel="0"] input'), null, 'no rename field');
});

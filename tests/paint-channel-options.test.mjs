import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import {
  channelViewPixels,
  deserializeChannels,
  renderChannelsPanel,
  serializeChannels,
  setChannelOptions
} from '../paint/channels.js';

// 2 × 1 composite.
const image = () => ({
  width: 2,
  height: 1,
  data: new Uint8ClampedArray([200, 40, 10, 128, 30, 60, 90, 255])
});
const visible = [false, false, false];

test('setChannelOptions returns a new list with the options and name applied', () => {
  const channels = [{ name: 'Alpha 1', data: new Uint8Array(2) }];
  const next = setChannelOptions(channels, 0, {
    name: ' Sky ',
    indicates: 'selected',
    color: '#0000ff',
    opacity: 100
  });
  assert.notEqual(next, channels);
  assert.deepEqual(
    { ...next[0], data: null },
    { name: 'Sky', indicates: 'selected', color: '#0000ff', opacity: 100, data: null }
  );
  assert.equal(next[0].data, channels[0].data, 'the pixels are shared');
  assert.equal(channels[0].name, 'Alpha 1', 'the input is not mutated');
  assert.equal(setChannelOptions(channels, 3, { opacity: 10 }), channels);
});

test('an overlay uses its channel color, opacity, and Color Indicates', () => {
  const overlay = { data: new Uint8Array([0, 255]), color: '#0000ff', opacity: 100 };
  const masked = channelViewPixels(image(), visible, [overlay]);
  assert.deepEqual([...masked.data], [0, 0, 255, 255, 30, 60, 90, 255]);
  const selected = channelViewPixels(image(), visible, [{ ...overlay, indicates: 'selected' }]);
  assert.deepEqual([...selected.data], [200, 40, 10, 255, 0, 0, 255, 255]);
  const plain = channelViewPixels(image(), visible, [{ data: new Uint8Array([0, 255]) }]);
  assert.deepEqual([...plain.data], [228, 20, 5, 255, 30, 60, 90, 255], 'red 50 % by default');
});

test('options round-trip through .paintproj; older files get the defaults', () => {
  const channels = [
    { name: 'A', data: new Uint8Array([0, 255]), indicates: 'selected', color: '#00ff00', opacity: 70 }
  ];
  const back = deserializeChannels(JSON.parse(JSON.stringify(serializeChannels(channels))), 2);
  assert.equal(back[0].indicates, 'selected');
  assert.equal(back[0].color, '#00ff00');
  assert.equal(back[0].opacity, 70);
  const old = deserializeChannels(serializeChannels([{ name: 'B', data: new Uint8Array(2) }]), 2);
  assert.equal(old[0].indicates ?? 'masked', 'masked');
  assert.equal(old[0].color ?? '#ff0000', '#ff0000');
  assert.equal(old[0].opacity ?? 50, 50);
});

test('the alpha row menu lists Channel Options… after Rename Channel…', () => {
  const { window } = new JSDOM('<!doctype html><div id="c"></div>');
  const doc = window.document;
  const container = doc.getElementById('c');
  const calls = [];
  renderChannelsPanel(container, [{ name: 'Alpha 1', data: new Uint8Array(2) }], {
    target: null,
    canSave: false,
    onTarget() {},
    onLoad() {},
    onSave() {},
    onNew() {},
    onDelete() {},
    onOptions: (i) => calls.push(i)
  });
  const row = container.querySelector('[data-channel="0"]');
  row.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  const labels = [...doc.querySelectorAll('.channel-menu [role="menuitem"]')].map(
    (b) => b.textContent
  );
  assert.equal(labels.indexOf('Channel Options…'), labels.indexOf('Rename Channel…') + 1);
  [...doc.querySelectorAll('.channel-menu [role="menuitem"]')]
    .find((b) => b.textContent === 'Channel Options…')
    .click();
  assert.deepEqual(calls, [0]);
});

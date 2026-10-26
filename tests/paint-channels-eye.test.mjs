import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { channelViewPixels, renderChannelsPanel, toggleColorVisible } from '../paint/channels.js';

// 2 × 1 composite.
const image = () => ({
  width: 2,
  height: 1,
  data: new Uint8ClampedArray([200, 40, 10, 128, 30, 60, 90, 255])
});

test('toggleColorVisible flips one color, and RGB shows or hides all three', () => {
  const none = [false, false, false];
  assert.deepEqual(toggleColorVisible(none, 'Green'), [false, true, false]);
  assert.deepEqual(none, [false, false, false], 'the input is not mutated');
  assert.deepEqual(toggleColorVisible(none, 'RGB'), [true, true, true]);
  assert.deepEqual(toggleColorVisible([true, false, false], 'RGB'), [false, false, false]);
  assert.equal(toggleColorVisible(none, 'Alpha 1'), none, 'an unknown name changes nothing');
});

test('channelViewPixels: plain composite when all or none are visible', () => {
  assert.equal(channelViewPixels(image(), [false, false, false]), null);
  assert.equal(channelViewPixels(image(), [true, true, true]), null);
});

test('one visible channel is shown as gray', () => {
  const img = image();
  const v = channelViewPixels(img, [true, false, true]);
  assert.equal(v.width, 2);
  assert.equal(v.height, 1);
  assert.ok(v.data instanceof Uint8ClampedArray);
  assert.deepEqual([...v.data], [40, 40, 40, 255, 60, 60, 60, 255]);
  assert.deepEqual([...img.data], [...image().data], 'the input is not mutated');
});

test('two visible channels zero the hidden one', () => {
  const v = channelViewPixels(image(), [false, false, true]);
  assert.deepEqual([...v.data], [200, 40, 0, 255, 30, 60, 0, 255]);
});

function mount(hidden) {
  const { window } = new JSDOM('<!doctype html><div id="c"></div>');
  const doc = window.document;
  const container = doc.getElementById('c');
  const calls = [];
  renderChannelsPanel(container, [{ name: 'Alpha 1', data: new Uint8Array(2) }], {
    target: 0,
    canSave: false,
    hidden,
    onTarget: (i) => calls.push(['target', i]),
    onLoad() {},
    onSave() {},
    onNew() {},
    onDelete() {},
    onToggleVisible: (name) => calls.push(['eye', name])
  });
  const row = (name) =>
    [...container.querySelectorAll('.channel-row')].find((r) => r.textContent.trim() === name);
  return { container, calls, row };
}

test('composite and color rows carry eyes that toggle without retargeting', () => {
  const { calls, row } = mount([false, true, false]);
  for (const name of ['RGB', 'Red', 'Green', 'Blue']) {
    assert.ok(row(name).querySelector('button.channel-eye'), `${name} has an eye`);
  }
  const eye = (name) => row(name).querySelector('button.channel-eye');
  assert.equal(eye('RGB').getAttribute('aria-pressed'), 'false', 'RGB is pressed only if all show');
  assert.equal(eye('Red').getAttribute('aria-pressed'), 'true');
  assert.equal(eye('Green').getAttribute('aria-pressed'), 'false');
  assert.equal(eye('Green').getAttribute('aria-label'), 'Show Green');
  assert.equal(eye('Blue').getAttribute('aria-label'), 'Hide Blue');
  eye('Green').click();
  eye('RGB').click();
  assert.deepEqual(
    calls,
    [
      ['eye', 'Green'],
      ['eye', 'RGB']
    ],
    'eyes do not retarget the panel'
  );
});

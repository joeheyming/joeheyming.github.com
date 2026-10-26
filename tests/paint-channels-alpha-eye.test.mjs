import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import {
  channelViewPixels,
  renderChannelsPanel,
  serializeChannels,
  toggleAlphaShown
} from '../paint/channels.js';

// 2 × 1 composite.
const image = () => ({
  width: 2,
  height: 1,
  data: new Uint8ClampedArray([200, 40, 10, 128, 30, 60, 90, 255])
});
const visible = [false, false, false];
const allHidden = [true, true, true];

test('toggleAlphaShown flips one alpha eye without mutating the list', () => {
  const channels = [{ name: 'Alpha 1', data: new Uint8Array(2) }];
  const next = toggleAlphaShown(channels, 0);
  assert.notEqual(next, channels);
  assert.equal(next[0].shown, true);
  assert.equal(channels[0].shown, undefined, 'the input is not mutated');
  assert.equal(next[0].data, channels[0].data, 'the pixels are shared, not copied');
  assert.equal(toggleAlphaShown(next, 0)[0].shown, false);
  assert.equal(toggleAlphaShown(channels, 5), channels, 'a missing index changes nothing');
});

test('a shown alpha is a red 50 % rubylith over the masked (black) areas', () => {
  const v = channelViewPixels(image(), visible, [new Uint8Array([0, 255])]);
  assert.deepEqual([...v.data], [228, 20, 5, 255, 30, 60, 90, 255]);
});

test('with every color hidden, the first shown alpha is the picture as gray', () => {
  const v = channelViewPixels(image(), allHidden, [new Uint8Array([0, 255])]);
  assert.deepEqual([...v.data], [0, 0, 0, 255, 255, 255, 255, 255]);
  assert.equal(channelViewPixels(image(), allHidden, []), null);
  assert.equal(channelViewPixels(image(), visible), null, 'no overlays: the plain composite');
});

test('the eye is view state and is not saved', () => {
  const saved = serializeChannels([{ name: 'Alpha 1', data: new Uint8Array(2), shown: true }]);
  assert.equal(JSON.stringify(saved).includes('shown'), false);
});

test('alpha rows carry an eye that toggles without retargeting', () => {
  const { window } = new JSDOM('<!doctype html><div id="c"></div>');
  const container = window.document.getElementById('c');
  const calls = [];
  renderChannelsPanel(
    container,
    [
      { name: 'Alpha 1', data: new Uint8Array(2), shown: true },
      { name: 'Alpha 2', data: new Uint8Array(2) }
    ],
    {
      target: null,
      canSave: false,
      onTarget: (i) => calls.push(['target', i]),
      onLoad() {},
      onSave() {},
      onNew() {},
      onDelete() {},
      onToggleAlpha: (i) => calls.push(['eye', i])
    }
  );
  const eye = (i) => container.querySelector(`[data-channel="${i}"] button.channel-eye`);
  assert.equal(eye(0).getAttribute('aria-pressed'), 'true');
  assert.equal(eye(0).getAttribute('aria-label'), 'Hide Alpha 1');
  assert.equal(eye(1).getAttribute('aria-pressed'), 'false');
  assert.equal(eye(1).getAttribute('aria-label'), 'Show Alpha 2');
  eye(1).click();
  assert.deepEqual(calls, [['eye', 1]]);
});

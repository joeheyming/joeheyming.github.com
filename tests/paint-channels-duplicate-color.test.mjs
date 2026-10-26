import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { duplicateColorChannel, renderChannelsPanel } from '../paint/channels.js';

// 2 × 1 composite: a red-ish pixel and a mid-gray pixel.
const image = () => ({
  width: 2,
  height: 1,
  data: new Uint8ClampedArray([200, 40, 10, 255, 128, 128, 128, 255])
});

test('duplicating a color row appends "<color> copy" holding that plane', () => {
  const before = [{ name: 'Alpha 1', data: new Uint8Array(2) }];
  const red = duplicateColorChannel(before, image(), 'Red');
  assert.equal(red.index, 1);
  assert.equal(red.channels[1].name, 'Red copy');
  assert.deepEqual([...red.channels[1].data], [200, 128]);
  assert.equal(before.length, 1, 'the input list is not mutated');
  const blue = duplicateColorChannel([], image(), 'Blue');
  assert.deepEqual([...blue.channels[0].data], [10, 128]);
  assert.equal(blue.channels[0].name, 'Blue copy');
});

test('duplicating the RGB row stores the composite luminosity', () => {
  const { channels } = duplicateColorChannel([], image(), 'RGB');
  assert.equal(channels[0].name, 'RGB copy');
  assert.equal(channels[0].data[1], 128, 'gray stays gray');
  assert.ok(channels[0].data[0] > 10 && channels[0].data[0] < 200, 'color becomes its gray');
});

test('an unknown row changes nothing', () => {
  const before = [];
  const r = duplicateColorChannel(before, image(), 'Cyan');
  assert.equal(r.channels, before);
  assert.equal(r.index, -1);
});

test('color and composite rows list Duplicate Channel, then New Channel…', () => {
  const { window } = new JSDOM('<!doctype html><div id="c"></div>');
  const doc = window.document;
  const container = doc.getElementById('c');
  const calls = [];
  renderChannelsPanel(container, [], {
    target: null,
    canSave: false,
    onTarget() {},
    onLoad() {},
    onSave() {},
    onNew: () => calls.push(['new']),
    onDelete() {},
    onDuplicate() {},
    onDuplicateColor: (name) => calls.push(['duplicateColor', name])
  });
  const rows = [...container.querySelectorAll('.channel-row')];
  for (const name of ['RGB', 'Red', 'Green', 'Blue']) {
    const row = rows.find((r) => r.textContent === name);
    row.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    const menu = doc.querySelector('.channel-menu[role="menu"]');
    const items = [...menu.querySelectorAll('[role="menuitem"]')];
    assert.deepEqual(
      items.map((b) => b.textContent),
      ['Duplicate Channel', 'New Channel…']
    );
    items[0].click();
  }
  assert.deepEqual(calls, [
    ['duplicateColor', 'RGB'],
    ['duplicateColor', 'Red'],
    ['duplicateColor', 'Green'],
    ['duplicateColor', 'Blue']
  ]);
});

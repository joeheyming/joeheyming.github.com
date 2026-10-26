import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { renameChannel, renderChannelsPanel } from '../paint/channels.js';

const plane = (n, v) => new Uint8Array(n).fill(v);

test('renameChannel returns a new list with the trimmed name', () => {
  const before = [
    { name: 'Alpha 1', data: plane(4, 0) },
    { name: 'Alpha 2', data: plane(4, 255) }
  ];
  const after = renameChannel(before, 1, '  Sky  ');
  assert.equal(after[1].name, 'Sky');
  assert.equal(after[1].data, before[1].data, 'the plane is kept');
  assert.equal(after[0], before[0]);
  assert.equal(before[1].name, 'Alpha 2', 'the input list is not mutated');
  assert.equal(renameChannel(before, 1, '   '), before, 'a blank name changes nothing');
  assert.equal(renameChannel(before, 1, 'Alpha 2'), before, 'the same name changes nothing');
  assert.equal(renameChannel(before, 5, 'X'), before, 'a missing index changes nothing');
});

function mount() {
  const { window } = new JSDOM('<!doctype html><div id="c"></div>');
  const doc = window.document;
  const container = doc.getElementById('c');
  const calls = [];
  renderChannelsPanel(container, [{ name: 'Alpha 1', data: plane(4, 0) }], {
    target: null,
    canSave: false,
    onTarget() {},
    onLoad() {},
    onSave() {},
    onNew() {},
    onDelete() {},
    onRename: (i, name) => calls.push([i, name])
  });
  const dbl = (el) => el.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
  const key = (el, k) => el.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true }));
  return { container, calls, dbl, key };
}

test('double-clicking an alpha channel name opens an inline rename field', () => {
  const { container, dbl } = mount();
  const row = container.querySelector('[data-channel="0"]');
  dbl(row);
  const input = row.querySelector('input.channel-rename');
  assert.ok(input, 'inline text field, not window.prompt');
  assert.equal(input.value, 'Alpha 1');
  assert.equal(input.getAttribute('aria-label'), 'Channel name');
});

test('Enter commits the new name through onRename', () => {
  const { container, calls, dbl, key } = mount();
  const row = container.querySelector('[data-channel="0"]');
  dbl(row);
  const input = row.querySelector('input.channel-rename');
  input.value = 'Mask';
  key(input, 'Enter');
  assert.deepEqual(calls, [[0, 'Mask']]);
});

test('Escape cancels without renaming and restores the label', () => {
  const { container, calls, dbl, key } = mount();
  const row = container.querySelector('[data-channel="0"]');
  dbl(row);
  const input = row.querySelector('input.channel-rename');
  input.value = 'Mask';
  key(input, 'Escape');
  assert.deepEqual(calls, []);
  assert.equal(row.querySelector('input'), null);
  assert.equal(row.textContent, 'Alpha 1');
});

test('color channel rows do not rename', () => {
  const { container, dbl } = mount();
  const rgb = container.querySelector('.channel-row.composite');
  dbl(rgb);
  assert.equal(rgb.querySelector('input'), null);
});

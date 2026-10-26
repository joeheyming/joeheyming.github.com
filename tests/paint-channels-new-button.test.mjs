import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { newChannel, renderChannelsPanel } from '../paint/channels.js';

const plane = (n, v) => new Uint8Array(n).fill(v);

test('newChannel appends a black plane under the next free Alpha name', () => {
  const before = [{ name: 'Alpha 1', data: plane(6, 255) }];
  const { channels, index } = newChannel(before, 6);
  assert.equal(index, 1);
  assert.equal(channels.length, 2);
  assert.equal(channels[1].name, 'Alpha 2');
  assert.deepEqual([...channels[1].data], [0, 0, 0, 0, 0, 0]);
  assert.equal(before.length, 1, 'the input list is not mutated');
  assert.equal(channels[0], before[0]);
  assert.equal(newChannel([], 4).channels[0].name, 'Alpha 1');
});

function mount(opts = {}) {
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
    onDelete() {},
    onNew: () => calls.push('new'),
    ...opts
  });
  return { container, calls };
}

test('the Channels footer is Load, Save, New, Delete as in PhotoCraft', () => {
  const { container } = mount();
  const footer = container.querySelector('.layer-panel-footer');
  const actions = [...footer.querySelectorAll('button')].map((b) => b.dataset.action);
  assert.deepEqual(actions, ['load', 'save', 'new', 'delete']);
  const btn = footer.querySelector('[data-action="new"]');
  assert.equal(btn.type, 'button');
  assert.equal(btn.title, 'Create new channel');
  assert.equal(btn.getAttribute('aria-label'), 'Create new channel');
  assert.ok(btn.querySelector('svg'), 'plus icon from paint/icons.js');
  assert.equal(btn.disabled, false, 'New needs no target or selection');
});

test('clicking New calls onNew', () => {
  const { container, calls } = mount();
  container.querySelector('[data-action="new"]').click();
  assert.deepEqual(calls, ['new']);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { duplicateChannel, renderChannelsPanel } from '../paint/channels.js';

const plane = (n, v) => new Uint8Array(n).fill(v);

test('duplicateChannel appends "<name> copy" with its own plane', () => {
  const before = [{ name: 'Alpha 1', data: plane(4, 200) }];
  const { channels, index } = duplicateChannel(before, 0);
  assert.equal(index, 1);
  assert.equal(channels.length, 2);
  assert.equal(channels[1].name, 'Alpha 1 copy');
  assert.deepEqual([...channels[1].data], [200, 200, 200, 200]);
  assert.notEqual(channels[1].data, before[0].data, 'the copy owns its plane');
  assert.equal(before.length, 1, 'the input list is not mutated');
  assert.equal(duplicateChannel(before, 3).channels, before, 'a missing index changes nothing');
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
    onNew: () => calls.push(['new']),
    onDelete: (i) => calls.push(['delete', i]),
    onDuplicate: (i) => calls.push(['duplicate', i]),
    onRename: (i, name) => calls.push(['rename', i, name])
  });
  const menuAt = (el) => {
    el.dispatchEvent(
      new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 })
    );
    return doc.querySelector('.channel-menu[role="menu"]');
  };
  const item = (menu, label) =>
    [...menu.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent === label);
  return { doc, container, calls, menuAt, item };
}

test('right-clicking an alpha channel lists Duplicate, Delete, Rename, Options, overlay, and New', () => {
  const { container, menuAt } = mount();
  const menu = menuAt(container.querySelector('[data-channel="0"]'));
  assert.ok(menu, 'a channel context menu opens');
  const labels = [...menu.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent);
  assert.deepEqual(labels, [
    'Duplicate Channel',
    'Delete Channel',
    'Rename Channel…',
    'Channel Options…',
    '✓ Color Indicates Masked Areas',
    'Color Indicates Selected Areas',
    'Overlay Color',
    'Overlay Opacity',
    'New Channel…'
  ]);
});

test('menu items run the channel commands and close the menu', () => {
  const { doc, container, calls, menuAt, item } = mount();
  const row = () => container.querySelector('[data-channel="0"]');
  item(menuAt(row()), 'Duplicate Channel').click();
  assert.equal(doc.querySelector('.channel-menu'), null, 'picking an item closes the menu');
  item(menuAt(row()), 'Delete Channel').click();
  item(menuAt(row()), 'New Channel…').click();
  assert.deepEqual(calls, [['duplicate', 0], ['delete', 0], ['new']]);
});

test('Rename Channel… opens the inline name field', () => {
  const { container, menuAt, item } = mount();
  const row = container.querySelector('[data-channel="0"]');
  item(menuAt(row), 'Rename Channel…').click();
  const input = row.querySelector('input.channel-rename');
  assert.ok(input, 'inline field, not window.prompt');
  assert.equal(input.value, 'Alpha 1');
});

test('color rows offer Duplicate Channel and New Channel… (no alpha commands)', () => {
  const { container, menuAt } = mount();
  const menu = menuAt(container.querySelector('.channel-row.composite'));
  assert.ok(menu);
  const labels = [...menu.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent);
  assert.deepEqual(labels, ['Duplicate Channel', 'New Channel…']);
});

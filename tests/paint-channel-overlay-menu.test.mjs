import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { CHANNEL_OVERLAY_COLORS, renderChannelsPanel } from '../paint/channels.js';

// channels_panel.rs overlay_colors presets, in menu order.
test('CHANNEL_OVERLAY_COLORS are PhotoCraft presets in menu order', () => {
  assert.deepEqual(CHANNEL_OVERLAY_COLORS, [
    { label: 'Red', color: '#ff0000' },
    { label: 'Green', color: '#00c000' },
    { label: 'Blue', color: '#0050ff' },
    { label: 'Cyan', color: '#00d0e0' },
    { label: 'Magenta', color: '#e000c0' },
    { label: 'Yellow', color: '#f0d000' }
  ]);
});

function openMenu(channel) {
  const { window } = new JSDOM('<!doctype html><div id="c"></div>');
  const doc = window.document;
  const container = doc.getElementById('c');
  const calls = [];
  renderChannelsPanel(container, [channel], {
    target: null,
    canSave: false,
    onTarget() {},
    onLoad() {},
    onSave() {},
    onNew() {},
    onDelete() {},
    onOptions() {},
    onSetOptions: (i, options) => calls.push([i, options])
  });
  const row = container.querySelector('[data-channel="0"]');
  row.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  const items = () => [...doc.querySelectorAll('.channel-menu [role="menuitem"]')];
  const pick = (label) => {
    const el = items().find((b) => b.textContent === label);
    assert.ok(el, `menu item ${label}`);
    el.click();
  };
  return { doc, calls, items, pick };
}

test('the alpha menu checks the current Color Indicates after Channel Options…', () => {
  const { items, pick, calls } = openMenu({ name: 'Alpha 1', data: new Uint8Array(2) });
  const labels = items().map((b) => b.textContent);
  const at = labels.indexOf('Channel Options…');
  assert.equal(labels[at + 1], '✓ Color Indicates Masked Areas');
  assert.equal(labels[at + 2], 'Color Indicates Selected Areas');
  assert.equal(labels[at + 3], 'Overlay Color');
  assert.equal(labels[at + 4], 'Overlay Opacity');
  pick('Color Indicates Selected Areas');
  assert.deepEqual(calls, [[0, { indicates: 'selected' }]]);

  const sel = openMenu({ name: 'A', data: new Uint8Array(2), indicates: 'selected' });
  const selLabels = sel.items().map((b) => b.textContent);
  assert.ok(selLabels.includes('Color Indicates Masked Areas'));
  assert.ok(selLabels.includes('✓ Color Indicates Selected Areas'));
});

test('Overlay Color and Overlay Opacity open submenus that set the option', () => {
  const { doc, items, pick, calls } = openMenu({ name: 'Alpha 1', data: new Uint8Array(2) });
  const color = items().find((b) => b.textContent === 'Overlay Color');
  assert.equal(color.getAttribute('aria-haspopup'), 'menu');
  color.click();
  assert.ok(doc.querySelector('.channel-menu'), 'the menu stays open on a submenu item');
  pick('Blue');
  assert.deepEqual(calls, [[0, { color: '#0050ff' }]]);
  assert.equal(doc.querySelector('.channel-menu'), null, 'a leaf closes the menu');

  const again = openMenu({ name: 'Alpha 1', data: new Uint8Array(2) });
  again.pick('Overlay Opacity');
  const pct = again.items().map((b) => b.textContent).filter((t) => t.endsWith('%'));
  assert.deepEqual(pct, ['25%', '50%', '75%', '100%']);
  again.pick('75%');
  assert.deepEqual(again.calls, [[0, { opacity: 75 }]]);
});

test('color rows do not list the overlay items', () => {
  const { window } = new JSDOM('<!doctype html><div id="c"></div>');
  const doc = window.document;
  const container = doc.getElementById('c');
  renderChannelsPanel(container, [], {
    target: null,
    canSave: false,
    onTarget() {},
    onLoad() {},
    onSave() {},
    onNew() {},
    onDelete() {}
  });
  const row = container.querySelector('.channel-row');
  row.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  const labels = [...doc.querySelectorAll('.channel-menu [role="menuitem"]')].map(
    (b) => b.textContent
  );
  assert.ok(!labels.includes('Overlay Color'));
  assert.ok(!labels.some((t) => t.includes('Color Indicates')));
});

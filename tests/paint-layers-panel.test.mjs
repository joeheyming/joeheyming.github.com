import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { iconSvg } from '../paint/icons.js';

// The Layers panel follows PhotoCraft (panels.rs): blend mode and Opacity above the list, rows
// of eye / thumbnail / mask / name, an icon footer, and inline rename.

async function withPanel(fn) {
  const { window } = new JSDOM('<!doctype html><body><div id="layers"></div></body>');
  const prev = globalThis.document;
  globalThis.document = window.document;
  try {
    const noop = new Proxy({}, { get: () => () => {} });
    window.HTMLCanvasElement.prototype.getContext = () => noop;
    const { renderLayerPanel } = await import('../paint/layers.js');
    const doc = window.document;
    const canvas = doc.createElement('canvas');
    const layers = [
      { id: 1, name: 'Background', visible: true, opacity: 1, blendMode: 'source-over', canvas },
      { id: 2, name: 'Layer 2', visible: true, opacity: 0.4, blendMode: 'multiply', canvas }
    ];
    const calls = [];
    const callbacks = new Proxy(
      {},
      { get: (_, key) => (key === 'maskTarget' ? false : (...args) => calls.push([key, ...args])) }
    );
    const container = doc.getElementById('layers');
    const render = (active) => renderLayerPanel(layers, active, container, callbacks);
    render(1);
    await fn({ doc, window, container, layers, calls, render });
  } finally {
    globalThis.document = prev;
  }
}

test('blend mode and Opacity above the list reflect the active layer', async () => {
  await withPanel(({ container, calls, render }) => {
    const header = container.querySelector('.layer-panel-header');
    assert.ok(header, 'header row');
    // Filter row is first; blend/Opacity header still sits above the scrolling list.
    assert.deepEqual(
      [...container.children].map((el) => el.className),
      ['layer-filter-row', 'layer-panel-header', 'layer-list', 'layer-panel-footer']
    );
    assert.equal(header.querySelector('.layer-blend').value, 'multiply');
    assert.equal(header.querySelector('.layer-opacity').value, '40');

    const opacity = header.querySelector('.layer-opacity');
    opacity.value = '75';
    opacity.dispatchEvent(new opacity.ownerDocument.defaultView.Event('change'));
    assert.deepEqual(calls.at(-1), ['onOpacityChange', 1, 0.75]);

    render(0);
    assert.equal(container.querySelector('.layer-blend').value, 'source-over');
    assert.equal(container.querySelector('.layer-opacity').value, '100');
    // One header, not a control on every row.
    assert.equal(container.querySelectorAll('.layer-blend').length, 1);
    assert.equal(container.querySelectorAll('.layer-opacity').length, 1);
  });
});

test('rows show eye, thumbnail, and name only', async () => {
  await withPanel(({ container }) => {
    const rows = [...container.querySelectorAll('.layer-row')];
    assert.equal(rows.length, 2);
    assert.equal(rows[0].querySelector('.layer-name').textContent, 'Layer 2', 'top layer first');
    for (const row of rows) {
      assert.deepEqual(
        [...row.children].map((el) => el.className.split(' ')[0]),
        ['layer-vis-btn', 'layer-thumb', 'layer-name']
      );
    }
  });
});

test('footer buttons follow PhotoCraft order with icons.js svgs', async () => {
  await withPanel(({ container }) => {
    const footer = container.querySelector('.layer-panel-footer');
    assert.equal(container.lastElementChild, footer);
    const buttons = [...footer.querySelectorAll('button')];
    assert.deepEqual(
      buttons.map((b) => b.dataset.action),
      ['link', 'fx', 'mask', 'adjustment', 'group', 'new', 'delete']
    );
    const icons = [
      'link-2',
      'fx',
      'layer-mask',
      'adjustment-layer',
      'folder',
      'square-plus',
      'trash'
    ];
    buttons.forEach((b, k) => {
      const svg = b.querySelector('svg');
      assert.ok(svg, `${b.dataset.action} has an svg`);
      assert.equal(svg.innerHTML, iconSvg(icons[k]).innerHTML, b.dataset.action);
      assert.equal(b.textContent.replace(/fx/, ''), '', 'no text label besides the fx glyph');
    });
    const disabled = Object.fromEntries(buttons.map((b) => [b.dataset.action, b.disabled]));
    assert.deepEqual(disabled, {
      link: false,
      fx: false,
      mask: false,
      adjustment: false,
      group: false,
      new: false,
      delete: false
    });
  });
});

test('footer buttons run their commands', async () => {
  await withPanel(({ doc, container, calls }) => {
    const btn = (a) => container.querySelector(`.layer-footer-btn[data-action="${a}"]`);
    btn('new').click();
    assert.deepEqual(calls.at(-1), ['onAdd']);
    btn('delete').click();
    assert.deepEqual(calls.at(-1), ['onDelete', 1]);
    btn('mask').click();
    assert.deepEqual(calls.at(-1), ['onAddMask', false]);

    btn('adjustment').click();
    const menu = doc.querySelector('.layer-popup-menu');
    assert.ok(menu, 'adjustment menu opens');
    const items = [...menu.querySelectorAll('button')].map((b) => b.textContent);
    // The three fill layers come first, then the adjustments.
    assert.deepEqual(items.slice(0, 4), [
      'Solid Color…',
      'Gradient…',
      'Pattern…',
      'Brightness / Contrast'
    ]);
    assert.ok(items.includes('Curves'));
    menu.querySelectorAll('button')[5].click();
    assert.deepEqual(calls.at(-1), ['onNewAdjustment', 'curves']);
    assert.equal(doc.querySelector('.layer-popup-menu'), null, 'picking closes the menu');
  });
});

test('double-clicking a name renames inline', async () => {
  await withPanel(({ doc, window, container, layers, calls }) => {
    const prompt = () => assert.fail('window.prompt must not be used');
    window.prompt = prompt;
    globalThis.prompt = prompt;
    try {
      const name = container.querySelector('.layer-row .layer-name');
      name.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
      const input = container.querySelector('.layer-row .layer-name-input');
      assert.ok(input, 'name turns into a text field');
      assert.equal(input.value, 'Layer 2');
      assert.equal(doc.activeElement, input);

      input.value = '  Sky  ';
      input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      assert.equal(layers[1].name, 'Sky');
      assert.deepEqual(calls.at(-1), ['onRename', 1, 'Sky']);
      assert.equal(container.querySelector('.layer-name-input'), null);
      assert.equal(container.querySelector('.layer-row .layer-name').textContent, 'Sky');

      // Escape keeps the old name.
      const again = container.querySelector('.layer-row .layer-name');
      again.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
      const input2 = container.querySelector('.layer-name-input');
      input2.value = 'Nope';
      const before = calls.length;
      input2.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      assert.equal(layers[1].name, 'Sky');
      assert.equal(calls.length, before);
    } finally {
      delete globalThis.prompt;
    }
  });
});

test('dragging a row onto another moves the layer; right-click offers layer commands', async () => {
  await withPanel(({ doc, window, container, calls }) => {
    const [top, bottom] = container.querySelectorAll('.layer-row');
    top.dispatchEvent(new window.Event('dragstart'));
    bottom.dispatchEvent(new window.Event('drop', { cancelable: true }));
    assert.deepEqual(calls.at(-1), ['onMove', 1, 0]);

    bottom.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    const items = [...doc.querySelectorAll('.layer-popup-menu button')];
    assert.deepEqual(
      items.map((b) => b.textContent),
      ['Duplicate Layer', 'Delete Layer', 'Merge Down', 'Flatten Image']
    );
    assert.equal(items[2].disabled, true, 'the bottom layer cannot merge down');
    items[3].click();
    assert.deepEqual(calls.at(-1), ['onFlatten']);
  });
});

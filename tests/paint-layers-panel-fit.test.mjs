import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

// The Layers panel keeps PhotoCraft's footer on screen: the list is the only scroller, the
// footer sits outside it, and the Layers group keeps a minimum height while the others shrink.

const css =
  readFileSync(new URL('../paint/dock.css', import.meta.url), 'utf8') +
  '\n' +
  readFileSync(new URL('../paint/panels.css', import.meta.url), 'utf8');
const rule = (selector) => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`(?:^|\\n)${esc} \\{([^}]*)\\}`));
  assert.ok(m, `rule ${selector}`);
  return m[1];
};

test('footer sits outside the list with the seven actions in order', async () => {
  const { window } = new JSDOM(
    '<!doctype html><body><div id="panel-layers"><div id="layer-list-container"></div></div></body>'
  );
  const prev = globalThis.document;
  globalThis.document = window.document;
  try {
    const noop = new Proxy({}, { get: () => () => {} });
    window.HTMLCanvasElement.prototype.getContext = () => noop;
    const { renderLayerPanel } = await import('../paint/layers.js');
    const doc = window.document;
    const layers = [
      {
        id: 1,
        name: 'Background',
        visible: true,
        opacity: 1,
        blendMode: 'source-over',
        canvas: doc.createElement('canvas')
      }
    ];
    const calls = [];
    const callbacks = new Proxy(
      {},
      {
        get: (_, key) => {
          if (key === 'maskTarget' || key === 'layerFilter') return undefined;
          return (...args) => calls.push([key, ...args]);
        }
      }
    );
    const container = doc.getElementById('layer-list-container');
    renderLayerPanel(layers, 0, container, callbacks);

    const header = container.querySelector('.layer-panel-header');
    const list = container.querySelector('.layer-list');
    const footer = container.querySelector('.layer-panel-footer');
    assert.ok(header && list && footer);
    assert.equal(list.contains(footer), false, 'footer is not inside the list');
    assert.equal(list.contains(header), false, 'header is not inside the list');
    assert.deepEqual(
      [...container.children].map((el) => el.className),
      ['layer-filter-row', 'layer-panel-header', 'layer-list', 'layer-panel-footer']
    );
    assert.equal(list.querySelectorAll('.layer-row').length, 1);

    const actions = [...footer.querySelectorAll('.layer-footer-btn')].map((b) => b.dataset.action);
    assert.deepEqual(actions, ['link', 'fx', 'mask', 'adjustment', 'group', 'new', 'delete']);

    const btn = (a) => footer.querySelector(`[data-action="${a}"]`);
    assert.match(btn('new').title, /Create a new layer \((⇧⌘N|⌘⇧N|Ctrl\+Shift\+N)\)/);
    btn('new').click();
    btn('group').click();
    assert.deepEqual(
      calls.map((c) => c[0]),
      ['onAdd', 'onNewGroup']
    );
  } finally {
    globalThis.document = prev;
  }
});

test('the list scrolls and the footer is pinned', () => {
  const list = rule('.layer-list');
  assert.match(list, /flex:\s*1/);
  assert.match(list, /overflow:\s*auto/);
  assert.match(rule('.layer-panel-footer'), /flex-shrink:\s*0/);
  assert.match(rule('.layer-panel-header'), /flex-shrink:\s*0/);
  const panel = rule('#panel-layers:not([hidden])');
  assert.match(panel, /display:\s*flex/);
  assert.match(panel, /flex-direction:\s*column/);
});

test('other dock groups cap their height and the Layers group keeps 220px', () => {
  const group = rule('.dock-group');
  assert.match(group, /overflow:\s*hidden/);
  assert.match(group, /min-height:\s*0/);
  const capped = rule('.dock-group:not(.dock-group-fill)');
  assert.match(capped, /max-height:\s*140px/);
  const fill = rule('.dock-group-fill');
  assert.match(fill, /min-height:\s*220px/);
  assert.match(fill, /flex:\s*1 1 0%/);
});

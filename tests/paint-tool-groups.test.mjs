import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { TOOLS, TOOL_GROUPS, toolForKey, toolKey } from '../paint/tools.js';
import { buildToolbar, selectToolbarTool, slotTool } from '../paint/ui.js';

const EMOJI = /\p{Extended_Pictographic}/u;

function withDocument(html, fn) {
  const { window } = new JSDOM(`<!doctype html><body>${html}</body>`);
  const prev = globalThis.document;
  globalThis.document = window.document;
  const restore = () => {
    globalThis.document = prev;
  };
  let out;
  try {
    out = fn(window.document, window);
  } catch (e) {
    restore();
    throw e;
  }
  if (out?.then) return out.finally(restore);
  restore();
  return out;
}

test('every tool sits in exactly one group', () => {
  const flat = TOOL_GROUPS.flat();
  assert.equal(new Set(flat).size, flat.length, 'a tool is in two groups');
  assert.deepEqual([...flat].sort(), Object.keys(TOOLS).sort());
});

test('groups follow PhotoCraft toolbox order', () => {
  assert.deepEqual(
    TOOL_GROUPS.map((g) => g[0]),
    [
      'select',
      'rectSelect',
      'lasso',
      'quickSelection',
      'crop',
      'eyedropper',
      'spotHealing',
      'brush',
      'cloneStamp',
      'historyBrush',
      'eraser',
      'gradient',
      'blur',
      'dodge',
      'text',
      'pen',
      'pathSelection',
      'rect',
      'hand',
      'zoom'
    ]
  );
  assert.deepEqual(TOOL_GROUPS[1], [
    'rectSelect',
    'ellipseSelect',
    'singleRowMarquee',
    'singleColumnMarquee'
  ]);
  assert.deepEqual(TOOL_GROUPS[6], ['spotHealing', 'healingBrush', 'patch', 'redEye']);
});

test('tool labels read like PhotoCraft names', () => {
  assert.equal(TOOLS.rectSelect.label, 'Rectangular Marquee');
  assert.equal(TOOLS.ellipseSelect.label, 'Elliptical Marquee');
  assert.equal(TOOLS.lasso.label, 'Lasso');
  assert.equal(TOOLS.magicWand.label, 'Magic Wand');
  assert.equal(TOOLS.fill.label, 'Paint Bucket');
  assert.equal(TOOLS.text.label, 'Horizontal Type');
  assert.equal(TOOLS.rect.label, 'Rectangle');
  for (const tool of Object.values(TOOLS)) assert.doesNotMatch(tool.label, /[()]/);
});

test('buildToolbar renders one .tool-btn per group with a flyout triangle on groups', () => {
  withDocument('<div id="tools"></div>', (doc) => {
    const container = doc.getElementById('tools');
    buildToolbar(TOOLS, { tool: 'brush' }, container, () => {});
    const buttons = [...container.querySelectorAll('.tool-btn')];
    assert.equal(buttons.length, TOOL_GROUPS.length);
    buttons.forEach((btn, g) => {
      assert.equal(btn.dataset.tool, TOOL_GROUPS[g][0]);
      assert.equal(btn.classList.contains('has-flyout'), TOOL_GROUPS[g].length > 1);
      assert.ok(btn.querySelector('svg'));
    });
    assert.equal(container.querySelector('.tool-btn.active').dataset.tool, 'brush');
    assert.equal(buttons[1].title, 'Rectangular Marquee Tool (M)');
  });
});

test('the flyout lists the group tools with name and key, and picking sets the slot', () => {
  withDocument('<div id="tools"></div>', (doc, window) => {
    const container = doc.getElementById('tools');
    const picked = [];
    buildToolbar(TOOLS, { tool: 'brush' }, container, (id) => picked.push(id));
    const btn = container.querySelector('.tool-btn[data-group="1"]');
    const flyout = btn.parentElement.querySelector('.tool-flyout');
    assert.ok(flyout.hidden);
    btn.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    assert.equal(flyout.hidden, false);
    const items = [...flyout.querySelectorAll('.tool-flyout-item')];
    assert.deepEqual(
      items.map((i) => i.dataset.tool),
      TOOL_GROUPS[1]
    );
    assert.deepEqual(
      items.map((i) => i.querySelector('.tool-flyout-name').textContent),
      [
        'Rectangular Marquee Tool',
        'Elliptical Marquee Tool',
        'Single Row Marquee Tool',
        'Single Column Marquee Tool'
      ]
    );
    assert.deepEqual(
      items.map((i) => i.querySelector('.tool-flyout-key').textContent),
      ['M', 'M', '', '']
    );
    for (const i of items) assert.ok(i.querySelector('svg'));
    items[1].click();
    assert.deepEqual(picked, ['ellipseSelect']);
    assert.ok(flyout.hidden);
    assert.equal(btn.dataset.tool, 'ellipseSelect');
    assert.ok(btn.classList.contains('active'));
    assert.equal(slotTool(container, 1), 'ellipseSelect');
    // A one-tool slot has no flyout (historyBrush is alone in its group).
    const historyBrush = container.querySelector('.tool-btn[data-group="9"]');
    assert.equal(historyBrush.parentElement.querySelector('.tool-flyout'), null);
  });
});

test('a 300 ms press opens the flyout and the release does not pick the tool', async () => {
  await withDocument('<div id="tools"></div>', async (doc, window) => {
    const container = doc.getElementById('tools');
    const picked = [];
    buildToolbar(TOOLS, { tool: 'brush' }, container, (id) => picked.push(id));
    const btn = container.querySelector('.tool-btn[data-group="2"]');
    const flyout = btn.parentElement.querySelector('.tool-flyout');
    const down = new window.MouseEvent('pointerdown', { bubbles: true, button: 0 });
    btn.dispatchEvent(down);
    await new Promise((r) => setTimeout(r, 350));
    assert.equal(flyout.hidden, false);
    btn.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true }));
    btn.click();
    assert.deepEqual(picked, []);
    btn.click();
    assert.deepEqual(picked, ['lasso']);
  });
});

test('selectToolbarTool moves the slot icon to a tool picked elsewhere', () => {
  withDocument('<div id="tools"></div>', (doc) => {
    const container = doc.getElementById('tools');
    buildToolbar(TOOLS, { tool: 'brush' }, container, () => {});
    selectToolbarTool(container, 'pencil');
    const btn = container.querySelector('.tool-btn[data-group="7"]');
    assert.equal(btn.dataset.tool, 'pencil');
    assert.equal(btn.title, 'Pencil Tool (B)');
    assert.ok(btn.classList.contains('active'));
    assert.equal(container.querySelectorAll('.tool-btn.active').length, 1);
  });
});

test('Shift+letter cycles inside the key group; a plain letter keeps the slot tool', () => {
  assert.equal(toolForKey('M', true, 'rectSelect'), 'ellipseSelect');
  assert.equal(toolForKey('M', true, 'ellipseSelect'), 'rectSelect');
  assert.equal(toolForKey('m', false, 'ellipseSelect'), 'ellipseSelect');
  assert.equal(toolForKey('L', true, 'lasso'), 'polyLasso');
  assert.equal(toolForKey('J', true, 'spotHealing'), 'healingBrush');
  assert.equal(toolForKey('J', true, 'redEye'), 'spotHealing');
  // From another group: the slot's current tool, else the first in the key group.
  assert.equal(toolForKey('m', false, 'brush'), 'rectSelect');
  assert.equal(
    toolForKey('m', false, 'brush', () => 'ellipseSelect'),
    'ellipseSelect'
  );
  assert.equal(
    toolForKey('m', true, 'brush', () => 'singleRowMarquee'),
    'rectSelect'
  );
  assert.equal(toolForKey('b', false, 'eraser'), 'brush');
  assert.equal(toolForKey('g', false, 'brush'), 'gradient');
  assert.equal(toolForKey('u', false, 'brush'), 'rect');
  assert.equal(toolForKey('q', false, 'brush'), null);
  assert.equal(toolKey('blur'), '');
});

test('the layer eye button is an svg, not an emoji', async () => {
  await withDocument('<div id="layers"></div>', async (doc, window) => {
    const noop = new Proxy({}, { get: () => () => {} });
    window.HTMLCanvasElement.prototype.getContext = () => noop;
    const { renderLayerPanel } = await import('../paint/layers.js');
    const canvas = doc.createElement('canvas');
    const layers = [
      { id: 1, name: 'Background', visible: true, opacity: 1, canvas },
      { id: 2, name: 'Layer 1', visible: false, opacity: 1, canvas }
    ];
    const container = doc.getElementById('layers');
    renderLayerPanel(layers, 0, container, {});
    const eyes = [...container.querySelectorAll('.layer-vis-btn')];
    assert.equal(eyes.length, 2);
    for (const eye of eyes) {
      assert.ok(eye.querySelector('svg'));
      assert.doesNotMatch(eye.textContent, EMOJI);
      assert.doesNotMatch(eye.textContent, /◌/);
    }
    assert.equal(eyes[0].getAttribute('aria-pressed'), 'false');
    assert.equal(eyes[1].getAttribute('aria-pressed'), 'true');
  });
});

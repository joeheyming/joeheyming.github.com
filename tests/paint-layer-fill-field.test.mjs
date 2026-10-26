import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

// The Layers panel Lock: row ends in PhotoCraft's Fill: field (panels.rs). It edits the same
// styles.fillOpacity as Layer Style › Blending Options.
const { window } = new JSDOM('<!doctype html><body><div id="layers"></div></body>');
globalThis.document = window.document;
globalThis.window = window;
const noop = new Proxy({}, { get: () => () => {} });
window.HTMLCanvasElement.prototype.getContext = () => noop;

const { renderLayerPanel } = await import('../paint/layers.js');
const { setFillOpacity, fillOpacityOf, drawsStyle, normalizeStyles } = await import(
  '../paint/layer-style.js'
);
const { historyIconName } = await import('../paint/history.js');
const { isStackUndoLabel } = await import('../paint/stack-history.js');

const paintSrc = readFileSync(new URL('../paint/paint.js', import.meta.url), 'utf8');

function render(layers, active, extra = {}) {
  const container = document.getElementById('layers');
  container.innerHTML = '';
  const calls = [];
  const callbacks = new Proxy(
    { onFillChange: (idx, v) => calls.push([idx, v]), ...extra },
    { get: (t, k) => t[k] ?? (() => {}) }
  );
  renderLayerPanel(layers, active, container, callbacks);
  return { container, calls };
}

const pixel = (styles = null) => ({
  id: 1,
  name: 'Layer 1',
  visible: true,
  opacity: 1,
  canvas: document.createElement('canvas'),
  styles
});

test('the Fill field follows the lock buttons and shows the layer fill', () => {
  const { container } = render([pixel({ enabled: true, fillOpacity: 40 })], 0);
  const row = container.querySelector('.layer-lock-row');
  const fill = row.querySelector('input.layer-fill');
  assert.ok(fill);
  assert.equal(fill.type, 'number');
  assert.equal(fill.min, '0');
  assert.equal(fill.max, '100');
  assert.equal(fill.getAttribute('aria-label'), 'Fill');
  assert.equal(fill.value, '40');
  assert.equal(fill.disabled, false);
  const wrap = fill.closest('.layer-fill-wrap');
  assert.match(wrap.textContent, /^Fill:/);
  const locks = [...row.querySelectorAll('.layer-lock-btn')];
  assert.equal(locks.length, 4);
  const last = locks[locks.length - 1];
  assert.ok(last.compareDocumentPosition(wrap) & window.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.equal(row.lastElementChild, wrap);
});

test('a layer with no styles shows 100', () => {
  const { container } = render([pixel()], 0);
  assert.equal(container.querySelector('input.layer-fill').value, '100');
});

test('a change clamps to 0..100 and reports a fraction', () => {
  const { container, calls } = render([pixel()], 0);
  const fill = container.querySelector('input.layer-fill');
  for (const v of ['55', '250', '-20']) {
    fill.value = v;
    fill.dispatchEvent(new window.Event('change'));
  }
  assert.deepEqual(calls, [
    [0, 0.55],
    [0, 1],
    [0, 0]
  ]);
});

test('the field is disabled on layers that cannot have a style', () => {
  const group = { ...pixel(), kind: 'group', children: [], collapsed: false };
  const { container } = render([group], 0);
  assert.equal(container.querySelector('input.layer-fill').disabled, true);
  for (const kind of ['adjustment', 'type', 'shape']) {
    const layer = { ...pixel(), kind, adjustmentId: 'invert', params: {} };
    const r = render([layer], 0);
    assert.equal(r.container.querySelector('input.layer-fill').disabled, true, kind);
  }
});

test('setFillOpacity writes the percent, keeps effects, and drops the key at 100', () => {
  const layer = { kind: 'pixel', styles: null };
  setFillOpacity(layer, 0.3);
  assert.equal(layer.styles.fillOpacity, 30);
  assert.equal(fillOpacityOf(layer.styles), 0.3);
  assert.equal(drawsStyle(layer), true);

  const fx = normalizeStyles({ dropShadow: { enabled: true } });
  const styled = { kind: 'pixel', styles: fx };
  setFillOpacity(styled, 0.5);
  assert.equal(styled.styles.fillOpacity, 50);
  assert.equal(styled.styles.dropShadow.enabled, true);
  setFillOpacity(styled, 1);
  assert.equal('fillOpacity' in styled.styles, false);
  assert.equal(styled.styles.dropShadow.enabled, true);

  setFillOpacity(layer, 1);
  assert.equal(layer.styles, null);
  assert.equal(drawsStyle(layer), false);
});

test('paint.js pushes Fill Opacity undo before writing the fill', () => {
  assert.match(paintSrc, /onFillChange: setLayerFillOpacity/);
  const body = paintSrc.slice(paintSrc.indexOf('function setLayerFillOpacity('));
  const undo = body.indexOf("pushUndo('Fill Opacity')");
  const write = body.indexOf('setFillOpacity(layer, fill)');
  assert.ok(undo > 0 && write > undo);
  assert.equal(historyIconName('Fill Opacity'), 'fx');
  assert.equal(isStackUndoLabel('Fill Opacity'), true);
});

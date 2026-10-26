import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { TOOL_OPTION_SCHEMA, defaultToolOptions, floodSelect } from '../paint/tools.js';
import { renderToolOptions } from '../paint/ui.js';

test('Magic Wand options follow PhotoCraft: mode, Tolerance, Anti-alias, Contiguous', () => {
  const schema = TOOL_OPTION_SCHEMA.magicWand;
  assert.deepEqual(
    schema.map((o) => o.key),
    ['selectionMode', 'tolerance', 'antiAlias', 'contiguous', 'sampleAllLayers']
  );
  const [, tolerance, antiAlias, contiguous] = schema;
  assert.equal(tolerance.type, 'number');
  assert.equal(tolerance.label, 'Tolerance');
  assert.equal(tolerance.min, 0);
  assert.equal(tolerance.max, 255);
  assert.equal(tolerance.default, 32);
  assert.equal(antiAlias.type, 'checkbox');
  assert.equal(antiAlias.label, 'Anti-alias');
  assert.equal(antiAlias.default, true);
  assert.ok(!antiAlias.disabled);
  assert.equal(contiguous.type, 'checkbox');
  assert.equal(contiguous.default, true);
  const defaults = defaultToolOptions().magicWand;
  assert.equal(defaults.tolerance, 32);
  assert.equal(defaults.antiAlias, true);
  assert.equal(defaults.contiguous, true);
});

// 6 x 1 strip whose red steps 0, 20, 31, 32, 33, 60 away from the clicked pixel.
function fakeCtx() {
  const W = 6;
  const H = 1;
  const data = new Uint8ClampedArray(W * H * 4);
  [0, 20, 31, 32, 33, 60].forEach((r, i) => {
    data[i * 4] = r;
    data[i * 4 + 3] = 255;
  });
  return {
    canvas: { width: W, height: H },
    getImageData: () => ({ width: W, height: H, data: new Uint8ClampedArray(data) })
  };
}

test('floodSelect defaults to a tolerance of 32', () => {
  const explicit = floodSelect(fakeCtx(), 0, 0, 32);
  const implicit = floodSelect(fakeCtx(), 0, 0);
  assert.deepEqual(implicit, explicit);
  assert.deepEqual([implicit.x, implicit.w], [0, 4]);
});

test('renderToolOptions builds Tolerance, an enabled Anti-alias, then Contiguous', () => {
  const { window } = new JSDOM('<!doctype html><div id="opts"></div>');
  const prev = globalThis.document;
  globalThis.document = window.document;
  try {
    const container = window.document.getElementById('opts');
    const values = { ...defaultToolOptions().magicWand };
    renderToolOptions(TOOL_OPTION_SCHEMA.magicWand, values, container, (k, v) => (values[k] = v));
    const tol = container.querySelector('#opt-tolerance');
    const aa = container.querySelector('#opt-antiAlias');
    const cont = container.querySelector('#opt-contiguous');
    assert.ok(tol && aa && cont);
    const follows = (a, b) => !!(a.compareDocumentPosition(b) & 4);
    assert.ok(follows(tol, aa));
    assert.ok(follows(aa, cont));
    assert.equal(tol.type, 'number');
    assert.equal(tol.value, '32');
    assert.equal(aa.type, 'checkbox');
    assert.equal(aa.checked, true);
    assert.equal(aa.disabled, false);
    assert.equal(cont.checked, true);
  } finally {
    globalThis.document = prev;
  }
});

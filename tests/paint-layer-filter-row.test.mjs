import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

// The Layers panel filter row (PhotoCraft layer_filter_ui.rs): Kind toggles, a Name search, or one
// blend Mode. It only hides rows; the stack and the composite are untouched.
const { window } = new JSDOM('<!doctype html><body><div id="layers"></div></body>');
globalThis.document = window.document;
globalThis.window = window;
const noop = new Proxy({}, { get: () => () => {} });
window.HTMLCanvasElement.prototype.getContext = () => noop;

const { renderLayerPanel, BLEND_MODES } = await import('../paint/layers.js');
const { layerFilterShows, layerFilterActive, defaultLayerFilter } = await import(
  '../paint/layer-filter.js'
);

const paintSrc = readFileSync(new URL('../paint/paint.js', import.meta.url), 'utf8');

const layer = (name, extra = {}) => ({
  id: name,
  name,
  visible: true,
  opacity: 1,
  blendMode: 'source-over',
  canvas: document.createElement('canvas'),
  ...extra
});

const pixel = layer('Background');
const adjust = layer('Levels 1', { kind: 'adjustment', adjustmentId: 'invert', params: {} });
const fill = layer('Color Fill 1', { kind: 'fill', fill: { type: 'solid', color: '#ff0000' } });
const type = layer('Hello', { kind: 'type' });
const shape = layer('Rectangle 1', { kind: 'shape' });
const smart = layer('Photo', { kind: 'smart' });
const group = layer('Group 1', {
  kind: 'group',
  blendMode: 'pass-through',
  children: [],
  collapsed: false
});

const kindFilter = (...kinds) => ({ ...defaultLayerFilter(), kinds });

test('Kind matches each layer kind and no kind matches a group', () => {
  assert.equal(layerFilterShows(kindFilter('pixel'), pixel), true);
  assert.equal(layerFilterShows(kindFilter('pixel'), { name: 'old' }), true);
  assert.equal(layerFilterShows(kindFilter('pixel'), type), false);
  assert.equal(layerFilterShows(kindFilter('adjustment'), adjust), true);
  assert.equal(layerFilterShows(kindFilter('adjustment'), fill), true);
  assert.equal(layerFilterShows(kindFilter('adjustment'), pixel), false);
  assert.equal(layerFilterShows(kindFilter('type'), type), true);
  assert.equal(layerFilterShows(kindFilter('shape'), shape), true);
  assert.equal(layerFilterShows(kindFilter('smart'), smart), true);
  assert.equal(layerFilterShows(kindFilter('type', 'shape'), shape), true);
  assert.equal(layerFilterShows(kindFilter('type', 'shape'), smart), false);
  for (const k of ['pixel', 'adjustment', 'type', 'shape', 'smart']) {
    assert.equal(layerFilterShows(kindFilter(k), group), false, k);
  }
});

test('Name matches trimmed and ignoring case', () => {
  const f = { ...defaultLayerFilter(), by: 'name', name: '  rect ' };
  assert.equal(layerFilterActive(f), true);
  assert.equal(layerFilterShows(f, shape), true);
  assert.equal(layerFilterShows(f, pixel), false);
  assert.equal(layerFilterShows({ ...f, name: 'BACK' }, pixel), true);
});

test('Mode is always active, starts at Normal, and groups are Pass Through', () => {
  const f = { ...defaultLayerFilter(), by: 'mode' };
  assert.equal(f.mode, 'source-over');
  assert.equal(layerFilterActive(f), true);
  assert.equal(layerFilterShows(f, pixel), true);
  assert.equal(layerFilterShows(f, { ...pixel, blendMode: 'multiply' }), false);
  assert.equal(layerFilterShows(f, group), false);
  assert.equal(layerFilterShows({ ...f, mode: 'pass-through' }, group), true);
  assert.equal(layerFilterShows({ ...f, mode: 'multiply' }, { ...pixel, blendMode: 'multiply' }), true);
});

test('an inactive Kind or Name filter shows every layer', () => {
  assert.equal(layerFilterActive(defaultLayerFilter()), false);
  assert.equal(layerFilterActive({ ...defaultLayerFilter(), by: 'name', name: '   ' }), false);
  assert.equal(layerFilterActive(null), false);
  for (const l of [pixel, adjust, type, group]) {
    assert.equal(layerFilterShows(defaultLayerFilter(), l), true);
    assert.equal(layerFilterShows({ ...defaultLayerFilter(), by: 'name', name: ' ' }, l), true);
  }
});

function render(layers, filter) {
  const container = document.getElementById('layers');
  container.innerHTML = '';
  const changes = [];
  const callbacks = new Proxy(
    { layerFilter: filter, onFilterChange: (next) => changes.push(next) },
    { get: (t, k) => t[k] ?? (() => {}) }
  );
  renderLayerPanel(layers, 0, container, callbacks);
  return { container, changes };
}

test('the filter row sits above the list with five Kind toggles', () => {
  const { container, changes } = render([pixel, type], kindFilter('type'));
  const row = container.querySelector('.layer-filter-row');
  const list = container.querySelector('.layer-list');
  assert.ok(row && list);
  assert.ok(row.compareDocumentPosition(list) & window.Node.DOCUMENT_POSITION_FOLLOWING);
  const by = row.querySelector('select.layer-filter-by');
  assert.deepEqual(
    [...by.options].map((o) => o.textContent),
    ['Kind', 'Name', 'Mode']
  );
  assert.equal(by.value, 'kind');
  const kinds = [...row.querySelectorAll('button[data-kind]')];
  assert.deepEqual(
    kinds.map((b) => b.dataset.kind),
    ['pixel', 'adjustment', 'type', 'shape', 'smart']
  );
  assert.equal(kinds[0].title, 'Filter for pixel layers');
  assert.equal(kinds[4].title, 'Filter for smart objects');
  assert.ok(kinds.every((b) => b.querySelector('svg')));
  assert.equal(kinds[2].getAttribute('aria-pressed'), 'true');
  assert.equal(kinds[0].getAttribute('aria-pressed'), 'false');

  // Only the type layer is listed.
  assert.deepEqual(
    [...list.querySelectorAll('.layer-row')].map((r) => r.dataset.index),
    ['1']
  );

  kinds[0].click();
  kinds[2].click();
  assert.deepEqual(changes[0].kinds, ['type', 'pixel']);
  assert.deepEqual(changes[1].kinds, []);
  by.value = 'name';
  by.dispatchEvent(new window.Event('change'));
  assert.equal(changes[2].by, 'name');
});

test('a Name filter hides rows that do not match', () => {
  const filter = { ...defaultLayerFilter(), by: 'name', name: 'rect' };
  const { container, changes } = render([pixel, shape, type], filter);
  const input = container.querySelector('input.layer-filter-name');
  assert.equal(input.placeholder, 'Search');
  assert.equal(input.value, 'rect');
  assert.equal(container.querySelector('button[data-kind]'), null);
  const rows = [...container.querySelectorAll('.layer-list .layer-row')];
  assert.deepEqual(
    rows.map((r) => r.dataset.index),
    ['1']
  );
  input.value = 'hel';
  input.dispatchEvent(new window.Event('input'));
  assert.equal(changes[0].name, 'hel');
  assert.equal(changes[0].by, 'name');
});

test('the Mode select lists Pass Through then the blend modes', () => {
  const { container, changes } = render([pixel, { ...type, blendMode: 'screen' }], {
    ...defaultLayerFilter(),
    by: 'mode'
  });
  const mode = container.querySelector('select.layer-filter-mode');
  assert.deepEqual(
    [...mode.options].map((o) => o.textContent),
    ['Pass Through', ...BLEND_MODES.map((m) => m.label)]
  );
  assert.equal(mode.value, 'source-over');
  assert.equal(container.querySelectorAll('.layer-list .layer-row').length, 1);
  mode.value = 'screen';
  mode.dispatchEvent(new window.Event('change'));
  assert.equal(changes[0].mode, 'screen');
});

test('paint.js keeps the filter on state and re-renders without undo', () => {
  assert.match(paintSrc, /layerFilter: defaultLayerFilter\(\)/);
  assert.match(paintSrc, /layerFilter: state\.layerFilter/);
  const body = paintSrc.slice(paintSrc.indexOf('onFilterChange: (next) =>'));
  const handler = body.slice(0, body.indexOf('},'));
  assert.match(handler, /state\.layerFilter = next/);
  assert.match(handler, /refreshLayerPanelUI\(\)/);
  assert.doesNotMatch(handler, /pushUndo/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import {
  applyComp,
  captureComp,
  deserializeComps,
  nextCompName,
  renderLayerCompsPanel,
  serializeComps
} from '../paint/layer-comps.js';
import { DOCK_PANELS, panelShown, showDockPanel } from '../paint/window-panels.js';
import { isStackUndoLabel } from '../paint/stack-history.js';

const layers = () => [
  { id: 1, name: 'Background', visible: true, opacity: 1, blendMode: 'source-over' },
  { id: 2, name: 'Top', visible: true, opacity: 0.5, blendMode: 'multiply' }
];

test('a comp restores the visibility and appearance it captured', () => {
  const comp = captureComp(layers(), 'Version A');
  assert.equal(comp.name, 'Version A');
  const changed = layers().map((l) => ({ ...l, visible: false, opacity: 1, blendMode: 'screen' }));
  const out = applyComp(changed, comp);
  assert.deepEqual(
    out.map((l) => [l.id, l.visible, l.opacity, l.blendMode]),
    [
      [1, true, 1, 'source-over'],
      [2, true, 0.5, 'multiply']
    ]
  );
  assert.equal(changed[1].visible, false, 'input untouched');
});

test('apply flags limit what a comp restores; unknown layers are left alone', () => {
  const comp = captureComp(layers(), 'Vis only', { applyVisibility: true, applyAppearance: false });
  const changed = [
    ...layers().map((l) => ({ ...l, visible: false, opacity: 0.2 })),
    { id: 3, name: 'New', visible: false, opacity: 0.3, blendMode: 'screen' }
  ];
  const out = applyComp(changed, comp);
  assert.deepEqual(
    out.map((l) => [l.visible, l.opacity]),
    [
      [true, 0.2],
      [true, 0.2],
      [false, 0.3]
    ]
  );
});

test('the History group has a Layer Comps tab', () => {
  const html = readFileSync(new URL('../paint/index.html', import.meta.url), 'utf8');
  const doc = new JSDOM(html).window.document;
  const tab = doc.getElementById('tab-layer-comps');
  assert.ok(tab, 'tab');
  assert.equal(tab.textContent.trim(), 'Layer Comps');
  assert.ok(tab.closest('[aria-label="History panel"]'), 'in the History group');
  const panel = doc.getElementById(tab.getAttribute('aria-controls'));
  assert.equal(panel?.id, 'panel-layer-comps');
  assert.ok(panel.hidden);
});

test('the panel lists comps and its footer creates and deletes them', () => {
  const { window } = new JSDOM('<!doctype html><div id="c"></div>');
  const container = window.document.getElementById('c');
  const calls = { apply: [], new: 0, delete: [] };
  const comps = [captureComp(layers(), 'A'), captureComp(layers(), 'B')];
  const render = (selected) =>
    renderLayerCompsPanel(container, comps, {
      applied: 1,
      selected,
      onApply: (i) => calls.apply.push(i),
      onNew: () => calls.new++,
      onDelete: (i) => calls.delete.push(i)
    });
  render(null);
  assert.match(container.textContent, /Last Document State/);
  const rows = [...container.querySelectorAll('[data-comp]')];
  assert.deepEqual(
    rows.map((r) => r.textContent.trim()),
    ['A', 'B']
  );
  assert.equal(rows[1].getAttribute('aria-selected'), 'true');
  rows[0].click();
  assert.deepEqual(calls.apply, [0]);
  const btn = (label) => container.querySelector(`button[aria-label="${label}"]`);
  btn('New Layer Comp').click();
  assert.equal(calls.new, 1);
  assert.equal(btn('Delete Layer Comp').disabled, true);
  render(1);
  btn('Delete Layer Comp').click();
  assert.deepEqual(calls.delete, [1]);
});

const mk = (id, visible, opacity, blendMode) => ({ id, name: `Layer ${id}`, visible, opacity, blendMode });

test('comps round-trip through .paintproj by layer index; older files load none', () => {
  const stack = [mk(1, true, 1, 'source-over'), mk(2, false, 0.5, 'multiply')];
  const saved = serializeComps([captureComp(stack, 'A')], stack);
  assert.deepEqual(saved[0].states[1], {
    layer: 1,
    visible: false,
    opacity: 0.5,
    blendMode: 'multiply'
  });
  const loaded = [mk(10, true, 1, 'source-over'), mk(11, true, 1, 'source-over')];
  const comps = deserializeComps(JSON.parse(JSON.stringify(saved)), loaded);
  assert.deepEqual(comps[0].states[1], { id: 11, visible: false, opacity: 0.5, blendMode: 'multiply' });
  assert.deepEqual(deserializeComps(undefined, loaded), []);
  assert.equal(serializeComps([], stack), null);
  assert.equal(nextCompName([{ name: 'Layer Comp 1' }]), 'Layer Comp 2');
  assert.ok(isStackUndoLabel('Apply Layer Comp'), 'applying a comp takes a whole-stack undo entry');
});

test('Window › Layer Comps selects the tab', () => {
  const html = readFileSync(new URL('../paint/index.html', import.meta.url), 'utf8');
  const doc = new JSDOM(html).window.document;
  const tab = doc.getElementById('tab-layer-comps');
  assert.ok(tab, 'button#tab-layer-comps');
  assert.equal(tab.tagName, 'BUTTON');
  assert.equal(tab.textContent.trim(), 'Layer Comps');
  assert.equal(tab.getAttribute('aria-controls'), 'panel-layer-comps');
  assert.equal(tab.closest('.dock-group'), doc.getElementById('tab-history').closest('.dock-group'));
  const panel = doc.getElementById('panel-layer-comps');
  assert.equal(panel.tagName, 'DIV');
  assert.equal(panel.hidden, true, 'hidden by default');

  assert.ok(DOCK_PANELS.includes('layerComps'));
  assert.equal(panelShown('layerComps', doc), false);
  assert.equal(showDockPanel('layerComps', doc), true);
  assert.equal(panelShown('layerComps', doc), true);
  assert.equal(tab.getAttribute('aria-selected'), 'true');
  assert.equal(doc.getElementById('panel-history').hidden, true);
});

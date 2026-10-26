import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { initDocPanels, navigatorZoom, navigatorZoomStep } from '../paint/doc-panels.js';
import { applyView, viewOf } from '../paint/view.js';

const DOCK = `<!doctype html>
<section class="dock-group">
  <div role="tablist">
    <button id="tab-navigator" role="tab" aria-selected="true">Navigator</button>
    <button id="tab-histogram" role="tab" aria-selected="false">Histogram</button>
    <button id="tab-info" role="tab" aria-selected="false">Info</button>
  </div>
  <div id="panel-navigator" role="tabpanel"></div>
  <div id="panel-histogram" role="tabpanel" hidden></div>
  <div id="panel-info" role="tabpanel" hidden></div>
</section>`;

const AREA = { x: 0, y: 0, w: 400, h: 300 };

// showView records each view and writes it the way paint.js does (applyView, then redraw).
function mount(zoom) {
  const { window } = new JSDOM(DOCK);
  window.HTMLCanvasElement.prototype.getContext = () => null;
  const doc = window.document;
  const state = { zoom, panX: 0, panY: 0 };
  const shown = [];
  const panels = initDocPanels(
    {
      state,
      W: () => 100,
      H: () => 80,
      areaRect: () => AREA,
      composite: () => null,
      activeImage: () => null,
      showView(v) {
        shown.push({ ...v });
        applyView(state, v);
      }
    },
    doc
  );
  panels.refresh();
  return { doc, window, state, shown, panels };
}

test('Zoom In and Zoom Out call showView with navigatorZoomStep of the previous zoom', () => {
  const { doc, state, shown } = mount(1.5);
  const steps = [
    ['.navigator-zoom-in', 1],
    ['.navigator-zoom-in', 1],
    ['.navigator-zoom-out', -1]
  ];
  for (const [cls, dir] of steps) {
    const before = state.zoom;
    const expected = navigatorZoom(viewOf(state), 100, 80, AREA, navigatorZoomStep(before, dir));
    doc.querySelector(cls).click();
    const v = shown.at(-1);
    assert.equal(v.zoom, navigatorZoomStep(before, dir), cls);
    assert.deepEqual(v, { ...expected }, `${cls} zooms about the canvas centre`);
    assert.equal(state.zoom, v.zoom, 'the view scale changed');
  }
  assert.equal(shown.length, steps.length);
});

test('a committed percent calls showView with that zoom', () => {
  const { doc, window, state, shown, panels } = mount(1);
  const field = doc.querySelector('.navigator-pct');
  const expected = navigatorZoom(viewOf(state), 100, 80, AREA, 2);
  field.value = '200%';
  field.dispatchEvent(new window.Event('change'));
  assert.equal(shown.length, 1);
  assert.equal(shown[0].zoom, 2);
  assert.deepEqual(shown[0], { ...expected });
  assert.equal(state.zoom, 2);
  panels.refresh();
  assert.equal(field.value, '200%');
});

test('bad percent text restores the field and does not call showView', () => {
  const { doc, window, state, shown } = mount(0.5);
  const field = doc.querySelector('.navigator-pct');
  assert.equal(field.value, '50%');
  for (const bad of ['abc', '', '0', '-20%', '%']) {
    field.value = bad;
    field.dispatchEvent(new window.Event('change'));
    assert.equal(field.value, '50%', `"${bad}" restores the field`);
  }
  assert.equal(shown.length, 0);
  assert.equal(state.zoom, 0.5);
});

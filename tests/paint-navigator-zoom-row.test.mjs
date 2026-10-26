import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { initDocPanels, navigatorZoomStep, parseZoomPercent } from '../paint/doc-panels.js';
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from '../paint/view.js';

const DOCK = `<!doctype html>
<section class="dock-group">
  <div role="tablist">
    <button id="tab-navigator" role="tab" aria-selected="true">Navigator</button>
    <button id="tab-histogram" role="tab" aria-selected="false">Histogram</button>
    <button id="tab-info" role="tab" aria-selected="false">Info</button>
  </div>
  <div id="panel-navigator" role="tabpanel"><p class="panel-empty"></p></div>
  <div id="panel-histogram" role="tabpanel" hidden><p class="panel-empty"></p></div>
  <div id="panel-info" role="tabpanel" hidden><p class="panel-empty"></p></div>
</section>`;

function mount(zoom = 1) {
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
      areaRect: () => ({ x: 0, y: 0, w: 400, h: 300 }),
      composite: () => null,
      activeImage: () => null,
      showView(v) {
        shown.push(v);
        state.zoom = v.zoom;
        state.panX = v.panX;
        state.panY = v.panY;
      }
    },
    doc
  );
  panels.refresh();
  return { doc, window, state, shown, panels };
}

test('navigatorZoomStep steps by the View › Zoom In factor and clamps', () => {
  assert.equal(navigatorZoomStep(1, 1), ZOOM_STEP);
  assert.equal(navigatorZoomStep(1, -1), 1 / ZOOM_STEP);
  assert.equal(navigatorZoomStep(ZOOM_MAX, 1), ZOOM_MAX);
  assert.equal(navigatorZoomStep(ZOOM_MIN, -1), ZOOM_MIN);
});

test('parseZoomPercent reads a typed percent, with or without the sign', () => {
  assert.equal(parseZoomPercent('200'), 2);
  assert.equal(parseZoomPercent(' 50 % '), 0.5);
  assert.equal(parseZoomPercent('12.5%'), 0.125);
  assert.equal(parseZoomPercent('99999'), ZOOM_MAX);
  assert.equal(parseZoomPercent('1'), ZOOM_MIN);
  for (const bad of ['', '%', 'abc', '0', '-50']) assert.equal(parseZoomPercent(bad), null, bad);
});

test('the zoom row is percent field, Zoom Out, slider, Zoom In', () => {
  const { doc } = mount();
  const row = doc.querySelector('#panel-navigator .navigator-zoom');
  assert.ok(row, 'zoom row');
  const kids = [...row.children].map((c) => `${c.tagName.toLowerCase()}.${c.className}`);
  assert.deepEqual(kids, [
    'input.navigator-pct',
    'button.navigator-zoom-out',
    'input.navigator-slider',
    'button.navigator-zoom-in'
  ]);
  const field = row.querySelector('.navigator-pct');
  assert.equal(field.type, 'text');
  assert.equal(field.getAttribute('aria-label'), 'Zoom percentage');
  assert.equal(field.value, '100%');
  for (const [cls, title] of [
    ['.navigator-zoom-out', 'Zoom Out'],
    ['.navigator-zoom-in', 'Zoom In']
  ]) {
    const b = row.querySelector(cls);
    assert.equal(b.type, 'button');
    assert.equal(b.title, title);
    assert.equal(b.getAttribute('aria-label'), title);
    assert.ok(b.querySelector('svg'), `${title} has a paint/icons.js svg`);
  }
});

test('Zoom In and Zoom Out step the view about the canvas centre', () => {
  const { doc, state, shown } = mount();
  doc.querySelector('.navigator-zoom-in').click();
  assert.equal(shown.length, 1);
  assert.equal(state.zoom, ZOOM_STEP);
  doc.querySelector('.navigator-zoom-out').click();
  doc.querySelector('.navigator-zoom-out').click();
  assert.equal(shown.length, 3);
  assert.ok(Math.abs(state.zoom - 1 / ZOOM_STEP) < 1e-9);
});

test('a typed percent sets the zoom; bad text puts the current zoom back', () => {
  const { doc, window, state, shown, panels } = mount();
  const field = doc.querySelector('.navigator-pct');
  field.value = '250';
  field.dispatchEvent(new window.Event('change'));
  assert.equal(shown.length, 1);
  assert.equal(state.zoom, 2.5);
  panels.refresh();
  assert.equal(field.value, '250%');
  field.value = 'nope';
  field.dispatchEvent(new window.Event('change'));
  assert.equal(shown.length, 1);
  assert.equal(field.value, '250%');
});

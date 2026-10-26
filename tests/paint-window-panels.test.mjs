import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import { COMMANDS, COMMANDS_BY_ID } from '../paint/commands.js';
import { buildMenuBar } from '../paint/menu-bar.js';
import { initDock } from '../paint/dock.js';
import { DOCK_PANELS, panelShown, toggleDockPanel } from '../paint/window-panels.js';
import {
  histogramStats,
  infoReadout,
  layerHistogram,
  navigatorCenter,
  navigatorDocPoint,
  navigatorFit,
  navigatorViewRect,
  navigatorZoom,
  rgbToHsb,
  sliderToZoom,
  zoomToSlider
} from '../paint/doc-panels.js';
import { ZOOM_MAX, viewToDoc } from '../paint/view.js';

const html = readFileSync(new URL('../paint/index.html', import.meta.url), 'utf8');

function menuDom() {
  const { window } = new JSDOM(html);
  const doc = window.document;
  globalThis.document = doc;
  initDock(doc.getElementById('dock'));
  const bar = doc.getElementById('menu-bar');
  const ctx = { togglePanel: (name) => toggleDockPanel(name, doc) };
  const refresh = buildMenuBar(bar, COMMANDS, { mac: false, state: {}, ctx });
  const item = (name) => doc.querySelector(`[data-command="window.panel.${name}"]`);
  const pick = (name) => {
    item(name).click();
    refresh();
  };
  const checked = (name) => item(name).getAttribute('aria-checked') === 'true';
  return { doc, item, pick, checked };
}

/** Dock element ids are kebab case (layerComps → tab-layer-comps). */
const dockTabId = (name) => `tab-${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

test('the Window menu lists every dock panel in catalog order', () => {
  const { doc, item } = menuDom();
  for (const name of DOCK_PANELS) {
    assert.ok(doc.getElementById(dockTabId(name)), `dock tab ${name}`);
    const cmd = COMMANDS_BY_ID.get(`window.panel.${name}`);
    assert.deepEqual(cmd.menu, ['Window']);
    assert.equal(item(name).getAttribute('role'), 'menuitemcheckbox');
  }
  const list = doc.getElementById('window-menu-list');
  const ids = [...list.querySelectorAll('button[data-command^="window.panel."]')].map(
    (b) => b.dataset.command
  );
  const at = (n) => ids.indexOf(`window.panel.${n}`);
  assert.ok(at('histogram') < at('info'));
  assert.ok(at('info') < at('navigator'));
  assert.ok(at('history') < at('layerComps'));
  assert.ok(at('layerComps') < at('layers'));
  assert.equal(COMMANDS_BY_ID.get('window.panel.info').shortcut, 'F8');
});

test('Window menu checkmarks follow and toggle panel visibility', () => {
  const { doc, pick, checked } = menuDom();
  const hidden = (id) => doc.getElementById(id).hidden;
  // The front tab of each group is checked; covered tabs are not.
  assert.equal(checked('navigator'), true);
  assert.equal(checked('histogram'), false);
  assert.equal(checked('info'), false);
  assert.equal(checked('history'), true);
  assert.equal(checked('layerComps'), false);
  assert.equal(checked('layers'), true);

  // Picking a covered panel brings it to the front and focuses it.
  pick('histogram');
  assert.equal(hidden('panel-histogram'), false);
  assert.equal(hidden('panel-navigator'), true);
  assert.equal(doc.activeElement, doc.getElementById('tab-histogram'));
  assert.equal(checked('histogram'), true);
  assert.equal(checked('navigator'), false);

  // Picking a shown panel closes its tab; the group's next open tab comes forward.
  pick('histogram');
  assert.equal(doc.getElementById('tab-histogram').hidden, true);
  assert.equal(hidden('panel-histogram'), true);
  assert.equal(hidden('panel-navigator'), false);
  assert.equal(checked('histogram'), false);
  assert.equal(checked('navigator'), true);

  // Closing the last open tab hides the group; reopening one brings the group back.
  pick('navigator');
  assert.equal(checked('info'), true, 'Info, the only open tab left, comes forward');
  pick('info');
  const group = doc.getElementById('tab-info').closest('.dock-group');
  assert.equal(group.hidden, true);
  assert.equal(panelShown('info', doc), false);
  pick('navigator');
  assert.equal(group.hidden, false);
  assert.equal(checked('navigator'), true);
  assert.equal(doc.getElementById('tab-info').hidden, true);

  // History shares a group with Layer Comps: closing History brings Layer Comps forward;
  // closing that last tab hides the group; reopening History brings the group back.
  const historyGroup = doc.getElementById('tab-history').closest('.dock-group');
  pick('history');
  assert.equal(checked('history'), false);
  assert.equal(checked('layerComps'), true);
  assert.equal(historyGroup.hidden, false);
  pick('layerComps');
  assert.equal(historyGroup.hidden, true);
  assert.equal(checked('layerComps'), false);
  pick('history');
  assert.equal(historyGroup.hidden, false);
  assert.equal(checked('history'), true);
});

test('navigator rect is the canvas area mapped into the fitted preview', () => {
  const W = 200,
    H = 100;
  const fit = navigatorFit(216, 116, W, H);
  assert.deepEqual([fit.x, fit.y, fit.w, fit.h, fit.s], [8, 8, 200, 100, 1]);
  const area = { x: 0, y: 0, w: 200, h: 100 };

  // At 200% from the origin the area shows the document's top-left quarter.
  const v = { zoom: 2, panX: 0, panY: 0, flip: false, rotation: 0 };
  assert.deepEqual(navigatorViewRect(v, W, H, area, fit), { x: 8, y: 8, w: 100, h: 50 });

  // A click on the preview centres the view there; the rect follows.
  const p = navigatorDocPoint(fit, 158, 58, W, H);
  assert.deepEqual(p, [150, 50]);
  const moved = navigatorCenter(v, W, H, area, p);
  assert.equal(moved.zoom, 2);
  assert.deepEqual(viewToDoc(moved, W, H, 100, 50), [150, 50]);
  assert.deepEqual(navigatorViewRect(moved, W, H, area, fit), { x: 108, y: 33, w: 100, h: 50 });
  assert.deepEqual(navigatorDocPoint(fit, 999, -5, W, H), [200, 0]);

  // Zoomed out the rect is clipped to the preview box.
  const out = { zoom: 0.5, panX: 0, panY: 0, flip: false, rotation: 0 };
  assert.deepEqual(navigatorViewRect(out, W, H, area, fit), { x: 8, y: 8, w: 208, h: 108 });

  // A tall document is centred horizontally.
  const tall = navigatorFit(216, 116, 50, 100);
  assert.deepEqual([tall.x, tall.y, tall.w, tall.h], [83, 8, 50, 100]);
});

test('navigator zoom slider is log2 and zooms about the area centre', () => {
  assert.ok(Math.abs(sliderToZoom(zoomToSlider(2)) - 2) < 1e-9);
  assert.equal(zoomToSlider(1), 0);
  assert.equal(sliderToZoom(100), ZOOM_MAX);
  const W = 200,
    H = 100;
  const area = { x: 0, y: 0, w: 200, h: 100 };
  const v = { zoom: 1, panX: 0, panY: 0, flip: false, rotation: 0 };
  const z = navigatorZoom(v, W, H, area, 4);
  assert.equal(z.zoom, 4);
  assert.deepEqual(viewToDoc(z, W, H, 100, 50), [100, 50]);
});

test('info reads RGB, HSB, X / Y, and the selection W / H', () => {
  assert.deepEqual(rgbToHsb(255, 0, 0), [0, 100, 100]);
  assert.deepEqual(rgbToHsb(0, 128, 255), [210, 100, 100]);
  assert.deepEqual(rgbToHsb(128, 128, 128), [0, 0, 50]);
  assert.deepEqual(rgbToHsb(0, 0, 0), [0, 0, 0]);
  const r = infoReadout([0, 128, 255, 255], [12, 34], { w: 40, h: 20 });
  assert.deepEqual(r.color, [
    ['R', '0'],
    ['G', '128'],
    ['B', '255']
  ]);
  assert.deepEqual(r.hsb, [
    ['H', '210°'],
    ['S', '100%'],
    ['B', '100%']
  ]);
  assert.deepEqual(r.pos, [
    ['X', '12'],
    ['Y', '34']
  ]);
  assert.deepEqual(r.size, [
    ['W', '40'],
    ['H', '20']
  ]);
  const off = infoReadout(null, null, null);
  assert.ok([...off.color, ...off.hsb, ...off.pos, ...off.size].every(([, v]) => v === '—'));
});

test('histogram is the active layer composite or one channel', () => {
  // Two opaque pixels, one transparent (skipped).
  const img = { data: new Uint8ClampedArray([255, 0, 30, 255, 0, 90, 30, 255, 9, 9, 9, 0]) };
  const rgb = layerHistogram(img, 'rgb');
  assert.equal(rgb[95], 1);
  assert.equal(rgb[40], 1);
  const red = layerHistogram(img, 'red');
  assert.equal(red[255], 1);
  assert.equal(red[0], 1);
  assert.equal(layerHistogram(img, 'green')[90], 1);
  assert.equal(layerHistogram(img, 'blue')[30], 2);
  const s = histogramStats(red);
  assert.equal(s.pixels, 2);
  assert.equal(s.mean, 127.5);
  assert.equal(s.dev, 127.5);
  assert.equal(s.median, 0);
  assert.deepEqual(histogramStats(new Array(256).fill(0)), {
    mean: 0,
    dev: 0,
    median: 0,
    pixels: 0
  });
});

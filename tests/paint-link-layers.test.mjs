import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

// The Layers footer link button (PhotoCraft panels.rs): selected layers share a linkId, the rows
// show a link glyph, and Move / Free Transform carry the whole set. createLayer needs
// document.createElement('canvas'); an ImageData-backed stub keeps this browser-free.
function fakeCanvas() {
  const canvas = {
    width: 0,
    height: 0,
    className: '',
    dataset: {},
    style: {},
    pixels: null,
    getContext: () => ctx,
    toDataURL: () => 'data:image/png;base64,'
  };
  const ensure = () => {
    if (!canvas.pixels || canvas.pixels.length !== canvas.width * canvas.height * 4) {
      canvas.pixels = new Uint8ClampedArray(canvas.width * canvas.height * 4);
    }
  };
  const ctx = {
    canvas,
    getImageData(x, y, w, h) {
      ensure();
      return { width: w, height: h, data: canvas.pixels.slice() };
    },
    putImageData(img) {
      ensure();
      canvas.pixels.set(img.data);
    }
  };
  return canvas;
}

const fakeDocument = { createElement: () => fakeCanvas(), getElementById: () => null };
globalThis.document = fakeDocument;
globalThis.window = {};

const { applyLinkPlan, linkPlan, linkedLayers, linkedPartners, offsetLinked, transformLinked } =
  await import('../paint/layer-link.js');
const { createLayer, createGroupLayer, renderLayerPanel } = await import('../paint/layers.js');
const { offsetLayerPixels } = await import('../paint/tools.js');
const { transformLayerPixels } = await import('../paint/transform.js');
const { snapshotStack, restoreStack, isStackUndoLabel } = await import('../paint/stack-history.js');
const { serializeProject, deserializeProject } = await import('../paint/project.js');
const { historyIconName } = await import('../paint/history.js');

const paintSrc = readFileSync(new URL('../paint/paint.js', import.meta.url), 'utf8');

const W = 4,
  H = 3;
const toImage = (data, width, height) => ({ width, height, data });

// A layer with one opaque pixel of rgb at (x, y).
function layer(name, x, y, rgb) {
  const l = createLayer(name, W, H);
  const data = new Uint8ClampedArray(W * H * 4);
  data.set([...rgb, 255], (y * W + x) * 4);
  l.ctx.putImageData({ width: W, height: H, data }, 0, 0);
  return l;
}

const pixels = (l) => l.ctx.getImageData(0, 0, W, H).data;
const opaqueAt = (l) => {
  const d = pixels(l);
  const at = [];
  for (let p = 0; p < W * H; p++) if (d[p * 4 + 3]) at.push([p % W, Math.floor(p / W)]);
  return at;
};

test('link toggles a shared link id on the selection; one linked layer unlinks its set', () => {
  const a = layer('A', 0, 0, [255, 0, 0]);
  const b = layer('B', 1, 0, [0, 255, 0]);
  const c = layer('C', 2, 0, [0, 0, 255]);
  const layers = [a, b, c];

  assert.equal(linkPlan(layers, [a.id]), null, 'one unlinked layer has nothing to link');

  const plan = linkPlan(layers, [a.id, b.id]);
  assert.equal(plan.link, true);
  applyLinkPlan(layers, plan);
  assert.ok(a.linkId);
  assert.equal(a.linkId, b.linkId);
  assert.equal(c.linkId, undefined);
  assert.deepEqual(linkedLayers(layers, a), [a, b]);
  assert.deepEqual(linkedLayers(layers, c), [c]);

  // Linking a mixed selection makes one new set.
  applyLinkPlan(layers, linkPlan(layers, [b.id, c.id]));
  assert.equal(b.linkId, c.linkId);
  assert.notEqual(a.linkId, b.linkId);
  assert.equal(a.linkId, undefined, "A's set dissolves when it is left alone");

  // Clicking link again with one linked layer selected unlinks the whole set.
  const unlink = linkPlan(layers, [c.id]);
  assert.equal(unlink.link, false);
  assert.deepEqual(unlink.ids, [b.id, c.id]);
  applyLinkPlan(layers, unlink);
  assert.deepEqual(
    layers.map((l) => l.linkId),
    [undefined, undefined, undefined]
  );

  // A selection that is already one set unlinks.
  applyLinkPlan(layers, linkPlan(layers, [a.id, c.id]));
  assert.equal(linkPlan(layers, [a.id, c.id]).link, false);

  assert.ok(isStackUndoLabel('Link Layers'));
  assert.ok(isStackUndoLabel('Unlink Layers'));
  assert.equal(historyIconName('Link Layers'), 'link-2');
});

test('linked rows show the link glyph and the footer link button runs onLink', () => {
  const { window } = new JSDOM('<!doctype html><body><div id="layers"></div></body>');
  globalThis.document = window.document;
  try {
    const noop = new Proxy({}, { get: () => () => {} });
    window.HTMLCanvasElement.prototype.getContext = () => noop;
    const doc = window.document;
    const canvas = doc.createElement('canvas');
    const layers = [
      { id: 1, name: 'A', visible: true, opacity: 1, canvas, linkId: 'link-1' },
      { id: 2, name: 'B', visible: true, opacity: 1, canvas },
      { id: 3, name: 'C', visible: true, opacity: 1, canvas, linkId: 'link-1' }
    ];
    const calls = [];
    const callbacks = new Proxy(
      {},
      { get: (_, key) => (key === 'maskTarget' ? false : (...args) => calls.push([key, ...args])) }
    );
    const container = doc.getElementById('layers');
    renderLayerPanel(layers, 1, container, callbacks);
    const rows = [...container.querySelectorAll('.layer-row')];
    const glyphs = rows.map((r) => r.querySelector('.layer-link-glyph'));
    // Rows run top first: C, B, A.
    assert.ok(glyphs[0]?.querySelector('svg'), 'C shows the glyph');
    assert.equal(glyphs[1], null, 'B is not linked');
    assert.ok(glyphs[2]?.querySelector('svg'), 'A shows the glyph');

    const link = container.querySelector('.layer-footer-btn[data-action="link"]');
    assert.equal(link.disabled, false, 'enabled whenever there is a layer');
    link.click();
    assert.deepEqual(calls.at(-1), ['onLink']);
  } finally {
    globalThis.document = fakeDocument;
  }
});

test('Move shifts every layer sharing the link id by the same delta', () => {
  const a = layer('A', 0, 0, [255, 0, 0]);
  const b = layer('B', 1, 1, [0, 255, 0]);
  const c = layer('C', 0, 2, [0, 0, 255]);
  const group = createGroupLayer('G', W, H);
  const layers = [a, b, c, group];
  applyLinkPlan(layers, linkPlan(layers, [a.id, b.id, group.id]));

  const partners = linkedPartners(layers, a);
  assert.deepEqual(partners, [b], 'the active layer and groups are not partners');
  assert.deepEqual(linkedPartners(layers, c), [], 'an unlinked layer moves alone');

  const entries = partners.map((l) => ({ layer: l, src: l.ctx.getImageData(0, 0, W, H) }));
  // The active layer moves through offsetLayerPixels as before; partners take the same delta.
  const out = offsetLayerPixels(pixels(a), W, H, 2, 1);
  a.ctx.putImageData(toImage(out, W, H), 0, 0);
  offsetLinked(entries, 2, 1, toImage);
  assert.deepEqual(opaqueAt(a), [[2, 1]]);
  assert.deepEqual(opaqueAt(b), [[3, 2]]);
  assert.deepEqual(opaqueAt(c), [[0, 2]], 'C is not linked and stays');

  // Dragging re-applies from the saved pixels, so deltas do not compound.
  offsetLinked(entries, -1, 0, toImage);
  assert.deepEqual(opaqueAt(b), [[0, 1]]);

  // paint.js routes the Move drag and its undo through the linked set.
  assert.match(paintSrc, /linked: partners\.map/);
  assert.match(paintSrc, /offsetLinked\(drag\.linked \?\? \[\], dx, dy, toImageData\)/);
  assert.match(paintSrc, /onLink: linkSelectedLayers/);
});

test('Free Transform carries linked layers through the same matrix', () => {
  const a = layer('A', 0, 0, [255, 0, 0]);
  const b = layer('B', 1, 1, [0, 255, 0]);
  const layers = [a, b];
  applyLinkPlan(layers, linkPlan(layers, [a.id, b.id]));
  // A translation by (1, 1).
  const m = [1, 0, 0, 1, 1, 1];
  const box = { x: 0, y: 0, w: 1, h: 1 };
  const moved = transformLayerPixels(a.ctx.getImageData(0, 0, W, H), null, box, m);
  a.ctx.putImageData(moved, 0, 0);
  transformLinked(linkedPartners(layers, a), m, toImage);
  assert.deepEqual(opaqueAt(a), [[1, 1]]);
  assert.deepEqual(opaqueAt(b), [[2, 2]]);
  assert.match(paintSrc, /transformLinked\(partners, affine, toImageData\)/);
});

test('.paintproj and undo snapshots keep the link id; older files load unlinked', async () => {
  const a = layer('A', 0, 0, [255, 0, 0]);
  const b = layer('B', 1, 0, [0, 255, 0]);
  const c = layer('C', 2, 0, [0, 0, 255]);
  const layers = [a, b, c];
  applyLinkPlan(layers, linkPlan(layers, [a.id, c.id]));

  const snap = restoreStack(snapshotStack(layers, 0));
  assert.deepEqual(
    snap.layers.map((r) => r.linkId),
    [a.linkId, null, a.linkId]
  );

  const saved = serializeProject({ layers, activeLayerIdx: 0 }, W, H);
  assert.equal(saved.layers[0].linkId, a.linkId);
  assert.equal('linkId' in saved.layers[1], false);
  for (const l of saved.layers) delete l.dataUrl;
  let loaded = null;
  await deserializeProject(saved, (d) => (loaded = d.layers));
  assert.deepEqual(
    loaded.map((l) => l.linkId ?? null),
    [a.linkId, null, a.linkId]
  );
  assert.deepEqual(linkedLayers(loaded, loaded[0]), [loaded[0], loaded[2]]);

  const old = { ...saved, layers: saved.layers.map(({ linkId: _l, ...rest }) => rest) };
  await deserializeProject(old, (d) => (loaded = d.layers));
  assert.deepEqual(
    loaded.map((l) => l.linkId ?? null),
    [null, null, null]
  );
});

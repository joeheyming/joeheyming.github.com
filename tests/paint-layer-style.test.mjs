import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// Layer › Layer Style (PhotoCraft compose effects.rs, engine layer_style.rs effect_defaults,
// extra_cmds.rs set_all_effects): Drop Shadow, Stroke, Color Overlay, and Copy / Paste / Clear
// Layer Style and Hide All Effects. createLayer needs document.createElement('canvas'); an
// ImageData-backed stub keeps the compositing and project tests browser-free.
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

globalThis.document = { createElement: () => fakeCanvas(), getElementById: () => null };
globalThis.window = {};

const {
  defaultEffect,
  hasActiveEffects,
  hasLayerStyle,
  lightOffset,
  renderEffects,
  setAllEffects,
  setLayerStyles
} = await import('../paint/layer-style.js');
const { compositeTreeBytes } = await import('../paint/layer-groups.js');
const { createLayer, copyLayerContents } = await import('../paint/layers.js');
const { COMMANDS } = await import('../paint/commands.js');
const { snapshotStack, restoreStack, isStackUndoLabel } = await import('../paint/stack-history.js');
const { serializeProject, deserializeProject } = await import('../paint/project.js');

const W = 24,
  H = 24;

function image(pixels) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (const [x, y, rgba] of pixels) data.set(rgba, (y * W + x) * 4);
  return { width: W, height: H, data };
}
const px = (img, x, y) => Array.from(img.data.subarray((y * W + x) * 4, (y * W + x) * 4 + 4));
const RED = [255, 0, 0, 255];
const dot = () => image([[10, 10, RED]]);

// Every pixel that is not transparent, as "x,y".
function painted(img) {
  const out = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) if (px(img, x, y)[3]) out.push(`${x},${y}`);
  return out;
}

function pixelLayer(name, pixels) {
  const layer = createLayer(name, W, H);
  layer.ctx.putImageData(image(pixels), 0, 0);
  return layer;
}

test('a drop shadow lands away from the light at the angle and distance', () => {
  const hard = (angle, distance) => ({
    dropShadow: { ...defaultEffect('dropShadow'), angle, distance, size: 0 }
  });
  // 120° (Photoshop's default light, up and to the left): 5 px falls 3 right and 4 down.
  assert.deepEqual(lightOffset(120, 5), [3, 4]);
  const out = renderEffects(dot(), hard(120, 5));
  assert.deepEqual(px(out, 10, 10), RED, 'the layer sits on its shadow');
  assert.deepEqual(px(out, 13, 14), [0, 0, 0, Math.round(0.75 * 255)], 'black at 75 %');
  assert.deepEqual(painted(out), ['10,10', '13,14']);

  // Light from straight above (90°) drops the shadow below; light from the right (0°), left.
  assert.deepEqual(painted(renderEffects(dot(), hard(90, 4))), ['10,10', '10,14']);
  assert.deepEqual(painted(renderEffects(dot(), hard(0, 3))), ['7,10', '10,10']);
  assert.deepEqual(painted(renderEffects(dot(), hard(-90, 2))), ['10,8', '10,10']);

  // Size softens it around the same spot: the darkest shadow pixel is still at the offset.
  const soft = renderEffects(dot(), {
    dropShadow: { ...defaultEffect('dropShadow'), angle: 90, distance: 6, size: 4 }
  });
  const alpha = (x, y) => px(soft, x, y)[3];
  assert.ok(alpha(10, 16) > alpha(10, 15) && alpha(10, 16) > alpha(11, 16));
  assert.equal(alpha(10, 15), alpha(10, 17), 'symmetric about the offset');
  assert.ok(alpha(10, 16) < Math.round(0.75 * 255), 'spread out, so lighter than a hard shadow');

  // Spread grows it before the blur: 100 % keeps it hard and dilated by the size.
  const spread = renderEffects(dot(), {
    dropShadow: { ...defaultEffect('dropShadow'), angle: 90, distance: 6, size: 2, spread: 100 }
  });
  assert.equal(px(spread, 12, 16)[3], 191, '2 px out from the offset, full shadow');
  assert.equal(px(spread, 13, 16)[3], 0);
});

test('Stroke outside rings the shape and leaves its pixels; inside paints over them', () => {
  const stroke = (position, size) => ({
    stroke: { ...defaultEffect('stroke'), position, size, color: '#0000ff' }
  });
  const out = renderEffects(dot(), stroke('outside', 1));
  assert.deepEqual(px(out, 10, 10), RED, 'the source pixel is not covered');
  for (const [x, y] of [
    [9, 10],
    [11, 10],
    [10, 9],
    [10, 11]
  ])
    assert.deepEqual(px(out, x, y), [0, 0, 255, 255], `${x},${y}`);
  assert.ok(px(out, 11, 11)[3] > 0 && px(out, 11, 11)[3] < 255, 'the corner is anti-aliased');
  assert.deepEqual(px(out, 12, 10), [0, 0, 0, 0], 'one pixel wide');
  assert.equal(px(renderEffects(dot(), stroke('outside', 3)), 13, 10)[3], 255, 'three wide');

  // Inside (PhotoCraft's default position) paints the edge pixels of the shape itself.
  const block = image(
    Array.from({ length: 25 }, (_, k) => [8 + (k % 5), 8 + Math.floor(k / 5), RED])
  );
  const inner = renderEffects(block, stroke('inside', 1));
  assert.deepEqual(px(inner, 8, 10), [0, 0, 255, 255], 'edge pixel stroked');
  assert.deepEqual(px(inner, 10, 10), RED, 'centre left alone');
  assert.deepEqual(px(inner, 7, 10), [0, 0, 0, 0], 'nothing outside');
});

test('Color Overlay recolors the layer and keeps its alpha', () => {
  const src = image([
    [2, 2, [0, 255, 0, 255]],
    [3, 2, [0, 255, 0, 128]],
    [5, 5, [200, 200, 200, 255]]
  ]);
  const out = renderEffects(src, { colorOverlay: defaultEffect('colorOverlay') });
  assert.deepEqual(px(out, 2, 2), [255, 0, 0, 255]);
  assert.deepEqual(px(out, 3, 2), [255, 0, 0, 128], 'half-transparent stays half');
  assert.deepEqual(px(out, 4, 2), [0, 0, 0, 0], 'transparent stays transparent');

  // Half opacity mixes; Multiply blends with the layer's own colour.
  const half = renderEffects(src, {
    colorOverlay: { ...defaultEffect('colorOverlay'), opacity: 50 }
  });
  assert.deepEqual(px(half, 2, 2), [128, 128, 0, 255]);
  const mult = renderEffects(src, {
    colorOverlay: { ...defaultEffect('colorOverlay'), blendMode: 'multiply' }
  });
  assert.deepEqual(px(mult, 5, 5), [200, 0, 0, 255]);
});

test('the compositor draws effects live, the shadow in its own mode, and honours the switches', () => {
  const layer = pixelLayer('Dot', [[10, 10, RED]]);
  layer.styles = {
    enabled: true,
    dropShadow: {
      ...defaultEffect('dropShadow'),
      color: '#808080',
      angle: 90,
      distance: 2,
      size: 0,
      opacity: 100
    }
  };
  // Multiply over a yellow backdrop: gray × yellow.
  const out = { width: W, height: H, data: compositeTreeBytes([layer], W, H, [255, 255, 0]) };
  assert.deepEqual(px(out, 10, 12), [128, 128, 0, 255]);
  assert.deepEqual(px(out, 10, 10), RED);
  // Layer opacity fades the effects with the layer.
  layer.opacity = 0.5;
  const faded = { width: W, height: H, data: compositeTreeBytes([layer], W, H, [255, 255, 255]) };
  assert.deepEqual(px(faded, 10, 12), [192, 192, 192, 255]);
  layer.opacity = 1;

  // Turning the effect off or hiding all effects leaves the plain layer; the pixels never change.
  layer.styles.dropShadow.enabled = false;
  assert.equal(hasActiveEffects(layer), false);
  layer.styles.dropShadow.enabled = true;
  assert.equal(setAllEffects([layer], false), 1);
  const hidden = { width: W, height: H, data: compositeTreeBytes([layer], W, H, [255, 255, 0]) };
  assert.deepEqual(px(hidden, 10, 12), [255, 255, 0, 255]);
  assert.equal(hasLayerStyle(layer), true, 'hidden effects are still there');
  setAllEffects([layer], true);
  assert.deepEqual(px(layer.ctx.getImageData(0, 0, W, H), 10, 12), [0, 0, 0, 0]);
});

test('Copy / Paste / Clear Layer Style and Hide All Effects run from the Layer menu', () => {
  const a = pixelLayer('A', [[1, 1, RED]]);
  const b = pixelLayer('B', [[1, 1, RED]]);
  const c = pixelLayer('C', [[1, 1, RED]]);
  a.styles = { enabled: true, stroke: { ...defaultEffect('stroke'), size: 4 } };
  const state = {
    layers: [a, b, c],
    activeLayerIdx: 0,
    selectedLayers: new Set([a.id]),
    layerSelectionFor: a.id,
    styleClipboard: null
  };
  const cmd = (id) => COMMANDS.find((k) => k.id === `layer.layerStyle.${id}`);
  for (const id of ['dropShadow', 'stroke', 'colorOverlay', 'copyLayerStyle', 'pasteLayerStyle'])
    assert.deepEqual(cmd(id).menu, ['Layer', 'Layer Style'], id);
  assert.equal(cmd('dropShadow').label, 'Drop Shadow…');

  // The actions as paint.js runs them, on this state.
  const ctx = {
    copyLayerStyle: () => (state.styleClipboard = structuredClone(a.styles)),
    pasteLayerStyle: () =>
      setLayerStyles(state.layers, [...state.selectedLayers], state.styleClipboard),
    clearLayerStyle: () => setLayerStyles(state.layers, [...state.selectedLayers], null),
    toggleAllEffects: () =>
      setAllEffects(
        state.layers,
        state.layers.filter(hasLayerStyle).every((l) => l.styles.enabled === false)
      )
  };
  assert.equal(cmd('pasteLayerStyle').enabled(state), false, 'nothing copied yet');
  assert.equal(cmd('copyLayerStyle').enabled(state), true);
  cmd('copyLayerStyle').run(ctx);

  state.activeLayerIdx = 1;
  state.selectedLayers = new Set([b.id, c.id]);
  state.layerSelectionFor = b.id;
  assert.equal(cmd('copyLayerStyle').enabled(state), false, 'B has no style');
  assert.equal(cmd('pasteLayerStyle').enabled(state), true);
  cmd('pasteLayerStyle').run(ctx);
  assert.equal(b.styles.stroke.size, 4);
  assert.equal(c.styles.stroke.size, 4);
  b.styles.stroke.size = 9;
  assert.equal(c.styles.stroke.size, 4, 'each layer gets its own copy');
  const stroked = renderEffects(b.ctx.getImageData(0, 0, W, H), b.styles);
  assert.deepEqual(px(stroked, 1, 1), [0, 0, 0, 255], 'the pasted inside stroke paints');

  assert.equal(cmd('hideAllEffects').labelFor(state), 'Hide All Effects');
  cmd('hideAllEffects').run(ctx);
  assert.deepEqual(
    state.layers.map((l) => l.styles.enabled),
    [false, false, false]
  );
  assert.equal(cmd('hideAllEffects').labelFor(state), 'Show All Effects');
  cmd('hideAllEffects').run(ctx);
  assert.equal(hasActiveEffects(a), true);

  assert.equal(cmd('clear').enabled(state), true);
  cmd('clear').run(ctx);
  assert.deepEqual(
    state.layers.map((l) => hasLayerStyle(l)),
    [true, false, false]
  );
  assert.equal(cmd('clear').enabled(state), false);
  for (const label of ['Layer Style', 'Paste Layer Style', 'Clear Layer Style', 'Hide All Effects'])
    assert.ok(isStackUndoLabel(label), label);
});

test('duplicate, stack undo, and .paintproj keep layer styles; older files load without', async () => {
  const a = pixelLayer('A', [[1, 1, RED]]);
  a.styles = {
    enabled: true,
    colorOverlay: { ...defaultEffect('colorOverlay'), color: '#00ff00' }
  };
  const copy = copyLayerContents(a, createLayer('A copy', W, H));
  assert.equal(copy.styles.colorOverlay.color, '#00ff00');
  assert.notEqual(copy.styles, a.styles);

  const snap = restoreStack(snapshotStack([a], 0));
  assert.equal(snap.layers[0].styles.colorOverlay.color, '#00ff00');

  const saved = serializeProject(
    { layers: [a, createLayer('Plain', W, H)], activeLayerIdx: 0 },
    W,
    H
  );
  assert.equal(saved.layers[0].styles.colorOverlay.color, '#00ff00');
  assert.equal('styles' in saved.layers[1], false);
  for (const l of saved.layers) delete l.dataUrl;
  let loaded = null;
  await deserializeProject(saved, (d) => (loaded = d.layers));
  assert.equal(loaded[0].styles.colorOverlay.color, '#00ff00');
  assert.equal(loaded[1].styles, null);

  const old = { ...saved, layers: saved.layers.map(({ styles: _s, ...rest }) => rest) };
  await deserializeProject(old, (d) => (loaded = d.layers));
  assert.deepEqual(
    loaded.map((l) => l.styles),
    [null, null]
  );
});

test('the Layer Style dialog lists effects with checkboxes and previews live', async () => {
  const { window } = new JSDOM('<!doctype html><body></body>');
  const { initLayerStyleDialog } = await import('../paint/layer-style-dialog.js');
  const dlg = initLayerStyleDialog({ doc: window.document });
  const previews = [];
  let ok = null;
  dlg.open(null, 'dropShadow', {
    onPreview: (s) => previews.push(s),
    onOk: (s) => (ok = s)
  });
  const items = [...dlg.modal.querySelectorAll('.layer-style-item')];
  assert.deepEqual(
    items.map((r) => r.dataset.effect),
    [
      'blendingOptions',
      'bevelEmboss',
      'stroke',
      'innerShadow',
      'innerGlow',
      'satin',
      'colorOverlay',
      'gradientOverlay',
      'patternOverlay',
      'outerGlow',
      'dropShadow'
    ]
  );
  assert.deepEqual(
    items.map((r) => r.querySelector('input[type=checkbox]')?.checked ?? null),
    [null, false, false, false, false, false, false, false, false, false, true]
  );
  assert.equal(previews.at(-1).dropShadow.enabled, true);

  const distance = dlg.modal.querySelector('[data-field="distance"]');
  distance.value = '12';
  distance.dispatchEvent(new window.Event('input'));
  assert.equal(previews.at(-1).dropShadow.distance, 12);

  const strokeBox = dlg.modal.querySelector('[data-effect="stroke"] input[type=checkbox]');
  strokeBox.checked = true;
  strokeBox.dispatchEvent(new window.Event('change'));
  assert.equal(previews.at(-1).stroke.enabled, true);

  dlg.modal.querySelector('#layer-style-ok').click();
  assert.equal(ok.dropShadow.distance, 12);
  assert.equal(ok.stroke.enabled, true);
  assert.ok(dlg.modal.classList.contains('hidden'));
});

test('the Layers panel shows an fx badge and the footer fx opens Layer Style', async () => {
  const { window } = new JSDOM('<!doctype html><body><div id="layers"></div></body>');
  const prev = globalThis.document;
  globalThis.document = window.document;
  try {
    const noop = new Proxy({}, { get: () => () => {} });
    window.HTMLCanvasElement.prototype.getContext = () => noop;
    const { renderLayerPanel } = await import('../paint/layers.js');
    const canvas = window.document.createElement('canvas');
    const layers = [
      { id: 1, name: 'Plain', visible: true, opacity: 1, blendMode: 'source-over', canvas },
      {
        id: 2,
        name: 'Styled',
        visible: true,
        opacity: 1,
        blendMode: 'source-over',
        canvas,
        styles: { enabled: true, stroke: defaultEffect('stroke') }
      }
    ];
    const calls = [];
    const callbacks = new Proxy(
      {},
      { get: (_, key) => (key === 'maskTarget' ? false : (...args) => calls.push([key, ...args])) }
    );
    const container = window.document.getElementById('layers');
    renderLayerPanel(layers, 1, container, callbacks);
    const badges = [...container.querySelectorAll('.layer-row .layer-fx-badge')];
    assert.equal(badges.length, 1);
    assert.equal(badges[0].closest('.layer-row').dataset.index, '1');
    const fx = container.querySelector('.layer-footer-btn[data-action="fx"]');
    assert.equal(fx.disabled, false);
    fx.click();
    assert.deepEqual(calls.at(-1), ['onLayerStyle']);
  } finally {
    globalThis.document = prev;
  }
});

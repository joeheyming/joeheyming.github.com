import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// Layer › Layer Style › Outer Glow… / Inner Glow… / Inner Shadow… (PhotoCraft compose effects.rs
// glow_map / shadow_map, engine layer_style.rs effect_defaults). createLayer needs
// document.createElement('canvas'); an ImageData-backed stub keeps the compositing browser-free.
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

const { defaultEffect, renderEffectParts, renderEffects, normalizeStyles } = await import(
  '../paint/layer-style.js'
);
const { compositeTreeBytes } = await import('../paint/layer-groups.js');
const { createLayer } = await import('../paint/layers.js');
const { COMMANDS } = await import('../paint/commands.js');

const W = 32,
  H = 32;
const GRAY = [128, 128, 128, 255];

// An opaque gray square covering [x0, x1) × [y0, y1).
function square(x0 = 10, y0 = 10, x1 = 22, y1 = 22, rgba = GRAY) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) data.set(rgba, (y * W + x) * 4);
  return { width: W, height: H, data };
}
const px = (img, x, y) => Array.from(img.data.subarray((y * W + x) * 4, (y * W + x) * 4 + 4));
const fx = (kind, over = {}) => ({ [kind]: { ...defaultEffect(kind), ...over } });

// Every pixel whose RGBA differs between a and b, as "x,y".
function changed(a, b) {
  const out = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (px(a, x, y).join() !== px(b, x, y).join()) out.push(`${x},${y}`);
  return out;
}

test('Outer Glow falls off with distance from the edge and stays outside the shape', () => {
  const src = square();
  const { under, body } = renderEffectParts(src, fx('outerGlow', { size: 8 }));
  assert.equal(under.length, 1);
  assert.equal(under[0].mode, 'screen', "PhotoCraft's default glow mode");
  assert.deepEqual(changed(body, src), [], 'the layer itself is untouched');

  const glow = under[0].image;
  const alpha = (x) => px(glow, x, 15)[3];
  assert.deepEqual(px(glow, 9, 15).slice(0, 3), [255, 255, 190], 'the default #ffffbe');
  // Left of the square's edge (x = 10): strongest beside it, weaker with each pixel out, gone
  // once past the size.
  for (let x = 9; x > 3; x--)
    assert.ok(alpha(x) > alpha(x - 1), `x=${x} ${alpha(x)} ${alpha(x - 1)}`);
  assert.ok(alpha(9) <= Math.round(0.75 * 255), 'at most the 75 % opacity');
  assert.equal(alpha(0), 0, 'nothing past the size');

  // A bigger size reaches farther; spread holds it solid further out before it fades.
  const big = renderEffectParts(src, fx('outerGlow', { size: 16 })).under[0].image;
  assert.ok(px(big, 4, 15)[3] > px(glow, 4, 15)[3]);
  const spread = renderEffectParts(src, fx('outerGlow', { size: 8, spread: 50 })).under[0].image;
  assert.equal(px(spread, 7, 15)[3], 191, 'solid within size × spread (4 px)');
  assert.ok(px(spread, 4, 15)[3] < 191);

  // Range stretches the edge: a 100 % range leaves the blurred edge at half strength or less.
  const flat = renderEffectParts(src, fx('outerGlow', { size: 8, range: 100 })).under[0].image;
  assert.ok(px(flat, 9, 15)[3] < alpha(9));
});

test('Outer Glow screens onto the backdrop under the layer, after the drop shadow', () => {
  const layer = createLayer('Square', W, H);
  layer.ctx.putImageData(square(), 0, 0);
  layer.styles = normalizeStyles({
    ...fx('outerGlow', { color: '#ffffff', opacity: 100, size: 6 }),
    ...fx('dropShadow', { opacity: 100, distance: 0, size: 0 })
  });
  const out = { width: W, height: H, data: compositeTreeBytes([layer], W, H, [0, 0, 128]) };
  // Screen with white over navy brightens beside the edge and fades out away from it.
  const near = px(out, 9, 15),
    far = px(out, 5, 15);
  assert.ok(near[0] > far[0] && far[0] >= 0, `${near} ${far}`);
  assert.ok(near[2] >= 128, 'screen never darkens');
  assert.deepEqual(px(out, 0, 15), [0, 0, 128, 255], 'untouched past the size');
  assert.deepEqual(px(out, 15, 15), GRAY, 'the layer sits on top');
  // Both exterior parts come out, the drop shadow first.
  const { under } = renderEffectParts(square(), layer.styles);
  assert.deepEqual(
    under.map((u) => u.mode),
    ['multiply', 'screen']
  );
});

test('Inner Glow brightens inward from the edge and never paints outside the alpha', () => {
  const src = square();
  const edge = renderEffects(src, fx('innerGlow', { color: '#ffffff', opacity: 100, size: 8 }));
  const inside = new Set();
  for (let y = 10; y < 22; y++) for (let x = 10; x < 22; x++) inside.add(`${x},${y}`);
  for (const at of changed(edge, src)) assert.ok(inside.has(at), `${at} is outside the shape`);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) assert.equal(px(edge, x, y)[3], px(src, x, y)[3], 'alpha kept');

  // Screen with white: strongest at the edge (x = 10), fading toward the middle.
  const r = (img, x) => px(img, x, 15)[0];
  for (let x = 10; x < 14; x++) assert.ok(r(edge, x) > r(edge, x + 1), `x=${x}`);
  assert.ok(r(edge, 10) > 200);
  assert.ok(r(edge, 15) < r(edge, 10));

  // Source: Center glows from the middle out instead.
  const center = renderEffects(
    src,
    fx('innerGlow', { color: '#ffffff', opacity: 100, size: 8, source: 'center' })
  );
  assert.ok(r(center, 15) > r(center, 10), 'brightest in the middle');
  for (const at of changed(center, src)) assert.ok(inside.has(at), `${at} is outside the shape`);

  // Choke holds the glow solid further in: 50 % of 8 px is full strength 4 px from the edge.
  const choke = renderEffects(
    src,
    fx('innerGlow', { color: '#ffffff', opacity: 100, size: 8, choke: 50 })
  );
  assert.equal(r(choke, 13), 255);
  assert.ok(r(edge, 13) < 255);

  // The canvas edge is an edge too: a layer filling the canvas glows along its border.
  const full = renderEffects(
    square(0, 0, W, H),
    fx('innerGlow', { color: '#ffffff', opacity: 100, size: 4 })
  );
  assert.ok(px(full, 0, 15)[0] > 200 && px(full, 15, 15)[0] === 128);
});

test('Inner Shadow falls inside the edge facing the light, only within the alpha', () => {
  const src = square();
  const hard = renderEffects(
    src,
    fx('innerShadow', { opacity: 100, angle: 120, distance: 5, size: 0 })
  );
  // 120° moves the shadow 3 right and 4 down, so it lines the top and left inner edges.
  assert.deepEqual(px(hard, 10, 15), [0, 0, 0, 255], 'left band, multiply with black');
  assert.deepEqual(px(hard, 12, 15), [0, 0, 0, 255]);
  assert.deepEqual(px(hard, 13, 15), GRAY, 'past the 3 px offset');
  assert.deepEqual(px(hard, 15, 13), [0, 0, 0, 255], 'top band');
  assert.deepEqual(px(hard, 15, 14), GRAY);
  assert.deepEqual(px(hard, 21, 21), GRAY, 'nothing on the far edges');
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const inShape = x >= 10 && x < 22 && y >= 10 && y < 22;
      if (!inShape) assert.deepEqual(px(hard, x, y), [0, 0, 0, 0], `${x},${y} stays empty`);
    }

  // Size softens it: darkest at the edge, lighter further in.
  const soft = renderEffects(src, fx('innerShadow', { angle: 90, distance: 0, size: 6 }));
  const g = (y) => px(soft, 15, y)[0];
  for (let y = 10; y < 13; y++) assert.ok(g(y) < g(y + 1), `y=${y}`);
  assert.equal(px(soft, 15, 5)[3], 0);

  // Choke grows it inward before the blur.
  const choked = renderEffects(
    src,
    fx('innerShadow', { opacity: 100, angle: 90, distance: 0, size: 4, choke: 100 })
  );
  assert.deepEqual(px(choked, 15, 13), [0, 0, 0, 255], '4 px of solid shadow');
  assert.deepEqual(px(choked, 15, 15), GRAY);
});

test('the Layer menu opens each effect in the Layer Style dialog', async () => {
  const cmd = (id) => COMMANDS.find((k) => k.id === `layer.layerStyle.${id}`);
  const opened = [];
  const ctx = { openLayerStyle: (kind) => opened.push(kind) };
  const layer = createLayer('A', W, H);
  const state = { layers: [layer], activeLayerIdx: 0 };
  for (const [id, label] of [
    ['outerGlow', 'Outer Glow…'],
    ['innerGlow', 'Inner Glow…'],
    ['innerShadow', 'Inner Shadow…']
  ]) {
    assert.deepEqual(cmd(id).menu, ['Layer', 'Layer Style'], id);
    assert.equal(cmd(id).label, label);
    assert.equal(cmd(id).enabled(state), true);
    cmd(id).run(ctx);
  }
  assert.deepEqual(opened, ['outerGlow', 'innerGlow', 'innerShadow']);

  const { window } = new JSDOM('<!doctype html><body></body>');
  const { initLayerStyleDialog } = await import('../paint/layer-style-dialog.js');
  const dlg = initLayerStyleDialog({ doc: window.document });
  let ok = null;
  dlg.open(null, 'innerGlow', { onOk: (s) => (ok = s) });
  const source = dlg.modal.querySelector('[data-field="source"]');
  assert.deepEqual(
    [...source.options].map((o) => o.value),
    ['center', 'edge']
  );
  source.value = 'center';
  source.dispatchEvent(new window.Event('change'));
  const choke = dlg.modal.querySelector('[data-field="choke"]');
  choke.value = '30';
  choke.dispatchEvent(new window.Event('input'));
  dlg.modal.querySelector('#layer-style-ok').click();
  assert.equal(ok.innerGlow.source, 'center');
  assert.equal(ok.innerGlow.choke, 30);
  assert.equal(ok.innerGlow.blendMode, 'screen');
});

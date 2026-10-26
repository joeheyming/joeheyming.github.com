import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// Layer › Layer Style › Gradient Overlay… / Pattern Overlay… / Satin… / Bevel & Emboss… /
// Blending Options… (PhotoCraft compose effects.rs satin_map / bevel_maps / gradient_t, engine
// layer_style.rs effect_defaults, Layer::fill_opacity). createLayer needs
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

const { defaultEffect, drawsStyle, normalizeStyles, renderEffectParts, renderEffects } =
  await import('../paint/layer-style.js');
const { compositeTreeBytes } = await import('../paint/layer-groups.js');
const { createLayer } = await import('../paint/layers.js');
const { COMMANDS } = await import('../paint/commands.js');

const W = 32,
  H = 32;
const GRAY = [128, 128, 128, 255];
const WHITE = [255, 255, 255];

// An opaque square covering [x0, x1) × [y0, y1).
function square(x0 = 10, y0 = 10, x1 = 22, y1 = 22, rgba = GRAY) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) data.set(rgba, (y * W + x) * 4);
  return { width: W, height: H, data };
}
const px = (img, x, y) => Array.from(img.data.subarray((y * W + x) * 4, (y * W + x) * 4 + 4));
const fx = (kind, over = {}) => ({ [kind]: { ...defaultEffect(kind), ...over } });
const inSquare = (x, y) => x >= 10 && x < 22 && y >= 10 && y < 22;

function layerWith(styles, img = square()) {
  const layer = createLayer('Square', W, H);
  layer.ctx.putImageData(img, 0, 0);
  layer.styles = normalizeStyles(styles);
  return layer;
}
const composite = (layers, bg = WHITE) => ({
  width: W,
  height: H,
  data: compositeTreeBytes(layers, W, H, bg)
});

test('Fill Opacity 0 hides the layer pixels but leaves a stroke effect visible', () => {
  const stroke = fx('stroke', { size: 2, position: 'inside', color: '#ff0000' });
  const out = composite([layerWith({ ...stroke, fillOpacity: 0 })]);
  assert.deepEqual(px(out, 15, 15), [255, 255, 255, 255], 'the gray fill is gone');
  assert.deepEqual(px(out, 10, 15), [255, 0, 0, 255], 'the stroke keeps its full strength');
  assert.deepEqual(px(out, 11, 15), [255, 0, 0, 255]);
  assert.deepEqual(px(out, 5, 15), [255, 255, 255, 255], 'nothing outside');

  // Opacity, unlike Fill, fades the effects too.
  const faded = layerWith(stroke);
  faded.opacity = 0;
  assert.deepEqual(px(composite([faded]), 10, 15), [255, 255, 255, 255]);

  // Half Fill: the gray mixes with the backdrop, the stroke stays solid.
  const half = composite([layerWith({ ...stroke, fillOpacity: 50 })]);
  assert.ok(Math.abs(px(half, 15, 15)[0] - 192) <= 1, `${px(half, 15, 15)}`);
  assert.deepEqual(px(half, 10, 15), [255, 0, 0, 255]);

  // Fill alone, with no effect, still fades the layer (and switches it to the styled path).
  const plain = layerWith({ fillOpacity: 0 });
  assert.equal(drawsStyle(plain), true);
  assert.deepEqual(px(composite([plain]), 15, 15), [255, 255, 255, 255]);
  assert.equal(drawsStyle(layerWith(null)), false);
});

test('Fill Opacity 0 keeps a drop shadow out from under the shape', () => {
  const shadow = fx('dropShadow', { opacity: 100, distance: 2, size: 0, angle: 90 });
  const full = composite([layerWith(shadow)]);
  assert.deepEqual(px(full, 15, 15), GRAY);
  assert.deepEqual(px(full, 15, 23), [0, 0, 0, 255], 'shadow 2 px below the square');
  const empty = composite([layerWith({ ...shadow, fillOpacity: 0 })]);
  assert.deepEqual(px(empty, 15, 15), [255, 255, 255, 255], 'knocked out behind the shape');
  assert.deepEqual(px(empty, 15, 23), [0, 0, 0, 255], 'still cast past it');
});

test('Bevel & Emboss lights the edge facing the light and shades the opposite one', () => {
  const src = square();
  const lit = (angle, over = {}) =>
    renderEffects(src, fx('bevelEmboss', { angle, size: 4, ...over }));
  // 180°: light from the left. The left inner edge brightens (Screen white), the right darkens.
  const left = lit(180);
  assert.ok(px(left, 10, 15)[0] > 128, `left edge ${px(left, 10, 15)}`);
  assert.ok(px(left, 21, 15)[0] < 128, `right edge ${px(left, 21, 15)}`);
  assert.deepEqual(px(left, 15, 15), GRAY, 'the flat top is untouched');
  assert.deepEqual(px(left, 5, 15), [0, 0, 0, 0], 'an inner bevel stays inside');
  assert.equal(px(left, 10, 15)[3], 255, 'alpha kept');
  // 0°: light from the right flips them; 90°: light from above lights the top edge.
  const right = lit(0);
  assert.ok(px(right, 21, 15)[0] > 128 && px(right, 10, 15)[0] < 128);
  const top = lit(90);
  assert.ok(px(top, 15, 10)[0] > 128 && px(top, 15, 21)[0] < 128);
  // Direction Down swaps highlight and shadow.
  const down = lit(180, { direction: 'down' });
  assert.ok(px(down, 10, 15)[0] < 128 && px(down, 21, 15)[0] > 128);
  // Higher altitude flattens the shading toward the face.
  const high = lit(180, { altitude: 70 });
  assert.ok(px(high, 10, 15)[0] < px(left, 10, 15)[0]);
  // A deeper bevel shades harder (two pixels in from the edge, short of full shadow).
  const deep = lit(180, { depth: 300 });
  assert.ok(px(deep, 19, 15)[0] < px(left, 19, 15)[0]);
  // Chisel Hard bevels too.
  const chisel = lit(180, { technique: 'chiselHard' });
  assert.ok(px(chisel, 10, 15)[0] > 128 && px(chisel, 21, 15)[0] < 128);
});

test('Outer Bevel shades outside the shape on the backdrop; Emboss shades both sides', () => {
  const outer = renderEffectParts(square(), fx('bevelEmboss', { style: 'outer', angle: 180 }));
  assert.deepEqual(
    outer.under.map((u) => u.mode),
    ['screen', 'multiply']
  );
  assert.deepEqual(px(outer.body, 10, 15), GRAY, 'the layer is untouched');
  const [hi, sh] = outer.under.map((u) => u.image);
  // The ground rises toward the shape: outside the left edge it faces the light, outside the
  // right edge it faces away.
  assert.ok(px(hi, 8, 15)[3] > 0 && px(sh, 8, 15)[3] === 0, 'highlight on the lit side');
  assert.ok(px(sh, 23, 15)[3] > 0 && px(hi, 23, 15)[3] === 0, 'shadow on the far side');
  for (let y = 10; y < 22; y++)
    for (let x = 10; x < 22; x++) assert.equal(px(hi, x, y)[3] + px(sh, x, y)[3], 0, `${x},${y}`);

  const emboss = renderEffectParts(square(), fx('bevelEmboss', { style: 'emboss', angle: 180 }));
  assert.ok(px(emboss.body, 10, 15)[0] > 128, 'inside half lit');
  assert.ok(
    emboss.under.some((u) => px(u.image, 8, 15)[3] > 0),
    'outside half shaded'
  );
});

test('Gradient Overlay paints the gradient across the layer bounds', () => {
  const src = square();
  const ramp = renderEffects(src, fx('gradientOverlay'));
  // PhotoCraft's default: black to white at 90°, so white at the top, black at the bottom.
  const r = (img, y) => px(img, 15, y)[0];
  assert.ok(r(ramp, 10) > 230, `top ${r(ramp, 10)}`);
  assert.ok(r(ramp, 21) < 25, `bottom ${r(ramp, 21)}`);
  for (let y = 11; y < 22; y++) assert.ok(r(ramp, y) < r(ramp, y - 1), `y=${y}`);
  assert.equal(px(ramp, 15, 15)[0], px(ramp, 11, 15)[0], 'flat across at 90°');
  assert.deepEqual(px(ramp, 5, 5), [0, 0, 0, 0], 'nothing outside the layer');

  const reversed = renderEffects(src, fx('gradientOverlay', { reverse: true }));
  assert.ok(r(reversed, 10) < 25 && r(reversed, 21) > 230);
  const sideways = renderEffects(src, fx('gradientOverlay', { angle: 0 }));
  assert.ok(px(sideways, 10, 15)[0] < 25 && px(sideways, 21, 15)[0] > 230);
  const radial = renderEffects(src, fx('gradientOverlay', { style: 'radial' }));
  assert.ok(px(radial, 15, 15)[0] < px(radial, 10, 10)[0], 'radial: dark centre');

  // Opacity stops fade the overlay to the layer's own color.
  const fade = renderEffects(
    src,
    fx('gradientOverlay', {
      stops: [
        [0, '#ff0000'],
        [1, '#ff0000']
      ],
      opacityStops: [
        [0, 0],
        [1, 1]
      ]
    })
  );
  assert.ok(px(fade, 15, 21)[0] - 128 < 16, `transparent end ${px(fade, 15, 21)}`);
  assert.ok(px(fade, 15, 10)[0] > 240 && px(fade, 15, 10)[1] < 15, 'opaque end');
});

test('Pattern Overlay tiles the defined pattern from the layer origin', () => {
  // A 2 × 1 red | blue tile.
  const pattern = { width: 2, height: 1, data: [255, 0, 0, 255, 0, 0, 255, 255] };
  const out = renderEffects(square(), fx('patternOverlay', { pattern }));
  assert.deepEqual(px(out, 10, 12), [255, 0, 0, 255], 'the tile starts at the layer top-left');
  assert.deepEqual(px(out, 11, 12), [0, 0, 255, 255]);
  assert.deepEqual(px(out, 12, 20), [255, 0, 0, 255]);
  assert.deepEqual(px(out, 5, 12), [0, 0, 0, 0], 'nothing outside');
  // Unlinked, it tiles from the canvas origin; Scale 200 % doubles each cell.
  const odd = square(11, 10, 22, 22);
  const linked = renderEffects(odd, fx('patternOverlay', { pattern }));
  assert.deepEqual(px(linked, 11, 12), [255, 0, 0, 255]);
  const canvas = renderEffects(odd, fx('patternOverlay', { pattern, link: false }));
  assert.deepEqual(px(canvas, 11, 12), [0, 0, 255, 255]);
  const big = renderEffects(square(), fx('patternOverlay', { pattern, scale: 200 }));
  assert.deepEqual(
    [10, 11, 12, 13].map((x) => px(big, x, 12)[0]),
    [255, 255, 0, 0]
  );
  // Half opacity mixes with the layer.
  const half = renderEffects(square(), fx('patternOverlay', { pattern, opacity: 50 }));
  const [r, g, b, a] = px(half, 10, 12);
  assert.ok(Math.abs(r - 192) <= 1 && g === 64 && b === 64 && a === 255, `${[r, g, b, a]}`);
});

test('Satin shades the interior from the shape against itself and keeps the alpha', () => {
  const src = square(4, 4, 28, 28);
  const satin = renderEffects(src, fx('satin', { opacity: 100 }));
  let darker = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const [r, , , a] = px(satin, x, y);
      assert.equal(a, px(src, x, y)[3], `alpha at ${x},${y}`);
      assert.ok(r <= 128, 'Multiply black only darkens');
      if (r < 128) darker++;
    }
  assert.ok(darker > 50, `${darker} pixels shaded`);
  // Invert off shades where the two shifted copies differ instead: a different pattern.
  const plain = renderEffects(src, fx('satin', { opacity: 100, invert: false }));
  assert.notDeepEqual(px(plain, 16, 16), px(satin, 16, 16));
});

test('the Layer menu opens the new pages; Blending Options edits Opacity and Fill', async () => {
  const cmd = (id) => COMMANDS.find((k) => k.id === `layer.layerStyle.${id}`);
  const opened = [];
  const ctx = { openLayerStyle: (kind) => opened.push(kind) };
  const state = { layers: [createLayer('A', W, H)], activeLayerIdx: 0 };
  const ids = [
    ['blendingOptions', 'Blending Options…'],
    ['bevelEmboss', 'Bevel & Emboss…'],
    ['satin', 'Satin…'],
    ['gradientOverlay', 'Gradient Overlay…'],
    ['patternOverlay', 'Pattern Overlay…']
  ];
  for (const [id, label] of ids) {
    assert.deepEqual(cmd(id).menu, ['Layer', 'Layer Style'], id);
    assert.equal(cmd(id).label, label);
    assert.equal(cmd(id).enabled(state), true);
    cmd(id).run(ctx);
  }
  assert.deepEqual(
    opened,
    ids.map(([id]) => id)
  );

  const { window } = new JSDOM('<!doctype html><body></body>');
  const { initLayerStyleDialog } = await import('../paint/layer-style-dialog.js');
  const tile = { width: 1, height: 1, data: new Uint8ClampedArray([0, 255, 0, 255]) };
  const dlg = initLayerStyleDialog({
    doc: window.document,
    pattern: () => tile,
    swatches: () => ['#112233', '#445566']
  });
  const field = (key) => dlg.modal.querySelector(`[data-field="${key}"]`);
  const input = (key, value) => {
    field(key).value = value;
    field(key).dispatchEvent(new window.Event('input'));
  };
  const previews = [];
  let ok = null;
  dlg.open(null, 'blendingOptions', {
    general: { blendMode: 'source-over', opacity: 100 },
    onPreview: (s, g) => previews.push([s, g]),
    onOk: (s, g) => (ok = [s, g])
  });
  input('fillOpacity', '0');
  input('opacity', '60');
  assert.equal(previews.at(-1)[0].fillOpacity, 0);
  assert.equal(previews.at(-1)[1].opacity, 60);

  // Pattern Overlay takes the defined pattern; Gradient Overlay's preset resolves fg / bg.
  dlg.modal.querySelector('[data-effect="patternOverlay"] .layer-style-name').click();
  dlg.modal.querySelector('[data-effect="gradientOverlay"] .layer-style-name').click();
  field('preset').value = 'Foreground to Background';
  field('preset').dispatchEvent(new window.Event('change'));
  dlg.modal.querySelector('#layer-style-ok').click();
  const [styles, general] = ok;
  assert.equal(styles.fillOpacity, 0);
  assert.equal(general.opacity, 60);
  assert.deepEqual(styles.patternOverlay.pattern, { width: 1, height: 1, data: [0, 255, 0, 255] });
  assert.deepEqual(styles.gradientOverlay.stops, [
    [0, '#112233'],
    [1, '#445566']
  ]);
  assert.equal(styles.gradientOverlay.enabled, true);

  // The result composites: Fill 0 with the green pattern overlay shows only the overlay.
  const layer = layerWith({ fillOpacity: 0, patternOverlay: styles.patternOverlay });
  assert.deepEqual(px(composite([layer]), 15, 15), [0, 255, 0, 255]);
});

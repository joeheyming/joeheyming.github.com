import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { makeImage, px, near } from './paint-helpers.mjs';
import {
  TOOLS,
  TOOL_OPTION_SCHEMA,
  ditherNoise,
  fillLinearGradient,
  fillLinearGradientStops,
  gradientToolPreset,
  gradientToolT
} from '../paint/tools.js';
import {
  GRADIENT_PRESET_GROUPS,
  SWATCH_CHECKER,
  presetSwatchCss,
  resolvePresetOpacity,
  resolvePresetStops,
  swatchBackground
} from '../paint/gradient-presets.js';
import { renderToolOptions, showColor } from '../paint/ui.js';
import { BLEND_MODES } from '../paint/layers.js';
import { blendChannel, blendRgb } from '../paint/retouch.js';

function flat(hex) {
  return [
    [0, hex],
    [1, hex]
  ];
}

// --- from paint-gradient-tool-mode.test.mjs ---
{
  const RB = [
    [0, '#ff0000'],
    [1, '#0000ff']
  ];

  test('gradient Mode select sits after Shape and before Opacity, one option per blend mode', () => {
    const opts = TOOL_OPTION_SCHEMA.gradient;
    assert.deepEqual(
      opts.map((o) => o.key),
      ['preset', 'shape', 'mode', 'opacity', 'reverse', 'dither']
    );
    const o = opts.find((x) => x.key === 'mode');
    assert.equal(o.type, 'select');
    assert.equal(o.label, 'Mode');
    assert.equal(o.default, 'source-over');
    assert.deepEqual(
      o.options,
      BLEND_MODES.map(({ value, label }) => ({ value, label }))
    );
  });

  test('multiply of #808080 gives #808080 over white and #000000 over black', () => {
    const white = makeImage(3, 1, [255, 255, 255, 255]);
    fillLinearGradientStops(white, 0, 0, 3, 0, flat('#808080'), null, 'linear', {
      mode: 'multiply'
    });
    for (let x = 0; x < 3; x++) assert.deepEqual(px(white, x, 0), [128, 128, 128, 255]);
    const black = makeImage(3, 1, [0, 0, 0, 255]);
    fillLinearGradientStops(black, 0, 0, 3, 0, flat('#808080'), null, 'linear', {
      mode: 'multiply'
    });
    for (let x = 0; x < 3; x++) assert.deepEqual(px(black, x, 0), [0, 0, 0, 255]);
  });

  test('screen of #808080 over #808080 gives about #c0c0c0', () => {
    const img = makeImage(3, 1, [128, 128, 128, 255]);
    fillLinearGradientStops(img, 0, 0, 3, 0, flat('#808080'), null, 'linear', { mode: 'screen' });
    for (let x = 0; x < 3; x++) {
      const [r, g, b, a] = px(img, x, 0);
      assert.equal(a, 255);
      for (const v of [r, g, b]) assert.ok(Math.abs(v - 0xc0) <= 1, `channel ${v}`);
    }
  });

  test('a blend mode over transparent pixels gives the plain gradient color', () => {
    const ref = makeImage(8, 1);
    fillLinearGradientStops(ref, 0, 0, 8, 0, RB, null);
    for (const { value } of BLEND_MODES) {
      const img = makeImage(8, 1);
      fillLinearGradientStops(img, 0, 0, 8, 0, RB, null, 'linear', { mode: value });
      assert.deepEqual(Array.from(img.data), Array.from(ref.data), value);
    }
  });

  test("'source-over' matches the fill without a mode byte for byte", () => {
    const base = makeImage(16, 9, [10, 200, 30, 90]);
    const mask = new Uint8Array(16 * 9).map((_, i) => (i % 3 ? 1 : 0));
    for (const opacity of [1, 0.4]) {
      const a = { ...base, data: new Uint8ClampedArray(base.data) };
      const b = { ...base, data: new Uint8ClampedArray(base.data) };
      fillLinearGradientStops(a, 1, 2, 14, 7, RB, mask, 'radial', { dither: true, opacity });
      fillLinearGradientStops(b, 1, 2, 14, 7, RB, mask, 'radial', {
        dither: true,
        opacity,
        mode: 'source-over'
      });
      assert.deepEqual(a.data, b.data);
    }
  });

  test('modes composite with opacity and keep masked-out pixels', () => {
    // 50% multiply of black over white: B = 0, Co = 0.5·1 + 0.5·0 = 0.5.
    const img = makeImage(2, 1, [255, 255, 255, 255]);
    fillLinearGradientStops(img, 0, 0, 2, 0, flat('#000000'), new Uint8Array([0, 1]), 'linear', {
      mode: 'multiply',
      opacity: 0.5
    });
    assert.deepEqual(px(img, 0, 0), [255, 255, 255, 255]);
    const [r, , , a] = px(img, 1, 0);
    assert.equal(a, 255);
    assert.ok(Math.abs(r - 127.5) <= 1, `channel ${r}`);
  });

  test('blendChannel and blendRgb follow PhotoCraft blend_rgb', () => {
    const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
    close(blendChannel('darken', 0.3, 0.6), 0.3);
    close(blendChannel('lighten', 0.3, 0.6), 0.6);
    close(blendChannel('difference', 0.3, 0.6), 0.3);
    close(blendChannel('exclusion', 0.5, 0.5), 0.5);
    close(blendChannel('overlay', 0.25, 0.5), 0.25);
    close(blendChannel('hard-light', 0.5, 0.25), 0.25);
    close(blendChannel('color-dodge', 0.25, 0.5), 0.5);
    close(blendChannel('color-burn', 0.75, 0.5), 0.5);
    close(blendChannel('soft-light', 0.25, 0.5), 0.25);
    close(blendChannel('soft-light', 0.25, 1), 0.5);
    assert.deepEqual(blendRgb('luminosity', [1, 0, 0], [0.5, 0.5, 0.5]).length, 3);
    const c = blendRgb('color', [0.5, 0.5, 0.5], [1, 0, 0]);
    close(0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2], 0.5);
  });

  test('the Gradient tool passes opts.mode through after pushUndo', () => {
    const W = 9;
    const undo = [];
    const img = makeImage(W, 1, [128, 128, 128, 255]);
    const ctx = {
      canvas: { width: W, height: 1 },
      getImageData: () => {
        assert.deepEqual(undo, ['Gradient']);
        return { width: W, height: 1, data: img.data.slice() };
      },
      putImageData: (next) => img.data.set(next.data)
    };
    const ov = { canvas: { width: W, height: 1 }, clearRect() {} };
    const state = {
      color: '#ff0000',
      bgColor: '#0000ff',
      sel: { mode: 'none' },
      pushUndo: (l) => undo.push(l),
      toolOptions: { gradient: { mode: 'multiply' } }
    };
    TOOLS.gradient.onDown(ctx, ov, state, 0.5, 0);
    TOOLS.gradient.onUp(ctx, ov, state, W - 0.5, 0);
    const want = makeImage(W, 1, [128, 128, 128, 255]);
    fillLinearGradientStops(want, 0.5, 0, W - 0.5, 0, RB, null, 'linear', { mode: 'multiply' });
    assert.deepEqual(Array.from(img.data), Array.from(want.data));
    assert.notDeepEqual(px(img, 0, 0), [255, 0, 0, 255]);
  });
}

// --- from paint-gradient-tool-opacity.test.mjs ---
{
  const BLACK = [
    [0, '#000000'],
    [1, '#000000']
  ];
  const RB = [
    [0, '#ff0000'],
    [1, '#0000ff']
  ];

  test('gradient Opacity range sits after Mode and before Reverse, 1..100, default 100', () => {
    const opts = TOOL_OPTION_SCHEMA.gradient;
    const keys = opts.map((o) => o.key);
    assert.deepEqual(keys, ['preset', 'shape', 'mode', 'opacity', 'reverse', 'dither']);
    const o = opts.find((x) => x.key === 'opacity');
    assert.deepEqual(o, {
      key: 'opacity',
      type: 'range',
      label: 'Opacity',
      min: 1,
      max: 100,
      step: 1,
      default: 100
    });
  });

  test('a 50% black fill over opaque white gives mid gray at full alpha', () => {
    const img = makeImage(4, 1, [255, 255, 255, 255]);
    fillLinearGradientStops(img, 0, 0, 4, 0, BLACK, null, 'linear', { opacity: 0.5 });
    for (let x = 0; x < 4; x++) {
      const [r, g, b, a] = px(img, x, 0);
      assert.equal(a, 255);
      for (const v of [r, g, b]) assert.ok(Math.abs(v - 127.5) <= 1, `channel ${v}`);
    }
  });

  test('a 50% fill over transparent pixels keeps the gradient color at half alpha', () => {
    const img = makeImage(8, 1);
    const ref = makeImage(8, 1);
    fillLinearGradientStops(img, 0, 0, 8, 0, RB, null, 'linear', { opacity: 0.5 });
    fillLinearGradientStops(ref, 0, 0, 8, 0, RB, null);
    for (let x = 0; x < 8; x++) {
      const got = px(img, x, 0);
      const want = px(ref, x, 0);
      assert.deepEqual(got.slice(0, 3), want.slice(0, 3));
      assert.ok(Math.abs(got[3] - 128) <= 1, `alpha ${got[3]}`);
    }
  });

  test('opacity 1 matches the opaque fill byte for byte', () => {
    const base = makeImage(16, 9, [10, 200, 30, 90]);
    const a = { ...base, data: new Uint8ClampedArray(base.data) };
    const b = { ...base, data: new Uint8ClampedArray(base.data) };
    const mask = new Uint8Array(16 * 9).map((_, i) => (i % 3 ? 1 : 0));
    fillLinearGradientStops(a, 1, 2, 14, 7, RB, mask, 'radial', { dither: true });
    fillLinearGradientStops(b, 1, 2, 14, 7, RB, mask, 'radial', { dither: true, opacity: 1 });
    assert.deepEqual(a.data, b.data);
  });

  test('masked-out pixels stay put at any opacity', () => {
    const img = makeImage(2, 1, [255, 255, 255, 255]);
    fillLinearGradientStops(img, 0, 0, 2, 0, BLACK, new Uint8Array([0, 1]), 'linear', {
      opacity: 0.25
    });
    assert.deepEqual(px(img, 0, 0), [255, 255, 255, 255]);
    assert.ok(Math.abs(px(img, 1, 0)[0] - 191.25) <= 1);
  });

  function runTool(W, base, toolOptions) {
    const undo = [];
    const img = makeImage(W, 1, base);
    const ctx = {
      canvas: { width: W, height: 1 },
      getImageData: () => {
        assert.deepEqual(undo, ['Gradient']);
        return { width: W, height: 1, data: img.data.slice() };
      },
      putImageData: (next) => img.data.set(next.data)
    };
    const ov = { canvas: { width: W, height: 1 }, clearRect() {} };
    const state = {
      color: '#ff0000',
      bgColor: '#0000ff',
      sel: { mode: 'none' },
      pushUndo: (l) => undo.push(l),
      toolOptions: { gradient: toolOptions }
    };
    TOOLS.gradient.onDown(ctx, ov, state, 0.5, 0);
    TOOLS.gradient.onUp(ctx, ov, state, W - 0.5, 0);
    return img;
  }

  test('the Gradient tool passes opts.opacity / 100 through after pushUndo', () => {
    const W = 9;
    const got = runTool(W, [255, 255, 255, 255], { opacity: 40 });
    const want = makeImage(W, 1, [255, 255, 255, 255]);
    fillLinearGradientStops(want, 0.5, 0, W - 0.5, 0, RB, null, 'linear', { opacity: 0.4 });
    assert.deepEqual(Array.from(got.data), Array.from(want.data));
    // Without an opacity option the tool writes the opaque fill.
    const plain = runTool(W, [255, 255, 255, 255], {});
    const opaque = makeImage(W, 1);
    fillLinearGradientStops(opaque, 0.5, 0, W - 0.5, 0, RB, null);
    assert.deepEqual(Array.from(plain.data), Array.from(opaque.data));
  });
}

// --- from paint-gradient-tool-options-order.test.mjs ---
{
  const ORDER = ['preset', 'shape', 'mode', 'opacity', 'reverse', 'dither'];

  test("gradient options follow PhotoCraft's options bar order", () => {
    assert.deepEqual(
      TOOL_OPTION_SCHEMA.gradient.map((o) => o.key),
      ORDER
    );
  });

  test('rendered gradient controls appear in schema order', () => {
    const { window } = new JSDOM('<!doctype html><div id="opts"></div>');
    const prev = globalThis.document;
    globalThis.document = window.document;
    try {
      const container = window.document.getElementById('opts');
      renderToolOptions(TOOL_OPTION_SCHEMA.gradient, {}, container, () => {});
      const rows = Array.from(container.children);
      assert.equal(rows.length, ORDER.length);
      const ids = rows.map(
        (row) =>
          row.querySelector('input, select, button[aria-haspopup], [role=radiogroup]')?.id ?? null
      );
      assert.deepEqual(ids, [
        'opt-preset',
        'opt-shape',
        'opt-mode',
        'opt-opacity',
        'opt-reverse',
        'opt-dither'
      ]);
      assert.equal(rows[0].querySelector('button').id, 'opt-preset');
      const dither = rows[ORDER.length - 1].querySelector('input');
      assert.equal(dither.type, 'checkbox');
      assert.equal(container.querySelector('.tool-opt-hint'), null);
    } finally {
      globalThis.document = prev;
    }
  });
}

// --- from paint-gradient-tool-preset-swatch.test.mjs ---
{
  const find = (name) =>
    GRADIENT_PRESET_GROUPS.flatMap((g) => g.presets).find((p) => p.name === name);

  function render(values, onChange, colors) {
    const { window } = new JSDOM('<!doctype html><div id="opts"></div>');
    const prev = globalThis.document;
    globalThis.document = window.document;
    try {
      const container = window.document.getElementById('opts');
      renderToolOptions(TOOL_OPTION_SCHEMA.gradient, values, container, onChange, colors);
      return { window, container };
    } finally {
      globalThis.document = prev;
    }
  }

  test('presetSwatchCss resolves foreground and background into rgba stops', () => {
    assert.equal(
      presetSwatchCss(find('Foreground to Background'), '#ff0000', '#0000ff'),
      'linear-gradient(to right, rgba(255, 0, 0, 1) 0%, rgba(0, 0, 255, 1) 100%)'
    );
    assert.equal(
      presetSwatchCss(find('Foreground to Background')),
      'linear-gradient(to right, rgba(0, 0, 0, 1) 0%, rgba(255, 255, 255, 1) 100%)'
    );
  });

  test('Foreground to Transparent ends at alpha 0', () => {
    assert.equal(
      presetSwatchCss(find('Foreground to Transparent'), '#336699', '#ffffff'),
      'linear-gradient(to right, rgba(51, 102, 153, 1) 0%, rgba(51, 102, 153, 0) 100%)'
    );
  });

  test('swatch stop percentages run in order over color and opacity stops', () => {
    const css = presetSwatchCss(find('Rainbow Fade'));
    const pcts = [...css.matchAll(/\) ([\d.]+)%/g)].map((m) => parseFloat(m[1]));
    assert.equal(pcts[0], 0);
    assert.equal(pcts[pcts.length - 1], 100);
    for (let i = 1; i < pcts.length; i++) assert.ok(pcts[i] > pcts[i - 1]);
    assert.ok(pcts.includes(12.5) && pcts.includes(87.5));
    assert.match(css, /^linear-gradient\(to right, rgba\(236, 19, 19, 0\) 0%/);
    assert.match(css, /rgba\(236, 19, 236, 0\) 100%\)$/);
  });

  test('preset option keeps its values and becomes a gradientSwatch', () => {
    const preset = TOOL_OPTION_SCHEMA.gradient[0];
    assert.equal(preset.key, 'preset');
    assert.equal(preset.type, 'gradientSwatch');
    assert.equal(preset.label, 'Preset');
    assert.equal(preset.default, 'Basics/Foreground to Background');
    assert.deepEqual(
      preset.options.map((o) => o.value),
      GRADIENT_PRESET_GROUPS.flatMap((g) => g.presets.map((p) => `${g.name}/${p.name}`))
    );
  });

  test('the swatch button opens a listbox of presets and a choice calls onChange', () => {
    const calls = [];
    const { window, container } = render({}, (k, v) => calls.push([k, v]), ['#ff0000', '#0000ff']);
    const btn = container.querySelector('#opt-preset');
    assert.equal(btn.tagName, 'BUTTON');
    assert.equal(btn.getAttribute('aria-haspopup'), 'listbox');
    assert.equal(btn.title, 'Foreground to Background');
    assert.match(btn.style.backgroundImage, /rgba?\(255, 0, 0/);

    const list = container.querySelector('[role=listbox]');
    assert.ok(list.hidden);
    btn.click();
    assert.ok(!list.hidden);

    const items = [...list.querySelectorAll('[role=option]')];
    const expected = GRADIENT_PRESET_GROUPS.flatMap((g) => g.presets.map((p) => p.name));
    assert.deepEqual(
      items.map((i) => i.title),
      expected
    );
    assert.deepEqual(
      [...list.querySelectorAll('[role=group]')].map((g) => g.getAttribute('aria-label')),
      GRADIENT_PRESET_GROUPS.map((g) => g.name)
    );
    const selected = () => items.filter((i) => i.getAttribute('aria-selected') === 'true');
    assert.deepEqual(selected(), [items[0]]);

    const rainbow = items.find((i) => i.title === 'Rainbow');
    rainbow.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.deepEqual(calls, [['preset', 'Rainbows/Rainbow']]);
    assert.deepEqual(selected(), [rainbow]);
    assert.ok(list.hidden);
    assert.equal(btn.title, 'Rainbow');
    assert.match(btn.style.backgroundImage, /rgba?\(236, 19, 19/);
  });

  test('Escape closes the preset list', () => {
    const { window, container } = render({ preset: 'Grays/Gray 01' }, () => {});
    const btn = container.querySelector('#opt-preset');
    const list = container.querySelector('[role=listbox]');
    assert.equal(btn.title, 'Gray 01');
    assert.equal(list.querySelector('[aria-selected=true]').title, 'Gray 01');
    btn.click();
    assert.ok(!list.hidden);
    btn.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.ok(list.hidden);
    assert.equal(btn.getAttribute('aria-expanded'), 'false');
  });

  test('swatchBackground layers a checkerboard only under transparent presets', () => {
    const fgBg = find('Foreground to Background');
    assert.equal(
      swatchBackground(fgBg, '#ff0000', '#0000ff'),
      presetSwatchCss(fgBg, '#ff0000', '#0000ff')
    );
    assert.equal(swatchBackground(find('Rainbow')), presetSwatchCss(find('Rainbow')));
    for (const name of ['Foreground to Transparent', 'Rainbow Fade']) {
      const p = find(name);
      assert.equal(
        swatchBackground(p, '#336699', '#ffffff'),
        `${presetSwatchCss(p, '#336699', '#ffffff')}, ${SWATCH_CHECKER}`
      );
    }
    assert.match(SWATCH_CHECKER, /#d6d6d6/);
    assert.match(SWATCH_CHECKER, /#fafafa/);
  });

  function withDocument(window, fn) {
    const prev = globalThis.document;
    globalThis.document = window.document;
    try {
      return fn();
    } finally {
      globalThis.document = prev;
    }
  }

  test('a foreground or background change repaints the swatch and every list option', () => {
    const { window, container } = render({}, () => {}, ['#ff0000', '#0000ff']);
    const btn = container.querySelector('#opt-preset');
    const items = [...container.querySelectorAll('[role=option]')];
    const fgTransparent = items.find((i) => i.title === 'Foreground to Transparent');
    const blue = items.find((i) => i.title === 'Blue 01');
    const blueBefore = blue.style.backgroundImage;

    withDocument(window, () => showColor('fg', '#00ff00'));
    assert.match(btn.style.backgroundImage, /^linear-gradient\(to right, rgba?\(0, 255, 0/);
    assert.match(btn.style.backgroundImage, /rgba?\(0, 0, 255/);
    assert.match(fgTransparent.style.backgroundImage, /rgba?\(0, 255, 0/);
    assert.match(fgTransparent.style.backgroundImage, /repeating-conic-gradient/);
    assert.equal(blue.style.backgroundImage, blueBefore);

    withDocument(window, () => showColor('bg', '#ffff00'));
    assert.match(btn.style.backgroundImage, /rgba?\(0, 255, 0/);
    assert.match(btn.style.backgroundImage, /rgba?\(255, 255, 0/);
    assert.doesNotMatch(btn.style.backgroundImage, /repeating-conic-gradient/);
    assert.equal(btn.title, 'Foreground to Background');
  });

  test('clicking outside closes the list and a re-render drops the document listener', () => {
    const { window, container } = render({}, () => {});
    const doc = window.document;
    const added = [];
    const removed = [];
    const add = doc.addEventListener.bind(doc);
    const remove = doc.removeEventListener.bind(doc);
    doc.addEventListener = (type, fn, o) => (added.push([type, fn]), add(type, fn, o));
    doc.removeEventListener = (type, fn, o) => (removed.push([type, fn]), remove(type, fn, o));

    const btn = container.querySelector('#opt-preset');
    const list = container.querySelector('[role=listbox]');
    btn.click();
    list
      .querySelector('[role=option]')
      .dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
    assert.ok(!list.hidden, 'a pointerdown inside keeps the list open');
    doc.body.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
    assert.ok(list.hidden);
    assert.equal(btn.getAttribute('aria-expanded'), 'false');

    withDocument(window, () => {
      renderToolOptions(TOOL_OPTION_SCHEMA.gradient, {}, container, () => {});
      assert.equal(removed.length, 1);
      assert.equal(removed[0][0], 'pointerdown');
      assert.equal(added.length, 1);
      assert.notEqual(added[0][1], removed[0][1]);
      renderToolOptions([], {}, container, () => {});
      assert.equal(removed.length, 2);
      assert.equal(removed[1][1], added[0][1]);
    });
  });
}

// --- from paint-gradient-tool-presets.test.mjs ---
{
  const THREE = [
    [0, '#ff0000'],
    [0.5, '#00ff00'],
    [1, '#0000ff']
  ];

  test('gradient options list Foreground to Background first, then every preset, and no hint', () => {
    const opts = TOOL_OPTION_SCHEMA.gradient;
    const preset = opts.find((o) => o.key === 'preset');
    assert.equal(preset.type, 'gradientSwatch');
    const expected = GRADIENT_PRESET_GROUPS.flatMap((g) =>
      g.presets.map((p) => `${g.name}/${p.name}`)
    );
    assert.deepEqual(
      preset.options.map((o) => o.value),
      expected
    );
    assert.equal(preset.options[0].label, 'Foreground to Background');
    assert.equal(preset.default, preset.options[0].value);
    assert.equal(new Set(expected).size, expected.length, 'values are unique');
    assert.ok(!opts.some((o) => o.type === 'hint'));
    for (const o of preset.options) {
      const [group, name] = o.value.split('/');
      assert.equal(gradientToolPreset(o.value).name, name);
      assert.ok(GRADIENT_PRESET_GROUPS.some((g) => g.name === group));
    }
    assert.equal(gradientToolPreset('nope').name, 'Foreground to Background');
  });

  test('fillLinearGradientStops paints a three-stop gradient along a horizontal drag', () => {
    const img = makeImage(21, 2);
    assert.equal(fillLinearGradientStops(img, 0.5, 0, 20.5, 0, THREE, null), true);
    assert.deepEqual(px(img, 0, 0), [255, 0, 0, 255]);
    assert.deepEqual(px(img, 10, 1), [0, 255, 0, 255]);
    assert.deepEqual(px(img, 20, 0), [0, 0, 255, 255]);
    assert.deepEqual(px(img, 5, 0), [128, 128, 0, 255]);
    assert.deepEqual(px(img, 15, 0), [0, 128, 128, 255]);
  });

  test('fillLinearGradientStops clamps past the ends and skips masked-out pixels', () => {
    const W = 10,
      H = 3;
    const seed = [10, 20, 30, 40];
    const img = makeImage(W, H, seed);
    const mask = new Uint8Array(W * H);
    for (let x = 0; x < W; x++) mask[W + x] = 1;
    fillLinearGradientStops(img, 3, 0, 7, 0, THREE, mask);
    assert.deepEqual(px(img, 0, 1), [255, 0, 0, 255]);
    assert.deepEqual(px(img, 9, 1), [0, 0, 255, 255]);
    for (const y of [0, 2]) {
      for (let x = 0; x < W; x++) assert.deepEqual(px(img, x, y), seed);
    }
  });

  test('fillLinearGradientStops returns false for a zero-length segment', () => {
    const seed = [10, 20, 30, 40];
    const img = makeImage(4, 4, seed);
    assert.equal(fillLinearGradientStops(img, 2, 2, 2, 2, THREE, null), false);
    assert.deepEqual(px(img, 1, 1), seed);
  });

  test('two stops give the same pixels as fillLinearGradient', () => {
    const a = makeImage(37, 23);
    const b = makeImage(37, 23);
    const args = [3.2, 1.7, 30.9, 19.4];
    fillLinearGradient(a, ...args, '#123456', '#fedcba', null);
    fillLinearGradientStops(
      b,
      ...args,
      [
        [0, '#123456'],
        [1, '#fedcba']
      ],
      null
    );
    assert.deepEqual(Array.from(b.data), Array.from(a.data));
  });

  function fakeCtx(W, H) {
    const img = makeImage(W, H, [0, 0, 0, 0]);
    return {
      img,
      canvas: { width: W, height: H },
      getImageData: () => ({ width: W, height: H, data: img.data.slice() }),
      putImageData: (next) => img.data.set(next.data)
    };
  }

  const fakeOverlay = (W, H) => ({ canvas: { width: W, height: H }, clearRect() {} });

  function drag(state, W) {
    const ctx = fakeCtx(W, 1);
    const ov = fakeOverlay(W, 1);
    const tool = TOOLS.gradient;
    tool.onDown(ctx, ov, state, 0.5, 0);
    tool.onUp(ctx, ov, state, W - 0.5, 0);
    return ctx.img;
  }

  test('the Gradient tool fills with the chosen preset and defaults to foreground → background', () => {
    const undo = [];
    const base = {
      color: '#ff0000',
      bgColor: '#0000ff',
      sel: { mode: 'none' },
      pushUndo: (l) => undo.push(l)
    };
    const W = 21;
    const fgbg = drag({ ...base }, W);
    const expected = makeImage(W, 1);
    fillLinearGradient(expected, 0.5, 0, W - 0.5, 0, '#ff0000', '#0000ff', null);
    assert.deepEqual(Array.from(fgbg.data), Array.from(expected.data));

    const value = 'Grays/Gray 03';
    const img = drag({ ...base, toolOptions: { gradient: { preset: value } } }, W);
    const stops = resolvePresetStops(gradientToolPreset(value), base.color, base.bgColor);
    assert.equal(stops.length, 3);
    assert.deepEqual(px(img, 0, 0), [0, 0, 0, 255]);
    assert.deepEqual(px(img, 10, 0), [0x6c, 0x75, 0x7d, 255]);
    assert.deepEqual(px(img, 20, 0), [255, 255, 255, 255]);
    assert.deepEqual(undo, ['Gradient', 'Gradient']);
  });

  test('Foreground to Transparent paints the foreground color, fading out', () => {
    const img = drag(
      {
        color: '#336699',
        bgColor: '#ffffff',
        sel: { mode: 'none' },
        toolOptions: { gradient: { preset: 'Basics/Foreground to Transparent' } }
      },
      8
    );
    let prev = 256;
    for (let x = 0; x < 8; x++) {
      const p = px(img, x, 0);
      if (p[3] > 0) assert.deepEqual(p.slice(0, 3), [0x33, 0x66, 0x99]);
      assert.ok(p[3] < prev || p[3] === 0, `alpha falls at x=${x}`);
      prev = p[3];
    }
    assert.equal(px(img, 0, 0)[3], 255);
    assert.equal(px(img, 7, 0)[3], 0);
  });
}

// --- from paint-gradient-tool-reverse-dither.test.mjs ---
{
  const RB = [
    [0, '#ff0000'],
    [1, '#0000ff']
  ];

  test('gradient Reverse and Dither checkboxes sit after Opacity, off', () => {
    const opts = TOOL_OPTION_SCHEMA.gradient;
    assert.deepEqual(
      opts.map((o) => o.key),
      ['preset', 'shape', 'mode', 'opacity', 'reverse', 'dither']
    );
    for (const key of ['reverse', 'dither']) {
      const o = opts.find((x) => x.key === key);
      assert.equal(o.type, 'checkbox');
      assert.equal(o.default, false);
    }
  });

  test('ditherNoise matches PhotoCraft dither_noise', () => {
    // Expected values computed from the Rust formula with u32 wrapping math and f32 output.
    assert.equal(ditherNoise(0, 0), 0);
    assert.equal(ditherNoise(1, 0), 0.5151903629302979);
    assert.equal(ditherNoise(0, 1), 0.5722590684890747);
    assert.equal(ditherNoise(7, 3), 0.9577324986457825);
    assert.equal(ditherNoise(123, 456), 0.9054398536682129);
    assert.equal(ditherNoise(-5, 9), 0.4271610677242279);
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 20; x++) {
        const n = ditherNoise(x, y);
        assert.ok(n >= 0 && n <= 1);
      }
    }
  });

  test('Reverse paints the end color at the start of the drag', () => {
    const W = 11;
    const fwd = makeImage(W, 1);
    const rev = makeImage(W, 1);
    fillLinearGradientStops(fwd, 0.5, 0, W - 0.5, 0, RB, null);
    fillLinearGradientStops(rev, 0.5, 0, W - 0.5, 0, RB, null, 'linear', { reverse: true });
    assert.deepEqual(px(rev, 0, 0), [0, 0, 255, 255]);
    assert.deepEqual(px(rev, W - 1, 0), [255, 0, 0, 255]);
    // Mirrored, up to a .5 rounding tie.
    for (let x = 0; x < W; x++) {
      const r = px(rev, x, 0),
        f = px(fwd, W - 1 - x, 0);
      for (let c = 0; c < 4; c++) assert.ok(Math.abs(r[c] - f[c]) <= 1);
    }
  });

  test('Dither moves each channel by at most one step and is deterministic', () => {
    const W = 64,
      H = 8;
    const plain = makeImage(W, H);
    const a = makeImage(W, H);
    const b = makeImage(W, H);
    const stops = [
      [0, '#202020'],
      [1, '#303030']
    ];
    fillLinearGradientStops(plain, 0, 0, W, 0, stops, null);
    fillLinearGradientStops(a, 0, 0, W, 0, stops, null, 'linear', { dither: true });
    fillLinearGradientStops(b, 0, 0, W, 0, stops, null, 'linear', { dither: true });
    assert.deepEqual(Array.from(a.data), Array.from(b.data));
    let changed = 0;
    for (let i = 0; i < a.data.length; i++) {
      assert.ok(Math.abs(a.data[i] - plain.data[i]) <= 1);
      if (a.data[i] !== plain.data[i]) changed++;
    }
    assert.ok(changed > 0, 'dither changed no pixels');
    for (let i = 3; i < a.data.length; i += 4) assert.equal(a.data[i], 255);
  });

  test('the Gradient tool passes Reverse and Dither through after pushUndo', () => {
    const W = 21;
    const undo = [];
    const img = makeImage(W, 1);
    const ctx = {
      canvas: { width: W, height: 1 },
      getImageData: () => {
        assert.deepEqual(undo, ['Gradient']);
        return { width: W, height: 1, data: img.data.slice() };
      },
      putImageData: (next) => img.data.set(next.data)
    };
    const ov = { canvas: { width: W, height: 1 }, clearRect() {} };
    const state = {
      color: '#ff0000',
      bgColor: '#0000ff',
      sel: { mode: 'none' },
      pushUndo: (l) => undo.push(l),
      toolOptions: { gradient: { reverse: true, dither: true } }
    };
    TOOLS.gradient.onDown(ctx, ov, state, 0.5, 0);
    TOOLS.gradient.onUp(ctx, ov, state, W - 0.5, 0);
    const expected = makeImage(W, 1);
    fillLinearGradientStops(expected, 0.5, 0, W - 0.5, 0, RB, null, 'linear', {
      reverse: true,
      dither: true
    });
    assert.deepEqual(Array.from(img.data), Array.from(expected.data));
  });
}

// --- from paint-gradient-tool-shape-buttons.test.mjs ---
{
  const SHAPES = [
    ['linear', 'gradient', 'Linear Gradient'],
    ['radial', 'circle', 'Radial Gradient'],
    ['angle', 'rotate-cw', 'Angle Gradient'],
    ['reflected', 'arrow-left-right', 'Reflected Gradient'],
    ['diamond', 'diamond', 'Diamond Gradient']
  ];

  const EMOJI = /\p{Extended_Pictographic}/u;

  test('gradient Shape is an iconButtons option with PhotoCraft icons and titles', () => {
    const shape = TOOL_OPTION_SCHEMA.gradient.find((o) => o.key === 'shape');
    assert.equal(shape.type, 'iconButtons');
    assert.equal(shape.label, 'Shape');
    assert.equal(shape.default, 'linear');
    assert.deepEqual(
      shape.options.map((o) => [o.value, o.icon, o.title]),
      SHAPES
    );
    assert.deepEqual(
      TOOL_OPTION_SCHEMA.gradient.map((o) => o.key),
      ['preset', 'shape', 'mode', 'opacity', 'reverse', 'dither']
    );
  });

  test('Shape renders as a radiogroup of five svg buttons; a click moves the check', () => {
    const { window } = new JSDOM('<!doctype html><div id="opts"></div>');
    const prev = globalThis.document;
    globalThis.document = window.document;
    try {
      const container = window.document.getElementById('opts');
      const calls = [];
      renderToolOptions(TOOL_OPTION_SCHEMA.gradient, {}, container, (k, v) => calls.push([k, v]));
      const group = container.querySelector('[role=radiogroup]');
      assert.ok(group, 'radiogroup missing');
      assert.equal(group.id, 'opt-shape');
      const buttons = Array.from(group.querySelectorAll('button'));
      assert.equal(buttons.length, 5);
      buttons.forEach((btn, i) => {
        assert.equal(btn.title, SHAPES[i][2]);
        assert.equal(btn.getAttribute('aria-label'), SHAPES[i][2]);
        assert.equal(btn.getAttribute('role'), 'radio');
        assert.ok(btn.querySelector('svg'), `${SHAPES[i][0]} has no svg`);
        assert.doesNotMatch(btn.textContent, EMOJI);
      });
      const checked = () => buttons.map((b) => b.getAttribute('aria-checked'));
      assert.deepEqual(checked(), ['true', 'false', 'false', 'false', 'false']);

      buttons[4].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      assert.deepEqual(calls, [['shape', 'diamond']]);
      assert.deepEqual(checked(), ['false', 'false', 'false', 'false', 'true']);
    } finally {
      globalThis.document = prev;
    }
  });

  test('a stored shape value is the checked button', () => {
    const { window } = new JSDOM('<!doctype html><div id="opts"></div>');
    const prev = globalThis.document;
    globalThis.document = window.document;
    try {
      const container = window.document.getElementById('opts');
      renderToolOptions(TOOL_OPTION_SCHEMA.gradient, { shape: 'angle' }, container, () => {});
      const buttons = Array.from(container.querySelectorAll('[role=radiogroup] button'));
      assert.deepEqual(
        buttons.map((b) => b.getAttribute('aria-checked')),
        ['false', 'false', 'true', 'false', 'false']
      );
    } finally {
      globalThis.document = prev;
    }
  });
}

// --- from paint-gradient-tool-shapes.test.mjs ---
{
  const BW = [
    [0, '#000000'],
    [1, '#ffffff']
  ];

  test('gradient Shape option lists the five PhotoCraft shapes after Preset, default linear', () => {
    const opts = TOOL_OPTION_SCHEMA.gradient;
    const keys = opts.map((o) => o.key);
    assert.ok(keys.indexOf('preset') < keys.indexOf('shape'));
    assert.ok(!keys.includes('_hint'));
    const shape = opts.find((o) => o.key === 'shape');
    assert.equal(shape.type, 'iconButtons');
    assert.equal(shape.default, 'linear');
    assert.deepEqual(
      shape.options.map((o) => o.value),
      ['linear', 'radial', 'angle', 'reflected', 'diamond']
    );
  });

  test('gradientToolT linear runs along the drag and clamps', () => {
    assert.equal(gradientToolT('linear', 0, 0, 10, 0, 5, 3), 0.5);
    assert.equal(gradientToolT('linear', 0, 0, 10, 0, -4, 0), 0);
    assert.equal(gradientToolT('linear', 0, 0, 10, 0, 20, 0), 1);
  });

  test('gradientToolT radial is 0 at the center and 1 at the radius', () => {
    assert.equal(gradientToolT('radial', 5, 5, 15, 5, 5, 5), 0);
    assert.equal(gradientToolT('radial', 5, 5, 15, 5, 5, 15), 1);
    assert.equal(gradientToolT('radial', 5, 5, 15, 5, 8, 9), 0.5);
    assert.equal(gradientToolT('radial', 5, 5, 15, 5, 40, 40), 1);
  });

  test('gradientToolT reflected is symmetric about the start', () => {
    const ahead = gradientToolT('reflected', 10, 0, 20, 0, 14, 2);
    const behind = gradientToolT('reflected', 10, 0, 20, 0, 6, 2);
    assert.ok(Math.abs(ahead - 0.4) < 1e-12);
    assert.equal(ahead, behind);
    assert.equal(gradientToolT('reflected', 10, 0, 20, 0, -5, 0), 1);
  });

  test('gradientToolT diamond sums along and across', () => {
    assert.equal(gradientToolT('diamond', 0, 0, 10, 0, 5, 0), 0.5);
    assert.equal(gradientToolT('diamond', 0, 0, 10, 0, 0, -5), 0.5);
    assert.equal(gradientToolT('diamond', 0, 0, 10, 0, 3, 3), 0.6);
    assert.equal(gradientToolT('diamond', 0, 0, 10, 0, 8, 8), 1);
  });

  test('gradientToolT angle sweeps a full turn from the drag direction', () => {
    assert.equal(gradientToolT('angle', 0, 0, 10, 0, 5, 0), 0);
    assert.equal(gradientToolT('angle', 0, 0, 10, 0, 0, 5), 0.25);
    assert.equal(gradientToolT('angle', 0, 0, 10, 0, -5, 0), 0.5);
    assert.equal(gradientToolT('angle', 0, 0, 10, 0, 0, -5), 0.75);
    // Rotating the drag rotates the sweep: a drag down puts the quarter turn on the left.
    assert.ok(Math.abs(gradientToolT('angle', 0, 0, 0, 10, -5, 0) - 0.25) < 1e-12);
  });

  test('a radial drag paints the start color at the center and the end color past the radius', () => {
    const img = makeImage(21, 21);
    assert.equal(fillLinearGradientStops(img, 10.5, 10.5, 15.5, 10.5, BW, null, 'radial'), true);
    assert.deepEqual(px(img, 10, 10), [0, 0, 0, 255]);
    assert.deepEqual(px(img, 10, 0), [255, 255, 255, 255]);
    assert.deepEqual(px(img, 0, 0), [255, 255, 255, 255]);
    // Two pixels left of the center sits 0.4 of the way out, the same as two pixels up.
    assert.deepEqual(px(img, 8, 10), [102, 102, 102, 255]);
    assert.deepEqual(px(img, 10, 8), px(img, 8, 10));
  });

  test('non-linear shapes skip masked pixels and reject a zero-length drag', () => {
    const seed = [10, 20, 30, 40];
    const img = makeImage(4, 1, seed);
    const mask = new Uint8Array([1, 0, 1, 1]);
    fillLinearGradientStops(img, 0, 0.5, 4, 0.5, BW, mask, 'diamond');
    assert.deepEqual(px(img, 1, 0), seed);
    assert.equal(px(img, 2, 0)[3], 255);

    const before = makeImage(3, 3, seed);
    const after = makeImage(3, 3, seed);
    assert.equal(fillLinearGradientStops(after, 1, 1, 1, 1, BW, null, 'radial'), false);
    assert.deepEqual(after.data, before.data);
  });

  test('the linear shape matches the default fill', () => {
    const a = makeImage(9, 5);
    const b = makeImage(9, 5);
    fillLinearGradientStops(a, 1, 1, 7, 4, BW, null);
    fillLinearGradientStops(b, 1, 1, 7, 4, BW, null, 'linear');
    assert.deepEqual(a.data, b.data);
  });
}

// --- from paint-gradient-tool-transparency.test.mjs ---
{
  const W = 101;
  const fgTransparent = gradientToolPreset('Basics/Foreground to Transparent');
  const RED = resolvePresetStops(fgTransparent, '#ff0000', '#ffffff');
  const FADE = resolvePresetOpacity(fgTransparent);

  test('presets carry opacity stops; opaque ones resolve to [[0, 1], [1, 1]]', () => {
    assert.deepEqual(FADE, [
      [0, 1],
      [1, 0]
    ]);
    assert.deepEqual(resolvePresetOpacity(gradientToolPreset('Rainbows/Rainbow Fade')), [
      [0, 0],
      [0.125, 1],
      [0.875, 1],
      [1, 0]
    ]);
    for (const g of GRADIENT_PRESET_GROUPS) {
      for (const p of g.presets) {
        if (p.name === 'Foreground to Transparent' || p.name === 'Rainbow Fade') continue;
        assert.deepEqual(resolvePresetOpacity(p), [
          [0, 1],
          [1, 1]
        ]);
      }
    }
    // Fresh arrays: editing the result leaves the preset alone.
    FADE.slice()[0] = [0, 0];
    assert.equal(fgTransparent.opacity[0][1], 1);
  });

  test('Foreground to Transparent over opaque white fades red into white', () => {
    const img = makeImage(W, 1, [255, 255, 255, 255]);
    assert.equal(
      fillLinearGradientStops(img, 0, 0, W, 0, RED, null, 'linear', { alphaStops: FADE }),
      true
    );
    near(px(img, 0, 0), [255, 0, 0, 255], 3, 'start');
    near(px(img, W - 1, 0), [255, 255, 255, 255], 3, 'end');
    near(px(img, 50, 0), [255, 128, 128, 255], 2, 'middle');
  });

  test('over a transparent layer the color stays red and alpha ramps 255 → 0', () => {
    const img = makeImage(W, 1);
    fillLinearGradientStops(img, 0, 0, W, 0, RED, null, 'linear', { alphaStops: FADE });
    const first = px(img, 0, 0);
    assert.deepEqual(first.slice(0, 3), [255, 0, 0]);
    assert.ok(first[3] >= 252, `start alpha ${first[3]}`);
    near([px(img, 50, 0)[3]], [128], 2, 'middle alpha');
    assert.ok(px(img, W - 1, 0)[3] <= 3, `end alpha ${px(img, W - 1, 0)[3]}`);
    let prev = 256;
    for (let x = 0; x < W; x++) {
      const p = px(img, x, 0);
      if (p[3] > 0) assert.deepEqual(p.slice(0, 3), [255, 0, 0]);
      assert.ok(p[3] <= prev, `alpha rises at x=${x}`);
      prev = p[3];
    }
  });

  test('Reverse flips the alpha ramp', () => {
    const fwd = makeImage(W, 1);
    const rev = makeImage(W, 1);
    fillLinearGradientStops(fwd, 0, 0, W, 0, RED, null, 'linear', { alphaStops: FADE });
    fillLinearGradientStops(rev, 0, 0, W, 0, RED, null, 'linear', {
      alphaStops: FADE,
      reverse: true
    });
    assert.ok(px(rev, 0, 0)[3] <= 3);
    assert.ok(px(rev, W - 1, 0)[3] >= 252);
    for (let x = 0; x < W; x++) near([px(rev, x, 0)[3]], [px(fwd, W - 1 - x, 0)[3]], 1, `x=${x}`);
  });

  test('alpha stops compose with opacity and blend modes', () => {
    const img = makeImage(W, 1, [255, 255, 255, 255]);
    fillLinearGradientStops(img, 0, 0, W, 0, RED, null, 'linear', {
      alphaStops: FADE,
      opacity: 0.5
    });
    near(px(img, 50, 0), [255, 191, 191, 255], 2, 'half opacity middle');
    const mul = makeImage(W, 1, [255, 255, 255, 255]);
    fillLinearGradientStops(mul, 0, 0, W, 0, RED, null, 'linear', {
      alphaStops: FADE,
      mode: 'multiply'
    });
    near(px(mul, 50, 0), [255, 128, 128, 255], 2, 'multiply middle');
  });

  test('an opaque preset with alpha stops matches the fill without them byte for byte', () => {
    const p = gradientToolPreset('Blues/Blue 02');
    const stops = resolvePresetStops(p, '#000000', '#ffffff');
    for (const options of [{}, { opacity: 0.4 }, { mode: 'screen', dither: true }]) {
      const a = makeImage(64, 8, [10, 200, 30, 128]);
      const b = makeImage(64, 8, [10, 200, 30, 128]);
      fillLinearGradientStops(a, 3, 1, 60, 7, stops, null, 'radial', options);
      fillLinearGradientStops(b, 3, 1, 60, 7, stops, null, 'radial', {
        ...options,
        alphaStops: resolvePresetOpacity(p)
      });
      assert.deepEqual(b.data, a.data);
    }
  });
}

import test from 'node:test';
import assert from 'node:assert/strict';

import { ICONS } from '../paint/icons.js';
import { historyIconName } from '../paint/history.js';
import { backgroundEraseDab, hotspotColor } from '../paint/retouch.js';
import { TOOLS, TOOL_OPTION_SCHEMA, defaultToolOptions } from '../paint/tools.js';

const GREEN = [51, 153, 51, 255];
const BLUE = [26, 26, 128, 255];
const unit = (c) => c.slice(0, 3).map((v) => v / 255);

function image(W, H, f) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) data.set(f(x, y), (y * W + x) * 4);
  return { width: W, height: H, data };
}

function px(img, x, y) {
  const i = (y * img.width + x) * 4;
  return Array.from(img.data.slice(i, i + 4));
}

// Green at x < 20, blue from x 20, 40 × 20.
const halves = () => image(40, 20, (x) => (x < 20 ? GREEN : BLUE));

// One dab of radius r at (cx, cy) on img with fresh src / cov; returns img.
function dab(img, cx, cy, r, sample, opts = {}) {
  const { tolerance = 0.05, limits = 'discontiguous', protect = null, mask = null } = opts;
  const src = opts.src ?? new Uint8ClampedArray(img.data);
  const cov = opts.cov ?? new Float32Array(img.width * img.height);
  backgroundEraseDab(
    img.data,
    src,
    img.width,
    img.height,
    cx,
    cy,
    r,
    1,
    sample,
    tolerance,
    limits,
    protect,
    mask,
    cov
  );
  return img;
}

test('backgroundEraser is a tool with the eraser-background icon and PhotoCraft options', () => {
  const ids = Object.keys(TOOLS);
  assert.equal(ids.indexOf('backgroundEraser'), ids.indexOf('magicEraser') + 1);
  assert.equal(TOOLS.backgroundEraser.label, 'Background Eraser');
  assert.equal(TOOLS.backgroundEraser.icon, 'eraser-background');
  assert.match(ICONS['eraser-background'], /M2 2h1/);
  assert.match(ICONS['circle-dot'], /r="1"/);
  assert.equal(historyIconName('Background Eraser'), 'eraser-background');
  const fields = TOOL_OPTION_SCHEMA.backgroundEraser.filter((f) => f.type !== 'hint');
  assert.deepEqual(
    fields.map((f) => [f.key, f.type, f.label, f.min, f.max, f.default]),
    [
      ['size', 'range', 'Size', 1, 100, 20],
      ['sampling', 'iconButtons', 'Sampling', undefined, undefined, 'continuous'],
      ['limits', 'select', 'Limits', undefined, undefined, 'contiguous'],
      ['tolerance', 'number', 'Tolerance', 0, 100, 50],
      ['protectForeground', 'checkbox', 'Protect Foreground Color', undefined, undefined, false]
    ]
  );
  assert.deepEqual(
    fields[1].options.map((o) => [o.value, o.icon]),
    [
      ['continuous', 'pipette'],
      ['once', 'circle-dot'],
      ['backgroundSwatch', 'square']
    ]
  );
  for (const o of fields[1].options) assert.ok(ICONS[o.icon], o.icon);
  assert.deepEqual(
    fields[2].options.map((o) => o.value),
    ['discontiguous', 'contiguous', 'findEdges']
  );
  assert.deepEqual(defaultToolOptions().backgroundEraser, {
    size: 20,
    sampling: 'continuous',
    limits: 'contiguous',
    tolerance: 50,
    protectForeground: false
  });
});

test('a dab erases only the sampled colour, keeps its RGB, and skips a null sample', () => {
  const img = dab(halves(), 20, 10, 8, unit(GREEN));
  assert.deepEqual(px(img, 15, 10), [GREEN[0], GREEN[1], GREEN[2], 0]);
  assert.deepEqual(px(img, 19, 10), [GREEN[0], GREEN[1], GREEN[2], 0]);
  assert.deepEqual(px(img, 22, 10), BLUE);
  assert.deepEqual(px(img, 5, 10), GREEN, 'outside the brush kept');
  const untouched = dab(halves(), 20, 10, 8, null);
  assert.deepEqual(untouched.data, halves().data);
});

test('hotspotColor reads the pre-stroke pixel and is null where it is transparent', () => {
  const img = halves();
  assert.deepEqual(hotspotColor(img.data, 40, 20, 5.7, 3.2), unit(GREEN));
  assert.deepEqual(hotspotColor(img.data, 40, 20, 20, 0), unit(BLUE));
  assert.equal(hotspotColor(img.data, 40, 20, -1, 0), null);
  img.data[3] = 0;
  assert.equal(hotspotColor(img.data, 40, 20, 0, 0), null);
});

test('Contiguous and Find Edges stop at a wall; Discontiguous erases the island', () => {
  // A blue wall at x 13..14 cuts a green island off from the dab centre.
  const walled = () => image(40, 20, (x) => (x === 13 || x === 14 ? BLUE : GREEN));
  for (const [limits, islandErased] of [
    ['contiguous', false],
    ['findEdges', false],
    ['discontiguous', true]
  ]) {
    const img = dab(walled(), 8, 10, 10, unit(GREEN), { limits });
    assert.equal(px(img, 8, 10)[3], 0, limits);
    assert.equal(px(img, 16, 10)[3] === 0, islandErased, limits);
    assert.deepEqual(px(img, 13, 10), BLUE, limits);
  }
});

test('Tolerance is a max per-channel distance with a soft last quarter (hard for Find Edges)', () => {
  // Distance 0.18 from green at tolerance 0.2: weight (0.2 − 0.18) / 0.05 = 0.4.
  const near = [GREEN[0], GREEN[1] + Math.round(0.18 * 255), GREEN[2], 255];
  const make = () => image(10, 10, (x) => (x < 5 ? GREEN : near));
  const d = (near[1] - GREEN[1]) / 255;
  const k = (0.2 - d) / 0.05;
  const soft = dab(make(), 5, 5, 6, unit(GREEN), { tolerance: 0.2 });
  assert.equal(px(soft, 2, 5)[3], 0);
  assert.equal(px(soft, 7, 5)[3], Math.round(255 * (1 - k)));
  const hard = dab(make(), 5, 5, 6, unit(GREEN), { tolerance: 0.2, limits: 'findEdges' });
  assert.equal(px(hard, 7, 5)[3], 0);
  const tight = dab(make(), 5, 5, 6, unit(GREEN), { tolerance: 0.1 });
  assert.deepEqual(px(tight, 7, 5), near);
  // Tolerance 1 matches every colour.
  const all = dab(halves(), 20, 10, 6, unit(GREEN), { tolerance: 1 });
  assert.equal(px(all, 22, 10)[3], 0);
});

test('overlapping dabs build coverage once per stroke from the pre-stroke pixels', () => {
  const near = [GREEN[0], GREEN[1] + Math.round(0.18 * 255), GREEN[2], 255];
  const img = image(10, 10, () => near);
  const src = new Uint8ClampedArray(img.data);
  const cov = new Float32Array(100);
  const k = (0.2 - (near[1] - GREEN[1]) / 255) / 0.05;
  const opts = { tolerance: 0.2, src, cov };
  dab(img, 5, 5, 4, unit(GREEN), opts);
  assert.equal(px(img, 5, 5)[3], Math.round(255 * (1 - k)));
  dab(img, 5, 5, 4, unit(GREEN), opts);
  const c = k + k * (1 - k);
  assert.equal(px(img, 5, 5)[3], Math.round(255 * (1 - c)));
  assert.deepEqual(px(img, 5, 5).slice(0, 3), near.slice(0, 3));
});

test('Protect Foreground Color keeps pixels near the foreground; the mask limits writes', () => {
  const kept = dab(halves(), 20, 10, 8, unit(GREEN), { protect: unit(GREEN) });
  assert.deepEqual(kept.data, halves().data);
  // Grey 90 and 166 both sit 0.15 from the sampled 128; only 166 is within 0.2 of 204.
  const grey = (v) => [v, v, v, 255];
  const greys = () => image(20, 10, (x) => grey(x < 10 ? 90 : 166));
  const g = dab(greys(), 10, 5, 6, unit(grey(128)), {
    tolerance: 0.2,
    limits: 'discontiguous',
    protect: unit(grey(204))
  });
  assert.equal(px(g, 8, 5)[3], 0);
  assert.deepEqual(px(g, 12, 5), grey(166));

  const mask = new Uint8Array(40 * 20);
  for (let y = 0; y < 20; y++) for (let x = 0; x < 16; x++) mask[y * 40 + x] = 1;
  const clipped = dab(halves(), 16, 10, 8, unit(GREEN), { mask });
  assert.equal(px(clipped, 15, 10)[3], 0);
  assert.deepEqual(px(clipped, 17, 10), GREEN, 'outside the selection kept');
});

function fakeCtx(img, order) {
  return {
    canvas: { width: img.width, height: img.height },
    getImageData() {
      return { width: img.width, height: img.height, data: img.data.slice() };
    },
    putImageData(next) {
      order.push('put');
      img.data.set(next.data);
    }
  };
}

// Drag the tool from (10, 10) to (30, 10) on halves() with these options.
function drag(options, extra = {}) {
  const img = halves();
  const order = [];
  const state = {
    toolOptions: {
      backgroundEraser: {
        ...defaultToolOptions().backgroundEraser,
        size: 8,
        tolerance: 5,
        limits: 'discontiguous',
        ...options
      }
    },
    sel: { mode: 'none' },
    color: '#000000',
    bgColor: '#ffffff',
    pushUndo: (label) => order.push('undo:' + label),
    ...extra
  };
  const ctx = fakeCtx(img, order);
  const tool = TOOLS.backgroundEraser;
  tool.onDown(ctx, null, state, 10, 10);
  tool.onMove(ctx, null, state, 30, 10);
  tool.onUp(ctx, null, state, 30, 10);
  return { img, order, state };
}

test('Continuous re-samples per dab, Once keeps the first dab, Background Swatch uses bgColor', () => {
  const cont = drag({ sampling: 'continuous' });
  assert.equal(cont.order[0], 'undo:Background Eraser');
  assert.equal(cont.order.filter((o) => o.startsWith('undo')).length, 1);
  assert.equal(px(cont.img, 10, 10)[3], 0);
  assert.equal(px(cont.img, 30, 10)[3], 0, 'blue erased once the hotspot reached it');

  const once = drag({ sampling: 'once' });
  assert.equal(px(once.img, 10, 10)[3], 0);
  assert.deepEqual(px(once.img, 30, 10), BLUE);

  const blueHex =
    '#' +
    BLUE.slice(0, 3)
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('');
  const swatch = drag({ sampling: 'backgroundSwatch' }, { bgColor: blueHex });
  assert.deepEqual(px(swatch.img, 10, 10), GREEN);
  assert.equal(px(swatch.img, 30, 10)[3], 0);
  assert.equal(swatch.state.drawing, false);
});

test('the stroke clips to the active selection and drops a float', () => {
  const sel = { mode: 'active', x: 0, y: 0, w: 12, h: 20, data: {}, baseData: {} };
  const { img } = drag({ sampling: 'once' }, { sel });
  assert.equal(px(img, 11, 10)[3], 0);
  assert.deepEqual(px(img, 13, 10), GREEN);
  assert.equal(sel.data, null);
});

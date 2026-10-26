import test from 'node:test';
import assert from 'node:assert/strict';
import { COMMANDS_BY_ID } from '../paint/commands.js';
import { TOOLS, TOOL_GROUPS, TOOL_OPTION_SCHEMA, toolForKey } from '../paint/tools.js';
import { isPixelSafeTool } from '../paint/layer-groups.js';
import {
  WARP_STYLES,
  normalizeWarp,
  warpField,
  warpGrid,
  warpImageData
} from '../paint/text-warp.js';
import {
  isTypeMaskTool,
  isTypeTool,
  normalizeType,
  renderType,
  typeBounds,
  typeFromJSON,
  typeLayerAt,
  typeSelectionMask,
  typeToJSON,
  warpedTypeBounds,
  withWarp
} from '../paint/type-layers.js';

// Type › Warp Text… (PhotoCraft geom/src/warp.rs StyleWarp, warp_text_dialog.rs) and the
// Horizontal / Vertical Type Mask tools (type.createSelection).

const box = { x: 10, y: 20, w: 100, h: 40 };
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

test('Bend 0 with no distortion is no warp: the field is null and pixels are unchanged', () => {
  for (const [style] of WARP_STYLES) {
    assert.equal(warpField({ style, bend: 0, hDistort: 0, vDistort: 0 }, box), null, style);
  }
  const W = 8;
  const H = 6;
  const src = new Uint8ClampedArray(W * H * 4).map((_, i) => (i * 37) % 256);
  assert.deepEqual(warpImageData(src, W, H, null, { x: 0, y: 0, w: W, h: H }), src);
});

test('every preset grid at bend 0 is the rest grid, so the field maps points to themselves', () => {
  for (const [style] of WARP_STYLES.slice(1)) {
    const g = warpGrid(style, 0, 0, 0, false, 0.4);
    g.forEach((row, j) =>
      row.forEach((p, i) => {
        assert.ok(near(p[0], i / 3) && near(p[1], j / 3), `${style} ${i},${j}`);
      })
    );
  }
  // A distortion alone still warps, so the field exists; with all three tiny, points barely move.
  assert.ok(warpField({ style: 'arc', bend: 0, hDistort: 30 }, box));
  const f = warpField({ style: 'arc', bend: 0.0001 }, box);
  const [x, y] = f(50, 30);
  assert.ok(near(x, 50, 1e-2) && near(y, 30, 1e-2));
});

test('Arc keeps the corners and moves the centre up; a negative bend moves it down', () => {
  const arc = warpField({ style: 'arc', bend: 50 }, box);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const [mx, my] = arc(cx, cy);
  assert.ok(near(mx, cx, 1e-6), 'the centre stays on the axis');
  assert.ok(my < cy - 5, `centre moved up: ${my} < ${cy}`);
  // The bottom edge, inside the bend, keeps its chord: its corners stay put.
  const [bx0, by0] = arc(box.x, box.y + box.h);
  const [bx1, by1] = arc(box.x + box.w, box.y + box.h);
  assert.ok(near(bx0, box.x, 1e-6) && near(by0, box.y + box.h, 1e-6));
  assert.ok(near(bx1, box.x + box.w, 1e-6) && near(by1, box.y + box.h, 1e-6));
  const down = warpField({ style: 'arc', bend: -50 }, box);
  assert.ok(down(cx, cy)[1] > cy + 5);
});

test('Flag moves the quarter points in opposite directions; Rise lifts one side', () => {
  const flag = warpField({ style: 'flag', bend: 50 }, box);
  const q1 = flag(box.x + box.w / 4, box.y + box.h / 2);
  const q3 = flag(box.x + (3 * box.w) / 4, box.y + box.h / 2);
  assert.ok(q1[1] < 40 && q3[1] > 40, `${q1[1]} / ${q3[1]}`);
  const rise = warpField({ style: 'rise', bend: 50 }, box);
  assert.ok(rise(box.x, box.y)[1] > box.y);
  assert.ok(near(rise(box.x + box.w, box.y)[1], box.y, 1e-6));
});

test('Vertical orientation bends along the other axis', () => {
  const v = warpField({ style: 'arc', bend: 50, vertical: true }, box);
  const [x, y] = v(box.x + box.w / 2, box.y + box.h / 2);
  assert.ok(near(y, box.y + box.h / 2, 1e-6));
  assert.ok(Math.abs(x - (box.x + box.w / 2)) > 1);
});

test('warpImageData moves a horizontal bar up in the middle under Arc', () => {
  const W = 40;
  const H = 30;
  const src = new Uint8ClampedArray(W * H * 4);
  // An opaque bar across rows 20..23 of a 0..40 × 10..30 box.
  for (let y = 20; y < 24; y++) {
    for (let x = 0; x < W; x++) src[(y * W + x) * 4 + 3] = 255;
  }
  const b = { x: 0, y: 10, w: 40, h: 20 };
  const out = warpImageData(src, W, H, warpField({ style: 'arc', bend: 60 }, b), b);
  const top = (col) => {
    for (let y = 0; y < H; y++) if (out[(y * W + col) * 4 + 3] > 128) return y;
    return -1;
  };
  assert.ok(top(20) >= 0 && top(20) < 20, `middle column rose to ${top(20)}`);
  assert.ok(top(20) < top(2), 'the middle sits above the ends');
});

test('normalizeWarp drops none and unknown styles and clamps the percentages', () => {
  assert.equal(normalizeWarp(null), null);
  assert.equal(normalizeWarp({ style: 'none', bend: 50 }), null);
  assert.equal(normalizeWarp({ style: 'cylinder' }), null);
  assert.deepEqual(normalizeWarp({ style: 'wave', bend: 250, hDistort: -300, vertical: 1 }), {
    style: 'wave',
    bend: 100,
    hDistort: -100,
    vDistort: 0,
    vertical: false
  });
});

const measure = (font, text) => text.length * 10;

test('the type record stores the warp and saves it; older records load without one', () => {
  const t = withWarp(normalizeType({ text: 'Hi', size: 20 }), { style: 'arc', bend: 40 });
  assert.deepEqual(t.warp, { style: 'arc', bend: 40, hDistort: 0, vDistort: 0, vertical: false });
  assert.deepEqual(typeFromJSON(JSON.parse(JSON.stringify(typeToJSON(t)))).warp, t.warp);
  assert.equal(typeFromJSON({ text: 'old', size: 12 }).warp, null);
  assert.equal(withWarp(t, { style: 'none' }).warp, null);
});

test('a warped type layer is hit by a click on its bent text', () => {
  const t = normalizeType({ text: 'HELLO', size: 20, x: 0, y: 40, warp: { style: 'arc', bend: 100 } });
  const plain = typeBounds(t, measure);
  const bent = warpedTypeBounds(t, measure);
  assert.ok(bent.y < plain.y - 5, 'the arc rises above the unwarped box');
  const layers = [{ kind: 'type', type: t, visible: true }];
  assert.equal(typeLayerAt(layers, plain.x + plain.w / 2, bent.y + 1, measure), 0);
});

// A context whose fillText fills a W × H canvas row band at the baseline with opaque black.
function bandCtx(W, H) {
  const data = new Uint8ClampedArray(W * H * 4);
  return {
    data,
    ctx: {
      canvas: { width: W, height: H },
      save() {},
      restore() {},
      measureText: (s) => ({ width: s.length * 10 }),
      fillText(text, x, y) {
        for (let yy = Math.max(0, y - 8); yy < Math.min(H, y); yy++) {
          for (let xx = Math.max(0, Math.round(x)); xx < Math.min(W, x + text.length * 10); xx++) {
            data[(yy * W + xx) * 4 + 3] = 255;
          }
        }
      },
      getImageData: (x, y, w, h) => ({ width: w, height: h, data: data.slice() }),
      putImageData(img) {
        data.set(img.data);
      }
    }
  };
}

test('renderType draws warped text through the warp field', () => {
  const W = 60;
  const H = 40;
  const plain = bandCtx(W, H);
  const t = normalizeType({ text: 'HELLO', size: 10, x: 5, y: 30 });
  renderType(plain.ctx, t);
  const warped = bandCtx(W, H);
  renderType(warped.ctx, withWarp(t, { style: 'arc', bend: 80 }));
  const topAt = (data, col) => {
    for (let y = 0; y < H; y++) if (data[(y * W + col) * 4 + 3] > 128) return y;
    return H;
  };
  assert.ok(topAt(warped.data, 30) < topAt(plain.data, 30), 'the middle of the word rose');
});

test('typeSelectionMask turns half-covered glyph pixels into a 0/1 selection', () => {
  const rgba = new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 127, 0, 0, 0, 128, 9, 9, 9, 0]);
  assert.deepEqual([...typeSelectionMask(rgba, 2, 2)], [1, 0, 1, 0]);
});

test('Horizontal and Vertical Type Mask tools sit in the Type group and start a mask edit', () => {
  const group = TOOL_GROUPS.find((g) => g.includes('text'));
  assert.deepEqual(group, ['text', 'verticalType', 'verticalTypeMask', 'horizontalTypeMask']);
  assert.equal(TOOLS.horizontalTypeMask.label, 'Horizontal Type Mask');
  assert.equal(TOOLS.verticalTypeMask.label, 'Vertical Type Mask');
  assert.equal(toolForKey('t', true, 'verticalType'), 'verticalTypeMask');
  assert.equal(TOOL_OPTION_SCHEMA.horizontalTypeMask, TOOL_OPTION_SCHEMA.text);
  for (const id of ['horizontalTypeMask', 'verticalTypeMask']) {
    assert.ok(isTypeTool(id) && isTypeMaskTool(id) && isPixelSafeTool(id), id);
  }
  assert.ok(!isTypeMaskTool('text'));
  const calls = [];
  const state = { beginType: (...a) => calls.push(a), selectionMode: 'new' };
  TOOLS.horizontalTypeMask.onDown(null, null, state, 4, 5);
  TOOLS.verticalTypeMask.onDown(null, null, { ...state, shiftKey: true }, 6, 7);
  TOOLS.horizontalTypeMask.onDown(null, null, { ...state, altKey: true }, 1, 1);
  assert.deepEqual(calls, [
    [4, 5, 'horizontal', 'new'],
    [6, 7, 'vertical', 'add'],
    [1, 1, 'horizontal', 'subtract']
  ]);
});

test('Type › Warp Text… is a command on the active type layer', () => {
  const cmd = COMMANDS_BY_ID.get('type.warpText');
  assert.ok(cmd);
  assert.equal(cmd.label, 'Warp Text…');
  assert.deepEqual(cmd.menu, ['Type']);
  const typeState = { layers: [{ kind: 'type', type: normalizeType({ text: 'a' }) }], activeLayerIdx: 0 };
  assert.equal(cmd.enabled(typeState), true);
  assert.equal(cmd.enabled({ layers: [{ kind: 'pixel' }], activeLayerIdx: 0 }), false);
  let opened = 0;
  cmd.run({ openWarpText: () => opened++ });
  assert.equal(opened, 1);
});

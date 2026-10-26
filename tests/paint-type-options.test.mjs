import test from 'node:test';
import assert from 'node:assert/strict';
import { COMMANDS_BY_ID } from '../paint/commands.js';
import { TOOLS, TOOL_GROUPS, TOOL_OPTION_SCHEMA, toolForKey } from '../paint/tools.js';
import { TOOL_KEYS } from '../paint/tool-groups.js';
import {
  LOREM_IPSUM,
  TYPE_ANTIALIAS,
  antialiasCoverage,
  applyTypeAntialias,
  insertLorem,
  loremTypeRecord,
  normalizeType,
  renderType,
  typeBounds,
  typeFromJSON,
  typeToJSON,
  verticalGlyphs,
  withAntialias,
  withOrientation,
  wrapTypeText
} from '../paint/type-layers.js';

// Type › Anti-Alias (PhotoCraft render.rs shape_antialias_coverage), Type › Orientation, the
// Vertical Type tool, and Type › Paste Lorem Ipsum (type_extra_cmds.rs paste_lorem).

const measure = (font, text) => text.length * 10;

// A drawing context whose fillText lays a soft-edged glyph: an 8 × 8 block whose alpha ramps
// 0..255 across x, so every coverage value is present for the anti-alias remap.
function rampCtx(W, H) {
  const data = new Uint8ClampedArray(W * H * 4);
  const drawn = [];
  const ctx = {
    canvas: { width: W, height: H },
    save() {},
    restore() {},
    fillText(text, x, y) {
      drawn.push({ text, x, y, align: ctx.textAlign });
      for (let yy = 0; yy < H; yy++) {
        for (let xx = 0; xx < W; xx++) {
          const p = (yy * W + xx) * 4;
          data[p] = data[p + 1] = data[p + 2] = 0;
          data[p + 3] = Math.max(data[p + 3], Math.round((xx / (W - 1)) * 255));
        }
      }
    },
    getImageData: (x, y, w, h) => ({ width: w, height: h, data: data.slice() }),
    putImageData(img) {
      data.set(img.data);
    }
  };
  return { ctx, data, drawn };
}

const alphas = (data) => {
  const out = new Set();
  for (let i = 3; i < data.length; i += 4) out.add(data[i]);
  return out;
};

test('Anti-Alias None leaves only 0 and 255 alpha, thresholded at 50%', () => {
  const { ctx, data } = rampCtx(64, 2);
  renderType(ctx, normalizeType({ text: 'A', antialias: 'none' }));
  assert.deepEqual([...alphas(data)].sort((a, b) => a - b), [0, 255]);
  assert.equal(antialiasCoverage(0.49, 'none'), 0);
  assert.equal(antialiasCoverage(0.5, 'none'), 1);
});

test('Smooth keeps the coverage; Sharp / Crisp thin the fringe and Strong widens it', () => {
  const img = (mode) => {
    const { ctx, data } = rampCtx(64, 1);
    renderType(ctx, normalizeType({ text: 'A', antialias: mode }));
    return data;
  };
  const smooth = img('smooth');
  const sum = (d) => {
    let s = 0;
    for (let i = 3; i < d.length; i += 4) s += d[i];
    return s;
  };
  // Smooth draws the glyph's own fringe.
  assert.equal(smooth[3 + 4 * 32], Math.round((32 / 63) * 255));
  assert.ok(alphas(smooth).size > 2);
  // PhotoCraft's exponents: Sharp 2.2 < Crisp 1.35 < Smooth 1 < Strong 0.55 in fringe weight.
  const [sharp, crisp, strong] = ['sharp', 'crisp', 'strong'].map((m) => sum(img(m)));
  assert.ok(sharp < crisp && crisp < sum(smooth) && sum(smooth) < strong);
  assert.ok(Math.abs(antialiasCoverage(0.5, 'sharp') - Math.pow(0.5, 2.2)) < 1e-12);
  assert.ok(Math.abs(antialiasCoverage(0.5, 'crisp') - Math.pow(0.5, 1.35)) < 1e-12);
  assert.ok(Math.abs(antialiasCoverage(0.5, 'strong') - Math.pow(0.5, 0.55)) < 1e-12);
  // Full and empty coverage stay put in every mode.
  for (const m of TYPE_ANTIALIAS) {
    assert.equal(antialiasCoverage(0, m), 0);
    assert.equal(antialiasCoverage(1, m), 1);
  }
  // Colour bytes are untouched; only alpha moves.
  const px = { data: new Uint8ClampedArray([10, 20, 30, 100]) };
  applyTypeAntialias(px, 'none');
  assert.deepEqual([...px.data], [10, 20, 30, 0]);
});

test('Vertical glyphs stack top to bottom; later lines are columns to the left', () => {
  const t = normalizeType({ text: 'ABC\nDE', size: 20, x: 100, y: 10, orientation: 'vertical' });
  const g = verticalGlyphs(t);
  assert.deepEqual(
    g.map((p) => p.text),
    ['A', 'B', 'C', 'D', 'E']
  );
  // One em per glyph down the column, the baseline an ascent below the glyph's top.
  assert.deepEqual(
    g.slice(0, 3).map((p) => p.y),
    [26, 46, 66]
  );
  assert.ok(g.slice(0, 3).every((p) => p.x === 100));
  assert.ok(g[3].x < 100 && g[3].x === 100 - 20 * 1.2);
  assert.equal(g[3].y, 26);

  // renderType draws each glyph centred on its column at those positions.
  const { ctx, drawn } = rampCtx(4, 4);
  renderType(ctx, t);
  assert.deepEqual(
    drawn.map((d) => [d.text, d.x, d.y, d.align]),
    g.map((p) => [p.text, p.x, p.y, 'center'])
  );
  for (let i = 1; i < 3; i++) assert.ok(drawn[i].y > drawn[i - 1].y);

  // Bounds cover both columns and the tallest one.
  const b = typeBounds(t, measure);
  assert.equal(b.y, 10);
  assert.equal(b.h, 60);
  assert.equal(b.x + b.w, 110);
  assert.equal(b.x, 100 - 24 - 10);
});

test('Orientation and Anti-Alias rewrite the record and survive .paintproj', () => {
  const t = normalizeType({ text: 'Hi', x: 5, y: 9 });
  assert.equal(t.orientation, 'horizontal');
  assert.equal(t.antialias, 'smooth');
  const v = withOrientation(t, 'vertical');
  assert.equal(v.orientation, 'vertical');
  assert.deepEqual([v.x, v.y, v.text], [5, 9, 'Hi']);
  assert.equal(withOrientation(v, 'horizontal').orientation, 'horizontal');
  const n = withAntialias(v, 'none');
  assert.equal(n.antialias, 'none');
  assert.equal(withAntialias(n, 'bogus').antialias, 'smooth');
  assert.deepEqual(typeFromJSON(typeToJSON(n)), n);
  // Records saved before these fields load as horizontal Smooth type.
  const old = typeFromJSON({ text: 'old', size: 12 });
  assert.equal(old.orientation, 'horizontal');
  assert.equal(old.antialias, 'smooth');
});

test('Type › Anti-Alias and Orientation run on the active type layer and show a check', () => {
  const typeLayer = { kind: 'type', type: normalizeType({ text: 'x', antialias: 'crisp' }) };
  const state = { layers: [{ kind: 'pixel' }, typeLayer], activeLayerIdx: 1 };
  const calls = [];
  const ctx = {
    setTypeAntialias: (m) => calls.push(['aa', m]),
    setTypeOrientation: (o) => calls.push(['or', o]),
    pasteLoremIpsum: () => calls.push(['lorem'])
  };
  for (const mode of TYPE_ANTIALIAS) {
    const cmd = COMMANDS_BY_ID.get(`type.antiAlias.${mode}`);
    assert.deepEqual(cmd.menu, ['Type', 'Anti-Alias']);
    assert.equal(cmd.radio, true);
    assert.equal(cmd.enabled(state), true);
    assert.equal(cmd.checked(state), mode === 'crisp');
    cmd.run(ctx);
  }
  for (const o of ['horizontal', 'vertical']) {
    const cmd = COMMANDS_BY_ID.get(`type.orientation.${o}`);
    assert.deepEqual(cmd.menu, ['Type', 'Orientation']);
    assert.equal(cmd.checked(state), o === 'horizontal');
    cmd.run(ctx);
  }
  const lorem = COMMANDS_BY_ID.get('type.pasteLoremIpsum');
  assert.equal(lorem.label, 'Paste Lorem Ipsum');
  assert.deepEqual(lorem.menu, ['Type']);
  lorem.run(ctx);
  assert.deepEqual(calls, [
    ...TYPE_ANTIALIAS.map((m) => ['aa', m]),
    ['or', 'horizontal'],
    ['or', 'vertical'],
    ['lorem']
  ]);
  // Without a type layer the anti-alias and orientation items are greyed out.
  const pixel = { layers: [{ kind: 'pixel' }], activeLayerIdx: 0 };
  assert.equal(COMMANDS_BY_ID.get('type.antiAlias.none').enabled(pixel), false);
  assert.equal(COMMANDS_BY_ID.get('type.orientation.vertical').enabled(pixel), false);
});

test('Paste Lorem Ipsum inserts the filler or makes a wrapped type record', () => {
  assert.ok(LOREM_IPSUM.startsWith('Lorem ipsum dolor sit amet'));
  assert.equal(insertLorem('ab', 1), 'a' + LOREM_IPSUM + 'b');
  assert.equal(insertLorem('ab'), 'ab' + LOREM_IPSUM);

  const t = loremTypeRecord(400, 200, { family: 'serif', color: '#ff0000' }, measure);
  assert.equal(t.size, 10);
  assert.equal(t.x, 40);
  assert.equal(t.y, 20 + 8);
  assert.equal(t.family, 'serif');
  assert.equal(t.color, '#ff0000');
  assert.equal(t.text.replace(/\n/g, ' '), LOREM_IPSUM);
  const lines = t.text.split('\n');
  assert.ok(lines.length > 1);
  assert.ok(lines.every((l) => measure('', l) <= 320));
  // Size is clamped to 6..72.
  assert.equal(loremTypeRecord(100, 40, {}, measure).size, 6);
  assert.equal(loremTypeRecord(4000, 4000, {}, measure).size, 72);
  assert.equal(wrapTypeText('aa bb cc', '', 50, measure), 'aa bb\ncc');
});

test('The Vertical Type tool shares the Type slot, key T, and the type options bar', () => {
  assert.ok(TOOL_GROUPS.some((g) => g[0] === 'text' && g.includes('verticalType')));
  assert.equal(TOOL_KEYS.verticalType, 'T');
  assert.equal(TOOLS.verticalType.label, 'Vertical Type');
  assert.equal(TOOLS.verticalType.icon, 'type');
  assert.equal(TOOL_OPTION_SCHEMA.verticalType, TOOL_OPTION_SCHEMA.text);
  // A click starts vertical type; the Horizontal Type tool starts horizontal type.
  const calls = [];
  const state = { beginType: (x, y, o) => calls.push([x, y, o]) };
  TOOLS.verticalType.onDown(null, null, state, 3, 4);
  TOOLS.text.onDown(null, null, state, 5, 6);
  assert.deepEqual(calls, [
    [3, 4, 'vertical'],
    [5, 6, 'horizontal']
  ]);
  // Shift+T cycles the Type slot: Horizontal → Vertical → Vertical Mask → Horizontal Mask → …
  assert.equal(toolForKey('T', true, 'text'), 'verticalType');
  assert.equal(toolForKey('T', true, 'verticalType'), 'verticalTypeMask');
  assert.equal(toolForKey('T', true, 'verticalTypeMask'), 'horizontalTypeMask');
  assert.equal(toolForKey('T', true, 'horizontalTypeMask'), 'text');
});

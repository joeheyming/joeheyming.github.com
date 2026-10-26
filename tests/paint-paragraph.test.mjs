import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import { COMMANDS_BY_ID } from '../paint/commands.js';
import { TOOLS } from '../paint/tools.js';
import { initDock } from '../paint/dock.js';
import { DOCK_PANELS, panelShown, toggleDockPanel } from '../paint/window-panels.js';
import { initTypePanels, typeStyleOf, typeStylePatch } from '../paint/type-panels.js';
import {
  justifyGap,
  normalizeType,
  paragraphBoxFromDrag,
  paragraphLayout,
  renderType,
  toParagraphText,
  toPointText,
  typeBounds,
  typeFromJSON,
  typeLayout,
  withTypeField,
  wrapLines
} from '../paint/type-layers.js';

// Paragraph type (PhotoCraft type_tool.rs: a drag makes a text box whose lines wrap), Type ›
// Convert to Paragraph Text / Point Text, and the Character and Paragraph panels.

// Every glyph is 10 px wide.
const m1 = (text) => text.length * 10;
const measure = (font, text) => text.length * 10;

// A context that records each fillText / strokeText and the transforms in effect.
function recorder() {
  const ctx = {
    drawn: [],
    stroked: [],
    skews: 0,
    font: '',
    canvas: { width: 0, height: 0 },
    save() {},
    restore() {},
    translate() {},
    transform(a, b, c) {
      if (c) ctx.skews++;
    },
    beginPath() {},
    rect(x, y, w, h) {
      ctx.clipRect = { x, y, w, h };
    },
    clip() {},
    measureText: (s) => ({ width: s.length * 10 }),
    fillText(text, x, y) {
      ctx.drawn.push({ text, x, y });
    },
    strokeText(text, x, y) {
      ctx.stroked.push({ text, x, y, width: ctx.lineWidth });
    }
  };
  return ctx;
}

test('wrapLines fills each line with whole words up to the width', () => {
  assert.deepEqual(wrapLines('the quick brown fox jumps', 100, m1), [
    'the quick',
    'brown fox',
    'jumps'
  ]);
  // A line that measures exactly the width still fits.
  assert.deepEqual(wrapLines('aaaa bbbbb', 100, m1), ['aaaa bbbbb']);
});

test('wrapLines keeps hard breaks and splits a word wider than the line', () => {
  assert.deepEqual(wrapLines('one two\n\nthree', 50, m1), ['one', 'two', '', 'three']);
  assert.deepEqual(wrapLines('abcdefghij xy', 40, m1), ['abcd', 'efgh', 'ij', 'xy']);
  assert.deepEqual(wrapLines('', 40, m1), ['']);
});

test('justifyGap spreads the slack over the spaces', () => {
  assert.equal(justifyGap('a b c', 90, m1), 20);
  assert.equal(justifyGap('a b', 60, m1), 30);
  assert.equal(justifyGap('abc', 90, m1), 0, 'no space to widen');
  assert.equal(justifyGap('a b c', 40, m1), 0, 'never negative');
});

test('paragraph text wraps to its box and aligns inside it', () => {
  const base = { text: 'aa bb cc dd', size: 10, x: 5, y: 20, box: { w: 60, h: 100 } };
  const left = paragraphLayout(normalizeType(base), measure);
  assert.deepEqual(
    left.map((l) => [l.text, l.x, l.y]),
    [
      ['aa bb', 5, 28],
      ['cc dd', 5, 40]
    ]
  );
  const right = paragraphLayout(normalizeType({ ...base, align: 'right' }), measure);
  assert.deepEqual(
    right.map((l) => l.x),
    [15, 15]
  );
  const center = paragraphLayout(normalizeType({ ...base, align: 'center' }), measure);
  assert.deepEqual(
    center.map((l) => l.x),
    [10, 10]
  );
});

test('justify stretches every line but a paragraph’s last to the box width', () => {
  const t = normalizeType({
    text: 'a b c d e f\ng h',
    size: 10,
    x: 0,
    y: 0,
    box: { w: 90, h: 100 },
    align: 'justify'
  });
  const lines = paragraphLayout(t, measure);
  assert.deepEqual(
    lines.map((l) => [l.text, l.gap]),
    [
      ['a b c d e', 0],
      ['f', 0],
      ['g h', 0]
    ]
  );
  const wide = paragraphLayout({ ...t, text: 'a b c d e f g' }, measure);
  assert.equal(wide[0].text, 'a b c d e');
  assert.equal(wide[0].gap, 0, 'a b c d e is 90 px already');
  const slack = paragraphLayout(normalizeType({ ...t, text: 'aa b cc dd' }), measure);
  assert.deepEqual(
    slack.map((l) => [l.text, l.gap, l.width]),
    [
      ['aa b cc', 10, 90],
      ['dd', 0, 20]
    ]
  );
  // Drawn glyph by glyph: each space gets the gap, so the line ends on the box's right edge.
  const ctx = recorder();
  renderType(ctx, normalizeType({ ...t, text: 'aa b cc dd' }));
  assert.deepEqual(
    ctx.drawn.slice(0, 5).map((d) => [d.text, d.x]),
    [
      ['a', 0],
      ['a', 10],
      ['b', 40],
      ['c', 70],
      ['c', 80]
    ]
  );
  const last = ctx.drawn.at(-1);
  assert.deepEqual([last.text, last.x], ['dd', 0], 'the last line stays left');
  assert.deepEqual(ctx.clipRect, { x: 0, y: 0, w: 90, h: 100 });
});

test('indents and paragraph spacing move the lines; overflow past the box is hidden', () => {
  const t = normalizeType({
    text: 'aa bb\ncc',
    size: 10,
    x: 0,
    y: 0,
    box: { w: 60, h: 100 },
    indentLeft: 5,
    indentFirst: 10,
    spaceBefore: 4,
    spaceAfter: 3
  });
  const lines = paragraphLayout(t, measure);
  // First line: 60 − 5 − 10 = 45 px leaves room for 'aa' only.
  assert.deepEqual(
    lines.map((l) => [l.text, l.x, l.y]),
    [
      ['aa', 15, 8],
      ['bb', 5, 20],
      ['cc', 15, 39]
    ]
  );
  const short = paragraphLayout({ ...t, box: { w: 60, h: 22 } }, measure);
  assert.deepEqual(
    short.map((l) => l.text),
    ['aa', 'bb']
  );
});

test('leading and tracking set the line spacing and the glyph advance', () => {
  const t = normalizeType({ text: 'ab\ncd', size: 10, x: 0, y: 10, leading: 30, tracking: 500 });
  const lines = typeLayout(t, measure);
  assert.deepEqual(
    lines.map((l) => [l.y, l.width]),
    [
      [10, 30],
      [40, 30]
    ]
  );
  const ctx = recorder();
  renderType(ctx, t);
  assert.deepEqual(
    ctx.drawn.map((d) => [d.text, d.x, d.y]),
    [
      ['a', 0, 10],
      ['b', 15, 10],
      ['c', 0, 40],
      ['d', 15, 40]
    ]
  );
});

test('Faux Bold outlines the glyphs and Faux Italic slants them', () => {
  const ctx = recorder();
  renderType(ctx, normalizeType({ text: 'hi', size: 50, fauxBold: true, fauxItalic: true }));
  assert.equal(ctx.stroked.length, 1);
  assert.equal(ctx.stroked[0].width, 2);
  assert.equal(ctx.skews, 1);
  const plain = recorder();
  renderType(plain, normalizeType({ text: 'hi', size: 50 }));
  assert.equal(plain.stroked.length, 0);
  assert.equal(plain.skews, 0);
});

test('Convert to Paragraph Text boxes the text where it was; Point Text bakes the wraps', () => {
  const point = normalizeType({ text: 'aa bb cc', size: 10, x: 4, y: 30 });
  const para = toParagraphText(point, measure);
  assert.deepEqual(para.box, { w: 80, h: 10 });
  assert.equal(para.x, 4);
  assert.equal(para.y, 22);
  assert.deepEqual(typeBounds(para, measure), { x: 4, y: 22, w: 80, h: 10 });
  assert.deepEqual(
    typeLayout(para, measure).map((l) => [l.text, l.x, l.y]),
    typeLayout(point, measure).map((l) => [l.text, l.x, l.y])
  );

  const narrow = normalizeType({ ...para, box: { w: 50, h: 10 }, align: 'center' });
  const back = toPointText(narrow, measure);
  assert.equal(back.box, null);
  assert.equal(back.text, 'aa bb\ncc', 'overflowing lines are kept');
  assert.equal(back.align, 'center');
  assert.equal(back.x, 29);
  assert.equal(back.y, 30);
  assert.deepEqual(
    typeLayout(back, measure)
      .slice(0, 1)
      .map((l) => [l.x, l.y]),
    paragraphLayout(narrow, measure).map((l) => [l.x, l.y])
  );
  const justified = toPointText(normalizeType({ ...narrow, align: 'justify' }), measure);
  assert.equal(justified.align, 'left');
  assert.equal(justified.x, 4);
});

test('a drag makes a paragraph box; a click stays point text', () => {
  assert.deepEqual(paragraphBoxFromDrag(50, 40, 10, 100), { x: 10, y: 40, w: 40, h: 60 });
  assert.equal(paragraphBoxFromDrag(10, 10, 12, 30), null);
  const calls = [];
  const state = {
    zoom: 1,
    beginType: (x, y, o) => calls.push(['type', x, y, o]),
    beginParagraph: (box) => calls.push(['box', box])
  };
  const ov = {
    canvas: { width: 10, height: 10 },
    clearRect() {},
    save() {},
    restore() {},
    setLineDash() {},
    strokeRect: (...r) => calls.push(['rect', ...r])
  };
  TOOLS.text.onDown(null, ov, state, 5, 6);
  assert.equal(state.drawing, true);
  TOOLS.text.onMove(null, ov, state, 45, 36);
  TOOLS.text.onUp(null, ov, state, 45, 36);
  assert.equal(state.drawing, false);
  assert.deepEqual(calls, [
    ['type', 5, 6, 'horizontal'],
    ['rect', 5, 6, 40, 30],
    ['box', { x: 5, y: 6, w: 40, h: 30 }]
  ]);
  calls.length = 0;
  TOOLS.text.onDown(null, ov, state, 5, 6);
  TOOLS.text.onUp(null, ov, state, 6, 6);
  assert.deepEqual(calls, [['type', 5, 6, 'horizontal']]);
});

test('paragraph and character fields survive .paintproj and older records load as point text', () => {
  const t = normalizeType({
    text: 'x',
    box: { w: 30, h: 40 },
    leading: 18,
    tracking: -20,
    fauxBold: true,
    indentFirst: 6,
    spaceAfter: 2,
    align: 'justify'
  });
  assert.deepEqual(typeFromJSON(JSON.parse(JSON.stringify(t))), t);
  const old = typeFromJSON({ text: 'old', size: 12 });
  assert.equal(old.box, null);
  assert.equal(old.leading, 0);
  assert.equal(old.tracking, 0);
  assert.equal(old.fauxItalic, false);
  // Vertical text has no paragraph box.
  assert.equal(normalizeType({ ...t, orientation: 'vertical' }).box, null);
});

test('Type › Convert commands follow the active layer’s text kind', () => {
  const toPara = COMMANDS_BY_ID.get('type.convertToParagraphText');
  const toPoint = COMMANDS_BY_ID.get('type.convertToPointText');
  assert.deepEqual(toPara.menu, ['Type']);
  const layer = (type) => ({
    layers: [{ kind: 'type', type: normalizeType(type) }],
    activeLayerIdx: 0
  });
  const point = layer({ text: 'a' });
  const para = layer({ text: 'a', box: { w: 10, h: 10 } });
  assert.equal(toPara.enabled(point), true);
  assert.equal(toPoint.enabled(point), false);
  assert.equal(toPara.enabled(para), false);
  assert.equal(toPoint.enabled(para), true);
  assert.equal(toPara.enabled(layer({ text: 'a', orientation: 'vertical' })), false);
  assert.equal(toPara.enabled({ layers: [{}], activeLayerIdx: 0 }), false);
  const ran = [];
  const ctx = {
    convertTypeToParagraph: () => ran.push('para'),
    convertTypeToPoint: () => ran.push('point')
  };
  toPara.run(ctx);
  toPoint.run(ctx);
  assert.deepEqual(ran, ['para', 'point']);
});

const html = readFileSync(new URL('../paint/index.html', import.meta.url), 'utf8');

function dock() {
  const { window } = new JSDOM(html);
  const doc = window.document;
  globalThis.document = doc;
  initDock(doc.getElementById('dock'));
  return doc;
}

test('Type › Panels and Window open the Character and Paragraph tabs', () => {
  const doc = dock();
  assert.ok(DOCK_PANELS.includes('character') && DOCK_PANELS.includes('paragraph'));
  assert.equal(panelShown('character', doc), false, 'closed by default');
  const toggled = [];
  for (const id of ['type.panels.character', 'type.panels.paragraph']) {
    const cmd = COMMANDS_BY_ID.get(id);
    assert.deepEqual(cmd.menu, ['Type', 'Panels']);
    cmd.run({ togglePanel: (name) => toggled.push(name) });
  }
  assert.deepEqual(toggled, ['character', 'paragraph']);
  for (const name of ['character', 'paragraph']) {
    assert.deepEqual(COMMANDS_BY_ID.get(`window.panel.${name}`).menu, ['Window']);
  }

  assert.equal(toggleDockPanel('character', doc), true);
  assert.equal(panelShown('character', doc), true);
  assert.equal(panelShown('paragraph', doc), false, 'Paragraph sits behind Character');
  toggleDockPanel('paragraph', doc);
  assert.equal(panelShown('paragraph', doc), true);
  assert.equal(panelShown('character', doc), false);
  assert.equal(COMMANDS_BY_ID.get('type.panels.paragraph').checked(), panelShown('paragraph'));
});

test('the panels show the record and send each edit as type-record keys', () => {
  const doc = dock();
  let record = normalizeType({ text: 'x', size: 24, leading: 30, bold: true, align: 'right' });
  const patches = [];
  const panels = initTypePanels({
    doc,
    families: [
      { value: 'sans-serif', label: 'Sans' },
      { value: 'serif', label: 'Serif' }
    ],
    read: () => record,
    onChange(patch) {
      patches.push(patch);
      record = Object.entries(patch).reduce((t, [k, v]) => withTypeField(t, k, v), record);
      panels.render();
    }
  });
  const field = (key) => doc.querySelector(`[data-type-key="${key}"]`);
  assert.equal(field('size').value, '24');
  assert.equal(field('leading').value, '30');
  assert.equal(field('style').value, 'bold');
  const pressed = () => doc.querySelector('.type-panel-align[aria-pressed="true"]').dataset.align;
  assert.equal(pressed(), 'right');

  const change = (key, value) => {
    const el = field(key);
    if (el.type === 'checkbox') el.checked = value;
    else el.value = value;
    el.dispatchEvent(new doc.defaultView.Event('change'));
  };
  change('tracking', '75');
  change('style', 'italic');
  change('fauxItalic', true);
  change('family', 'serif');
  change('spaceBefore', '8');
  doc.querySelector('.type-panel-align[data-align="justify"]').click();
  assert.deepEqual(patches, [
    { tracking: 75 },
    { bold: false, italic: true },
    { fauxItalic: true },
    { family: 'serif' },
    { spaceBefore: 8 },
    { align: 'justify' }
  ]);
  assert.equal(record.tracking, 75);
  assert.equal(record.fauxItalic, true);
  assert.equal(pressed(), 'justify');
  assert.equal(field('style').value, 'italic');
  assert.deepEqual(typeStylePatch('boldItalic'), { bold: true, italic: true });
  assert.equal(typeStyleOf({ bold: false, italic: false }), 'regular');
});

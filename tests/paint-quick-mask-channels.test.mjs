// US-199: Select › Edit in Quick Mask Mode, Save / Load Selection…, and the Channels panel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import {
  quickMaskFromSelection,
  quickMaskOverlay,
  quickMaskToSelection
} from '../paint/quick-mask.js';
import {
  channelRows,
  channelSelection,
  deleteChannel,
  deserializeChannels,
  fittingChannels,
  loadSelectionMode,
  nextAlphaName,
  renderChannelsPanel,
  saveSelectionToChannel,
  serializeChannels
} from '../paint/channels.js';
import { applySelectionWithMask } from '../paint/selection.js';
import { maskFromRgba, maskToRgba } from '../paint/layer-mask.js';
import { COMMANDS, COMMANDS_BY_ID, commandForKey } from '../paint/commands.js';
import { buildMenuBar } from '../paint/menu-bar.js';
import { docTabText } from '../paint/doc-tab.js';

const html = readFileSync(new URL('../paint/index.html', import.meta.url), 'utf8');
const W = 4;
const H = 2;

// Selected: the left half (x < 2).
const leftHalf = () => Uint8Array.from({ length: W * H }, (_, p) => (p % W < 2 ? 1 : 0));

test('entering Quick Mask turns the selection into a white-selected plane', () => {
  const { levels, unselected } = quickMaskFromSelection(leftHalf(), W, H);
  assert.deepEqual([...levels], [255, 255, 0, 0, 255, 255, 0, 0]);
  assert.equal(unselected, false);
});

test('the overlay is 50% red over masked areas and clear over the selection', () => {
  const { levels } = quickMaskFromSelection(leftHalf(), W, H);
  const px = quickMaskOverlay(levels);
  assert.deepEqual([...px.slice(0, 4)], [255, 0, 0, 0], 'selected: no overlay');
  assert.deepEqual([...px.slice(8, 12)], [255, 0, 0, 128], 'masked: 50% red');
  // Half gray is half the overlay.
  assert.equal(quickMaskOverlay(Uint8Array.of(128))[3], 64);
});

test('no selection is a colorless all-white mask that turns back into no selection', () => {
  const q = quickMaskFromSelection(null, W, H);
  assert.equal(q.unselected, true);
  assert.ok(q.levels.every((v) => v === 255));
  assert.ok([...quickMaskOverlay(q.levels)].every((v, i) => i % 4 !== 3 || v === 0));
  assert.equal(quickMaskToSelection(q.levels, q.unselected), null);
  // Painting black on it selects what is left white.
  q.levels[0] = 0;
  const sel = quickMaskToSelection(q.levels, q.unselected);
  assert.deepEqual([...sel], [0, 1, 1, 1, 1, 1, 1, 1]);
});

test('painting black masks and white selects; leaving makes the selection', () => {
  const { levels } = quickMaskFromSelection(leftHalf(), W, H);
  // The tools paint the gray edit surface; its luma is read back as the levels.
  const rgba = maskToRgba(levels);
  const paint = (p, v) => rgba.set([v, v, v, 255], p * 4);
  paint(0, 0); // black over a selected pixel masks it
  paint(3, 255); // white over a masked pixel selects it
  paint(7, 200); // light gray is still selected (half and up)
  const edited = maskFromRgba(rgba);
  assert.deepEqual([...edited], [0, 255, 0, 255, 255, 255, 0, 200]);
  assert.deepEqual([...quickMaskToSelection(edited)], [0, 1, 0, 1, 1, 1, 0, 1]);
  // Painted all black: nothing is selected.
  assert.equal(quickMaskToSelection(new Uint8Array(W * H)), null);
  // All white entered with a selection is Select All.
  assert.ok(quickMaskToSelection(new Uint8Array(W * H).fill(255), false).every((v) => v === 1));
});

test('Save Selection stores new alpha channels named Alpha 1, Alpha 2', () => {
  let r = saveSelectionToChannel([], leftHalf(), W * H, { channel: 'new' });
  assert.equal(r.index, 0);
  assert.equal(r.channels[0].name, 'Alpha 1');
  assert.deepEqual([...r.channels[0].data], [255, 255, 0, 0, 255, 255, 0, 0]);
  const first = r.channels;
  r = saveSelectionToChannel(first, leftHalf(), W * H, { name: '  Sky  ' });
  assert.deepEqual(
    r.channels.map((c) => c.name),
    ['Alpha 1', 'Sky']
  );
  assert.equal(first.length, 1, 'the old list is not mutated');
  assert.equal(nextAlphaName(r.channels), 'Alpha 2');
});

test('Save Selection into an existing channel replaces, adds, subtracts, or intersects', () => {
  const { channels } = saveSelectionToChannel([], leftHalf(), W * H);
  // Selected: the top row.
  const top = Uint8Array.from({ length: W * H }, (_, p) => (p < W ? 1 : 0));
  const op = (operation) =>
    [...saveSelectionToChannel(channels, top, W * H, { channel: 0, operation }).channels[0].data];
  assert.deepEqual(op('new'), [255, 255, 255, 255, 0, 0, 0, 0]);
  assert.deepEqual(op('add'), [255, 255, 255, 255, 255, 255, 0, 0]);
  assert.deepEqual(op('subtract'), [0, 0, 0, 0, 255, 255, 0, 0]);
  assert.deepEqual(op('intersect'), [255, 255, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual([...channels[0].data], [255, 255, 0, 0, 255, 255, 0, 0], 'source untouched');
  const renamed = saveSelectionToChannel(channels, top, W * H, { channel: 0, name: 'Top' });
  assert.equal(renamed.channels[0].name, 'Top');
  assert.equal(renamed.index, 0);
});

test('Load Selection makes a new selection or combines with the current one', () => {
  const { channels } = saveSelectionToChannel([], leftHalf(), W * H);
  const mask = channelSelection(channels[0]);
  const top = Uint8Array.from({ length: W * H }, (_, p) => (p < W ? 1 : 0));
  const load = (operation) => {
    const state = { sel: { mode: 'none' } };
    applySelectionWithMask(state, top, W, H, null);
    applySelectionWithMask(state, mask, W, H, loadSelectionMode(operation));
    return state.sel.mode === 'active' ? [...state.sel.mask] : null;
  };
  assert.deepEqual(load('new'), [1, 1, 0, 0, 1, 1, 0, 0]);
  assert.deepEqual(load('add'), [1, 1, 1, 1, 1, 1, 0, 0]);
  assert.deepEqual(load('subtract'), [0, 0, 1, 1, 0, 0, 0, 0]);
  assert.deepEqual(load('intersect'), [1, 1, 0, 0, 0, 0, 0, 0]);
  // A gray channel loads where it is at least half.
  assert.deepEqual([...channelSelection({ data: Uint8Array.of(127, 128, 0, 255) })], [0, 1, 0, 1]);
});

test('channels round-trip through .paintproj; older files have none', () => {
  const { channels } = saveSelectionToChannel([], leftHalf(), W * H, { name: 'Keep' });
  const saved = JSON.parse(JSON.stringify(serializeChannels(channels)));
  const back = deserializeChannels(saved, W * H);
  assert.equal(back[0].name, 'Keep');
  assert.deepEqual([...back[0].data], [...channels[0].data]);
  assert.deepEqual(deserializeChannels(undefined, W * H), []);
  const project = readFileSync(new URL('../paint/project.js', import.meta.url), 'utf8');
  assert.match(project, /channels: serializeChannels\(state\.channels\)/);
  assert.match(project, /channels: deserializeChannels\(data\.channels, width \* height\)/);
});

test('channel list ops: delete, and a canvas resize drops channels of the old size', () => {
  const a = saveSelectionToChannel([], leftHalf(), W * H).channels;
  const ab = saveSelectionToChannel(a, leftHalf(), W * H).channels;
  assert.deepEqual(
    deleteChannel(ab, 0).map((c) => c.name),
    ['Alpha 2']
  );
  assert.equal(fittingChannels(ab, W * H).length, 2);
  assert.equal(fittingChannels(ab, 9).length, 0);
});

test('the Channels panel lists RGB, Red, Green, Blue, then the alpha channels', () => {
  const { window } = new JSDOM(html);
  globalThis.document = window.document;
  try {
    const channels = [{ name: 'Alpha 1', data: new Uint8Array(1) }];
    assert.deepEqual(
      channelRows(channels).map((r) => r.name),
      ['RGB', 'Red', 'Green', 'Blue', 'Alpha 1']
    );
    const container = window.document.getElementById('channel-list-container');
    assert.ok(container.closest('#panel-channels'), 'the list lives in the Channels tab');
    const calls = [];
    renderChannelsPanel(container, channels, {
      target: 0,
      canSave: true,
      onTarget: (i) => calls.push(['target', i]),
      onLoad: (i) => calls.push(['load', i]),
      onSave: () => calls.push(['save']),
      onDelete: (i) => calls.push(['delete', i])
    });
    const rows = [...container.querySelectorAll('.channel-row')];
    assert.deepEqual(
      rows.map((r) => r.textContent),
      ['RGB', 'Red', 'Green', 'Blue', 'Alpha 1']
    );
    assert.equal(rows[4].getAttribute('aria-selected'), 'true');
    rows[0].click();
    for (const action of ['load', 'save', 'delete']) {
      container.querySelector(`.layer-footer-btn[data-action="${action}"]`).click();
    }
    assert.deepEqual(calls, [['target', null], ['load', 0], ['save'], ['delete', 0]]);
  } finally {
    delete globalThis.document;
  }
});

test('Select and Window menu commands sit where PhotoCraft puts them', () => {
  const quick = COMMANDS_BY_ID.get('select.editInQuickMaskMode');
  assert.deepEqual(quick.menu, ['Select']);
  assert.equal(quick.shortcut, 'Q');
  assert.equal(commandForKey({ key: 'q', code: 'KeyQ' }), quick);
  assert.equal(quick.checked({ quickMask: {} }), true);
  assert.equal(quick.checked({ quickMask: null }), false);
  const save = COMMANDS_BY_ID.get('select.saveSelection');
  const load = COMMANDS_BY_ID.get('select.loadSelection');
  assert.equal(save.label, 'Save Selection…');
  assert.equal(load.label, 'Load Selection…');
  const sel = { mode: 'active', w: 2, h: 2 };
  assert.equal(save.enabled({ sel, channels: [] }), true);
  assert.equal(save.enabled({ sel: { mode: 'none' }, channels: [] }), false);
  assert.equal(load.enabled({ sel, channels: [] }), false);
  assert.equal(load.enabled({ sel, channels: [{}] }), true);
  const channels = COMMANDS_BY_ID.get('window.panel.channels');
  assert.deepEqual(channels.menu, ['Window']);

  // Each command runs its action.
  const ran = [];
  const ctx = {
    toggleQuickMask: () => ran.push('quick'),
    saveSelection: () => ran.push('save'),
    loadSelection: () => ran.push('load'),
    togglePanel: (name) => ran.push(name)
  };
  for (const c of [quick, save, load, channels]) c.run(ctx);
  assert.deepEqual(ran, ['quick', 'save', 'load', 'channels']);

  const { window } = new JSDOM(html);
  const bar = window.document.getElementById('menu-bar');
  buildMenuBar(bar, COMMANDS, { mac: false, state: { sel, channels: [] } });
  const titles = [...bar.querySelectorAll('.menu-bar-btn')].map((b) => b.textContent.trim());
  assert.equal(titles.at(-1), 'Window');
  const selectList = window.document.getElementById('select-menu-list');
  const ids = [...selectList.querySelectorAll('button[data-command]')].map((b) => b.dataset.command);
  const at = (id) => ids.indexOf(id);
  assert.ok(at('select.transformSelection') < at('select.editInQuickMaskMode'));
  assert.ok(at('select.editInQuickMaskMode') < at('select.loadSelection'));
  assert.ok(at('select.loadSelection') < at('select.saveSelection'));
  const windowList = window.document.getElementById('window-menu-list');
  assert.ok(windowList.querySelector('[data-command="window.panel.channels"]'));
});

test('the tool column shows the Quick Mask button and the tab names Quick Mask', () => {
  const { window } = new JSDOM(html);
  const btn = window.document.getElementById('btn-quick-mask');
  assert.ok(btn.closest('.left-panel'), 'in the tool column');
  assert.equal(btn.getAttribute('aria-pressed'), 'false');
  assert.match(btn.title, /Quick Mask Mode \(Q\)/);
  assert.equal(docTabText('Untitled-1', 1, false, 'rgb', true), 'Untitled-1 @ 100% (Quick Mask/8)');
  assert.equal(docTabText('Untitled-1', 1, false, 'rgb'), 'Untitled-1 @ 100% (RGB/8)');
  const paintJs = readFileSync(new URL('../paint/paint.js', import.meta.url), 'utf8');
  // In Quick Mask every tool paints the mask plane.
  assert.match(paintJs, /if \(state\.quickMask\) return state\.quickMask\.ctx;/);
});

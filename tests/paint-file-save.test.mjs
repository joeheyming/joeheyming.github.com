import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createFileDocument,
  dirtyTitle,
  docNameFromFile,
  projectFileName
} from '../paint/file-save.js';
import { COMMANDS, COMMANDS_BY_ID, commandForKey } from '../paint/commands.js';
import { planMenus } from '../paint/menu-bar.js';
import { snapshotStack, restoreStack, isStackUndoLabel } from '../paint/stack-history.js';
import { docTabText } from '../paint/doc-tab.js';
import { historyIconName } from '../paint/history.js';

// A layer whose pixels live in a plain ImageData-shaped object (no canvas in node).
function fakeLayer(id, fill) {
  const data = new Uint8ClampedArray(2 * 2 * 4).fill(fill);
  return { id, name: `Layer ${id}`, data: { width: 2, height: 2, data } };
}

// The File commands wired to stubs: downloads are recorded and the name prompt answers `answer`.
function setup({ answer = null, confirmAnswer = true } = {}) {
  const state = {
    docName: 'Untitled-1',
    fileName: null,
    dirty: false,
    fileSnapshot: null,
    layers: [fakeLayer(1, 10)],
    activeLayerIdx: 0
  };
  const log = { downloads: [], asked: [], undo: [], confirms: [], resets: 0, changes: 0 };
  const io = {
    state,
    serialize: () => ({ docName: state.docName, pixels: [...state.layers[0].data.data] }),
    download: (data, fileName) => log.downloads.push({ data, fileName }),
    askName: (suggested, onConfirm) => {
      log.asked.push(suggested);
      if (answer !== null) onConfirm(answer);
    },
    takeSnapshot: () => snapshotStack(state.layers, state.activeLayerIdx),
    restoreSnapshot: (snap) => {
      const { layers, activeIdx } = restoreStack(snap);
      state.layers = layers.map((r) => ({ id: r.id, name: r.name, data: r.pixels }));
      state.activeLayerIdx = activeIdx;
    },
    pushUndo: (label) => {
      log.undo.push(label);
      file.markDirty();
    },
    confirm: (message, onOk) => {
      log.confirms.push(message);
      if (confirmAnswer) onOk?.();
    },
    resetDocument: () => {
      log.resets++;
      state.docName = 'Untitled-1';
      state.layers = [fakeLayer(1, 255)];
    },
    onChange: () => log.changes++
  };
  const file = createFileDocument(io);
  const ctx = { file };
  const run = (id) => {
    const cmd = COMMANDS_BY_ID.get(id);
    if (cmd.enabled(state)) cmd.run(ctx);
  };
  return { state, log, file, run };
}

// A stroke: pushUndo then pixels change, as paint.js does.
function paint(env, value) {
  env.file.markDirty();
  env.state.layers[0].data.data.fill(value);
}

test('file names: document name ↔ .paintproj download name', () => {
  assert.equal(projectFileName('Untitled-1'), 'Untitled-1.paintproj');
  assert.equal(projectFileName('art.paintproj'), 'art.paintproj');
  assert.equal(projectFileName('  '), 'Untitled-1.paintproj');
  assert.equal(docNameFromFile('art.paintproj'), 'art');
  assert.equal(docNameFromFile('art.PAINTPROJ'), 'art');
});

test('the first Save asks for a name like Save As, later Saves reuse it', () => {
  const env = setup({ answer: 'poster' });
  paint(env, 50);
  assert.equal(env.state.dirty, true);
  env.run('file.save');
  assert.deepEqual(env.log.asked, ['Untitled-1.paintproj']);
  assert.equal(env.log.downloads.length, 1);
  assert.equal(env.log.downloads[0].fileName, 'poster.paintproj');
  assert.equal(env.state.fileName, 'poster.paintproj');
  assert.equal(env.state.docName, 'poster');
  assert.equal(env.state.dirty, false);

  paint(env, 60);
  env.run('file.save');
  assert.equal(env.log.asked.length, 1, 'second Save does not ask');
  assert.equal(env.log.downloads[1].fileName, 'poster.paintproj');
  assert.equal(env.log.downloads[1].data.pixels[0], 60);
  assert.equal(env.state.dirty, false);
});

test('a cancelled name prompt downloads nothing and stays dirty', () => {
  const env = setup({ answer: null });
  paint(env, 50);
  env.run('file.save');
  assert.equal(env.log.downloads.length, 0);
  assert.equal(env.state.dirty, true);
  assert.equal(env.state.fileName, null);
});

test('Save As always asks and renames the document', () => {
  const second = setup({ answer: 'second.paintproj' });
  Object.assign(second.state, { fileName: 'first.paintproj', docName: 'first' });
  second.run('file.saveAs');
  assert.deepEqual(second.log.asked, ['first.paintproj']);
  assert.equal(second.log.downloads[0].fileName, 'second.paintproj');
  assert.equal(second.state.docName, 'second');
  assert.equal(second.state.fileName, 'second.paintproj');
});

test('Save a Copy asks and keeps the document name and the dirty flag', () => {
  const env = setup({ answer: 'backup' });
  Object.assign(env.state, { fileName: 'poster.paintproj', docName: 'poster' });
  paint(env, 70);
  const changes = env.log.changes;
  env.run('file.saveACopy');
  assert.deepEqual(env.log.asked, ['poster copy.paintproj']);
  assert.equal(env.log.downloads[0].fileName, 'backup.paintproj');
  assert.equal(env.log.downloads[0].data.pixels[0], 70);
  assert.equal(env.state.fileName, 'poster.paintproj');
  assert.equal(env.state.docName, 'poster');
  assert.equal(env.state.dirty, true);
  assert.equal(env.state.fileSnapshot, null, 'a copy is not a Revert point');
  assert.equal(env.log.changes, changes);
});

test('Revert is disabled with no snapshot and restores the saved pixels with one undo step', () => {
  const env = setup({ answer: 'poster' });
  const revert = COMMANDS_BY_ID.get('file.revert');
  assert.equal(revert.enabled(env.state), false);

  paint(env, 40);
  env.run('file.save');
  assert.equal(revert.enabled(env.state), true);

  paint(env, 200);
  env.state.layers[0].data.data[0] = 1;
  env.run('file.revert');
  assert.deepEqual(env.log.undo, ['Revert']);
  assert.ok(isStackUndoLabel('Revert'), 'Revert takes a whole-stack undo entry');
  assert.deepEqual([...env.state.layers[0].data.data], new Array(16).fill(40));
  assert.equal(env.state.dirty, false);

  // The snapshot survives a restore: reverting again still gives the saved pixels.
  paint(env, 90);
  env.run('file.revert');
  assert.deepEqual([...env.state.layers[0].data.data], new Array(16).fill(40));
});

test('opening a project makes it the Revert point under its file name', () => {
  const env = setup();
  env.state.layers[0].data.data.fill(33);
  env.file.opened('photo.paintproj');
  assert.equal(env.state.fileName, 'photo.paintproj');
  assert.equal(env.state.dirty, false);
  paint(env, 99);
  env.run('file.revert');
  assert.equal(env.state.layers[0].data.data[0], 33);
  // A restored session has a Revert point but no file name, so Save asks.
  env.file.opened(null);
  assert.equal(env.state.fileName, null);
  assert.ok(env.state.fileSnapshot);
});

test('Close confirms only when dirty, then resets to a blank document', () => {
  const clean = setup();
  clean.run('file.close');
  assert.equal(clean.log.confirms.length, 0);
  assert.equal(clean.log.resets, 1);

  const keep = setup({ confirmAnswer: false });
  paint(keep, 12);
  keep.run('file.close');
  assert.equal(keep.log.confirms.length, 1);
  assert.equal(keep.log.resets, 0);
  assert.equal(keep.state.dirty, true);

  const discard = setup({ answer: 'poster' });
  discard.run('file.save');
  paint(discard, 12);
  discard.run('file.close');
  assert.equal(discard.log.resets, 1);
  assert.equal(discard.state.dirty, false);
  assert.equal(discard.state.fileName, null);
  assert.equal(discard.state.fileSnapshot, null);
  assert.equal(COMMANDS_BY_ID.get('file.revert').enabled(discard.state), false);
});

test('the title and document tab show * while dirty', () => {
  assert.equal(dirtyTitle('Paint', true), '*Paint');
  assert.equal(dirtyTitle('Paint', false), 'Paint');
  assert.equal(docTabText('poster', 1, true), 'poster @ 100% (RGB/8)*');
  assert.equal(docTabText('poster', 1, false), 'poster @ 100% (RGB/8)');
  const env = setup({ answer: 'x' });
  const before = env.log.changes;
  paint(env, 1);
  paint(env, 2);
  assert.equal(env.log.changes, before + 1, 'markDirty notifies once');
});

test('File commands use PhotoCraft catalog ids, labels, and shortcuts', () => {
  const key = (code, mods = {}) => ({ code, key: code.replace(/^Key/, '').toLowerCase(), ...mods });
  assert.equal(commandForKey(key('KeyS', { metaKey: true }))?.id, 'file.save');
  assert.equal(commandForKey(key('KeyS', { ctrlKey: true, shiftKey: true }))?.id, 'file.saveAs');
  assert.equal(commandForKey(key('KeyS', { ctrlKey: true, altKey: true }))?.id, 'file.saveACopy');
  assert.equal(commandForKey({ code: 'F12', key: 'F12' })?.id, 'file.revert');
  assert.equal(commandForKey(key('KeyW', { metaKey: true }))?.id, 'file.close');
  assert.equal(COMMANDS_BY_ID.get('file.saveAs').label, 'Save As…');
  assert.equal(COMMANDS_BY_ID.get('file.saveACopy').label, 'Save a Copy…');

  const file = planMenus(COMMANDS)
    .get('File')
    .map((e) => (e.sep ? '---' : e.sub ?? e.cmd.id));
  assert.deepEqual(file.slice(0, 9), [
    'file.new',
    'file.open',
    '---',
    'file.close',
    '---',
    'file.save',
    'file.saveAs',
    'file.saveACopy',
    'file.revert'
  ]);
  // .paintproj is Save now, not an Export item.
  assert.equal(COMMANDS_BY_ID.has('file.export.paintProject'), false);
  assert.equal(historyIconName('Revert'), 'clock');
});

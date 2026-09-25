import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  appIconKey,
  clampIconPosition,
  defaultAppPosition,
  defaultFilePosition,
  desktopVfsItems,
  dropPointToIconPosition,
  normalizeIconLayout,
  packLayoutToGrid,
  parseIconKey,
  resolveIconPosition,
  snapToGrid,
  translateGroup,
  vfsIconKey
} from '../os/desktop-layout.js';
import { Constants } from '../os/constants.js';
import { normalizePrefs } from '../os/prefs.js';

const layout = Constants.ICON_SIZE_LAYOUT.m;

describe('desktop layout', () => {
  it('parses app and vfs icon keys', () => {
    assert.deepEqual(parseIconKey(appIconKey('doom')), { kind: 'app', id: 'doom' });
    assert.deepEqual(parseIconKey(vfsIconKey('/home/user/Desktop/a.txt')), {
      kind: 'vfs',
      path: '/home/user/Desktop/a.txt'
    });
    assert.equal(parseIconKey('nope'), null);
    assert.equal(parseIconKey('vfs:data:image/png;base64,xx'), null);
  });

  it('lists files and folders, ignoring other types', () => {
    const items = desktopVfsItems([
      { type: 'file', path: '/d/a.txt' },
      { type: 'directory', path: '/d/folder' },
      { type: 'symlink', path: '/d/link' },
      null
    ]);
    assert.equal(items.length, 2);
    assert.equal(items[1].path, '/d/folder');
  });

  it('normalizes icon layout in prefs', () => {
    const prefs = normalizePrefs({
      desktopIconLayout: {
        'app:doom': { x: 30.2, y: 40.9 },
        'vfs:/home/u/Desktop/notes.txt': { x: 400, y: 30 },
        junk: { x: 1, y: 2 },
        'app:bad': { x: 'nope', y: 1 }
      }
    });
    assert.deepEqual(prefs.desktopIconLayout['app:doom'], { x: 30, y: 41 });
    assert.ok(prefs.desktopIconLayout['vfs:/home/u/Desktop/notes.txt']);
    assert.equal(prefs.desktopIconLayout.junk, undefined);
  });

  it('snaps and clamps positions', () => {
    assert.deepEqual(snapToGrid(44, 51, 90, 100), { x: 0, y: 100 });
    assert.deepEqual(clampIconPosition(-10, 999, { maxX: 200, maxY: 80 }), { x: 0, y: 80 });
  });

  it('packs keys onto the default grid', () => {
    const packed = packLayoutToGrid(['app:a', 'app:b'], layout, Constants);
    assert.deepEqual(packed['app:a'], { x: Constants.ICON_START_X, y: Constants.ICON_START_Y });
    assert.deepEqual(packed['app:b'], {
      x: Constants.ICON_START_X + layout.spacingX,
      y: Constants.ICON_START_Y
    });
  });

  it('uses registry positions for system apps and a right-side stack for files', () => {
    const sys = defaultAppPosition(
      { system: true, desktopPosition: { x: 12, y: 34 } },
      0,
      layout,
      Constants,
      false,
      { startX: 0, startY: 0, spacingX: 80, spacingY: 100, iconsPerRow: 4 }
    );
    assert.deepEqual(sys, { x: 12, y: 34 });
    const file = defaultFilePosition(
      2,
      layout,
      Constants,
      false,
      { startX: 0, startY: 0, spacingX: 80, spacingY: 100, iconsPerRow: 4 },
      1000
    );
    assert.equal(file.x, 1000 - layout.rightOffset);
    assert.equal(file.y, Constants.FILE_ICON_START_Y + 2 * layout.fileSpacing);
  });

  it('resolves saved layout over fallbacks', () => {
    const key = appIconKey('doom');
    assert.deepEqual(resolveIconPosition(key, { [key]: { x: 8, y: 9 } }, { x: 1, y: 2 }), {
      x: 8,
      y: 9
    });
  });

  it('translates a group so the anchor lands on the drop cell', () => {
    const next = translateGroup(
      { a: { x: 0, y: 0 }, b: { x: 90, y: 0 } },
      'a',
      { x: 180, y: 100 },
      90,
      100,
      { maxX: 1000, maxY: 1000 }
    );
    assert.deepEqual(next.a, { x: 180, y: 100 });
    assert.deepEqual(next.b, { x: 270, y: 100 });
  });

  it('maps a drop point onto the desktop grid', () => {
    const pos = dropPointToIconPosition(200, 150, { x: 10, y: 10 }, { left: 0, top: 0 }, 90, 100, {
      maxX: 800,
      maxY: 600
    });
    assert.deepEqual(pos, { x: 180, y: 100 });
  });

  it('drops invalid layout entries', () => {
    assert.deepEqual(normalizeIconLayout(null), {});
    assert.deepEqual(normalizeIconLayout([]), {});
  });
});

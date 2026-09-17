import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PREFS,
  MAX_WALLPAPER_DATA_URL,
  fitToCss,
  normalizePrefs,
  prefsFromUnknown,
  wallpaperStyleFor,
  WALLPAPER_PRESETS
} from '../os/prefs.js';

describe('os prefs', () => {
  it('defaults wallpaper to the glow preset', () => {
    const prefs = normalizePrefs(null);
    assert.equal(prefs.wallpaper.source, 'preset');
    assert.equal(prefs.wallpaper.id, 'glow');
    assert.equal(prefs.wallpaper.fit, 'cover');
    assert.equal(prefs.theme, 'dark');
    assert.equal(prefs.iconSize, 'm');
    assert.equal(prefs.screensaver.enabled, false);
  });

  it('maps fit modes to CSS', () => {
    assert.deepEqual(fitToCss('cover'), {
      size: 'cover',
      repeat: 'no-repeat',
      position: 'center'
    });
    assert.deepEqual(fitToCss('contain'), {
      size: 'contain',
      repeat: 'no-repeat',
      position: 'center'
    });
    assert.deepEqual(fitToCss('center'), {
      size: 'auto',
      repeat: 'no-repeat',
      position: 'center'
    });
    assert.deepEqual(fitToCss('tile'), {
      size: 'auto',
      repeat: 'repeat',
      position: '0 0'
    });
  });

  it('rejects storing huge wallpaper data URLs', () => {
    const huge = 'data:image/png;base64,' + 'A'.repeat(MAX_WALLPAPER_DATA_URL + 8);
    assert.throws(() => prefsFromUnknown({ wallpaper: { source: 'vfs', path: huge } }), {
      message: /data URLs/
    });
  });

  it('drops short data URL paths instead of persisting them as vfs', () => {
    const prefs = normalizePrefs({
      wallpaper: { source: 'vfs', path: 'data:image/png;base64,abc', fit: 'tile' }
    });
    assert.equal(prefs.wallpaper.source, 'preset');
    assert.equal(prefs.wallpaper.id, 'glow');
    assert.equal(prefs.wallpaper.fit, 'tile');
  });

  it('keeps a virtual filesystem wallpaper path', () => {
    const prefs = normalizePrefs({
      wallpaper: { source: 'vfs', path: '/home/joe/Pictures/cat.png', fit: 'contain' }
    });
    assert.equal(prefs.wallpaper.source, 'vfs');
    assert.equal(prefs.wallpaper.path, '/home/joe/Pictures/cat.png');
    assert.equal(prefs.wallpaper.fit, 'contain');
  });

  it('builds CSS for glow, tiger, solids, and vfs images', () => {
    const glow = wallpaperStyleFor(DEFAULT_PREFS.wallpaper);
    assert.match(glow.backgroundImage, /radial-gradient/);
    const tiger = wallpaperStyleFor({ source: 'preset', id: 'tiger', fit: 'cover' });
    assert.match(tiger.backgroundImage, /ghostscript_tiger/);
    const ink = wallpaperStyleFor({ source: 'preset', id: 'ink', fit: 'cover' });
    assert.equal(ink.backgroundImage, 'none');
    const vfs = wallpaperStyleFor(
      { source: 'vfs', path: '/pic.png', fit: 'cover' },
      'blob:http://example/1'
    );
    assert.equal(vfs.backgroundImage, 'url("blob:http://example/1")');
    assert.equal(vfs.backgroundSize, 'cover');
  });

  it('exposes named wallpaper presets', () => {
    assert.ok(WALLPAPER_PRESETS.glow);
    assert.ok(WALLPAPER_PRESETS.tiger);
    assert.ok(WALLPAPER_PRESETS.surface);
  });
});

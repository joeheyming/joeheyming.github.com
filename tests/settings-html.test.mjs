import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const html = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../settings/index.html'),
  'utf8'
);

describe('settings index.html', () => {
  it('allows indexing and has a canonical URL', () => {
    assert.match(html, /name="robots" content="index, follow"/);
    assert.match(html, /rel="canonical" href="https:\/\/joeheyming.github.io\/settings\/"/);
    assert.match(html, /<title>Settings — Wallpaper, Theme, and Desktop/);
  });

  it('loads the settings module and appearance controls', () => {
    assert.match(html, /type="module" src="index.js"/);
    assert.match(html, /id="appearance"/);
    assert.match(html, /id="wallpaper-presets"/);
    assert.match(html, /id="theme"/);
    assert.match(html, /id="desktop"/);
    assert.match(html, /id="account"/);
    assert.match(html, /id="about"/);
  });
});

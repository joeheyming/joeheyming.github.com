import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zeniusPlayHref } from '../js/homeScreen.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('zeniusPlayHref', () => {
  it('puts the zenius URL in a query string', () => {
    const src = 'https://zenius-i-vanisher.com/v5.2/viewsimfile.php?simfileid=1';
    const href = zeniusPlayHref(src);
    const qs = new URLSearchParams(href.slice(href.indexOf('?') + 1));
    assert.equal(qs.get('zenius'), src);
  });
});

describe('bundled Lost song is gone', () => {
  it('does not keep committed song files or local registry modules', () => {
    assert.equal(existsSync(path.join(root, 'js/songs.js')), false);
    assert.equal(existsSync(path.join(root, 'js/steps.js')), false);
    assert.equal(existsSync(path.join(root, 'songs/Lost/Lost.mp3')), false);
    assert.equal(existsSync(path.join(root, 'songs/Lost/background.png')), false);
  });

  it('ships a home overlay instead of Lost audio/background URLs', () => {
    const html = readFileSync(path.join(root, 'index.html'), 'utf8');
    assert.match(html, /id="sm-home"/);
    assert.match(html, /id="sm-home-browse"/);
    assert.doesNotMatch(html, /songs\/Lost/);
  });
});

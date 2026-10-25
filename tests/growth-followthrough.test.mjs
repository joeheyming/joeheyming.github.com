import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function page(rel) {
  return new JSDOM(readFileSync(path.join(ROOT, rel), 'utf8')).window.document;
}

test('GBA rom list opens a window instead of painting the whole collection', () => {
  const dom = new JSDOM('<!doctype html><body></body>', {
    url: 'http://localhost/emulator/gba/',
    runScripts: 'outside-only'
  });
  dom.window.EMULATOR_CONSOLES = {
    gba: { id: 'gba', iaBaseUrl: 'https://archive.org/download/example', title: 'GBA' }
  };
  dom.window.eval(readFileSync(path.join(ROOT, 'emulator/rom-browser.js'), 'utf8'));
  const el = dom.window.document.createElement('rom-browser');
  el.setAttribute('console', 'gba');
  dom.window.document.body.appendChild(el);
  const roms = Array.from({ length: 100 }, (_, i) => ({
    title: `Game ${i}`,
    name: `game-${i}`,
    description: 'Game Boy Advance game',
    size: '1 MB',
    downloadUrl: 'https://example.test/game.zip'
  }));
  el.renderRoms(roms);
  assert.equal(el.shadowRoot.querySelectorAll('.rom-card').length, 48);
  el.shadowRoot.querySelector('[data-action="show-more"]').click();
  assert.equal(el.shadowRoot.querySelectorAll('.rom-card').length, 96);
});

test('Classic DOOM is a crawlable play page and stays out of the gallery', () => {
  const doc = page('doom/classic/index.html');
  assert.equal(doc.title, 'Classic DOOM — Play the 1993 Original Free 💀');
  assert.equal(
    doc.querySelector('link[rel="canonical"]').getAttribute('href'),
    'https://joeheyming.github.io/doom/classic/'
  );
  assert.match(doc.querySelector('meta[name="robots"]').getAttribute('content'), /index/);
  assert.ok(doc.querySelector('h1'));
  const desc = doc.querySelector('meta[name="description"]').getAttribute('content');
  assert.ok(desc.length >= 150, desc);
  assert.equal(doc.querySelector('a.classic-play').getAttribute('href'), '/doom/?flavor=classic');

  const registry = JSON.parse(readFileSync(path.join(ROOT, 'apps-registry.json'), 'utf8'));
  const app = registry.find((entry) => entry.id === 'doom-classic');
  assert.equal(app.listed, false);
  assert.equal(app.path, './doom/classic/');
});

test('top charts are real play links and search landings stay unlisted', () => {
  const doc = page('stepmania/songs/index.html');
  const links = [...doc.querySelectorAll('.songs-list a')];
  assert.equal(links.length, 40);
  assert.match(links[0].getAttribute('href'), /simfileid%3D40$/);
  assert.equal(links[0].textContent.trim(), 'Xepher');
  const desc = doc.querySelector('meta[name="description"]').getAttribute('content');
  assert.ok(desc.length >= 150, desc);

  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' });
  dom.window.eval(readFileSync(path.join(ROOT, 'shared/app-sections.js'), 'utf8'));
  const { isListed } = dom.window.HeymingAppSections;
  const registry = JSON.parse(readFileSync(path.join(ROOT, 'apps-registry.json'), 'utf8'));
  assert.equal(isListed(registry.find((app) => app.id === 'stepmania-songs')), false);
  assert.equal(isListed(registry.find((app) => app.id === 'doom')), true);
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const ROOT = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, ROOT), 'utf8');

test('sampler page is local-first, accessible, and indexable', async () => {
  const html = await read('play/sampler/index.html');

  assert.match(html, /<meta name="robots" content="index, follow"/);
  assert.match(
    html,
    /<link rel="canonical" href="https:\/\/joeheyming\.github\.io\/play\/sampler\/"/
  );
  assert.match(html, /id="dwp-file"[^>]+accept="\.dwp,application\/octet-stream"/);
  assert.match(html, /id="drop-zone"[\s\S]+role="button"[\s\S]+tabindex="0"/);
  assert.match(html, /Your file never leaves this device/);
  assert.match(html, /<script type="module" src="index\.js"><\/script>/);
  assert.match(html, /<script src="\/achievements\.js"><\/script>/);
});

test('sampler leads with the playable instrument, not the file picker', async () => {
  const html = await read('play/sampler/index.html');

  assert.ok(
    html.indexOf('id="piano-keyboard"') < html.indexOf('id="dwp-file"'),
    'the keyboard should come before the DWP loader so the page opens on something playable'
  );
  assert.match(html, /<h2>How to play<\/h2>/);
  assert.match(html, /id="sound"/);
});

test('sampler is discoverable through the registry, hub, sitemap, and previews', async () => {
  const [registryText, hub, sitemap, previews] = await Promise.all([
    read('apps-registry.json'),
    read('play/index.html'),
    read('sitemap.xml'),
    read('generate-previews.js')
  ]);
  const registry = JSON.parse(registryText);
  const app = registry.find((entry) => entry.id === 'play-sampler');

  assert.ok(app, 'play-sampler registry entry is missing');
  assert.equal(app.path, './play/sampler/');
  assert.match(hub, /href="\.\/sampler\/"/);
  assert.match(sitemap, /https:\/\/joeheyming\.github\.io\/play\/sampler\//);
  assert.match(previews, /play\/sampler\/sampler-preview\.png/);
});

test('sampler source communicates supported DWP scope', async () => {
  const [html, parser] = await Promise.all([
    read('play/sampler/index.html'),
    read('play/sampler/dwp-parser.js')
  ]);

  assert.match(html, /Presets that rely on separate sample folders/);
  assert.match(parser, /separate sample files/);
  assert.match(parser, /monolithic DWP/);
  assert.doesNotMatch(html, /support(?:s|ed)? all DWP/i);
});

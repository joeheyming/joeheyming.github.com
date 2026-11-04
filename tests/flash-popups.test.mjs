import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Flash player refuses SWF navigateToURL popups', () => {
  const html = readFileSync(path.join(ROOT, 'emulator/flash/index.html'), 'utf8');
  const configAt = html.indexOf('window.RufflePlayer.config');
  const scriptAt = html.indexOf(
    'src="https://cdn.jsdelivr.net/npm/@ruffle-rs/ruffle@0.5.0/ruffle.min.js"'
  );
  assert.ok(configAt > 0 && scriptAt > configAt, 'Ruffle config is set before the player script');
  const config = html.slice(configAt, scriptAt);
  assert.match(config, /openUrlMode:\s*'deny'/);
});

test('Flash is a console in the emulator hub', () => {
  const consoles = readFileSync(path.join(ROOT, 'emulator/consoles.js'), 'utf8');
  const hub = readFileSync(path.join(ROOT, 'emulator/index.html'), 'utf8');
  const launch = readFileSync(path.join(ROOT, 'emulator/launch.js'), 'utf8');
  const stub = readFileSync(path.join(ROOT, 'flash/index.html'), 'utf8');
  assert.match(consoles, /id:\s*'flash'/);
  assert.match(consoles, /player:\s*'ruffle'/);
  assert.match(hub, /href="\/emulator\/flash\/"/);
  assert.doesNotMatch(hub, /picker-tile-flash/);
  assert.match(launch, /mountRuffle/);
  assert.match(stub, /noindex,follow/);
  assert.match(stub, /\/emulator\/flash\//);
});

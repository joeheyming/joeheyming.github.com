// Registry integrity for the unified /emulator/ shell.
//
// Workflow: edit consoles.js → npm run sync:emulator (picker + missing
// landers) → apps-registry.json → npm run sync:catalog (sitemap / PAGES).
// These checks catch a missing lander, registry row, sitemap URL, preview
// page, or hub picker link — silent omissions that still boot locally.
//
// Whether the Internet Archive item behind `iaBaseUrl` is still live is a
// separate, network-dependent question: see scripts/check-ia-collections.sh.

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(repoRoot, rel), 'utf8');

let consoles;

before(() => {
  // consoles.js is a classic IIFE that hangs its exports off `window`.
  // Passing a stub as a parameter shadows the global inside the function.
  const stubWindow = { location: { pathname: '/emulator/', search: '', hash: '' } };
  new Function('window', read('emulator/consoles.js'))(stubWindow);
  consoles = stubWindow.EMULATOR_CONSOLES;
});

describe('emulator console registry', () => {
  it('exposes a non-empty registry keyed by id', () => {
    assert.ok(consoles && Object.keys(consoles).length > 0);
    for (const [key, cfg] of Object.entries(consoles)) {
      assert.equal(cfg.id, key, `${key}: id must match its registry key`);
    }
  });

  it('gives every console the fields the shell reads', () => {
    for (const cfg of Object.values(consoles)) {
      for (const field of ['title', 'subtitle', 'emoji', 'ejsCore', 'fileAccept', 'accentHex']) {
        assert.ok(cfg[field], `${cfg.id}: missing ${field}`);
      }
      assert.ok(Array.isArray(cfg.controls) && cfg.controls.length > 0, `${cfg.id}: no controls`);
      assert.match(cfg.fileAccept, /^\./, `${cfg.id}: fileAccept must be a dotted extension list`);
      assert.match(cfg.accentHex, /^#[0-9a-f]{6}$/i, `${cfg.id}: accentHex must be a hex color`);
    }
  });

  it('pairs biosRequired with a filename and storage key', () => {
    for (const cfg of Object.values(consoles)) {
      if (!cfg.biosRequired) continue;
      assert.ok(cfg.biosFileName, `${cfg.id}: biosRequired without biosFileName`);
      assert.ok(cfg.biosStorageKey, `${cfg.id}: biosRequired without biosStorageKey`);
    }
  });

  it('registers every console across discovery surfaces + hub picker', () => {
    const sitemap = read('sitemap.xml');
    const previews = read('generate-previews.js');
    const picker = read('emulator/index.html');
    const registry = JSON.parse(read('apps-registry.json'));
    const registryPaths = new Set(registry.map((app) => app.path));

    const hasPickerMarkers =
      picker.includes('<!-- sync:emulator-picker:start -->') &&
      picker.includes('<!-- sync:emulator-picker:end -->');
    assert.ok(
      hasPickerMarkers,
      'hub must keep sync:emulator-picker markers for npm run sync:emulator'
    );

    for (const id of Object.keys(consoles)) {
      assert.ok(existsSync(join(repoRoot, `emulator/${id}/index.html`)), `${id}: no lander`);
      assert.ok(
        sitemap.includes(`https://joeheyming.github.io/emulator/${id}/`),
        `${id}: missing from sitemap.xml`
      );
      assert.ok(previews.includes(`emulator/${id}/`), `${id}: missing from generate-previews.js`);
      assert.ok(registryPaths.has(`./emulator/${id}/`), `${id}: missing from apps-registry.json`);
      assert.ok(picker.includes(`/emulator/${id}/`), `${id}: no picker tile on the hub`);
    }
  });

  it('points each lander at its own canonical URL and preview image', () => {
    for (const id of Object.keys(consoles)) {
      const html = read(`emulator/${id}/index.html`);
      assert.ok(
        html.includes(`<link rel="canonical" href="https://joeheyming.github.io/emulator/${id}/"`),
        `${id}: canonical does not point at its own lander`
      );
      assert.ok(
        html.includes('<meta name="robots" content="index, follow" />'),
        `${id}: missing the explicit robots allow`
      );
      // Copying a lander from a sibling console and forgetting to rename
      // the OG image ships another console's screenshot to every unfurl.
      const ogImages = [...html.matchAll(/emulator\/[a-z0-9]+\/([a-z0-9-]+-preview\.png)/g)];
      assert.ok(ogImages.length > 0, `${id}: no preview image referenced`);
      for (const [full] of ogImages) {
        assert.equal(full, `emulator/${id}/${id}-preview.png`, `${id}: borrowed preview image`);
      }
    }
  });

  it('keeps disc-sized consoles on the download-then-load path', () => {
    for (const cfg of Object.values(consoles)) {
      if (!cfg.iaExternalDownload) continue;
      assert.ok(
        /download/i.test(cfg.romHelp || ''),
        `${cfg.id}: disc console must tell the player to download first`
      );
    }
  });

  it('tells GBA and Game Boy apart, since players conflate them', () => {
    const gba = consoles.gba;
    const gb = consoles.gb;
    assert.ok(gba && gb, 'expected both gb and gba consoles');
    assert.notEqual(gba.ejsCore, gb.ejsCore);
    assert.match(`${gba.romHelp} ${(gba.howto || []).join(' ')}`, /not Game Boy/i);
    assert.ok(gba.fileAccept.includes('.gba'));
    assert.ok(!gb.fileAccept.includes('.gba'));
  });

  it('tells Neo Geo Pocket apart from arcade Neo Geo', () => {
    const ngp = consoles.ngp;
    const neogeo = consoles.neogeo;
    assert.ok(ngp && neogeo, 'expected both ngp and neogeo consoles');
    assert.equal(ngp.ejsCore, 'ngp');
    assert.equal(neogeo.ejsCore, 'arcade');
    assert.notEqual(Boolean(ngp.biosRequired), Boolean(neogeo.biosRequired));
    assert.match(`${ngp.romHelp} ${(ngp.howto || []).join(' ')}`, /not.*arcade|handheld/i);
    assert.ok(ngp.fileAccept.includes('.ngp'));
    assert.ok(!neogeo.fileAccept.includes('.ngp'));
  });
});

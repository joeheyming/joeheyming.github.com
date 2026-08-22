// Pure helpers from emulator/bios.js: IA URL selection + normalize rules.
// Loaded as a classic IIFE into a JSDOM window (no IndexedDB / network).

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(repoRoot, 'emulator/bios.js'), 'utf8');

/** @type {import('jsdom').DOMWindow} */
let window;
/** @type {typeof window.emulatorBios} */
let bios;

before(() => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    runScripts: 'outside-only'
  });
  window = dom.window;
  window.eval(source);
  bios = window.emulatorBios;
  assert.ok(bios, 'emulatorBios should be exported');
});

describe('emulator biosIaUrl', () => {
  it('prefers biosIaBaseUrl over the game collection URL', () => {
    const url = bios.biosIaUrl({
      biosFileName: 'scph5501.bin',
      biosIaBaseUrl: 'https://archive.org/download/psx-bios',
      iaBaseUrl: 'https://archive.org/download/games'
    });
    assert.equal(url, 'https://archive.org/download/psx-bios/scph5501.bin');
  });

  it('uses biosIaFileName when the IA object path differs from the canonical name', () => {
    const url = bios.biosIaUrl({
      biosFileName: 'scph5501.bin',
      biosIaFileName: 'PlayStation Bios.zip/SCPH-7001.bin',
      biosIaBaseUrl: 'https://archive.org/download/psx-bios'
    });
    assert.equal(url, 'https://archive.org/download/psx-bios/PlayStation Bios.zip/SCPH-7001.bin');
  });

  it('falls back to iaBaseUrl when biosIaBaseUrl is absent and downloads are in-browser', () => {
    const url = bios.biosIaUrl({
      biosFileName: 'neogeo.zip',
      iaBaseUrl: 'https://archive.org/download/neogeo-bios/'
    });
    assert.equal(url, 'https://archive.org/download/neogeo-bios/neogeo.zip');
  });

  it('does not fall back to iaBaseUrl for external-download disc consoles', () => {
    const url = bios.biosIaUrl({
      biosFileName: 'scph5501.bin',
      iaBaseUrl: 'https://archive.org/download/ps1-games',
      iaExternalDownload: true
    });
    assert.equal(url, null);
  });

  it('picks the first truthy base when biosIaBaseUrl is an array', () => {
    const url = bios.biosIaUrl({
      biosFileName: 'scph5501.bin',
      biosIaBaseUrl: [null, '', 'https://archive.org/download/alt-bios']
    });
    assert.equal(url, 'https://archive.org/download/alt-bios/scph5501.bin');
  });

  it('returns null without a bios filename', () => {
    assert.equal(bios.biosIaUrl({ iaBaseUrl: 'https://archive.org/download/x' }), null);
    assert.equal(bios.biosIaUrl(null), null);
  });
});

describe('emulator normalizeBiosFile', () => {
  it('renames a generic upload to the canonical biosFileName', () => {
    const file = new window.File([new Uint8Array(64)], 'upload.bin', {
      type: 'application/octet-stream'
    });
    const out = bios.normalizeBiosFile(file, { id: 'neogeo', biosFileName: 'neogeo.zip' });
    assert.equal(out.name, 'neogeo.zip');
  });

  it('keeps an alternate PS1 region BIOS filename for pcsx_rearmed sniffing', () => {
    const file = new window.File([new Uint8Array(64)], 'scph5500.bin', {
      type: 'application/octet-stream'
    });
    const out = bios.normalizeBiosFile(file, {
      id: 'ps1',
      biosFileName: 'scph5501.bin'
    });
    assert.equal(out.name, 'scph5500.bin');
  });

  it('still renames a non-.bin PS1 upload to the canonical name', () => {
    const file = new window.File([new Uint8Array(64)], 'bios.dump', {
      type: 'application/octet-stream'
    });
    const out = bios.normalizeBiosFile(file, {
      id: 'ps1',
      biosFileName: 'scph5501.bin'
    });
    assert.equal(out.name, 'scph5501.bin');
  });

  it('returns the same File instance when the name already matches', () => {
    const file = new window.File([new Uint8Array(64)], 'neogeo.zip', {
      type: 'application/zip'
    });
    const out = bios.normalizeBiosFile(file, { id: 'neogeo', biosFileName: 'neogeo.zip' });
    assert.equal(out, file);
  });
});

describe('emulator looksLikeBiosPayload', () => {
  it('requires ZIP magic for .zip BIOS dumps', () => {
    const zip = new Uint8Array(128);
    zip[0] = 0x50;
    zip[1] = 0x4b;
    assert.equal(bios.looksLikeBiosPayload({ biosFileName: 'neogeo.zip' }, zip), true);
    assert.equal(
      bios.looksLikeBiosPayload({ biosFileName: 'neogeo.zip' }, new Uint8Array(128)),
      false
    );
  });

  it('enforces a size floor for .bin BIOS dumps', () => {
    const cfg = { biosFileName: 'scph5501.bin', biosMinBytes: 512 * 1024 };
    assert.equal(bios.looksLikeBiosPayload(cfg, new Uint8Array(100)), false);
    assert.equal(bios.looksLikeBiosPayload(cfg, new Uint8Array(512 * 1024)), true);
  });
});

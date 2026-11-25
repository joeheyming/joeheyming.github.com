// Pure helpers from emulator/bios.js: IA URL selection + normalize rules.
// Loaded as a classic IIFE into a JSDOM window (no IndexedDB / network).

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

/** Central directory plus end record. The parser never reads local file bytes. */
function storeZipCentralDirectory(entries) {
  const parts = entries.map((entry) => {
    const name = new TextEncoder().encode(entry.name);
    const hdr = new Uint8Array(46 + name.length);
    const view = new DataView(hdr.buffer);
    hdr[0] = 0x50;
    hdr[1] = 0x4b;
    hdr[2] = 0x01;
    hdr[3] = 0x02;
    view.setUint32(20, entry.size, true);
    view.setUint32(24, entry.size, true);
    view.setUint16(28, name.length, true);
    hdr.set(name, 46);
    return hdr;
  });
  const cdSize = parts.reduce((sum, part) => sum + part.length, 0);
  const eocd = new Uint8Array(22);
  const end = new DataView(eocd.buffer);
  eocd[0] = 0x50;
  eocd[1] = 0x4b;
  eocd[2] = 0x05;
  eocd[3] = 0x06;
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true);
  const out = new Uint8Array(cdSize + 22);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  out.set(eocd, offset);
  return out;
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(repoRoot, 'emulator/bios.js'), 'utf8');
const zipSource = readFileSync(join(repoRoot, 'emulator/bios-bundle.js'), 'utf8');

/** @type {import('jsdom').DOMWindow} */
let window;
/** @type {typeof window.emulatorBios} */
let bios;
/** @type {typeof window.emulatorBiosBundle} */
let biosZip;

before(() => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    runScripts: 'outside-only'
  });
  window = dom.window;
  window.eval(source);
  bios = window.emulatorBios;
  assert.ok(bios, 'emulatorBios should be exported');
});

describe('emulator BIOS bundle code loads on demand', () => {
  it('bios.js does not carry the bundle code, and refuses a bundle until it loads', () => {
    assert.doesNotMatch(source, /function packStoredZip|function zipEntries|function fetchBundle/);
    assert.match(source, /loadScript\('\/emulator\/bios-bundle\.js'\)/);
    const cfg = { biosFileName: 'dc.zip', biosEntries: ['dc/dc_boot.bin'] };
    const zip = new Uint8Array(64);
    zip[0] = 0x50;
    zip[1] = 0x4b;
    assert.equal(window.emulatorBiosBundle, undefined);
    assert.equal(bios.looksLikeBiosPayload(cfg, zip), false);
    window.eval(zipSource);
    biosZip = window.emulatorBiosBundle;
    assert.ok(biosZip, 'emulatorBiosBundle should be exported');
  });
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

  it('joins Saturn and Sega CD BIOS names with a real slash', () => {
    window.eval(readFileSync(join(repoRoot, 'emulator/consoles.js'), 'utf8'));
    const consoles = window.EMULATOR_CONSOLES;
    const saturn = bios.biosIaUrl(consoles.saturn);
    const segacd = bios.biosIaUrl(consoles.segacd);
    assert.equal(
      saturn,
      'https://archive.org/download/saturnbios/Sega%20Saturn%20Bios%20%28All%20Regions%29.zip/Sega Saturn Bios (All Regions)/Sega Saturn BIOS v1.00 (JAP).bin'
    );
    assert.equal(
      segacd,
      'https://archive.org/download/SEGACDBIOS/Sega%20Mega%20CD%20BIOS.zip/Sega Mega CD BIOS/Sega CD (U) - Model 1 v1.10 (1992).bin'
    );
    assert.equal(saturn.includes('%2F'), false);
    assert.equal(segacd.includes('%2F'), false);
  });

  it('packs the two Dreamcast BIOS dumps into the zip Flycast reads', () => {
    const text = new Uint8Array([49, 50, 51, 52, 53, 54, 55, 56, 57]);
    const sample = biosZip.packStoredZip([{ path: 'note.txt', bytes: text }]);
    const crc = new DataView(sample.buffer, sample.byteOffset, sample.byteLength).getUint32(
      14,
      true
    );
    assert.equal(crc, 0xcbf43926);
    const cfg = {
      biosFileName: 'dc.zip',
      biosIaBaseUrl: 'https://archive.org/download/dc_boot',
      biosIaFiles: [
        { remote: 'dc_boot.bin', path: 'dc/dc_boot.bin', size: 8 },
        { remote: 'dc_flash.bin', path: 'dc/dc_flash.bin', size: 4 }
      ],
      biosEntries: ['dc/dc_boot.bin', 'dc/dc_flash.bin'],
      biosEntrySizes: { 'dc/dc_boot.bin': 8, 'dc/dc_flash.bin': 4 }
    };
    assert.equal(bios.biosIaUrl(cfg), null);
    const files = bios.biosBundleFiles(cfg);
    assert.equal(files[0].url, 'https://archive.org/download/dc_boot/dc_boot.bin');
    assert.equal(files[0].path, 'dc/dc_boot.bin');
    assert.equal(files[0].size, 8);
    assert.equal(files[1].url, 'https://archive.org/download/dc_boot/dc_flash.bin');
    assert.equal(files[1].path, 'dc/dc_flash.bin');
    assert.equal(files[1].size, 4);
    const zip = biosZip.packStoredZip([
      { path: 'dc/dc_boot.bin', bytes: new Uint8Array(8) },
      { path: 'dc/dc_flash.bin', bytes: new Uint8Array(4) }
    ]);
    assert.equal(bios.looksLikeBiosPayload(cfg, zip), true);
  });

  it('accepts a Dreamcast BIOS zip only when both dumps are the right size', () => {
    const cfg = {
      biosFileName: 'dc.zip',
      biosEntries: ['dc/dc_boot.bin', 'dc/dc_flash.bin'],
      biosEntrySizes: { 'dc/dc_boot.bin': 2097152, 'dc/dc_flash.bin': 131072 }
    };
    const good = storeZipCentralDirectory([
      { name: 'BIOS/dc/dc_boot.bin', size: 2097152 },
      { name: 'BIOS/dc/dc_flash.bin', size: 131072 }
    ]);
    const short = storeZipCentralDirectory([
      { name: 'dc/dc_boot.bin', size: 100 },
      { name: 'dc/dc_flash.bin', size: 131072 }
    ]);
    const missing = storeZipCentralDirectory([{ name: 'dc/dc_boot.bin', size: 2097152 }]);
    assert.equal(bios.looksLikeBiosPayload(cfg, good), true);
    assert.equal(bios.looksLikeBiosPayload(cfg, short), false);
    assert.equal(bios.looksLikeBiosPayload(cfg, missing), false);
  });

  it('enforces a size floor for .bin BIOS dumps', () => {
    const cfg = { biosFileName: 'scph5501.bin', biosMinBytes: 512 * 1024 };
    assert.equal(bios.looksLikeBiosPayload(cfg, new Uint8Array(100)), false);
    assert.equal(bios.looksLikeBiosPayload(cfg, new Uint8Array(512 * 1024)), true);
  });
});

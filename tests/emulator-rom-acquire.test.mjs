// Shared ROM File naming from emulator/rom-acquire.js (fake bytes, no network).

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(repoRoot, 'emulator/rom-acquire.js'), 'utf8');

/** @type {typeof window.emulatorRomAcquire} */
let acquire;
/** @type {import('jsdom').DOMWindow} */
let window;

before(() => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    runScripts: 'outside-only'
  });
  window = dom.window;
  window.eval(source);
  acquire = window.emulatorRomAcquire;
  assert.ok(acquire, 'emulatorRomAcquire should be exported');
});

describe('emulator fileFromRomBytes', () => {
  it('names a zip collection entry title.zip with application/zip', () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
    const file = acquire.fileFromRomBytes(bytes, {
      title: 'Super Mario Bros',
      fileExtension: '.zip'
    });
    assert.equal(file.name, 'Super Mario Bros.zip');
    assert.equal(file.type, 'application/zip');
    assert.equal(file.size, 4);
  });

  it('preserves raw ROM extensions for gambatte-style collections', () => {
    const bytes = new Uint8Array([0xc0, 0xde]);
    const file = acquire.fileFromRomBytes(bytes, {
      title: 'Tetris',
      fileExtension: '.gb'
    });
    assert.equal(file.name, 'Tetris.gb');
    assert.equal(file.type, 'application/octet-stream');
  });

  it('defaults to .zip when the list entry omits fileExtension', () => {
    const file = acquire.fileFromRomBytes(new Uint8Array([1]), { title: 'Adventure' });
    assert.equal(file.name, 'Adventure.zip');
    assert.equal(file.type, 'application/zip');
  });

  it('falls back to rom.name when title is missing', () => {
    const file = acquire.fileFromRomBytes(new Uint8Array([1]), {
      name: 'metroid',
      fileExtension: '.nes'
    });
    assert.equal(file.name, 'metroid.nes');
  });
});

describe('emulator findRomByQuery', () => {
  const roms = [
    { name: 'smb', title: 'Super Mario Bros', fileExtension: '.zip' },
    { name: 'zelda', title: 'The Legend of Zelda', fileExtension: '.nes' }
  ];

  it('matches by exact name, title, or name+extension (case-insensitive)', () => {
    assert.equal(acquire.findRomByQuery(roms, 'smb'), roms[0]);
    assert.equal(acquire.findRomByQuery(roms, 'Super Mario Bros'), roms[0]);
    assert.equal(acquire.findRomByQuery(roms, 'zelda.nes'), roms[1]);
    assert.equal(acquire.findRomByQuery(roms, 'ZELDA'), roms[1]);
  });

  it('returns undefined for empty or unknown queries', () => {
    assert.equal(acquire.findRomByQuery(roms, ''), undefined);
    assert.equal(acquire.findRomByQuery(roms, 'missing'), undefined);
  });
});

describe('emulator createIaClient', () => {
  it('returns null without iaBaseUrl or InternetArchiveRoms', () => {
    assert.equal(acquire.createIaClient(null), null);
    assert.equal(acquire.createIaClient({ id: 'nes' }), null);
    assert.equal(
      acquire.createIaClient({ id: 'nes', iaBaseUrl: 'https://archive.org/download/x' }),
      null
    );
  });

  it('constructs InternetArchiveRoms with console cfg fields', () => {
    const calls = [];
    window.InternetArchiveRoms = function MockIa(opts) {
      // Copy into this realm — JSDOM Object literals fail deepStrictEqual across realms.
      calls.push({ ...opts, fileExtensions: [...(opts.fileExtensions || [])] });
      this.opts = opts;
    };
    const client = acquire.createIaClient({
      iaBaseUrl: 'https://archive.org/download/nes',
      iaDescriptionPrefix: 'NES',
      iaFileExtensions: ['.zip'],
      iaExcludeNames: ['readme'],
      iaBinaryTimeout: 90000,
      iaMaxRetries: 2,
      iaPreferMetadata: false
    });
    assert.ok(client);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], {
      baseUrl: 'https://archive.org/download/nes',
      descriptionPrefix: 'NES',
      fileExtensions: ['.zip'],
      excludeNames: ['readme'],
      binaryTimeout: 90000,
      maxRetries: 2,
      preferMetadata: false
    });
    delete window.InternetArchiveRoms;
  });
});

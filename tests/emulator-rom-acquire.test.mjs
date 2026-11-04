// Shared IA client construction and matching from emulator/rom-acquire.js.

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

describe('emulator thumbnailUrls', () => {
  it('builds a Named_Boxarts URL from the playlist and the ROM name', () => {
    // Copy out of the JSDOM realm; deepEqual rejects arrays born in another window.
    assert.deepEqual(
      [...acquire.thumbnailUrls(['Sega - Game Gear'], 'Sonic Blast (World)')],
      [
        'https://thumbnails.libretro.com/Sega%20-%20Game%20Gear/Named_Boxarts/Sonic%20Blast%20(World).png'
      ]
    );
  });

  it('replaces characters libretro will not store in a filename and keeps apostrophes', () => {
    const [url] = acquire.thumbnailUrls(
      ['Sega - Game Gear'],
      "Adventures of Batman & Robin, The (USA) / Knuckles' Chaotix"
    );
    assert.match(url, /Adventures%20of%20Batman%20_%20Robin/);
    assert.match(url, /Knuckles'%20Chaotix\.png$/);
    assert.doesNotMatch(url, /%26/);
  });

  it('returns one URL per playlist, in order', () => {
    const urls = acquire.thumbnailUrls(
      ['Nintendo - Game Boy', 'Nintendo - Game Boy Color'],
      'Tetris (World)'
    );
    assert.equal(urls.length, 2);
    assert.match(urls[0], /Nintendo%20-%20Game%20Boy\/Named_Boxarts/);
    assert.match(urls[1], /Game%20Boy%20Color\/Named_Boxarts\/Tetris%20\(World\)\.png$/);
  });

  it('returns nothing when the name or the playlist list is empty', () => {
    assert.deepEqual([...acquire.thumbnailUrls(['Sega - 32X'], '')], []);
    assert.deepEqual([...acquire.thumbnailUrls(['  '], 'Doom')], []);
    assert.deepEqual([...acquire.thumbnailUrls(undefined, 'Doom')], []);
  });
});

describe('emulator pickThumbnailName', () => {
  const names = [
    'Legend of Zelda, The (USA)',
    'Legend of Zelda, The (Europe)',
    'Legend of Zelda, The (USA) (Rev 1)',
    'Zelda II - The Adventure of Link (USA)',
    'ActRaiser (USA)',
    'ActRaiser 2 (USA)',
    '1942 (Japan)',
    '1942 (USA)',
    '1942 (Europe)',
    'Adventures of Batman _ Robin, The (USA, Europe, Brazil) (En)'
  ];

  it('folds accents so Einhander matches Einhänder', () => {
    assert.equal(
      acquire.pickThumbnailName('Einhander', ['Einhänder (USA)', 'Einhänder (Japan)']),
      'Einhänder (USA)'
    );
  });

  it('matches words regardless of article order and prefers retail USA', () => {
    assert.equal(
      acquire.pickThumbnailName('The Legend of Zelda', names),
      'Legend of Zelda, The (USA)'
    );
    assert.equal(acquire.pickThumbnailName('1942', names), '1942 (USA)');
    assert.equal(acquire.pickThumbnailName('ActRaiser', names), 'ActRaiser (USA)');
  });

  it('keeps a longer title when the extra word is part of the name', () => {
    assert.equal(
      acquire.pickThumbnailName('Zelda II - The Adventure of Link', names),
      'Zelda II - The Adventure of Link (USA)'
    );
  });

  it('treats a libretro underscore as the ampersand it replaced', () => {
    assert.equal(
      acquire.pickThumbnailName('Adventures of Batman & Robin, The', names),
      'Adventures of Batman _ Robin, The (USA, Europe, Brazil) (En)'
    );
  });

  it('returns null when no indexed name contains every word', () => {
    assert.equal(acquire.pickThumbnailName('completely unknown xyz', names), null);
    assert.deepEqual([...acquire.thumbnailTokens('The Legend of Zelda')], ['legend', 'zelda']);
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

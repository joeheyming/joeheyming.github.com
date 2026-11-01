// Metadata listings are the whole Archive item. The parser must keep every
// matching game file, including subfolders, and drop packaging zips.

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(repoRoot, 'emulator/internet-archive.js'), 'utf8');

/** @type {InstanceType<typeof window.InternetArchiveRoms>} */
let client;

before(() => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    runScripts: 'outside-only',
    url: 'https://archive.org/'
  });
  dom.window.eval(source);
  client = new dom.window.InternetArchiveRoms({
    baseUrl: 'https://archive.org/download/nes-collection',
    fileExtensions: ['.zip']
  });
});

describe('parseRomListFromMetadata', () => {
  const meta = {
    files_count: 6,
    files: [
      { name: 'Legend of Zelda, The.zip', size: 120000 },
      { name: 'Translations/Akira.zip', size: 80000 },
      { name: 'Rare Games/Banana.zip', size: 40000 },
      { name: 'BIOS/gbc_bios.zip', size: 512 },
      { name: 'Nintendo/Box Artwork/Themes/Default.zip', size: 9000 },
      { name: 'readme.txt', size: 100 }
    ]
  };

  it('keeps root games and game subfolders, and drops packaging', () => {
    const roms = client.parseRomListFromMetadata(
      meta,
      'https://archive.org/download/nes-collection',
      'https://ia800.example/0/items/nes-collection'
    );
    // Copy into this realm — a JSDOM array fails deepEqual even when the
    // names look identical.
    const names = Array.from(roms, (rom) => `${rom.name}`);
    assert.deepEqual(names, ['Akira', 'Banana', 'Legend of Zelda, The']);
    const zelda = roms.find((rom) => String(rom.name) === 'Legend of Zelda, The');
    assert.equal(
      String(zelda.downloadUrl),
      'https://ia800.example/0/items/nes-collection/Legend%20of%20Zelda%2C%20The.zip'
    );
    const akira = roms.find((rom) => String(rom.name) === 'Akira');
    assert.equal(
      String(akira.downloadUrl),
      'https://ia800.example/0/items/nes-collection/Translations/Akira.zip'
    );
  });

  it('warns when metadata files_count is larger than the files array', () => {
    const warnings = [];
    const orig = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
      client.parseRomListFromMetadata(
        { files_count: 10, files: [{ name: 'Metroid.zip', size: 1000 }] },
        'https://archive.org/download/nes-collection'
      );
    } finally {
      console.warn = orig;
    }
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /1 of 10/);
  });
});

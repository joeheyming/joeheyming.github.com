// Sheet library for /emulator/. Parsing stays network-free; the live
// gviz read is the same shape /watch/ uses and is checked by opening a
// console page once SHEET_ID points at a shared spreadsheet.

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(repoRoot, 'emulator/games-sheet.js'), 'utf8');

/** @type {Window & typeof globalThis} */
let window;

before(() => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    runScripts: 'outside-only',
    url: 'https://joeheyming.github.io/emulator/'
  });
  dom.window.eval(source);
  window = dom.window;
});

function sheet() {
  return window.emulatorGamesSheet;
}

function wrap(obj) {
  return `/*O_o*/\ngoogle.visualization.Query.setResponse(${JSON.stringify(obj)});`;
}

describe('games sheet configuration', () => {
  it('reads the shared games spreadsheet', () => {
    assert.equal(sheet().isConfigured(), true);
    assert.equal(sheet().__testing.SHEET_ID, '1qLJ3-k50ZvMmpxeO9C-72G9uat9BnYYezZC-nKmFzaY');
    const url = new URL(sheet().buildGvizUrl('games'));
    assert.ok(url.pathname.includes(sheet().__testing.SHEET_ID));
    assert.equal(url.searchParams.get('sheet'), 'games');
  });

  it('builds a per-console gviz query once an id is set', () => {
    sheet().__testing.setSheetId('sheet-id-example');
    try {
      assert.equal(sheet().isConfigured(), true);
      const url = new URL(sheet().buildGvizUrl('games', "select * where A = 'nes'"));
      assert.equal(url.hostname, 'docs.google.com');
      assert.ok(url.pathname.includes('sheet-id-example'));
      assert.equal(url.searchParams.get('sheet'), 'games');
      assert.equal(url.searchParams.get('tqx'), 'out:json');
      assert.equal(url.searchParams.get('headers'), '1');
      assert.equal(url.searchParams.get('tq'), "select * where A = 'nes'");
    } finally {
      sheet().__testing.setSheetId(sheet().__testing.SHEET_ID);
    }
  });

  it('escapes quotes in the console filter', () => {
    assert.equal(sheet().escapeSqlValue("o'brien"), "o''brien");
  });
});

describe('gameFromRow', () => {
  const row = {
    console: 'nes',
    name: 'Legend of Zelda, The',
    downloadUrl: 'https://archive.org/download/nes-collection/Legend%20of%20Zelda%2C%20The.zip',
    thumbnailUrl:
      'https://thumbnails.libretro.com/Nintendo%20-%20Nintendo%20Entertainment%20System/Named_Boxarts/Legend%20of%20Zelda%2C%20The%20(USA).png',
    fileExtension: '.zip',
    size: '1.2 MB'
  };

  it('keeps the file and thumbnail urls and the sheet name', () => {
    const game = sheet().gameFromRow(row, {
      consoleId: 'nes',
      descriptionPrefix: 'Classic NES game'
    });
    assert.equal(game.name, 'Legend of Zelda, The');
    assert.equal(game.title, 'Legend of Zelda, The');
    assert.equal(game.downloadUrl, row.downloadUrl);
    assert.equal(game.thumbnailUrl, row.thumbnailUrl);
    assert.equal(game.fileExtension, '.zip');
    assert.equal(game.size, '1.2 MB');
    assert.equal(game.description, 'Classic NES game: Legend of Zelda, The');
  });

  it('drops rows for other consoles, bad urls, and missing names', () => {
    assert.equal(sheet().gameFromRow(row, { consoleId: 'snes' }), null);
    assert.equal(
      sheet().gameFromRow({ ...row, downloadUrl: 'javascript:alert(1)' }, { consoleId: 'nes' }),
      null
    );
    assert.equal(
      sheet().gameFromRow(
        { ...row, thumbnailUrl: 'http://insecure.example/a.png' },
        { consoleId: 'nes' }
      ).thumbnailUrl,
      ''
    );
    assert.equal(sheet().gameFromRow({ ...row, name: '  ' }, { consoleId: 'nes' }), null);
  });

  it('keeps an inline base64 image as the thumbnail, and refuses other data urls', () => {
    const uri = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
    assert.equal(
      sheet().gameFromRow({ ...row, thumbnailUrl: uri }, { consoleId: 'nes' }).thumbnailUrl,
      uri
    );
    assert.equal(
      sheet().gameFromRow(
        { ...row, thumbnailUrl: 'data:text/html;base64,PGgxPg==' },
        { consoleId: 'nes' }
      ).thumbnailUrl,
      ''
    );
    assert.equal(
      sheet().gameFromRow(
        { ...row, thumbnailUrl: 'data:image/svg+xml;base64,PHN2Zz4=' },
        { consoleId: 'nes' }
      ).thumbnailUrl,
      ''
    );
  });

  it('reads the extension from the file url when the cell is empty', () => {
    const game = sheet().gameFromRow({ ...row, fileExtension: '' }, { consoleId: 'nes' });
    assert.equal(game.fileExtension, '.zip');
    const chd = sheet().gameFromRow(
      {
        ...row,
        console: 'ps1',
        fileExtension: null,
        downloadUrl: 'https://archive.org/download/CuratedPSXRedumpCHDs/Metal%20Gear%20Solid.chd'
      },
      { consoleId: 'ps1' }
    );
    assert.equal(chd.fileExtension, '.chd');
  });
});

describe('gviz table', () => {
  it('maps header labels onto row objects and skips empty rows', () => {
    const table = sheet().parseGvizResponse(
      wrap({
        status: 'ok',
        table: {
          cols: [
            { label: 'console' },
            { label: 'name' },
            { label: 'downloadUrl' },
            { label: 'thumbnailUrl' },
            { label: 'fileExtension' },
            { label: 'size' }
          ],
          rows: [
            {
              c: [
                { v: 'gb' },
                { v: 'Tetris' },
                { v: 'https://archive.org/download/example/Tetris.zip' },
                { v: '' },
                { v: '.zip' },
                { v: '32.0 KB' }
              ]
            },
            { c: [null, null, null, null, null, null] }
          ]
        }
      })
    );
    const rows = sheet().rowsToObjects(table);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, 'Tetris');
    assert.equal(rows[0].thumbnailUrl, '');
  });

  it('surfaces a gviz error status', () => {
    assert.throws(
      () =>
        sheet().parseGvizResponse(
          wrap({ status: 'error', errors: [{ detailed_message: 'no such sheet' }] })
        ),
      /no such sheet/
    );
  });
});

describe('loadConsoleGames', () => {
  it('requests one console and skips a row that cannot be played', async () => {
    sheet().__testing.setSheetId('sheet-id-example');
    sheet().clearCache();
    const payload = wrap({
      status: 'ok',
      table: {
        cols: [
          { label: 'console' },
          { label: 'name' },
          { label: 'downloadUrl' },
          { label: 'thumbnailUrl' },
          { label: 'fileExtension' },
          { label: 'size' }
        ],
        rows: [
          {
            c: [
              { v: 'nes' },
              { v: 'Metroid' },
              { v: 'https://archive.org/download/nes-collection/Metroid.zip' },
              { v: 'https://thumbnails.libretro.com/pack/Named_Boxarts/Metroid.png' },
              { v: '.zip' },
              { v: '128.0 KB' }
            ]
          },
          {
            c: [{ v: 'nes' }, { v: 'Broken' }, { v: '' }, { v: '' }, { v: '.zip' }, { v: '' }]
          },
          {
            c: [
              { v: 'snes' },
              { v: 'Other' },
              { v: 'https://archive.org/download/snes/Other.zip' },
              { v: '' },
              { v: '.zip' },
              { v: '1 MB' }
            ]
          }
        ]
      }
    });
    /** @type {string[]} */
    const urls = [];
    window.fetch = async (url) => {
      urls.push(String(url));
      return { ok: true, text: async () => payload };
    };
    try {
      const games = await sheet().loadConsoleGames('nes', {
        descriptionPrefix: 'Classic NES game'
      });
      assert.equal(games.length, 1);
      assert.equal(games[0].name, 'Metroid');
      assert.equal(games[0].thumbnailUrl.includes('Metroid.png'), true);
      assert.equal(urls.length, 1);
      assert.equal(new URL(urls[0]).searchParams.get('tq'), "select * where A = 'nes'");
      const again = await sheet().loadConsoleGames('nes');
      assert.equal(again, games);
      assert.equal(urls.length, 1);
    } finally {
      sheet().__testing.setSheetId(sheet().__testing.SHEET_ID);
      sheet().clearCache();
    }
  });

  it('uses the first worksheet when the games tab is missing', async () => {
    sheet().__testing.setSheetId('sheet-id-example');
    sheet().clearCache();
    const payload = wrap({
      status: 'ok',
      table: {
        cols: [
          { label: 'console' },
          { label: 'name' },
          { label: 'downloadUrl' },
          { label: 'thumbnailUrl' },
          { label: 'fileExtension' },
          { label: 'size' }
        ],
        rows: [
          {
            c: [
              { v: 'nes' },
              { v: 'Metroid' },
              { v: 'https://archive.org/download/nes-collection/Metroid.zip' },
              { v: '' },
              { v: '.zip' },
              { v: '128.0 KB' }
            ]
          }
        ]
      }
    });
    /** @type {string[]} */
    const urls = [];
    window.fetch = async (url) => {
      urls.push(String(url));
      if (urls.length === 1) return { ok: false, status: 400, text: async () => '' };
      return { ok: true, text: async () => payload };
    };
    try {
      const games = await sheet().loadConsoleGames('nes');
      assert.equal(games.length, 1);
      assert.equal(games[0].name, 'Metroid');
      assert.match(urls[0], /sheet=games/);
      assert.equal(new URL(urls[1]).searchParams.get('sheet'), null);
    } finally {
      sheet().__testing.setSheetId(sheet().__testing.SHEET_ID);
      sheet().clearCache();
    }
  });
});

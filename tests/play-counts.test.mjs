import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import {
  CONFIG,
  applyCounts,
  cleanName,
  consoleIdFromPath,
  countsFromGvizText,
  episodeId,
  formBody,
  gameId,
  isConfigured,
  isLocalDevHost,
  isRecordable,
  paintShadow,
  playsForDoom,
  playsForEmulator,
  playsForWatch,
  slugPart,
  submitPlays,
  topCounts
} from '../analytics/counts.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const UNWIRED = {
  ...CONFIG,
  formActionUrl: 'https://docs.google.com/forms/d/e/YOUR_FORM_ID/formResponse',
  sheetId: 'YOUR_SHEET_ID'
};

test('the shipped config points at the analytics form and sheet', () => {
  assert.equal(isConfigured(CONFIG), true);
  assert.equal(isConfigured(UNWIRED), false);
  assert.equal(
    isConfigured({ ...CONFIG, formActionUrl: 'https://example.test/formResponse' }),
    true
  );
  assert.equal(
    isConfigured({ ...CONFIG, entryIds: { ...CONFIG.entryIds, app: 'entry.111111111' } }),
    false
  );
});

test('local and dev hosts do not record plays', () => {
  assert.equal(isLocalDevHost('localhost'), true);
  assert.equal(isLocalDevHost('127.0.0.1'), true);
  assert.equal(isLocalDevHost('joeheyming.github.io'), false);
  assert.equal(isLocalDevHost('joeheyming.github.io', 'HeadlessChrome'), true);
});

test('apps opt in to play counts through heymingAnalytics.enable', () => {
  const analytics = readFileSync(path.join(ROOT, 'analytics.js'), 'utf8');
  assert.match(analytics, /window\.heymingAnalytics = \{/);
  assert.match(analytics, /'play-counts': '\/analytics\/counts\.mjs'/);
  assert.doesNotMatch(analytics, /emulator\|doom\|watch/);
  assert.doesNotMatch(analytics, /recordEmulatorPlay/);
  for (const file of [
    'emulator/launch.js',
    'doom/flavor-controller.js',
    'watch/index.js',
    'analytics/index.html'
  ]) {
    const src = readFileSync(path.join(ROOT, file), 'utf8');
    assert.match(src, /enable\(['"]play-counts['"]\)/, file);
  }
});

test('game and episode ids stay stable across filename noise', () => {
  assert.equal(slugPart('Super Mario World.sfc'), 'super-mario-world');
  assert.equal(gameId('SNES', 'Super Mario World.sfc'), 'snes:super-mario-world');
  assert.equal(episodeId('Seinfeld', 5, 3), 'seinfeld|s05e03');
  assert.equal(cleanName('  A\nTitle  '), 'A Title');
  assert.equal(consoleIdFromPath('/emulator/nes/'), 'nes');
  assert.equal(consoleIdFromPath('/emulator/nes/index.html'), 'nes');
  assert.equal(consoleIdFromPath('/emulator/'), '');
  assert.equal(consoleIdFromPath('/emulator/index.html'), '');
});

test('one emulator start records the console and the game', () => {
  const plays = playsForEmulator('snes', 'Super Mario World.sfc', {
    snes: { title: 'SNES' }
  });
  assert.deepEqual(
    plays.map((play) => play.kind + ':' + play.id),
    ['console:snes', 'game:snes:super-mario-world']
  );
  assert.equal(plays[1].parent, 'snes');
  assert.equal(plays[1].name, 'Super Mario World');
});

test('doom and watch plays use the public title', () => {
  const doom = playsForDoom('mario', [{ id: 'mario', title: 'Mario DOOM' }]);
  assert.equal(doom[0].name, 'Mario DOOM');
  assert.equal(doom[0].kind, 'flavor');

  const movie = playsForWatch({ movie: true, id: 'the-matrix', name: 'The Matrix' });
  assert.deepEqual(
    movie.map((play) => play.kind),
    ['movie']
  );

  const show = playsForWatch({
    id: 'seinfeld',
    name: 'Seinfeld',
    season: 5,
    episode: 3,
    episodeTitle: 'The Marine Biologist'
  });
  assert.deepEqual(
    show.map((play) => play.kind),
    ['show', 'episode']
  );
  assert.equal(show[1].id, 'seinfeld|s05e03');
  assert.equal(show[1].parent, 'seinfeld');
  assert.match(show[1].name, /S05E03/);
});

test('submits leave the honeypot empty and skip a local or unwired form', () => {
  const play = playsForDoom('classic', [{ id: 'classic', title: 'Classic DOOM' }])[0];
  const calls = [];
  const wired = {
    ...CONFIG,
    formActionUrl: 'https://docs.google.com/forms/d/e/abc/formResponse',
    sheetId: 'sheet',
    entryIds: {
      app: 'entry.1',
      kind: 'entry.2',
      id: 'entry.3',
      name: 'entry.4',
      parent: 'entry.5',
      honeypot: 'entry.6'
    }
  };
  assert.equal(
    submitPlays([play], {
      config: UNWIRED,
      isLocal: false,
      fetchImpl: () => {
        calls.push('no');
        return Promise.resolve();
      }
    }),
    0
  );
  assert.equal(calls.length, 0);
  assert.equal(
    submitPlays([play], {
      config: wired,
      isLocal: true,
      fetchImpl: () => {
        calls.push('local');
        return Promise.resolve();
      }
    }),
    0
  );
  assert.equal(
    submitPlays([play], {
      config: wired,
      isLocal: false,
      fetchImpl: (_url, init) => {
        calls.push(init.body);
        return Promise.resolve();
      }
    }),
    1
  );
  const body = calls[0];
  assert.equal(body.get('entry.6'), '');
  assert.equal(body.get('entry.1'), 'doom');
  assert.equal(body.get('entry.3'), 'classic');
  assert.equal(isRecordable({ ...play, id: 'Has Spaces' }), false);
  assert.equal(formBody(wired.entryIds, play).get('entry.5'), '');
});

test('gviz rows become ranked counts and ignore the header', () => {
  const text =
    'google.visualization.Query.setResponse({"table":{"cols":[' +
    '{"label":"app"},{"label":"kind"},{"label":"id"},{"label":"name"},{"label":"parent"},{"label":"count"}],' +
    '"rows":[{"c":[{"v":"app"},{"v":"kind"},{"v":"id"},{"v":"name"},{"v":"parent"},{"v":"count"}]},' +
    '{"c":[{"v":"emulator"},{"v":"game"},{"v":"nes:mario"},{"v":"Mario"},{"v":"nes"},{"v":2}]},' +
    '{"c":[{"v":"emulator"},{"v":"game"},{"v":"snes:zelda"},{"v":"Zelda"},{"v":"snes"},{"v":9}]},' +
    '{"c":[{"v":"nope"},{"v":"game"},{"v":"x"},{"v":"X"},{"v":""},{"v":4}]}]}});';
  const rows = countsFromGvizText(text);
  assert.equal(rows.length, 2);
  assert.deepEqual(
    topCounts(rows, { app: 'emulator', kind: 'game' }).map((row) => row.id),
    ['snes:zelda', 'nes:mario']
  );
  assert.deepEqual(
    topCounts(rows, { app: 'emulator', kind: 'game', parent: 'nes' }).map((row) => row.name),
    ['Mario']
  );
});

test('badges and top lists render counts and a second pass does not duplicate them', () => {
  const dom = new JSDOM(`<!doctype html><body>
    <div id="boot-card">
      <div class="picker-grid">
        <a class="picker-tile" href="/emulator/nes/"><span class="picker-title">NES</span></a>
      </div>
    </div>
    <button class="flavor-card" data-flavor="mario" aria-label="Launch Mario DOOM"><span class="name">Mario</span></button>
    <a class="tv-show-card" data-show="seinfeld"><div class="tv-show-meta"></div></a>
    <a class="tv-show-card" data-movie="the-matrix"><div class="tv-show-meta"></div></a>
    <button class="tv-ep-card" data-season="5" data-episode="3"><div class="tv-ep-meta"></div></button>
    <section data-play-board data-app="doom" data-kind="flavor"><h2>Top</h2><ol></ol><p class="empty" hidden></p></section>
    <div id="roms" console="snes"><button class="rom-card"><div class="rom-title">Zelda</div></button></div>
  </body>`);
  const doc = dom.window.document;
  const counts = [
    { app: 'emulator', kind: 'console', id: 'nes', name: 'NES', parent: '', count: 4 },
    { app: 'emulator', kind: 'game', id: 'snes:zelda', name: 'Zelda', parent: 'snes', count: 9 },
    { app: 'emulator', kind: 'game', id: 'nes:mario', name: 'Mario', parent: 'nes', count: 2 },
    { app: 'doom', kind: 'flavor', id: 'mario', name: 'Mario DOOM', parent: '', count: 7 },
    { app: 'watch', kind: 'show', id: 'seinfeld', name: 'Seinfeld', parent: '', count: 3 },
    { app: 'watch', kind: 'movie', id: 'the-matrix', name: 'The Matrix', parent: '', count: 5 },
    {
      app: 'watch',
      kind: 'episode',
      id: 'seinfeld|s05e03',
      name: 'Seinfeld S05E03',
      parent: 'seinfeld',
      count: 1
    }
  ];
  const env = {
    path: '/emulator/',
    search: '?show=seinfeld',
    consoles: { nes: { title: 'NES' }, snes: { title: 'SNES' } },
    configured: true,
    ready: true
  };
  applyCounts(doc, counts, env);
  applyCounts(doc, counts, env);
  assert.equal(doc.querySelector('.picker-tile .play-count').textContent, '4');
  assert.equal(doc.querySelector('.picker-tile .play-count').getAttribute('aria-label'), '4 plays');
  assert.equal(doc.querySelectorAll('.picker-tile .play-count').length, 1);
  assert.equal(doc.querySelector('.flavor-card .play-count').textContent, '7');
  assert.equal(
    doc.querySelector('.flavor-card').getAttribute('aria-label'),
    'Launch Mario DOOM, 7 plays'
  );
  assert.equal(doc.querySelector('[data-show] .play-count').textContent, '3');
  assert.equal(doc.querySelector('[data-movie] .play-count').textContent, '5');
  assert.equal(doc.querySelector('.tv-ep-card .play-count').textContent, '1');
  const games = [...doc.querySelectorAll('#play-top-games li .play-top-name')].map(
    (node) => node.textContent
  );
  assert.deepEqual(games, ['Zelda', 'Mario']);
  assert.equal(doc.querySelector('#play-top-games .play-top-meta').textContent, 'SNES');
  assert.equal(doc.querySelector('[data-play-board] li .play-top-name').textContent, 'Mario DOOM');
  assert.equal(doc.querySelector('[data-play-board] .empty').hidden, true);

  paintShadow(doc.getElementById('roms'), counts);
  paintShadow(doc.getElementById('roms'), counts);
  assert.equal(doc.querySelector('.rom-card .play-count').textContent, '9');
  assert.equal(doc.querySelectorAll('.rom-card .play-count').length, 1);

  applyCounts(doc, counts, { ...env, path: '/emulator/nes/' });
  assert.equal(doc.getElementById('play-top-games'), null);
  assert.deepEqual(
    [...doc.querySelectorAll('#play-top-console li .play-top-name')].map(
      (node) => node.textContent
    ),
    ['Mario']
  );
});

test('a zero count stays off the card and an empty board says so', () => {
  const dom = new JSDOM(`<!doctype html><body>
    <a class="picker-tile" data-console="nes"></a>
    <section data-play-board data-app="watch" data-kind="movie"><ol></ol><p class="empty" hidden></p></section>
    <p id="play-counts-setup" hidden></p>
  </body>`);
  const doc = dom.window.document;
  applyCounts(doc, [], {
    path: '/watch/',
    search: '',
    consoles: {},
    configured: false,
    ready: true
  });
  assert.equal(doc.querySelector('.play-count'), null);
  assert.equal(doc.querySelector('.empty').hidden, true);
  assert.equal(doc.getElementById('play-counts-setup').hidden, false);
});

test('call sites record a play next to the existing analytics event', () => {
  const launch = readFileSync(path.join(ROOT, 'emulator/launch.js'), 'utf8');
  const doom = readFileSync(path.join(ROOT, 'doom/flavor-controller.js'), 'utf8');
  const watch = readFileSync(path.join(ROOT, 'watch/modules/views/watch-view.js'), 'utf8');
  const roms = readFileSync(path.join(ROOT, 'emulator/rom-browser.js'), 'utf8');
  assert.match(launch, /recordEmulatorPlay\(cfg\.id,\s*playingTitle\)/);
  assert.match(roms, /recordEmulatorPlay\(cfg\.id,\s*rom\.title \|\| rom\.name\)/);
  assert.match(doom, /recordDoomPlay\(flavor\)/);
  assert.match(watch, /recordWatchPlay/);
  assert.match(roms, /paintShadow\(this\.shadowRoot\)/);
});

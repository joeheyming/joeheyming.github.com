import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import {
  CONFIG,
  applyCounts,
  bindPlayTips,
  cleanName,
  rememberEmulatorPlay,
  readRecentEmulator,
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
  playsForStepmania,
  playsForWatch,
  slugPart,
  submitPlays,
  topCounts
} from '../analytics/counts.mjs';
import {
  isZeniusPlaceholder,
  lookupZeniusTitles,
  zeniusSimfileId,
  zeniusSongName,
  zeniusTitleFromHtml
} from '../analytics/zenius-titles.mjs';

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
    <div id="boot">
      <div id="boot-card">
        <div class="picker-grid">
          <a class="picker-tile" href="/emulator/nes/"><span class="picker-title">NES</span></a>
        </div>
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
  assert.equal(doc.querySelector('.picker-tile .play-count').dataset.tip, 'Started 4 times');
  assert.equal(doc.querySelector('.picker-tile .play-count').hasAttribute('title'), false);
  assert.equal(doc.querySelector('#play-top-games .play-count').dataset.tip, 'Started 9 times');
  assert.equal(doc.querySelector('.flavor-card .play-count').dataset.tip, 'Started 7 times');
  assert.equal(doc.querySelector('[data-show] .play-count').dataset.tip, 'Started 3 times');
  assert.equal(doc.querySelector('.tv-ep-card .play-count').dataset.tip, 'Started 1 time');
  assert.equal(doc.querySelector('[data-play-board] .play-count').dataset.tip, 'Started 7 times');
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
  assert.equal(
    doc.querySelector('#play-top-games a').getAttribute('href'),
    '/emulator/snes/?rom=Zelda'
  );
  assert.equal(doc.querySelector('#play-top-games .play-top-meta').textContent, 'SNES');
  assert.equal(doc.getElementById('play-top-games').parentElement.id, 'boot');
  assert.equal(doc.querySelector('#boot-card #play-top-games'), null);
  assert.equal(doc.querySelector('[data-play-board] li .play-top-name').textContent, 'Mario DOOM');
  assert.equal(
    doc.querySelector('[data-play-board] a').getAttribute('href'),
    '/doom/?flavor=mario'
  );
  assert.equal(
    doc.querySelector('[data-play-board] a').getAttribute('data-play-link'),
    'analytics'
  );
  assert.equal(
    doc.querySelector('[data-play-board] a').getAttribute('data-play-name'),
    'Mario DOOM'
  );
  assert.equal(doc.querySelector('[data-play-board] .empty').hidden, true);

  paintShadow(doc.getElementById('roms'), counts);
  paintShadow(doc.getElementById('roms'), counts);
  assert.equal(doc.querySelector('.rom-card .play-count').textContent, '9');
  assert.equal(doc.querySelector('.rom-card .play-count').dataset.tip, 'Started 9 times');
  assert.equal(doc.querySelectorAll('.rom-card .play-count').length, 1);

  applyCounts(doc, counts, { ...env, path: '/emulator/nes/' });
  assert.equal(doc.getElementById('play-top-games'), null);
  assert.deepEqual(
    [...doc.querySelectorAll('#play-top-console li .play-top-name')].map(
      (node) => node.textContent
    ),
    ['Mario']
  );
  assert.equal(
    doc.querySelector('#play-top-console a').getAttribute('href'),
    '/emulator/nes/?rom=Mario'
  );
  assert.equal(
    doc.querySelector('#play-top-console a').getAttribute('data-play-link'),
    'play-top-console'
  );
});

test('the hub lists ten games and a console page parks its list in the scroll panel', () => {
  const counts = Array.from({ length: 12 }, (_, index) => ({
    app: 'emulator',
    kind: 'game',
    id: `nes:game-${index}`,
    name: `Game ${index}`,
    parent: 'nes',
    count: 20 - index
  }));
  const dom = new JSDOM(`<!doctype html><body>
    <div id="boot">
      <div id="boot-card">
        <div class="picker-grid"></div>
        <div class="boot-card-scroll"><rom-browser console="nes"></rom-browser></div>
      </div>
    </div>
  </body>`);
  const doc = dom.window.document;
  const env = {
    consoles: { nes: { title: 'NES' } },
    configured: true,
    ready: true
  };
  applyCounts(doc, counts, { ...env, path: '/emulator/' });
  assert.equal(doc.querySelectorAll('#play-top-games li').length, 10);
  applyCounts(doc, counts, { ...env, path: '/emulator/nes/' });
  assert.equal(doc.querySelectorAll('#play-top-console li').length, 10);
  assert.equal(doc.getElementById('play-top-console').parentElement.className, 'boot-card-scroll');
});

test('a console page puts this browser’s recent games above the shared starts', () => {
  const storage = {
    /** @type {Map<string, string>} */
    values: new Map(),
    /** @param {string} key */
    getItem(key) {
      return this.values.has(key) ? this.values.get(key) : null;
    },
    /**
     * @param {string} key
     * @param {string} value
     */
    setItem(key, value) {
      this.values.set(key, value);
    }
  };
  rememberEmulatorPlay(
    storage,
    'n64',
    'Legend of Zelda, The - Ocarina of Time (Europe) (En,Fr,De)'
  );
  rememberEmulatorPlay(storage, 'nes', 'Metroid');
  rememberEmulatorPlay(storage, 'n64', 'Super Mario 64 (USA)');
  rememberEmulatorPlay(storage, 'n64', 'Super Mario 64 (USA)');
  const saved = readRecentEmulator(storage);
  assert.deepEqual(
    saved.map((entry) => `${entry.console}:${entry.title}`),
    [
      'n64:Super Mario 64 (USA)',
      'nes:Metroid',
      'n64:Legend of Zelda, The - Ocarina of Time (Europe) (En,Fr,De)'
    ]
  );

  const counts = [
    {
      app: 'emulator',
      kind: 'game',
      id: 'n64:super-mario-64-usa',
      name: 'Super Mario 64 (USA)',
      parent: 'n64',
      count: 10
    },
    {
      app: 'emulator',
      kind: 'game',
      id: 'n64:goldeneye',
      name: '007 - GoldenEye (USA)',
      parent: 'n64',
      count: 5
    }
  ];
  const dom = new JSDOM(`<!doctype html><body>
    <div id="boot"><div class="boot-card-scroll"><rom-browser console="n64"></rom-browser></div></div>
  </body>`);
  const doc = dom.window.document;
  const env = {
    path: '/emulator/n64/',
    consoles: { n64: { title: 'Nintendo 64' }, nes: { title: 'NES' } },
    recent: saved,
    configured: true,
    ready: true
  };
  applyCounts(doc, counts, env);
  assert.deepEqual(
    [...doc.querySelectorAll('#play-top-console .play-top-recent .play-top-name')].map(
      (node) => node.textContent
    ),
    ['Super Mario 64 (USA)', 'Legend of Zelda, The - Ocarina of Time (Europe) (En,Fr,De)']
  );
  assert.equal(
    doc.querySelector('#play-top-console .play-top-recent a').getAttribute('href'),
    '/emulator/n64/?rom=Super%20Mario%2064%20(USA)'
  );
  assert.equal(
    doc.querySelector('#play-top-console .play-top-recent .play-count').textContent,
    '10'
  );
  assert.deepEqual(
    [...doc.querySelectorAll('#play-top-console > ol .play-top-name')].map(
      (node) => node.textContent
    ),
    ['Super Mario 64 (USA)', '007 - GoldenEye (USA)']
  );

  applyCounts(doc, [], { ...env, path: '/emulator/', recent: saved });
  const hub = new JSDOM(`<!doctype html><body>
    <div id="boot"><div class="picker-grid"></div></div>
  </body>`);
  applyCounts(hub.window.document, [], {
    path: '/emulator/',
    consoles: env.consoles,
    recent: saved,
    configured: true,
    ready: true
  });
  assert.equal(hub.window.document.querySelector('#play-top-games > h3').hidden, true);
  assert.equal(
    hub.window.document.querySelector('#play-top-games .play-top-meta').textContent,
    'Nintendo 64'
  );
  assert.equal(
    hub.window.document.querySelectorAll('#play-top-games .play-top-recent li').length,
    3
  );
});

test('doom does not get the emulator start list', () => {
  const counts = [
    {
      app: 'emulator',
      kind: 'game',
      id: 'nes:mario',
      name: 'Super Mario Bros.',
      parent: 'nes',
      count: 26
    },
    { app: 'doom', kind: 'flavor', id: 'classic', name: 'Classic DOOM', parent: '', count: 9 }
  ];
  const dom = new JSDOM(`<!doctype html><body>
    <div class="overlay" id="boot">
      <p class="picker-lead">Pick a game.</p>
      <button class="flavor-card" data-flavor="classic" aria-label="Launch Classic DOOM"></button>
    </div>
  </body>`);
  const doc = dom.window.document;
  applyCounts(doc, counts, { path: '/doom/', configured: true, ready: true });
  assert.equal(doc.getElementById('play-top-games'), null);
  assert.equal(doc.querySelector('.flavor-card .play-count').textContent, '9');
});

test('a play count tip shows as soon as the pointer is on the number', () => {
  const dom = new JSDOM(`<!doctype html><body>
    <div id="host"></div>
  </body>`);
  const doc = dom.window.document;
  const root = doc.getElementById('host').attachShadow({ mode: 'open' });
  const badge = doc.createElement('span');
  badge.className = 'play-count';
  badge.dataset.tip = 'Started 9 times';
  badge.textContent = '9';
  root.appendChild(badge);
  bindPlayTips(doc);
  const Hover = dom.window.PointerEvent || dom.window.MouseEvent;
  badge.dispatchEvent(new Hover('pointerover', { bubbles: true, composed: true }));
  const tip = doc.querySelector('.play-count-tip');
  assert.equal(tip.hidden, false);
  assert.equal(tip.textContent, 'Started 9 times');
  badge.dispatchEvent(new Hover('pointerout', { bubbles: true, composed: true }));
  assert.equal(tip.hidden, true);
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

test('each stepmania song counts on its own, keyed by song key and title', () => {
  const first = playsForStepmania('zenius_12345', 'Gangnam Style');
  const second = playsForStepmania('zenius_67890', 'Gangnam Style');
  assert.equal(first.length, 1);
  assert.deepEqual(first[0], {
    app: 'stepmania',
    kind: 'song',
    id: 'zenius-12345',
    name: 'Gangnam Style',
    parent: ''
  });
  assert.notEqual(first[0].id, second[0].id);
  assert.ok(isRecordable(first[0]));
  assert.deepEqual(playsForStepmania('', 'Nameless'), []);
  assert.equal(playsForStepmania('file_song-name.zip', '')[0].name, 'file-song-name');
  assert.equal(playsForStepmania('file_song-name.zip', 'Song Name.zip')[0].name, 'Song Name');
});

test('a zenius id looks up the song title on the simfile page and remembers it', async () => {
  assert.equal(zeniusSimfileId('zenius 26360'), '26360');
  assert.equal(zeniusSimfileId('zenius-26360'), '26360');
  assert.equal(zeniusSimfileId('zenius_26360'), '26360');
  assert.equal(isZeniusPlaceholder('zenius 26360', 'zenius-26360'), '26360');
  assert.equal(isZeniusPlaceholder('Max 300', 'zenius-26360'), '');
  assert.equal(zeniusTitleFromHtml('<h1>Max &amp; 300</h1>'), 'Max & 300');

  const memory = new Map();
  let fetches = 0;
  const fetchText = async (url) => {
    fetches += 1;
    assert.match(url, /simfileid=26360$/);
    return '<h1>Max 300</h1>';
  };
  assert.equal(
    await zeniusSongName('zenius 26360', { fetchText, memory, storage: null }),
    'Max 300'
  );
  assert.equal(
    await zeniusSongName('zenius-26360', { fetchText, memory, storage: null }),
    'Max 300'
  );
  assert.equal(fetches, 1);
  const again = await lookupZeniusTitles(['26360'], { fetchText, memory, storage: null });
  assert.equal(again.get('26360'), 'Max 300');
  assert.equal(fetches, 1);
});

test('the stepmania board uses a remembered zenius title', async () => {
  await lookupZeniusTitles(['424242'], {
    fetchText: async () => '<h1>Paranoia</h1>',
    storage: null
  });
  const dom = new JSDOM(
    '<!doctype html><body><section data-play-board data-app="stepmania" data-kind="song"><h2>Songs</h2><ol></ol><p class="empty" hidden></p></section></body>'
  );
  applyCounts(
    dom.window.document,
    [
      {
        app: 'stepmania',
        kind: 'song',
        id: 'zenius-424242',
        name: 'zenius 424242',
        parent: '',
        count: 4
      }
    ],
    { configured: true, ready: true }
  );
  assert.equal(
    dom.window.document.querySelector('[data-play-board] .play-top-name').textContent,
    'Paranoia'
  );
});

test('stepmania songs record on Play, not on restarts, and the board is on the page', () => {
  const controller = readFileSync(path.join(ROOT, 'stepmania/js/mainPageController.js'), 'utf8');
  const analyticsPage = readFileSync(path.join(ROOT, 'analytics/index.html'), 'utf8');
  assert.match(controller, /this\.recordSongPlay\(currentSong\)/);
  assert.match(controller, /enable\('play-counts'\)/);
  assert.match(controller, /recordStepmaniaPlay\(currentSong\.key,\s*currentSong\.data\?\.title\)/);
  const restart = controller.slice(controller.indexOf('restartSong() {'));
  assert.doesNotMatch(restart.slice(0, 200), /recordSongPlay/);
  assert.match(analyticsPage, /data-app="stepmania" data-kind="song"/);
  assert.match(analyticsPage, /href="#top-songs"/);
  assert.match(analyticsPage, /id="top-songs"/);
  assert.equal(analyticsPage.match(/data-limit="50"/g).length, 7);
  assert.match(analyticsPage, /id="top-shows"/);
  assert.match(analyticsPage, /id="top-episodes"/);
});

test('watch pages link the shows, movies, and episodes people actually start', () => {
  const counts = [
    { app: 'watch', kind: 'show', id: 'simpsons', name: 'The Simpsons', parent: '', count: 50 },
    { app: 'watch', kind: 'show', id: 'southpark', name: 'South Park', parent: '', count: 10 },
    {
      app: 'watch',
      kind: 'movie',
      id: 'simpsons-movie',
      name: 'The Simpsons Movie',
      parent: '',
      count: 8
    },
    {
      app: 'watch',
      kind: 'episode',
      id: 'simpsons|s12e21',
      name: 'The Simpsons S12E21',
      parent: 'simpsons',
      count: 20
    },
    {
      app: 'watch',
      kind: 'episode',
      id: 'simpsons|s01e01',
      name: 'The Simpsons S01E01 Homer',
      parent: 'simpsons',
      count: 9
    },
    {
      app: 'watch',
      kind: 'episode',
      id: 'southpark|s01e01',
      name: 'South Park S01E01',
      parent: 'southpark',
      count: 4
    }
  ];
  const env = { path: '/watch/', configured: true, ready: true };
  const landing = new JSDOM(`<!doctype html><body>
    <section class="tv-landing">
      <div class="tv-landing-intro"><div class="tv-tags"></div></div>
      <div id="shows"></div>
      <div id="movies" class="tv-movies-section"><div class="tv-section-label"></div></div>
    </section>
  </body>`);
  const landingDoc = landing.window.document;
  applyCounts(landingDoc, counts, { ...env, search: '' });
  applyCounts(landingDoc, counts, { ...env, search: '' });
  assert.deepEqual(
    [...landingDoc.querySelectorAll('#play-top-shows .play-top-name')].map(
      (node) => node.textContent
    ),
    ['The Simpsons', 'South Park']
  );
  assert.equal(
    landingDoc.querySelector('#play-top-shows a').getAttribute('href'),
    '/watch/?show=simpsons'
  );
  assert.equal(
    landingDoc.querySelector('.tv-landing > .tv-landing-intro').nextElementSibling.className,
    'tv-landing-main'
  );
  assert.equal(
    landingDoc.querySelector('.tv-landing-intro .tv-tags').parentElement.className,
    'tv-landing-intro'
  );
  assert.equal(
    landingDoc.getElementById('play-top-rail').parentElement.className,
    'tv-landing-main'
  );
  assert.equal(landingDoc.getElementById('play-top-rail').nextElementSibling.id, 'shows');
  assert.equal(landingDoc.querySelector('#play-top-shows').parentElement.id, 'play-top-rail');
  assert.equal(
    landingDoc.querySelector('#play-top-movies a').getAttribute('href'),
    '/watch/?movie=simpsons-movie'
  );
  assert.equal(landingDoc.querySelector('#movies #play-top-movies'), null);
  assert.equal(landingDoc.getElementById('play-top-episodes'), null);

  const guide = new JSDOM(`<!doctype html><body>
    <section class="tv-episodes">
      <div class="tv-show-banner"></div>
      <div class="tv-section"><div class="tv-chip-row"></div></div>
      <div class="tv-section"><div class="tv-ep-grid"></div></div>
    </section>
  </body>`);
  const guideDoc = guide.window.document;
  applyCounts(guideDoc, counts, { ...env, search: '?show=simpsons' });
  assert.deepEqual(
    [...guideDoc.querySelectorAll('#play-top-episodes .play-top-name')].map(
      (node) => node.textContent
    ),
    ['S12E21', 'S01E01 Homer']
  );
  assert.equal(
    guideDoc.querySelector('#play-top-episodes a').getAttribute('href'),
    '/watch/?show=simpsons&s=12&e=21'
  );
  assert.equal(guideDoc.getElementById('play-top-shows'), null);
  assert.equal(
    guideDoc.querySelector('.tv-episodes > .tv-show-banner').nextElementSibling.className,
    'tv-episodes-main'
  );
  assert.equal(guideDoc.querySelector('#play-top-episodes').parentElement.id, 'play-top-rail-ep');
  assert.equal(
    guideDoc.getElementById('play-top-rail-ep').parentElement.className,
    'tv-episodes-main'
  );
  assert.equal(
    guideDoc.getElementById('play-top-rail-ep').nextElementSibling.className,
    'tv-section'
  );
  assert.equal(guideDoc.querySelector('.tv-show-banner #play-top-rail-ep'), null);

  applyCounts(guideDoc, counts, { ...env, search: '?show=simpsons&s=12&e=21' });
  assert.equal(guideDoc.getElementById('play-top-episodes'), null);
  assert.equal(guideDoc.getElementById('play-top-rail-ep'), null);
});

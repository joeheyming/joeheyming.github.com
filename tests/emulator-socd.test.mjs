// SOCD cleaning for the /emulator/ shell.
//
// Left+Right (or Up+Down) is impossible on a pivoting d-pad, and games that
// never expected it can derail — Metal Slug Advance hangs with a looping
// noise buffer. emulator/socd.js drops the impossible half before the core
// sees it. These checks stand in for the EmulatorJS handler by listening
// where it does: bubble phase on the player element.

import { describe, it, beforeEach, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, globSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(repoRoot, rel), 'utf8');

const KEY_CODES = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 };

let source;
let dom;
let player;
/** What a stand-in for the EmulatorJS key handler actually received. */
let seen;

before(() => {
  source = read('emulator/socd.js');
});

beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body><div id="game" tabindex="0"></div></body></html>', {
    runScripts: 'outside-only'
  });
  dom.window.eval(source);
  dom.window.emulatorSocd.install();

  player = dom.window.document.getElementById('game');
  seen = [];
  player.addEventListener('keydown', (e) => seen.push(`down:${e.key}`));
  player.addEventListener('keyup', (e) => seen.push(`up:${e.key}`));
});

/** Let the deferred handover press run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function send(type, key) {
  const keyCode = KEY_CODES[key];
  player.dispatchEvent(
    new dom.window.KeyboardEvent(type, {
      key,
      code: key,
      keyCode,
      which: keyCode,
      bubbles: true,
      cancelable: true
    })
  );
}

describe('emulator SOCD filter', () => {
  it('passes a lone direction straight through', () => {
    send('keydown', 'ArrowLeft');
    send('keyup', 'ArrowLeft');
    assert.deepEqual(seen, ['down:ArrowLeft', 'up:ArrowLeft']);
  });

  it('swallows the opposite direction while one is held', () => {
    send('keydown', 'ArrowLeft');
    send('keydown', 'ArrowRight');
    assert.deepEqual(seen, ['down:ArrowLeft']);
  });

  it('swallows the release of a press it swallowed', () => {
    send('keydown', 'ArrowLeft');
    send('keydown', 'ArrowRight');
    send('keyup', 'ArrowRight');
    assert.deepEqual(seen, ['down:ArrowLeft']);
  });

  it('hands over to the still-held direction when the winner is released', async () => {
    send('keydown', 'ArrowLeft');
    send('keydown', 'ArrowRight');
    send('keyup', 'ArrowLeft');
    await settle();
    // The release must land first: an inline handover would hold both
    // directions at once, which is the state that hangs Metal Slug Advance.
    assert.deepEqual(seen, ['down:ArrowLeft', 'up:ArrowLeft', 'down:ArrowRight']);

    // The handed-over direction still behaves like a normal press afterwards.
    send('keyup', 'ArrowRight');
    assert.equal(seen.at(-1), 'up:ArrowRight');
  });

  it('does not hand over when the opposite was already released', async () => {
    send('keydown', 'ArrowLeft');
    send('keydown', 'ArrowRight');
    send('keyup', 'ArrowRight');
    send('keyup', 'ArrowLeft');
    await settle();
    assert.deepEqual(seen, ['down:ArrowLeft', 'up:ArrowLeft']);
  });

  it('cleans the vertical axis too', () => {
    send('keydown', 'ArrowUp');
    send('keydown', 'ArrowDown');
    assert.deepEqual(seen, ['down:ArrowUp']);
  });

  it('treats the two axes independently', () => {
    send('keydown', 'ArrowLeft');
    send('keydown', 'ArrowUp');
    assert.deepEqual(seen, ['down:ArrowLeft', 'down:ArrowUp']);
  });

  it('lets auto-repeat of the held direction through', () => {
    send('keydown', 'ArrowLeft');
    send('keydown', 'ArrowLeft');
    assert.deepEqual(seen, ['down:ArrowLeft', 'down:ArrowLeft']);
  });

  it('ignores non-direction keys', () => {
    player.dispatchEvent(
      new dom.window.KeyboardEvent('keydown', {
        key: 'x',
        code: 'KeyX',
        keyCode: 88,
        bubbles: true
      })
    );
    assert.deepEqual(seen, ['down:x']);
  });

  it('recognizes a d-pad press that only carries keyCode', () => {
    player.dispatchEvent(
      new dom.window.KeyboardEvent('keydown', { keyCode: 37, bubbles: true, cancelable: true })
    );
    player.dispatchEvent(
      new dom.window.KeyboardEvent('keydown', { keyCode: 39, bubbles: true, cancelable: true })
    );
    assert.equal(seen.length, 1, 'the opposing press should have been swallowed');
  });

  it('cancels the default action of a swallowed press so the page cannot scroll', () => {
    send('keydown', 'ArrowLeft');
    const keyCode = KEY_CODES.ArrowRight;
    const blocked = new dom.window.KeyboardEvent('keydown', {
      key: 'ArrowRight',
      code: 'ArrowRight',
      keyCode,
      which: keyCode,
      bubbles: true,
      cancelable: true
    });
    player.dispatchEvent(blocked);
    assert.equal(blocked.defaultPrevented, true);
  });

  it('drops stale held state so a backgrounded tab cannot block a direction', () => {
    send('keydown', 'ArrowLeft');
    dom.window.emulatorSocd.reset();
    send('keydown', 'ArrowRight');
    assert.deepEqual(seen, ['down:ArrowLeft', 'down:ArrowRight']);
  });

  it('installs only once even if launch is retried', () => {
    dom.window.emulatorSocd.install();
    send('keydown', 'ArrowLeft');
    assert.deepEqual(seen, ['down:ArrowLeft'], 'a second listener would double every event');
  });
});

/** @param {string} source */
function emulatorScripts(source) {
  return [...source.matchAll(/<script src="(\/(?:emulator|shared)\/[^"]+)"><\/script>/g)].map(
    (m) => m[1]
  );
}

/** @param {string} name */
function scriptList(name) {
  const launch = read('emulator/launch.js');
  const match = launch.match(new RegExp(`const ${name} = \\[([^\\]]*)\\]`));
  assert.ok(match, `launch.js defines ${name}`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe('emulator SOCD wiring', () => {
  // Discovered rather than listed so a newly added console page is covered
  // the moment it ships.
  const landers = globSync('emulator/*/index.html', { cwd: repoRoot }).filter((page) =>
    read(page).includes('/emulator/launch.js')
  );

  it('loads socd.js before ejs-mount.js on the play path, not on page load', () => {
    assert.deepEqual(scriptList('PLAY_SCRIPTS'), [
      '/emulator/socd.js',
      '/emulator/ejs-mount.js',
      '/emulator/play.js'
    ]);
    for (const page of ['emulator/index.html', ...landers]) {
      const html = read(page);
      assert.ok(html.includes('/emulator/launch.js'), `${page}: missing launch.js`);
      assert.doesNotMatch(
        html,
        /\/emulator\/(socd|ejs-mount|play)\.js/,
        `${page}: loads play scripts`
      );
    }
  });

  it('lists the game-list scripts in dependency order on every console page', () => {
    const listing = scriptList('LISTING_SCRIPTS');
    assert.deepEqual(listing, [
      '/emulator/internet-archive.js',
      '/emulator/rom-acquire.js',
      '/emulator/games-sheet.js',
      '/emulator/rom-browser.js',
      '/emulator/bios.js'
    ]);
    assert.ok(landers.length > 1, 'expected per-console pages');
    for (const page of landers) {
      const scripts = emulatorScripts(read(page));
      const positions = listing.map((src) => scripts.indexOf(src));
      assert.ok(!positions.includes(-1), `${page}: missing a game-list script`);
      assert.deepEqual(
        [...positions].sort((a, b) => a - b),
        positions,
        `${page}: order`
      );
      assert.ok(positions.at(-1) < scripts.indexOf('/emulator/launch.js'), `${page}: launch last`);
    }
  });

  it('keeps every console page on the generated lander script list', () => {
    const template = emulatorScripts(read('scripts/sync-emulator-shell.mjs'));
    assert.ok(template.includes('/emulator/launch.js'));
    for (const page of landers) {
      const scripts = emulatorScripts(read(page)).filter((src) => !src.includes('ruffle'));
      assert.deepEqual(scripts, template, `${page} drifted from landerHtml()`);
    }
  });

  it('keeps the console list off the hub', () => {
    const hub = emulatorScripts(read('emulator/index.html'));
    for (const src of scriptList('LISTING_SCRIPTS')) {
      assert.ok(!hub.includes(src), `hub loads ${src}`);
    }
  });

  it('is installed at game start rather than on page load', () => {
    const mount = read('emulator/ejs-mount.js');
    assert.match(mount, /window\.emulatorSocd\?\.install\(\)/);
  });
});

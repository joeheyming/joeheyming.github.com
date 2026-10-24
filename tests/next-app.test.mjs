import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function load(url, html) {
  return new JSDOM(html, { url, runScripts: 'outside-only' });
}

test('last app remembers the page and drops campaign params', () => {
  const dom = load(
    'http://localhost/doom/?flavor=classic&utm_source=google&utm_medium=organic&shared=1',
    '<!doctype html><html><body></body></html>'
  );
  dom.window.eval(readFileSync(path.join(ROOT, 'analytics.js'), 'utf8'));
  const stored = JSON.parse(dom.window.localStorage.getItem('hos-last-app'));
  assert.equal(stored.path, '/doom/');
  assert.equal(stored.href, '/doom/?flavor=classic');
  assert.equal(typeof stored.at, 'number');
});

test('last app ignores the homepage and expires after 14 days', () => {
  const home = load('http://localhost/', '<!doctype html><html><body></body></html>');
  home.window.eval(readFileSync(path.join(ROOT, 'analytics.js'), 'utf8'));
  assert.equal(home.window.localStorage.getItem('hos-last-app'), null);

  const dom = load('http://localhost/stepmania/', '<!doctype html><html><body></body></html>');
  dom.window.eval(readFileSync(path.join(ROOT, 'analytics.js'), 'utf8'));
  const fresh = dom.window.heyLastApp.read(dom.window.localStorage, Date.now());
  assert.equal(fresh.href, '/stepmania/');

  const staleAt = Date.now() - dom.window.heyLastApp.MAX_AGE_MS - 1000;
  dom.window.localStorage.setItem(
    'hos-last-app',
    JSON.stringify({ path: '/stepmania/', href: '/stepmania/', at: staleAt })
  );
  assert.equal(dom.window.heyLastApp.read(dom.window.localStorage, Date.now()), null);

  dom.window.localStorage.setItem(
    'hos-last-app',
    JSON.stringify({ path: '/stepmania/', href: 'https://evil.example/', at: Date.now() })
  );
  assert.equal(dom.window.heyLastApp.read(dom.window.localStorage, Date.now()), null);
});

test('next_app_click records the surface and the app', () => {
  const dom = load('http://localhost/doom/', '<!doctype html><html><body></body></html>');
  const events = [];
  dom.window.eval(readFileSync(path.join(ROOT, 'analytics.js'), 'utf8'));
  dom.window.trackEvent = function (name, category, label) {
    events.push([name, category, label]);
  };
  dom.window.document.body.innerHTML =
    '<a data-next-app="emulator" data-next-surface="doom_exit">Emulator</a>';
  dom.window.document.querySelector('a').click();
  assert.deepEqual(events, [['next_app_click', 'Growth', 'doom_exit:emulator']]);
});

test('doom exit and flavor failure offer emulator, stepmania, and pacman', () => {
  const html = readFileSync(path.join(ROOT, 'doom/index.html'), 'utf8');
  const dom = load('http://localhost/doom/', html);
  dom.window.eval(readFileSync(path.join(ROOT, 'doom/next-apps.js'), 'utf8'));
  const exit = dom.window.document.getElementById('doomExitNext');
  const hrefs = Array.from(exit.querySelectorAll('a')).map((a) => a.getAttribute('href'));
  assert.deepEqual(hrefs, ['/emulator/', '/stepmania/', '/pacman/']);
  assert.equal(exit.querySelector('a').getAttribute('data-next-surface'), 'doom_exit');
  assert.equal(exit.querySelector('a').closest('#exited') !== null, true);

  const fail = dom.window.document.getElementById('doomFailNext');
  assert.equal(fail.hidden, true);
  dom.window.DoomNextApps.mount(fail, 'doom_fail');
  dom.window.DoomNextApps.mount(fail, 'doom_fail');
  assert.equal(fail.querySelectorAll('a').length, 3);
  assert.equal(fail.querySelector('a').getAttribute('data-next-surface'), 'doom_fail');

  const registry = JSON.parse(readFileSync(path.join(ROOT, 'apps-registry.json'), 'utf8'));
  const doom = registry.find((app) => app.id === 'doom');
  assert.deepEqual(doom.related, ['emulator', 'stepmania', 'pacman']);
});

test('homepage continue links the last app and stays hidden without one', () => {
  function boot(record) {
    const dom = load(
      'https://joeheyming.github.io/',
      '<!doctype html><html><body><div id="continue-app" hidden></div></body></html>'
    );
    dom.window.AppModule = {
      getAllApps() {
        return [{ id: 'doom', shortName: 'Doom', icon: '💀', path: './doom/', category: 'game' }];
      },
      generateHamburgerMenuItems() {
        return [];
      }
    };
    dom.window.heyLastApp = {
      read() {
        return record;
      }
    };
    dom.window.eval(readFileSync(path.join(ROOT, 'index.js'), 'utf8'));
    return dom.window.document.getElementById('continue-app');
  }

  const empty = boot(null);
  assert.equal(empty.hidden, true);
  assert.equal(empty.querySelector('a'), null);

  const slot = boot({ path: '/doom/', href: '/doom/?flavor=classic' });
  const link = slot.querySelector('a');
  assert.equal(slot.hidden, false);
  assert.equal(link.getAttribute('href'), '/doom/?flavor=classic');
  assert.equal(link.dataset.nextApp, 'doom');
  assert.equal(link.dataset.nextSurface, 'home');
  assert.match(link.textContent, /Continue/);
  assert.match(link.textContent, /Doom/);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PAGE = `<!doctype html><body>
  <section id="your-desk" hidden>
    <div id="continue-app" hidden></div>
    <div id="saved-games" hidden></div>
    <div id="desk-achievements" hidden></div>
  </section>
</body>`;

function boot(prepare) {
  const dom = new JSDOM(PAGE, {
    url: 'https://joeheyming.github.io/',
    runScripts: 'outside-only'
  });
  dom.window.eval(readFileSync(path.join(ROOT, 'emulator/resumes.js'), 'utf8'));
  if (prepare) prepare(dom.window);
  dom.window.AppModule = {
    getAllApps() {
      return [];
    }
  };
  dom.window.heyLastApp = {
    read() {
      return null;
    }
  };
  dom.window.eval(readFileSync(path.join(ROOT, 'index.js'), 'utf8'));
  return dom.window.document;
}

test('the desk stays hidden when this browser has nothing to resume', () => {
  const document = boot();
  assert.equal(document.getElementById('your-desk').hidden, true);
  assert.equal(document.getElementById('saved-games').hidden, true);
});

test('a quick save becomes a continue card on the home page', () => {
  const document = boot((window) => {
    window.emulatorResumes.remember(window.localStorage, {
      console: 'nes',
      file: 'Zelda.nes',
      title: 'The Legend of Zelda'
    });
  });
  const card = document.querySelector('.hos-saved-card');
  assert.ok(card);
  assert.equal(card.getAttribute('href'), '/emulator/nes/?rom=Zelda.nes&resume=1');
  assert.match(card.textContent, /The Legend of Zelda/);
  assert.equal(document.getElementById('your-desk').hidden, false);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = readFileSync(join(ROOT, 'wordle-finder', 'wordle-game.js'), 'utf8');

function boot() {
  const dom = new JSDOM(
    `<!doctype html><body>
      <div id="wordle-game">
        <button class="wg-new-game" type="button">New Game</button>
        <div class="wg-status"></div>
        <div class="wg-message"></div>
        <div class="wg-board" aria-label="Wordle board"></div>
        <div class="wg-keyboard" aria-label="On-screen keyboard"></div>
      </div>
    </body>`,
    { url: 'https://joeheyming.github.io/wordle-finder/', runScripts: 'dangerously' }
  );
  const { window } = dom;
  window.allwords = ['crane'];
  window.wordleAnswers = new Set(['crane']);
  const script = window.document.createElement('script');
  script.textContent = SOURCE;
  window.document.body.appendChild(script);
  window.startWordleGame('crane');
  return window;
}

function keyButton(window, key) {
  return window.document.querySelector('.wg-key[data-key="' + key + '"]');
}

function press(el) {
  el.click();
}

test('a click keeps focus on the key so it can be repeated', () => {
  const window = boot();
  const back = keyButton(window, 'back');
  press(keyButton(window, 'q'));
  press(keyButton(window, 'q'));
  assert.equal(window.document.querySelector('.wg-tile').textContent, 'q');
  assert.equal(window.document.querySelectorAll('.wg-tile')[1].textContent, 'q');

  press(back);
  assert.equal(window.document.activeElement, back);
  assert.equal(window.document.querySelectorAll('.wg-tile')[1].textContent, '');

  press(back);
  assert.equal(window.document.activeElement, back);
  assert.equal(window.document.querySelector('.wg-tile').textContent, '');
  window.close();
});

test('a touch tap still blurs the key', () => {
  const window = boot();
  const q = keyButton(window, 'q');
  q.dispatchEvent(new window.Event('touchstart', { bubbles: true }));
  press(q);
  assert.equal(window.document.querySelector('.wg-tile').textContent, 'q');
  assert.notEqual(window.document.activeElement, q);
  window.close();
});

test('a letter typed on a select does not fill a tile', () => {
  const window = boot();
  const select = window.document.createElement('select');
  window.document.body.appendChild(select);
  select.focus();
  const letter = new window.KeyboardEvent('keydown', {
    key: 'q',
    bubbles: true,
    cancelable: true
  });
  select.dispatchEvent(letter);
  assert.equal(window.document.querySelector('.wg-tile').textContent, '');
  window.close();
});

test('Enter on a focused key is left to that button', () => {
  const window = boot();
  const q = keyButton(window, 'q');
  q.focus();
  const enter = new window.KeyboardEvent('keydown', {
    key: 'Enter',
    bubbles: true,
    cancelable: true
  });
  q.dispatchEvent(enter);
  assert.equal(enter.defaultPrevented, false);
  assert.equal(window.document.querySelector('.wg-tile').textContent, '');

  press(keyButton(window, 'c'));
  press(keyButton(window, 'r'));
  press(keyButton(window, 'a'));
  press(keyButton(window, 'n'));
  press(keyButton(window, 'e'));
  const submit = new window.KeyboardEvent('keydown', {
    key: 'Enter',
    bubbles: true,
    cancelable: true
  });
  window.document.dispatchEvent(submit);
  assert.equal(submit.defaultPrevented, true);
  assert.equal(window.document.querySelector('.wg-status').textContent, 'You got it in 1 guess!');
  window.close();
});

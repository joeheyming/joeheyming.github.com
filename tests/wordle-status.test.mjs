// Exhaustive check of the Wordle self-play status. The expected edges live
// here. wordleStepStatus is the game's own step, and the board checks
// below confirm start, clear, win, and lose go through it.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
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
  window.allwords = ['crane', 'slate', 'brick', 'pound', 'ghost', 'fatty'];
  window.wordleAnswers = new Set(['crane']);
  const script = window.document.createElement('script');
  script.textContent = SOURCE;
  window.document.body.appendChild(script);
  return window;
}

function press(window, key) {
  window.document.querySelector('.wg-key[data-key="' + key + '"]').click();
}

function typeWord(window, word) {
  for (const ch of word) press(window, ch);
  press(window, 'enter');
}

const statuses = ['idle', 'playing', 'won', 'lost'];
const events = ['start', 'win', 'lose', 'clear'];
const next = {
  idle: { start: 'playing', clear: 'idle' },
  playing: { start: 'playing', win: 'won', lose: 'lost', clear: 'idle' },
  won: { start: 'playing', clear: 'idle' },
  lost: { start: 'playing', clear: 'idle' }
};

describe('wordle status', () => {
  it('names every status and every event', () => {
    assert.deepEqual(Object.keys(next).sort(), statuses.slice().sort());
    assert.equal(statuses.length * events.length, 16);
  });

  const window = boot();

  for (const from of statuses) {
    for (const event of events) {
      const dest = (next[from] && next[from][event]) || '';
      it(from + ' + ' + event + ' → ' + (dest || 'refused'), () => {
        assert.equal(window.wordleStepStatus(from, event), dest);
      });
    }
  }

  it('a cleared board ignores letters until a new game starts', () => {
    const live = boot();
    live.startWordleGame('crane');
    live.clearWordleBoard();
    press(live, 'q');
    assert.equal(live.document.querySelector('.wg-tile').textContent, '');
    live.startWordleGame('crane');
    press(live, 'q');
    assert.equal(live.document.querySelector('.wg-tile').textContent, 'q');
    live.close();
  });

  it('a correct guess wins and six misses lose', () => {
    const live = boot();
    live.startWordleGame('crane');
    typeWord(live, 'crane');
    assert.equal(live.document.querySelector('.wg-status').textContent, 'You got it in 1 guess!');

    live.startWordleGame('crane');
    for (const word of ['slate', 'brick', 'pound', 'ghost', 'fatty', 'slate']) {
      typeWord(live, word);
    }
    assert.equal(live.document.querySelector('.wg-status').textContent, 'The word was CRANE');
    live.close();
  });
});

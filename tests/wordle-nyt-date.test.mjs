// Date bounds for NYT Wordle fetch (wordle-finder/nyt-wordle.js).
//
// nyt-wordle.js is a classic IIFE. Tests stub `document` / `sessionStorage`
// then eval it, and assert clamp / format helpers plus fetch URL construction.

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const WORDLE_DIR = path.join(ROOT, 'wordle-finder');

before(() => {
  global.window = global;
  const html = fs.readFileSync(path.join(WORDLE_DIR, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { url: 'https://joeheyming.github.io/wordle-finder/' });
  global.document = dom.window.document;
  global.sessionStorage = {
    _data: {},
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(this._data, key) ? this._data[key] : null;
    },
    setItem(key, value) {
      this._data[key] = String(value);
    }
  };

  const code = fs.readFileSync(path.join(WORDLE_DIR, 'nyt-wordle.js'), 'utf8');
  // eslint-disable-next-line no-eval
  (0, eval)(code);
});

describe('wordle NYT date helpers', () => {
  it('formats a local calendar date as YYYY-MM-DD', () => {
    const { formatLocalDate } = window.wordleNyt;
    assert.equal(formatLocalDate(new Date(2022, 0, 5)), '2022-01-05');
    assert.equal(formatLocalDate(new Date(2021, 5, 19)), '2021-06-19');
  });

  it('clamps dates to the Wordle launch through today', () => {
    const { clampWordleDate, WORDLE_LAUNCH } = window.wordleNyt;
    const today = '2026-09-23';
    assert.equal(clampWordleDate('2020-01-01', today), WORDLE_LAUNCH);
    assert.equal(clampWordleDate('2026-12-31', today), today);
    assert.equal(clampWordleDate('not-a-date', today), today);
    assert.equal(clampWordleDate('', today), today);
    assert.equal(clampWordleDate('2022-03-04', today), '2022-03-04');
  });

  it('labels today vs a historical puzzle without UTC shift', () => {
    const { formatLocalDate, statusLabelForDate } = window.wordleNyt;
    const today = formatLocalDate(new Date());
    assert.equal(statusLabelForDate(today), "Today's Wordle");
    const label = statusLabelForDate('2022-01-15');
    assert.match(label, /^Wordle — /);
    assert.match(label, /2022/);
    assert.match(label, /15/);
  });
});

describe('wordle-finder date picker markup', () => {
  it('has a date input tied to NYT Wordle, hidden until Play Wordle', () => {
    const html = fs.readFileSync(path.join(WORDLE_DIR, 'index.html'), 'utf8');
    const document = new JSDOM(html).window.document;
    const row = document.getElementById('wordle-date-row');
    const input = document.getElementById('wordleDate');
    const source = document.getElementById('wordleSource');
    assert.ok(row);
    assert.equal(row.hasAttribute('hidden'), true);
    assert.ok(input);
    assert.equal(input.getAttribute('type'), 'date');
    assert.equal(input.getAttribute('min'), '2021-06-19');
    assert.equal(source.querySelector('option[value="today"]').textContent.trim(), 'NYT Wordle');
  });
});

describe('fetch uses the selected date', () => {
  it('requests YYYY-MM-DD.json for the clamped picker value', async () => {
    const input = document.getElementById('wordleDate');
    const source = document.getElementById('wordleSource');
    source.value = 'today';
    input.value = '2022-01-15';

    const urls = [];
    window.proxyService = {
      fetchJson(url) {
        urls.push(url);
        return Promise.resolve({
          solution: 'crane',
          id: 1,
          days_since_launch: 1,
          print_date: '2022-01-15'
        });
      }
    };
    window.startWordleGame = function () {};
    window.clearWordleBoard = function () {};

    await window.startWordleFromSource();
    assert.deepEqual(urls, ['https://www.nytimes.com/svc/wordle/v2/2022-01-15.json']);
  });
});

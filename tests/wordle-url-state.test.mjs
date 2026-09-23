// Shareable URL state for wordle-finder (wordle-finder/url-state.js).
//
// url-state.js is a classic IIFE that delegates date bounds to nyt-wordle.js,
// so both are eval'd into a shared scope the way wordle-nyt-date.test.mjs
// does. Asserts param parsing (including aliases and the date -> Play Wordle
// inference) and the canonical query string written back on change.

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORDLE_DIR = path.join(__dirname, '..', 'wordle-finder');
const TODAY = '2026-09-23';

before(() => {
  global.window = global;
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://joeheyming.github.io/wordle-finder/'
  });
  global.document = dom.window.document;
  global.sessionStorage = {
    getItem: () => null,
    setItem: () => {}
  };

  for (const file of ['nyt-wordle.js', 'url-state.js']) {
    // eslint-disable-next-line no-eval
    (0, eval)(fs.readFileSync(path.join(WORDLE_DIR, file), 'utf8'));
  }
});

describe('parse', () => {
  it('defaults to the solver with no params', () => {
    assert.deepEqual(window.wordleUrlState.parse('', TODAY), {
      mode: 'score',
      word: 'random',
      date: null,
      strategy: 'pure-entropy'
    });
  });

  it('accepts mode, word, and strategy values', () => {
    const state = window.wordleUrlState.parse('?mode=wordle&word=today&strategy=frequency', TODAY);
    assert.equal(state.mode, 'wordle');
    assert.equal(state.word, 'today');
    assert.equal(state.strategy, 'frequency');
  });

  it('resolves friendlier aliases', () => {
    assert.equal(window.wordleUrlState.parse('?mode=solve', TODAY).mode, 'score');
    assert.equal(window.wordleUrlState.parse('?mode=solver', TODAY).mode, 'score');
    assert.equal(window.wordleUrlState.parse('?mode=helper', TODAY).mode, 'play');
    assert.equal(window.wordleUrlState.parse('?mode=GAME', TODAY).mode, 'wordle');
    assert.equal(window.wordleUrlState.parse('?mode=wordle&word=nyt', TODAY).word, 'today');
  });

  it('falls back to defaults for unknown values', () => {
    const state = window.wordleUrlState.parse('?mode=nope&word=nope&strategy=nope', TODAY);
    assert.deepEqual(state, {
      mode: 'score',
      word: 'random',
      date: null,
      strategy: 'pure-entropy'
    });
  });

  it('treats a bare date as a request to play that NYT puzzle', () => {
    const state = window.wordleUrlState.parse('?date=2022-01-15', TODAY);
    assert.equal(state.mode, 'wordle');
    assert.equal(state.word, 'today');
    assert.equal(state.date, '2022-01-15');
  });

  it('clamps out-of-range dates and ignores malformed ones', () => {
    assert.equal(window.wordleUrlState.parse('?date=2019-01-01', TODAY).date, '2021-06-19');
    assert.equal(window.wordleUrlState.parse('?date=2030-01-01', TODAY).date, TODAY);
    assert.equal(window.wordleUrlState.parse('?date=yesterday', TODAY).date, null);
    assert.equal(window.wordleUrlState.parse('?date=yesterday', TODAY).mode, 'score');
  });

  it('lets an explicit word param override the date inference', () => {
    const state = window.wordleUrlState.parse('?date=2022-01-15&word=random', TODAY);
    assert.equal(state.word, 'random');
  });
});

describe('toSearch', () => {
  const state = (over) => ({
    mode: 'score',
    word: 'random',
    date: '',
    strategy: 'pure-entropy',
    ...over
  });

  it('is empty for the default solver view', () => {
    assert.equal(window.wordleUrlState.toSearch(state(), TODAY), '');
  });

  it('omits today so a shared link still means today tomorrow', () => {
    const search = window.wordleUrlState.toSearch(
      state({ mode: 'wordle', word: 'today', date: TODAY }),
      TODAY
    );
    assert.equal(search, 'mode=wordle&word=today');
  });

  it('keeps a historical puzzle date', () => {
    const search = window.wordleUrlState.toSearch(
      state({ mode: 'wordle', word: 'today', date: '2022-01-15' }),
      TODAY
    );
    assert.equal(search, 'mode=wordle&word=today&date=2022-01-15');
  });

  it('drops the date when playing a random word', () => {
    const search = window.wordleUrlState.toSearch(
      state({ mode: 'wordle', word: 'random', date: '2022-01-15' }),
      TODAY
    );
    assert.equal(search, 'mode=wordle');
  });

  it('carries a non-default strategy only where the control is shown', () => {
    assert.equal(
      window.wordleUrlState.toSearch(state({ strategy: 'frequency' }), TODAY),
      'strategy=frequency'
    );
    assert.equal(
      window.wordleUrlState.toSearch(state({ mode: 'play', strategy: 'frequency' }), TODAY),
      'mode=play&strategy=frequency'
    );
    assert.equal(
      window.wordleUrlState.toSearch(
        state({ mode: 'wordle', word: 'today', strategy: 'frequency' }),
        TODAY
      ),
      'mode=wordle&word=today'
    );
  });

  it('round-trips parse output', () => {
    const parsed = window.wordleUrlState.parse('?mode=game&date=2022-01-15', TODAY);
    assert.equal(
      window.wordleUrlState.toSearch({ ...parsed, date: parsed.date || '' }, TODAY),
      'mode=wordle&word=today&date=2022-01-15'
    );
  });
});

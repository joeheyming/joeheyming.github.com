// Unit tests for wordle-finder/filter.js.
//
// filter.js is a classic (non-module) browser script: it defines top-level
// functions like `filterDictionary`, `addPatternEntropyScore`, `getStats`,
// etc. against the global scope and reads `window.allwords` /
// `window.wordleAnswers` / `getWords()`. Rather than reshape it into an ES
// module just for testing, we mirror what `wordle-finder/benchmark.js` does:
// point `global.window` at `global`, then `eval()` the three browser
// scripts (`wordFrequency.js`, `words.js`, `filter.js`) into the shared
// scope inside a `before` hook. After that, every filter.js function is
// available as a global in the test process.
//
// Regression coverage:
//   - Q-in-position-1 case that motivated the filter fix. Historically the
//     Best Guess tab surfaced high-entropy non-Q words (`elite`, `alter`,
//     ...); the tab now must only propose words matching the user's
//     constraints.
//
// These tests intentionally avoid asserting the exact top word — entropy
// ranking is data-driven and would break every time the answer list is
// refreshed. We only assert invariants: every scored word satisfies the
// user's filter, and at least one known Wordle answer surfaces near the top.

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORDLE_DIR = path.join(__dirname, '..', 'wordle-finder');

before(() => {
  // Match benchmark.js: alias `window` to the current global so scripts
  // that write to `window.foo` populate globals visible from these tests.
  global.window = global;
  global.alert = () => {};

  const files = ['wordFrequency.js', 'words.js', 'filter.js'];
  for (const f of files) {
    const code = fs.readFileSync(path.join(WORDLE_DIR, f), 'utf-8');
    // eslint-disable-next-line no-eval
    (0, eval)(code);
  }

  // filter.js calls `getWords()` (defined in index.js in the browser).
  // Provide the same shape here: a fresh clone of the full dictionary.
  global.allWords = global.window.allwords;
  global.getWords = function () {
    return Array.from(global.allWords);
  };
});

// Convenience: build the (spots, notSpotsLetters, excluded) triple the way
// the browser code does after reading form inputs.
function makeInputs({
  spots = ['', '', '', '', ''],
  notSpots = ['', '', '', '', ''],
  excluded = ''
} = {}) {
  return {
    spots: spots.map((s) => (s || '').toLowerCase()),
    notSpotsLetters: notSpots.map((s) => (s || '').toLowerCase().split('').filter(Boolean)),
    excluded: (excluded || '').toLowerCase().split('').filter(Boolean)
  };
}

// Strip the "★ known-answer" marker that addPatternEntropyScore adds for
// display so we can compare a scored word back to the raw dictionary.
function stripStar(w) {
  return w.replace('★', '');
}

describe('filterDictionary', () => {
  it('returns a non-empty match set for no constraints', () => {
    const { spots, notSpotsLetters, excluded } = makeInputs();
    const filtered = filterDictionary(spots, notSpotsLetters, excluded);
    assert.equal(filtered.matched.length > 10000, true);
  });

  it('restricts to words with a given first letter (green)', () => {
    const { spots, notSpotsLetters, excluded } = makeInputs({ spots: ['q', '', '', '', ''] });
    const filtered = filterDictionary(spots, notSpotsLetters, excluded);
    assert.equal(filtered.matched.length > 0, true);
    for (const w of filtered.matched) {
      assert.equal(w[0], 'q', `expected word starting with q, got ${w}`);
    }
  });

  it('restricts to words with a green in position 3', () => {
    const { spots, notSpotsLetters, excluded } = makeInputs({ spots: ['', '', '', 'e', ''] });
    const filtered = filterDictionary(spots, notSpotsLetters, excluded);
    assert.equal(filtered.matched.length > 0, true);
    for (const w of filtered.matched) {
      assert.equal(w[3], 'e', `expected 'e' at index 3, got ${w}`);
    }
  });

  it('drops words containing excluded (gray) letters', () => {
    const { spots, notSpotsLetters, excluded } = makeInputs({ excluded: 'aeiou' });
    const filtered = filterDictionary(spots, notSpotsLetters, excluded);
    for (const w of filtered.matched) {
      for (const bad of ['a', 'e', 'i', 'o', 'u']) {
        assert.equal(w.includes(bad), false, `${w} contains excluded letter ${bad}`);
      }
    }
  });

  it('honors yellow letters: present in word, absent from that position', () => {
    // Yellow "s" at position 0 → word contains s, but s is NOT at position 0.
    const { spots, notSpotsLetters, excluded } = makeInputs({ notSpots: ['s', '', '', '', ''] });
    const filtered = filterDictionary(spots, notSpotsLetters, excluded);
    assert.equal(filtered.matched.length > 0, true);
    for (const w of filtered.matched) {
      assert.equal(w.includes('s'), true, `${w} missing yellow letter s`);
      assert.notEqual(w[0], 's', `${w} has s at forbidden position 0`);
    }
  });

  it('combines green + gray constraints', () => {
    const { spots, notSpotsLetters, excluded } = makeInputs({
      spots: ['c', '', '', '', ''],
      excluded: 'z'
    });
    const filtered = filterDictionary(spots, notSpotsLetters, excluded);
    assert.equal(filtered.matched.length > 0, true);
    for (const w of filtered.matched) {
      assert.equal(w[0], 'c');
      assert.equal(w.includes('z'), false);
    }
  });
});

describe('addPatternEntropyScore — respects user filter', () => {
  // This is the regression test for the "Q first letter surfaces `alter`"
  // bug. Before the fix, the entropy scorer used `wordleAnswers` (all 2,309
  // words) as its guess pool whenever the solution set was small. That
  // meant users saw non-matching words at the top of Best Guess. The fix
  // is: always draw candidate guesses from the filtered `matched` set.
  const strategies = ['pure-entropy', 'entropy-popularity'];

  for (const strategy of strategies) {
    it(`only proposes words matching the filter (strategy=${strategy})`, () => {
      const { spots, notSpotsLetters, excluded } = makeInputs({
        spots: ['q', '', '', '', '']
      });
      const filtered = filterDictionary(spots, notSpotsLetters, excluded);
      const matchedSet = new Set(filtered.matched);
      const stats = getStats(filtered, { strategy });

      assert.equal(stats.patternEntropyScore.length > 0, true);

      for (const row of stats.patternEntropyScore) {
        const word = stripStar(row[0]);
        assert.equal(word[0], 'q', `Best Guess proposed ${word} (no Q in position 1)`);
        assert.equal(
          matchedSet.has(word),
          true,
          `Best Guess proposed ${word} which is not in the filtered match set`
        );
      }
    });

    it(`surfaces at least one known Wordle answer near the top (strategy=${strategy})`, () => {
      const { spots, notSpotsLetters, excluded } = makeInputs({
        spots: ['q', '', '', '', '']
      });
      const filtered = filterDictionary(spots, notSpotsLetters, excluded);
      const stats = getStats(filtered, { strategy });

      const top10 = stats.patternEntropyScore.slice(0, 10).map((r) => stripStar(r[0]));
      const anyKnown = top10.some((w) => window.wordleAnswers.has(w));
      assert.equal(anyKnown, true, `no known Wordle answer in top 10: ${top10.join(', ')}`);
    });
  }

  it('frequency strategy also only proposes matching words', () => {
    const { spots, notSpotsLetters, excluded } = makeInputs({
      spots: ['q', '', '', '', '']
    });
    const filtered = filterDictionary(spots, notSpotsLetters, excluded);
    const matchedSet = new Set(filtered.matched);
    const stats = getStats(filtered, { strategy: 'frequency' });

    assert.equal(stats.patternEntropyScore.length > 0, true);
    for (const row of stats.patternEntropyScore) {
      const word = stripStar(row[0]);
      assert.equal(word[0], 'q');
      assert.equal(matchedSet.has(word), true);
    }
  });

  it('bestGuess is a matched Q-word when position 1 is locked to Q', () => {
    const { spots, notSpotsLetters, excluded } = makeInputs({
      spots: ['q', '', '', '', '']
    });
    const filtered = filterDictionary(spots, notSpotsLetters, excluded);
    const matchedSet = new Set(filtered.matched);
    const stats = getStats(filtered, { strategy: 'pure-entropy' });

    assert.equal(typeof stats.bestGuess, 'string');
    assert.equal(stats.bestGuess[0], 'q');
    assert.equal(matchedSet.has(stats.bestGuess), true);
  });

  it('handles trivial single-match case without proposing out-of-set words', () => {
    // "cigar" is the first word in the Wordle answer list; picking a
    // constraint set that isolates it exercises the "solutions.length <= 1"
    // trivial branch of addPatternEntropyScore.
    const { spots, notSpotsLetters, excluded } = makeInputs({
      spots: ['c', 'i', 'g', 'a', 'r']
    });
    const filtered = filterDictionary(spots, notSpotsLetters, excluded);
    const stats = getStats(filtered, { strategy: 'pure-entropy' });

    assert.equal(stats.patternEntropyScore.length >= 1, true);
    for (const row of stats.patternEntropyScore) {
      assert.equal(stripStar(row[0]), 'cigar');
    }
    assert.equal(stripStar(stats.bestGuess || ''), 'cigar');
  });
});

describe('addPatternEntropyScore — sanity', () => {
  it('reports non-negative entropy for every scored word', () => {
    const { spots, notSpotsLetters, excluded } = makeInputs({ spots: ['s', '', '', '', ''] });
    const filtered = filterDictionary(spots, notSpotsLetters, excluded);
    const stats = getStats(filtered, { strategy: 'pure-entropy' });

    for (const row of stats.patternEntropyScore) {
      const score = parseFloat(row[1]);
      assert.equal(Number.isFinite(score), true);
      assert.equal(score >= 0, true, `negative score for ${row[0]}: ${score}`);
    }
  });

  it('produces the same top-1 for pure-entropy and entropy-popularity on a small pool', () => {
    // With a very small pool the popularity boost is a small multiplicative
    // factor on top of entropy, so the winner usually agrees. If this ever
    // starts flaking, the assertion can be relaxed to "same top-3 set".
    const { spots, notSpotsLetters, excluded } = makeInputs({ spots: ['q', 'u', '', '', ''] });
    const filtered = filterDictionary(spots, notSpotsLetters, excluded);
    const pure = getStats(filtered, { strategy: 'pure-entropy' });
    const blend = getStats(filtered, { strategy: 'entropy-popularity' });

    assert.equal(stripStar(pure.bestGuess), stripStar(blend.bestGuess));
  });
});

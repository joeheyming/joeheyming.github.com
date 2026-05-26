/**
 * Tests for the pure helpers in /watch/'s offline-cache module.
 *
 * The IDB-backed entry points (`saveEpisode`, `listSaved`, …) are
 * deliberately untested here — they're browser glue around
 * `indexedDB`, `Blob`, `fetch`, and `ReadableStream`, none of which
 * exist in Node without pulling in heavy fakes (`fake-indexeddb`,
 * `jsdom`). The repo's deployment model is "no build step, no
 * runtime deps", so we keep the test surface limited to the two
 * pure helpers and verify the browser path by hand.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { formatBytes, __testing } from './offline.js';

const { makeKey } = __testing;

describe('makeKey', () => {
  it('joins the parts with pipe separators', () => {
    assert.equal(makeKey('simpsons', 3, 15), 'simpsons|3|15');
  });

  it('treats specials (season 0) as a normal key', () => {
    assert.equal(makeKey('southpark', 0, 2), 'southpark|0|2');
  });

  it('coerces numeric parts to strings via template join', () => {
    // The key must be string-typed because IDB primary keys are
    // compared strictly; a number-key would silently miss a string-key
    // lookup and we'd serve duplicate downloads.
    const k = makeKey('beavis', 4, 1);
    assert.equal(typeof k, 'string');
    assert.equal(k, 'beavis|4|1');
  });
});

describe('formatBytes', () => {
  it('returns "—" for non-positive or non-finite input', () => {
    assert.equal(formatBytes(0), '—');
    assert.equal(formatBytes(-100), '—');
    assert.equal(formatBytes(Number.NaN), '—');
    assert.equal(formatBytes(Infinity), '—');
    assert.equal(formatBytes(undefined), '—');
  });

  it('uses bytes for values under 1 KB', () => {
    assert.equal(formatBytes(1), '1 B');
    assert.equal(formatBytes(999), '999 B');
  });

  it('switches to KB at 1 000', () => {
    assert.equal(formatBytes(1_000), '1 KB');
    assert.equal(formatBytes(999_999), '1000 KB');
  });

  it('switches to MB at 1 000 000', () => {
    assert.equal(formatBytes(1_000_000), '1 MB');
    assert.equal(formatBytes(245_000_000), '245 MB');
  });

  it('shows a decimal for sub-10 GB values', () => {
    // 2.3 GB reads naturally; 2 GB would be too lossy at that range.
    assert.equal(formatBytes(2_300_000_000), '2.3 GB');
    assert.equal(formatBytes(1_500_000_000), '1.5 GB');
  });

  it('drops trailing ".0" so round GB values stay clean', () => {
    // Without the trim "1 GB" would render as "1.0 GB" because the
    // sub-10 GB branch unconditionally calls toFixed(1).
    assert.equal(formatBytes(1_000_000_000), '1 GB');
    assert.equal(formatBytes(2_000_000_000), '2 GB');
  });

  it('drops the decimal once the value crosses 10 GB', () => {
    assert.equal(formatBytes(12_000_000_000), '12 GB');
    assert.equal(formatBytes(45_000_000_000), '45 GB');
  });

  it('handles terabyte-scale values', () => {
    assert.equal(formatBytes(2_500_000_000_000), '2.5 TB');
  });

  it('clamps to the largest unit instead of inventing PB labels', () => {
    // Even if someone tries to cache a petabyte of South Park, we
    // present it in terabytes rather than crashing with an undefined
    // unit suffix.
    assert.match(formatBytes(5_000_000_000_000_000), /TB$/);
  });
});

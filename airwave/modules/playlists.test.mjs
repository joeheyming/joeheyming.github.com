/**
 * Tests for airwave/modules/playlists.js — named playlist save/load
 * with a localStorage shim. Mirrors the queue.test.mjs in-memory
 * Storage so we can run under `node --test`.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

class MemoryStorage {
  constructor() {
    this.map = new Map();
  }
  get length() {
    return this.map.size;
  }
  key(i) {
    return Array.from(this.map.keys())[i] ?? null;
  }
  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null;
  }
  setItem(k, v) {
    this.map.set(k, String(v));
  }
  removeItem(k) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
}

const { AirwavePlaylists, slugifyName, normalizeName, _internals } = await import('./playlists.js');

const trackA = { id: 'aaaaaaaaaaa', title: 'A', author: '', thumbnail: '', duration: 1 };
const trackB = { id: 'bbbbbbbbbbb', title: 'B', author: '', thumbnail: '', duration: 1 };
const trackC = { id: 'ccccccccccc', title: 'C', author: '', thumbnail: '', duration: 1 };

describe('slugifyName', () => {
  it('lowercases and dashes non-alphanumerics', () => {
    assert.equal(slugifyName('My Mix!'), 'my-mix');
    assert.equal(slugifyName('  weird   spaces '), 'weird-spaces');
    assert.equal(slugifyName('Café — 2024'), 'café-2024');
  });

  it('returns empty string for blank or non-string input', () => {
    assert.equal(slugifyName(''), '');
    assert.equal(slugifyName(null), '');
    assert.equal(slugifyName(undefined), '');
  });

  it('caps slug length to keep storage keys sane', () => {
    const huge = 'x'.repeat(200);
    assert.equal(slugifyName(huge).length, 40);
  });
});

describe('normalizeName', () => {
  it('trims, collapses whitespace, and clamps length', () => {
    assert.equal(normalizeName('   hi   there   '), 'hi there');
    assert.equal(normalizeName(''), '');
    assert.equal(normalizeName(null), '');
    const huge = 'a'.repeat(200);
    assert.equal(normalizeName(huge).length, _internals.MAX_NAME_LENGTH);
  });
});

describe('AirwavePlaylists.save', () => {
  let storage;
  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it('saves a new playlist and snapshot reflects it', () => {
    const pl = new AirwavePlaylists({ storage, now: () => 1000 });
    const result = pl.save('My Mix', [trackA, trackB]);
    assert.equal(result.ok, true);
    assert.equal(result.replaced, false);
    assert.equal(result.id, 'my-mix');

    const snap = pl.snapshot();
    assert.equal(snap.playlists.length, 1);
    assert.equal(snap.playlists[0].name, 'My Mix');
    assert.equal(snap.playlists[0].tracks.length, 2);
  });

  it('overwrites by slug when names collide', () => {
    const pl = new AirwavePlaylists({ storage, now: () => 1000 });
    pl.save('My Mix', [trackA]);
    const result = pl.save('my   mix', [trackB, trackC]);
    assert.equal(result.ok, true);
    assert.equal(result.replaced, true);

    const snap = pl.snapshot();
    assert.equal(snap.playlists.length, 1);
    assert.equal(snap.playlists[0].name, 'my mix');
    assert.equal(snap.playlists[0].tracks[0].id, trackB.id);
  });

  it('rejects empty names', () => {
    const pl = new AirwavePlaylists({ storage });
    const result = pl.save('   ', [trackA]);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'empty-name');
    assert.equal(pl.snapshot().playlists.length, 0);
  });

  it('rejects empty track lists and filters invalid entries', () => {
    const pl = new AirwavePlaylists({ storage });
    assert.equal(pl.save('Empty', []).reason, 'empty-tracks');
    assert.equal(pl.save('Mostly Bad', [{ id: 'short' }, null]).reason, 'empty-tracks');
  });

  it('persists across instances', () => {
    const pl1 = new AirwavePlaylists({ storage, now: () => 1000 });
    pl1.save('Roadtrip', [trackA, trackB]);

    const pl2 = new AirwavePlaylists({ storage });
    const snap = pl2.snapshot();
    assert.equal(snap.playlists.length, 1);
    assert.equal(snap.playlists[0].name, 'Roadtrip');
    assert.equal(snap.playlists[0].tracks[0].id, trackA.id);
  });
});

describe('AirwavePlaylists.snapshot ordering', () => {
  it('orders by updatedAt desc so most-recent shows first', () => {
    const storage = new MemoryStorage();
    let t = 1000;
    const pl = new AirwavePlaylists({ storage, now: () => t });
    pl.save('Older', [trackA]);
    t = 2000;
    pl.save('Middle', [trackB]);
    t = 3000;
    pl.save('Newest', [trackC]);

    const names = pl.snapshot().playlists.map((p) => p.name);
    assert.deepEqual(names, ['Newest', 'Middle', 'Older']);
  });
});

describe('AirwavePlaylists.get / .remove', () => {
  it('round-trips playlists and isolates internal arrays', () => {
    const pl = new AirwavePlaylists({ storage: new MemoryStorage() });
    pl.save('Trip', [trackA, trackB]);
    const got = pl.get('trip');
    assert.equal(got.tracks.length, 2);
    got.tracks.push(trackC); // mutate caller-side
    const again = pl.get('trip');
    assert.equal(again.tracks.length, 2, 'internal state should be unaffected');
  });

  it('returns null for unknown ids', () => {
    const pl = new AirwavePlaylists({ storage: new MemoryStorage() });
    assert.equal(pl.get('nope'), null);
    assert.equal(pl.get(null), null);
  });

  it('remove() returns true once and false thereafter', () => {
    const pl = new AirwavePlaylists({ storage: new MemoryStorage() });
    pl.save('Gone', [trackA]);
    assert.equal(pl.remove('gone'), true);
    assert.equal(pl.remove('gone'), false);
    assert.equal(pl.snapshot().playlists.length, 0);
  });
});

describe('AirwavePlaylists.subscribe', () => {
  it('fires immediately and on changes', () => {
    const pl = new AirwavePlaylists({ storage: new MemoryStorage() });
    const seen = [];
    const off = pl.subscribe((s) => seen.push(s.playlists.length));
    pl.save('A', [trackA]);
    pl.remove('a');
    off();
    pl.save('B', [trackB]); // should not fire
    assert.deepEqual(seen, [0, 1, 0]);
  });
});

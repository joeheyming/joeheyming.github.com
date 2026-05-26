/**
 * Tests for the /watch/ prefs module.
 *
 * The module reads/writes real `localStorage`, which doesn't exist in
 * Node — we install a tiny in-memory shim on `globalThis` before
 * importing it. Each test resets the shim so they don't bleed state.
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

globalThis.localStorage = new MemoryStorage();

const {
  loadPrefs,
  savePrefs,
  loadLastEpisode,
  saveLastEpisode,
  clearLastEpisode,
  listContinueWatching,
  __testing
} = await import('./prefs.js');

beforeEach(() => {
  globalThis.localStorage.clear();
});

describe('loadPrefs', () => {
  it('returns defaults when storage is empty', () => {
    const p = loadPrefs();
    assert.equal(p.autoplayNext, true);
    assert.equal(p.shuffle, false);
    assert.equal(p.subtitleLang, null);
  });

  it('reads back a saved subtitleLang', () => {
    savePrefs({ autoplayNext: false, subtitleLang: 'eng' });
    const p = loadPrefs();
    assert.equal(p.autoplayNext, false);
    assert.equal(p.subtitleLang, 'eng');
  });

  it('normalizes the subtitle lang to lowercase', () => {
    localStorage.setItem(
      __testing.PREFS_KEY,
      JSON.stringify({ autoplayNext: true, subtitleLang: 'ENG' })
    );
    assert.equal(loadPrefs().subtitleLang, 'eng');
  });

  it('treats empty string as "off"', () => {
    localStorage.setItem(
      __testing.PREFS_KEY,
      JSON.stringify({ autoplayNext: true, subtitleLang: '' })
    );
    assert.equal(loadPrefs().subtitleLang, null);
  });

  it('falls back to defaults for non-string subtitle lang', () => {
    localStorage.setItem(
      __testing.PREFS_KEY,
      JSON.stringify({ autoplayNext: true, subtitleLang: 42 })
    );
    assert.equal(loadPrefs().subtitleLang, null);
  });

  it('returns subtitleLang=null for legacy prefs missing the field', () => {
    // Simulates a user who set prefs before subtitles existed.
    localStorage.setItem(__testing.PREFS_KEY, JSON.stringify({ autoplayNext: false }));
    const p = loadPrefs();
    assert.equal(p.autoplayNext, false);
    assert.equal(p.subtitleLang, null);
  });

  it('returns shuffle=false for legacy prefs missing the field', () => {
    // Simulates a user who set prefs before shuffle-as-mode existed.
    localStorage.setItem(
      __testing.PREFS_KEY,
      JSON.stringify({ autoplayNext: false, subtitleLang: 'eng' })
    );
    assert.equal(loadPrefs().shuffle, false);
  });

  it('round-trips shuffle=true', () => {
    savePrefs({ autoplayNext: true, shuffle: true, subtitleLang: null });
    assert.equal(loadPrefs().shuffle, true);
  });

  it('falls back to default shuffle when the stored value is not a boolean', () => {
    localStorage.setItem(
      __testing.PREFS_KEY,
      JSON.stringify({ autoplayNext: true, shuffle: 'yes', subtitleLang: null })
    );
    assert.equal(loadPrefs().shuffle, false);
  });

  it('survives garbage JSON in storage', () => {
    localStorage.setItem(__testing.PREFS_KEY, 'not-json{');
    const p = loadPrefs();
    assert.equal(p.autoplayNext, true);
    assert.equal(p.subtitleLang, null);
  });
});

describe('savePrefs', () => {
  it('round-trips through loadPrefs', () => {
    savePrefs({ autoplayNext: false, shuffle: true, subtitleLang: 'spa' });
    assert.deepEqual(loadPrefs(), { autoplayNext: false, shuffle: true, subtitleLang: 'spa' });
  });

  it('persists subtitleLang=null when explicitly turned off', () => {
    savePrefs({ autoplayNext: true, shuffle: false, subtitleLang: 'eng' });
    savePrefs({ autoplayNext: true, shuffle: false, subtitleLang: null });
    assert.equal(loadPrefs().subtitleLang, null);
  });
});

/* ============================================================
 * Per-show "resume" entries + Continue Watching
 * ============================================================ */

const { LAST_KEY_PREFIX } = __testing;

describe('saveLastEpisode + loadLastEpisode', () => {
  it('round-trips season + episode and stamps updatedAt', () => {
    saveLastEpisode('simpsons', 3, 15);
    const got = loadLastEpisode('simpsons');
    assert.ok(got);
    assert.equal(got?.lastSeason, 3);
    assert.equal(got?.lastEpisode, 15);
    assert.equal(typeof got?.updatedAt, 'number');
    assert.ok((got?.updatedAt ?? 0) > 0);
  });

  it('returns null when no entry exists', () => {
    assert.equal(loadLastEpisode('simpsons'), null);
  });

  it('tolerates legacy entries written before updatedAt existed', () => {
    // Write the old shape directly so the load path has to survive
    // without an updatedAt field.
    localStorage.setItem(
      LAST_KEY_PREFIX + 'southpark',
      JSON.stringify({ lastSeason: 2, lastEpisode: 9 })
    );
    const got = loadLastEpisode('southpark');
    assert.deepEqual(got, { lastSeason: 2, lastEpisode: 9 });
  });

  it('returns null when the stored JSON is malformed', () => {
    localStorage.setItem(LAST_KEY_PREFIX + 'simpsons', 'not json');
    assert.equal(loadLastEpisode('simpsons'), null);
  });

  it('returns null when season / episode are missing', () => {
    localStorage.setItem(LAST_KEY_PREFIX + 'simpsons', JSON.stringify({ foo: 'bar' }));
    assert.equal(loadLastEpisode('simpsons'), null);
  });
});

describe('clearLastEpisode', () => {
  it('removes the entry for the given show', () => {
    saveLastEpisode('simpsons', 1, 1);
    saveLastEpisode('southpark', 2, 2);
    clearLastEpisode('simpsons');
    assert.equal(loadLastEpisode('simpsons'), null);
    assert.ok(loadLastEpisode('southpark'));
  });

  it('is a no-op when nothing is stored', () => {
    assert.doesNotThrow(() => clearLastEpisode('simpsons'));
  });
});

describe('listContinueWatching', () => {
  it('returns an empty array when nothing has been saved', () => {
    assert.deepEqual(listContinueWatching(), []);
  });

  it('sorts entries newest-first by updatedAt', () => {
    // Seed with explicit timestamps so the test isn't timing-sensitive
    // — clock resolution on some Node hosts is coarse enough that two
    // back-to-back saveLastEpisode calls produce equal `ts`.
    localStorage.setItem(
      LAST_KEY_PREFIX + 'simpsons',
      JSON.stringify({ lastSeason: 1, lastEpisode: 1, updatedAt: 1_000 })
    );
    localStorage.setItem(
      LAST_KEY_PREFIX + 'southpark',
      JSON.stringify({ lastSeason: 2, lastEpisode: 2, updatedAt: 3_000 })
    );
    localStorage.setItem(
      LAST_KEY_PREFIX + 'beavis',
      JSON.stringify({ lastSeason: 4, lastEpisode: 9, updatedAt: 2_000 })
    );
    const ids = listContinueWatching().map((e) => e.showId);
    assert.deepEqual(ids, ['southpark', 'beavis', 'simpsons']);
  });

  it('places legacy (no-updatedAt) entries after timestamped ones', () => {
    localStorage.setItem(
      LAST_KEY_PREFIX + 'legacy-a',
      JSON.stringify({ lastSeason: 1, lastEpisode: 1 })
    );
    localStorage.setItem(
      LAST_KEY_PREFIX + 'fresh',
      JSON.stringify({ lastSeason: 2, lastEpisode: 2, updatedAt: 5_000 })
    );
    localStorage.setItem(
      LAST_KEY_PREFIX + 'legacy-b',
      JSON.stringify({ lastSeason: 3, lastEpisode: 3 })
    );
    const order = listContinueWatching().map((e) => e.showId);
    assert.equal(order[0], 'fresh', 'timestamped entry comes first');
    // Legacy entries keep their relative insertion order so the UI
    // doesn't shuffle on every render.
    assert.deepEqual(order.slice(1), ['legacy-a', 'legacy-b']);
  });

  it('skips entries with malformed JSON or missing fields', () => {
    localStorage.setItem(LAST_KEY_PREFIX + 'bad-json', '{not json');
    localStorage.setItem(LAST_KEY_PREFIX + 'missing-fields', JSON.stringify({ foo: 1 }));
    saveLastEpisode('ok', 1, 1);
    const ids = listContinueWatching().map((e) => e.showId);
    assert.deepEqual(ids, ['ok']);
  });

  it('ignores unrelated localStorage keys', () => {
    localStorage.setItem('heyming.watch.prefs', JSON.stringify({ autoplayNext: true }));
    localStorage.setItem('heyming.watch.tvmaze.83', JSON.stringify({ entries: [] }));
    saveLastEpisode('simpsons', 1, 1);
    const ids = listContinueWatching().map((e) => e.showId);
    assert.deepEqual(ids, ['simpsons']);
  });

  it('rejects empty showId (key with the prefix but nothing after)', () => {
    localStorage.setItem(LAST_KEY_PREFIX, JSON.stringify({ lastSeason: 1, lastEpisode: 1 }));
    assert.deepEqual(listContinueWatching(), []);
  });

  it("exposes updatedAt as null for entries that don't have one", () => {
    localStorage.setItem(
      LAST_KEY_PREFIX + 'legacy',
      JSON.stringify({ lastSeason: 1, lastEpisode: 1 })
    );
    const [entry] = listContinueWatching();
    assert.equal(entry.updatedAt, null);
  });
});

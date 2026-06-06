import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createScoreboard } from '../js/scoreboard.js';

// Minimal in-memory Storage shim compatible with the subset of the Web
// Storage API that scoreboard.js touches (getItem / setItem / removeItem /
// key / length). Matches localStorage semantics: values are coerced to
// strings.
function makeMemoryStorage() {
  /** @type {Map<string, string>} */
  const map = new Map();
  return {
    getItem(k) {
      return map.has(k) ? map.get(k) : null;
    },
    setItem(k, v) {
      map.set(k, String(v));
    },
    removeItem(k) {
      map.delete(k);
    },
    key(i) {
      return Array.from(map.keys())[i] ?? null;
    },
    get length() {
      return map.size;
    },
    _raw: map
  };
}

const sampleEntry = (overrides = {}) => ({
  percent: 88.5,
  grade: 'A',
  score: 412300,
  maxCombo: 120,
  judgments: [80, 20, 5, 1, 2, 0],
  totalNotes: 108,
  ...overrides
});

describe('scoreboard', () => {
  let storage;
  let sb;

  beforeEach(() => {
    storage = makeMemoryStorage();
    sb = createScoreboard(storage);
  });

  describe('recordPlay', () => {
    it('returns isNewPB=true and stores PB on the first play', () => {
      const result = sb.recordPlay('stepmania', 'zenius_12345', 2, 'Hard', sampleEntry());
      assert.equal(result.isNewPB, true);
      assert.equal(result.previousPB, null);
      assert.equal(result.current.percent, 88.5);

      const pb = sb.getPB('stepmania', 'zenius_12345', 2, 'Hard');
      assert.ok(pb);
      assert.equal(pb.percent, 88.5);
      assert.equal(pb.grade, 'A');
      assert.match(pb.dateISO, /^\d{4}-\d{2}-\d{2}T/);
    });

    it('only overwrites PB when percent is strictly greater', () => {
      sb.recordPlay('stepmania', 'song', 0, 'Easy', sampleEntry({ percent: 90 }));

      const worse = sb.recordPlay('stepmania', 'song', 0, 'Easy', sampleEntry({ percent: 80 }));
      assert.equal(worse.isNewPB, false);
      assert.equal(worse.previousPB.percent, 90);
      assert.equal(sb.getPB('stepmania', 'song', 0, 'Easy').percent, 90);

      const tie = sb.recordPlay('stepmania', 'song', 0, 'Easy', sampleEntry({ percent: 90 }));
      assert.equal(tie.isNewPB, false, 'ties should not overwrite');
      assert.equal(sb.getPB('stepmania', 'song', 0, 'Easy').percent, 90);

      const better = sb.recordPlay('stepmania', 'song', 0, 'Easy', sampleEntry({ percent: 90.5 }));
      assert.equal(better.isNewPB, true);
      assert.equal(better.previousPB.percent, 90);
      assert.equal(sb.getPB('stepmania', 'song', 0, 'Easy').percent, 90.5);
    });

    it('always updates lastPlay even when PB is not beaten', () => {
      sb.recordPlay('stepmania', 'song', 0, 'Easy', sampleEntry({ percent: 95 }));
      sb.recordPlay('stepmania', 'song', 0, 'Easy', sampleEntry({ percent: 50, grade: 'D' }));

      const last = sb.getLastPlay('stepmania', 'song', 0, 'Easy');
      assert.equal(last.percent, 50);
      assert.equal(last.grade, 'D');

      const pb = sb.getPB('stepmania', 'song', 0, 'Easy');
      assert.equal(pb.percent, 95);
    });

    it('namespaces by scope', () => {
      sb.recordPlay('stepmania', 'song', 0, 'Easy', sampleEntry({ percent: 90 }));
      sb.recordPlay('accordion-hero', 'song', 0, 'Easy', sampleEntry({ percent: 30 }));

      assert.equal(sb.getPB('stepmania', 'song', 0, 'Easy').percent, 90);
      assert.equal(sb.getPB('accordion-hero', 'song', 0, 'Easy').percent, 30);
    });

    it('treats different difficulty indices as separate PBs', () => {
      sb.recordPlay('stepmania', 'song', 0, 'Easy', sampleEntry({ percent: 99 }));
      sb.recordPlay('stepmania', 'song', 3, 'Challenge', sampleEntry({ percent: 60 }));

      assert.equal(sb.getPB('stepmania', 'song', 0, 'Easy').percent, 99);
      assert.equal(sb.getPB('stepmania', 'song', 3, 'Challenge').percent, 60);
    });

    it('treats same index with different difficulty name as separate PBs', () => {
      // Edge case: Zenius re-numbers charts between revisions. The old
      // "Hard" chart should not silently become the new PB for "Expert".
      sb.recordPlay('stepmania', 'song', 2, 'Hard', sampleEntry({ percent: 91 }));
      sb.recordPlay('stepmania', 'song', 2, 'Expert', sampleEntry({ percent: 40 }));

      assert.equal(sb.getPB('stepmania', 'song', 2, 'Hard').percent, 91);
      assert.equal(sb.getPB('stepmania', 'song', 2, 'Expert').percent, 40);
    });

    it('does not crash or persist when songKey is empty', () => {
      const r = sb.recordPlay('stepmania', '', 0, 'Easy', sampleEntry());
      assert.equal(r.isNewPB, false);
      assert.equal(storage.length, 0);
    });

    it('honors caller-supplied dateISO (for deterministic tests)', () => {
      const r = sb.recordPlay('stepmania', 'song', 0, 'Easy', {
        ...sampleEntry(),
        dateISO: '2024-01-01T00:00:00.000Z'
      });
      assert.equal(r.current.dateISO, '2024-01-01T00:00:00.000Z');
    });
  });

  describe('storage robustness', () => {
    it('survives a setItem that throws (quota / private mode)', () => {
      const failing = makeMemoryStorage();
      let throwOnce = true;
      failing.setItem = (k, v) => {
        if (throwOnce) {
          throwOnce = false;
          throw new Error('QuotaExceededError');
        }
        Object.getPrototypeOf(failing) === Object.prototype && failing._raw.set(k, v);
      };
      const localSb = createScoreboard(failing);
      // Should not throw; the recordPlay call still returns the current
      // payload even when persistence fails.
      const r = localSb.recordPlay('stepmania', 'song', 0, 'Easy', sampleEntry());
      assert.equal(r.current.percent, 88.5);
    });

    it('returns null and ignores garbage entries', () => {
      storage.setItem('sm:pb:v1:stepmania:song:0:Easy', '{not valid json');
      assert.equal(sb.getPB('stepmania', 'song', 0, 'Easy'), null);

      storage.setItem('sm:pb:v1:stepmania:song:0:Easy', JSON.stringify({ foo: 'bar' }));
      assert.equal(sb.getPB('stepmania', 'song', 0, 'Easy'), null);
    });
  });

  describe('listPBs', () => {
    it('returns every PB under the given scope', () => {
      sb.recordPlay('stepmania', 'zenius_1', 0, 'Easy', sampleEntry({ percent: 90 }));
      sb.recordPlay('stepmania', 'zenius_1', 2, 'Hard', sampleEntry({ percent: 70 }));
      sb.recordPlay('stepmania', 'zenius_2', 0, 'Easy', sampleEntry({ percent: 60 }));
      sb.recordPlay('accordion-hero', 'amore', 0, '', sampleEntry({ percent: 80 }));

      const list = sb.listPBs('stepmania');
      assert.equal(list.length, 3);

      const grouped = new Map(list.map((it) => [it.songKey + '|' + it.difficultyKey, it.entry]));
      assert.equal(grouped.get('zenius_1|0:Easy').percent, 90);
      assert.equal(grouped.get('zenius_1|2:Hard').percent, 70);
      assert.equal(grouped.get('zenius_2|0:Easy').percent, 60);
    });

    it('correctly recovers songKey when it contains colons', () => {
      // Zenius keys are `zenius_<id>` (no colons), but local simfile keys
      // can contain other punctuation. We split from the RIGHT for the
      // difficulty portion so a future songKey like `local:lost` would
      // still round-trip.
      sb.recordPlay('stepmania', 'local:lost', 1, 'Medium', sampleEntry());
      const list = sb.listPBs('stepmania');
      assert.equal(list.length, 1);
      assert.equal(list[0].songKey, 'local:lost');
      assert.equal(list[0].difficultyKey, '1:Medium');
    });

    it('returns [] for unknown scope', () => {
      sb.recordPlay('stepmania', 'song', 0, 'Easy', sampleEntry());
      assert.deepEqual(sb.listPBs('does-not-exist'), []);
    });
  });

  describe('clear', () => {
    it('removes only the scope it was asked about', () => {
      sb.recordPlay('stepmania', 'song', 0, 'Easy', sampleEntry({ percent: 90 }));
      sb.recordPlay('accordion-hero', 'amore', 0, '', sampleEntry({ percent: 80 }));

      sb.clear('stepmania');

      assert.equal(sb.getPB('stepmania', 'song', 0, 'Easy'), null);
      assert.equal(sb.getLastPlay('stepmania', 'song', 0, 'Easy'), null);
      assert.equal(sb.getPB('accordion-hero', 'amore', 0, '').percent, 80);
    });
  });
});

describe('scoreboard (no storage available)', () => {
  it('returns a no-op shape when storage is null', () => {
    const sb = createScoreboard(null);
    const r = sb.recordPlay('stepmania', 'song', 0, 'Easy', sampleEntry());
    assert.equal(r.isNewPB, false);
    assert.equal(sb.getPB('stepmania', 'song', 0, 'Easy'), null);
    assert.deepEqual(sb.listPBs('stepmania'), []);
    // Should not throw
    sb.clear('stepmania');
  });
});

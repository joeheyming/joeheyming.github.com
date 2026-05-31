/**
 * Tests for airwave/modules/queue.js — the queue model with localStorage
 * persistence.
 *
 * We pass an in-memory `Storage` shim into the constructor so tests are
 * deterministic and don't require a real browser environment.
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

const { AirwaveQueue, _internals } = await import('./queue.js');

const A = {
  id: 'aaaaaaaaaaa',
  title: 'A',
  author: 'one',
  thumbnail: 'https://x/a.jpg',
  duration: 60
};
const B = {
  id: 'bbbbbbbbbbb',
  title: 'B',
  author: 'two',
  thumbnail: 'https://x/b.jpg',
  duration: 120
};
const C = {
  id: 'ccccccccccc',
  title: 'C',
  author: 'three',
  thumbnail: 'https://x/c.jpg',
  duration: 180
};

describe('AirwaveQueue', () => {
  let storage;
  let q;
  beforeEach(() => {
    storage = new MemoryStorage();
    q = new AirwaveQueue({ storage });
  });

  it('starts empty', () => {
    const snap = q.snapshot();
    assert.deepEqual(snap.items, []);
    assert.equal(snap.currentIndex, -1);
    assert.equal(snap.current, null);
  });

  it('enqueue makes first item current automatically', () => {
    assert.equal(q.enqueue(A), true);
    const snap = q.snapshot();
    assert.equal(snap.items.length, 1);
    assert.equal(snap.currentIndex, 0);
    assert.equal(snap.current.id, 'aaaaaaaaaaa');
  });

  it('enqueue dedupes by id', () => {
    q.enqueue(A);
    assert.equal(q.enqueue(A), false);
    assert.equal(q.snapshot().items.length, 1);
  });

  it('rejects invalid tracks', () => {
    assert.equal(q.enqueue(null), false);
    assert.equal(q.enqueue({ id: 'short' }), false);
    assert.equal(q.enqueue({ id: 'aaaaaaaaaaa' }), false); // missing title
    assert.equal(q.snapshot().items.length, 0);
  });

  it('playNow on a new track adds + makes current', () => {
    q.enqueue(A);
    q.playNow(B);
    const snap = q.snapshot();
    assert.equal(snap.items.length, 2);
    assert.equal(snap.currentIndex, 1);
    assert.equal(snap.current.id, 'bbbbbbbbbbb');
  });

  it('playNow on an existing track jumps to it', () => {
    q.enqueue(A);
    q.enqueue(B);
    q.enqueue(C);
    q.playNow(A);
    assert.equal(q.snapshot().currentIndex, 0);
    assert.equal(q.snapshot().items.length, 3);
  });

  it('next/prev advance and clamp at boundaries', () => {
    q.enqueue(A);
    q.enqueue(B);
    q.enqueue(C);
    assert.equal(q.snapshot().currentIndex, 0);
    assert.equal(q.next(), true);
    assert.equal(q.snapshot().currentIndex, 1);
    assert.equal(q.next(), true);
    assert.equal(q.snapshot().currentIndex, 2);
    assert.equal(q.next(), false);
    assert.equal(q.snapshot().currentIndex, 2);
    assert.equal(q.prev(), true);
    assert.equal(q.snapshot().currentIndex, 1);
  });

  it('removeAt updates currentIndex correctly', () => {
    q.enqueue(A);
    q.enqueue(B);
    q.enqueue(C);
    q.jumpTo(2); // currentIndex = 2 (C)

    q.removeAt(0); // remove A; B/C shift -> currentIndex 1
    let snap = q.snapshot();
    assert.equal(snap.items.length, 2);
    assert.equal(snap.currentIndex, 1);
    assert.equal(snap.current.id, 'ccccccccccc');

    q.removeAt(1); // remove C (was current); index clamps to last = 0 -> B
    snap = q.snapshot();
    assert.equal(snap.items.length, 1);
    assert.equal(snap.currentIndex, 0);
    assert.equal(snap.current.id, 'bbbbbbbbbbb');
  });

  it('clear empties the queue', () => {
    q.enqueue(A);
    q.enqueue(B);
    q.clear();
    const snap = q.snapshot();
    assert.deepEqual(snap.items, []);
    assert.equal(snap.currentIndex, -1);
  });

  it('persists to storage and rehydrates', () => {
    q.enqueue(A);
    q.enqueue(B);
    q.jumpTo(1);

    const q2 = new AirwaveQueue({ storage });
    const snap = q2.snapshot();
    assert.equal(snap.items.length, 2);
    assert.equal(snap.currentIndex, 1);
    assert.equal(snap.current.id, 'bbbbbbbbbbb');
  });

  it('drops corrupt persisted state without throwing', () => {
    storage.setItem(_internals.STORAGE_KEY, '{not valid json');
    const q2 = new AirwaveQueue({ storage });
    assert.deepEqual(q2.snapshot().items, []);
  });

  it('subscribe immediately invokes with current snapshot', () => {
    let called = 0;
    let lastSnap = null;
    const unsub = q.subscribe((s) => {
      called++;
      lastSnap = s;
    });
    assert.equal(called, 1);
    assert.deepEqual(lastSnap.items, []);
    q.enqueue(A);
    assert.equal(called, 2);
    assert.equal(lastSnap.items.length, 1);
    unsub();
    q.enqueue(B);
    assert.equal(called, 2); // not called again after unsub
  });
});

describe('queue _internals', () => {
  it('clampIndex handles edge cases', () => {
    assert.equal(_internals.clampIndex(-5, 3), 0);
    assert.equal(_internals.clampIndex(0, 3), 0);
    assert.equal(_internals.clampIndex(2, 3), 2);
    assert.equal(_internals.clampIndex(99, 3), 2);
    assert.equal(_internals.clampIndex(0, 0), -1);
  });
});

describe('AirwaveQueue shuffle', () => {
  let storage;
  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it('toggleShuffle flips the flag and persists', () => {
    const q = new AirwaveQueue({ storage });
    assert.equal(q.snapshot().shuffle, false);
    assert.equal(q.toggleShuffle(), true);
    assert.equal(q.snapshot().shuffle, true);

    const q2 = new AirwaveQueue({ storage });
    assert.equal(q2.snapshot().shuffle, true);
  });

  it('next() picks a non-current index when shuffle is on', () => {
    // Deterministic RNG that always returns 0.5 → middle slot.
    const q = new AirwaveQueue({ storage, rng: () => 0.5 });
    q.enqueue(A);
    q.enqueue(B);
    q.enqueue(C);
    q.jumpTo(1); // current = B (idx 1)
    q.setShuffle(true);
    q.next();
    // 0.5 * 3 = 1.5 -> floor = 1 (B again, excluded). Falls back to (1+1)%3 = 2.
    assert.equal(q.snapshot().currentIndex, 2);
    assert.equal(q.snapshot().current.id, 'ccccccccccc');
  });

  it('next() returns false on a single-item queue with shuffle on', () => {
    const q = new AirwaveQueue({ storage });
    q.enqueue(A);
    q.setShuffle(true);
    assert.equal(q.next(), false);
  });

  it('prev() is a no-op when shuffle is on (no history)', () => {
    const q = new AirwaveQueue({ storage });
    q.enqueue(A);
    q.enqueue(B);
    q.jumpTo(1);
    q.setShuffle(true);
    assert.equal(q.prev(), false);
    assert.equal(q.snapshot().currentIndex, 1);
  });
});

describe('AirwaveQueue replaceAll', () => {
  it('swaps the queue wholesale and resets currentIndex', () => {
    const storage = new MemoryStorage();
    const q = new AirwaveQueue({ storage });
    q.enqueue(A);
    q.enqueue(B);
    q.jumpTo(1);

    const n = q.replaceAll([C, A], { startIndex: 0 });
    assert.equal(n, 2);
    const snap = q.snapshot();
    assert.equal(snap.items[0].id, 'ccccccccccc');
    assert.equal(snap.items[1].id, 'aaaaaaaaaaa');
    assert.equal(snap.currentIndex, 0);
  });

  it('clamps startIndex to range', () => {
    const q = new AirwaveQueue({ storage: new MemoryStorage() });
    q.replaceAll([A, B], { startIndex: 999 });
    assert.equal(q.snapshot().currentIndex, 1);
  });

  it('empties cleanly when given an empty list', () => {
    const q = new AirwaveQueue({ storage: new MemoryStorage() });
    q.enqueue(A);
    q.replaceAll([]);
    const snap = q.snapshot();
    assert.deepEqual(snap.items, []);
    assert.equal(snap.currentIndex, -1);
  });

  it('drops invalid entries silently', () => {
    const q = new AirwaveQueue({ storage: new MemoryStorage() });
    q.replaceAll([A, { id: 'short' }, null, B]);
    const snap = q.snapshot();
    assert.equal(snap.items.length, 2);
    assert.equal(snap.items[0].id, 'aaaaaaaaaaa');
    assert.equal(snap.items[1].id, 'bbbbbbbbbbb');
  });
});

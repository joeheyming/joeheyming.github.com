/**
 * Queue model with `localStorage` persistence and a tiny pub/sub.
 *
 * A queue entry is an immutable record:
 *   { id: string, title: string, author: string, thumbnail: string,
 *     duration: number | null }
 *
 * Storage shape (under `heyming.airwave.queue.v1`):
 *   { v: 1, savedAt: <ms>, items: Track[], currentIndex: number }
 *
 * The queue is intentionally dependency-free so it's testable in plain
 * `node --test`. The `subscribe` callback fires after every mutation
 * with the full state snapshot, so the UI can render imperatively.
 */

const STORAGE_KEY = 'heyming.airwave.queue.v1';

/**
 * @typedef {Object} Track
 * @property {string} id
 * @property {string} title
 * @property {string} author
 * @property {string} thumbnail
 * @property {number | null} duration
 */

function isValidTrack(t) {
  return (
    !!t &&
    typeof t.id === 'string' &&
    /^[a-zA-Z0-9_-]{11}$/.test(t.id) &&
    typeof t.title === 'string'
  );
}

function clampIndex(index, length) {
  if (length <= 0) return -1;
  if (index < 0) return 0;
  if (index >= length) return length - 1;
  return index;
}

export class AirwaveQueue {
  /**
   * @param {{ storage?: Storage }} [opts] — pass a fake Storage in tests.
   */
  constructor(opts = {}) {
    this.storage = opts.storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
    /** @type {Track[]} */
    this.items = [];
    this.currentIndex = -1;
    this.shuffle = false;
    // `rng` is overrideable for deterministic tests.
    this.rng = typeof opts.rng === 'function' ? opts.rng : Math.random;
    /** @type {Set<(snapshot) => void>} */
    this.subs = new Set();
    this._load();
  }

  /* ── Persistence ──────────────────────────────────────────────── */

  _load() {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.items)) return;
      this.items = data.items.filter(isValidTrack);
      this.currentIndex = clampIndex(
        Number.isInteger(data.currentIndex) ? data.currentIndex : -1,
        this.items.length
      );
      if (typeof data.shuffle === 'boolean') this.shuffle = data.shuffle;
    } catch {
      /* corrupt — start fresh */
    }
  }

  _save() {
    if (!this.storage) return;
    try {
      this.storage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          v: 1,
          savedAt: Date.now(),
          items: this.items,
          currentIndex: this.currentIndex,
          shuffle: this.shuffle
        })
      );
    } catch {
      /* quota / private mode */
    }
  }

  /* ── Pub/sub ──────────────────────────────────────────────────── */

  subscribe(fn) {
    if (typeof fn !== 'function') return () => {};
    this.subs.add(fn);
    fn(this.snapshot());
    return () => this.subs.delete(fn);
  }

  snapshot() {
    return {
      items: this.items.slice(),
      currentIndex: this.currentIndex,
      current: this.currentIndex >= 0 ? this.items[this.currentIndex] : null,
      shuffle: this.shuffle
    };
  }

  _emit() {
    const snap = this.snapshot();
    for (const fn of this.subs) {
      try {
        fn(snap);
      } catch (err) {
        console.error('[airwave queue] listener threw:', err);
      }
    }
  }

  /* ── Mutations ────────────────────────────────────────────────── */

  /** Append, deduplicating by id (existing entry stays in place). */
  enqueue(track) {
    if (!isValidTrack(track)) return false;
    const existing = this.items.findIndex((t) => t.id === track.id);
    if (existing >= 0) return false;
    this.items.push(track);
    if (this.currentIndex < 0) this.currentIndex = 0;
    this._save();
    this._emit();
    return true;
  }

  /**
   * Replace the queue with a single track and make it current.
   * Used when the user pastes a URL with no playlist context.
   */
  playNow(track) {
    if (!isValidTrack(track)) return false;
    const existingIndex = this.items.findIndex((t) => t.id === track.id);
    if (existingIndex >= 0) {
      this.currentIndex = existingIndex;
    } else {
      this.items.push(track);
      this.currentIndex = this.items.length - 1;
    }
    this._save();
    this._emit();
    return true;
  }

  removeAt(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.items.length) return false;
    this.items.splice(index, 1);
    if (this.items.length === 0) {
      this.currentIndex = -1;
    } else if (index < this.currentIndex) {
      this.currentIndex -= 1;
    } else if (index === this.currentIndex) {
      // Stay at the same slot but clamp to bounds.
      this.currentIndex = clampIndex(this.currentIndex, this.items.length);
    }
    this._save();
    this._emit();
    return true;
  }

  jumpTo(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.items.length) return false;
    this.currentIndex = index;
    this._save();
    this._emit();
    return true;
  }

  next() {
    if (this.items.length === 0) return false;
    if (this.shuffle && this.items.length > 1) {
      const nextIdx = this._pickRandomIndex(this.currentIndex);
      if (nextIdx === -1) return false;
      this.currentIndex = nextIdx;
      this._save();
      this._emit();
      return true;
    }
    if (this.currentIndex >= this.items.length - 1) return false;
    this.currentIndex += 1;
    this._save();
    this._emit();
    return true;
  }

  prev() {
    if (this.items.length === 0) return false;
    // Shuffle has no real reverse — fall back to "go back one in
    // history-of-played would be nice but we don't track that".
    // Without history, prev becomes "restart current" via the seek path
    // in the UI, so here we still walk linearly for shuffle-off only.
    if (this.shuffle) return false;
    if (this.currentIndex <= 0) return false;
    this.currentIndex -= 1;
    this._save();
    this._emit();
    return true;
  }

  clear() {
    if (this.items.length === 0 && this.currentIndex === -1) return false;
    this.items = [];
    this.currentIndex = -1;
    this._save();
    this._emit();
    return true;
  }

  /** Replace the queue wholesale (used when loading a saved playlist). */
  replaceAll(tracks, { startIndex = 0 } = {}) {
    const items = (Array.isArray(tracks) ? tracks : []).filter(isValidTrack);
    if (items.length === 0) {
      this.items = [];
      this.currentIndex = -1;
    } else {
      this.items = items;
      this.currentIndex = clampIndex(startIndex, items.length);
    }
    this._save();
    this._emit();
    return this.items.length;
  }

  setShuffle(on) {
    const next = !!on;
    if (this.shuffle === next) return;
    this.shuffle = next;
    this._save();
    this._emit();
  }

  toggleShuffle() {
    this.setShuffle(!this.shuffle);
    return this.shuffle;
  }

  _pickRandomIndex(excludeIndex) {
    if (this.items.length <= 1) return -1;
    let pick;
    let safety = 32;
    do {
      pick = Math.floor(this.rng() * this.items.length);
      if (pick === this.items.length) pick = this.items.length - 1;
      safety -= 1;
    } while (pick === excludeIndex && safety > 0);
    if (pick === excludeIndex) {
      // Degenerate RNG — fall back to deterministic step.
      pick = (excludeIndex + 1) % this.items.length;
    }
    return pick;
  }
}

export const _internals = { STORAGE_KEY, isValidTrack, clampIndex };

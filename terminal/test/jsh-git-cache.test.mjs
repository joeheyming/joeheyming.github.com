import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBoundedGitCache, clearGitCache } from '../lib/jsh-git-cache.js';

// ---------------------------------------------------------------------------
// createBoundedGitCache — basics
// ---------------------------------------------------------------------------

test('createBoundedGitCache returns a usable object', () => {
  const cache = createBoundedGitCache();
  assert.equal(typeof cache, 'object');
  assert.equal(cache.__boundedCacheSize, 0);
  assert.equal(cache.__boundedCacheLimit, 50 * 1024 * 1024);
});

test('custom maxBytes is respected', () => {
  const cache = createBoundedGitCache(1024);
  assert.equal(cache.__boundedCacheLimit, 1024);
});

test('invalid maxBytes falls back to default', () => {
  const def = 50 * 1024 * 1024;
  assert.equal(createBoundedGitCache(0).__boundedCacheLimit, def);
  assert.equal(createBoundedGitCache(-1).__boundedCacheLimit, def);
  assert.equal(createBoundedGitCache(NaN).__boundedCacheLimit, def);
  assert.equal(createBoundedGitCache(null).__boundedCacheLimit, def);
  assert.equal(createBoundedGitCache(undefined).__boundedCacheLimit, def);
});

// ---------------------------------------------------------------------------
// set / get / delete
// ---------------------------------------------------------------------------

test('string property set and get', () => {
  const cache = createBoundedGitCache();
  cache.hello = 'world';
  assert.equal(cache.hello, 'world');
  assert.ok(cache.__boundedCacheSize > 0);
});

test('symbol property set and get', () => {
  const cache = createBoundedGitCache();
  const sym = Symbol('pack');
  cache[sym] = new Uint8Array(16);
  assert.equal(cache[sym].byteLength, 16);
  assert.ok(cache.__boundedCacheSize >= 16);
});

test('delete reduces tracked size', () => {
  const cache = createBoundedGitCache();
  cache.key = new Uint8Array(100);
  const before = cache.__boundedCacheSize;
  assert.ok(before >= 100);
  delete cache.key;
  assert.equal(cache.key, undefined);
  assert.equal(cache.__boundedCacheSize, 0);
});

test('overwriting a key updates size correctly', () => {
  const cache = createBoundedGitCache(10000);
  cache.data = new Uint8Array(50);
  const s1 = cache.__boundedCacheSize;
  cache.data = new Uint8Array(200);
  const s2 = cache.__boundedCacheSize;
  assert.ok(s2 > s1, `expected size ${s2} > ${s1}`);
  assert.ok(s2 >= 200);
});

// ---------------------------------------------------------------------------
// eviction
// ---------------------------------------------------------------------------

test('evicts oldest entries when limit exceeded', () => {
  const cache = createBoundedGitCache(500);
  cache.a = new Uint8Array(200);
  cache.b = new Uint8Array(200);
  assert.ok(cache.__boundedCacheSize <= 500, 'should be within limit before third entry');

  // This pushes total to ~600 before eviction
  cache.c = new Uint8Array(200);
  assert.ok(
    cache.__boundedCacheSize <= 500,
    `size ${cache.__boundedCacheSize} should be <= 500 after eviction`
  );
  // 'a' should have been evicted (oldest)
  assert.equal(cache.a, undefined, 'oldest entry should be evicted');
  // 'c' should still exist (newest)
  assert.ok(cache.c instanceof Uint8Array, 'newest entry should survive');
});

test('eviction with symbol keys', () => {
  const cache = createBoundedGitCache(300);
  const s1 = Symbol('first');
  const s2 = Symbol('second');
  const s3 = Symbol('third');
  cache[s1] = new Uint8Array(150);
  cache[s2] = new Uint8Array(150);
  // At limit; adding s3 should evict s1
  cache[s3] = new Uint8Array(150);
  assert.equal(cache[s1], undefined, 'first symbol entry should be evicted');
  assert.ok(cache[s3] instanceof Uint8Array, 'newest symbol entry should survive');
  assert.ok(cache.__boundedCacheSize <= 300);
});

test('entry exceeding limit evicts everything including itself', () => {
  const cache = createBoundedGitCache(100);
  cache.small = new Uint8Array(50);
  cache.big = new Uint8Array(200);
  // Both evicted because even big alone exceeds the limit
  assert.equal(cache.small, undefined, 'smaller entry evicted');
  assert.equal(cache.big, undefined, 'oversized entry also evicted');
  assert.equal(cache.__boundedCacheSize, 0);
});

// ---------------------------------------------------------------------------
// clearGitCache
// ---------------------------------------------------------------------------

test('clearGitCache empties the cache', () => {
  const cache = createBoundedGitCache();
  const sym = Symbol('idx');
  cache[sym] = new Uint8Array(1024);
  cache.foo = 'bar';
  assert.ok(cache.__boundedCacheSize > 0);

  clearGitCache(cache);

  assert.equal(cache[sym], undefined);
  assert.equal(cache.foo, undefined);
  assert.equal(cache.__boundedCacheSize, 0);
});

test('clearGitCache handles null/undefined gracefully', () => {
  assert.doesNotThrow(() => clearGitCache(null));
  assert.doesNotThrow(() => clearGitCache(undefined));
});

test('clearGitCache on plain object with symbols', () => {
  const obj = {};
  const s = Symbol('test');
  obj[s] = 'value';
  obj.key = 'data';
  clearGitCache(obj);
  assert.equal(obj[s], undefined);
  assert.equal(obj.key, undefined);
});

// ---------------------------------------------------------------------------
// size estimation accuracy
// ---------------------------------------------------------------------------

test('Uint8Array size tracked accurately', () => {
  const cache = createBoundedGitCache();
  cache.buf = new Uint8Array(1000);
  assert.ok(cache.__boundedCacheSize >= 1000, 'should track at least buffer size');
});

test('string size tracked (2 bytes per char)', () => {
  const cache = createBoundedGitCache();
  cache.str = 'abcde'; // 5 chars × 2 = 10 bytes
  assert.ok(cache.__boundedCacheSize >= 10);
});

test('nested object size tracked', () => {
  const cache = createBoundedGitCache();
  cache.nested = { inner: new Uint8Array(500) };
  assert.ok(cache.__boundedCacheSize >= 500);
});

test('Map value size tracked', () => {
  const cache = createBoundedGitCache();
  const m = new Map();
  m.set('key', new Uint8Array(300));
  cache.mapData = m;
  assert.ok(cache.__boundedCacheSize >= 300);
});

// ---------------------------------------------------------------------------
// multiple eviction rounds
// ---------------------------------------------------------------------------

test('many small entries — cache stays bounded', () => {
  const limit = 1000;
  const cache = createBoundedGitCache(limit);
  for (let i = 0; i < 100; i++) {
    cache['entry_' + i] = new Uint8Array(100);
  }
  assert.ok(
    cache.__boundedCacheSize <= limit,
    `final size ${cache.__boundedCacheSize} should be <= ${limit}`
  );
});

test('mixed symbol and string keys — cache stays bounded', () => {
  const limit = 500;
  const cache = createBoundedGitCache(limit);
  for (let i = 0; i < 50; i++) {
    if (i % 2 === 0) {
      cache[Symbol('s' + i)] = new Uint8Array(80);
    } else {
      cache['k' + i] = new Uint8Array(80);
    }
  }
  assert.ok(cache.__boundedCacheSize <= limit);
});

// ---------------------------------------------------------------------------
// delete of non-existent key is safe
// ---------------------------------------------------------------------------

test('deleting a non-existent key does not corrupt size', () => {
  const cache = createBoundedGitCache();
  cache.a = new Uint8Array(100);
  const before = cache.__boundedCacheSize;
  delete cache.nonexistent;
  assert.equal(cache.__boundedCacheSize, before);
});

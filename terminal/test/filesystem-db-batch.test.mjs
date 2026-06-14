/**
 * Tests for FileSystemDB fast-path methods: createFileFast, createDirectoryFast,
 * beginBatchWrite. Uses a mock IDB transaction layer since real IndexedDB is
 * not available in Node without polyfills.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

global.window = global;
const fsDbHref = new URL('../../os/filesystem-db.js', import.meta.url).href;
await import(`${fsDbHref}?v=${Date.now()}`);
const FileSystemDB = global.FileSystemDB;

function mockDb() {
  const stored = new Map();
  const putCalls = [];

  function makeIndex(field) {
    return {
      getAll(query) {
        const matches = [];
        for (const item of stored.values()) {
          if (item[field] === query) matches.push(item);
        }
        return {
          set onsuccess(fn) {
            queueMicrotask(() => fn && fn());
          },
          set onerror(_fn) {},
          get result() {
            return matches;
          }
        };
      },
      getAllKeys(query) {
        const keys = [];
        for (const [k, item] of stored.entries()) {
          if (item[field] === query) keys.push(k);
        }
        return {
          set onsuccess(fn) {
            queueMicrotask(() => fn && fn());
          },
          set onerror(_fn) {},
          get result() {
            return keys;
          }
        };
      }
    };
  }

  return {
    stored,
    putCalls,
    db: {
      transaction(_stores, _mode) {
        // Use setter-fires-microtask for tx.oncomplete (same pattern the
        // mock uses for request.onsuccess below). This matches real IDB
        // semantics: oncomplete fires AFTER the consumer attaches the
        // handler, not at transaction() call time. Originally this mock
        // fired oncomplete via an eager `queueMicrotask` inside
        // `transaction()`, which was fine while every callsite attached
        // oncomplete synchronously in the same executor — but the IDB
        // safe-transaction refactor (2026-06-13) introduced one `await`
        // between getting the tx and attaching handlers, which made the
        // eager microtask fire too early and the test deadlock.
        let oncompleteHandler = null;
        let onerrorHandler = null;
        const tx = {
          set oncomplete(fn) {
            oncompleteHandler = fn;
            queueMicrotask(() => oncompleteHandler && oncompleteHandler());
          },
          get oncomplete() {
            return oncompleteHandler;
          },
          set onerror(fn) {
            onerrorHandler = fn;
          },
          get onerror() {
            return onerrorHandler;
          },
          objectStore(_name) {
            return {
              put(item) {
                putCalls.push(item);
                stored.set(item.path, item);
                return {
                  set onsuccess(fn) {
                    queueMicrotask(() => fn && fn());
                  },
                  set onerror(_fn) {}
                };
              },
              get(path) {
                const result = stored.get(path) || null;
                return {
                  set onsuccess(fn) {
                    queueMicrotask(() => fn({ target: { result } }));
                  },
                  set onerror(_fn) {}
                };
              },
              index(field) {
                return makeIndex(field);
              }
            };
          }
        };
        return tx;
      }
    }
  };
}

function makeInstance() {
  const instance = Object.create(FileSystemDB.prototype);
  const mock = mockDb();
  instance.db = mock.db;
  instance.isInitialized = true;
  return { instance, mock };
}

// ---------------------------------------------------------------------------
// createFileFast
// ---------------------------------------------------------------------------

test('createFileFast: stores string content with correct fields', async () => {
  const { instance, mock } = makeInstance();
  const result = await instance.createFileFast('/test.txt', 'hello world', '/');
  assert.equal(result.type, 'file');
  assert.equal(result.path, '/test.txt');
  assert.equal(result.parentPath, '/');
  assert.equal(result.content, 'hello world');
  assert.equal(result.size, 11);
  assert.ok(mock.putCalls.length >= 1, 'IDB put was called');
});

test('createFileFast: stores Uint8Array as contentBytes', async () => {
  const { instance } = makeInstance();
  const data = new Uint8Array([0xca, 0xfe]);
  const result = await instance.createFileFast('/bin.dat', data, '/');
  assert.equal(result.size, 2);
  assert.ok(result.contentBytes instanceof ArrayBuffer);
  assert.deepEqual(Array.from(new Uint8Array(result.contentBytes)), [0xca, 0xfe]);
});

test('createFileFast: computes parentPath when not provided', async () => {
  const { instance } = makeInstance();
  const result = await instance.createFileFast('/a/b/c.txt', 'x');
  assert.equal(result.parentPath, '/a/b');
});

test('createFileFast: sets mimeType from extension', async () => {
  const { instance } = makeInstance();
  const result = await instance.createFileFast('/style.css', 'body{}');
  assert.equal(result.mimeType, 'text/css');
});

test('createFileFast: does NOT call getItem (no existence check)', async () => {
  const { instance, mock } = makeInstance();
  let getItemCalled = false;
  instance.getItem = async () => {
    getItemCalled = true;
    return null;
  };
  await instance.createFileFast('/no-check.txt', 'data');
  assert.equal(getItemCalled, false, 'getItem should not be called by fast path');
});

// ---------------------------------------------------------------------------
// createDirectoryFast
// ---------------------------------------------------------------------------

test('createDirectoryFast: creates directory record', async () => {
  const { instance, mock } = makeInstance();
  const result = await instance.createDirectoryFast('/mydir', '/');
  assert.equal(result.type, 'directory');
  assert.equal(result.path, '/mydir');
  assert.equal(result.parentPath, '/');
  assert.ok(mock.putCalls.length >= 1);
});

test('createDirectoryFast: does NOT check for existing dir', async () => {
  const { instance } = makeInstance();
  let getItemCalled = false;
  instance.getItem = async () => {
    getItemCalled = true;
    return { type: 'directory', path: '/existing' };
  };
  await instance.createDirectoryFast('/existing', '/');
  assert.equal(getItemCalled, false);
});

// ---------------------------------------------------------------------------
// beginBatchWrite
// ---------------------------------------------------------------------------

test('beginBatchWrite: returns putFile, flush, pendingCount', () => {
  const { instance } = makeInstance();
  const writer = instance.beginBatchWrite();
  assert.equal(typeof writer.putFile, 'function');
  assert.equal(typeof writer.flush, 'function');
  assert.equal(writer.pendingCount, 0);
});

test('beginBatchWrite: putFile increments pendingCount', async () => {
  const { instance } = makeInstance();
  const writer = instance.beginBatchWrite();
  await writer.putFile('/f1.txt', 'a', '/');
  assert.equal(writer.pendingCount, 1);
  await writer.putFile('/f2.txt', 'b', '/');
  assert.equal(writer.pendingCount, 2);
});

test('beginBatchWrite: flush writes all pending items', async () => {
  const { instance, mock } = makeInstance();
  const writer = instance.beginBatchWrite({ batchSize: 1000 });
  await writer.putFile('/a.txt', 'aa', '/');
  await writer.putFile('/b.txt', 'bb', '/');
  assert.equal(mock.putCalls.length, 0, 'no IDB puts before flush');

  await writer.flush();
  assert.equal(writer.pendingCount, 0, 'pending cleared after flush');
  assert.ok(mock.putCalls.length >= 2, 'IDB puts after flush');
  assert.ok(mock.stored.has('/a.txt'));
  assert.ok(mock.stored.has('/b.txt'));
});

test('beginBatchWrite: auto-flush at batchSize', async () => {
  const { instance, mock } = makeInstance();
  const writer = instance.beginBatchWrite({ batchSize: 2 });
  await writer.putFile('/x1.txt', 'data', '/');
  assert.equal(writer.pendingCount, 1);
  await writer.putFile('/x2.txt', 'data', '/');
  // Auto-flush triggers on the second put since pending.length >= batchSize
  assert.equal(writer.pendingCount, 0, 'auto-flushed at batchSize');
  assert.ok(mock.putCalls.length >= 2);
});

test('beginBatchWrite: flush on empty pending is no-op', async () => {
  const { instance, mock } = makeInstance();
  const writer = instance.beginBatchWrite();
  await writer.flush();
  assert.equal(mock.putCalls.length, 0);
});

test('beginBatchWrite: Uint8Array content stored as contentBytes', async () => {
  const { instance, mock } = makeInstance();
  const writer = instance.beginBatchWrite({ batchSize: 1000 });
  await writer.putFile('/bin.dat', new Uint8Array([1, 2, 3]), '/');
  await writer.flush();
  const stored = mock.stored.get('/bin.dat');
  assert.ok(stored.contentBytes instanceof ArrayBuffer);
  assert.equal(stored.size, 3);
});

// ---------------------------------------------------------------------------
// createDirectoriesBulk
// ---------------------------------------------------------------------------

test('createDirectoriesBulk: writes all dirs in one transaction', async () => {
  const { instance, mock } = makeInstance();
  const count = await instance.createDirectoriesBulk(['/a', '/a/b', '/a/b/c']);
  assert.equal(count, 3);
  assert.equal(mock.putCalls.length, 3);
  assert.ok(mock.stored.get('/a').type === 'directory');
  assert.ok(mock.stored.get('/a/b').parentPath === '/a');
  assert.ok(mock.stored.get('/a/b/c').parentPath === '/a/b');
});

test('createDirectoriesBulk: empty input is a no-op', async () => {
  const { instance, mock } = makeInstance();
  const count = await instance.createDirectoriesBulk([]);
  assert.equal(count, 0);
  assert.equal(mock.putCalls.length, 0);
});

test('createDirectoriesBulk: idempotent — overwrites existing dir record', async () => {
  const { instance, mock } = makeInstance();
  await instance.createDirectoriesBulk(['/dup']);
  const firstCreatedAt = mock.stored.get('/dup').created;
  // Re-call should overwrite (put is idempotent in IDB)
  await instance.createDirectoriesBulk(['/dup']);
  assert.equal(mock.putCalls.length, 2);
  assert.ok(mock.stored.get('/dup').created >= firstCreatedAt);
});

// ---------------------------------------------------------------------------
// listDirectoryNames (keys-only fast path)
// ---------------------------------------------------------------------------

test('listDirectoryNames: returns child paths via getAllKeys', async () => {
  const { instance, mock } = makeInstance();
  // Seed three children of /repo
  mock.stored.set('/repo/a.txt', {
    path: '/repo/a.txt',
    parentPath: '/repo',
    type: 'file',
    contentBytes: new ArrayBuffer(10_000_000) // simulate huge file
  });
  mock.stored.set('/repo/b.txt', {
    path: '/repo/b.txt',
    parentPath: '/repo',
    type: 'file'
  });
  mock.stored.set('/repo/sub', {
    path: '/repo/sub',
    parentPath: '/repo',
    type: 'directory'
  });
  // And a non-child to make sure the parentPath filter works
  mock.stored.set('/other', { path: '/other', parentPath: '/', type: 'directory' });

  const names = await instance.listDirectoryNames('/repo');
  assert.deepEqual(names.sort(), ['/repo/a.txt', '/repo/b.txt', '/repo/sub']);
});

test('listDirectoryNames: missing dir returns empty array', async () => {
  const { instance } = makeInstance();
  const names = await instance.listDirectoryNames('/no/such/dir');
  assert.deepEqual(names, []);
});

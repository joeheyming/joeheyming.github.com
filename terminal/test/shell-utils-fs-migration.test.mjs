// Unit-style test of the v2 schema backfill logic. We don't have IndexedDB in
// Node, so we drive the helper against a fake `this.db` object that captures
// reads/writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyFileSystemDbStore } from '../../os/filesystem-db-store.js';

class FakeDB {}
applyFileSystemDbStore(FakeDB);

function makeFakeIdb(rows) {
  // Tiny in-memory shim that supports the minimum we exercise:
  //   db.transaction(['files'|'metadata'], mode).objectStore(name).getAll()/put()
  //   tx.oncomplete / tx.onerror
  const stores = { files: rows.slice(), metadata: [] };
  return {
    transaction(names) {
      const tx = {
        oncomplete: null,
        onerror: null,
        objectStore(n) {
          const arr = stores[n];
          return {
            getAll() {
              const req = { onsuccess: null, onerror: null, result: arr.slice() };
              queueMicrotask(() => req.onsuccess && req.onsuccess({}));
              return req;
            },
            get(key) {
              const found = arr.find((x) => x.key === key || x.path === key);
              const req = { onsuccess: null, onerror: null, result: found || null };
              queueMicrotask(() => req.onsuccess && req.onsuccess({}));
              return req;
            },
            put(value) {
              const keyField = n === 'metadata' ? 'key' : 'path';
              const idx = arr.findIndex((x) => x[keyField] === value[keyField]);
              if (idx >= 0) arr[idx] = value;
              else arr.push(value);
              const req = { onsuccess: null, onerror: null };
              queueMicrotask(() => req.onsuccess && req.onsuccess({}));
              return req;
            }
          };
        }
      };
      queueMicrotask(() => tx.oncomplete && tx.oncomplete({}));
      return tx;
    },
    _stores: stores
  };
}

test('backfillModeUidGid: fills in defaults for legacy rows', async () => {
  const fake = new FakeDB();
  fake.isInitialized = true;
  fake.db = makeFakeIdb([
    { path: '/home/user/foo.txt', type: 'file' },
    { path: '/home/user', type: 'directory' },
    { path: '/etc/passwd', type: 'file' }
  ]);
  await fake.backfillModeUidGid();
  const updated = fake.db._stores.files;
  const foo = updated.find((r) => r.path === '/home/user/foo.txt');
  const home = updated.find((r) => r.path === '/home/user');
  const passwd = updated.find((r) => r.path === '/etc/passwd');
  assert.equal(foo.mode, 0o644);
  assert.equal(foo.uid, 1000);
  assert.equal(foo.gid, 1000);
  assert.equal(home.mode, 0o755);
  assert.equal(passwd.uid, 0); // root-owned
  assert.equal(passwd.gid, 0);
});

test('backfillModeUidGid: preserves explicit mode/uid/gid', async () => {
  const fake = new FakeDB();
  fake.isInitialized = true;
  fake.db = makeFakeIdb([
    { path: '/secret', type: 'file', mode: 0o600, uid: 42, gid: 7 }
  ]);
  await fake.backfillModeUidGid();
  const row = fake.db._stores.files.find((r) => r.path === '/secret');
  assert.equal(row.mode, 0o600);
  assert.equal(row.uid, 42);
  assert.equal(row.gid, 7);
});

test('backfillModeUidGid: idempotent when flag already set', async () => {
  const fake = new FakeDB();
  fake.isInitialized = true;
  fake.db = makeFakeIdb([
    { path: '/x', type: 'file' }
  ]);
  fake.db._stores.metadata.push({ key: 'fs_schema_v2_backfill_done', value: true });
  await fake.backfillModeUidGid();
  // mode should still be undefined because we early-returned.
  const row = fake.db._stores.files.find((r) => r.path === '/x');
  assert.equal(row.mode, undefined);
});

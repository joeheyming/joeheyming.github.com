import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJshGitFs } from '../lib/jsh-git-fs.js';

/**
 * Build a mock fileSystemDB that tracks calls via spy arrays.
 * The `items` map simulates the IDB store: path -> item object.
 */
function mockFsdb(items = new Map()) {
  const calls = {
    getItem: [],
    createDirectoryFast: [],
    createFileFast: [],
    createDirectory: [],
    listDirectory: [],
    beginBatchWrite: [],
    rmdir: [],
    unlink: [],
    deleteItem: [],
    createSymlink: []
  };

  return {
    calls,
    fsdb: {
      async getItem(path) {
        calls.getItem.push(path);
        return items.get(path) || null;
      },
      getParentPath(path) {
        const i = path.lastIndexOf('/');
        if (i <= 0) return '/';
        return path.substring(0, i);
      },
      getFileName(path) {
        return path.substring(path.lastIndexOf('/') + 1);
      },
      async createDirectoryFast(path, parent) {
        calls.createDirectoryFast.push({ path, parent });
        items.set(path, { type: 'directory', path });
      },
      async createDirectory(path) {
        calls.createDirectory.push(path);
        items.set(path, { type: 'directory', path });
      },
      async createFileFast(path, content, parent) {
        calls.createFileFast.push({ path, content, parent });
        if (content instanceof Uint8Array) {
          items.set(path, { type: 'file', path, contentBytes: content.buffer });
        } else {
          items.set(path, { type: 'file', path, content });
        }
      },
      async listDirectory(path) {
        calls.listDirectory.push(path);
        const entries = [];
        for (const [p, item] of items) {
          const parent = p.substring(0, p.lastIndexOf('/')) || '/';
          if (parent === path) entries.push(item);
        }
        return entries;
      },
      beginBatchWrite(opts) {
        calls.beginBatchWrite.push(opts);
        const queued = [];
        return {
          get pendingCount() {
            return queued.length;
          },
          async putFile(path, content, parent) {
            queued.push({ path, content, parent });
          },
          async flush() {
            for (const q of queued) {
              if (q.content instanceof Uint8Array) {
                items.set(q.path, { type: 'file', path: q.path, contentBytes: q.content.buffer });
              } else {
                items.set(q.path, { type: 'file', path: q.path, content: q.content });
              }
            }
            queued.length = 0;
          }
        };
      },
      async rmdir(path) {
        calls.rmdir.push(path);
        items.delete(path);
      },
      async unlink(path) {
        calls.unlink.push(path);
        items.delete(path);
      },
      async deleteItem(path, recursive) {
        calls.deleteItem.push({ path, recursive });
        if (recursive) {
          for (const k of [...items.keys()]) {
            if (k === path || k.startsWith(path + '/')) items.delete(k);
          }
        } else {
          items.delete(path);
        }
      },
      async createSymlink(target, path) {
        calls.createSymlink.push({ target, path });
        items.set(path, { type: 'symlink', path, target });
      }
    }
  };
}

// ---------------------------------------------------------------------------
// mkdirp + knownDirs cache
// ---------------------------------------------------------------------------

test('mkdirp creates intermediate directories', async () => {
  const { fsdb, calls } = mockFsdb();
  const fs = createJshGitFs({ fileSystemDB: fsdb });
  await fs.promises.mkdir('/a/b/c', { recursive: true });
  assert.ok(calls.getItem.includes('/a'), 'checked /a');
  assert.ok(calls.getItem.includes('/a/b'), 'checked /a/b');
  assert.ok(calls.getItem.includes('/a/b/c'), 'checked /a/b/c');
  assert.ok(
    calls.createDirectoryFast.some((c) => c.path === '/a'),
    'created /a'
  );
  assert.ok(
    calls.createDirectoryFast.some((c) => c.path === '/a/b'),
    'created /a/b'
  );
});

test('mkdirp second call skips IDB lookups for cached dirs', async () => {
  const { fsdb, calls } = mockFsdb();
  const fs = createJshGitFs({ fileSystemDB: fsdb });
  await fs.promises.mkdir('/x/y', { recursive: true });
  const firstGetCount = calls.getItem.length;
  const firstCreateCount = calls.createDirectoryFast.length;

  await fs.promises.mkdir('/x/y', { recursive: true });
  assert.equal(calls.getItem.length, firstGetCount, 'no new getItem calls on repeat');
  assert.equal(
    calls.createDirectoryFast.length,
    firstCreateCount,
    'no new createDirectoryFast calls on repeat'
  );
});

test('mkdirp throws ENOTDIR when path component is a file', async () => {
  const items = new Map([['/foo', { type: 'file', path: '/foo' }]]);
  const { fsdb } = mockFsdb(items);
  const fs = createJshGitFs({ fileSystemDB: fsdb });
  await assert.rejects(() => fs.promises.mkdir('/foo/bar', { recursive: true }), {
    code: 'ENOTDIR'
  });
});

// ---------------------------------------------------------------------------
// writeFile + readFile round-trip
// ---------------------------------------------------------------------------

test('writeFile then readFile returns same bytes', async () => {
  const { fsdb } = mockFsdb();
  const fs = createJshGitFs({ fileSystemDB: fsdb });
  const data = new Uint8Array([1, 2, 3, 4, 5]);
  await fs.promises.writeFile('/test.bin', data);
  const read = await fs.promises.readFile('/test.bin');
  assert.deepEqual(Array.from(new Uint8Array(read)), [1, 2, 3, 4, 5]);
});

test('writeFile creates parent directories', async () => {
  const { fsdb, calls } = mockFsdb();
  const fs = createJshGitFs({ fileSystemDB: fsdb });
  await fs.promises.writeFile('/a/b/file.txt', 'hello');
  assert.ok(
    calls.createDirectoryFast.some((c) => c.path === '/a'),
    'created parent /a'
  );
  assert.ok(
    calls.createDirectoryFast.some((c) => c.path === '/a/b'),
    'created parent /a/b'
  );
});

test('writeFile with string data', async () => {
  const { fsdb } = mockFsdb();
  const fs = createJshGitFs({ fileSystemDB: fsdb });
  await fs.promises.writeFile('/readme.txt', 'hello world');
  const text = await fs.promises.readFile('/readme.txt', { encoding: 'utf8' });
  assert.equal(text, 'hello world');
});

// ---------------------------------------------------------------------------
// path normalization (tested indirectly through the API)
// ---------------------------------------------------------------------------

test('stat normalizes trailing /. (isomorphic-git pattern)', async () => {
  const items = new Map([['/repo', { type: 'directory', path: '/repo' }]]);
  const { fsdb } = mockFsdb(items);
  const fs = createJshGitFs({ fileSystemDB: fsdb });
  const stat = await fs.promises.stat('/repo/.');
  assert.ok(stat.isDirectory());
});

test('stat normalizes .. segments', async () => {
  const items = new Map([['/a', { type: 'directory', path: '/a' }]]);
  const { fsdb } = mockFsdb(items);
  const fs = createJshGitFs({ fileSystemDB: fsdb });
  const stat = await fs.promises.stat('/a/b/../');
  assert.ok(stat.isDirectory());
});

test('stat ENOENT for missing path', async () => {
  const { fsdb } = mockFsdb();
  const fs = createJshGitFs({ fileSystemDB: fsdb });
  await assert.rejects(() => fs.promises.stat('/nope'), { code: 'ENOENT' });
});

// ---------------------------------------------------------------------------
// readdir
// ---------------------------------------------------------------------------

test('readdir returns filenames', async () => {
  const items = new Map([
    ['/dir', { type: 'directory', path: '/dir' }],
    ['/dir/a.txt', { type: 'file', path: '/dir/a.txt' }],
    ['/dir/b.txt', { type: 'file', path: '/dir/b.txt' }]
  ]);
  const { fsdb } = mockFsdb(items);
  const fs = createJshGitFs({ fileSystemDB: fsdb });
  const names = await fs.promises.readdir('/dir');
  assert.deepEqual(names.sort(), ['a.txt', 'b.txt']);
});

// ---------------------------------------------------------------------------
// enableBatchWrites / flushBatchWrites
// ---------------------------------------------------------------------------

test('batch writes wire through to beginBatchWrite', async () => {
  const { fsdb, calls } = mockFsdb();
  const fs = createJshGitFs({ fileSystemDB: fsdb });
  fs.enableBatchWrites();
  assert.equal(calls.beginBatchWrite.length, 1, 'beginBatchWrite called');

  await fs.promises.writeFile('/batch/file.txt', 'data');
  assert.equal(calls.createFileFast.length, 0, 'createFileFast not called during batch');

  await fs.flushBatchWrites();
  const item = await fsdb.getItem('/batch/file.txt');
  assert.ok(item, 'file exists after flush');
});

// ---------------------------------------------------------------------------
// unlink / rmdir / rm
// ---------------------------------------------------------------------------

test('unlink removes a file', async () => {
  const items = new Map([['/x.txt', { type: 'file', path: '/x.txt' }]]);
  const { fsdb } = mockFsdb(items);
  const fs = createJshGitFs({ fileSystemDB: fsdb });
  await fs.promises.unlink('/x.txt');
  const after = await fsdb.getItem('/x.txt');
  assert.equal(after, null);
});

test('rm with recursive deletes tree', async () => {
  const items = new Map([
    ['/d', { type: 'directory', path: '/d' }],
    ['/d/f', { type: 'file', path: '/d/f' }]
  ]);
  const { fsdb, calls } = mockFsdb(items);
  const fs = createJshGitFs({ fileSystemDB: fsdb });
  await fs.promises.rm('/d', { recursive: true });
  assert.ok(calls.deleteItem.some((c) => c.path === '/d' && c.recursive));
});

// ---------------------------------------------------------------------------
// symlink + readlink
// ---------------------------------------------------------------------------

test('symlink then readlink', async () => {
  const { fsdb } = mockFsdb();
  const fs = createJshGitFs({ fileSystemDB: fsdb });
  await fs.promises.symlink('/target', '/link');
  const target = await fs.promises.readlink('/link');
  assert.equal(target, '/target');
});

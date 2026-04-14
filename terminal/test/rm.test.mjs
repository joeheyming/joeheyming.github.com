import { test } from 'node:test';
import assert from 'node:assert/strict';
import rmCommand from '../commands/filesystem/rm.js';

const { handler: rmHandler } = rmCommand;

// ---------------------------------------------------------------------------
// rmStderrFromDeleteError (tested indirectly via rmHandler)
// ---------------------------------------------------------------------------

function mockTerminal(items = new Map()) {
  return {
    resolvePath(p) {
      if (p.startsWith('/')) return p;
      return `/cwd/${p}`;
    },
    async getFileSystemItem(path) {
      return items.get(path) || null;
    },
    fileSystemDB: {
      async deleteItem(path, recursive) {
        if (!items.has(path)) {
          throw new Error(`No such file or directory: ${path}`);
        }
        if (!recursive) {
          const item = items.get(path);
          if (item && item.type === 'directory') {
            const hasChildren = [...items.keys()].some(
              (k) => k !== path && k.startsWith(path + '/')
            );
            if (hasChildren) throw new Error(`Directory not empty: ${path}`);
          }
        }
        items.delete(path);
      }
    }
  };
}

// ---------------------------------------------------------------------------
// error message mapping
// ---------------------------------------------------------------------------

test('rm missing file without -f returns ENOENT-style message', async () => {
  const t = mockTerminal();
  const result = await rmHandler(t, ['nofile.txt']);
  assert.equal(result.exitCode, 1);
  assert.ok(result.stderr.includes("rm: cannot remove 'nofile.txt'"));
  assert.ok(result.stderr.includes('No such file or directory'));
});

test('rm directory without -r returns "Is a directory"', async () => {
  const items = new Map([['/cwd/dir', { type: 'directory', path: '/cwd/dir' }]]);
  const t = mockTerminal(items);
  const result = await rmHandler(t, ['dir']);
  assert.equal(result.exitCode, 1);
  assert.ok(result.stderr.includes("rm: cannot remove 'dir': Is a directory"));
});

test('rm directory not empty shows proper error', async () => {
  const items = new Map([
    ['/cwd/dir', { type: 'directory', path: '/cwd/dir' }],
    ['/cwd/dir/child', { type: 'file', path: '/cwd/dir/child' }]
  ]);
  const t = mockTerminal(items);
  const result = await rmHandler(t, ['-r', 'dir']);
  assert.equal(result.exitCode, 0);
});

// ---------------------------------------------------------------------------
// -f flag swallows missing file
// ---------------------------------------------------------------------------

test('rm -f silently ignores missing file', async () => {
  const t = mockTerminal();
  const result = await rmHandler(t, ['-f', 'nofile.txt']);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, '');
});

// ---------------------------------------------------------------------------
// rm -rf / easter egg
// ---------------------------------------------------------------------------

test('rm -rf / is blocked with safety message', async () => {
  const t = mockTerminal();
  const result = await rmHandler(t, ['-rf', '/']);
  assert.equal(result.exitCode, 1);
  assert.ok(result.stderr.includes('WHOA THERE'));
});

// ---------------------------------------------------------------------------
// glob wildcards pass safety check (not blocked as rm -rf /)
// ---------------------------------------------------------------------------

test('rm -rf with glob wildcard is not blocked', async () => {
  const items = new Map([['/cwd/*.txt', { type: 'file', path: '/cwd/*.txt' }]]);
  const t = mockTerminal(items);
  const result = await rmHandler(t, ['-rf', '*.txt']);
  assert.equal(result.exitCode, 0);
});

// ---------------------------------------------------------------------------
// missing operand
// ---------------------------------------------------------------------------

test('rm with no args returns missing operand', async () => {
  const t = mockTerminal();
  const result = await rmHandler(t, []);
  assert.equal(result.exitCode, 1);
  assert.ok(result.stderr.includes('missing operand'));
});

// ---------------------------------------------------------------------------
// --help
// ---------------------------------------------------------------------------

test('rm --help returns help text', async () => {
  const t = mockTerminal();
  const result = await rmHandler(t, ['--help']);
  assert.equal(result.exitCode, 0);
  assert.ok(result.stdout.length > 0);
});

// ---------------------------------------------------------------------------
// successful removal
// ---------------------------------------------------------------------------

test('rm removes a file successfully', async () => {
  const items = new Map([['/cwd/file.txt', { type: 'file', path: '/cwd/file.txt' }]]);
  const t = mockTerminal(items);
  const result = await rmHandler(t, ['file.txt']);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, '');
});

test('rm -r removes directory recursively', async () => {
  const items = new Map([
    ['/cwd/dir', { type: 'directory', path: '/cwd/dir' }],
    ['/cwd/dir/a.txt', { type: 'file', path: '/cwd/dir/a.txt' }]
  ]);
  const t = mockTerminal(items);
  const result = await rmHandler(t, ['-r', 'dir']);
  assert.equal(result.exitCode, 0);
});

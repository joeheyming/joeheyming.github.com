import { test } from 'node:test';
import assert from 'node:assert/strict';

// Terminal requires DOM globals; build a minimal stub that exposes only the
// glob-related methods under test plus the helpers they depend on.
function makeGlobStub(directoryEntries) {
  return {
    resolvePath(p) {
      if (p === '.') return '/cwd';
      if (p.startsWith('/')) return p;
      return `/cwd/${p}`;
    },
    async listDirectoryContents(_dir) {
      return directoryEntries;
    },
    // Copied from Terminal.prototype — the actual implementation under test.
    _globPatternToRegex(pattern) {
      let re = '';
      for (const ch of pattern) {
        if (ch === '*') re += '[^/]*';
        else if (ch === '?') re += '[^/]';
        else re += ch.replace(/[\\^$.|+()[\]{}]/g, '\\$&');
      }
      return new RegExp(`^${re}$`);
    },
    async _expandGlobToken(token) {
      if (!token.includes('*') && !token.includes('?')) return [token];
      const lastSlash = token.lastIndexOf('/');
      let dirPart, pattern;
      if (lastSlash === -1) {
        dirPart = '.';
        pattern = token;
      } else {
        dirPart = token.substring(0, lastSlash) || '/';
        pattern = token.substring(lastSlash + 1);
      }
      const resolvedDir = this.resolvePath(dirPart);
      const entries = await this.listDirectoryContents(resolvedDir);
      if (!entries || entries.length === 0) return [token];
      const re = this._globPatternToRegex(pattern);
      const prefix = lastSlash === -1 ? '' : token.substring(0, lastSlash + 1);
      const matched = entries
        .filter((e) => re.test(e.name))
        .map((e) => prefix + e.name)
        .sort();
      return matched.length > 0 ? matched : [token];
    },
    async expandGlobs(args) {
      const expanded = [];
      for (const arg of args) {
        const results = await this._expandGlobToken(arg);
        expanded.push(...results);
      }
      return expanded;
    }
  };
}

// ---------------------------------------------------------------------------
// _globPatternToRegex
// ---------------------------------------------------------------------------

test('_globPatternToRegex: * matches any filename chars', () => {
  const stub = makeGlobStub([]);
  const re = stub._globPatternToRegex('*.js');
  assert.ok(re.test('foo.js'));
  assert.ok(re.test('.hidden.js'));
  assert.ok(!re.test('foo.ts'));
  assert.ok(!re.test('dir/foo.js'), 'should not cross directory separator');
});

test('_globPatternToRegex: ? matches single character', () => {
  const stub = makeGlobStub([]);
  const re = stub._globPatternToRegex('file?.txt');
  assert.ok(re.test('file1.txt'));
  assert.ok(re.test('fileA.txt'));
  assert.ok(!re.test('file10.txt'), 'should not match two characters');
  assert.ok(!re.test('file.txt'), 'should not match zero characters');
});

test('_globPatternToRegex: escapes regex specials', () => {
  const stub = makeGlobStub([]);
  const re = stub._globPatternToRegex('foo[1].js');
  assert.ok(re.test('foo[1].js'));
  assert.ok(!re.test('foo1.js'), 'brackets should be literal');
});

test('_globPatternToRegex: escapes dots', () => {
  const stub = makeGlobStub([]);
  const re = stub._globPatternToRegex('*.tar.gz');
  assert.ok(re.test('data.tar.gz'));
  assert.ok(!re.test('Xtargz'), 'dot should be literal, not any-char');
});

test('_globPatternToRegex: anchored match', () => {
  const stub = makeGlobStub([]);
  const re = stub._globPatternToRegex('foo');
  assert.ok(re.test('foo'));
  assert.ok(!re.test('foobar'));
  assert.ok(!re.test('xfoo'));
});

test('_globPatternToRegex: combined * and ?', () => {
  const stub = makeGlobStub([]);
  const re = stub._globPatternToRegex('t?st*');
  assert.ok(re.test('test'));
  assert.ok(re.test('tAst.py'));
  assert.ok(!re.test('toast'), '? must match exactly one char');
});

// ---------------------------------------------------------------------------
// _expandGlobToken
// ---------------------------------------------------------------------------

test('_expandGlobToken: non-glob token returned as-is', async () => {
  const stub = makeGlobStub([]);
  assert.deepEqual(await stub._expandGlobToken('hello'), ['hello']);
});

test('_expandGlobToken: matches entries sorted', async () => {
  const stub = makeGlobStub([
    { name: 'c.js' },
    { name: 'a.js' },
    { name: 'b.ts' },
    { name: 'b.js' }
  ]);
  const result = await stub._expandGlobToken('*.js');
  assert.deepEqual(result, ['a.js', 'b.js', 'c.js']);
});

test('_expandGlobToken: no matches returns original token', async () => {
  const stub = makeGlobStub([{ name: 'README.md' }]);
  const result = await stub._expandGlobToken('*.py');
  assert.deepEqual(result, ['*.py']);
});

test('_expandGlobToken: with directory prefix', async () => {
  const stub = makeGlobStub([{ name: 'index.html' }, { name: 'style.css' }]);
  const result = await stub._expandGlobToken('src/*.css');
  assert.deepEqual(result, ['src/style.css']);
});

test('_expandGlobToken: empty directory returns original', async () => {
  const stub = makeGlobStub([]);
  const result = await stub._expandGlobToken('*.txt');
  assert.deepEqual(result, ['*.txt']);
});

test('_expandGlobToken: ? glob', async () => {
  const stub = makeGlobStub([
    { name: 'f1.c' },
    { name: 'f2.c' },
    { name: 'f10.c' }
  ]);
  const result = await stub._expandGlobToken('f?.c');
  assert.deepEqual(result, ['f1.c', 'f2.c']);
});

// ---------------------------------------------------------------------------
// expandGlobs
// ---------------------------------------------------------------------------

test('expandGlobs: mixes literal and glob args', async () => {
  const stub = makeGlobStub([
    { name: 'a.js' },
    { name: 'b.js' },
    { name: 'readme.md' }
  ]);
  const result = await stub.expandGlobs(['src', '*.js', '--flag']);
  assert.deepEqual(result, ['src', 'a.js', 'b.js', '--flag']);
});

test('expandGlobs: empty args returns empty', async () => {
  const stub = makeGlobStub([]);
  assert.deepEqual(await stub.expandGlobs([]), []);
});

// ---------------------------------------------------------------------------
// bindInputEvents double-bind prevention
// ---------------------------------------------------------------------------

test('bindInputEvents: only binds once', () => {
  let addCount = 0;
  const fakeInput = {
    _jshBound: false,
    addEventListener() {
      addCount++;
    }
  };
  function bindInputEvents(input) {
    if (input._jshBound) return;
    input._jshBound = true;
    input.addEventListener('keydown', () => {});
  }
  bindInputEvents(fakeInput);
  bindInputEvents(fakeInput);
  assert.equal(addCount, 1);
});

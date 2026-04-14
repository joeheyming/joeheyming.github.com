import { test } from 'node:test';
import assert from 'node:assert/strict';

// Verify the three ESM-converted modules export their expected symbols and do
// NOT attach anything to globalThis (the old IIFE-era window.* pattern).

test('jsh-git-cache: exports createBoundedGitCache and clearGitCache', async () => {
  const mod = await import('../lib/jsh-git-cache.js');
  assert.equal(typeof mod.createBoundedGitCache, 'function');
  assert.equal(typeof mod.clearGitCache, 'function');
});

test('jsh-git-fs: exports createJshGitFs', async () => {
  const mod = await import('../lib/jsh-git-fs.js');
  assert.equal(typeof mod.createJshGitFs, 'function');
});

test('jsh-git-http: exports createJshGitHttp', async () => {
  const mod = await import('../lib/jsh-git-http.js');
  assert.equal(typeof mod.createJshGitHttp, 'function');
});

test('createJshGitHttp returns object with request method', async () => {
  const { createJshGitHttp } = await import('../lib/jsh-git-http.js');
  const http = createJshGitHttp();
  assert.equal(typeof http.request, 'function');
});

test('no window.* side effects from ESM imports', async () => {
  assert.equal(globalThis.createJshGitFs, undefined, 'createJshGitFs should not be on global');
  assert.equal(globalThis.createJshGitHttp, undefined, 'createJshGitHttp should not be on global');
  assert.equal(
    globalThis.createBoundedGitCache,
    undefined,
    'createBoundedGitCache should not be on global'
  );
  assert.equal(globalThis.clearGitCache, undefined, 'clearGitCache should not be on global');
});

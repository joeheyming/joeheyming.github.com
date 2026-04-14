import { test } from 'node:test';
import assert from 'node:assert/strict';

// git.js references `window` in resolveCorsProxy / resolveGitCredential / loadIsoGit.
// Provide a minimal stub so the module can load in Node.
if (typeof globalThis.window === 'undefined') {
  globalThis.window = globalThis;
}

const { _testExports } = await import('../commands/system/git.js');
const { formatBytes, takeFlagValue, errResult, resolveCorsProxy, resolveGitCredential, gitAuthor } =
  _testExports;

// ---------------------------------------------------------------------------
// formatBytes
// ---------------------------------------------------------------------------

test('formatBytes: 0 bytes', () => {
  assert.equal(formatBytes(0), '0 B');
});

test('formatBytes: small bytes', () => {
  assert.equal(formatBytes(512), '512 B');
});

test('formatBytes: kilobytes', () => {
  assert.equal(formatBytes(1024), '1 KiB');
  assert.equal(formatBytes(2048), '2 KiB');
});

test('formatBytes: megabytes', () => {
  assert.equal(formatBytes(1048576), '1.0 MiB');
  assert.equal(formatBytes(10485760), '10.0 MiB');
});

test('formatBytes: boundary below KiB', () => {
  assert.equal(formatBytes(1023), '1023 B');
});

// ---------------------------------------------------------------------------
// takeFlagValue
// ---------------------------------------------------------------------------

test('takeFlagValue: flag present with value', () => {
  const { value, without } = takeFlagValue(['-m', 'init', 'foo'], '-m');
  assert.equal(value, 'init');
  assert.deepEqual(without, ['foo']);
});

test('takeFlagValue: flag missing', () => {
  const { value, without } = takeFlagValue(['add', '.'], '-m');
  assert.equal(value, null);
  assert.deepEqual(without, ['add', '.']);
});

test('takeFlagValue: flag at end without value', () => {
  const { value, without } = takeFlagValue(['commit', '-m'], '-m');
  assert.equal(value, null, 'no value when flag is last arg');
  assert.deepEqual(without, ['commit', '-m']);
});

test('takeFlagValue: extracts from middle', () => {
  const { value, without } = takeFlagValue(['commit', '-m', 'msg', '--amend'], '-m');
  assert.equal(value, 'msg');
  assert.deepEqual(without, ['commit', '--amend']);
});

// ---------------------------------------------------------------------------
// errResult
// ---------------------------------------------------------------------------

test('errResult: default exit code 1', () => {
  const r = errResult('something broke');
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, 'git: something broke');
  assert.equal(r.exitCode, 1);
});

test('errResult: custom exit code', () => {
  assert.equal(errResult('bad', 128).exitCode, 128);
});

// ---------------------------------------------------------------------------
// resolveCorsProxy
// ---------------------------------------------------------------------------

test('resolveCorsProxy: default when no env', () => {
  const t = { env: {} };
  assert.equal(resolveCorsProxy(t), 'https://cors.isomorphic-git.org');
});

test('resolveCorsProxy: env override', () => {
  const t = { env: { JSH_GIT_CORS_PROXY: 'https://my-proxy.example.com/' } };
  assert.equal(resolveCorsProxy(t), 'https://my-proxy.example.com');
});

test('resolveCorsProxy: disabled with 0', () => {
  const t = { env: { JSH_GIT_CORS_PROXY: '0' } };
  assert.equal(resolveCorsProxy(t), undefined);
});

test('resolveCorsProxy: disabled with false', () => {
  const t = { env: { JSH_GIT_CORS_PROXY: 'false' } };
  assert.equal(resolveCorsProxy(t), undefined);
});

test('resolveCorsProxy: disabled with off', () => {
  const t = { env: { JSH_GIT_CORS_PROXY: 'OFF' } };
  assert.equal(resolveCorsProxy(t), undefined);
});

test('resolveCorsProxy: trailing slashes stripped', () => {
  const t = { env: { JSH_GIT_CORS_PROXY: 'https://proxy.test///' } };
  assert.equal(resolveCorsProxy(t), 'https://proxy.test');
});

// ---------------------------------------------------------------------------
// resolveGitCredential
// ---------------------------------------------------------------------------

test('resolveGitCredential: GITHUB_TOKEN takes priority', () => {
  const t = { env: { GITHUB_TOKEN: 'gh_abc', GIT_TOKEN: 'git_xyz' } };
  assert.equal(resolveGitCredential(t), 'gh_abc');
});

test('resolveGitCredential: falls back to GIT_TOKEN', () => {
  const t = { env: { GIT_TOKEN: 'tok123' } };
  assert.equal(resolveGitCredential(t), 'tok123');
});

test('resolveGitCredential: null when no token', () => {
  const t = { env: {} };
  assert.equal(resolveGitCredential(t), null);
});

test('resolveGitCredential: trims whitespace', () => {
  const t = { env: { GITHUB_TOKEN: '  token_spaced  ' } };
  assert.equal(resolveGitCredential(t), 'token_spaced');
});

// ---------------------------------------------------------------------------
// gitAuthor
// ---------------------------------------------------------------------------

test('gitAuthor: uses env vars', () => {
  const t = { env: { GIT_AUTHOR_NAME: 'Alice', GIT_AUTHOR_EMAIL: 'a@b.c', USER: 'bob' } };
  const author = gitAuthor(t);
  assert.equal(author.name, 'Alice');
  assert.equal(author.email, 'a@b.c');
});

test('gitAuthor: falls back to USER', () => {
  const t = { env: { USER: 'testuser', HOSTNAME: 'myhost' } };
  const author = gitAuthor(t);
  assert.equal(author.name, 'testuser');
  assert.equal(author.email, 'testuser@myhost.local');
});

test('gitAuthor: defaults', () => {
  const t = { env: {} };
  const author = gitAuthor(t);
  assert.equal(author.name, 'user');
  assert.ok(author.email.startsWith('user@'));
});

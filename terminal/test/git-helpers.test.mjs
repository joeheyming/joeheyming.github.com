import { test } from 'node:test';
import assert from 'node:assert/strict';

// git.js references `window` in resolveCorsProxy / resolveGitCredential / loadIsoGit.
// Provide a minimal stub so the module can load in Node.
if (typeof globalThis.window === 'undefined') {
  globalThis.window = globalThis;
}

// Minimal localStorage shim so resolveCorsProxy / setStoredGitSetting can run
// outside the browser. Covers the same surface jsh-git-http reads/writes.
function makeLocalStorageStub() {
  const data = new Map();
  return {
    _data: data,
    getItem(k) {
      return data.has(k) ? data.get(k) : null;
    },
    setItem(k, v) {
      data.set(String(k), String(v));
    },
    removeItem(k) {
      data.delete(String(k));
    },
    clear() {
      data.clear();
    }
  };
}
// Node 25+ exposes a `localStorage` global object that throws on use unless
// you pass --localstorage-file; replace it unconditionally with our stub so
// tests don't depend on Node's experimental web-storage flags.
globalThis.localStorage = makeLocalStorageStub();

const { _testExports } = await import('../commands/system/git.js');
const {
  DEFAULT_CHECKOUT_BATCH_LARGE,
  DEFAULT_CORS_PROXY,
  MAX_CHECKOUT_BATCH,
  STORED_GIT_SETTING_KEYS,
  errResult,
  formatBytes,
  getStoredGitSetting,
  gitAuthor,
  parseCloneArgs,
  parseJshConfigArgs,
  resolveCheckoutBatchLarge,
  resolveCorsProxy,
  resolveGitCredential,
  setStoredGitSetting,
  takeFlagValue
} = _testExports;

function resetGitSettings() {
  setStoredGitSetting('corsProxy', null);
  setStoredGitSetting('maxPackBytes', null);
  setStoredGitSetting('checkoutBatch', null);
  delete globalThis.window.JSH_GIT_CORS_PROXY;
  delete globalThis.window.JSH_GIT_MAX_PACK_BYTES;
  delete globalThis.window.JSH_GIT_CHECKOUT_BATCH;
}

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

// ---------------------------------------------------------------------------
// resolveCorsProxy: localStorage layer (between window.JSH_GIT_* and the
// hard-coded default).
// ---------------------------------------------------------------------------

test('resolveCorsProxy: localStorage value used when env + window unset', () => {
  resetGitSettings();
  setStoredGitSetting('corsProxy', 'https://stored-proxy.example.com');
  try {
    assert.equal(resolveCorsProxy({ env: {} }), 'https://stored-proxy.example.com');
  } finally {
    resetGitSettings();
  }
});

test('resolveCorsProxy: localStorage "off" returns undefined', () => {
  resetGitSettings();
  setStoredGitSetting('corsProxy', 'off');
  try {
    assert.equal(resolveCorsProxy({ env: {} }), undefined);
  } finally {
    resetGitSettings();
  }
});

test('resolveCorsProxy: window override beats localStorage', () => {
  resetGitSettings();
  setStoredGitSetting('corsProxy', 'https://stored.example.com');
  globalThis.window.JSH_GIT_CORS_PROXY = 'https://win.example.com';
  try {
    assert.equal(resolveCorsProxy({ env: {} }), 'https://win.example.com');
  } finally {
    resetGitSettings();
  }
});

test('resolveCorsProxy: env beats both window and localStorage', () => {
  resetGitSettings();
  setStoredGitSetting('corsProxy', 'https://stored.example.com');
  globalThis.window.JSH_GIT_CORS_PROXY = 'https://win.example.com';
  try {
    assert.equal(
      resolveCorsProxy({ env: { JSH_GIT_CORS_PROXY: 'https://env.example.com' } }),
      'https://env.example.com'
    );
  } finally {
    resetGitSettings();
  }
});

test('resolveCorsProxy: built-in default when nothing is set', () => {
  resetGitSettings();
  assert.equal(resolveCorsProxy({ env: {} }), DEFAULT_CORS_PROXY);
});

test('resolveCorsProxy: localStorage value strips trailing slashes', () => {
  resetGitSettings();
  setStoredGitSetting('corsProxy', 'https://my-proxy.example.com////');
  try {
    assert.equal(resolveCorsProxy({ env: {} }), 'https://my-proxy.example.com');
  } finally {
    resetGitSettings();
  }
});

// ---------------------------------------------------------------------------
// setStoredGitSetting / getStoredGitSetting: shape + ignored unknown keys
// ---------------------------------------------------------------------------

test('STORED_GIT_SETTING_KEYS: only documented keys are persisted', () => {
  // Tokens deliberately not in this map — they're session-only.
  assert.deepEqual(Object.keys(STORED_GIT_SETTING_KEYS).sort(), [
    'checkoutBatch',
    'corsProxy',
    'maxPackBytes'
  ]);
});

test('setStoredGitSetting: round-trips a value', () => {
  resetGitSettings();
  assert.equal(setStoredGitSetting('maxPackBytes', '268435456'), true);
  assert.equal(getStoredGitSetting('maxPackBytes'), '268435456');
  resetGitSettings();
});

test('setStoredGitSetting: null clears the value', () => {
  resetGitSettings();
  setStoredGitSetting('corsProxy', 'https://x.example.com');
  setStoredGitSetting('corsProxy', null);
  assert.equal(getStoredGitSetting('corsProxy'), null);
});

test('setStoredGitSetting: unknown key is rejected', () => {
  assert.equal(setStoredGitSetting('not-a-setting', 'v'), false);
  assert.equal(getStoredGitSetting('not-a-setting'), null);
});

// ---------------------------------------------------------------------------
// parseJshConfigArgs: argument shapes for `git config --jsh ...`
// ---------------------------------------------------------------------------

test('parseJshConfigArgs: empty args → list', () => {
  assert.deepEqual(parseJshConfigArgs([]), { action: 'list' });
});

test('parseJshConfigArgs: --help', () => {
  assert.deepEqual(parseJshConfigArgs(['--help']), { action: 'help' });
  assert.deepEqual(parseJshConfigArgs(['-h']), { action: 'help' });
  assert.deepEqual(parseJshConfigArgs(['help']), { action: 'help' });
});

test('parseJshConfigArgs: get a known key', () => {
  assert.deepEqual(parseJshConfigArgs(['cors-proxy']), { action: 'get', key: 'cors-proxy' });
  assert.deepEqual(parseJshConfigArgs(['max-pack-mib']), { action: 'get', key: 'max-pack-mib' });
});

test('parseJshConfigArgs: set a value', () => {
  assert.deepEqual(parseJshConfigArgs(['cors-proxy', 'https://p.example.com']), {
    action: 'set',
    key: 'cors-proxy',
    raw: 'https://p.example.com'
  });
  assert.deepEqual(parseJshConfigArgs(['max-pack-mib', '384']), {
    action: 'set',
    key: 'max-pack-mib',
    raw: '384'
  });
});

test('parseJshConfigArgs: --unset / -u', () => {
  assert.deepEqual(parseJshConfigArgs(['cors-proxy', '--unset']), {
    action: 'unset',
    key: 'cors-proxy'
  });
  assert.deepEqual(parseJshConfigArgs(['max-pack-mib', '-u']), {
    action: 'unset',
    key: 'max-pack-mib'
  });
});

test('parseJshConfigArgs: unknown key returns error', () => {
  const r = parseJshConfigArgs(['bogus-key', 'v']);
  assert.equal(r.action, 'error');
  assert.match(r.message, /unknown setting/);
});

test('parseJshConfigArgs: too many args returns error', () => {
  const r = parseJshConfigArgs(['cors-proxy', 'https://a', 'https://b']);
  assert.equal(r.action, 'error');
  assert.match(r.message, /too many arguments/);
});

// ---------------------------------------------------------------------------
// parseCloneArgs: argv shapes for `git clone ...`
// ---------------------------------------------------------------------------

test('parseCloneArgs: bare url defaults to shallow + checkout', () => {
  const r = parseCloneArgs(['https://github.com/owner/repo.git']);
  assert.equal(r.ok, true);
  assert.equal(r.url, 'https://github.com/owner/repo.git');
  assert.equal(r.destArg, null);
  assert.equal(r.depth, 1, 'default depth = 1 (shallow)');
  assert.equal(r.noCheckout, false);
  assert.equal(r.forceCheckout, false);
  assert.equal(r.allBranches, false);
  assert.equal(r.fullHistory, false);
});

test('parseCloneArgs: missing url is a usage error', () => {
  const r = parseCloneArgs([]);
  assert.equal(r.ok, false);
  assert.match(r.error, /repository URL/);
});

test('parseCloneArgs: --depth N parses', () => {
  const r = parseCloneArgs(['--depth', '5', 'https://x.git']);
  assert.equal(r.ok, true);
  assert.equal(r.depth, 5);
});

test('parseCloneArgs: --depth garbage is rejected', () => {
  const r = parseCloneArgs(['--depth', 'abc', 'https://x.git']);
  assert.equal(r.ok, false);
  assert.match(r.error, /positive integer/);
});

test('parseCloneArgs: --full clears depth', () => {
  const r = parseCloneArgs(['--full', 'https://x.git']);
  assert.equal(r.ok, true);
  assert.equal(r.depth, undefined);
  assert.equal(r.fullHistory, true);
});

test('parseCloneArgs: --no-checkout', () => {
  const r = parseCloneArgs(['--no-checkout', 'https://x.git']);
  assert.equal(r.ok, true);
  assert.equal(r.noCheckout, true);
  assert.equal(r.forceCheckout, false);
});

test('parseCloneArgs: --force-checkout', () => {
  const r = parseCloneArgs(['--force-checkout', 'https://x.git']);
  assert.equal(r.ok, true);
  assert.equal(r.forceCheckout, true);
  assert.equal(r.noCheckout, false);
});

test('parseCloneArgs: --no-checkout + --force-checkout is a usage error', () => {
  const r = parseCloneArgs(['--no-checkout', '--force-checkout', 'https://x.git']);
  assert.equal(r.ok, false);
  assert.match(r.error, /mutually exclusive/);
});

test('parseCloneArgs: --all-branches', () => {
  const r = parseCloneArgs(['--all-branches', 'https://x.git']);
  assert.equal(r.ok, true);
  assert.equal(r.allBranches, true);
});

test('parseCloneArgs: explicit dest path', () => {
  const r = parseCloneArgs(['https://x.git', 'my/path']);
  assert.equal(r.ok, true);
  assert.equal(r.url, 'https://x.git');
  assert.equal(r.destArg, 'my/path');
});

test('parseCloneArgs: flags can come anywhere', () => {
  const r = parseCloneArgs(['https://x.git', '--depth', '3', 'dest', '--no-checkout']);
  assert.equal(r.ok, true);
  assert.equal(r.url, 'https://x.git');
  assert.equal(r.destArg, 'dest');
  assert.equal(r.depth, 3);
  assert.equal(r.noCheckout, true);
});

// ---------------------------------------------------------------------------
// resolveCheckoutBatchLarge: env > window > localStorage > default
// ---------------------------------------------------------------------------

test('resolveCheckoutBatchLarge: default when nothing set', () => {
  resetGitSettings();
  assert.equal(resolveCheckoutBatchLarge({ env: {} }), DEFAULT_CHECKOUT_BATCH_LARGE);
});

test('resolveCheckoutBatchLarge: localStorage value', () => {
  resetGitSettings();
  setStoredGitSetting('checkoutBatch', '10');
  try {
    assert.equal(resolveCheckoutBatchLarge({ env: {} }), 10);
  } finally {
    resetGitSettings();
  }
});

test('resolveCheckoutBatchLarge: window beats localStorage', () => {
  resetGitSettings();
  setStoredGitSetting('checkoutBatch', '10');
  globalThis.window.JSH_GIT_CHECKOUT_BATCH = 50;
  try {
    assert.equal(resolveCheckoutBatchLarge({ env: {} }), 50);
  } finally {
    resetGitSettings();
  }
});

test('resolveCheckoutBatchLarge: env beats window + localStorage', () => {
  resetGitSettings();
  setStoredGitSetting('checkoutBatch', '10');
  globalThis.window.JSH_GIT_CHECKOUT_BATCH = 50;
  try {
    assert.equal(resolveCheckoutBatchLarge({ env: { JSH_GIT_CHECKOUT_BATCH: '5' } }), 5);
  } finally {
    resetGitSettings();
  }
});

test('resolveCheckoutBatchLarge: out-of-range values are ignored (fall through)', () => {
  resetGitSettings();
  setStoredGitSetting('checkoutBatch', '0');
  try {
    assert.equal(resolveCheckoutBatchLarge({ env: {} }), DEFAULT_CHECKOUT_BATCH_LARGE);
  } finally {
    resetGitSettings();
  }
  resetGitSettings();
  setStoredGitSetting('checkoutBatch', String(MAX_CHECKOUT_BATCH + 1));
  try {
    assert.equal(resolveCheckoutBatchLarge({ env: {} }), DEFAULT_CHECKOUT_BATCH_LARGE);
  } finally {
    resetGitSettings();
  }
});

test('resolveCheckoutBatchLarge: garbage values are ignored', () => {
  resetGitSettings();
  setStoredGitSetting('checkoutBatch', 'not-a-number');
  try {
    assert.equal(resolveCheckoutBatchLarge({ env: {} }), DEFAULT_CHECKOUT_BATCH_LARGE);
  } finally {
    resetGitSettings();
  }
});

// ---------------------------------------------------------------------------
// parseJshConfigArgs: checkout-batch is now a recognized key
// ---------------------------------------------------------------------------

test('parseJshConfigArgs: checkout-batch get', () => {
  assert.deepEqual(parseJshConfigArgs(['checkout-batch']), {
    action: 'get',
    key: 'checkout-batch'
  });
});

test('parseJshConfigArgs: checkout-batch set', () => {
  assert.deepEqual(parseJshConfigArgs(['checkout-batch', '10']), {
    action: 'set',
    key: 'checkout-batch',
    raw: '10'
  });
});

test('parseJshConfigArgs: checkout-batch unset', () => {
  assert.deepEqual(parseJshConfigArgs(['checkout-batch', '--unset']), {
    action: 'unset',
    key: 'checkout-batch'
  });
});

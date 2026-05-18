import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSudoArgv } from '../commands/system/sudo.js';
import { SecurityManager } from '../core/security-manager.js';

test('parseSudoArgv: bare cmd defaults user=root', () => {
  const r = parseSudoArgv(['echo', 'hi']);
  assert.equal(r.ok, true);
  assert.equal(r.user, 'root');
  assert.deepEqual(r.cmd, ['echo', 'hi']);
});

test('parseSudoArgv: -u USER', () => {
  const r = parseSudoArgv(['-u', 'alice', 'id']);
  assert.equal(r.ok, true);
  assert.equal(r.user, 'alice');
  assert.deepEqual(r.cmd, ['id']);
});

test('parseSudoArgv: --non-interactive sets flag', () => {
  const r = parseSudoArgv(['--non-interactive', 'whoami']);
  assert.equal(r.ok, true);
  assert.equal(r.nonInteractive, true);
});

test('parseSudoArgv: -u missing arg errors', () => {
  const r = parseSudoArgv(['-u']);
  assert.equal(r.ok, false);
});

test('parseSudoArgv: -- terminates options', () => {
  const r = parseSudoArgv(['--', '-u', '/bin/false']);
  assert.equal(r.ok, true);
  assert.deepEqual(r.cmd, ['-u', '/bin/false']);
});

test('SecurityManager: hash + verify roundtrip', async () => {
  // Minimal fake kernel that satisfies init.
  const fakeKernel = {
    log: () => {},
    on: () => {},
    processManager: { getProcess: () => null, getAllProcesses: () => [] }
  };
  const sm = new SecurityManager(fakeKernel);
  const hash = await sm.hashPassword('s3cret');
  assert.ok(typeof hash === 'string' && hash.includes('$'));
  assert.equal(await sm.verifyPassword('s3cret', hash), true);
  assert.equal(await sm.verifyPassword('wrong', hash), false);
});

test('SecurityManager: legacy plaintext hashes still verify', async () => {
  const fakeKernel = { log: () => {}, on: () => {}, processManager: { getProcess: () => null, getAllProcesses: () => [] } };
  const sm = new SecurityManager(fakeKernel);
  assert.equal(await sm.verifyPassword('demo', 'demo'), true);
  assert.equal(await sm.verifyPassword('demo', 'other'), false);
});

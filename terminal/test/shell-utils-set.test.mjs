import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSetArgv } from '../commands/system/set.js';

test('parseSetArgv: no args lists options', () => {
  const r = parseSetArgv([]);
  assert.equal(r.ok, true);
  assert.equal(r.list, true);
});

test('parseSetArgv: -e enables errexit', () => {
  const r = parseSetArgv(['-e']);
  assert.equal(r.ok, true);
  assert.deepEqual(r.changes, [{ name: 'errexit', value: true }]);
});

test('parseSetArgv: +e disables errexit', () => {
  const r = parseSetArgv(['+e']);
  assert.equal(r.ok, true);
  assert.deepEqual(r.changes, [{ name: 'errexit', value: false }]);
});

test('parseSetArgv: -o pipefail', () => {
  const r = parseSetArgv(['-o', 'pipefail']);
  assert.equal(r.ok, true);
  assert.deepEqual(r.changes, [{ name: 'pipefail', value: true }]);
});

test('parseSetArgv: +o pipefail', () => {
  const r = parseSetArgv(['+o', 'pipefail']);
  assert.equal(r.ok, true);
  assert.deepEqual(r.changes, [{ name: 'pipefail', value: false }]);
});

test('parseSetArgv: combined -eu', () => {
  const r = parseSetArgv(['-eu']);
  assert.equal(r.ok, true);
  assert.deepEqual(r.changes, [
    { name: 'errexit', value: true },
    { name: 'nounset', value: true }
  ]);
});

test('parseSetArgv: -o without arg errors', () => {
  const r = parseSetArgv(['-o']);
  assert.equal(r.ok, false);
  assert.match(r.stderr, /usage/);
  assert.equal(r.exitCode, 2);
});

test('parseSetArgv: -o unknown option errors', () => {
  const r = parseSetArgv(['-o', 'banana']);
  assert.equal(r.ok, false);
  assert.match(r.stderr, /invalid/);
});

test('parseSetArgv: --help', () => {
  const r = parseSetArgv(['--help']);
  assert.equal(r.ok, true);
  assert.equal(r.help, true);
});

test('parseSetArgv: -z unknown short option errors', () => {
  const r = parseSetArgv(['-z']);
  assert.equal(r.ok, false);
});

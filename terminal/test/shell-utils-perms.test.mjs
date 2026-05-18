import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  permitItem,
  PERM_READ,
  PERM_WRITE,
  PERM_EXEC
} from '../../os/filesystem-db-perms.js';

const me = { uid: 1000, gid: 1000, groups: [] };
const other = { uid: 1001, gid: 1001, groups: [] };
const sameGroup = { uid: 1001, gid: 1000, groups: [] };
const supplementary = { uid: 1001, gid: 9999, groups: [1000] };
const root = { uid: 0, gid: 0, groups: [] };

test('permitItem: owner read on 0o600', () => {
  const item = { type: 'file', mode: 0o600, uid: 1000, gid: 1000 };
  assert.equal(permitItem(item, 'read', me), true);
  assert.equal(permitItem(item, 'read', other), false);
});

test('permitItem: group read via primary gid', () => {
  const item = { type: 'file', mode: 0o640, uid: 1000, gid: 1000 };
  assert.equal(permitItem(item, 'read', sameGroup), true);
  assert.equal(permitItem(item, 'write', sameGroup), false);
});

test('permitItem: group via supplementary group', () => {
  const item = { type: 'file', mode: 0o660, uid: 1000, gid: 1000 };
  assert.equal(permitItem(item, 'read', supplementary), true);
  assert.equal(permitItem(item, 'write', supplementary), true);
});

test('permitItem: other class', () => {
  const item = { type: 'file', mode: 0o644, uid: 1000, gid: 1000 };
  assert.equal(permitItem(item, 'read', other), true);
  assert.equal(permitItem(item, 'write', other), false);
});

test('permitItem: 0o000 denies everyone (except root)', () => {
  const item = { type: 'file', mode: 0o000, uid: 1000, gid: 1000 };
  assert.equal(permitItem(item, 'read', me), false);
  assert.equal(permitItem(item, 'write', me), false);
  assert.equal(permitItem(item, 'read', root), true);
});

test('permitItem: defaults to 0o644 file / 0o755 dir', () => {
  const file = { type: 'file', uid: 1000, gid: 1000 };
  const dir = { type: 'directory', uid: 1000, gid: 1000 };
  assert.equal(permitItem(file, 'read', other), true);
  assert.equal(permitItem(file, 'execute', other), false);
  assert.equal(permitItem(dir, 'execute', other), true);
});

test('permitItem: execute bit on owner 0o700', () => {
  const item = { type: 'file', mode: 0o700, uid: 1000, gid: 1000 };
  assert.equal(permitItem(item, 'execute', me), true);
  assert.equal(permitItem(item, 'execute', other), false);
});

test('permitItem: root always allowed', () => {
  const item = { type: 'file', mode: 0o000, uid: 1, gid: 1 };
  assert.equal(permitItem(item, 'read', root), true);
  assert.equal(permitItem(item, 'write', root), true);
  assert.equal(permitItem(item, 'execute', root), true);
});

test('PERM_* constants are POSIX values', () => {
  assert.equal(PERM_READ, 4);
  assert.equal(PERM_WRITE, 2);
  assert.equal(PERM_EXEC, 1);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ShellCore } from '../lib/shell-core.js';

test('splitShellList: ; inside (...) is not split', () => {
  const r = ShellCore.splitShellList('(cd /tmp; ls); echo done');
  assert.equal(r.ok, true);
  assert.deepEqual(r.pipelines, ['(cd /tmp; ls)', 'echo done']);
  assert.deepEqual(r.ops, [';']);
});

test('splitShellList: && inside (...) is not split', () => {
  const r = ShellCore.splitShellList('(a && b); c');
  assert.equal(r.ok, true);
  assert.deepEqual(r.pipelines, ['(a && b)', 'c']);
});

test('splitShellList: nested parens balanced', () => {
  const r = ShellCore.splitShellList('(a; (b; c)); d');
  assert.equal(r.ok, true);
  assert.deepEqual(r.pipelines, ['(a; (b; c))', 'd']);
});

test('splitShellList: parenthesized inside quotes still ignored', () => {
  const r = ShellCore.splitShellList('echo "a; b"; echo c');
  assert.equal(r.ok, true);
  assert.deepEqual(r.pipelines, ['echo "a; b"', 'echo c']);
});

test('splitShellList: bare subshell, no list ops', () => {
  const r = ShellCore.splitShellList('(echo hi)');
  assert.equal(r.ok, true);
  assert.deepEqual(r.pipelines, ['(echo hi)']);
  assert.deepEqual(r.ops, []);
});

test('splitShellList: bare & is background separator (A5)', () => {
  const r = ShellCore.splitShellList('long_job & echo done');
  assert.equal(r.ok, true);
  assert.deepEqual(r.pipelines, ['long_job', 'echo done']);
  assert.deepEqual(r.ops, ['&']);
});

test('splitShellList: && still parses as AND (A5)', () => {
  const r = ShellCore.splitShellList('a && b');
  assert.equal(r.ok, true);
  assert.deepEqual(r.pipelines, ['a', 'b']);
  assert.deepEqual(r.ops, ['&&']);
});

test('splitShellList: trailing & is valid (no following pipeline)', () => {
  const r = ShellCore.splitShellList('long_job &');
  assert.equal(r.ok, true);
  assert.deepEqual(r.pipelines, ['long_job', '']);
  assert.deepEqual(r.ops, ['&']);
});

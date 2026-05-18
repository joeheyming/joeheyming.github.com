import { test } from 'node:test';
import assert from 'node:assert/strict';
import { XargsLib } from '../commands/system/xargs-lib.js';

const {
  parseXargsArgv,
  xargsDecodeDelim,
  xargsSplitOnDelim
} = XargsLib;

test('parseXargsArgv: -d \\n sets delim', () => {
  const r = parseXargsArgv(['-d', '\\n', 'echo']);
  assert.equal(r.ok, true);
  assert.equal(r.delim, '\n');
});

test('parseXargsArgv: --delimiter=\\t', () => {
  const r = parseXargsArgv(['--delimiter=\\t', 'echo']);
  assert.equal(r.ok, true);
  assert.equal(r.delim, '\t');
});

test('parseXargsArgv: -d , (comma)', () => {
  const r = parseXargsArgv(['-d', ',', 'echo']);
  assert.equal(r.ok, true);
  assert.equal(r.delim, ',');
});

test('parseXargsArgv: -d \\0 sets nullDelim', () => {
  const r = parseXargsArgv(['-d', '\\0', 'echo']);
  assert.equal(r.ok, true);
  assert.equal(r.delim, '\0');
  assert.equal(r.nullDelim, true);
});

test('parseXargsArgv: -0 implies -d \\0', () => {
  const r = parseXargsArgv(['-0', 'echo']);
  assert.equal(r.ok, true);
  assert.equal(r.nullDelim, true);
  assert.equal(r.delim, '\0');
});

test('parseXargsArgv: -P N treated as -P 1 (stub)', () => {
  const r = parseXargsArgv(['-P', '4', 'echo']);
  assert.equal(r.ok, true);
  assert.equal(r.maxProcs, 1);
});

test('parseXargsArgv: -P with invalid number errors', () => {
  const r = parseXargsArgv(['-P', 'abc', 'echo']);
  assert.equal(r.ok, false);
});

test('parseXargsArgv: -d missing arg errors', () => {
  const r = parseXargsArgv(['-d']);
  assert.equal(r.ok, false);
});

test('xargsDecodeDelim: handles \\n, \\t, \\0, \\\\', () => {
  assert.equal(xargsDecodeDelim('\\n'), '\n');
  assert.equal(xargsDecodeDelim('\\t'), '\t');
  assert.equal(xargsDecodeDelim('\\0'), '\0');
  assert.equal(xargsDecodeDelim('\\\\'), '\\');
  assert.equal(xargsDecodeDelim('a,b'), 'a,b');
});

test('xargsSplitOnDelim: splits and drops trailing empty', () => {
  assert.deepEqual(xargsSplitOnDelim('a,b,c', ','), ['a', 'b', 'c']);
  assert.deepEqual(xargsSplitOnDelim('a,b,c,', ','), ['a', 'b', 'c']);
  assert.deepEqual(xargsSplitOnDelim('', ','), []);
});

test('xargsSplitOnDelim: preserves embedded whitespace within field', () => {
  assert.deepEqual(xargsSplitOnDelim('a b,c d', ','), ['a b', 'c d']);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDuArgv, humanSize as duHuman } from '../commands/filesystem/du.js';
import { parseDfArgv, humanSize as dfHuman } from '../commands/filesystem/df.js';
import { parseFreeArgv, humanSize as freeHuman } from '../commands/system/free.js';

test('parseDuArgv: defaults', () => {
  const r = parseDuArgv([]);
  assert.equal(r.ok, true);
  assert.equal(r.blockSize, 1024);
  assert.deepEqual(r.operands, ['.']);
});

test('parseDuArgv: -sh combined', () => {
  const r = parseDuArgv(['-sh', '/etc']);
  assert.equal(r.ok, true);
  assert.equal(r.summarize, true);
  assert.equal(r.humanReadable, true);
  assert.deepEqual(r.operands, ['/etc']);
});

test('parseDuArgv: --max-depth=2', () => {
  const r = parseDuArgv(['--max-depth=2']);
  assert.equal(r.ok, true);
  assert.equal(r.maxDepth, 2);
});

test('parseDuArgv: -B 4096', () => {
  const r = parseDuArgv(['-B', '4096']);
  assert.equal(r.ok, true);
  assert.equal(r.blockSize, 4096);
});

test('duHuman: K/M/G', () => {
  assert.equal(duHuman(0), '0');
  assert.equal(duHuman(1024), '1.0K');
  assert.equal(duHuman(1024 * 1024), '1.0M');
  assert.equal(duHuman(1024 * 1024 * 10), '10M');
});

test('parseDfArgv: -h -T', () => {
  const r = parseDfArgv(['-h', '-T']);
  assert.equal(r.ok, true);
  assert.equal(r.humanReadable, true);
  assert.equal(r.printType, true);
});

test('parseDfArgv: --total / --inodes', () => {
  const r = parseDfArgv(['--total', '--inodes']);
  assert.equal(r.ok, true);
  assert.equal(r.total, true);
  assert.equal(r.inodes, true);
});

test('dfHuman: scales', () => {
  assert.equal(dfHuman(0), '0B');
  assert.equal(dfHuman(1024 * 1024 * 1024 * 5), '5.0G');
});

test('parseFreeArgv: -m sets mebibytes', () => {
  const r = parseFreeArgv(['-m']);
  assert.equal(r.ok, true);
  assert.equal(r.scale, 1024 * 1024);
});

test('parseFreeArgv: -h human readable', () => {
  const r = parseFreeArgv(['-h']);
  assert.equal(r.ok, true);
  assert.equal(r.humanReadable, true);
});

test('parseFreeArgv: -bh combined', () => {
  const r = parseFreeArgv(['-bh']);
  assert.equal(r.ok, true);
  assert.equal(r.scale, 1);
  assert.equal(r.humanReadable, true);
});

test('parseFreeArgv: invalid option errors', () => {
  const r = parseFreeArgv(['-Z']);
  assert.equal(r.ok, false);
});

test('freeHuman: scales', () => {
  assert.equal(freeHuman(0), '0');
  assert.equal(freeHuman(1024 * 1024), '1.0M');
});

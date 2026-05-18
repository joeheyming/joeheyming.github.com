import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLoggerArgv } from '../commands/system/logger.js';
import { parseDmesgArgv } from '../commands/system/dmesg.js';

test('parseLoggerArgv: bare message', () => {
  const r = parseLoggerArgv(['hello', 'world']);
  assert.equal(r.ok, true);
  assert.equal(r.message, 'hello world');
});

test('parseLoggerArgv: -t TAG and -p PRI', () => {
  const r = parseLoggerArgv(['-t', 'cron', '-p', 'user.notice', 'fired']);
  assert.equal(r.ok, true);
  assert.equal(r.tag, 'cron');
  assert.equal(r.priority, 'user.notice');
  assert.equal(r.message, 'fired');
});

test('parseLoggerArgv: -s/-i/-f flags', () => {
  const r = parseLoggerArgv(['-s', '-i', '-f', 'data.txt']);
  assert.equal(r.ok, true);
  assert.equal(r.stderr, true);
  assert.equal(r.inclPid, true);
  assert.equal(r.file, 'data.txt');
});

test('parseLoggerArgv: -t with no arg errors', () => {
  const r = parseLoggerArgv(['-t']);
  assert.equal(r.ok, false);
});

test('parseDmesgArgv: -c / --read-clear', () => {
  const r1 = parseDmesgArgv(['-c']);
  assert.equal(r1.ok, true);
  assert.equal(r1.readClear, true);
  const r2 = parseDmesgArgv(['--read-clear']);
  assert.equal(r2.ok, true);
  assert.equal(r2.readClear, true);
});

test('parseDmesgArgv: -C / --clear sets clearOnly', () => {
  const r = parseDmesgArgv(['-C']);
  assert.equal(r.ok, true);
  assert.equal(r.clearOnly, true);
});

test('parseDmesgArgv: -H / -T treated as human', () => {
  assert.equal(parseDmesgArgv(['-H']).human, true);
  assert.equal(parseDmesgArgv(['-T']).human, true);
});

test('parseDmesgArgv: unknown option errors', () => {
  const r = parseDmesgArgv(['--bogus']);
  assert.equal(r.ok, false);
});

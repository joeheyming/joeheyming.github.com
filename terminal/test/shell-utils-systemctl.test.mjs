import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJournalctlArgv } from '../commands/system/journalctl.js';

test('parseJournalctlArgv: defaults', () => {
  const r = parseJournalctlArgv([]);
  assert.equal(r.ok, true);
  assert.equal(r.lines, null);
  assert.equal(r.unit, null);
  assert.equal(r.follow, false);
});

test('parseJournalctlArgv: -n N', () => {
  const r = parseJournalctlArgv(['-n', '20']);
  assert.equal(r.ok, true);
  assert.equal(r.lines, 20);
});

test('parseJournalctlArgv: --lines=N', () => {
  const r = parseJournalctlArgv(['--lines=50']);
  assert.equal(r.ok, true);
  assert.equal(r.lines, 50);
});

test('parseJournalctlArgv: -u UNIT and --unit=UNIT', () => {
  assert.equal(parseJournalctlArgv(['-u', 'cron']).unit, 'cron');
  assert.equal(parseJournalctlArgv(['--unit=cron']).unit, 'cron');
});

test('parseJournalctlArgv: --since=PREFIX', () => {
  const r = parseJournalctlArgv(['--since=2024-01-01']);
  assert.equal(r.ok, true);
  assert.equal(r.since, '2024-01-01');
});

test('parseJournalctlArgv: -f sets follow', () => {
  const r = parseJournalctlArgv(['-f']);
  assert.equal(r.ok, true);
  assert.equal(r.follow, true);
});

test('parseJournalctlArgv: invalid -n errors', () => {
  const r = parseJournalctlArgv(['-n', 'abc']);
  assert.equal(r.ok, false);
});

test('parseJournalctlArgv: unknown option errors', () => {
  const r = parseJournalctlArgv(['--bogus']);
  assert.equal(r.ok, false);
});

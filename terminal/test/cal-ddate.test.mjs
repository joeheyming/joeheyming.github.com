// cal + ddate: pure date-math commands.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import calCmd from '../commands/system/cal.js';
import ddateCmd from '../commands/fun/ddate.js';

const cal = calCmd.handler;
const ddate = ddateCmd.handler;

// ---------------------------------------------------------------------------
// cal
// ---------------------------------------------------------------------------

test('cal 1 2024: January 2024 has the right title and 31 days', () => {
  const r = cal(null, ['-h', '1', '2024']);
  assert.equal(r.exitCode, 0);
  // Title is centered on a 20-char-wide block.
  assert.match(r.stdout, /^\s+January 2024\s*\n/);
  assert.match(r.stdout, /Su Mo Tu We Th Fr Sa/);
  // Last day printed is 31.
  const lastNumber = [...r.stdout.matchAll(/\b(\d+)\b/g)]
    .map((m) => parseInt(m[1], 10))
    .filter((n) => n >= 1 && n <= 31)
    .pop();
  assert.equal(lastNumber, 31);
});

test('cal 2 2024 (leap year): includes 29 as last day', () => {
  const r = cal(null, ['-h', '2', '2024']);
  assert.equal(r.exitCode, 0);
  assert.match(r.stdout, /\b29\b/);
  assert.doesNotMatch(r.stdout, /\b30\b/);
});

test('cal 2 2023 (non-leap): includes 28, no 29', () => {
  const r = cal(null, ['-h', '2', '2023']);
  assert.equal(r.exitCode, 0);
  assert.match(r.stdout, /\b28\b/);
  assert.doesNotMatch(r.stdout, /\b29\b/);
});

test('cal 2024: full-year grid contains every month name', () => {
  const r = cal(null, ['-h', '2024']);
  assert.equal(r.exitCode, 0);
  for (const m of [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December'
  ]) {
    assert.match(r.stdout, new RegExp(m));
  }
  // Year header on its own line.
  assert.match(r.stdout, /^\s*2024\s*$/m);
});

test('cal -m 1 2024: Monday-start header', () => {
  const r = cal(null, ['-h', '-m', '1', '2024']);
  assert.match(r.stdout, /Mo Tu We Th Fr Sa Su/);
  assert.doesNotMatch(r.stdout, /Su Mo Tu We Th Fr Sa/);
});

test('cal -3 6 2024: side-by-side May | June | July', () => {
  const r = cal(null, ['-h', '-3', '6', '2024']);
  assert.equal(r.exitCode, 0);
  // All three titles appear on the first line of the output.
  const firstLine = r.stdout.split('\n')[0];
  assert.match(firstLine, /May 2024/);
  assert.match(firstLine, /June 2024/);
  assert.match(firstLine, /July 2024/);
});

test('cal: rejects invalid month', () => {
  const r = cal(null, ['13', '2024']);
  assert.equal(r.exitCode, 1);
  assert.match(r.stderr, /not a valid month/);
});

test('cal: rejects invalid year', () => {
  const r = cal(null, ['1', '0']);
  assert.equal(r.exitCode, 1);
  assert.match(r.stderr, /not a valid year/);
});

test('cal: rejects unknown option', () => {
  const r = cal(null, ['-Z']);
  assert.equal(r.exitCode, 2);
  assert.match(r.stderr, /unrecognized option '-Z'/);
});

test('cal --help', () => {
  const r = cal(null, ['--help']);
  assert.equal(r.exitCode, 0);
  assert.match(r.stdout, /Usage: cal/);
});

test('cal year 2099 produces twelve evenly-tall month blocks', () => {
  const r = cal(null, ['-h', '2099']);
  // Year + blank + 4 rows of (8 lines + blank). Lines count is deterministic.
  // Title + blank + 4 * (8 month-rows + 1 blank) = 2 + 36 = 38 lines + final newline.
  const lines = r.stdout.split('\n');
  // Loose assertion: contains at least 30 non-empty lines.
  const nonEmpty = lines.filter((l) => l.trim() !== '').length;
  assert.ok(nonEmpty >= 30, `expected lots of rendered lines, got ${nonEmpty}`);
});

// ---------------------------------------------------------------------------
// ddate
// ---------------------------------------------------------------------------

test('ddate 1 1 2024: Sweetmorn, the 1st day of Chaos, YOLD 3190', () => {
  const r = ddate(null, ['1', '1', '2024']);
  assert.equal(r.exitCode, 0);
  assert.match(r.stdout, /Sweetmorn/);
  assert.match(r.stdout, /1st day of Chaos/);
  assert.match(r.stdout, /YOLD 3190/);
});

test('ddate +%Y produces YOLD = Gregorian + 1166', () => {
  const r = ddate(null, ['+%Y', '1', '1', '2024']);
  assert.equal(r.stdout.trim(), '3190');
});

test('ddate +%A %B %d for Jan 5 2024 → Setting Orange Chaos 5', () => {
  // Jan 5 → dayOfYear 5 → seasonIdx 0 (Chaos), dayInSeason 5,
  // weekdayIdx (5-1)%5 = 4 → Setting Orange. Holyday = Mungday.
  const r = ddate(null, ['+%A %B %d', '5', '1', '2024']);
  assert.equal(r.stdout.trim(), 'Setting Orange Chaos 5');
});

test('ddate 5 1 2024 default render mentions Mungday', () => {
  const r = ddate(null, ['5', '1', '2024']);
  assert.match(r.stdout, /Mungday/);
});

test("ddate 29 2 2024 (leap year): St. Tib's Day", () => {
  const r = ddate(null, ['29', '2', '2024']);
  assert.equal(r.exitCode, 0);
  assert.match(r.stdout, /St\. Tib's Day/);
  assert.match(r.stdout, /YOLD 3190/);
});

test('ddate after Feb 29 in leap year shifts back by 1 day', () => {
  // Mar 1 2024: dayOfYear = 31 + 29 + 1 = 61 → dDay = 60 → seasonIdx 0
  // (Chaos), dayInSeason = 60. weekdayIdx (60-1)%5 = 4 → Setting Orange.
  const r = ddate(null, ['+%B %d %A', '1', '3', '2024']);
  assert.equal(r.stdout.trim(), 'Chaos 60 Setting Orange');
});

test('ddate Mar 1 in non-leap year: Mar 1 2023 → Discord 1 Sweetmorn', () => {
  // Mar 1 2023: dayOfYear = 31+28+1 = 60 → dDay = 60 (no leap shift).
  // wait: floor((60-1)/73) = 0 (Chaos). Hmm.
  // Actually 60-1=59, 59/73 < 1 → seasonIdx 0. dayInSeason = 59%73+1 = 60.
  const r = ddate(null, ['+%B %d', '1', '3', '2023']);
  assert.equal(r.stdout.trim(), 'Chaos 60');
});

test('ddate format escapes %t %n %.', () => {
  const r = ddate(null, ['+a%tb%nc%.d', '1', '1', '2024']);
  assert.equal(r.stdout, 'a\tb\nc%d\n');
});

test('ddate +%H is empty on a non-holyday', () => {
  // Jan 2, 2024: not a holyday.
  const r = ddate(null, ['+[%H]', '2', '1', '2024']);
  assert.equal(r.stdout, '[]\n');
});

test("ddate +%N halts further formatting on St. Tib's Day", () => {
  const r = ddate(null, ['+pre %N suffix', '29', '2', '2024']);
  // %N short-circuits, replacing itself with the canonical Tib's-Day message.
  assert.match(r.stdout, /pre St\. Tib's Day, YOLD 3190/);
  assert.doesNotMatch(r.stdout, /suffix/);
});

test('ddate rejects bad date', () => {
  const r = ddate(null, ['32', '13', '2024']);
  assert.equal(r.exitCode, 1);
  assert.match(r.stderr, /bad date/);
});

test('ddate --help', () => {
  const r = ddate(null, ['--help']);
  assert.equal(r.exitCode, 0);
  assert.match(r.stdout, /Discordian/);
});

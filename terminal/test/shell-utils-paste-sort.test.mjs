import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PasteLib } from '../commands/filesystem/paste-lib.js';
import { NlLib } from '../commands/filesystem/nl-lib.js';
import { SortLib } from '../commands/filesystem/sort-lib.js';
import { CutLib } from '../commands/filesystem/cut-lib.js';
import { UniqLib } from '../commands/filesystem/uniq-lib.js';

const { pasteSplitLines, pasteJoinParallelRows, pasteJoinSerialRows, pasteFormatOutputLines } =
  PasteLib;

const { formatNlNumberedText, nlFormatNumberField } = NlLib;

const { parseSortArgv } = SortLib;

const { parseCutArgv, parseCutListString } = CutLib;

const { parseUniqArgv } = UniqLib;

test('pasteSplitLines / pasteJoinParallelRows / pasteJoinSerialRows / pasteFormatOutputLines', () => {
  assert.deepEqual(pasteSplitLines('a\nb\n', false), ['a', 'b']);
  assert.deepEqual(pasteSplitLines('a\0b\0', true), ['a', 'b']);

  const p = pasteJoinParallelRows(
    [
      ['a', 'b'],
      ['1', '2']
    ],
    '\t'
  );
  assert.deepEqual(p, ['a\t1', 'b\t2']);

  const emptyDelim = pasteJoinParallelRows(
    [
      ['a', 'b'],
      ['c', 'd']
    ],
    ''
  );
  assert.deepEqual(emptyDelim, ['ac', 'bd']);

  const cycle = pasteJoinParallelRows(
    [
      ['a', 'b'],
      ['1', '2'],
      ['x', 'y']
    ],
    ',|'
  );
  assert.deepEqual(cycle, ['a,1|x', 'b,2|y']);

  const serial = pasteJoinSerialRows(
    [
      ['a', 'b', 'c'],
      ['x', 'y']
    ],
    ':'
  );
  assert.deepEqual(serial, ['a:b:c', 'x:y']);

  assert.equal(pasteFormatOutputLines(['a', 'b'], false), 'a\nb\n');
  assert.equal(pasteFormatOutputLines(['a', 'b'], true), 'a\0b\0');
});

test('formatNlNumberedText and nlFormatNumberField', () => {
  assert.equal(nlFormatNumberField(7, 6, 'rz'), '000007');
  assert.equal(nlFormatNumberField(12, 4, 'ln'), '12  ');

  const opts = { bodyNumbering: 't', numberFormat: 'rn', numberWidth: 6, separator: '\t' };
  assert.equal(formatNlNumberedText('a\n\nb', opts), '     1\ta\n\n     2\tb\n');

  const all = { bodyNumbering: 'a', numberFormat: 'rn', numberWidth: 6, separator: '\t' };
  assert.equal(formatNlNumberedText('a\n\nb', all), '     1\ta\n     2\t\n     3\tb\n');

  const none = { bodyNumbering: 'n', numberFormat: 'rn', numberWidth: 6, separator: '\t' };
  assert.equal(formatNlNumberedText('a\n\nb', none), 'a\n\nb\n');
});

test('parseSortArgv: flags, combined -nru, --, help, errors', () => {
  const def = parseSortArgv(['a', 'b']);
  assert.equal(def.ok, true);
  assert.equal(def.reverse, false);
  assert.deepEqual(def.operands, ['a', 'b']);

  const nru = parseSortArgv(['-nru', 'f']);
  assert.equal(nru.ok, true);
  assert.equal(nru.numeric, true);
  assert.equal(nru.reverse, true);
  assert.equal(nru.unique, true);
  assert.deepEqual(nru.operands, ['f']);

  assert.deepEqual(parseSortArgv(['--', '-n']).operands, ['-n']);
  assert.equal(parseSortArgv(['--help']).help, true);
  assert.equal(parseSortArgv(['-h']).help, true);

  const bad = parseSortArgv(['-x']);
  assert.equal(bad.ok, false);
  assert.match(bad.stderr, /invalid option/);

  const badLong = parseSortArgv(['--stable']);
  assert.equal(badLong.ok, false);
  assert.match(badLong.stderr, /unrecognized option/);
});

test('parseCutListString: ranges and invalid', () => {
  const ok1 = parseCutListString('1');
  assert.equal(ok1.ok, true);
  assert.equal(ok1.parts.length, 1);

  const ok2 = parseCutListString('1-3');
  assert.equal(ok2.ok, true);

  const ok3 = parseCutListString('2-');
  assert.equal(ok3.ok, true);
  assert.equal(ok3.parts[0].to, Infinity);

  const ok4 = parseCutListString('-3');
  assert.equal(ok4.ok, true);

  const ok5 = parseCutListString('2,1');
  assert.equal(ok5.ok, true);

  const bad = parseCutListString('0');
  assert.equal(bad.ok, false);
});

test('parseCutArgv: -b/-c/-f, long, --, help, conflicts', () => {
  const b = parseCutArgv(['-b', '1-3']);
  assert.equal(b.ok, true);
  assert.equal(b.mode, 'b');
  assert.equal(b.listStr, '1-3');

  const attached = parseCutArgv(['-b1-3']);
  assert.equal(attached.ok, true);
  assert.equal(attached.mode, 'b');

  const f = parseCutArgv(['-d', ':', '-f', '1', 'x']);
  assert.equal(f.ok, true);
  assert.equal(f.mode, 'f');
  assert.equal(f.delim, ':');
  assert.deepEqual(f.operands, ['x']);

  assert.equal(parseCutArgv(['--help']).help, true);
  assert.equal(parseCutArgv(['-h']).help, true);

  const none = parseCutArgv(['file']);
  assert.equal(none.ok, false);
  assert.match(none.stderr, /must specify/);

  const conflict = parseCutArgv(['-b1', '-c1']);
  assert.equal(conflict.ok, false);
  assert.match(conflict.stderr, /only one type/);

  assert.deepEqual(parseCutArgv(['-f', '1', '--', '-f']).operands, ['-f']);

  const badOpt = parseCutArgv(['-b1', '-z']);
  assert.equal(badOpt.ok, false);
  assert.match(badOpt.stderr, /invalid option/);
});

test('parseUniqArgv: flags, combined -cdu, --, help, extra operand, errors', () => {
  const def = parseUniqArgv(['a']);
  assert.equal(def.ok, true);
  assert.equal(def.count, false);
  assert.deepEqual(def.operands, ['a']);

  const two = parseUniqArgv(['in', 'out']);
  assert.equal(two.ok, true);
  assert.deepEqual(two.operands, ['in', 'out']);

  const cdu = parseUniqArgv(['-cdu', 'f']);
  assert.equal(cdu.ok, true);
  assert.equal(cdu.count, true);
  assert.equal(cdu.repeatedOnly, true);
  assert.equal(cdu.uniqueOnly, false);
  assert.deepEqual(cdu.operands, ['f']);

  const du = parseUniqArgv(['-d', '-u']);
  assert.equal(du.ok, true);
  assert.equal(du.repeatedOnly, true);
  assert.equal(du.uniqueOnly, false);

  assert.deepEqual(parseUniqArgv(['--', '-n']).operands, ['-n']);
  assert.equal(parseUniqArgv(['--help']).help, true);
  assert.equal(parseUniqArgv(['-h']).help, true);

  const extra = parseUniqArgv(['a', 'b', 'c']);
  assert.equal(extra.ok, false);
  assert.match(extra.stderr, /extra operand/);

  const bad = parseUniqArgv(['-x']);
  assert.equal(bad.ok, false);
  assert.match(bad.stderr, /invalid option/);

  const badLong = parseUniqArgv(['--group']);
  assert.equal(badLong.ok, false);
  assert.match(badLong.stderr, /unrecognized option/);
});

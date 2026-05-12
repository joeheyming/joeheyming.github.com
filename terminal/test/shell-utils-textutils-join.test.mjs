import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LinesLib } from '../commands/filesystem/lines-lib.js';
import { WcLib } from '../commands/filesystem/wc-lib.js';
import { NlLib } from '../commands/filesystem/nl-lib.js';
import { PasteLib } from '../commands/filesystem/paste-lib.js';
import { JoinLib } from '../commands/filesystem/join-lib.js';

const { parseLinesFilterArgv } = LinesLib;

const { parseWcArgv } = WcLib;

const { parseNlArgv } = NlLib;

const { parsePasteArgv } = PasteLib;

const {
  parseJoinArgv,
  joinSplitFields,
  joinBuildRecords,
  joinMergeRecords,
  joinEmitMatchedLine,
  JOIN_HELP
} = JoinLib;

test('parseLinesFilterArgv: -n, -NUM, -nNUM, --lines=, --, help, errors', () => {
  assert.deepEqual(parseLinesFilterArgv(['-n', '3', 'a', 'b'], 'head', 10), {
    ok: true,
    lines: 3,
    operands: ['a', 'b']
  });
  assert.deepEqual(parseLinesFilterArgv(['-5', 'f'], 'head', 10), {
    ok: true,
    lines: 5,
    operands: ['f']
  });
  assert.deepEqual(parseLinesFilterArgv(['-n5', 'x'], 'head', 10), {
    ok: true,
    lines: 5,
    operands: ['x']
  });
  assert.deepEqual(parseLinesFilterArgv(['--lines=2', 'a'], 'tail', 10), {
    ok: true,
    lines: 2,
    operands: ['a']
  });
  assert.deepEqual(parseLinesFilterArgv(['--', '-n'], 'head', 10), {
    ok: true,
    lines: 10,
    operands: ['-n']
  });
  assert.equal(parseLinesFilterArgv(['--help'], 'head', 10).help, true);
  assert.equal(parseLinesFilterArgv(['-h'], 'tail', 10).help, true);

  const needArg = parseLinesFilterArgv(['-n'], 'head', 10);
  assert.equal(needArg.ok, false);
  assert.match(needArg.stderr, /option requires an argument/);

  const bad = parseLinesFilterArgv(['-x'], 'head', 10);
  assert.equal(bad.ok, false);
  assert.match(bad.stderr, /invalid option/);

  const neg = parseLinesFilterArgv(['-n', '-1'], 'tail', 10);
  assert.equal(neg.ok, false);
  assert.match(neg.stderr, /invalid number of lines/);
});

test('parseWcArgv: flags, combined -lwc, --, help, errors', () => {
  const def = parseWcArgv(['a', 'b']);
  assert.equal(def.ok, true);
  assert.equal(def.showAll, true);
  assert.deepEqual(def.operands, ['a', 'b']);

  const lw = parseWcArgv(['-lw', 'f']);
  assert.equal(lw.ok, true);
  assert.equal(lw.showLines, true);
  assert.equal(lw.showWords, true);
  assert.equal(lw.showBytes, false);
  assert.equal(lw.showAll, false);
  assert.deepEqual(lw.operands, ['f']);

  const long = parseWcArgv(['--lines', '--words', 'x']);
  assert.equal(long.ok, true);
  assert.equal(long.showLines, true);
  assert.equal(long.showWords, true);
  assert.deepEqual(long.operands, ['x']);

  assert.deepEqual(parseWcArgv(['--', '-c']).operands, ['-c']);
  assert.equal(parseWcArgv(['--help']).help, true);
  assert.equal(parseWcArgv(['-h']).help, true);

  const bad = parseWcArgv(['-x']);
  assert.equal(bad.ok, false);
  assert.match(bad.stderr, /invalid option/);

  const badLong = parseWcArgv(['--nope']);
  assert.equal(badLong.ok, false);
  assert.match(badLong.stderr, /unrecognized option/);
});

test('parseNlArgv: defaults, -b/-n/-w/-s, long options, --, help, errors', () => {
  const def = parseNlArgv(['a', 'b']);
  assert.equal(def.ok, true);
  assert.equal(def.bodyNumbering, 't');
  assert.equal(def.numberFormat, 'rn');
  assert.equal(def.numberWidth, 6);
  assert.equal(def.separator, '\t');
  assert.deepEqual(def.operands, ['a', 'b']);

  const ba = parseNlArgv(['-ba', 'f']);
  assert.equal(ba.ok, true);
  assert.equal(ba.bodyNumbering, 'a');
  assert.deepEqual(ba.operands, ['f']);

  const nrz = parseNlArgv(['-nrz', '-w4', '-s:', 'x']);
  assert.equal(nrz.ok, true);
  assert.equal(nrz.numberFormat, 'rz');
  assert.equal(nrz.numberWidth, 4);
  assert.equal(nrz.separator, ':');
  assert.deepEqual(nrz.operands, ['x']);

  const long = parseNlArgv(['--body-numbering=n', '--number-format=ln', '--number-width=8', 'z']);
  assert.equal(long.ok, true);
  assert.equal(long.bodyNumbering, 'n');
  assert.equal(long.numberFormat, 'ln');
  assert.equal(long.numberWidth, 8);
  assert.deepEqual(long.operands, ['z']);

  assert.deepEqual(parseNlArgv(['--', '-n']).operands, ['-n']);
  assert.equal(parseNlArgv(['--help']).help, true);
  assert.equal(parseNlArgv(['-h']).help, true);

  const badStyle = parseNlArgv(['-b', 'x']);
  assert.equal(badStyle.ok, false);
  assert.match(badStyle.stderr, /invalid body numbering/);

  const badFmt = parseNlArgv(['-n', 'xx']);
  assert.equal(badFmt.ok, false);
  assert.match(badFmt.stderr, /invalid line numbering format/);

  const bad = parseNlArgv(['-z']);
  assert.equal(bad.ok, false);
  assert.match(bad.stderr, /invalid option/);
});

test('parsePasteArgv: -d -s -z, long options, --, help', () => {
  const def = parsePasteArgv(['a', 'b']);
  assert.equal(def.ok, true);
  assert.equal(def.delimiterList, '\t');
  assert.equal(def.serial, false);
  assert.equal(def.nullTerminated, false);
  assert.deepEqual(def.operands, ['a', 'b']);

  const ds = parsePasteArgv(['-d,', '-s', 'x', 'y']);
  assert.equal(ds.ok, true);
  assert.equal(ds.delimiterList, ',');
  assert.equal(ds.serial, true);
  assert.deepEqual(ds.operands, ['x', 'y']);

  const dz = parsePasteArgv(['-d', '|', '-z', 'f']);
  assert.equal(dz.ok, true);
  assert.equal(dz.delimiterList, '|');
  assert.equal(dz.nullTerminated, true);
  assert.deepEqual(dz.operands, ['f']);

  assert.deepEqual(parsePasteArgv(['--delimiter=', 'a']).operands, ['a']);
  assert.equal(parsePasteArgv(['--delimiter=']).delimiterList, '');

  assert.equal(parsePasteArgv(['--help']).help, true);
  assert.equal(parsePasteArgv(['-h']).help, true);
  assert.deepEqual(parsePasteArgv(['--', '-d']).operands, ['-d']);

  const bad = parsePasteArgv(['-d']);
  assert.equal(bad.ok, false);
  assert.match(bad.stderr, /requires an argument/);
});

test('parseJoinArgv: -1 -2 -j -t -a -v -e, --, help', () => {
  const def = parseJoinArgv(['a', 'b']);
  assert.equal(def.ok, true);
  assert.equal(def.joinField1, 1);
  assert.equal(def.joinField2, 1);
  assert.equal(def.delimChar, null);
  assert.equal(def.a1, false);
  assert.equal(def.v1, false);
  assert.deepEqual(def.operands, ['a', 'b']);

  const j12 = parseJoinArgv(['-j', '2', 'x', 'y']);
  assert.equal(j12.ok, true);
  assert.equal(j12.joinField1, 2);
  assert.equal(j12.joinField2, 2);

  const jglue = parseJoinArgv(['-j1', 'f1', 'f2']);
  assert.equal(jglue.ok, true);
  assert.equal(jglue.joinField1, 1);

  const tcol = parseJoinArgv(['-t:', 'a', 'b']);
  assert.equal(tcol.ok, true);
  assert.equal(tcol.delimChar, ':');

  const aboth = parseJoinArgv(['-a1', '-a2', 'x', 'y']);
  assert.equal(aboth.ok, true);
  assert.equal(aboth.a1, true);
  assert.equal(aboth.a2, true);

  const vboth = parseJoinArgv(['-v1', '-v2', 'x', 'y']);
  assert.equal(vboth.ok, true);
  assert.equal(vboth.v1, true);
  assert.equal(vboth.v2, true);

  const e = parseJoinArgv(['-e', 'MISSING', 'a', 'b']);
  assert.equal(e.ok, true);
  assert.equal(e.emptyStr, 'MISSING');

  assert.equal(parseJoinArgv(['--help']).help, true);
  assert.equal(parseJoinArgv(['-?']).help, true);
  assert.match(JOIN_HELP, /join/);
  assert.deepEqual(parseJoinArgv(['--', '-a']).operands, ['-a']);

  const badOpt = parseJoinArgv(['-z', 'a', 'b']);
  assert.equal(badOpt.ok, false);
  assert.match(badOpt.stderr, /invalid option/);
});

test('joinSplitFields / joinBuildRecords / joinMergeRecords / joinEmitMatchedLine', () => {
  assert.deepEqual(joinSplitFields('  1  a  b', null), ['1', 'a', 'b']);
  assert.deepEqual(joinSplitFields('1:2:3', ':'), ['1', '2', '3']);

  const r1 = joinBuildRecords(['1 a', '2 b'], 1, null);
  const r2 = joinBuildRecords(['1 x', '2 y'], 1, null);
  const merged = joinMergeRecords(r1, r2, {
    joinField1: 1,
    joinField2: 1,
    delimChar: null,
    a1: false,
    a2: false,
    v1: false,
    v2: false,
    emptyStr: ''
  });
  assert.deepEqual(merged, ['1 a x', '2 b y']);

  const r3 = joinBuildRecords(['1 a', '3 c'], 1, null);
  const r4 = joinBuildRecords(['2 b'], 1, null);
  const a1only = joinMergeRecords(r3, r4, {
    joinField1: 1,
    joinField2: 1,
    delimChar: null,
    a1: true,
    a2: false,
    v1: false,
    v2: false,
    emptyStr: ''
  });
  assert.deepEqual(a1only, ['1 a', '3 c']);

  const aBoth = joinMergeRecords(r3, r4, {
    joinField1: 1,
    joinField2: 1,
    delimChar: null,
    a1: true,
    a2: true,
    v1: false,
    v2: false,
    emptyStr: ''
  });
  assert.deepEqual(aBoth, ['1 a', '2 b', '3 c']);

  const cart1 = joinBuildRecords(['1 a', '1 b'], 1, null);
  const cart2 = joinBuildRecords(['1 x', '1 y'], 1, null);
  const cart = joinMergeRecords(cart1, cart2, {
    joinField1: 1,
    joinField2: 1,
    delimChar: null,
    a1: false,
    a2: false,
    v1: false,
    v2: false,
    emptyStr: ''
  });
  assert.deepEqual(cart, ['1 a x', '1 a y', '1 b x', '1 b y']);

  const line = joinEmitMatchedLine(
    { fields: ['1', 'a', 'foo'] },
    { fields: ['1', 'b', 'bar'] },
    1,
    1,
    ':',
    ''
  );
  assert.equal(line, '1:a:foo:b:bar');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ExpandLib } from '../commands/filesystem/expand-lib.js';
import { FoldLib } from '../commands/filesystem/fold-lib.js';
import { LessLib } from '../commands/system/less-lib.js';

const { lessExpandTabsInText, LESS_DEFAULT_TAB_STOPS } = LessLib;

const {
  parseExpandArgv,
  parseExpandTabStopsArg,
  expandExpandLine,
  expandExpandText,
  EXPAND_VERSION_LINE
} = ExpandLib;

const { parseFoldArgv, foldFoldText, foldFoldLineChars, FOLD_VERSION_LINE, FOLD_DEFAULT_WIDTH } =
  FoldLib;

test('parseExpandArgv: -i -t, --tabs, --, help, version', () => {
  const def = parseExpandArgv([]);
  assert.equal(def.ok, true);
  assert.deepEqual(def.tabSpec, { kind: 'uniform', width: LESS_DEFAULT_TAB_STOPS });
  assert.equal(def.initialOnly, false);
  assert.deepEqual(def.operands, []);

  const t4 = parseExpandArgv(['-t', '4', 'f']);
  assert.equal(t4.ok, true);
  assert.deepEqual(t4.tabSpec, { kind: 'uniform', width: 4 });
  assert.deepEqual(t4.operands, ['f']);

  const it = parseExpandArgv(['-it8', 'x']);
  assert.equal(it.ok, true);
  assert.equal(it.initialOnly, true);
  assert.deepEqual(it.tabSpec, { kind: 'uniform', width: 8 });
  assert.deepEqual(it.operands, ['x']);

  assert.equal(parseExpandArgv(['--help']).help, true);
  assert.equal(parseExpandArgv(['--version']).version, true);
  assert.equal(EXPAND_VERSION_LINE, 'expand (jsh Heyming Terminal) 1.0\n');

  assert.deepEqual(parseExpandArgv(['--', '-t']).operands, ['-t']);

  const comma = parseExpandArgv(['-t', '1,8']);
  assert.equal(comma.ok, true);
  assert.deepEqual(comma.tabSpec, { kind: 'list', stops: [1, 8] });

  const blank = parseExpandArgv(['-t', '1 8']);
  assert.equal(blank.ok, true);
  assert.deepEqual(blank.tabSpec, { kind: 'list', stops: [1, 8] });
  assert.deepEqual(parseExpandTabStopsArg('1\t8'), parseExpandTabStopsArg('1,8'));
  assert.deepEqual(parseExpandTabStopsArg('2 4 /8'), parseExpandTabStopsArg('2,4,/8'));

  const badAsc = parseExpandArgv(['-t', '8,1']);
  assert.equal(badAsc.ok, false);
  assert.match(badAsc.stderr, /ascending/);
});

test('expandExpandLine / expandExpandText: uniform and -i', () => {
  const u8 = { kind: 'uniform', width: 8 };
  const u4 = { kind: 'uniform', width: 4 };
  assert.equal(expandExpandText('a\tb', u8, false), lessExpandTabsInText('a\tb', 8));
  assert.equal(expandExpandLine('x\t\ty', u8, true), 'x\t\ty');
  assert.equal(expandExpandLine('\tfoo', u8, true), '        foo');
  assert.equal(expandExpandLine('  \tfoo', u8, true), '        foo');
  assert.equal(expandExpandText('a\tb\nc\t', u4, false), 'a   b\nc   ');
});

test('expand: comma-separated tab stops (GNU-style)', () => {
  const t18 = { kind: 'list', stops: [1, 8] };
  const t18blank = parseExpandTabStopsArg('1 8');
  assert.equal(t18blank.ok, true);
  assert.deepEqual(t18blank.tabSpec, t18);
  assert.equal(
    expandExpandText('\t\t\t\n', t18, false),
    '         \n',
    'GNU expand -t 1,8: three tabs → nine spaces + newline'
  );
  assert.equal(
    expandExpandText('\t\t\t\n', t18blank.tabSpec, false),
    '         \n',
    'blank-separated -t 1 8 (one argv) matches comma list'
  );
  assert.equal(expandExpandText('a\tb\n', t18, false), lessExpandTabsInText('a\tb\n', 8));
  assert.equal(expandExpandLine('\tfoo', t18, true), ' foo');
});

test('expand: GNU tab-list /N and +N suffixes (parse + output vs GNU coreutils)', () => {
  const pPlus = parseExpandArgv(['-t', '1,+8']);
  assert.equal(pPlus.ok, true);
  assert.deepEqual(pPlus.tabSpec, { kind: 'list', stops: [1], incrementStep: 8 });
  assert.equal(
    expandExpandText('\t\t\t\n', pPlus.tabSpec, false),
    '                 \n',
    'gexpand -t 1,+8: three tabs → 17 spaces + newline'
  );

  const pSlash = parseExpandArgv(['-t', '2,4,/8']);
  assert.equal(pSlash.ok, true);
  assert.deepEqual(pSlash.tabSpec, { kind: 'list', stops: [2, 4], extendRepeat: 8 });
  assert.equal(
    expandExpandText('\t\t\t\n', pSlash.tabSpec, false),
    '        \n',
    'gexpand -t 2,4,/8: three tabs → eight spaces + newline'
  );

  assert.deepEqual(parseExpandTabStopsArg('/8'), {
    ok: true,
    tabSpec: { kind: 'uniform', width: 8 }
  });
  assert.deepEqual(parseExpandTabStopsArg('+8'), {
    ok: true,
    tabSpec: { kind: 'uniform', width: 8 }
  });

  const badPlus = parseExpandArgv(['-t', '1,+8,9']);
  assert.equal(badPlus.ok, false);
  assert.match(badPlus.stderr, /'\+' specifier only allowed with the last value/);

  const badSlash = parseExpandArgv(['-t', '2,/4,8']);
  assert.equal(badSlash.ok, false);
  assert.match(badSlash.stderr, /'\/' specifier only allowed with the last value/);
});

test('parseFoldArgv: -b -s -w, --width, --, help, version', () => {
  const def = parseFoldArgv([]);
  assert.equal(def.ok, true);
  assert.equal(def.width, FOLD_DEFAULT_WIDTH);
  assert.equal(def.bytesMode, false);
  assert.equal(def.breakAtSpaces, false);
  assert.deepEqual(def.operands, []);

  const w5 = parseFoldArgv(['-w', '5', 'f']);
  assert.equal(w5.ok, true);
  assert.equal(w5.width, 5);
  assert.deepEqual(w5.operands, ['f']);

  const bsw = parseFoldArgv(['-bsw10', 'x']);
  assert.equal(bsw.ok, true);
  assert.equal(bsw.bytesMode, true);
  assert.equal(bsw.breakAtSpaces, true);
  assert.equal(bsw.width, 10);
  assert.deepEqual(bsw.operands, ['x']);

  assert.equal(parseFoldArgv(['--help']).help, true);
  assert.equal(parseFoldArgv(['-?']).help, true);
  assert.equal(parseFoldArgv(['--version']).version, true);
  assert.equal(FOLD_VERSION_LINE, 'fold (jsh Heyming Terminal) 1.0\n');

  assert.deepEqual(parseFoldArgv(['--', '-w']).operands, ['-w']);

  const badW = parseFoldArgv(['-w', '0']);
  assert.equal(badW.ok, false);
  assert.match(badW.stderr, /positive/);

  const badOpt = parseFoldArgv(['-x']);
  assert.equal(badOpt.ok, false);
  assert.match(badOpt.stderr, /invalid option/);
});

test('foldFoldText / foldFoldLineChars: columns, -s, -b', () => {
  assert.equal(foldFoldText('abcdefghij', 5, false, false), 'abcde\nfghij');
  assert.equal(
    foldFoldText('hello world', 5, false, true),
    'hello\n \nworld',
    'GNU-style -s: space-only line between words when width splits before second word'
  );
  assert.equal(foldFoldText('a\nb\n', 3, false, false), 'a\nb\n');
  assert.equal(foldFoldLineChars('', 5, false), '');
  assert.equal(foldFoldText('café', 3, true, false), 'caf\né', 'UTF-8 bytes: café is 5 octets');
});


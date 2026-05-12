import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AwkLib } from '../commands/filesystem/awk-lib.js';
import { XargsLib } from '../commands/system/xargs-lib.js';

const {
  parseAwkArgv,
  parseAwkFullProgram,
  parseAwkPrintProgram,
  awkBeginCtx,
  awkRunPrintOnce,
  awkRunPrintProgram,
  awkSplitFields,
  awkSplitCommaListTopLevel,
  awkSplitTopLevelCommas,
  awkParseNamedCall,
  awkEvalArithmeticExpr,
  awkStrToNum,
  awkFormatArithResult,
  awkEvalPrintExpr,
  awkParseArrayAccess,
  awkEvalSplitExpr,
  awkRebuild0FromFields,
  awkLiteralGsubAll,
  awkLiteralSubFirst,
  awkParseSlashDelimitedRegex,
  awkExpandRegexReplacement,
  awkRegexGsubAll,
  awkRegexSubFirst
} = AwkLib;

const {
  parseXargsArgv,
  xargsSplitWhitespaceWords,
  xargsSplitLines,
  xargsSplitNullRecords,
  xargsSubstituteInArgs,
  xargsFormatVerboseCommandLine
} = XargsLib;

test('parseAwkArgv, parseAwkPrintProgram, awkRunPrintProgram', () => {
  assert.equal(parseAwkArgv(['--help']).help, true);
  assert.equal(parseAwkArgv(['-h']).help, true);

  const a = parseAwkArgv(['{print $1}', 'f.txt']);
  assert.equal(a.ok, true);
  assert.equal(a.fieldSeparator, ' ');
  assert.equal(a.program, '{print $1}');
  assert.deepEqual(a.fileOperands, ['f.txt']);

  const f = parseAwkArgv(['-F:', '{print $1}', 'x']);
  assert.equal(f.ok, true);
  assert.equal(f.fieldSeparator, ':');

  const fg = parseAwkArgv(['-F', '\t', '{print $0}']);
  assert.equal(fg.ok, true);
  assert.equal(fg.fieldSeparator, '\t');

  const dash = parseAwkArgv(['--', '{print}', '-']);
  assert.equal(dash.ok, true);
  assert.equal(dash.program, '{print}');
  assert.deepEqual(dash.fileOperands, ['-']);

  assert.equal(parseAwkArgv([]).ok, false);
  assert.equal(parseAwkArgv(['-F']).ok, false);
  assert.equal(parseAwkArgv(['--']).ok, false);
  assert.equal(parseAwkArgv(['-x']).ok, false);

  const p0 = parseAwkPrintProgram('{print}');
  assert.equal(p0.ok, true);
  assert.deepEqual(p0.exprs, ['$0']);

  const p1 = parseAwkPrintProgram('{print $1, $2}');
  assert.equal(p1.ok, true);
  assert.deepEqual(p1.exprs, ['$1', '$2']);

  const pSubComma = parseAwkPrintProgram('{print substr($1,1,2), length}');
  assert.equal(pSubComma.ok, true);
  assert.deepEqual(pSubComma.exprs, ['substr($1,1,2)', 'length']);

  const pr = awkRunPrintProgram('a b\nc d\n', p1.exprs, ' ', 1);
  assert.equal(pr.ok, true);
  assert.equal(pr.stdout, 'a b\nc d\n');
  assert.equal(pr.nextNr, 3);
  assert.equal(pr.lastReadCtx && pr.lastReadCtx.NR, 2);

  const full = parseAwkFullProgram('BEGIN { print NR } END { print NR }');
  assert.equal(full.ok, true);
  assert.deepEqual(full.beginExprs, ['NR']);
  assert.equal(full.mainExprs, null);
  assert.deepEqual(full.endExprs, ['NR']);
  const br = awkRunPrintOnce(full.beginExprs, awkBeginCtx());
  assert.equal(br.ok, true);
  assert.equal(br.stdout, '0\n');
  const er = awkRunPrintOnce(full.endExprs, awkBeginCtx());
  assert.equal(er.ok, true);
  assert.equal(er.stdout, '0\n');

  const mainEnd = parseAwkFullProgram('{ print $1 } END { print NR }');
  assert.equal(mainEnd.ok, true);
  assert.deepEqual(mainEnd.mainExprs, ['$1']);
  assert.deepEqual(mainEnd.endExprs, ['NR']);
  const scanOnly = awkRunPrintProgram('x y\n', null, ' ', 1);
  assert.equal(scanOnly.stdout, '');
  assert.equal(scanOnly.nextNr, 2);
  assert.equal(scanOnly.lastReadCtx.NF, 2);

  assert.equal(parseAwkFullProgram('BEGIN { print NR } trailing').ok, false);

  const pr2 = awkRunPrintProgram('a:b\n', ['$1', '$2'], ':', 1);
  assert.equal(pr2.ok, true);
  assert.equal(pr2.stdout, 'a b\n');

  const pr3 = awkRunPrintProgram('x y\n', ['$2', '$1'], ' ', 1);
  assert.equal(pr3.ok, true);
  assert.equal(pr3.stdout, 'y x\n');

  const pr4 = awkRunPrintProgram('\n', ['NR', 'NF', '$0'], ' ', 1);
  assert.equal(pr4.ok, true);
  assert.equal(pr4.stdout, '1 0 \n');

  const len0 = awkRunPrintOnce(['length'], { $0: 'hi', fields: [], NR: 1, NF: 0 });
  assert.equal(len0.ok, true);
  assert.equal(len0.stdout, '2\n');
  const lenEmpty = awkRunPrintOnce(['length'], { $0: '', fields: [], NR: 1, NF: 0 });
  assert.equal(lenEmpty.stdout, '0\n');
  const lenParen = awkRunPrintOnce(['length()'], { $0: 'abc', fields: [], NR: 1, NF: 0 });
  assert.equal(lenParen.stdout, '3\n');
  const lenF = awkRunPrintOnce(['length($1)'], { $0: 'x y', fields: ['hello'], NR: 1, NF: 1 });
  assert.equal(lenF.stdout, '5\n');
  const lenStr = awkRunPrintOnce(['length("ab")'], { $0: '', fields: [], NR: 1, NF: 0 });
  assert.equal(lenStr.stdout, '2\n');
  const lenNest = awkRunPrintOnce(['length(length($0))'], { $0: 'hi', fields: [], NR: 1, NF: 0 });
  assert.equal(lenNest.stdout, '1\n');
  const lenBad = awkRunPrintOnce(['length(x)'], { $0: 'a', fields: [], NR: 1, NF: 0 });
  assert.equal(lenBad.ok, false);
  const pr5 = awkRunPrintProgram('a\nbb\n', ['length'], ' ', 1);
  assert.equal(pr5.ok, true);
  assert.equal(pr5.stdout, '1\n2\n');

  assert.deepEqual(awkSplitCommaListTopLevel('$1, "a,b", 2'), ['$1', '"a,b"', '2']);
  assert.deepEqual(awkSplitCommaListTopLevel('length($1),2'), ['length($1)', '2']);
  assert.deepEqual(
    awkSplitTopLevelCommas('$1, "a,b", 2'),
    awkSplitCommaListTopLevel('$1, "a,b", 2')
  );
  assert.equal(awkParseNamedCall('substr($1,2)', 'substr'), '$1,2');
  assert.equal(awkParseNamedCall('substrabc(1)', 'substr'), null);

  const sub1 = awkRunPrintOnce(['substr($1,1,2)'], {
    $0: 'x',
    fields: ['abcde'],
    NR: 1,
    NF: 1
  });
  assert.equal(sub1.ok, true);
  assert.equal(sub1.stdout, 'ab\n');
  const sub2 = awkRunPrintOnce(['substr($1,2)'], {
    $0: 'x',
    fields: ['abcde'],
    NR: 1,
    NF: 1
  });
  assert.equal(sub2.stdout, 'bcde\n');
  const subBad = awkRunPrintOnce(['substr($1)'], { $0: 'x', fields: ['abc'], NR: 1, NF: 1 });
  assert.equal(subBad.ok, false);

  const ix1 = awkRunPrintOnce(['index($1,"bc")'], {
    $0: 'x',
    fields: ['abcde'],
    NR: 1,
    NF: 1
  });
  assert.equal(ix1.stdout, '2\n');
  const ix0 = awkRunPrintOnce(['index($1,"zz")'], {
    $0: 'x',
    fields: ['abcde'],
    NR: 1,
    NF: 1
  });
  assert.equal(ix0.stdout, '0\n');
  const idxEmpty = awkRunPrintOnce(['index($1,"")'], {
    $0: 'x',
    fields: ['abcde'],
    NR: 1,
    NF: 1
  });
  assert.equal(idxEmpty.stdout, '1\n');

  const nest = awkRunPrintOnce(['index(substr($1,2),"bc")'], {
    $0: 'x',
    fields: ['abcde'],
    NR: 1,
    NF: 1
  });
  assert.equal(nest.stdout, '1\n');

  const lenSub = awkRunPrintOnce(['length(substr($1,1,3))'], {
    $0: 'x',
    fields: ['abcde'],
    NR: 1,
    NF: 1
  });
  assert.equal(lenSub.stdout, '3\n');

  const ctx0 = { $0: 'x', fields: ['hi'], NR: 1, NF: 1 };
  assert.equal(awkEvalPrintExpr('substr($1, 0, 1)', ctx0), 'h');
  assert.equal(awkEvalPrintExpr('index("abc","b")', ctx0), '2');

  const emptyCtx = { $0: '', fields: [], NR: 0, NF: 0 };
  assert.equal(awkEvalArithmeticExpr('1+2*3', emptyCtx), 7);
  assert.equal(awkEvalArithmeticExpr('(1+2)*3', emptyCtx), 9);
  assert.equal(awkEvalArithmeticExpr('10/2', emptyCtx), 5);
  assert.equal(awkEvalArithmeticExpr('10%3', emptyCtx), 1);
  assert.equal(awkEvalArithmeticExpr('10%3*2', emptyCtx), 2);
  assert.equal(awkEvalArithmeticExpr('100/10/2', emptyCtx), 5);
  assert.equal(awkEvalArithmeticExpr('5%0', emptyCtx), null);
  assert.equal(awkEvalArithmeticExpr('2^3', emptyCtx), 8);
  assert.equal(awkEvalArithmeticExpr('2^3^2', emptyCtx), 512);
  assert.equal(awkEvalArithmeticExpr('-2^2', emptyCtx), -4);
  assert.equal(awkEvalArithmeticExpr('2^-2', emptyCtx), 0.25);
  assert.equal(awkEvalArithmeticExpr('(-2)^2', emptyCtx), 4);
  assert.equal(awkEvalArithmeticExpr('2*3^2', emptyCtx), 18);
  assert.equal(awkEvalArithmeticExpr('2^3*2', emptyCtx), 16);
  assert.equal(awkEvalArithmeticExpr('2^', emptyCtx), null);
  assert.equal(awkEvalArithmeticExpr('1+2+', emptyCtx), null);
  assert.equal(awkEvalArithmeticExpr('1+2 ', emptyCtx), 3);
  assert.equal(awkStrToNum('5abc'), 5);
  assert.equal(awkFormatArithResult(3.5), '3.5');
  assert.equal(awkFormatArithResult(3), '3');
  assert.equal(awkFormatArithResult(1 / 0), 'inf');
  assert.equal(awkFormatArithResult(-1 / 0), '-inf');
  assert.equal(awkFormatArithResult(0 / 0), 'nan');
  assert.equal(awkEvalPrintExpr('1+2*3', ctx0), '7');
  assert.equal(awkEvalPrintExpr('$1+10', { $0: 'a', fields: ['5'], NR: 1, NF: 1 }), '15');
  assert.equal(awkEvalPrintExpr('NR+NF', { $0: 'a b', fields: ['x', 'y'], NR: 3, NF: 2 }), '5');
  assert.equal(awkEvalPrintExpr('substr($1,1+1,2)', ctx0), 'i');
  assert.equal(awkEvalPrintExpr('length($0)+2', { $0: 'abcd', fields: [], NR: 1, NF: 0 }), '6');
  assert.equal(awkEvalPrintExpr('10/4', ctx0), '2.5');
  assert.equal(awkEvalPrintExpr('7%2', ctx0), '1');
  assert.equal(awkEvalPrintExpr('2^10', ctx0), '1024');
  assert.equal(awkEvalPrintExpr('1/0', ctx0), 'inf');
  assert.equal(awkEvalPrintExpr('0/0', ctx0), 'nan');

  const mod0 = awkRunPrintOnce(['5%0'], ctx0);
  assert.equal(mod0.ok, false);

  assert.deepEqual(awkSplitFields('  a  b  ', ' '), ['a', 'b']);
  assert.deepEqual(awkSplitFields('a:b::', ':'), ['a', 'b', '', '']);

  assert.deepEqual(awkLiteralGsubAll('aa', 'a', 'b'), { count: 2, result: 'bb' });
  assert.deepEqual(awkLiteralSubFirst('aa', 'a', 'b'), { count: 1, result: 'ba' });
  assert.deepEqual(awkLiteralGsubAll('abc', '', 'X'), { count: 4, result: 'XaXbXcX' });
  assert.deepEqual(awkLiteralGsubAll('', '', 'X'), { count: 1, result: 'X' });
  assert.deepEqual(awkLiteralSubFirst('abc', '', 'X'), { count: 1, result: 'Xabc' });
  assert.deepEqual(awkLiteralSubFirst('', '', 'X'), { count: 1, result: 'X' });
  assert.equal(awkRebuild0FromFields(['z', 'b'], ':'), 'z:b');

  const g0 = awkRunPrintProgram('aa\n', ['gsub("a","b")'], ' ', 1);
  assert.equal(g0.stdout, '2\n');

  const gOrder = awkRunPrintProgram('aa\n', ['gsub("a","b")', '$0'], ' ', 1);
  assert.equal(gOrder.stdout, '2 bb\n');

  const gOrder2 = awkRunPrintProgram('aa\n', ['$0', 'gsub("a","b")'], ' ', 1);
  assert.equal(gOrder2.stdout, 'aa 2\n');

  const s0 = awkRunPrintProgram('aa\n', ['sub("a","b")'], ' ', 1);
  assert.equal(s0.stdout, '1\n');

  const gEmpty = awkRunPrintProgram('abc\n', ['gsub("","X")'], ' ', 1);
  assert.equal(gEmpty.stdout, '4\n');
  const gEmpty0 = awkRunPrintProgram('abc\n', ['gsub("","X")', '$0'], ' ', 1);
  assert.equal(gEmpty0.stdout, '4 XaXbXcX\n');
  const sEmpty = awkRunPrintProgram('abc\n', ['sub("","X")'], ' ', 1);
  assert.equal(sEmpty.stdout, '1\n');
  const sEmpty0 = awkRunPrintProgram('abc\n', ['sub("","X")', '$0'], ' ', 1);
  assert.equal(sEmpty0.stdout, '1 Xabc\n');

  const gField = awkRunPrintProgram('a:b\n', ['gsub("a","z",$1)'], ':', 1);
  assert.equal(gField.stdout, '1\n');

  const ctxM = awkBeginCtx();
  assert.equal(awkEvalPrintExpr('match("xabc","ab")', ctxM), '2');
  assert.equal(ctxM.RSTART, 2);
  assert.equal(ctxM.RLENGTH, 2);
  assert.equal(awkEvalPrintExpr('RSTART', ctxM), '2');
  assert.equal(awkEvalPrintExpr('RLENGTH', ctxM), '2');

  const ctxRe = awkBeginCtx();
  assert.equal(awkEvalPrintExpr('match("xabc","/ab/")', ctxRe), '2');
  assert.equal(ctxRe.RSTART, 2);
  assert.equal(ctxRe.RLENGTH, 2);
  const ctxAlt = awkBeginCtx();
  assert.equal(awkEvalPrintExpr('match("xabc","/a|c/")', ctxAlt), '2');
  const ctxCi = awkBeginCtx();
  assert.equal(awkEvalPrintExpr('match("xAbC","/a/i")', ctxCi), '2');
  assert.equal(awkEvalPrintExpr('match("x","/(/")', awkBeginCtx()), null);

  const sharedArr = Object.create(null);
  const ctxMa = awkBeginCtx(' ', sharedArr);
  assert.equal(awkEvalPrintExpr('match("xabc","/(a)(b)/", m)', ctxMa), '2');
  assert.deepEqual({ ...sharedArr.m }, { 0: 'ab', 1: 'a', 2: 'b' });
  assert.equal(awkEvalPrintExpr('m[0]', ctxMa), 'ab');
  assert.equal(awkEvalPrintExpr('m["1"]', ctxMa), 'a');
  assert.deepEqual(awkParseArrayAccess('m[$1]'), { name: 'm', inner: '$1' });
  const ctxDyn = {
    $0: 'x y',
    fields: ['2', 'y'],
    NR: 1,
    NF: 2,
    fieldSeparator: ' ',
    awkArrays: Object.create(null)
  };
  ctxDyn.awkArrays.m = { 2: 'hit' };
  assert.equal(awkEvalPrintExpr('m[$1]', ctxDyn), 'hit');

  const ctxNest = {
    $0: 'a',
    fields: ['a'],
    NR: 1,
    NF: 1,
    fieldSeparator: ' ',
    awkArrays: Object.create(null)
  };
  ctxNest.awkArrays.idx = { 1: '2' };
  ctxNest.awkArrays.t = { 2: 'nested' };
  assert.equal(awkEvalPrintExpr('t[idx[1]]', ctxNest), 'nested');

  assert.equal(
    awkEvalArithmeticExpr('m[1]+0', {
      $0: '',
      fields: [],
      NR: 1,
      NF: 0,
      awkArrays: { m: { 1: '5' } }
    }),
    5
  );

  const splitCtx = awkBeginCtx(' ', Object.create(null));
  assert.equal(awkEvalSplitExpr('"a:b:c", t, ":"', splitCtx), '3');
  assert.deepEqual({ ...splitCtx.awkArrays.t }, { 1: 'a', 2: 'b', 3: 'c' });
  const spLine = awkRunPrintOnce(
    ['split("a:b:c", u, ":")', 'u[2]', 'split("p q", v)', 'v[2]'],
    awkBeginCtx(' ', Object.create(null))
  );
  assert.equal(spLine.ok, true);
  assert.equal(spLine.stdout, '3 b 2 q\n');

  assert.equal(awkEvalPrintExpr('match("xabc","/(z)/", m)', ctxMa), '0');
  assert.deepEqual({ ...sharedArr.m }, {});
  assert.equal(awkEvalPrintExpr('match("xabc","ab", m)', awkBeginCtx(' ', sharedArr)), '2');
  assert.deepEqual({ ...sharedArr.m }, { 0: 'ab' });
  assert.equal(awkEvalPrintExpr('match("a","b", 1)', awkBeginCtx()), null);

  const sharedPipe = Object.create(null);
  const beginM = awkRunPrintOnce(
    ['match("foo","/(f)(oo)/", m)', 'm[1]'],
    awkBeginCtx(' ', sharedPipe)
  );
  assert.equal(beginM.ok, true);
  assert.equal(beginM.stdout, '1 f\n');
  const pipeM = awkRunPrintProgram('ignored\n', ['m[2]'], ' ', 1, sharedPipe);
  assert.equal(pipeM.stdout, 'oo\n');

  assert.deepEqual(awkParseSlashDelimitedRegex('/foo'), { kind: 'literal' });
  assert.equal(awkParseSlashDelimitedRegex('/(/').kind, 'bad');
  assert.equal(awkParseSlashDelimitedRegex('/a/i').kind, 'regex');

  assert.equal(awkExpandRegexReplacement('\\1', ['ab', 'a', 'b', 0, 'ab']), 'a');
  assert.equal(awkExpandRegexReplacement('(&)', ['ab', 0, 'ab']), '(ab)');

  assert.deepEqual(awkRegexGsubAll('aa', /a/, 'b&b'), { count: 2, result: 'babbab' });
  assert.deepEqual(awkRegexSubFirst('aa', /a/, 'b'), { count: 1, result: 'ba' });

  const gRegex = awkRunPrintProgram('aa\n', ['gsub("/a/","b&b")', '$0'], ' ', 1);
  assert.equal(gRegex.stdout, '2 babbab\n');
  const sRegex = awkRunPrintProgram('aa\n', ['sub("/a/","b")', '$0'], ' ', 1);
  assert.equal(sRegex.stdout, '1 ba\n');
});

test('parseXargsArgv and xargs input helpers', () => {
  const def = parseXargsArgv([]);
  assert.equal(def.ok, true);
  assert.deepEqual(def.command, ['echo']);

  const n2 = parseXargsArgv(['-n', '2']);
  assert.equal(n2.ok, true);
  assert.equal(n2.maxArgs, 2);

  const nGlued = parseXargsArgv(['-n3']);
  assert.equal(nGlued.ok, true);
  assert.equal(nGlued.maxArgs, 3);

  const rep = parseXargsArgv(['-I', '{}', 'echo', '{}']);
  assert.equal(rep.ok, true);
  assert.equal(rep.replaceStr, '{}');
  assert.deepEqual(rep.command, ['echo', '{}']);

  const repEq = parseXargsArgv(['--replace=@', 'printf', '%s']);
  assert.equal(repEq.ok, true);
  assert.equal(repEq.replaceStr, '@');
  assert.deepEqual(repEq.command, ['printf', '%s']);

  assert.equal(parseXargsArgv(['--help']).help, true);
  assert.equal(parseXargsArgv(['-h']).help, true);

  const bad = parseXargsArgv(['--not-real']);
  assert.equal(bad.ok, false);

  const needN = parseXargsArgv(['-n']);
  assert.equal(needN.ok, false);

  assert.deepEqual(xargsSplitWhitespaceWords('  a  b\n'), ['a', 'b']);
  assert.deepEqual(xargsSplitWhitespaceWords(''), []);
  assert.deepEqual(xargsSplitLines('a\nb\n'), ['a', 'b']);
  assert.deepEqual(xargsSplitLines(''), []);
  assert.deepEqual(xargsSplitNullRecords('a\0b'), ['a', 'b']);

  assert.deepEqual(xargsSubstituteInArgs(['echo', '{}'], '{}', 'hi'), ['echo', 'hi']);
  assert.match(xargsFormatVerboseCommandLine('echo', ['a b']), /'a b'/);
});

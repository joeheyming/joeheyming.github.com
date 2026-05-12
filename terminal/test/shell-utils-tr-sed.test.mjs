import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TrLib } from '../commands/filesystem/tr-lib.js';
import { SedLib } from '../commands/filesystem/sed-lib.js';

const { parseTrArgv, expandTrSetString, runTr, TR_HELP } = TrLib;

const {
  parseSedArgv,
  parseSedSubstituteScript,
  parseSedScript,
  parseSedAddressedDelete,
  parseSedSlashPatternDelete,
  parseSedSlashPatternRangeDelete,
  parseSedSlashPatternToLineDelete,
  parseSedLineToPatternDelete,
  sedLineMatchesDeleteAddress,
  sedApplySubstituteLine,
  sedProcessContent,
  splitSedScriptIntoCommands
} = SedLib;

test('expandTrSetString: ranges and escapes', () => {
  assert.deepEqual(expandTrSetString('a-c'), ['a', 'b', 'c']);
  assert.deepEqual(expandTrSetString('z-a'), expandTrSetString('a-z'));
  assert.equal(expandTrSetString('\\n').join(''), '\n');
  assert.equal(expandTrSetString('\\\\').join(''), '\\');
  assert.deepEqual(expandTrSetString('a-'), ['a', '-']);
});

test('parseTrArgv: translate, delete, squeeze, errors', () => {
  assert.equal(parseTrArgv(['--help']).help, true);
  assert.match(TR_HELP, /complement/);

  const t = parseTrArgv(['a-z', 'A-Z']);
  assert.equal(t.ok, true);
  assert.equal(t.delete, false);
  assert.equal(t.squeeze, false);
  assert.equal(t.squeezeOnly, false);
  assert.deepEqual(t.operands, ['a-z', 'A-Z']);

  const d = parseTrArgv(['-d', 'x']);
  assert.equal(d.ok, true);
  assert.equal(d.delete, true);
  assert.deepEqual(d.operands, ['x']);

  const cd = parseTrArgv(['-cd', '0-9']);
  assert.equal(cd.ok, true);
  assert.equal(cd.complement, true);
  assert.equal(cd.delete, true);

  const badComp = parseTrArgv(['-c', 'a', 'b']);
  assert.equal(badComp.ok, false);
  assert.match(badComp.stderr, /complement/);

  const ds = parseTrArgv(['-d', '-s']);
  assert.equal(ds.ok, false);

  const sq = parseTrArgv(['-s', 'a']);
  assert.equal(sq.ok, true);
  assert.equal(sq.squeezeOnly, true);

  const sq2 = parseTrArgv(['-s', 'a-z', 'A-Z']);
  assert.equal(sq2.ok, true);
  assert.equal(sq2.squeezeOnly, false);
});

test('runTr: translate, delete, complement delete, squeeze', () => {
  const A = expandTrSetString('a-z');
  const B = expandTrSetString('A-Z');
  assert.equal(runTr('hello', { set1: A, set2: B, squeezeOnly: false }), 'HELLO');

  assert.equal(
    runTr('aaxxaa', {
      delete: true,
      set1: expandTrSetString('x'),
      set2: [],
      squeezeOnly: false
    }),
    'aaaa'
  );

  assert.equal(
    runTr('a1b2', {
      complement: true,
      delete: true,
      set1: expandTrSetString('0-9'),
      set2: [],
      squeezeOnly: false
    }),
    '12'
  );

  assert.equal(
    runTr('xxa', {
      squeeze: true,
      squeezeOnly: true,
      set1: expandTrSetString('x'),
      set2: [],
      complement: false,
      delete: false
    }),
    'xa'
  );
});

test('parseSedArgv: -n, -e, --, operands', () => {
  assert.equal(parseSedArgv(['--help']).help, true);
  const a = parseSedArgv(['s/a/b/']);
  assert.equal(a.ok, true);
  assert.equal(a.quiet, false);
  assert.deepEqual(a.scripts, ['s/a/b/']);
  assert.deepEqual(a.fileOperands, []);
  const b = parseSedArgv(['-n', '-e', 's/a/b/', 'f.txt']);
  assert.equal(b.ok, true);
  assert.equal(b.quiet, true);
  assert.deepEqual(b.scripts, ['s/a/b/']);
  assert.deepEqual(b.fileOperands, ['f.txt']);
  const c = parseSedArgv(['-e', 's/a/b/', '-e', 's/c/d/', 'x']);
  assert.deepEqual(c.scripts, ['s/a/b/', 's/c/d/']);
  assert.deepEqual(c.fileOperands, ['x']);
  const d = parseSedArgv(['--expression=s/a/b/', 'y']);
  assert.deepEqual(d.scripts, ['s/a/b/']);
  assert.deepEqual(d.fileOperands, ['y']);
  const e = parseSedArgv(['--', '-bad']);
  assert.deepEqual(e.fileOperands, ['-bad']);
  assert.equal(parseSedArgv([]).ok, false);
  assert.equal(parseSedArgv(['-x']).ok, false);
});

test('parseSedSubstituteScript and sedApplySubstituteLine', () => {
  const p = parseSedSubstituteScript('s|foo|bar|g');
  assert.equal(p.ok, true);
  assert.equal(p.pattern, 'foo');
  assert.equal(p.replacement, 'bar');
  assert.equal(p.global, true);
  const one = sedApplySubstituteLine('foo foo', {
    pattern: 'foo',
    replacement: 'x',
    global: false,
    ignoreCase: false
  });
  assert.equal(one.line, 'x foo');
  assert.equal(one.subbed, true);
  const g = sedApplySubstituteLine('foo foo', {
    pattern: 'foo',
    replacement: 'x',
    global: true,
    ignoreCase: false
  });
  assert.equal(g.line, 'x x');
  const amp = sedApplySubstituteLine('ab', {
    pattern: 'a',
    replacement: '(&)',
    global: false,
    ignoreCase: false
  });
  assert.equal(amp.line, '(a)b');
  assert.equal(parseSedSubstituteScript('d').ok, false);
});

test('parseSedScript: d and s', () => {
  const del = parseSedScript('d');
  assert.equal(del.ok, true);
  assert.equal(del.kind, 'delete');
  assert.equal(del.address, null);
  assert.equal(parseSedScript('  d  ').kind, 'delete');
  const sub = parseSedScript('s|x|y|');
  assert.equal(sub.ok, true);
  assert.equal(sub.kind, 'substitute');
  assert.equal(sub.pattern, 'x');
  assert.equal(sub.replacement, 'y');
});

test('parseSedScript: line-addressed d', () => {
  const a = parseSedScript('1d');
  assert.equal(a.ok, true);
  assert.equal(a.kind, 'delete');
  assert.deepEqual(a.address, { type: 'single', n: 1 });
  assert.deepEqual(parseSedScript('12d').address, { type: 'single', n: 12 });
  assert.deepEqual(parseSedScript('$d').address, { type: 'single', last: true });
  assert.deepEqual(parseSedScript('2,5d').address, { type: 'range', start: 2, end: 5 });
  assert.deepEqual(parseSedScript('3,$d').address, { type: 'range', start: 3, end: 'last' });
  assert.equal(parseSedAddressedDelete('1d')?.ok, true);
  assert.equal(parseSedAddressedDelete('d'), null);
});

test('parseSedScript: /pat1/,/pat2/d (literal range)', () => {
  const r = parseSedScript('/foo/,/bar/d');
  assert.equal(r.ok, true);
  assert.equal(r.kind, 'delete');
  assert.deepEqual(r.address, { type: 'patternRange', start: 'foo', end: 'bar' });
  assert.deepEqual(parseSedScript('/a\\/b/,/c\\/d/d').address, {
    type: 'patternRange',
    start: 'a/b',
    end: 'c/d'
  });
  assert.equal(parseSedSlashPatternRangeDelete('/foo/d'), null);
  assert.deepEqual(parseSedScript('/foo/,3d').address, {
    type: 'patternToLine',
    pattern: 'foo',
    n: 3
  });
  assert.equal(parseSedSlashPatternToLineDelete('/foo/,/bar/d'), null);
});

test('parseSedScript: N,/pat/d (line + pattern)', () => {
  const r = parseSedScript('2,/c/d');
  assert.equal(r.ok, true);
  assert.deepEqual(r.address, { type: 'lineToPattern', n: 2, pattern: 'c' });
  assert.equal(parseSedLineToPatternDelete('1,2d'), null);
});

test('parseSedScript: /pattern/d (literal substring)', () => {
  const p = parseSedScript('/b/d');
  assert.equal(p.ok, true);
  assert.equal(p.kind, 'delete');
  assert.deepEqual(p.address, { type: 'pattern', pattern: 'b' });
  assert.deepEqual(parseSedScript('//d').address, { type: 'pattern', pattern: '' });
  assert.deepEqual(parseSedScript('/a\\/c/d').address, { type: 'pattern', pattern: 'a/c' });
  assert.equal(parseSedSlashPatternDelete('bar'), null);
  const bad = parseSedScript('/foo/');
  assert.equal(bad.ok, false);
  assert.match(String(bad.stderr), /missing command/);
  const bad2 = parseSedScript('/foo/x');
  assert.equal(bad2.ok, false);
  assert.match(String(bad2.stderr), /unsupported command/);
});

test('sedLineMatchesDeleteAddress', () => {
  assert.equal(sedLineMatchesDeleteAddress({ type: 'single', n: 2 }, 2, 5), true);
  assert.equal(sedLineMatchesDeleteAddress({ type: 'single', n: 2 }, 1, 5), false);
  assert.equal(sedLineMatchesDeleteAddress({ type: 'single', last: true }, 4, 4), true);
  assert.equal(sedLineMatchesDeleteAddress({ type: 'range', start: 2, end: 4 }, 3, 10), true);
  assert.equal(sedLineMatchesDeleteAddress({ type: 'range', start: 5, end: 3 }, 4, 10), false);
  assert.equal(sedLineMatchesDeleteAddress({ type: 'range', start: 2, end: 'last' }, 2, 7), true);
  assert.equal(sedLineMatchesDeleteAddress({ type: 'range', start: 2, end: 'last' }, 1, 7), false);
  assert.equal(sedLineMatchesDeleteAddress({ type: 'pattern', pattern: 'b' }, 1, 5, 'xb'), true);
  assert.equal(sedLineMatchesDeleteAddress({ type: 'pattern', pattern: 'b' }, 1, 5, 'xx'), false);
  assert.equal(sedLineMatchesDeleteAddress({ type: 'pattern', pattern: '' }, 1, 5, 'xx'), true);
});

test('sedProcessContent: addressed d', () => {
  const d2 = parseSedScript('2d');
  assert.equal(sedProcessContent('a\nb\nc\n', [d2], false), 'a\nc\n');
  assert.equal(sedProcessContent('a\nb\nc\n', [parseSedScript('$d')], false), 'a\nb\n');
  assert.equal(sedProcessContent('a\nb\nc\n', [parseSedScript('2,3d')], false), 'a\n');
  assert.equal(sedProcessContent('a\nb\nc\n', [parseSedScript('1,$d')], false), '');
  assert.equal(sedProcessContent('a\nb\nc\n', [parseSedScript('5,3d')], false), 'a\nb\nc\n');
});

test('sedProcessContent: /pat1/,/pat2/d (range)', () => {
  const spec = parseSedScript('/foo/,/bar/d');
  assert.equal(sedProcessContent('x\nfoo\nmid\nbar\nz\n', [spec], false), 'x\nz\n');
  assert.equal(sedProcessContent('x\nfoo\nmid\nz\n', [spec], false), 'x\n');
  assert.equal(
    sedProcessContent('a\nfoo\nb\nfoo\nc\n', [parseSedScript('/foo/,/foo/d')], false),
    'a\nc\n'
  );
  assert.equal(sedProcessContent('foobar\n', [parseSedScript('/foo/,/bar/d')], false), '');
});

test('sedProcessContent: /pat/,Nd and N,/pat/d (GNU mixed addresses)', () => {
  assert.equal(sedProcessContent('a\nb\nc\nd\n', [parseSedScript('/b/,3d')], false), 'a\nd\n');
  assert.equal(sedProcessContent('a\nb\nc\nd\n', [parseSedScript('2,/c/d')], false), 'a\nd\n');
  assert.equal(sedProcessContent('a\nb\nc\nd\n', [parseSedScript('/c/,2d')], false), 'a\nb\nd\n');
  assert.equal(sedProcessContent('a\nb\nc\n', [parseSedScript('/c/,1d')], false), 'a\nb\n');
});

test('parseSedScript: addressed s/// (literal addresses)', () => {
  const one = parseSedScript('2s/a/A/');
  assert.equal(one.ok, true);
  assert.equal(one.kind, 'substitute');
  assert.deepEqual(one.address, { type: 'single', n: 2 });
  assert.equal(one.pattern, 'a');

  const range = parseSedScript('1,2s/b/B/');
  assert.equal(range.ok, true);
  assert.deepEqual(range.address, { type: 'range', start: 1, end: 2 });

  const toLast = parseSedScript('2,$s/c/C/');
  assert.equal(toLast.ok, true);
  assert.deepEqual(toLast.address, { type: 'range', start: 2, end: 'last' });

  const slash = parseSedScript('/x/s/foo/bar/');
  assert.equal(slash.ok, true);
  assert.deepEqual(slash.address, { type: 'pattern', pattern: 'x' });

  const ltp = parseSedScript('2,/c/s/o/O/');
  assert.equal(ltp.ok, true);
  assert.equal(ltp.address.type, 'lineToPattern');

  const ptl = parseSedScript('/b/,3s/b/B/');
  assert.equal(ptl.ok, true);
  assert.equal(ptl.address.type, 'patternToLine');

  const pr = parseSedScript('/foo/,/bar/s/i/I/');
  assert.equal(pr.ok, true);
  assert.equal(pr.address.type, 'patternRange');
});

test('sedProcessContent: addressed s///', () => {
  assert.equal(sedProcessContent('a\nb\nc\n', [parseSedScript('2s/b/B/')], false), 'a\nB\nc\n');
  assert.equal(sedProcessContent('a\nb\nc\n', [parseSedScript('1,2s/b/B/')], false), 'a\nB\nc\n');
  assert.equal(sedProcessContent('a\nb\nc\n', [parseSedScript('1,$s/a/@/')], false), '@\nb\nc\n');
  assert.equal(
    sedProcessContent('a\nb\nc\nd\n', [parseSedScript('/b/s/b/B/')], false),
    'a\nB\nc\nd\n'
  );
  assert.equal(
    sedProcessContent('x\nfoo\nmid\nbar\nz\n', [parseSedScript('/foo/,/bar/s/i/I/')], false),
    'x\nfoo\nmId\nbar\nz\n'
  );
  assert.equal(
    sedProcessContent('a\nb\nc\nd\n', [parseSedScript('2,/c/s/b/B/')], false),
    'a\nB\nc\nd\n'
  );
  assert.equal(
    sedProcessContent('a\nb\nc\nd\n', [parseSedScript('/b/,3s/b/B/')], false),
    'a\nB\nc\nd\n'
  );
});

test('sedProcessContent: /pattern/d', () => {
  assert.equal(
    sedProcessContent('foo\nbar\nbaz\n', [parseSedScript('/bar/d')], false),
    'foo\nbaz\n'
  );
  assert.equal(sedProcessContent('keep\n', [parseSedScript('/nope/d')], false), 'keep\n');
  assert.equal(sedProcessContent('a\nb\n', [parseSedScript('//d')], false), '');
});

test('sedProcessContent: autoprint, -n, p flag', () => {
  const spec = parseSedSubstituteScript('s/a/A/');
  assert.equal(spec.ok, true);
  assert.equal(sedProcessContent('a\nb\n', [spec], false), 'A\nb\n');
  const specP = parseSedSubstituteScript('s/a/A/p');
  assert.equal(specP.ok, true);
  const outP = sedProcessContent('a\n', [specP], false);
  assert.equal(outP, 'A\nA\n');
  const specN = parseSedSubstituteScript('s/a/A/p');
  assert.equal(sedProcessContent('a\nb\n', [specN], true), 'A\n');
});

test('sedProcessContent: d deletes lines; d after s', () => {
  const d = parseSedScript('d');
  assert.equal(d.ok, true);
  assert.equal(sedProcessContent('a\nb\n', [d], false), '');
  assert.equal(sedProcessContent('', [d], false), '');
  const sThenD = [parseSedScript('s/a/A/'), parseSedScript('d')];
  assert.equal(sThenD[0].ok && sThenD[1].ok, true);
  assert.equal(sedProcessContent('a\nb\n', sThenD, false), '');
  assert.equal(sedProcessContent('b\n', sThenD, false), '');
  const pThenD = [parseSedScript('s/a/A/p'), parseSedScript('d')];
  assert.equal(sedProcessContent('a\n', pThenD, true), 'A\n');
  assert.equal(sedProcessContent('a\n', pThenD, false), 'A\n');
});

test('splitSedScriptIntoCommands: ; lists (GNU-style)', () => {
  assert.deepEqual(splitSedScriptIntoCommands('').commands, []);
  assert.deepEqual(splitSedScriptIntoCommands('   ').commands, []);
  const a = splitSedScriptIntoCommands('s/a/A/;2d');
  assert.equal(a.ok, true);
  assert.deepEqual(a.commands, ['s/a/A/', '2d']);
  const b = splitSedScriptIntoCommands('s/a;b/c/g');
  assert.equal(b.ok, true);
  assert.deepEqual(b.commands, ['s/a;b/c/g']);
  const c = splitSedScriptIntoCommands(';s/x/y/;');
  assert.equal(c.ok, true);
  assert.deepEqual(c.commands, ['s/x/y/']);
  const bad = splitSedScriptIntoCommands('s/a/b/ bogus');
  assert.equal(bad.ok, false);
});

test('sedProcessContent: ; command list in one script', () => {
  const q = splitSedScriptIntoCommands('s/a/A/;2d');
  assert.equal(q.ok, true);
  const specs = q.commands.map((f) => parseSedScript(f));
  assert.ok(specs.every((sp) => sp.ok));
  assert.equal(sedProcessContent('a\nb\n', specs, false), 'A\n');
  const q2 = splitSedScriptIntoCommands('s/a/A/;/foo/d');
  assert.equal(q2.ok, true);
  const specs2 = q2.commands.map((f) => parseSedScript(f));
  assert.equal(sedProcessContent('a\nfoo\nb\n', specs2, false), 'A\nb\n');
});

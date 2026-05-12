import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FmtLib } from '../commands/filesystem/fmt-lib.js';

const {
  parseFmtArgv,
  fmtFmtText,
  fmtFmtDefaultGoal,
  parseFmtGoalValue,
  fmtPrefixMatchLine,
  fmtLeadingSpaceCount,
  fmtWrapWordsCrown,
  FMT_DEFAULT_WIDTH,
  FMT_FMT_GOAL_NUMERATOR,
  FMT_FMT_GOAL_DENOMINATOR,
  FMT_VERSION_LINE
} = FmtLib;

test('parseFmtArgv: -c -p -s -t -u -w, --width, --, help, version', () => {
  const def = parseFmtArgv([]);
  assert.equal(def.ok, true);
  assert.equal(def.width, FMT_DEFAULT_WIDTH);
  assert.equal(def.goal, fmtFmtDefaultGoal(FMT_DEFAULT_WIDTH));
  assert.equal(
    def.goal,
    ((FMT_DEFAULT_WIDTH * FMT_FMT_GOAL_NUMERATOR) / FMT_FMT_GOAL_DENOMINATOR) | 0
  );
  assert.equal(def.splitOnly, false);
  assert.equal(def.uniformSpacing, false);
  assert.equal(def.crownMargin, false);
  assert.equal(def.taggedParagraph, false);
  assert.equal(def.prefix, null);
  assert.deepEqual(def.operands, []);

  const w10 = parseFmtArgv(['-w', '10', 'f']);
  assert.equal(w10.ok, true);
  assert.equal(w10.width, 10);
  assert.deepEqual(w10.operands, ['f']);

  const suw = parseFmtArgv(['-suw40', 'x']);
  assert.equal(suw.ok, true);
  assert.equal(suw.splitOnly, true);
  assert.equal(suw.uniformSpacing, true);
  assert.equal(suw.width, 40);
  assert.deepEqual(suw.operands, ['x']);

  const crown = parseFmtArgv(['-c', '--', 'f']);
  assert.equal(crown.ok, true);
  assert.equal(crown.crownMargin, true);
  assert.deepEqual(crown.operands, ['f']);

  const sc = parseFmtArgv(['-scw30']);
  assert.equal(sc.ok, true);
  assert.equal(sc.crownMargin, true);
  assert.equal(sc.splitOnly, true);
  assert.equal(sc.width, 30);

  const pt = parseFmtArgv(['-t', '-p', '>']);
  assert.equal(pt.ok, true);
  assert.equal(pt.taggedParagraph, true);
  assert.equal(pt.prefix, '>');

  const pglue = parseFmtArgv(['-p>', 'f']);
  assert.equal(pglue.ok, true);
  assert.equal(pglue.prefix, '>');
  assert.deepEqual(pglue.operands, ['f']);

  const plong = parseFmtArgv(['--prefix=>>']);
  assert.equal(plong.ok, true);
  assert.equal(plong.prefix, '>>');

  assert.equal(parseFmtArgv(['--help']).help, true);
  assert.equal(parseFmtArgv(['-?']).help, true);
  assert.equal(parseFmtArgv(['--version']).version, true);
  assert.equal(FMT_VERSION_LINE, 'fmt (jsh Heyming Terminal) 1.0\n');

  assert.deepEqual(parseFmtArgv(['--', '-w']).operands, ['-w']);

  const badW = parseFmtArgv(['-w', '0']);
  assert.equal(badW.ok, false);
  assert.match(badW.stderr, /positive|invalid/);

  const badOpt = parseFmtArgv(['-x']);
  assert.equal(badOpt.ok, false);
  assert.match(badOpt.stderr, /invalid option/);

  const badP = parseFmtArgv(['-p']);
  assert.equal(badP.ok, false);
  assert.match(badP.stderr, /prefix/);

  const gOnly = parseFmtArgv(['-g', '50']);
  assert.equal(gOnly.ok, true);
  assert.equal(gOnly.goal, 50);
  assert.equal(gOnly.width, 60);

  const gw = parseFmtArgv(['-w', '80', '-g', '50']);
  assert.equal(gw.ok, true);
  assert.equal(gw.width, 80);
  assert.equal(gw.goal, 50);

  const gGlued = parseFmtArgv(['-g5', '-w', '12']);
  assert.equal(gGlued.ok, true);
  assert.equal(gGlued.goal, 5);
  assert.equal(gGlued.width, 12);

  const badGoal = parseFmtArgv(['-w', '40', '-g', '50']);
  assert.equal(badGoal.ok, false);
  assert.match(badGoal.stderr, /goal width greater than maximum/);

  assert.equal(parseFmtGoalValue('10', 10).ok, true);
  assert.equal(parseFmtGoalValue('11', 10).ok, false);
});
test('fmtFmtText: paragraphs, -s, -u, width, trailing newline', () => {
  const para = 'hello world\nfoo bar\n\nnext block\n';
  const out = fmtFmtText(para, 12, false, true);
  assert.match(out, /hello world/);
  assert.match(out, /foo bar/);
  assert.match(out, /\n\n/);
  assert.ok(out.endsWith('\n'));

  const splitOnlyWrapped = fmtFmtText('short\n' + 'x'.repeat(25), 10, true, true);
  assert.ok(splitOnlyWrapped.startsWith('short\n'));
  assert.ok(splitOnlyWrapped.split('\n').length > 1, '-s wraps long line only');

  const uniform = fmtFmtText('Hi. There.', 20, false, true);
  assert.equal(uniform.indexOf('  '), -1, '-u uses single spaces');

  const noUniform = fmtFmtText('Hi. There.', 20, false, false);
  assert.ok(noUniform.includes('.  T'), 'two spaces after sentence when not -u');

  assert.equal(fmtFmtText('', 75, false, true), '');
  assert.equal(fmtFmtText('café '.repeat(5), 6, false, true), 'café\ncafé\ncafé\ncafé\ncafé');
});

test('fmtFmtText: -c crown margin (indents + paragraph split)', () => {
  assert.equal(fmtLeadingSpaceCount('   hi'), 3);
  assert.equal(fmtLeadingSpaceCount('\thi'), 0);

  const tabExpanded = fmtFmtText('\tfirst\n\tsecond line\n', 40, false, true, true);
  assert.equal(tabExpanded.includes('\t'), false, 'TAB expanded before formatting');
  assert.ok(tabExpanded.includes('        first'), 'leading tab → 8 spaces (GNU stops)');

  const twoIndent = fmtFmtText(
    '  Short first\n    Longer second line here\n    more body\n',
    28,
    false,
    true,
    true
  );
  assert.ok(twoIndent.includes('  Short first'), 'first line uses first-line indent');
  assert.ok(twoIndent.includes('\n    '), 'continuation uses second-line indent');

  const splitPara = fmtFmtText('  first\n    second line\n  third alone\n', 50, false, true, true);
  assert.ok(splitPara.includes('first'), 'crown paragraph');
  assert.ok(splitPara.includes('third alone'), 'line with wrong body indent starts new paragraph');

  const sc = fmtFmtText('    hello world this is long\n', 24, true, true, true);
  assert.ok(sc.startsWith('    hello'), '-s -c preserves leading spaces per line');

  const wrap = fmtWrapWordsCrown(['a', 'b', 'c'], 6, true, 2, 4);
  assert.match(wrap, /^ {2}a b\n {4}c$/, 'narrow width forces wrap with crown indents');
});

test('fmtPrefixMatchLine', () => {
  assert.deepEqual(fmtPrefixMatchLine('>foo', '>'), { prefixPart: '>', rest: 'foo' });
  assert.deepEqual(fmtPrefixMatchLine('  > foo', '>'), { prefixPart: '  >', rest: ' foo' });
  assert.equal(fmtPrefixMatchLine('plain', '>'), null);
});

test('fmtFmtText: -t tagged paragraph (GNU-style)', () => {
  const singleTagged = fmtFmtText('    First line long text here\n', 20, false, true, false, true);
  assert.ok(singleTagged.includes('    First line long'), 'first line keeps indent');
  assert.ok(singleTagged.includes('\ntext here'), 'continuation has no indent (GNU -t)');

  const sameIndentTwo = fmtFmtText('  a b c d e f\n  g h i\n', 12, false, true, false, true);
  assert.ok(
    sameIndentTwo.includes('  a b c d e'),
    'line 1 wrapped (GNU -t: continuations unindented)'
  );
  assert.ok(sameIndentTwo.includes('\nf\n'), 'line 1 continuation');
  assert.ok(sameIndentTwo.includes('  g h i'), 'line 2 separate paragraph');

  const diffIndent = fmtFmtText(
    '    First line long text\n  rest of paragraph here\n',
    40,
    false,
    true,
    false,
    true
  );
  assert.ok(diffIndent.includes('    First line long text rest'), 'tagged merge like crown');
  assert.ok(diffIndent.includes('  paragraph here'), 'body indent');
});

test('fmtFmtText: -p prefix (GNU-style)', () => {
  const merged = fmtFmtText(
    '> one two three four five six\n> seven eight\n',
    25,
    false,
    true,
    false,
    false,
    '>'
  );
  assert.ok(merged.includes('> one two three four'), 'prefixed lines merge (GNU -p)');
  assert.ok(merged.includes('> five six seven eight'), 'prefixed wrap continues (goal-based fill)');

  const plain = fmtFmtText('> a b\nplain\n> c\n', 40, false, true, false, false, '>');
  assert.ok(plain.includes('plain'), 'non-prefix line passes through');
  assert.ok(plain.includes('> a b'), '> paragraph');
  assert.ok(plain.includes('> c'), 'second > block');

  const ps = fmtFmtText('> a b\n> c d\n', 40, true, true, false, false, '>');
  assert.ok(ps.includes('> a b\n> c d'), '-p -s does not merge short prefixed lines');
});

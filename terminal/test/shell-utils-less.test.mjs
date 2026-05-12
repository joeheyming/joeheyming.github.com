import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LessLib } from '../commands/system/less-lib.js';

const {
  parseLessArgv,
  lessContentFitsOneScreen,
  lessFormatWithLineNumbers,
  lessSqueezeBlankLines,
  lessExpandTabsInLine,
  lessExpandTabsInText,
  LESS_DEFAULT_TAB_STOPS,
  lessInitialScrollLine,
  lessScrollLineForTargetLineOneBased,
  lessTargetLineOneBasedFromPrefix,
  lessHalfPageLineCount,
  lessRepeatCountFromPrefix,
  formatLessSearchMatchFooter,
  lessStripAnsi,
  lessAnsiToHtml,
  LESS_VERSION_LINE,
  LESS_LINES_PER_PAGE
} = LessLib;

test('parseLessArgv: +N/+G, -F, -N, -S, --html, --, help, too many args, errors', () => {
  const empty = parseLessArgv([]);
  assert.equal(empty.ok, true);
  assert.equal(empty.quitIfOneScreen, false);
  assert.equal(empty.quitAtEofMode, 'none');
  assert.equal(empty.lineNumbers, false);
  assert.equal(empty.chopLongLines, false);
  assert.equal(empty.squeezeBlankLines, false);
  assert.equal(empty.longPrompt, false);
  assert.equal(empty.ignoreCase, false);
  assert.equal(empty.rawControlChars, false);
  assert.equal(empty.html, false);
  assert.equal(empty.startSpec, null);
  assert.equal(empty.pattern, null);
  assert.deepEqual(empty.operands, []);
  assert.equal(empty.tabStops, LESS_DEFAULT_TAB_STOPS);

  const plusLine = parseLessArgv(['+25', 'f']);
  assert.equal(plusLine.ok, true);
  assert.deepEqual(plusLine.startSpec, { kind: 'line', line: 25 });
  assert.deepEqual(plusLine.operands, ['f']);

  const plusG = parseLessArgv(['+G', 'a']);
  assert.equal(plusG.ok, true);
  assert.deepEqual(plusG.startSpec, { kind: 'eof' });
  assert.deepEqual(plusG.operands, ['a']);

  const plusLowerG = parseLessArgv(['+g', 'b']);
  assert.equal(plusLowerG.ok, true);
  assert.deepEqual(plusLowerG.startSpec, { kind: 'eof' });

  const plusOrder = parseLessArgv(['-F', '+10', 'file']);
  assert.equal(plusOrder.ok, true);
  assert.equal(plusOrder.quitIfOneScreen, true);
  assert.deepEqual(plusOrder.startSpec, { kind: 'line', line: 10 });
  assert.deepEqual(plusOrder.operands, ['file']);

  const plusAfterDash = parseLessArgv(['--', '+10']);
  assert.equal(plusAfterDash.ok, true);
  assert.equal(plusAfterDash.startSpec, null);
  assert.deepEqual(plusAfterDash.operands, ['+10']);

  const tooManyPlus = parseLessArgv(['+1', '+2', 'f']);
  assert.equal(tooManyPlus.ok, false);
  assert.match(String(tooManyPlus.stderr), /too many \+ commands/);

  const badPlus = parseLessArgv(['+/pat', 'f']);
  assert.equal(badPlus.ok, false);
  assert.match(String(badPlus.stderr), /\+\/pattern/);

  const plusOnly = parseLessArgv(['+']);
  assert.equal(plusOnly.ok, false);

  const f = parseLessArgv(['-F', 'a']);
  assert.equal(f.ok, true);
  assert.equal(f.quitIfOneScreen, true);
  assert.equal(f.lineNumbers, false);
  assert.deepEqual(f.operands, ['a']);

  const n = parseLessArgv(['-N', '-F', 'f']);
  assert.equal(n.ok, true);
  assert.equal(n.lineNumbers, true);
  assert.equal(n.quitIfOneScreen, true);
  assert.deepEqual(n.operands, ['f']);

  const longN = parseLessArgv(['--LINE-NUMBERS', 'x']);
  assert.equal(longN.ok, true);
  assert.equal(longN.lineNumbers, true);

  const chop = parseLessArgv(['-S', 'file']);
  assert.equal(chop.ok, true);
  assert.equal(chop.chopLongLines, true);
  assert.deepEqual(chop.operands, ['file']);

  const chopLong = parseLessArgv(['--chop-long-lines', 'a']);
  assert.equal(chopLong.ok, true);
  assert.equal(chopLong.chopLongLines, true);

  const sq = parseLessArgv(['-s', 'file']);
  assert.equal(sq.ok, true);
  assert.equal(sq.squeezeBlankLines, true);
  assert.deepEqual(sq.operands, ['file']);

  const sqLong = parseLessArgv(['--squeeze-blank-lines', 'a']);
  assert.equal(sqLong.ok, true);
  assert.equal(sqLong.squeezeBlankLines, true);

  const sn = parseLessArgv(['-S', '-N', 'x']);
  assert.equal(sn.ok, true);
  assert.equal(sn.chopLongLines, true);
  assert.equal(sn.lineNumbers, true);

  const longF = parseLessArgv(['--quit-if-one-screen', '--', '-x']);
  assert.equal(longF.ok, true);
  assert.equal(longF.quitIfOneScreen, true);
  assert.deepEqual(longF.operands, ['-x']);

  const html = parseLessArgv(['--html', 'f']);
  assert.equal(html.ok, true);
  assert.equal(html.html, true);

  const ign = parseLessArgv(['-i', 'readme']);
  assert.equal(ign.ok, true);
  assert.equal(ign.ignoreCase, true);
  assert.deepEqual(ign.operands, ['readme']);

  const ignLong = parseLessArgv(['--ignore-case', 'x']);
  assert.equal(ignLong.ok, true);
  assert.equal(ignLong.ignoreCase, true);

  const raw = parseLessArgv(['-R', 'f']);
  assert.equal(raw.ok, true);
  assert.equal(raw.rawControlChars, true);
  assert.deepEqual(raw.operands, ['f']);

  const rawLong = parseLessArgv(['--RAW-CONTROL-CHARS', 'a']);
  assert.equal(rawLong.ok, true);
  assert.equal(rawLong.rawControlChars, true);

  const lm = parseLessArgv(['-m', 'f']);
  assert.equal(lm.ok, true);
  assert.equal(lm.longPrompt, true);
  assert.deepEqual(lm.operands, ['f']);

  const lM = parseLessArgv(['-M', 'a']);
  assert.equal(lM.ok, true);
  assert.equal(lM.longPrompt, true);

  const longP = parseLessArgv(['--long-prompt', 'b']);
  assert.equal(longP.ok, true);
  assert.equal(longP.longPrompt, true);

  const longPU = parseLessArgv(['--LONG-PROMPT', 'c']);
  assert.equal(longPU.ok, true);
  assert.equal(longPU.longPrompt, true);

  assert.equal(parseLessArgv(['--help']).help, true);
  assert.equal(parseLessArgv(['-h']).help, true);
  assert.equal(parseLessArgv(['-?']).help, true);

  const vShort = parseLessArgv(['-V']);
  assert.equal(vShort.ok, true);
  assert.equal(vShort.version, true);
  const vLong = parseLessArgv(['--version']);
  assert.equal(vLong.ok, true);
  assert.equal(vLong.version, true);
  assert.match(LESS_VERSION_LINE, /less \(jsh Heyming Terminal\)/);

  const extra = parseLessArgv(['a', 'b']);
  assert.equal(extra.ok, false);
  assert.match(String(extra.stderr), /too many arguments/);

  const bad = parseLessArgv(['-z']);
  assert.equal(bad.ok, false);
  assert.match(String(bad.stderr), /invalid option -- 'z'/);

  const pShort = parseLessArgv(['-p', 'foo', 'f']);
  assert.equal(pShort.ok, true);
  assert.equal(pShort.pattern, 'foo');
  assert.deepEqual(pShort.operands, ['f']);

  const pEq = parseLessArgv(['--pattern=bar', 'x']);
  assert.equal(pEq.ok, true);
  assert.equal(pEq.pattern, 'bar');

  const pLong = parseLessArgv(['--pattern', 'baz', 'y']);
  assert.equal(pLong.ok, true);
  assert.equal(pLong.pattern, 'baz');

  const pConflict = parseLessArgv(['+10', '-p', 'x', 'f']);
  assert.equal(pConflict.ok, false);
  assert.match(String(pConflict.stderr), /start command.*pattern/);

  const dupP = parseLessArgv(['-p', 'a', '-p', 'b', 'f']);
  assert.equal(dupP.ok, false);
  assert.match(String(dupP.stderr), /duplicate pattern/);

  const pMissing = parseLessArgv(['-p']);
  assert.equal(pMissing.ok, false);
  assert.match(String(pMissing.stderr), /requires an argument/);

  const patMissing = parseLessArgv(['--pattern']);
  assert.equal(patMissing.ok, false);

  const eEof = parseLessArgv(['-e', 'f']);
  assert.equal(eEof.ok, true);
  assert.equal(eEof.quitAtEofMode, 'second');

  const bigE = parseLessArgv(['-E', 'x']);
  assert.equal(bigE.ok, true);
  assert.equal(bigE.quitAtEofMode, 'first');

  const eLong = parseLessArgv(['--quit-at-eof', 'a']);
  assert.equal(eLong.ok, true);
  assert.equal(eLong.quitAtEofMode, 'second');

  const bigELong = parseLessArgv(['--QUIT-AT-EOF', 'b']);
  assert.equal(bigELong.ok, true);
  assert.equal(bigELong.quitAtEofMode, 'first');

  const eThenBig = parseLessArgv(['-e', '-E', 'c']);
  assert.equal(eThenBig.ok, true);
  assert.equal(eThenBig.quitAtEofMode, 'first');

  const bigThenE = parseLessArgv(['-E', '-e', 'd']);
  assert.equal(bigThenE.ok, true);
  assert.equal(bigThenE.quitAtEofMode, 'first');

  const tabs4 = parseLessArgv(['-#', '4', 'f']);
  assert.equal(tabs4.ok, true);
  assert.equal(tabs4.tabStops, 4);
  assert.deepEqual(tabs4.operands, ['f']);

  const tabsHash = parseLessArgv(['-#8', 'a']);
  assert.equal(tabsHash.ok, true);
  assert.equal(tabsHash.tabStops, 8);
  assert.deepEqual(tabsHash.operands, ['a']);

  const tabsX = parseLessArgv(['-x', 'f']);
  assert.equal(tabsX.ok, true);
  assert.equal(tabsX.tabStops, LESS_DEFAULT_TAB_STOPS);
  assert.deepEqual(tabsX.operands, ['f']);

  const tabsXn = parseLessArgv(['-x3', 'b']);
  assert.equal(tabsXn.ok, true);
  assert.equal(tabsXn.tabStops, 3);

  const tabsEq = parseLessArgv(['--tabs=2', 'c']);
  assert.equal(tabsEq.ok, true);
  assert.equal(tabsEq.tabStops, 2);

  const tabsLong = parseLessArgv(['--tabs', '5', 'd']);
  assert.equal(tabsLong.ok, true);
  assert.equal(tabsLong.tabStops, 5);

  const badTabs = parseLessArgv(['--tabs=0', 'f']);
  assert.equal(badTabs.ok, false);
  assert.match(String(badTabs.stderr), /invalid tab width/);

  const badHash = parseLessArgv(['-#xx', 'f']);
  assert.equal(badHash.ok, false);
  assert.match(String(badHash.stderr), /invalid option|unrecognized/);
});

test('lessExpandTabsInLine / lessExpandTabsInText: GNU tab stops', () => {
  assert.equal(lessExpandTabsInLine('a\tb', 8), `a${' '.repeat(7)}b`);
  assert.equal(lessExpandTabsInLine('\t', 8), '        ');
  assert.equal(lessExpandTabsInLine('\t\t', 8), `${' '.repeat(8)}${' '.repeat(8)}`);
  assert.equal(lessExpandTabsInLine('x\t', 4), 'x   ');
  assert.equal(lessExpandTabsInText('a\tb\nc\t', 4), `a${' '.repeat(3)}b\nc${' '.repeat(3)}`);
});

test('lessInitialScrollLine: +N and +G vs page size', () => {
  const n = LESS_LINES_PER_PAGE;
  assert.equal(lessInitialScrollLine(0, n, { kind: 'line', line: 5 }), 0);
  assert.equal(lessInitialScrollLine(100, n, { kind: 'eof' }), 100 - n);
  assert.equal(lessInitialScrollLine(100, n, { kind: 'line', line: 5 }), 4);
  assert.equal(lessInitialScrollLine(100, n, { kind: 'line', line: 95 }), 80);
  assert.equal(lessInitialScrollLine(5, n, { kind: 'line', line: 5 }), 0);
});

test('lessScrollLineForTargetLineOneBased: matches +N scroll (Ng / NG in viewer)', () => {
  const n = LESS_LINES_PER_PAGE;
  assert.equal(lessScrollLineForTargetLineOneBased(0, n, 5), 0);
  assert.equal(lessScrollLineForTargetLineOneBased(100, n, 5), 4);
  assert.equal(lessScrollLineForTargetLineOneBased(100, n, 95), 80);
  assert.equal(lessScrollLineForTargetLineOneBased(5, n, 5), 0);
  assert.equal(lessScrollLineForTargetLineOneBased(10, n, 0), 0);
});

test('lessTargetLineOneBasedFromPrefix: empty → null; digits → 1-based line', () => {
  assert.equal(lessTargetLineOneBasedFromPrefix(''), null);
  assert.equal(lessTargetLineOneBasedFromPrefix(undefined), null);
  assert.equal(lessTargetLineOneBasedFromPrefix('5'), 5);
  assert.equal(lessTargetLineOneBasedFromPrefix('0'), 1);
  assert.equal(lessTargetLineOneBasedFromPrefix('9999999'), 1000000);
});

test('lessRepeatCountFromPrefix: GNU-style digit prefix before movement (empty → default)', () => {
  assert.equal(lessRepeatCountFromPrefix(20, ''), 20);
  assert.equal(lessRepeatCountFromPrefix(20, undefined), 20);
  assert.equal(lessRepeatCountFromPrefix(1, '5'), 5);
  assert.equal(lessRepeatCountFromPrefix(20, '12'), 12);
  assert.equal(lessRepeatCountFromPrefix(1, '0'), 1);
  assert.equal(lessRepeatCountFromPrefix(20, '9999999'), 1000000);
});

test('formatLessSearchMatchFooter: match index + 1-based line/column; optional wrap hint', () => {
  assert.equal(
    formatLessSearchMatchFooter({ line: 4, col: 0 }, 2, 10),
    'Found: 3/10 at line 5, col 1'
  );
  assert.equal(
    formatLessSearchMatchFooter({ line: 0, col: 9 }, 0, 1),
    'Found: 1/1 at line 1, col 10'
  );
  assert.equal(
    formatLessSearchMatchFooter({ line: 1, col: 2 }, 0, 3, 'Search wrapped'),
    'Search wrapped — Found: 1/3 at line 2, col 3'
  );
  assert.equal(
    formatLessSearchMatchFooter({ line: 0, col: 0 }, 0, 5, ''),
    'Found: 1/5 at line 1, col 1'
  );
});

test('lessHalfPageLineCount: GNU half-window (floor of page/2, min 1)', () => {
  assert.equal(lessHalfPageLineCount(20), 10);
  assert.equal(lessHalfPageLineCount(LESS_LINES_PER_PAGE), 10);
  assert.equal(lessHalfPageLineCount(3), 1);
  assert.equal(lessHalfPageLineCount(1), 1);
  assert.equal(lessHalfPageLineCount(NaN), 1);
});

test('lessSqueezeBlankLines: GNU -s consecutive empty lines', () => {
  assert.equal(lessSqueezeBlankLines('a\n\n\nb'), 'a\n\nb');
  assert.equal(lessSqueezeBlankLines('a\nb'), 'a\nb');
  assert.equal(lessSqueezeBlankLines(''), '');
  // JS split: three \n → four segments; squeeze collapses to one blank line → empty string
  assert.equal(lessSqueezeBlankLines('\n\n\n'), '');
  assert.equal(lessSqueezeBlankLines('x'), 'x');
});

test('lessFormatWithLineNumbers: GNU-style padded prefixes', () => {
  assert.equal(lessFormatWithLineNumbers('a\nb'), '     1  a\n     2  b');
  assert.equal(lessFormatWithLineNumbers(''), '     1  ');
  const many = Array.from({ length: 12 }, (_, i) => `L${i + 1}`).join('\n');
  const got = lessFormatWithLineNumbers(many);
  assert.ok(got.startsWith('     1  L1'));
  assert.ok(got.includes('\n    12  L12'));
});

test('lessContentFitsOneScreen: line count vs LESS_LINES_PER_PAGE', () => {
  const n = LESS_LINES_PER_PAGE;
  const fits = Array.from({ length: n }, () => 'x').join('\n');
  assert.equal(lessContentFitsOneScreen(fits), true);
  const over = Array.from({ length: n + 1 }, () => 'y').join('\n');
  assert.equal(lessContentFitsOneScreen(over), false);
});

test('lessStripAnsi / lessAnsiToHtml: SGR subset for less -R', () => {
  assert.equal(lessStripAnsi('\x1b[31mhi\x1b[0m'), 'hi');
  assert.equal(lessStripAnsi('no codes'), 'no codes');
  const html = lessAnsiToHtml('\x1b[31mred\x1b[0m');
  assert.match(html, /color:#cd0000/);
  assert.match(html, /red/);
  assert.ok(!html.includes('\x1b'));
  assert.match(lessAnsiToHtml('a<b>\x1b[32mg\x1b[0m'), /&lt;b&gt;/);
});


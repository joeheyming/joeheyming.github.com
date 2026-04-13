import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SedLib } from '../commands/filesystem/sed-lib.js';
import { AwkLib } from '../commands/filesystem/awk-lib.js';
import { LessLib } from '../commands/system/less-lib.js';
import { PrintfLib } from '../commands/filesystem/printf-lib.js';
import { CutLib } from '../commands/filesystem/cut-lib.js';
import { TrLib } from '../commands/filesystem/tr-lib.js';
import { XargsLib } from '../commands/system/xargs-lib.js';
import { NlLib } from '../commands/filesystem/nl-lib.js';
import { PasteLib } from '../commands/filesystem/paste-lib.js';
import { JoinLib } from '../commands/filesystem/join-lib.js';
import { CatLib } from '../commands/filesystem/cat-lib.js';
import { EchoLib } from '../commands/filesystem/echo-lib.js';
import { GrepLib } from '../commands/filesystem/grep-lib.js';
import { LsLib } from '../commands/filesystem/ls-lib.js';
import { WcLib } from '../commands/filesystem/wc-lib.js';
import { FileopsLib } from '../commands/filesystem/fileops-lib.js';
import { SortLib } from '../commands/filesystem/sort-lib.js';
import { UniqLib } from '../commands/filesystem/uniq-lib.js';
import { TeeLib } from '../commands/filesystem/tee-lib.js';
import { MkdirLib } from '../commands/filesystem/mkdir-lib.js';
import { ChmodLib } from '../commands/filesystem/chmod-lib.js';
import { StatLib } from '../commands/filesystem/stat-lib.js';
import { PwdLib } from '../commands/system/pwd-lib.js';
import { DateLib } from '../commands/system/date-lib.js';
import { SeqLib } from '../commands/system/seq-lib.js';
import { SleepLib } from '../commands/system/sleep-lib.js';
import { BasenameLib } from '../commands/filesystem/basename-lib.js';
import { ReadlinkLib } from '../commands/filesystem/readlink-lib.js';
import { LnLib } from '../commands/filesystem/ln-lib.js';
import { TouchLib } from '../commands/filesystem/touch-lib.js';
import { TestLib } from '../commands/system/test-lib.js';

const { parseSedArgv } = SedLib;
const { parseAwkArgv } = AwkLib;
const { parseLessArgv } = LessLib;
const { parsePrintfArgv } = PrintfLib;
const { parseCutArgv } = CutLib;
const { parseTrArgv } = TrLib;
const { parseXargsArgv } = XargsLib;
const { parseNlArgv } = NlLib;
const { parsePasteArgv } = PasteLib;
const { parseJoinArgv } = JoinLib;
const { parseCatArgv } = CatLib;
const { parseEchoArgv } = EchoLib;
const { parseGrepArgv } = GrepLib;
const { parseLsDisplayFlags } = LsLib;
const { parseWcArgv } = WcLib;
const { parseCpArgv, parseMvArgv, parseRmArgv } = FileopsLib;
const { parseSortArgv } = SortLib;
const { parseUniqArgv } = UniqLib;
const { parseTeeArgv } = TeeLib;
const { parseMkdirArgv } = MkdirLib;
const { parseChmodArgv } = ChmodLib;
const { parseStatArgv } = StatLib;
const { parsePwdArgv } = PwdLib;
const { parseDateArgv } = DateLib;
const { parseSeqArgv } = SeqLib;
const { parseSleepArgv } = SleepLib;
const { parseBasenameArgv, parseDirnameArgv } = BasenameLib;
const { parseReadlinkArgv } = ReadlinkLib;
const { parseLnArgv } = LnLib;
const { parseTouchArgv } = TouchLib;
const { parseTrueFalseArgv, parseTestArgv } = TestLib;

// ---------------------------------------------------------------------------
// Characterization tests: lock down current exit code behavior for each parser
// These document the CURRENT behavior (pre-POSIX alignment). Some parsers
// use exitCode 1 for bad options while POSIX expects 2.
// ---------------------------------------------------------------------------

// --- nl / paste / join (dedicated *-lib modules) ---
test('parseNlArgv / parsePasteArgv / parseJoinArgv: --help from libs', () => {
  assert.equal(parseNlArgv(['--help']).help, true);
  assert.equal(parsePasteArgv(['--help']).help, true);
  assert.equal(parseJoinArgv(['--help']).help, true);
});

// --- cat ---
test('parseCatArgv: no args → ok, empty operands', () => {
  const r = parseCatArgv([]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.operands, []);
});

test('parseCatArgv: file operands', () => {
  const r = parseCatArgv(['a.txt', 'b.txt']);
  assert.equal(r.ok, true);
  assert.deepEqual(r.operands, ['a.txt', 'b.txt']);
});

test('parseCatArgv: -- stops option parsing', () => {
  const r = parseCatArgv(['--', '-x']);
  assert.equal(r.ok, true);
  assert.deepEqual(r.operands, ['-x']);
});

test('parseCatArgv: -h shows help', () => {
  const r = parseCatArgv(['-h']);
  assert.equal(r.ok, true);
  assert.equal(r.help, true);
});

test('parseCatArgv: --help shows help', () => {
  const r = parseCatArgv(['--help']);
  assert.equal(r.ok, true);
  assert.equal(r.help, true);
});

test('parseCatArgv: bad option → exitCode 1 (current, not POSIX 2)', () => {
  const r = parseCatArgv(['-z']);
  assert.equal(r.ok, false);
  assert.equal(r.exitCode, 1);
  assert.ok(r.stderr.length > 0);
});

// --- echo ---
test('parseEchoArgv: no args → empty operands', () => {
  const r = parseEchoArgv([]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.operands, []);
  assert.equal(r.noNewline, false);
  assert.equal(r.escapes, false);
});

test('parseEchoArgv: -n suppresses newline', () => {
  const r = parseEchoArgv(['-n', 'hello']);
  assert.equal(r.ok, true);
  assert.equal(r.noNewline, true);
  assert.deepEqual(r.operands, ['hello']);
});

test('parseEchoArgv: -e enables escapes', () => {
  const r = parseEchoArgv(['-e', 'hello']);
  assert.equal(r.ok, true);
  assert.equal(r.escapes, true);
});

test('parseEchoArgv: -ne combined', () => {
  const r = parseEchoArgv(['-ne', 'hello']);
  assert.equal(r.ok, true);
  assert.equal(r.noNewline, true);
  assert.equal(r.escapes, true);
});

test('parseEchoArgv: -- stops options', () => {
  const r = parseEchoArgv(['--', '-n']);
  assert.equal(r.ok, true);
  assert.equal(r.noNewline, false);
  assert.deepEqual(r.operands, ['-n']);
});

test('parseEchoArgv: first non-option arg stops option parsing', () => {
  const r = parseEchoArgv(['hello', '-n']);
  assert.equal(r.ok, true);
  assert.equal(r.noNewline, false);
  assert.deepEqual(r.operands, ['hello', '-n']);
});

test('parseEchoArgv: --help', () => {
  const r = parseEchoArgv(['--help']);
  assert.equal(r.ok, true);
  assert.equal(r.help, true);
});

test('parseEchoArgv: --version', () => {
  const r = parseEchoArgv(['--version']);
  assert.equal(r.ok, true);
  assert.equal(r.version, true);
});

// --- grep ---
test('parseGrepArgv: pattern only', () => {
  const r = parseGrepArgv(['hello']);
  assert.equal(r.ok, true);
  assert.equal(r.pattern, 'hello');
  assert.deepEqual(r.fileOperands, []);
});

test('parseGrepArgv: -i case insensitive', () => {
  const r = parseGrepArgv(['-i', 'hello']);
  assert.equal(r.ok, true);
  assert.equal(r.caseInsensitive, true);
});

test('parseGrepArgv: -n line numbers', () => {
  const r = parseGrepArgv(['-n', 'hello']);
  assert.equal(r.ok, true);
  assert.equal(r.lineNumbers, true);
});

test('parseGrepArgv: -v invert match', () => {
  const r = parseGrepArgv(['-v', 'hello']);
  assert.equal(r.ok, true);
  assert.equal(r.invertMatch, true);
});

test('parseGrepArgv: combined -inv', () => {
  const r = parseGrepArgv(['-inv', 'hello']);
  assert.equal(r.ok, true);
  assert.equal(r.caseInsensitive, true);
  assert.equal(r.lineNumbers, true);
  assert.equal(r.invertMatch, true);
});

test('parseGrepArgv: -- stops options', () => {
  const r = parseGrepArgv(['--', '-i']);
  assert.equal(r.ok, true);
  assert.equal(r.caseInsensitive, false);
  assert.equal(r.pattern, '-i');
});

test('parseGrepArgv: -- with no pattern → error exit 2', () => {
  const r = parseGrepArgv(['--']);
  assert.equal(r.ok, false);
  assert.equal(r.exitCode, 2);
});

test('parseGrepArgv: bad option → exitCode 2', () => {
  const r = parseGrepArgv(['-z', 'hello']);
  assert.equal(r.ok, false);
  assert.equal(r.exitCode, 2);
});

test('parseGrepArgv: bad long option → exitCode 2', () => {
  const r = parseGrepArgv(['--foobar', 'hello']);
  assert.equal(r.ok, false);
  assert.equal(r.exitCode, 2);
});

test('parseGrepArgv: --help', () => {
  const r = parseGrepArgv(['--help']);
  assert.equal(r.ok, true);
  assert.equal(r.help, true);
});

test('parseGrepArgv: file operands after pattern', () => {
  const r = parseGrepArgv(['hello', 'a.txt', 'b.txt']);
  assert.equal(r.ok, true);
  assert.equal(r.pattern, 'hello');
  assert.deepEqual(r.fileOperands, ['a.txt', 'b.txt']);
});

// --- ls ---
test('parseLsDisplayFlags: no args → defaults', () => {
  const r = parseLsDisplayFlags([]);
  assert.equal(r.showDetails, false);
  assert.equal(r.showAll, false);
});

test('parseLsDisplayFlags: -l', () => {
  const r = parseLsDisplayFlags(['-l']);
  assert.equal(r.showDetails, true);
  assert.equal(r.showAll, false);
});

test('parseLsDisplayFlags: -a', () => {
  const r = parseLsDisplayFlags(['-a']);
  assert.equal(r.showDetails, false);
  assert.equal(r.showAll, true);
});

test('parseLsDisplayFlags: -la combined', () => {
  const r = parseLsDisplayFlags(['-la']);
  assert.equal(r.showDetails, true);
  assert.equal(r.showAll, true);
});

test('parseLsDisplayFlags: --long', () => {
  const r = parseLsDisplayFlags(['--long']);
  assert.equal(r.showDetails, true);
});

test('parseLsDisplayFlags: --all', () => {
  const r = parseLsDisplayFlags(['--all']);
  assert.equal(r.showAll, true);
});

test('parseLsDisplayFlags: --help', () => {
  const r = parseLsDisplayFlags(['--help']);
  assert.ok(r.help);
});

test('parseLsDisplayFlags: -h shows help', () => {
  const r = parseLsDisplayFlags(['-h']);
  assert.ok(r.help);
});

test('parseLsDisplayFlags: bad short option → exitCode 2', () => {
  const r = parseLsDisplayFlags(['-z']);
  assert.ok(r.error);
  assert.equal(r.error.exitCode, 2);
});

test('parseLsDisplayFlags: bad long option → exitCode 2', () => {
  const r = parseLsDisplayFlags(['--foobar']);
  assert.ok(r.error);
  assert.equal(r.error.exitCode, 2);
});

test('parseLsDisplayFlags: -- stops option parsing', () => {
  const r = parseLsDisplayFlags(['--']);
  assert.equal(r.showDetails, false);
  assert.equal(r.showAll, false);
  assert.equal(r.error, undefined);
});

// --- wc ---
test('parseWcArgv: no flags → showAll', () => {
  const r = parseWcArgv([]);
  assert.equal(r.ok, true);
  assert.equal(r.showAll, true);
});

test('parseWcArgv: -l', () => {
  const r = parseWcArgv(['-l']);
  assert.equal(r.ok, true);
  assert.equal(r.showLines, true);
  assert.equal(r.showAll, false);
});

test('parseWcArgv: -w', () => {
  const r = parseWcArgv(['-w']);
  assert.equal(r.ok, true);
  assert.equal(r.showWords, true);
});

test('parseWcArgv: -c', () => {
  const r = parseWcArgv(['-c']);
  assert.equal(r.ok, true);
  assert.equal(r.showBytes, true);
});

test('parseWcArgv: combined -lwc', () => {
  const r = parseWcArgv(['-lwc']);
  assert.equal(r.ok, true);
  assert.equal(r.showLines, true);
  assert.equal(r.showWords, true);
  assert.equal(r.showBytes, true);
  assert.equal(r.showAll, false);
});

test('parseWcArgv: -- stops options', () => {
  const r = parseWcArgv(['--', '-l']);
  assert.equal(r.ok, true);
  assert.deepEqual(r.operands, ['-l']);
});

test('parseWcArgv: bad option → exitCode 1 (current, not POSIX 2)', () => {
  const r = parseWcArgv(['-z']);
  assert.equal(r.ok, false);
  assert.equal(r.exitCode, 1);
});

test('parseWcArgv: bad long option → exitCode 1 (current, not POSIX 2)', () => {
  const r = parseWcArgv(['--foobar']);
  assert.equal(r.ok, false);
  assert.equal(r.exitCode, 1);
});

test('parseWcArgv: --help', () => {
  const r = parseWcArgv(['-h']);
  assert.equal(r.ok, true);
  assert.equal(r.help, true);
});

// --- sed ---
test('parseSedArgv: simple substitution', () => {
  const r = parseSedArgv(['s/a/b/', 'file.txt']);
  assert.equal(r.ok, true);
  assert.deepEqual(r.fileOperands, ['file.txt']);
});

test('parseSedArgv: -n flag', () => {
  const r = parseSedArgv(['-n', 's/a/b/']);
  assert.equal(r.ok, true);
  assert.equal(r.quiet, true);
});

test('parseSedArgv: -e flag', () => {
  const r = parseSedArgv(['-e', 's/a/b/']);
  assert.equal(r.ok, true);
});

test('parseSedArgv: -- stops options', () => {
  const r = parseSedArgv(['--', '-n']);
  assert.equal(r.ok, true);
});

// --- awk ---
test('parseAwkArgv: simple program', () => {
  const r = parseAwkArgv(['{print $1}']);
  assert.equal(r.ok, true);
  assert.equal(r.program, '{print $1}');
});

test('parseAwkArgv: -F field separator', () => {
  const r = parseAwkArgv(['-F', ',', '{print $1}']);
  assert.equal(r.ok, true);
  assert.equal(r.fieldSeparator, ',');
});

// --- parseTrueFalseArgv ---
test('parseTrueFalseArgv: true no args', () => {
  const r = parseTrueFalseArgv([], 'true');
  assert.equal(r.ok, true);
  assert.equal(r.help, undefined);
});

test('parseTrueFalseArgv: false --help', () => {
  // parseTrueFalseArgv(args, progName) — args first, progName second
  const r = parseTrueFalseArgv(['--help'], 'false');
  assert.equal(r.ok, true);
  assert.equal(r.help, true);
});

// --- parseMkdirArgv ---
test('parseMkdirArgv: directory operand', () => {
  const r = parseMkdirArgv(['mydir']);
  assert.equal(r.ok, true);
  assert.deepEqual(r.operands, ['mydir']);
});

test('parseMkdirArgv: -p flag', () => {
  const r = parseMkdirArgv(['-p', 'a/b/c']);
  assert.equal(r.ok, true);
  assert.equal(r.parents, true);
});

// --- parseBasenameArgv ---
test('parseBasenameArgv: simple path', () => {
  const r = parseBasenameArgv(['/a/b/c']);
  assert.equal(r.ok, true);
});

// --- parseDirnameArgv ---
test('parseDirnameArgv: simple path', () => {
  const r = parseDirnameArgv(['/a/b/c']);
  assert.equal(r.ok, true);
});

// --- parsePwdArgv ---
test('parsePwdArgv: no args', () => {
  const r = parsePwdArgv([]);
  assert.equal(r.ok, true);
});

// --- parseSleepArgv ---
test('parseSleepArgv: seconds', () => {
  const r = parseSleepArgv(['5']);
  assert.equal(r.ok, true);
  assert.equal(r.totalSeconds, 5);
});

// --- parseSeqArgv ---
test('parseSeqArgv: single arg is last', () => {
  const r = parseSeqArgv(['5']);
  assert.equal(r.ok, true);
});

// --- parseDateArgv ---
test('parseDateArgv: no args', () => {
  const r = parseDateArgv([]);
  assert.equal(r.ok, true);
});

// --- parseCpArgv ---
test('parseCpArgv: basic copy', () => {
  const r = parseCpArgv(['src', 'dst']);
  assert.equal(r.ok, true);
});

test('parseCpArgv: -r recursive', () => {
  const r = parseCpArgv(['-r', 'src', 'dst']);
  assert.equal(r.ok, true);
  assert.equal(r.recursive, true);
});

// --- parseMvArgv ---
test('parseMvArgv: basic move', () => {
  const r = parseMvArgv(['src', 'dst']);
  assert.equal(r.ok, true);
});

// --- parseRmArgv ---
test('parseRmArgv: -rf', () => {
  const r = parseRmArgv(['-rf', 'dir']);
  assert.equal(r.ok, true);
  assert.equal(r.recursive, true);
  assert.equal(r.force, true);
});

// --- parseTeeArgv ---
test('parseTeeArgv: -a append', () => {
  const r = parseTeeArgv(['-a', 'file.txt']);
  assert.equal(r.ok, true);
  assert.equal(r.append, true);
});

// --- parseXargsArgv ---
test('parseXargsArgv: default command is echo', () => {
  const r = parseXargsArgv([]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.command, ['echo']);
});

// --- parseSortArgv ---
test('parseSortArgv: no args', () => {
  const r = parseSortArgv([]);
  assert.equal(r.ok, true);
});

test('parseSortArgv: -r reverse', () => {
  const r = parseSortArgv(['-r']);
  assert.equal(r.ok, true);
  assert.equal(r.reverse, true);
});

// --- parseCutArgv ---
test('parseCutArgv: -d and -f', () => {
  const r = parseCutArgv(['-d', ',', '-f', '1']);
  assert.equal(r.ok, true);
});

// --- parseUniqArgv ---
test('parseUniqArgv: no args', () => {
  const r = parseUniqArgv([]);
  assert.equal(r.ok, true);
});

test('parseUniqArgv: -c count', () => {
  const r = parseUniqArgv(['-c']);
  assert.equal(r.ok, true);
  assert.equal(r.count, true);
});

// --- parseTrArgv ---
test('parseTrArgv: two sets', () => {
  const r = parseTrArgv(['a-z', 'A-Z']);
  assert.equal(r.ok, true);
});

// --- parseChmodArgv ---
test('parseChmodArgv: mode and file', () => {
  const r = parseChmodArgv(['755', 'file']);
  assert.equal(r.ok, true);
});

// --- parseStatArgv ---
test('parseStatArgv: file', () => {
  const r = parseStatArgv(['file.txt']);
  assert.equal(r.ok, true);
});

// --- parseReadlinkArgv ---
test('parseReadlinkArgv: file', () => {
  const r = parseReadlinkArgv(['link']);
  assert.equal(r.ok, true);
});

// --- parseLnArgv ---
test('parseLnArgv: target and link', () => {
  const r = parseLnArgv(['-s', 'target', 'link']);
  assert.equal(r.ok, true);
  assert.equal(r.symbolic, true);
});

// --- parseTouchArgv ---
test('parseTouchArgv: file', () => {
  const r = parseTouchArgv(['file.txt']);
  assert.equal(r.ok, true);
});

// --- parseTestArgv ---
test('parseTestArgv: -f file', () => {
  const r = parseTestArgv(['-f', '/tmp/file']);
  assert.equal(r.ok, true);
});

// --- parsePrintfArgv ---
test('parsePrintfArgv: format string', () => {
  const r = parsePrintfArgv(['%s\\n', 'hello']);
  assert.equal(r.ok, true);
});

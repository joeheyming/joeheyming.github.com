import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ShellCore } from '../lib/shell-core.js';
const {
  resolveVirtualPath,
  coerceShellString,
  normalizeRedirectFilename,
  isEmptyRedirectTarget,
  splitShellList,
  mergeRedirectDupStderrTokens,
  normalizeCommandResult,
  normalizeHandlerResult,
  normalizeExitByte,
  expandVariablesInString,
  combinedFetchSignal,
  parseExitStatus,
  parseHelpArgs,
  parseKillArgv,
  formatDeclareXLine,
  escapeBashDoubleQuotedContent,
  escapeTypeAliasBody
} = ShellCore;

import { VfsUtils } from '../lib/vfs-utils.js';
const {
  fileItemUtf8ForDisplay,
  filterDirectoryEntriesForTabCompletion,
  sortDirectoryEntriesByName,
  vfsReadlinkCanonical,
  vfsFollowSymlinksToFile
} = VfsUtils;

import { SedLib } from '../commands/filesystem/sed-lib.js';
import { AwkLib } from '../commands/filesystem/awk-lib.js';
import { PrintfLib } from '../commands/filesystem/printf-lib.js';
import { FmtLib } from '../commands/filesystem/fmt-lib.js';
import { SplitLib } from '../commands/filesystem/split-lib.js';
import { CsplitLib } from '../commands/filesystem/csplit-lib.js';
import { ExpandLib } from '../commands/filesystem/expand-lib.js';
import { FoldLib } from '../commands/filesystem/fold-lib.js';
import { TrLib } from '../commands/filesystem/tr-lib.js';
import { CutLib } from '../commands/filesystem/cut-lib.js';
import { XargsLib } from '../commands/system/xargs-lib.js';
import { LessLib } from '../commands/system/less-lib.js';
import { NlLib } from '../commands/filesystem/nl-lib.js';
import { PasteLib } from '../commands/filesystem/paste-lib.js';
import { JoinLib } from '../commands/filesystem/join-lib.js';
import { FileopsLib } from '../commands/filesystem/fileops-lib.js';
import { TeeLib } from '../commands/filesystem/tee-lib.js';
import { CatLib } from '../commands/filesystem/cat-lib.js';
import { EchoLib } from '../commands/filesystem/echo-lib.js';
import { GrepLib } from '../commands/filesystem/grep-lib.js';
import { EnvLib } from '../commands/system/env-lib.js';
import { LsLib } from '../commands/filesystem/ls-lib.js';
import { MkdirLib } from '../commands/filesystem/mkdir-lib.js';
import { ChmodLib } from '../commands/filesystem/chmod-lib.js';
import { StatLib } from '../commands/filesystem/stat-lib.js';
import { BuiltinsLib } from '../commands/system/builtins-lib.js';
import { PwdLib } from '../commands/system/pwd-lib.js';
import { DateLib } from '../commands/system/date-lib.js';
import { SeqLib } from '../commands/system/seq-lib.js';
import { SleepLib } from '../commands/system/sleep-lib.js';
import { LinesLib } from '../commands/filesystem/lines-lib.js';
import { WcLib } from '../commands/filesystem/wc-lib.js';
import { SortLib } from '../commands/filesystem/sort-lib.js';
import { UniqLib } from '../commands/filesystem/uniq-lib.js';
import { ReadlinkLib } from '../commands/filesystem/readlink-lib.js';
import { LnLib } from '../commands/filesystem/ln-lib.js';
import { TouchLib } from '../commands/filesystem/touch-lib.js';
import { TestLib } from '../commands/system/test-lib.js';
import { BasenameLib } from '../commands/filesystem/basename-lib.js';

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

const { parseNlArgv, formatNlNumberedText, nlFormatNumberField } = NlLib;

const {
  parsePasteArgv,
  pasteSplitLines,
  pasteJoinParallelRows,
  pasteJoinSerialRows,
  pasteFormatOutputLines
} = PasteLib;

const {
  parseJoinArgv,
  joinSplitFields,
  joinBuildRecords,
  joinMergeRecords,
  joinEmitMatchedLine,
  JOIN_HELP
} = JoinLib;

const {
  parseCpArgv,
  parseMvArgv,
  parseRmArgv,
  RM_HELP,
  parseRmdirArgv,
  RMDIR_HELP,
  parseUnlinkArgv,
  UNLINK_HELP
} = FileopsLib;

const { parseTeeArgv } = TeeLib;

const { parseCatArgv } = CatLib;

const { parseEchoArgv, echoApplyBackslashEscapes, ECHO_VERSION_LINE } = EchoLib;

const { parseGrepArgv, GREP_HELP, grepOptionError } = GrepLib;

const { ENV_HELP, parseEnvArgv } = EnvLib;

const { parseLsDisplayFlags } = LsLib;

const { parseMkdirArgv } = MkdirLib;

const { parseChmodArgv } = ChmodLib;

const { parseStatArgv } = StatLib;

const { parseTypeArgv, parseWhichArgv, parseAliasArgv } = BuiltinsLib;

const { parsePwdArgv } = PwdLib;

const { parseDateArgv, formatDateOutput } = DateLib;

const { parseSeqArgv, genSeqSequence, formatSeqOutput } = SeqLib;

const { parseSleepArgv } = SleepLib;

const { parseLinesFilterArgv } = LinesLib;

const { parseWcArgv } = WcLib;

const { parseSortArgv } = SortLib;

const { parseUniqArgv } = UniqLib;

const { parseReadlinkArgv } = ReadlinkLib;

const { parseLnArgv, symlinkBasenameForLn } = LnLib;

const { parseTouchArgv } = TouchLib;

const { parseTestArgv, parseTrueFalseArgv } = TestLib;

const {
  parseBasenameArgv,
  basenameCompute,
  BASENAME_VERSION_LINE,
  parseDirnameArgv,
  dirnameCompute,
  DIRNAME_VERSION_LINE
} = BasenameLib;

const { parseCutArgv, parseCutListString } = CutLib;

const { parseTrArgv, expandTrSetString, runTr, TR_HELP } = TrLib;

const {
  parseXargsArgv,
  xargsSplitWhitespaceWords,
  xargsSplitLines,
  xargsSplitNullRecords,
  xargsSubstituteInArgs,
  xargsFormatVerboseCommandLine
} = XargsLib;

const {
  parseSplitArgv,
  parseSplitByteSize,
  splitLinesWithSeparators,
  splitLinesBytes,
  splitGenerateSuffix,
  splitAlphabeticSuffix,
  SPLIT_VERSION_LINE
} = SplitLib;

const {
  parseCsplitArgv,
  expandCsplitPatternTokens,
  csplitComputeTextPieces,
  csplitFormatStdoutSizes,
  CSPLIT_VERSION_LINE
} = CsplitLib;

const {
  parseExpandArgv,
  parseExpandTabStopsArg,
  expandExpandLine,
  expandExpandText,
  EXPAND_VERSION_LINE
} = ExpandLib;

const { parseFoldArgv, foldFoldText, foldFoldLineChars, FOLD_VERSION_LINE, FOLD_DEFAULT_WIDTH } =
  FoldLib;

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

const { parsePrintfArgv, runPrintfFormat } = PrintfLib;

test('combinedFetchSignal: user abort aborts merged signal', () => {
  const ac = new AbortController();
  const sig = combinedFetchSignal(600_000, ac.signal);
  assert.equal(sig.aborted, false);
  ac.abort();
  assert.equal(sig.aborted, true);
});

test('normalizeRedirectFilename: strips one pair of quotes', () => {
  assert.equal(normalizeRedirectFilename('"out.txt"'), 'out.txt');
  assert.equal(normalizeRedirectFilename("'x'"), 'x');
  assert.equal(normalizeRedirectFilename('plain'), 'plain');
});

test('isEmptyRedirectTarget: empty after quotes', () => {
  assert.equal(isEmptyRedirectTarget(''), true);
  assert.equal(isEmptyRedirectTarget('""'), true);
  assert.equal(isEmptyRedirectTarget("''"), true);
  assert.equal(isEmptyRedirectTarget('a'), false);
});

test('splitShellList: && || ; at top level', () => {
  const a = splitShellList('echo a && echo b');
  assert.equal(a.ok, true);
  assert.deepEqual(a.pipelines, ['echo a', 'echo b']);
  assert.deepEqual(a.ops, ['&&']);

  const b = splitShellList('false || echo x');
  assert.equal(b.ok, true);
  assert.deepEqual(b.pipelines, ['false', 'echo x']);
  assert.deepEqual(b.ops, ['||']);

  const c = splitShellList('echo one; echo two');
  assert.equal(c.ok, true);
  assert.deepEqual(c.pipelines, ['echo one', 'echo two']);
  assert.deepEqual(c.ops, [';']);
});

test('splitShellList: operators inside quotes are literal', () => {
  const q = splitShellList('echo "a&&b"; echo ok');
  assert.equal(q.ok, true);
  assert.deepEqual(q.pipelines, ['echo "a&&b"', 'echo ok']);
  assert.deepEqual(q.ops, [';']);
});

test('splitShellList: pipes are not list separators', () => {
  const p = splitShellList('echo a | cat');
  assert.equal(p.ok, true);
  assert.deepEqual(p.pipelines, ['echo a | cat']);
  assert.deepEqual(p.ops, []);
});

test('splitShellList: syntax errors for empty &&/|| operands', () => {
  assert.equal(splitShellList('&& echo').ok, false);
  assert.equal(splitShellList('echo &&').ok, false);
  assert.equal(splitShellList('a && && b').ok, false);
});

test('mergeRedirectDupStderrTokens: 2> + &1 becomes 2>&1', () => {
  assert.deepEqual(mergeRedirectDupStderrTokens(['echo', '2>', '&1']), ['echo', '2>&1']);
  assert.deepEqual(mergeRedirectDupStderrTokens(['2>', 'f']), ['2>', 'f']);
});

test('normalizeCommandResult: explicit zero with stderr empty', () => {
  const r = normalizeCommandResult('ok', '', 0);
  assert.equal(r.exitCode, 0);
  assert.equal(r.stdout, 'ok');
});

test('normalizeCommandResult: infers 1 when stderr set and code omitted', () => {
  const r = normalizeCommandResult('', 'err');
  assert.equal(r.exitCode, 1);
});

test('normalizeCommandResult: explicit 127 overrides stderr inference', () => {
  const r = normalizeCommandResult('', 'jsh: x: command not found', 127);
  assert.equal(r.exitCode, 127);
});

test('normalizeCommandResult: 126 permission denied', () => {
  const r = normalizeCommandResult('', 'jsh: /bin/foo: Permission denied', 126);
  assert.equal(r.exitCode, 126);
});

test('expandVariablesInString: $? and $HOME / ${HOME}', () => {
  const env = { HOME: '/home/u', USER: 'u' };
  assert.equal(
    expandVariablesInString('code=$? path=$HOME u=${USER}', env, 127),
    'code=127 path=/home/u u=u'
  );
});

test('expandVariablesInString: missing vars become empty', () => {
  assert.equal(expandVariablesInString('$NONE', {}, 0), '');
});

test('resolveVirtualPath: . .. components and trailing slash', () => {
  assert.equal(resolveVirtualPath('/a/b/../c//', '/'), '/a/c');
  assert.equal(resolveVirtualPath('foo/./bar', '/tmp'), '/tmp/foo/bar');
  assert.equal(resolveVirtualPath('..', '/a/b'), '/a');
  assert.equal(resolveVirtualPath('..', '/'), '/');
});

test('resolveVirtualPath: empty path is cwd', () => {
  assert.equal(resolveVirtualPath('', '/home/u'), '/home/u');
});

test('resolveVirtualPath: absolute ignores cwd for location', () => {
  assert.equal(resolveVirtualPath('/etc/hosts', '/nope'), '/etc/hosts');
});

test('normalizeHandlerResult: string is stdout only', () => {
  const n = normalizeHandlerResult('hello');
  assert.equal(n.stdout, 'hello');
  assert.equal(n.stderr, '');
  assert.equal(n.exitCode, undefined);
});

test('normalizeHandlerResult: structured stderr + exitCode', () => {
  const n = normalizeHandlerResult({ stderr: 'cat: x: No such file', exitCode: 1 });
  assert.equal(n.stdout, '');
  assert.equal(n.stderr, 'cat: x: No such file');
  assert.equal(n.exitCode, 1);
  const r = normalizeCommandResult(n.stdout, n.stderr, n.exitCode);
  assert.equal(r.exitCode, 1);
});

test('normalizeCommandResult: coerces non-string stdout (e.g. mistaken object)', () => {
  const r = normalizeCommandResult({ nested: 1 }, '', 0);
  assert.equal(typeof r.stdout, 'string');
  assert.ok(r.stdout.includes('Object'));
});

test('coerceShellString: preserves numeric zero', () => {
  assert.equal(coerceShellString(0), '0');
});

test('expandVariablesInString: lowercase env names', () => {
  assert.equal(expandVariablesInString('$path ${path}', { path: '/tmp' }, 0), '/tmp /tmp');
});

test('normalizeExitByte: wraps like bash', () => {
  assert.equal(normalizeExitByte(0), 0);
  assert.equal(normalizeExitByte(256), 0);
  assert.equal(normalizeExitByte(-1), 255);
  assert.equal(normalizeExitByte(999), 231);
});

test('parseExitStatus: no args uses last exit code byte', () => {
  const r = parseExitStatus([], 127);
  assert.equal(r.ok, true);
  assert.equal(r.status, 127);
});

test('parseExitStatus: decimal operand wraps', () => {
  const r = parseExitStatus(['256'], 0);
  assert.equal(r.ok, true);
  assert.equal(r.status, 0);
});

test('parseExitStatus: negative operand', () => {
  const r = parseExitStatus(['-1'], 0);
  assert.equal(r.ok, true);
  assert.equal(r.status, 255);
});

test('parseExitStatus: too many arguments', () => {
  const r = parseExitStatus(['1', '2'], 0);
  assert.equal(r.ok, false);
  assert.equal(r.exitCode, 1);
  assert.ok(String(r.stderr).includes('too many'));
});

test('parseExitStatus: non-numeric operand', () => {
  const r = parseExitStatus(['foo'], 0);
  assert.equal(r.ok, false);
  assert.equal(r.exitCode, 2);
  assert.ok(String(r.stderr).includes('numeric argument required'));
});

test('parseExitStatus: -- then operand', () => {
  const r = parseExitStatus(['--', '2'], 0);
  assert.equal(r.ok, true);
  assert.equal(r.status, 2);
});

test('parseExitStatus: -- alone uses last status', () => {
  const r = parseExitStatus(['--'], 5);
  assert.equal(r.ok, true);
  assert.equal(r.status, 5);
});

test('parseExitStatus: --help alone', () => {
  const r = parseExitStatus(['--help'], 9);
  assert.equal(r.ok, true);
  assert.equal(r.help, true);
});

test('parseExitStatus: --help with extra args', () => {
  const r = parseExitStatus(['--help', '0'], 0);
  assert.equal(r.ok, false);
  assert.equal(r.exitCode, 1);
});

test('parseHelpArgs: empty → catalog', () => {
  const r = parseHelpArgs([]);
  assert.equal(r.ok, true);
  assert.equal(r.sawHelpFlag, false);
  assert.deepEqual(r.rest, []);
});

test('parseHelpArgs: -h → usage', () => {
  const r = parseHelpArgs(['-h']);
  assert.equal(r.ok, true);
  assert.equal(r.sawHelpFlag, true);
  assert.deepEqual(r.rest, []);
});

test('parseKillArgv: empty → usage', () => {
  const r = parseKillArgv([]);
  assert.equal(r.kind, 'usage');
  assert.equal(r.exitCode, 1);
  assert.match(r.stderr, /kill: usage:/);
});

test('parseKillArgv: -l → list', () => {
  assert.equal(parseKillArgv(['-l']).kind, 'list');
});

test('parseKillArgv: numeric PIDs', () => {
  const r = parseKillArgv(['123', '456']);
  assert.equal(r.kind, 'run');
  assert.deepEqual(r.pids, [123, 456]);
});

test('parseKillArgv: -9 PID', () => {
  const r = parseKillArgv(['-9', '42']);
  assert.equal(r.kind, 'run');
  assert.equal(r.signal, 'SIGKILL');
  assert.deepEqual(r.pids, [42]);
});

test('parseKillArgv: invalid signal', () => {
  const r = parseKillArgv(['-z', '1']);
  assert.equal(r.kind, 'error');
  assert.equal(r.exitCode, 1);
});

test('parseTeeArgv: flags and operands', () => {
  const a = parseTeeArgv([]);
  assert.equal(a.ok, true);
  assert.equal(a.append, false);
  assert.deepEqual(a.files, []);

  const b = parseTeeArgv(['-a', 'out.txt']);
  assert.equal(b.ok, true);
  assert.equal(b.append, true);
  assert.deepEqual(b.files, ['out.txt']);

  const c = parseTeeArgv(['--append', 'a', 'b']);
  assert.equal(c.ok, true);
  assert.equal(c.append, true);
  assert.deepEqual(c.files, ['a', 'b']);
});

test('parseTeeArgv: -- preserves operands', () => {
  const r = parseTeeArgv(['--', '-v', 'x']);
  assert.equal(r.ok, true);
  assert.deepEqual(r.files, ['-v', 'x']);
});

test('parseTeeArgv: help', () => {
  const r = parseTeeArgv(['--help']);
  assert.equal(r.ok, true);
  assert.equal(r.help, true);
});

test('parseTeeArgv: invalid short option (GNU-style)', () => {
  const r = parseTeeArgv(['-z']);
  assert.equal(r.ok, false);
  assert.equal(r.exitCode, 1);
  assert.match(String(r.stderr), /invalid option -- 'z'/);
  assert.match(String(r.stderr), /Try 'tee --help'/);
});

test('parseTeeArgv: unrecognized long option (GNU-style)', () => {
  const r = parseTeeArgv(['--notaflag']);
  assert.equal(r.ok, false);
  assert.equal(r.exitCode, 1);
  assert.match(String(r.stderr), /unrecognized option '--notaflag'/);
  assert.match(String(r.stderr), /Try 'tee --help'/);
});

test('parseTeeArgv: single dash operand', () => {
  const r = parseTeeArgv(['-']);
  assert.equal(r.ok, true);
  assert.deepEqual(r.files, ['-']);
});

test('parseCatArgv: operands, --, help, errors', () => {
  assert.deepEqual(parseCatArgv([]).operands, []);
  assert.deepEqual(parseCatArgv(['a', 'b']).operands, ['a', 'b']);
  assert.deepEqual(parseCatArgv(['--', '-h']).operands, ['-h']);
  assert.equal(parseCatArgv(['--help']).help, true);
  assert.equal(parseCatArgv(['-h']).help, true);
  const bad = parseCatArgv(['-n']);
  assert.equal(bad.ok, false);
  assert.match(String(bad.stderr), /invalid option -- 'n'/);
  assert.match(String(bad.stderr), /Try 'cat --help'/);
  const badLong = parseCatArgv(['--nope']);
  assert.equal(badLong.ok, false);
  assert.match(String(badLong.stderr), /unrecognized option '--nope'/);
  assert.deepEqual(parseCatArgv(['-']).operands, ['-']);
});

test('parseEchoArgv: GNU leading options, --, literals after first operand', () => {
  const e0 = parseEchoArgv([]);
  assert.equal(e0.ok, true);
  assert.deepEqual(e0.operands, []);
  assert.equal(e0.noNewline, false);
  assert.equal(e0.escapes, false);

  const n = parseEchoArgv(['-n', 'a']);
  assert.equal(n.ok, true);
  assert.equal(n.noNewline, true);
  assert.deepEqual(n.operands, ['a']);

  const ne = parseEchoArgv(['-ne', 'x']);
  assert.equal(ne.ok, true);
  assert.equal(ne.noNewline, true);
  assert.equal(ne.escapes, true);

  const eE = parseEchoArgv(['-eE', 'x']);
  assert.equal(eE.ok, true);
  assert.equal(eE.escapes, false);

  const literal = parseEchoArgv(['hi', '-n']);
  assert.equal(literal.ok, true);
  assert.equal(literal.noNewline, false);
  assert.deepEqual(literal.operands, ['hi', '-n']);

  assert.deepEqual(parseEchoArgv(['--', '-n']).operands, ['-n']);
  assert.equal(parseEchoArgv(['--help']).help, true);
  assert.equal(parseEchoArgv(['-h']).help, true);
  assert.equal(parseEchoArgv(['--version']).version, true);

  const bad = parseEchoArgv(['-z']);
  assert.equal(bad.ok, false);
  assert.equal(bad.exitCode, 2);
  assert.match(String(bad.stderr), /invalid option -- 'z'/);

  assert.deepEqual(parseEchoArgv(['-']).operands, ['-']);
});

test('echoApplyBackslashEscapes: common sequences', () => {
  assert.equal(echoApplyBackslashEscapes('a\\tb'), 'a\tb');
  assert.equal(echoApplyBackslashEscapes('a\\nb'), 'a\nb');
  assert.equal(echoApplyBackslashEscapes('\\\\'), '\\');
  assert.equal(echoApplyBackslashEscapes('ab\\cdef'), 'ab');
  assert.equal(echoApplyBackslashEscapes('\\033'), '\x1b');
  assert.equal(echoApplyBackslashEscapes('\\x41'), 'A');
});

test('ECHO_VERSION_LINE is non-empty', () => {
  assert.match(ECHO_VERSION_LINE, /echo/);
});

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

test('parseCpArgv: recursive, --, operands, help, errors', () => {
  const base = parseCpArgv(['a', 'b']);
  assert.equal(base.ok, true);
  assert.equal(base.recursive, false);
  assert.deepEqual(base.operands, ['a', 'b']);

  const r = parseCpArgv(['-r', 'src', 'dst']);
  assert.equal(r.ok, true);
  assert.equal(r.recursive, true);
  assert.deepEqual(r.operands, ['src', 'dst']);

  const rr = parseCpArgv(['-rR', 'x', 'y']);
  assert.equal(rr.ok, true);
  assert.equal(rr.recursive, true);

  assert.deepEqual(parseCpArgv(['--', '-n', 'out']).operands, ['-n', 'out']);

  assert.equal(parseCpArgv(['--help']).help, true);
  assert.equal(parseCpArgv(['-h']).help, true);

  const bad = parseCpArgv(['-v', 'a', 'b']);
  assert.equal(bad.ok, false);
  assert.match(String(bad.stderr), /invalid option -- 'v'/);

  const badLong = parseCpArgv(['--interactive']);
  assert.equal(badLong.ok, false);
  assert.match(String(badLong.stderr), /unrecognized option '--interactive'/);
});

test('parseMvArgv: no-op flags, --, operands, help, errors', () => {
  assert.deepEqual(parseMvArgv(['a', 'b']).operands, ['a', 'b']);
  assert.deepEqual(parseMvArgv(['-f', '-i', 'a', 'b']).operands, ['a', 'b']);
  assert.deepEqual(parseMvArgv(['-fin', 'x', 'y']).operands, ['x', 'y']);
  assert.deepEqual(parseMvArgv(['--', '-v', 'dest']).operands, ['-v', 'dest']);

  assert.equal(parseMvArgv(['--help']).help, true);
  assert.equal(parseMvArgv(['-h']).help, true);

  const bad = parseMvArgv(['-r', 'a', 'b']);
  assert.equal(bad.ok, false);
  assert.match(String(bad.stderr), /invalid option -- 'r'/);

  const badLong = parseMvArgv(['--recursive']);
  assert.equal(badLong.ok, false);
  assert.match(String(badLong.stderr), /unrecognized option '--recursive'/);
});

test('parseRmArgv: -f/-r, no-ops, --, help, operands, errors', () => {
  assert.match(RM_HELP, /Usage: rm \[OPTION\]/);

  const rf = parseRmArgv(['-rf', 'x']);
  assert.equal(rf.ok, true);
  assert.equal(rf.recursive, true);
  assert.equal(rf.force, true);
  assert.deepEqual(rf.operands, ['x']);

  assert.deepEqual(parseRmArgv(['-r', '-f', 'a', 'b']).operands, ['a', 'b']);
  assert.deepEqual(parseRmArgv(['--recursive', '--force', 'p']).operands, ['p']);
  assert.deepEqual(parseRmArgv(['-vi', 'one']).operands, ['one']);

  assert.deepEqual(parseRmArgv(['--', '-r']).operands, ['-r']);

  assert.equal(parseRmArgv(['--help']).help, true);
  assert.equal(parseRmArgv(['-h']).help, true);

  const bad = parseRmArgv(['-z', 'a']);
  assert.equal(bad.ok, false);
  assert.match(String(bad.stderr), /invalid option -- 'z'/);
  assert.match(String(bad.stderr), /Try 'rm --help'/);

  const badLong = parseRmArgv(['--preserve-root']);
  assert.equal(badLong.ok, false);
  assert.match(String(badLong.stderr), /unrecognized option '--preserve-root'/);

  const empty = parseRmArgv(['-f']);
  assert.equal(empty.ok, true);
  assert.deepEqual(empty.operands, []);
});

test('parseRmdirArgv: -p, --parents, -v, --, help, operands, errors', () => {
  assert.match(RMDIR_HELP, /Usage: rmdir \[OPTION\]/);

  const a = parseRmdirArgv(['-p', 'a/b']);
  assert.equal(a.ok, true);
  assert.equal(a.parents, true);
  assert.deepEqual(a.operands, ['a/b']);

  const b = parseRmdirArgv(['--parents', 'x']);
  assert.equal(b.parents, true);
  assert.deepEqual(b.operands, ['x']);

  const c = parseRmdirArgv(['-pv', 'd']);
  assert.equal(c.ok, true);
  assert.equal(c.parents, true);
  assert.deepEqual(c.operands, ['d']);

  assert.deepEqual(parseRmdirArgv(['--', '-h']).operands, ['-h']);

  assert.equal(parseRmdirArgv(['--help']).help, true);
  assert.equal(parseRmdirArgv(['-h']).help, true);

  const bad = parseRmdirArgv(['-z']);
  assert.equal(bad.ok, false);
  assert.match(String(bad.stderr), /invalid option -- 'z'/);
  assert.match(String(bad.stderr), /Try 'rmdir --help'/);

  const badLong = parseRmdirArgv(['--preserve']);
  assert.equal(badLong.ok, false);
  assert.match(String(badLong.stderr), /unrecognized option '--preserve'/);
});

test('parseUnlinkArgv: --, help, single operand, option errors', () => {
  assert.match(UNLINK_HELP, /Usage: unlink FILE/);

  assert.deepEqual(parseUnlinkArgv(['foo']).operands, ['foo']);
  assert.deepEqual(parseUnlinkArgv(['--', '-h']).operands, ['-h']);

  assert.equal(parseUnlinkArgv(['--help']).help, true);
  assert.equal(parseUnlinkArgv(['-h']).help, true);

  const bad = parseUnlinkArgv(['-z']);
  assert.equal(bad.ok, false);
  assert.match(String(bad.stderr), /invalid option -- 'z'/);
  assert.match(String(bad.stderr), /Try 'unlink --help'/);

  const badLong = parseUnlinkArgv(['--preserve']);
  assert.equal(badLong.ok, false);
  assert.match(String(badLong.stderr), /unrecognized option '--preserve'/);
});

test('parseEnvArgv: -i, -u, --unset, -iu, rest, errors', () => {
  assert.match(ENV_HELP, /ignore-environment/);
  assert.match(ENV_HELP, /--unset/);

  assert.deepEqual(parseEnvArgv([]), {
    ok: true,
    ignore: false,
    unset: [],
    rest: []
  });
  assert.deepEqual(parseEnvArgv(['-i']), {
    ok: true,
    ignore: true,
    unset: [],
    rest: []
  });
  assert.deepEqual(parseEnvArgv(['-u', 'FOO']), {
    ok: true,
    ignore: false,
    unset: ['FOO'],
    rest: []
  });
  assert.deepEqual(parseEnvArgv(['-iu', 'FOO']), {
    ok: true,
    ignore: true,
    unset: ['FOO'],
    rest: []
  });
  assert.deepEqual(parseEnvArgv(['--unset=FOO']), {
    ok: true,
    ignore: false,
    unset: ['FOO'],
    rest: []
  });
  assert.deepEqual(parseEnvArgv(['--unset', 'BAR']), {
    ok: true,
    ignore: false,
    unset: ['BAR'],
    rest: []
  });
  assert.deepEqual(parseEnvArgv(['FOO=1']), {
    ok: true,
    ignore: false,
    unset: [],
    rest: ['FOO=1']
  });
  assert.deepEqual(parseEnvArgv(['-i', 'X=2']), {
    ok: true,
    ignore: true,
    unset: [],
    rest: ['X=2']
  });
  assert.deepEqual(parseEnvArgv(['-u', 'A', 'B=3']), {
    ok: true,
    ignore: false,
    unset: ['A'],
    rest: ['B=3']
  });

  assert.equal(parseEnvArgv(['--help']).help, true);

  const missU = parseEnvArgv(['-u']);
  assert.equal(missU.ok, false);
  assert.match(String(missU.stderr), /requires an argument/);

  const badUi = parseEnvArgv(['-ui']);
  assert.equal(badUi.ok, false);
  assert.match(String(badUi.stderr), /invalid option/);

  const badLong = parseEnvArgv(['--foo']);
  assert.equal(badLong.ok, false);
  assert.match(String(badLong.stderr), /unrecognized option/);
});

test('parseHelpArgs: topic', () => {
  const r = parseHelpArgs(['cat']);
  assert.equal(r.ok, true);
  assert.equal(r.sawHelpFlag, false);
  assert.deepEqual(r.rest, ['cat']);
});

test('parseHelpArgs: -- topic', () => {
  const r = parseHelpArgs(['--', '-v']);
  assert.equal(r.ok, true);
  assert.deepEqual(r.rest, ['-v']);
});

test('parseHelpArgs: too many topics', () => {
  const r = parseHelpArgs(['a', 'b']);
  assert.equal(r.ok, false);
  assert.equal(r.exitCode, 1);
});

test('parseHelpArgs: -h with extra operand', () => {
  const r = parseHelpArgs(['-h', 'cat']);
  assert.equal(r.ok, false);
  assert.equal(r.exitCode, 1);
});

test('parseHelpArgs: invalid option', () => {
  const r = parseHelpArgs(['-x']);
  assert.equal(r.ok, false);
  assert.equal(r.exitCode, 2);
  assert.ok(String(r.stderr).includes('invalid option'));
});

test('fileItemUtf8ForDisplay: prefers non-empty content string', () => {
  const buf = new TextEncoder().encode('bytes');
  const r = fileItemUtf8ForDisplay({
    type: 'file',
    content: 'hello',
    contentBytes: buf.buffer
  });
  assert.equal(r.text, 'hello');
  assert.equal(r.isBinary, false);
});

test('fileItemUtf8ForDisplay: decodes contentBytes when content empty', () => {
  const enc = new TextEncoder();
  const u8 = enc.encode('#!/bin/bash\necho hi\n');
  const r = fileItemUtf8ForDisplay({
    type: 'file',
    content: '',
    contentBytes: u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)
  });
  assert.equal(r.text, '#!/bin/bash\necho hi\n');
  assert.equal(r.isBinary, false);
});

test('fileItemUtf8ForDisplay: Uint8Array view', () => {
  const u8 = new Uint8Array([0x61, 0x62, 0x63]);
  const r = fileItemUtf8ForDisplay({ type: 'file', contentBytes: u8 });
  assert.equal(r.text, 'abc');
  assert.equal(r.isBinary, false);
});

test('fileItemUtf8ForDisplay: NUL marks binary', () => {
  const u8 = new Uint8Array([0x48, 0x69, 0, 0x50]);
  const r = fileItemUtf8ForDisplay({ type: 'file', contentBytes: u8 });
  assert.equal(r.isBinary, true);
  assert.equal(r.text, '');
});

test('filterDirectoryEntriesForTabCompletion: hides dotfiles unless prefix starts with .', () => {
  const entries = [
    { name: 'normal.txt', type: 'file' },
    { name: '.hidden', type: 'file' },
    { name: '.profile', type: 'file' }
  ];
  assert.deepEqual(
    filterDirectoryEntriesForTabCompletion(entries, '').map((e) => e.name),
    ['normal.txt']
  );
  assert.deepEqual(
    filterDirectoryEntriesForTabCompletion(entries, 'n').map((e) => e.name),
    ['normal.txt']
  );
  assert.deepEqual(
    filterDirectoryEntriesForTabCompletion(entries, '.').map((e) => e.name),
    ['.hidden', '.profile']
  );
  assert.deepEqual(
    filterDirectoryEntriesForTabCompletion(entries, '.p').map((e) => e.name),
    ['.profile']
  );
});

test('parseLsDisplayFlags: -la and --all/--long', () => {
  assert.deepEqual(parseLsDisplayFlags(['-la', '/']), { showDetails: true, showAll: true });
  assert.deepEqual(parseLsDisplayFlags(['-l']), { showDetails: true, showAll: false });
  assert.deepEqual(parseLsDisplayFlags(['-a']), { showDetails: false, showAll: true });
  assert.deepEqual(parseLsDisplayFlags(['--long', '--all']), { showDetails: true, showAll: true });
});

test('sortDirectoryEntriesByName: locale order', () => {
  const a = [{ name: 'b' }, { name: 'a' }, { name: 'c' }];
  assert.deepEqual(
    sortDirectoryEntriesByName(a).map((e) => e.name),
    ['a', 'b', 'c']
  );
});

test('formatDeclareXLine / escapeBashDoubleQuotedContent: bash-style declare -x', () => {
  assert.equal(formatDeclareXLine('PATH', '/bin'), 'declare -x PATH="/bin"');
  assert.equal(formatDeclareXLine('X', 'say "hi"\n'), 'declare -x X="say \\"hi\\"\\n"');
  assert.equal(escapeBashDoubleQuotedContent('a\nb'), 'a\\nb');
});

test('parseMkdirArgv: -p and operands', () => {
  assert.deepEqual(parseMkdirArgv(['-p', 'a/b']), { ok: true, parents: true, operands: ['a/b'] });
  assert.deepEqual(parseMkdirArgv(['--parents', '--', '-p']), {
    ok: true,
    parents: true,
    operands: ['-p']
  });
  assert.deepEqual(parseMkdirArgv(['-pp', 'x']), { ok: true, parents: true, operands: ['x'] });
  const bad = parseMkdirArgv(['--mode=755', 'x']);
  assert.equal(bad.ok, false);
});

test('parseChmodArgv: mode + files, help, errors', () => {
  const ok = parseChmodArgv(['755', 'a.txt', 'b']);
  assert.equal(ok.ok, true);
  assert.equal(ok.mode, '755');
  assert.deepEqual(ok.files, ['a.txt', 'b']);

  assert.equal(parseChmodArgv(['--help']).ok, true);
  assert.equal(parseChmodArgv(['--help']).help, true);

  assert.equal(parseChmodArgv([]).ok, false);
  assert.equal(parseChmodArgv(['755']).ok, false);
  assert.match(parseChmodArgv(['755']).stderr, /missing operand/);

  const u = parseChmodArgv(['--foo']);
  assert.equal(u.ok, false);
});

test('parseStatArgv: -L, --, help, operands, errors', () => {
  assert.deepEqual(parseStatArgv(['-L', 'a']), { ok: true, dereference: true, operands: ['a'] });
  assert.deepEqual(parseStatArgv(['--dereference', 'b']), {
    ok: true,
    dereference: true,
    operands: ['b']
  });
  assert.deepEqual(parseStatArgv(['--', '-x']), { ok: true, dereference: false, operands: ['-x'] });
  assert.equal(parseStatArgv(['--help']).ok, true);
  assert.equal(parseStatArgv(['--help']).help, true);
  assert.equal(parseStatArgv(['-h']).help, true);

  const miss = parseStatArgv(['-L']);
  assert.equal(miss.ok, false);
  assert.match(miss.stderr, /missing operand/);

  const bad = parseStatArgv(['--format=%s']);
  assert.equal(bad.ok, false);
  assert.match(bad.stderr, /unrecognized option/);

  const shortBad = parseStatArgv(['-z']);
  assert.equal(shortBad.ok, false);
  assert.match(shortBad.stderr, /invalid option/);
});

test('parseTypeArgv: -a, --, help, names, usage, errors', () => {
  assert.deepEqual(parseTypeArgv(['ls']), { ok: true, showAll: false, names: ['ls'] });
  assert.deepEqual(parseTypeArgv(['-a', 'ls']), { ok: true, showAll: true, names: ['ls'] });
  assert.deepEqual(parseTypeArgv(['--', '-h']), { ok: true, showAll: false, names: ['-h'] });
  assert.equal(parseTypeArgv(['--help']).ok, true);
  assert.equal(parseTypeArgv(['--help']).help, true);
  assert.equal(parseTypeArgv(['-h']).help, true);

  const empty = parseTypeArgv([]);
  assert.equal(empty.ok, false);
  assert.match(empty.stderr, /usage/);

  const bad = parseTypeArgv(['-t', 'x']);
  assert.equal(bad.ok, false);
  assert.match(bad.stderr, /invalid option/);
});

test('parseWhichArgv: -a, --all, --, help, names, missing operand, errors', () => {
  assert.deepEqual(parseWhichArgv(['ls']), { ok: true, showAll: false, names: ['ls'] });
  assert.deepEqual(parseWhichArgv(['-a', 'ls']), { ok: true, showAll: true, names: ['ls'] });
  assert.deepEqual(parseWhichArgv(['--all', 'x']), { ok: true, showAll: true, names: ['x'] });
  assert.deepEqual(parseWhichArgv(['--', '-h']), { ok: true, showAll: false, names: ['-h'] });
  assert.equal(parseWhichArgv(['--help']).help, true);
  assert.equal(parseWhichArgv(['-h']).help, true);

  const miss = parseWhichArgv([]);
  assert.equal(miss.ok, false);
  assert.match(miss.stderr, /missing operand/);

  const bad = parseWhichArgv(['-z', 'x']);
  assert.equal(bad.ok, false);
  assert.match(bad.stderr, /invalid option/);
});

test('parseAliasArgv: -p, --, help, operands, option errors', () => {
  assert.deepEqual(parseAliasArgv([]), { ok: true, printReusable: false, operands: [] });
  assert.deepEqual(parseAliasArgv(['-p']), { ok: true, printReusable: true, operands: [] });
  assert.deepEqual(parseAliasArgv(['-p', 'a=b']), {
    ok: true,
    printReusable: true,
    operands: ['a=b']
  });
  assert.deepEqual(parseAliasArgv(['--', '-p=x']), {
    ok: true,
    printReusable: false,
    operands: ['-p=x']
  });
  assert.equal(parseAliasArgv(['--help']).help, true);
  assert.equal(parseAliasArgv(['-h']).help, true);

  const bad = parseAliasArgv(['-z']);
  assert.equal(bad.ok, false);
  assert.match(bad.stderr, /invalid option/);
  assert.equal(bad.exitCode, 2);
});

test('escapeTypeAliasBody: backslashes and backticks', () => {
  assert.equal(escapeTypeAliasBody('a'), 'a');
  assert.equal(escapeTypeAliasBody('a`b'), 'a\\`b');
  assert.equal(escapeTypeAliasBody('a\\b'), 'a\\\\b');
});

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

test('parseSplitArgv / parseSplitByteSize / split line helpers', () => {
  const def = parseSplitArgv([]);
  assert.equal(def.ok, true);
  assert.equal(def.byteMode, false);
  assert.equal(def.linesPerChunk, 1000);
  assert.deepEqual(def.operands, []);

  const lb = parseSplitArgv(['-l', '2', '-b', '1k']);
  assert.equal(lb.ok, false);
  assert.match(lb.stderr, /cannot split in more than one way/);

  const b512 = parseSplitArgv(['-b512']);
  assert.equal(b512.ok, true);
  assert.equal(b512.byteMode, true);
  assert.equal(b512.bytesPerChunk, 512);

  const b1k = parseSplitByteSize('1k');
  assert.equal(b1k.ok, true);
  assert.equal(b1k.bytes, 1024);

  const b1B = parseSplitByteSize('1b');
  assert.equal(b1B.ok, true);
  assert.equal(b1B.bytes, 512);

  assert.equal(parseSplitArgv(['--help']).help, true);
  assert.equal(parseSplitArgv(['--version']).version, true);
  assert.equal(SPLIT_VERSION_LINE, 'split (jsh Heyming Terminal) 1.0\n');

  assert.deepEqual(splitLinesWithSeparators('a\nb'), ['a\n', 'b']);
  assert.deepEqual(splitLinesWithSeparators(''), []);
  const u8 = new TextEncoder().encode('x\ny');
  assert.equal(splitLinesBytes(u8).length, 2);

  assert.equal(splitAlphabeticSuffix(0, 2), 'aa');
  assert.equal(splitAlphabeticSuffix(1, 2), 'ab');
  assert.equal(splitGenerateSuffix(25, { suffixMode: 'alpha', suffixWidth: 2 }), 'az');
  assert.equal(splitGenerateSuffix(5, { suffixMode: 'digit', suffixWidth: 2 }), '05');
  assert.equal(splitGenerateSuffix(15, { suffixMode: 'hex', suffixWidth: 2 }), '0f');
});

test('parseCsplitArgv / expandCsplitPatternTokens / csplitComputeTextPieces', () => {
  assert.equal(parseCsplitArgv(['--help']).help, true);
  assert.equal(parseCsplitArgv(['--version']).version, true);
  assert.equal(CSPLIT_VERSION_LINE, 'csplit (jsh Heyming Terminal) 1.0\n');

  const def = parseCsplitArgv(['f', '3']);
  assert.equal(def.ok, true);
  assert.equal(def.prefix, 'xx');
  assert.equal(def.digits, 2);
  assert.equal(def.silent, false);
  assert.deepEqual(def.operands, ['f', '3']);

  const opts = parseCsplitArgv(['-sk', '-f', 'out', '-n', '3', 'file', '2']);
  assert.equal(opts.ok, true);
  assert.equal(opts.silent, true);
  assert.equal(opts.keepFiles, true);
  assert.equal(opts.prefix, 'out');
  assert.equal(opts.digits, 3);
  assert.deepEqual(opts.operands, ['file', '2']);

  const glued = parseCsplitArgv(['-n4', '-fpfx', 'a', '5']);
  assert.equal(glued.ok, true);
  assert.equal(glued.digits, 4);
  assert.equal(glued.prefix, 'pfx');
  assert.deepEqual(glued.operands, ['a', '5']);

  const bad = parseCsplitArgv(['-x']);
  assert.equal(bad.ok, false);

  const ex = expandCsplitPatternTokens(['/a/', '{3}']);
  assert.equal(ex.ok, true);
  assert.equal(ex.atoms.length, 3);

  const ex2 = expandCsplitPatternTokens(['{1}']);
  assert.equal(ex2.ok, false);

  const lines = splitLinesWithSeparators('one\ntwo\nthree\n');
  const pc = csplitComputeTextPieces(lines, [{ type: 'line', n: 2 }]);
  assert.equal(pc.ok, true);
  assert.equal(pc.pieces.length, 2);
  assert.equal(pc.pieces[0], 'one\n');
  assert.equal(pc.pieces[1], 'two\nthree\n');

  const pc2 = csplitComputeTextPieces(lines, [{ type: 'regex', pat: 'two', skip: false }]);
  assert.equal(pc2.ok, true);
  assert.equal(pc2.pieces[0], 'one\ntwo\n');
  assert.equal(pc2.pieces[1], 'three\n');

  const sizesOut = csplitFormatStdoutSizes([14, 47], false);
  assert.match(sizesOut, /^\s+14\n\s+47\n$/);

  assert.equal(csplitFormatStdoutSizes([1], true), '');
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

test('vfsFollowSymlinksToFile: one hop to file', async () => {
  const terminal = {
    resolvePath: (s) => s,
    getFileSystemItem: async (p) => {
      if (p === '/link') {
        return { type: 'symlink', target: '/target' };
      }
      if (p === '/target') {
        return { type: 'file', content: 'hi' };
      }
      return null;
    }
  };
  const r = await vfsFollowSymlinksToFile(terminal, '/link', 'head');
  assert.equal(r.ok, true);
  assert.equal(r.file.content, 'hi');
});

test('parseReadlinkArgv: flags, --, help, missing operand, extra operand', () => {
  const basic = parseReadlinkArgv(['/x']);
  assert.equal(basic.ok, true);
  assert.equal(basic.canonMode, 'none');
  assert.equal(basic.noNewline, false);
  assert.equal(basic.operand, '/x');

  const nf = parseReadlinkArgv(['-nf', 'p']);
  assert.equal(nf.ok, true);
  assert.equal(nf.noNewline, true);
  assert.equal(nf.canonMode, 'f');
  assert.equal(nf.operand, 'p');

  assert.deepEqual(parseReadlinkArgv(['--', '-h']).operand, '-h');
  assert.equal(parseReadlinkArgv(['--help']).help, true);
  assert.equal(parseReadlinkArgv(['-h']).help, true);

  const miss = parseReadlinkArgv([]);
  assert.equal(miss.ok, false);
  assert.match(miss.stderr, /missing operand/);

  const extra = parseReadlinkArgv(['a', 'b']);
  assert.equal(extra.ok, false);
  assert.match(extra.stderr, /extra operand/);

  const bad = parseReadlinkArgv(['-z', 'f']);
  assert.equal(bad.ok, false);
  assert.match(bad.stderr, /invalid option/);
});

test('parseLnArgv: -s forms, --, help, hard-link mode, extra operand', () => {
  assert.equal(parseLnArgv(['--help']).help, true);
  assert.equal(parseLnArgv(['-h']).help, true);

  const two = parseLnArgv(['-s', '/a', 'b']);
  assert.equal(two.ok, true);
  assert.equal(two.symbolic, true);
  assert.equal(two.force, false);
  assert.equal(two.target, '/a');
  assert.equal(two.linkName, 'b');

  const sf = parseLnArgv(['-sf', 't', 'l']);
  assert.equal(sf.ok, true);
  assert.equal(sf.symbolic, true);
  assert.equal(sf.force, true);

  const one = parseLnArgv(['--symbolic', '/x/y']);
  assert.equal(one.ok, true);
  assert.equal(one.linkName, null);
  assert.equal(one.target, '/x/y');

  const dash = parseLnArgv(['-s', '--', '-z']);
  assert.equal(dash.ok, true);
  assert.equal(dash.target, '-z');
  assert.equal(dash.linkName, null);

  const hard = parseLnArgv(['a', 'b']);
  assert.equal(hard.ok, true);
  assert.equal(hard.symbolic, false);
  assert.deepEqual(hard.operands, ['a', 'b']);

  const miss = parseLnArgv(['-s']);
  assert.equal(miss.ok, false);
  assert.match(miss.stderr, /missing file operand/);

  const extra = parseLnArgv(['-s', 'a', 'b', 'c']);
  assert.equal(extra.ok, false);
  assert.match(extra.stderr, /extra operand/);

  const bad = parseLnArgv(['-s', '-z']);
  assert.equal(bad.ok, false);
  assert.match(bad.stderr, /invalid option/);
});

test('parseTouchArgv: -c, --no-create, --, help, operands, errors', () => {
  assert.equal(parseTouchArgv(['--help']).help, true);
  assert.equal(parseTouchArgv(['-h']).help, true);

  const one = parseTouchArgv(['a']);
  assert.equal(one.ok, true);
  assert.equal(one.noCreate, false);
  assert.deepEqual(one.operands, ['a']);

  const nc = parseTouchArgv(['-c', 'x', 'y']);
  assert.equal(nc.ok, true);
  assert.equal(nc.noCreate, true);
  assert.deepEqual(nc.operands, ['x', 'y']);

  const long = parseTouchArgv(['--no-create', 'z']);
  assert.equal(long.ok, true);
  assert.equal(long.noCreate, true);
  assert.deepEqual(long.operands, ['z']);

  const comb = parseTouchArgv(['-cc', 'f']);
  assert.equal(comb.ok, true);
  assert.equal(comb.noCreate, true);

  const dash = parseTouchArgv(['--', '-n']);
  assert.equal(dash.ok, true);
  assert.deepEqual(dash.operands, ['-n']);

  const miss = parseTouchArgv([]);
  assert.equal(miss.ok, false);
  assert.match(miss.stderr, /missing file operand/);

  const bad = parseTouchArgv(['-z', 'f']);
  assert.equal(bad.ok, false);
  assert.match(bad.stderr, /invalid option/);

  const longBad = parseTouchArgv(['--not-there']);
  assert.equal(longBad.ok, false);
  assert.match(longBad.stderr, /unrecognized option/);
});

test('parseTrueFalseArgv: GNU-style options, operands ignored, lone dash', () => {
  assert.equal(parseTrueFalseArgv([], 'true').ok, true);
  assert.equal(parseTrueFalseArgv(['foo', 'bar'], 'true').ok, true);
  assert.equal(parseTrueFalseArgv(['--'], 'false').ok, true);
  assert.equal(parseTrueFalseArgv(['--help'], 'true').help, true);
  assert.equal(parseTrueFalseArgv(['-h'], 'false').help, true);
  assert.equal(parseTrueFalseArgv(['--version'], 'true').version, true);
  assert.equal(parseTrueFalseArgv(['-'], 'true').ok, true);

  const badShort = parseTrueFalseArgv(['-z'], 'true');
  assert.equal(badShort.ok, false);
  assert.match(badShort.stderr, /invalid option -- 'z'/);

  const badLong = parseTrueFalseArgv(['--nope'], 'false');
  assert.equal(badLong.ok, false);
  assert.match(badLong.stderr, /unrecognized option '--nope'/);
});

test('parseTestArgv: --help, --version, unknown long option', () => {
  assert.equal(parseTestArgv([]).ok, true);
  assert.equal(parseTestArgv(['--help']).help, true);
  assert.equal(parseTestArgv(['--version']).version, true);
  const bad = parseTestArgv(['--foo']);
  assert.equal(bad.ok, false);
  assert.match(bad.stderr, /unrecognized option '--foo'/);
  assert.equal(bad.exitCode, 2);
  assert.equal(parseTestArgv(['-f']).ok, true);
  assert.equal(parseTestArgv(['--']).ok, true);
});

test('parseGrepArgv: options before pattern, --, -h is no-filename', () => {
  const a = parseGrepArgv(['-i', '-n', 'foo', 'a.txt']);
  assert.equal(a.ok, true);
  assert.equal(a.caseInsensitive, true);
  assert.equal(a.lineNumbers, true);
  assert.equal(a.pattern, 'foo');
  assert.deepEqual(a.fileOperands, ['a.txt']);

  const inv = parseGrepArgv(['-inv', 'pat']);
  assert.equal(inv.ok, true);
  assert.equal(inv.caseInsensitive, true);
  assert.equal(inv.lineNumbers, true);
  assert.equal(inv.invertMatch, true);
  assert.equal(inv.pattern, 'pat');
  assert.deepEqual(inv.fileOperands, []);

  const dash = parseGrepArgv(['--', '-x', 'y']);
  assert.equal(dash.ok, true);
  assert.equal(dash.pattern, '-x');
  assert.deepEqual(dash.fileOperands, ['y']);

  const help = parseGrepArgv(['--help']);
  assert.equal(help.ok, true);
  assert.equal(help.help, true);
  assert.match(GREP_HELP, /no-filename/);

  const nofn = parseGrepArgv(['-h', 'p']);
  assert.equal(nofn.ok, true);
  assert.equal(nofn.noFilename, true);
  assert.equal(nofn.pattern, 'p');

  const empty = parseGrepArgv([]);
  assert.equal(empty.ok, false);
  assert.match(empty.stderr, /missing operand/);

  const bare = parseGrepArgv(['--']);
  assert.equal(bare.ok, false);

  const bad = parseGrepArgv(['--unknown']);
  assert.equal(bad.ok, false);
  assert.match(bad.stderr, /unrecognized option/);
  assert.match(grepOptionError('--bad'), /Try 'grep --help'/);
});

test('symlinkBasenameForLn', () => {
  assert.equal(symlinkBasenameForLn('/foo/bar'), 'bar');
  assert.equal(symlinkBasenameForLn('rel/path'), 'path');
  assert.equal(symlinkBasenameForLn('name'), 'name');
});

test('parsePwdArgv: -L/-P, combined -LP, help, operands, errors', () => {
  assert.deepEqual(parsePwdArgv([]), { ok: true, physical: false });
  assert.deepEqual(parsePwdArgv(['-P']), { ok: true, physical: true });
  assert.deepEqual(parsePwdArgv(['-L']), { ok: true, physical: false });
  assert.deepEqual(parsePwdArgv(['--physical']), { ok: true, physical: true });
  assert.deepEqual(parsePwdArgv(['--logical']), { ok: true, physical: false });
  assert.deepEqual(parsePwdArgv(['-LP']), { ok: true, physical: true });
  assert.deepEqual(parsePwdArgv(['-PL']), { ok: true, physical: false });
  assert.equal(parsePwdArgv(['--help']).help, true);
  assert.equal(parsePwdArgv(['-h']).help, true);

  const afterDash = parsePwdArgv(['--', 'x']);
  assert.equal(afterDash.ok, false);
  assert.equal(afterDash.exitCode, 1);
  assert.match(afterDash.stderr, /extra operand/);

  const bad = parsePwdArgv(['-z']);
  assert.equal(bad.ok, false);
  assert.equal(bad.exitCode, 2);
});

test('parseDateArgv: -u, -I/-Is, long forms, combined -uI, help, operands, errors', () => {
  assert.deepEqual(parseDateArgv([]), { ok: true, utc: false, iso: 'none' });
  assert.deepEqual(parseDateArgv(['-u']), { ok: true, utc: true, iso: 'none' });
  assert.deepEqual(parseDateArgv(['-I']), { ok: true, utc: false, iso: 'date' });
  assert.deepEqual(parseDateArgv(['-Is']), { ok: true, utc: false, iso: 'seconds' });
  assert.deepEqual(parseDateArgv(['-u', '-I']), { ok: true, utc: true, iso: 'date' });
  assert.deepEqual(parseDateArgv(['-uI']), { ok: true, utc: true, iso: 'date' });
  assert.deepEqual(parseDateArgv(['-uIs']), { ok: true, utc: true, iso: 'seconds' });
  assert.deepEqual(parseDateArgv(['--utc']), { ok: true, utc: true, iso: 'none' });
  assert.deepEqual(parseDateArgv(['--iso-8601']), { ok: true, utc: false, iso: 'date' });
  assert.deepEqual(parseDateArgv(['--iso-8601=seconds']), { ok: true, utc: false, iso: 'seconds' });
  assert.deepEqual(parseDateArgv(['--iso-8601=s']), { ok: true, utc: false, iso: 'seconds' });
  assert.deepEqual(parseDateArgv(['--iso-8601=date']), { ok: true, utc: false, iso: 'date' });
  assert.equal(parseDateArgv(['--help']).help, true);
  assert.equal(parseDateArgv(['-h']).help, true);
  assert.equal(parseDateArgv(['--version']).version, true);

  const badIso = parseDateArgv(['--iso-8601=ns']);
  assert.equal(badIso.ok, false);
  assert.equal(badIso.exitCode, 1);
  assert.match(badIso.stderr, /invalid argument/);

  const extra = parseDateArgv(['foo']);
  assert.equal(extra.ok, false);
  assert.equal(extra.exitCode, 1);
  assert.match(extra.stderr, /extra operand/);

  const afterDash = parseDateArgv(['--', 'x']);
  assert.equal(afterDash.ok, false);
  assert.equal(afterDash.exitCode, 1);

  const bad = parseDateArgv(['-z']);
  assert.equal(bad.ok, false);
  assert.equal(bad.exitCode, 2);
});

test('parseSeqArgv / genSeqSequence / formatSeqOutput: GNU-style seq', () => {
  assert.equal(parseSeqArgv([]).ok, false);
  assert.match(parseSeqArgv([]).stderr, /missing operand/);

  assert.equal(parseSeqArgv(['--help']).help, true);
  assert.equal(parseSeqArgv(['-h']).help, true);
  assert.equal(parseSeqArgv(['--version']).version, true);

  const one = parseSeqArgv(['5']);
  assert.equal(one.ok, true);
  assert.equal(one.first, 1);
  assert.equal(one.last, 5);
  assert.equal(one.incr, 1);

  const neg = parseSeqArgv(['-1']);
  assert.equal(neg.ok, true);
  assert.equal(neg.first, 1);
  assert.equal(neg.last, -1);
  assert.equal(neg.incr, -1);

  const two = parseSeqArgv(['3', '1']);
  assert.equal(two.ok, true);
  assert.equal(two.first, 3);
  assert.equal(two.last, 1);
  assert.equal(two.incr, -1);

  const three = parseSeqArgv(['1', '2', '5']);
  assert.equal(three.ok, true);
  assert.equal(three.first, 1);
  assert.equal(three.incr, 2);
  assert.equal(three.last, 5);

  const w = parseSeqArgv(['-w', '1', '3']);
  assert.equal(w.ok, true);
  assert.equal(w.equalWidth, true);

  const s = parseSeqArgv(['-s', ':', '1', '3']);
  assert.equal(s.ok, true);
  assert.equal(s.separator, ':');

  const sepEq = parseSeqArgv(['--separator=:', '1', '2']);
  assert.equal(sepEq.ok, true);
  assert.equal(sepEq.separator, ':');

  const extra = parseSeqArgv(['1', '2', '3', '4']);
  assert.equal(extra.ok, false);
  assert.match(extra.stderr, /extra operand/);

  const badOpt = parseSeqArgv(['-f']);
  assert.equal(badOpt.ok, false);
  assert.equal(badOpt.exitCode, 2);

  const z = genSeqSequence(1, 0, 1);
  assert.equal(z.ok, false);
  assert.match(z.stderr, /zero increment/);

  const g1 = genSeqSequence(1, 1, 3);
  assert.deepEqual(g1.ok && g1.values, [1, 2, 3]);

  const g2 = genSeqSequence(1, -1, 0.5);
  // GNU-style: descending toward 0.5 stops before printing 0 (same as `seq 0.5` → only 1)
  assert.deepEqual(g2.ok && g2.values, [1]);

  const out = formatSeqOutput([1, 2, 10], '\n', true);
  assert.equal(out, '01\n02\n10\n');
});

test('parseSleepArgv: GNU-style sleep', () => {
  assert.equal(parseSleepArgv([]).ok, false);
  assert.match(parseSleepArgv([]).stderr, /missing operand/);

  assert.equal(parseSleepArgv(['--help']).help, true);
  assert.equal(parseSleepArgv(['-h']).help, true);
  assert.equal(parseSleepArgv(['--version']).version, true);

  const one = parseSleepArgv(['2']);
  assert.equal(one.ok, true);
  assert.equal(one.totalSeconds, 2);

  const half = parseSleepArgv(['0.5']);
  assert.equal(half.ok, true);
  assert.equal(half.totalSeconds, 0.5);

  const sum = parseSleepArgv(['2', '3']);
  assert.equal(sum.ok, true);
  assert.equal(sum.totalSeconds, 5);

  const min = parseSleepArgv(['1m']);
  assert.equal(min.ok, true);
  assert.equal(min.totalSeconds, 60);

  const dashdash = parseSleepArgv(['--', '-1']);
  assert.equal(dashdash.ok, false);
  assert.match(dashdash.stderr, /invalid time interval/);

  const neg = parseSleepArgv(['-1']);
  assert.equal(neg.ok, false);
  assert.match(neg.stderr, /invalid time interval/);

  const badOpt = parseSleepArgv(['-f']);
  assert.equal(badOpt.ok, false);
  assert.equal(badOpt.exitCode, 2);

  const zero = parseSleepArgv(['0']);
  assert.equal(zero.ok, true);
  assert.equal(zero.totalSeconds, 0);
});

test('parsePrintfArgv / runPrintfFormat: GNU-style printf subset', () => {
  assert.equal(parsePrintfArgv([]).ok, false);
  assert.match(parsePrintfArgv([]).stderr, /missing operand/);

  assert.equal(parsePrintfArgv(['--help']).help, true);
  assert.equal(parsePrintfArgv(['-h']).help, true);
  assert.equal(parsePrintfArgv(['--version']).version, true);

  const bad = parsePrintfArgv(['-z']);
  assert.equal(bad.ok, false);
  assert.equal(bad.exitCode, 2);

  const dashdash = parsePrintfArgv(['--', '-v', 'x']);
  assert.equal(dashdash.ok, true);
  assert.equal(dashdash.format, '-v');
  assert.deepEqual(dashdash.operands, ['x']);

  const r1 = runPrintfFormat('%s=%d\\n', ['PATH', '42']);
  assert.equal(r1.ok, true);
  assert.equal(r1.stdout, 'PATH=42\n');

  const r2 = runPrintfFormat('%s\\n', ['a', 'b', 'c']);
  assert.equal(r2.ok, true);
  assert.equal(r2.stdout, 'a\nb\nc\n');

  const r3 = runPrintfFormat('100%%', []);
  assert.equal(r3.ok, true);
  assert.equal(r3.stdout, '100%');

  const r4 = runPrintfFormat('hi', ['extra']);
  assert.equal(r4.ok, true);
  assert.equal(r4.stdout, 'hi');
  assert.match(r4.stderr, /ignoring excess/);

  const r5 = runPrintfFormat('%s', []);
  assert.equal(r5.ok, false);
  assert.equal(r5.exitCode, 1);

  const r6 = runPrintfFormat('%x', ['255']);
  assert.equal(r6.ok, true);
  assert.equal(r6.stdout, 'ff');
});

test('parseBasenameArgv / basenameCompute: GNU-style basename', () => {
  assert.equal(parseBasenameArgv([]).ok, false);
  assert.match(parseBasenameArgv([]).stderr, /missing operand/);

  const h = parseBasenameArgv(['--help']);
  assert.equal(h.ok, true);
  assert.equal(h.help, true);

  const v = parseBasenameArgv(['--version']);
  assert.equal(v.ok, true);
  assert.equal(v.version, true);
  assert.equal(BASENAME_VERSION_LINE.trim(), 'basename (jsh Heyming Terminal) 1.0');

  const bad = parseBasenameArgv(['-x']);
  assert.equal(bad.ok, false);
  assert.equal(bad.exitCode, 2);

  const one = parseBasenameArgv(['/a/b/c.txt']);
  assert.equal(one.ok, true);
  assert.deepEqual(one.names, ['/a/b/c.txt']);
  assert.equal(one.suffix, null);

  const two = parseBasenameArgv(['foo.bar', '.bar']);
  assert.equal(two.ok, true);
  assert.deepEqual(two.names, ['foo.bar']);
  assert.equal(two.suffix, '.bar');

  const sopt = parseBasenameArgv(['-s', '.txt', '/x/y.txt']);
  assert.equal(sopt.ok, true);
  assert.deepEqual(sopt.names, ['/x/y.txt']);
  assert.equal(sopt.suffix, '.txt');

  const glued = parseBasenameArgv(['-s.txt', 'a.txt']);
  assert.equal(glued.ok, true);
  assert.equal(glued.suffix, '.txt');

  const extra = parseBasenameArgv(['-s', '.txt', 'a', 'b']);
  assert.equal(extra.ok, false);
  assert.match(extra.stderr, /extra operand/);

  const multi = parseBasenameArgv(['-a', '/p/a', '/q/b']);
  assert.equal(multi.ok, true);
  assert.deepEqual(multi.names, ['/p/a', '/q/b']);

  const ma = parseBasenameArgv(['-s', '.x', '-a', 'a.x', 'b.x']);
  assert.equal(ma.ok, true);
  assert.equal(ma.suffix, '.x');
  assert.deepEqual(ma.names, ['a.x', 'b.x']);

  const dd = parseBasenameArgv(['--', '-n']);
  assert.equal(dd.ok, true);
  assert.deepEqual(dd.names, ['-n']);

  assert.equal(basenameCompute('/a/b/c', null), 'c');
  assert.equal(basenameCompute('/a/b/c.txt', '.txt'), 'c');
  assert.equal(basenameCompute('/', null), '/');
});

test('parseDirnameArgv / dirnameCompute: GNU-style dirname', () => {
  assert.equal(parseDirnameArgv([]).ok, false);
  assert.match(parseDirnameArgv([]).stderr, /missing operand/);

  const h = parseDirnameArgv(['--help']);
  assert.equal(h.ok, true);
  assert.equal(h.help, true);

  const hh = parseDirnameArgv(['-h']);
  assert.equal(hh.ok, true);
  assert.equal(hh.help, true);

  const v = parseDirnameArgv(['--version']);
  assert.equal(v.ok, true);
  assert.equal(v.version, true);
  assert.equal(DIRNAME_VERSION_LINE.trim(), 'dirname (jsh Heyming Terminal) 1.0');

  const bad = parseDirnameArgv(['-x']);
  assert.equal(bad.ok, false);
  assert.equal(bad.exitCode, 2);

  const one = parseDirnameArgv(['/a/b/c']);
  assert.equal(one.ok, true);
  assert.deepEqual(one.names, ['/a/b/c']);
  assert.equal(one.zero, false);

  const multi = parseDirnameArgv(['/p/a', '/q/b']);
  assert.equal(multi.ok, true);
  assert.deepEqual(multi.names, ['/p/a', '/q/b']);

  const z = parseDirnameArgv(['-z', '/x/y']);
  assert.equal(z.ok, true);
  assert.equal(z.zero, true);
  assert.deepEqual(z.names, ['/x/y']);

  const dd = parseDirnameArgv(['--', '-n']);
  assert.equal(dd.ok, true);
  assert.deepEqual(dd.names, ['-n']);

  const emptyOp = parseDirnameArgv(['']);
  assert.equal(emptyOp.ok, true);
  assert.deepEqual(emptyOp.names, ['']);

  assert.equal(dirnameCompute(''), '.');
  assert.equal(dirnameCompute('/'), '/');
  assert.equal(dirnameCompute('///'), '/');
  assert.equal(dirnameCompute('/usr/lib'), '/usr');
  assert.equal(dirnameCompute('usr'), '.');
  assert.equal(dirnameCompute('//a'), '/');
  assert.equal(dirnameCompute('/a/'), '/');
  assert.equal(dirnameCompute('a/b'), 'a');
  assert.equal(dirnameCompute('.'), '.');
});

test('formatDateOutput: UTC ISO date and seconds', () => {
  const d = new Date('2026-04-04T15:30:45.123Z');
  assert.equal(formatDateOutput(d, { utc: true, iso: 'date' }), '2026-04-04');
  assert.equal(formatDateOutput(d, { utc: true, iso: 'seconds' }), '2026-04-04T15:30:45Z');
});

test('formatDateOutput: local ISO seconds matches YYYY-MM-DDTHH:MM:SS', () => {
  const d = new Date(2026, 3, 4, 8, 1, 2);
  assert.match(formatDateOutput(d, { utc: false, iso: 'seconds' }), /^2026-04-04T08:01:02$/);
});

test('vfsReadlinkCanonical: follows chain; -e errors when missing', async () => {
  const terminal = {
    resolvePath: (s) => s,
    getFileSystemItem: async (p) => {
      if (p === '/link') {
        return { type: 'symlink', target: '/dir/file' };
      }
      if (p === '/dir/file') {
        return { type: 'file', content: 'x' };
      }
      return null;
    }
  };
  const ok = await vfsReadlinkCanonical(terminal, '/link', 'f');
  assert.equal(ok.ok, true);
  assert.equal(ok.path, '/dir/file');

  const missing = await vfsReadlinkCanonical(terminal, '/nope', 'e');
  assert.equal(missing.ok, false);
  assert.match(missing.stderr, /No such file or directory/);

  const missingF = await vfsReadlinkCanonical(terminal, '/nope', 'f');
  assert.equal(missingF.ok, true);
  assert.equal(missingF.path, '/nope');

  const missPwd = await vfsReadlinkCanonical(terminal, '/gone', 'e', 'pwd');
  assert.equal(missPwd.ok, false);
  assert.match(missPwd.stderr, /^pwd: /);
});

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

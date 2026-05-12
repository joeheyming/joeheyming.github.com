import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VfsUtils } from '../lib/vfs-utils.js';
import { ReadlinkLib } from '../commands/filesystem/readlink-lib.js';
import { LnLib } from '../commands/filesystem/ln-lib.js';
import { TouchLib } from '../commands/filesystem/touch-lib.js';
import { TestLib } from '../commands/system/test-lib.js';
import { GrepLib } from '../commands/filesystem/grep-lib.js';
import { PwdLib } from '../commands/system/pwd-lib.js';
import { DateLib } from '../commands/system/date-lib.js';
import { SeqLib } from '../commands/system/seq-lib.js';
import { SleepLib } from '../commands/system/sleep-lib.js';
import { PrintfLib } from '../commands/filesystem/printf-lib.js';
import { BasenameLib } from '../commands/filesystem/basename-lib.js';

const { vfsFollowSymlinksToFile, vfsReadlinkCanonical } = VfsUtils;

const { parseReadlinkArgv } = ReadlinkLib;

const { parseLnArgv, symlinkBasenameForLn } = LnLib;

const { parseTouchArgv } = TouchLib;

const { parseTestArgv, parseTrueFalseArgv } = TestLib;

const { parseGrepArgv, GREP_HELP, grepOptionError } = GrepLib;

const { parsePwdArgv } = PwdLib;

const { parseDateArgv, formatDateOutput } = DateLib;

const { parseSeqArgv, genSeqSequence, formatSeqOutput } = SeqLib;

const { parseSleepArgv } = SleepLib;

const { parsePrintfArgv, runPrintfFormat } = PrintfLib;

const {
  parseBasenameArgv,
  basenameCompute,
  BASENAME_VERSION_LINE,
  parseDirnameArgv,
  dirnameCompute,
  DIRNAME_VERSION_LINE
} = BasenameLib;

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

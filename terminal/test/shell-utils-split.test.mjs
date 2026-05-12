import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SplitLib } from '../commands/filesystem/split-lib.js';
import { CsplitLib } from '../commands/filesystem/csplit-lib.js';

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

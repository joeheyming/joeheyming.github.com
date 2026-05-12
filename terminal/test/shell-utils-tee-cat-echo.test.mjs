import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TeeLib } from '../commands/filesystem/tee-lib.js';
import { CatLib } from '../commands/filesystem/cat-lib.js';
import { EchoLib } from '../commands/filesystem/echo-lib.js';

const { parseTeeArgv } = TeeLib;

const { parseCatArgv } = CatLib;

const { parseEchoArgv, echoApplyBackslashEscapes, ECHO_VERSION_LINE } = EchoLib;

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

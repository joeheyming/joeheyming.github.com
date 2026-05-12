import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FileopsLib } from '../commands/filesystem/fileops-lib.js';

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

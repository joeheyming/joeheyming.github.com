import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packTar, unpackTar, buildHeader, strToBytes, bytesToStr } from '../commands/filesystem/tar-lib.js';
import { parseTarArgv } from '../commands/filesystem/tar.js';
import { parseGzipArgv } from '../commands/filesystem/gzip.js';

test('packTar / unpackTar: roundtrip single file', () => {
  const entries = [
    { name: 'a.txt', type: 'file', data: strToBytes('hello'), mode: 0o644 }
  ];
  const buf = packTar(entries);
  const out = unpackTar(buf);
  assert.equal(out.length, 1);
  assert.equal(out[0].name, 'a.txt');
  assert.equal(out[0].type, 'file');
  assert.equal(bytesToStr(out[0].data), 'hello');
});

test('packTar: pads to 512 and terminates with two zero blocks', () => {
  const entries = [{ name: 'x', type: 'file', data: strToBytes('abc') }];
  const buf = packTar(entries);
  // header (512) + data padded to 512 + 2x 512 zero blocks = 4 * 512.
  assert.equal(buf.length, 4 * 512);
  const tail = buf.subarray(buf.length - 1024);
  for (let i = 0; i < tail.length; i++) assert.equal(tail[i], 0);
});

test('packTar / unpackTar: mixed dirs and files', () => {
  const entries = [
    { name: 'dir', type: 'directory', mode: 0o755 },
    { name: 'dir/a.txt', type: 'file', data: strToBytes('first') },
    { name: 'dir/b.txt', type: 'file', data: strToBytes('second') }
  ];
  const buf = packTar(entries);
  const out = unpackTar(buf);
  assert.equal(out.length, 3);
  assert.equal(out[0].type, 'directory');
  assert.equal(out[0].name, 'dir');
  assert.equal(out[1].name, 'dir/a.txt');
  assert.equal(bytesToStr(out[1].data), 'first');
  assert.equal(out[2].name, 'dir/b.txt');
  assert.equal(bytesToStr(out[2].data), 'second');
});

test('buildHeader: computes a valid USTAR checksum', () => {
  const hdr = buildHeader({ name: 'f', size: 0, typeflag: '0' });
  // Checksum field should contain digits + NUL + space.
  const sumStr = bytesToStr(hdr.subarray(148, 154)).trim();
  assert.match(sumStr, /^[0-7]+$/);
});

test('parseTarArgv: cf creates with archive', () => {
  const r = parseTarArgv(['cf', 'out.tar', 'a', 'b']);
  assert.equal(r.ok, true);
  assert.equal(r.mode, 'c');
  assert.equal(r.archive, 'out.tar');
  assert.deepEqual(r.operands, ['a', 'b']);
});

test('parseTarArgv: tf lists', () => {
  const r = parseTarArgv(['tf', 'in.tar']);
  assert.equal(r.ok, true);
  assert.equal(r.mode, 't');
});

test('parseTarArgv: xzf extracts gzipped', () => {
  const r = parseTarArgv(['xzf', 'in.tgz', '-C', '/tmp']);
  assert.equal(r.ok, true);
  assert.equal(r.mode, 'x');
  assert.equal(r.gzipped, true);
  assert.equal(r.cwd, '/tmp');
});

test('parseTarArgv: missing mode errors', () => {
  const r = parseTarArgv(['f', 'archive']);
  assert.equal(r.ok, false);
});

test('parseGzipArgv: -d decompresses', () => {
  const r = parseGzipArgv(['-d', 'foo.gz']);
  assert.equal(r.ok, true);
  assert.equal(r.decompress, true);
  assert.deepEqual(r.files, ['foo.gz']);
});

test('parseGzipArgv: defaultDecompress=true makes gunzip behavior', () => {
  const r = parseGzipArgv(['foo.gz'], true);
  assert.equal(r.ok, true);
  assert.equal(r.decompress, true);
});

test('parseGzipArgv: -k -c combinable', () => {
  const r = parseGzipArgv(['-kc', 'f']);
  assert.equal(r.ok, true);
  assert.equal(r.keep, true);
  assert.equal(r.toStdout, true);
});

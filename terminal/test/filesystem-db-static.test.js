'use strict';

/**
 * FileSystemDB attaches to window. In Node, set global.window = global before require.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const fsDbPath = path.join(__dirname, '../../os/filesystem-db.js');

function loadFileSystemDB() {
  delete require.cache[require.resolve(fsDbPath)];
  global.window = global;
  require(fsDbPath);
  return global.FileSystemDB;
}

const FileSystemDB = loadFileSystemDB();

test('getUtf8TextForDisplay: non-empty content wins', () => {
  const buf = new TextEncoder().encode('bytes');
  assert.equal(
    FileSystemDB.getUtf8TextForDisplay({
      type: 'file',
      content: 'hello',
      contentBytes: buf.buffer
    }),
    'hello'
  );
});

test('getUtf8TextForDisplay: decodes UTF-8 from ArrayBuffer when content empty', () => {
  const u8 = new TextEncoder().encode('#!/bin/sh\necho ok\n');
  assert.equal(
    FileSystemDB.getUtf8TextForDisplay({
      type: 'file',
      content: '',
      contentBytes: u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)
    }),
    '#!/bin/sh\necho ok\n'
  );
});

test('getUtf8TextForDisplay: Uint8Array view', () => {
  const u8 = new Uint8Array([0x61, 0x62, 0x63]);
  assert.equal(FileSystemDB.getUtf8TextForDisplay({ type: 'file', contentBytes: u8 }), 'abc');
});

test('getUtf8TextForDisplay: NUL in first 8KiB → binary (empty string)', () => {
  const u8 = new Uint8Array([0x48, 0x69, 0, 0x50]);
  assert.equal(FileSystemDB.getUtf8TextForDisplay({ type: 'file', contentBytes: u8 }), '');
});

test('getContentForApp: returns ArrayBuffer when contentBytes is Uint8Array', () => {
  const u8 = new Uint8Array([1, 2, 3, 4]);
  const out = FileSystemDB.getContentForApp({ type: 'file', contentBytes: u8 });
  assert.ok(out instanceof ArrayBuffer);
  assert.deepEqual(Array.from(new Uint8Array(out)), [1, 2, 3, 4]);
});

test('getContentForApp: Uint8Array subview copies exact byte range (not whole backing buffer)', () => {
  const pool = new ArrayBuffer(256);
  const u8 = new Uint8Array(pool, 100, 4);
  u8.set([0xaa, 0xbb, 0xcc, 0xdd]);
  const out = FileSystemDB.getContentForApp({ type: 'file', contentBytes: u8 });
  assert.ok(out instanceof ArrayBuffer);
  assert.equal(out.byteLength, 4);
  assert.deepEqual(Array.from(new Uint8Array(out)), [0xaa, 0xbb, 0xcc, 0xdd]);
});

const ShellUtils = require('../lib/shell-utils.js');

test('getUtf8TextForDisplay stays aligned with ShellUtils.fileItemUtf8ForDisplay', () => {
  const item = { type: 'file', content: '', contentBytes: new TextEncoder().encode('a\nb') };
  const fsText = FileSystemDB.getUtf8TextForDisplay(item);
  const { text, isBinary } = ShellUtils.fileItemUtf8ForDisplay(item);
  assert.equal(fsText, text);
  assert.equal(isBinary, false);
});

test('pathIsDescendantOrSelf: exact and children, not sibling-prefix', () => {
  assert.equal(FileSystemDB.pathIsDescendantOrSelf('/home/user', '/home/user'), true);
  assert.equal(FileSystemDB.pathIsDescendantOrSelf('/home/user/doc', '/home/user'), true);
  assert.equal(FileSystemDB.pathIsDescendantOrSelf('/home/username/x', '/home/user'), false);
  assert.equal(FileSystemDB.pathIsDescendantOrSelf('/home/user2', '/home/user'), false);
});

test('pathIsDescendantOrSelf: root and trailing slashes', () => {
  assert.equal(FileSystemDB.pathIsDescendantOrSelf('/tmp/a', '/'), true);
  assert.equal(FileSystemDB.pathIsDescendantOrSelf('/home/u/', '/home/u'), true);
});

test('mimeTypeForOpen: path string uses extension map', () => {
  assert.equal(FileSystemDB.mimeTypeForOpen('/home/u/readme.md'), 'text/markdown');
  assert.equal(FileSystemDB.mimeTypeForOpen('/x/unknown.bin'), 'application/octet-stream');
});

test('mimeTypeForOpen: item without mimeType falls back to path', () => {
  assert.equal(FileSystemDB.mimeTypeForOpen({ path: '/a/b.png' }), 'image/png');
});

test('mimeTypeForOpen: stored mimeType wins over extension', () => {
  assert.equal(
    FileSystemDB.mimeTypeForOpen({
      path: '/a/file.txt',
      mimeType: 'application/json'
    }),
    'application/json'
  );
});

test('mimeTypeForOpen: stored application/octet-stream defers to extension (binary file rows)', () => {
  assert.equal(
    FileSystemDB.mimeTypeForOpen({
      path: '/home/u/track.mp3',
      mimeType: 'application/octet-stream'
    }),
    'audio/mpeg'
  );
  assert.equal(
    FileSystemDB.mimeTypeForOpen({
      path: '/Desktop/anim.gif',
      mimeType: 'application/octet-stream'
    }),
    'image/gif'
  );
});

test('mimeTypeForOpen: typo octect-stream defers to extension', () => {
  assert.equal(
    FileSystemDB.mimeTypeForOpen({
      path: '/x/sound.mp3',
      mimeType: 'application/octect-stream'
    }),
    'audio/mpeg'
  );
});

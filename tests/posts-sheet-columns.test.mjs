import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../posts/apps-script.local.gs', import.meta.url), 'utf8');
const start = src.indexOf('function findCol_');
const end = src.indexOf('function parseChunk_');
if (start < 0 || end < 0) throw new Error('apps script column helpers not found');

const sandbox = {};
vm.runInNewContext(
  `${src.slice(start, end)}\nthis.resolveResponseCols_ = resolveResponseCols_;\n`,
  sandbox
);

const headers = ['Timestamp', 'text', 'attachment', 'name', 'metadata', 'honeypot'];
const post = JSON.stringify({ id: 'post-1', action: 'post', x: 0.2, y: 0.3 });
const move = JSON.stringify({ action: 'move', targetId: 'post-1', x: 0.4, y: 0.5 });

test('resolveResponseCols_ swaps titled metadata and honeypot when JSON landed in honeypot', () => {
  const values = [
    headers,
    ['9/1/2026 9:01:54', 'a note', '', 'owen', '', post],
    ['9/1/2026 9:02:00', '', '', '', '', move]
  ];
  const cols = sandbox.resolveResponseCols_(headers, values);
  assert.equal(cols.attachCol, 2);
  assert.equal(cols.honeyCol, 4);
  assert.equal(cols.metaCol, 5);
});

test('resolveResponseCols_ keeps titled columns when metadata is already in the metadata column', () => {
  const values = [
    headers,
    ['9/1/2026 9:01:54', 'a note', '', 'owen', post, ''],
    ['9/1/2026 9:02:00', 'spam', '', '', post, 'http://spam.example']
  ];
  const cols = sandbox.resolveResponseCols_(headers, values);
  assert.equal(cols.honeyCol, 5);
  assert.equal(cols.metaCol, 4);
});

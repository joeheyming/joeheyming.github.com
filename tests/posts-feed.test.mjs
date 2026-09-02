import test from 'node:test';
import assert from 'node:assert/strict';
import {
  previewText,
  parseTs,
  formatWhen,
  hashStr,
  clampCoordinate,
  parseAttachmentChunk,
  parseBoardPosts,
  remoteSomeMatch,
  mergeLocalWithRemote
} from '../posts/feed.js';

test('previewText strips markdown noise', () => {
  assert.equal(previewText('**Hello** _world_'), 'Hello world');
  assert.equal(previewText('# Title\n\nMore   text'), 'Title More text');
});

test('parseTs handles gviz Date() strings', () => {
  const ts = parseTs('Date(2026,7,8,17,0,0)');
  assert.equal(new Date(ts).getFullYear(), 2026);
  assert.equal(new Date(ts).getMonth(), 7);
  assert.equal(new Date(ts).getDate(), 8);
});

test('formatWhen returns a non-empty label', () => {
  const label = formatWhen(Date.UTC(2026, 7, 8, 17, 0, 0));
  assert.ok(label.length > 4);
});

test('hashStr is stable and base36', () => {
  assert.equal(hashStr('hello'), hashStr('hello'));
  assert.notEqual(hashStr('hello'), hashStr('world'));
  assert.match(hashStr('posts'), /^[0-9a-z]+$/);
});

test('clampCoordinate clamps and falls back', () => {
  assert.equal(clampCoordinate(0.5, 0.2), 0.5);
  assert.equal(clampCoordinate(0.01, 0.2), 0.06);
  assert.equal(clampCoordinate(0.99, 0.2), 0.94);
  assert.equal(clampCoordinate('nope', 0.33), 0.33);
});

test('parseAttachmentChunk includes data payload', () => {
  const chunk = parseAttachmentChunk('posts-attachment-chunk-v1|abc|0|2|DATA_HERE');
  assert.deepEqual(chunk, { id: 'abc', index: 0, total: 2, data: 'DATA_HERE' });
  assert.equal(parseAttachmentChunk('not-a-chunk'), null);
});

test('parseBoardPosts reassembles chunks and applies moves/removes', () => {
  const cols = ['Timestamp', 'Text', 'Attachments', 'Name', 'Metadata', 'Honeypot'];
  const rows = [
    [
      'Date(2026,7,8,12,0,0)',
      'Hello',
      'posts-attachment-chunk-v1|c1|0|2|data:image/png;base64,AA',
      'Ada',
      JSON.stringify({ id: 'post-1', action: 'post', x: 0.3, y: 0.4 }),
      ''
    ],
    ['Date(2026,7,8,12,0,1)', '', 'posts-attachment-chunk-v1|c1|1|2|BB', '', '', ''],
    [
      'Date(2026,7,8,12,0,2)',
      '',
      '',
      '',
      JSON.stringify({ action: 'move', targetId: 'post-1', x: 0.7, y: 0.8 }),
      ''
    ],
    [
      'Date(2026,7,8,12,0,3)',
      'Gone',
      '',
      'Bob',
      JSON.stringify({ id: 'post-2', action: 'post', x: 0.2, y: 0.2 }),
      ''
    ],
    [
      'Date(2026,7,8,12,0,4)',
      '',
      '',
      '',
      JSON.stringify({ action: 'remove', targetId: 'post-2' }),
      ''
    ]
  ];

  const { posts, removedIds } = parseBoardPosts(cols, rows);
  assert.ok(removedIds.has('post-2'));
  assert.equal(posts.length, 1);
  assert.equal(posts[0].id, 'post-1');
  assert.equal(posts[0].text, 'Hello');
  assert.deepEqual(posts[0].attachments, []);
  assert.equal(posts[0].x, 0.7);
  assert.equal(posts[0].y, 0.8);
});

test('remoteSomeMatch and mergeLocalWithRemote keep unmatched pending', () => {
  const remote = [{ id: 'a', text: 'hi', attachments: [], ts: 1000 }];
  const local = [
    { id: 'draft-1', text: 'x', attachments: [], ts: 1, draft: true },
    { id: 'pend-1', text: 'pending', attachments: [], ts: 900, pending: true },
    { id: 'a', text: 'hi', attachments: [], ts: 999, pending: true }
  ];
  assert.equal(remoteSomeMatch(remote, local[2]), true);
  assert.equal(remoteSomeMatch(remote, local[1]), false);
  const merged = mergeLocalWithRemote(local, remote);
  assert.equal(merged.length, 3);
  assert.equal(merged[0].id, 'draft-1');
  assert.equal(merged[1].id, 'pend-1');
  assert.equal(merged[2].id, 'a');
});

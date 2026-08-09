import test from 'node:test';
import assert from 'node:assert/strict';
import { previewText, parseTs, formatWhen } from '../posts/feed.js';

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

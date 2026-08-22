import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { colIndex, parseMessages } from '../live-chat/gviz.js';

describe('live chat sheet parsing', () => {
  it('prefers the exact id column over uuid', () => {
    const cols = ['timestamp', 'uuid', 'room', 'name', 'message', 'id'];
    assert.equal(colIndex(cols, ['id', 'msgid']), 5);

    const [message] = parseMessages(
      {
        cols,
        rows: [['2026-08-21', 'user-1', 'doom', 'Marine', 'hello', 'message-1']]
      },
      'doom'
    );
    assert.equal(message.id, 'message-1');
  });

  it('replaces legacy uuid-as-id collisions with a stable fallback', () => {
    const [message] = parseMessages(
      {
        cols: ['timestamp', 'uuid', 'room', 'name', 'message', 'id'],
        rows: [['2026-08-21', 'user-1', 'doom', 'Marine', 'hello', 'user-1']]
      },
      'doom'
    );
    assert.notEqual(message.id, 'user-1');
    assert.match(message.id, /^user-1-\d+-hello$/);
  });
});

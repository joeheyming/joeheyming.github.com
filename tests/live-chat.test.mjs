import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { colIndex, parseMessages } from '../live-chat/gviz.js';
import { formatChatTime, formatChatTimeTitle, localTimeZoneLabel } from '../live-chat/time.js';

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

  it('treats a date-only sheet cell as a calendar day, not a local midnight', () => {
    const [message] = parseMessages(
      {
        cols: ['timestamp', 'uuid', 'room', 'name', 'message', 'id'],
        rows: [['Date(2026,10,12)', 'user-1', 'doom', 'Marine', 'hello', 'message-1']]
      },
      'doom'
    );
    assert.equal(message.hasTime, false);
    assert.equal(message.ts, Date.UTC(2026, 10, 12));
    assert.equal(formatChatTime(message.ts, { hasTime: false, locale: 'en-US' }), 'Nov 12');
  });

  it('promotes an unlabeled header row back into column names', () => {
    const [message] = parseMessages(
      {
        cols: ['', '', '', '', '', ''],
        rows: [
          ['timestamp', 'uuid', 'room', 'name', 'message', 'id'],
          ['2026-11-12T17:27:35.367Z', 'user-1', 'doom', 'Marine', 'hello', 'message-1']
        ]
      },
      'doom'
    );
    assert.equal(message.message, 'hello');
    assert.equal(message.name, 'Marine');
    assert.equal(message.hasTime, true);
    assert.equal(message.ts, Date.parse('2026-11-12T17:27:35.367Z'));
    assert.equal(
      formatChatTime(message.ts, { locale: 'en-US', timeZone: 'America/Los_Angeles' }),
      'Nov 12, 9:27 AM'
    );
  });

  it('keeps an ISO timestamp as an absolute instant', () => {
    const [message] = parseMessages(
      {
        cols: ['timestamp', 'uuid', 'room', 'name', 'message', 'id'],
        rows: [['2026-11-12T03:00:00.000Z', 'user-1', 'doom', 'Marine', 'hello', 'message-1']]
      },
      'doom'
    );
    assert.equal(message.hasTime, true);
    assert.equal(message.ts, Date.UTC(2026, 10, 12, 3, 0, 0));
  });
});

describe('live chat local times', () => {
  const sent = Date.UTC(2026, 10, 12, 3, 0, 0);

  it('shows the local date and time', () => {
    assert.equal(formatChatTime(sent, { locale: 'en-US', timeZone: 'UTC' }), 'Nov 12, 3:00 AM');
    assert.equal(
      formatChatTime(sent, { locale: 'en-US', timeZone: 'America/Los_Angeles' }),
      'Nov 11, 7:00 PM'
    );
  });

  it('names the time zone on the full label', () => {
    const title = formatChatTimeTitle(sent, { locale: 'en-US', timeZone: 'UTC' });
    assert.match(title, /3:00 AM/);
    assert.match(title, /UTC/);
    assert.equal(
      localTimeZoneLabel(sent, { locale: 'en-US', timeZone: 'America/Los_Angeles' }),
      'PST'
    );
  });
});

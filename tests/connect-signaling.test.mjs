import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  FORM_FIELDS,
  busyTarget,
  createRoomCode,
  findWaitingPeer,
  formBody,
  latestSignalsByPeer,
  parseRoomCode,
  parseSheetResponse,
  partnerHasLeft,
  roomLobby,
  summarizeLobby
} from '../connect/signaling.js';

function signal(peer, kind, secondsAgo, target = '') {
  return {
    peer,
    kind,
    target,
    payload: '',
    timestamp: new Date(Date.now() - secondsAgo * 1000)
  };
}

describe('Connect signaling', () => {
  it('maps the Google Sheet columns by name rather than position', () => {
    const signals = parseSheetResponse({
      table: {
        cols: [{ label: 'payload' }, { label: 'Timestamp' }, { label: 'kind' }, { label: 'peer' }],
        rows: [
          {
            c: [
              { v: '{"type":"offer"}' },
              { v: '10/17/2026 8:00:00 PM' },
              { v: 'offer' },
              { v: 'other-peer' }
            ]
          }
        ]
      }
    });

    assert.deepEqual(signals[0].peer, 'other-peer');
    assert.deepEqual(signals[0].kind, 'offer');
    assert.deepEqual(signals[0].payload, '{"type":"offer"}');
  });

  it('parses the Google Visualization API timestamp format', () => {
    const [signal] = parseSheetResponse({
      table: {
        cols: [
          { label: 'Timestamp' },
          { label: 'peer' },
          { label: 'kind' },
          { label: 'target' },
          { label: 'payload' }
        ],
        rows: [
          {
            c: [
              { v: 'Date(2026,9,17,20,11,13)', f: '10/17/2026 8:11:13 PM' },
              { v: 'other-peer' },
              { v: 'waiting' },
              null,
              null
            ]
          }
        ]
      }
    });

    assert.equal(signal.timestamp.getFullYear(), 2026);
    assert.equal(signal.timestamp.getMonth(), 9);
    assert.equal(signal.timestamp.getDate(), 17);
    assert.equal(signal.timestamp.getHours(), 20);
  });

  it('keeps only a peer’s newest fresh signal', () => {
    const now = Date.now();
    const signals = [
      signal('a', 'waiting', 10),
      signal('a', 'bye', 2),
      signal('b', 'waiting', 120)
    ];

    const latest = latestSignalsByPeer(signals, now);
    assert.equal(latest.get('a').kind, 'bye');
    assert.equal(latest.has('b'), false);
  });

  it('judges freshness against the sheet clock, not the device clock', () => {
    const hourAgo = Date.now() - 60 * 60 * 1000;
    const at = (offsetSeconds) => new Date(hourAgo + offsetSeconds * 1000);
    const signals = [
      { peer: 'ghost', kind: 'waiting', target: '', payload: '', timestamp: at(0) },
      { peer: 'phone', kind: 'waiting', target: '', payload: '', timestamp: at(30) },
      { peer: 'laptop', kind: 'waiting', target: '', payload: '', timestamp: at(32) }
    ];

    const latest = latestSignalsByPeer(signals);
    assert.deepEqual([...latest.keys()].sort(), ['laptop', 'phone']);
    assert.equal(findWaitingPeer(signals, 'zzz').peer, 'laptop');
  });

  it('only offers to a lexically earlier waiting peer', () => {
    const now = Date.now();
    const selected = findWaitingPeer(
      [signal('earlier', 'waiting', 3), signal('zeta', 'waiting', 6), signal('gone', 'bye', 1)],
      'middle',
      { now }
    );

    assert.equal(selected.peer, 'earlier');
  });

  it('keeps private rooms and people in calls out of random matching', () => {
    const now = Date.now();
    const signals = [
      signal('a-room', 'waiting', 2, roomLobby('abc123')),
      signal('b-busy', 'waiting', 2, busyTarget('someone')),
      signal('c-random', 'waiting', 4)
    ];

    assert.equal(findWaitingPeer(signals, 'zzz', { now }).peer, 'c-random');
    assert.equal(
      findWaitingPeer(signals, 'zzz', { lobby: roomLobby('abc123'), now }).peer,
      'a-room'
    );
    assert.equal(findWaitingPeer(signals, 'zzz', { lobby: roomLobby('other1'), now }), undefined);
  });

  it('counts who is ready to match and who is in a call', () => {
    const now = Date.now();
    const summary = summarizeLobby(
      [
        signal('me', 'waiting', 1),
        signal('ready', 'waiting', 2),
        signal('room', 'waiting', 2, roomLobby('abc123')),
        signal('busy', 'waiting', 3, busyTarget('other')),
        signal('dialing', 'offer', 3, 'ready'),
        signal('left', 'bye', 1),
        signal('stale', 'waiting', 60)
      ],
      'me',
      now
    );

    assert.deepEqual(summary, { ready: 1, inCall: 2 });
  });

  it('notices when a connected partner has moved on', () => {
    assert.equal(partnerHasLeft(signal('p', 'waiting', 1, busyTarget('me')), 'me'), false);
    assert.equal(partnerHasLeft(signal('p', 'answer', 1, 'me'), 'me'), false);
    assert.equal(partnerHasLeft(signal('p', 'waiting', 1), 'me'), true);
    assert.equal(partnerHasLeft(signal('p', 'waiting', 1, busyTarget('new')), 'me'), true);
    assert.equal(partnerHasLeft(signal('p', 'bye', 1, 'me'), 'me'), true);
    assert.equal(partnerHasLeft(undefined, 'me'), false);
  });

  it('accepts only well-formed room codes', () => {
    assert.match(createRoomCode(), /^[a-z0-9]{10}$/);
    assert.equal(parseRoomCode(' AbC123 '), 'abc123');
    assert.equal(parseRoomCode('../evil'), '');
    assert.equal(parseRoomCode(null), '');
  });

  it('creates a form response body with all signaling fields', () => {
    const body = formBody({
      peer: 'peer-a',
      kind: 'offer',
      target: 'peer-b',
      payload: '{"type":"offer"}'
    });

    assert.equal(body.get(FORM_FIELDS.peer), 'peer-a');
    assert.equal(body.get(FORM_FIELDS.kind), 'offer');
    assert.equal(body.get(FORM_FIELDS.target), 'peer-b');
    assert.equal(body.get(FORM_FIELDS.payload), '{"type":"offer"}');
  });
});

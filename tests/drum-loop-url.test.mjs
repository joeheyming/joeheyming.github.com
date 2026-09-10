import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeDrumLoop, encodeDrumLoop, withLoopToken } from '../play/drums/loop-url.js';
import { LoopTrack } from '../play/shared/loop-track.js';

test('drum loops round-trip through a URL-safe token', () => {
  const loop = {
    loopLength: 2400,
    kit: 'tr-808',
    events: [
      { time: 0, id: 'kick' },
      { time: 600, id: 'closed-hat' },
      { time: 1200, id: 'snare' }
    ]
  };

  const token = encodeDrumLoop(loop);

  assert.match(token, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeDrumLoop(token), loop);
});

test('invalid or tampered drum loop tokens are ignored', () => {
  assert.equal(decodeDrumLoop(''), null);
  assert.equal(decodeDrumLoop('not-valid-base64-json'), null);
  assert.throws(
    () =>
      encodeDrumLoop({
        loopLength: 2400,
        kit: 'linndrum',
        events: [{ time: 10, id: 'unknown-pad' }]
      }),
    /invalid drum hit/
  );
});

test('withLoopToken puts the loop in the address bar the Share button copies', () => {
  const base = 'https://joeheyming.github.io/play/drums/?shared=1&utm_source=joeheyming';
  const token = encodeDrumLoop({
    loopLength: 1000,
    kit: 'linndrum',
    events: [{ time: 0, id: 'kick' }]
  });

  const shared = new URL(withLoopToken(base, token));
  assert.equal(shared.searchParams.get('loop'), token);
  assert.equal(shared.searchParams.get('shared'), '1');
  assert.equal(shared.searchParams.get('utm_source'), 'joeheyming');

  const cleared = new URL(withLoopToken(shared.toString(), null));
  assert.equal(cleared.searchParams.has('loop'), false);
  assert.equal(cleared.searchParams.get('shared'), '1');
});

test('LoopTrack can load a shared loop without starting playback', () => {
  const events = [{ time: 0, id: 'kick' }];
  const track = new LoopTrack({ onPlay() {} });

  track.load(events, 1000);
  events[0].id = 'snare';

  assert.equal(track.state, 'idle');
  assert.equal(track.hasLoop(), true);
  assert.deepEqual(track.events, [{ time: 0, id: 'kick' }]);
  assert.equal(track.loopLength, 1000);
});

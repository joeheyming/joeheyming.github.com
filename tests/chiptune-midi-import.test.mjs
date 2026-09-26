import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { midiToPayload, MidiImportError } from '../play/chiptune/midi-import.js';

describe('midiToPayload', () => {
  it('places an on-grid quarter note and pads the pattern to a full bar', () => {
    const mid = smf({
      tempo: 120,
      tracks: [track([program(0, 81), note(0, 60, 480, 100)])]
    });
    const { payload, voices, warnings } = midiToPayload(mid);
    assert.equal(payload.t, 120);
    assert.equal(payload.s, 16);
    assert.deepEqual(payload.p[0].t[0], [[60, 0, 4]]);
    assert.equal(payload.p[0].t[1].length, 0);
    assert.equal(voices[0].wave, 'saw');
    assert.equal(voices[0].waveSource, 'gm');
    assert.equal(payload.c[0][1], Math.round((100 / 127) * 100));
    assert.match(warnings[0], /padded to 16/);
  });

  it('rejects a note-on that is halfway between 16ths', () => {
    const mid = smf({
      tempo: 120,
      tracks: [track([note(60, 60, 120, 100)])]
    });
    assert.throws(
      () => midiToPayload(mid),
      (err) => {
        assert.ok(err instanceof MidiImportError);
        assert.equal(err.code, 'grid');
        return true;
      }
    );
  });

  it('snaps a note-on that is only a few ticks off the grid', () => {
    const mid = smf({
      tempo: 120,
      tracks: [track([note(4, 60, 120, 100)])]
    });
    const { payload } = midiToPayload(mid);
    assert.deepEqual(payload.p[0].t[0], [[60, 0, 1]]);
  });

  it('splits a song longer than the grid into one-bar patterns', () => {
    const step = 120;
    const late = 256 * step;
    const mid = smf({
      tempo: 100,
      tracks: [track([note(0, 60, step, 100), note(late - step, 62, step, 100)])]
    });
    const { payload } = midiToPayload(mid);
    assert.equal(payload.s, 16);
    assert.equal(payload.a.length, 17);
    assert.deepEqual(payload.p[0].t[0], [[60, 0, 1]]);
    const last = payload.p[payload.a[16]];
    assert.deepEqual(last.t[0], [[62, 0, 1]]);
  });

  it('does not invent a wave for a program the General MIDI name does not specify', () => {
    const mid = smf({
      tempo: 100,
      tracks: [track([program(0, 38), note(0, 48, 480, 110)])]
    });
    const { voices } = midiToPayload(mid);
    assert.equal(voices[0].wave, 'square');
    assert.equal(voices[0].waveSource, 'default');
    const overridden = midiToPayload(mid, { waves: { 38: 'triangle' } });
    assert.equal(overridden.voices[0].wave, 'triangle');
    assert.equal(overridden.voices[0].waveSource, 'override');
  });

  it('converts the Funkytown MIDI into the committed example', () => {
    const mid = readFileSync(new URL('../play/chiptune/examples/funkytown.mid', import.meta.url));
    const saved = JSON.parse(
      readFileSync(new URL('../play/chiptune/examples/funkytown.json', import.meta.url), 'utf8')
    );
    const { payload } = midiToPayload(mid);
    assert.deepEqual(payload, saved);
    assert.equal(payload.t, 120);
    assert.equal(payload.s % 16, 0);
    assert.ok(payload.s <= 256);
    assert.ok(payload.a.length > 1);
    for (const pattern of payload.p) {
      for (const track of pattern.t) {
        for (const note of track) {
          assert.ok(note[0] >= 36 && note[0] <= 84);
          assert.ok(note[1] >= 0 && note[1] < payload.s);
          assert.ok(note[2] >= 1 && note[1] + note[2] <= payload.s);
        }
      }
    }
  });
});

/**
 * @param {{ tempo: number, tracks: Uint8Array[] }} spec
 */
function smf(spec) {
  const header = concat([text('MThd'), u32(6), u16(1), u16(spec.tracks.length + 1), u16(480)]);
  const conductor = chunk(
    'MTrk',
    concat([
      vlq(0),
      bytes([0xff, 0x51, 0x03, ...u24(Math.round(60_000_000 / spec.tempo))]),
      vlq(0),
      bytes([0xff, 0x58, 0x04, 4, 2, 24, 8]),
      vlq(0),
      bytes([0xff, 0x2f, 0x00])
    ])
  );
  return concat([header, conductor, ...spec.tracks]);
}

/** @param {Uint8Array[]} events */
function track(events) {
  return chunk('MTrk', concat([...events, bytes([0x00, 0xff, 0x2f, 0x00])]));
}

/**
 * @param {number} channel
 * @param {number} programNumber
 */
function program(channel, programNumber) {
  return bytes([0x00, 0xc0 | channel, programNumber]);
}

/**
 * @param {number} delta
 * @param {number} pitch
 * @param {number} duration
 * @param {number} velocity
 */
function note(delta, pitch, duration, velocity) {
  return concat([
    vlq(delta),
    bytes([0x90, pitch, velocity]),
    vlq(duration),
    bytes([0x80, pitch, 0])
  ]);
}

/** @param {string} type @param {Uint8Array} body */
function chunk(type, body) {
  return concat([text(type), u32(body.length), body]);
}

/** @param {number} n */
function vlq(n) {
  const out = [n & 0x7f];
  let value = n >> 7;
  while (value > 0) {
    out.push((value & 0x7f) | 0x80);
    value >>= 7;
  }
  return bytes(out.reverse());
}

/** @param {number[]} list */
function bytes(list) {
  return Uint8Array.from(list);
}

/** @param {string} value */
function text(value) {
  return Uint8Array.from(value, (ch) => ch.charCodeAt(0));
}

/** @param {number} n */
function u16(n) {
  return bytes([(n >> 8) & 0xff, n & 0xff]);
}

/** @param {number} n */
function u24(n) {
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** @param {number} n */
function u32(n) {
  return bytes([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

/** @param {Uint8Array[]} parts */
function concat(parts) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

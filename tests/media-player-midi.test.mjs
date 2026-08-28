import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  fileLooksLikeSequence,
  sniffSequenceKind,
  prepareMidiBytes,
  smafToMidi,
  estimateMidiDurationSec,
  smafHuffmanInflate,
  midiProgressFromTicks,
  midiTickFromProgress
} from '../media-player/midi-sequence.js';

function u32be(n) {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
}

function chunk(idBytes, body) {
  return [...idBytes, ...u32be(body.length), ...body];
}

function wrapSmaf(inner) {
  const payload = inner.flat();
  return Uint8Array.from([...[0x4d, 0x4d, 0x4d, 0x44], ...u32be(payload.length), ...payload]);
}

/** HandyPhone C4 (MIDI 60), 100 ms gate, 1 ms timebase. */
function handyphoneSmaf() {
  const seq = [0x00, 0x20, 100, 0x00, 0x00, 0x00, 0x00];
  const mtsq = chunk([0x4d, 0x74, 0x73, 0x71], seq);
  const trackBody = [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, ...mtsq];
  const mtr = chunk([0x4d, 0x54, 0x52, 0x00], trackBody);
  return wrapSmaf(mtr);
}

/** Mobile Standard note-on 60 vel 100, 50 ms gate. */
function mobileSmaf() {
  const seq = [0x00, 0x90, 60, 100, 50, 0x00, 0xff, 0x2f];
  const mtsq = chunk([0x4d, 0x74, 0x73, 0x71], seq);
  const header = [0x02, 0x00, 0x00, 0x00, ...new Array(16).fill(0)];
  const mtr = chunk([0x4d, 0x54, 0x52, 0x00], [...header, ...mtsq]);
  return wrapSmaf(mtr);
}

/** Format-0 SMF: note 60 for 200 ticks at 500 TPQ / 500000 µs → 0.2 s. */
function oneNoteMidi() {
  const tempo = [0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20];
  const on = [0x00, 0x90, 0x3c, 0x40];
  const off = [0x81, 0x48, 0x80, 0x3c, 0x40]; // delta 200
  const eot = [0x00, 0xff, 0x2f, 0x00];
  const track = [...tempo, ...on, ...off, ...eot];
  return Uint8Array.from([
    0x4d,
    0x54,
    0x68,
    0x64,
    0x00,
    0x00,
    0x00,
    0x06,
    0x00,
    0x00,
    0x00,
    0x01,
    0x01,
    0xf4,
    0x4d,
    0x54,
    0x72,
    0x6b,
    ...u32be(track.length),
    ...track
  ]);
}

function hasNote(midi, note) {
  for (let i = 0; i < midi.length - 2; i++) {
    if ((midi[i] & 0xf0) === 0x90 && midi[i + 1] === note && midi[i + 2] > 0) return true;
  }
  return false;
}

describe('fileLooksLikeSequence', () => {
  it('matches MIDI/MMF extensions and MIME types', () => {
    assert.equal(fileLooksLikeSequence('song.mid', ''), true);
    assert.equal(fileLooksLikeSequence('ring.MMF', 'application/octet-stream'), true);
    assert.equal(fileLooksLikeSequence('x.bin', 'audio/midi'), true);
    assert.equal(fileLooksLikeSequence('clip.mp3', 'audio/mpeg'), false);
  });
});

describe('sniffSequenceKind', () => {
  it('detects SMF and SMAF magics', () => {
    assert.equal(sniffSequenceKind(oneNoteMidi()), 'midi');
    assert.equal(sniffSequenceKind(handyphoneSmaf()), 'smaf');
    assert.equal(sniffSequenceKind(new Uint8Array([0, 1, 2, 3])), null);
  });
});

describe('estimateMidiDurationSec', () => {
  it('reads tempo and ticks from a one-note SMF', () => {
    const sec = estimateMidiDurationSec(oneNoteMidi());
    assert.ok(Math.abs(sec - 0.2) < 0.02, `duration ${sec}`);
  });
});

describe('prepareMidiBytes', () => {
  it('passes SMF through', () => {
    const midi = oneNoteMidi();
    const out = prepareMidiBytes(midi, { fileName: 'a.mid' });
    assert.equal(out.kind, 'midi');
    assert.equal(out.midi[0], 0x4d);
    assert.ok(out.durationSec > 0);
  });

  it('converts HandyPhone MMF to SMF with MIDI note 60', () => {
    const out = prepareMidiBytes(handyphoneSmaf(), { fileName: 'ring.mmf' });
    assert.equal(out.kind, 'smaf');
    assert.equal(sniffSequenceKind(out.midi), 'midi');
    assert.equal(hasNote(out.midi, 60), true);
    assert.ok(out.durationSec > 0.05);
  });

  it('converts Mobile Standard MMF notes', () => {
    const midi = smafToMidi(mobileSmaf()).midi;
    assert.equal(hasNote(midi, 60), true);
  });

  it('throws on empty SMAF', () => {
    const empty = wrapSmaf(chunk([0x4d, 0x54, 0x52, 0x00], [0, 0, 0, 0, 0, 0]));
    assert.throws(() => smafToMidi(empty), /playable score|notes/i);
  });
});

describe('smafHuffmanInflate', () => {
  it('rejects truncated payloads', () => {
    assert.equal(smafHuffmanInflate(new Uint8Array([0, 0, 0, 1])).length, 0);
  });
});

describe('midi seek mapping', () => {
  it('clamps progress and converts ticks', () => {
    assert.equal(midiProgressFromTicks(0, 0), 0);
    assert.equal(midiProgressFromTicks(50, 100), 0.5);
    assert.equal(midiProgressFromTicks(200, 100), 1);
    assert.equal(midiTickFromProgress(1000, 0.25), 250);
    assert.equal(midiTickFromProgress(1000, -1), 0);
    assert.equal(midiTickFromProgress(1000, 2), 1000);
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DwpParseError, findZoneForNote, parseDwp } from '../play/sampler/dwp-parser.js';

const MAGIC = new TextEncoder().encode('DwPr&');

function chunk(id, payload) {
  const bytes = new Uint8Array(12 + payload.byteLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, id, true);
  view.setUint32(4, payload.byteLength, true);
  view.setUint32(8, 0, true);
  bytes.set(payload, 12);
  return bytes;
}

function concat(parts) {
  const bytes = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}

function floatPcm(frameCount, value = 0.125) {
  const bytes = new Uint8Array(frameCount * 4);
  const view = new DataView(bytes.buffer);
  for (let frame = 0; frame < frameCount; frame += 1) {
    view.setFloat32(frame * 4, value, true);
  }
  return bytes;
}

function zoneChunks({
  name,
  rootKey,
  keyLow,
  keyHigh,
  velocityLow = 0,
  velocityHigh = 127,
  frameCount = 8,
  sampleBytes = floatPcm(frameCount)
}) {
  const mapping = new Uint8Array(25);
  mapping.set([rootKey, keyLow, keyHigh, velocityLow, velocityHigh]);

  const info = new Uint8Array(40);
  const infoView = new DataView(info.buffer);
  infoView.setUint32(0, frameCount, true);
  infoView.setUint32(8, 1, true);
  infoView.setFloat32(16, 48000, true);
  infoView.setUint32(24, 1, true);
  infoView.setUint32(28, Math.max(2, frameCount - 1), true);
  infoView.setUint32(36, 32, true);

  const text = new TextEncoder();
  return [
    chunk(0x1f4, mapping),
    chunk(0x1f5, text.encode(name)),
    chunk(0x1f6, text.encode(`C:\\Users\\Private\\Samples\\${name}.wav`)),
    chunk(0x1f7, info),
    chunk(0x205, sampleBytes)
  ];
}

function fixture(zones) {
  const bytes = new Uint8Array(0x90);
  bytes.set(MAGIC);
  const name = new TextEncoder().encode('Synthetic DirectWave');
  bytes[0x5e] = name.length;
  bytes.set(name, 0x66);
  return concat([bytes, ...zones.flatMap(zoneChunks)]);
}

describe('parseDwp modern monolithic chunks', () => {
  it('parses program metadata, mappings, loops, and embedded float PCM', () => {
    const parsed = parseDwp(
      fixture([
        { name: 'Low', rootKey: 48, keyLow: 0, keyHigh: 59 },
        { name: 'High', rootKey: 60, keyLow: 60, keyHigh: 127, velocityLow: 20 }
      ])
    );

    assert.equal(parsed.name, 'Synthetic DirectWave');
    assert.equal(parsed.format, 'directwave-monolithic');
    assert.equal(parsed.zones.length, 2);
    assert.equal(parsed.keyLow, 0);
    assert.equal(parsed.keyHigh, 127);
    assert.equal(parsed.zones[0].sampleFile, 'Low.wav');
    assert.equal(parsed.zones[0].sampleBytes.byteLength, 32);
    assert.deepEqual(parsed.zones[0].loop, { start: 1, end: 7 });
    assert.equal(parsed.zones[1].velocityLow, 20);
  });

  it('selects a matching key and velocity zone', () => {
    const parsed = parseDwp(
      fixture([
        { name: 'Soft', rootKey: 60, keyLow: 48, keyHigh: 72, velocityHigh: 63 },
        {
          name: 'Loud',
          rootKey: 60,
          keyLow: 48,
          keyHigh: 72,
          velocityLow: 64,
          velocityHigh: 127
        }
      ])
    );

    assert.equal(findZoneForNote(parsed, 60, 40)?.name, 'Soft');
    assert.equal(findZoneForNote(parsed, 60, 100)?.name, 'Loud');
    assert.equal(findZoneForNote(parsed, 12, 100), null);
  });

  it('rejects unrelated files by magic bytes', () => {
    assert.throws(() => parseDwp(new TextEncoder().encode('RIFF-not-a-DWP')), DwpParseError);
    assert.throws(() => parseDwp(new Uint8Array()), DwpParseError);
  });

  it('rejects inverted zone bounds', () => {
    const bytes = fixture([{ name: 'Bad', rootKey: 60, keyLow: 70, keyHigh: 50 }]);
    assert.throws(() => parseDwp(bytes), DwpParseError);
  });

  it('rejects truncated embedded audio', () => {
    const bytes = fixture([
      {
        name: 'Short',
        rootKey: 60,
        keyLow: 0,
        keyHigh: 127,
        frameCount: 100,
        sampleBytes: floatPcm(2)
      }
    ]);
    assert.throws(
      () => parseDwp(bytes),
      (error) => {
        assert.ok(error instanceof DwpParseError);
        assert.equal(error.code, 'TRUNCATED');
        return true;
      }
    );
  });

  it('reports standard presets without embedded samples as unsupported', () => {
    const complete = fixture([{ name: 'External', rootKey: 60, keyLow: 0, keyHigh: 127 }]);
    const marker = new Uint8Array([0x05, 0x02, 0x00, 0x00]);
    let sampleChunk = -1;
    for (let offset = 0; offset <= complete.length - marker.length; offset += 1) {
      if (marker.every((value, index) => complete[offset + index] === value)) {
        sampleChunk = offset;
        break;
      }
    }
    assert.ok(sampleChunk > 0);
    const withoutSample = complete.slice(0, sampleChunk);

    assert.throws(
      () => parseDwp(withoutSample),
      (error) => {
        assert.ok(error instanceof DwpParseError);
        assert.equal(error.code, 'EXTERNAL_SAMPLES');
        return true;
      }
    );
  });
});

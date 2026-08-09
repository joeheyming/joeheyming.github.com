import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isWindowsPeExecutable } from '../dos/repack.js';

function buildMzStub(peOffset) {
  const buf = new Uint8Array(Math.max(peOffset + 4, 0x40));
  buf[0] = 0x4d; // M
  buf[1] = 0x5a; // Z
  buf[0x3c] = peOffset & 0xff;
  buf[0x3d] = (peOffset >> 8) & 0xff;
  buf[0x3e] = (peOffset >> 16) & 0xff;
  buf[0x3f] = (peOffset >> 24) & 0xff;
  return buf;
}

describe('isWindowsPeExecutable', () => {
  it('returns false for empty / tiny buffers', () => {
    assert.equal(isWindowsPeExecutable(new Uint8Array(0)), false);
    assert.equal(isWindowsPeExecutable(new Uint8Array(16)), false);
  });

  it('returns false for classic DOS MZ without a PE signature', () => {
    const dos = buildMzStub(0x100);
    // leave bytes at 0x100 as zeros — not PE\0\0
    assert.equal(isWindowsPeExecutable(dos), false);
  });

  it('returns true for MZ + PE\\0\\0 at e_lfanew', () => {
    const pe = buildMzStub(0x80);
    pe[0x80] = 0x50; // P
    pe[0x81] = 0x45; // E
    pe[0x82] = 0x00;
    pe[0x83] = 0x00;
    assert.equal(isWindowsPeExecutable(pe), true);
  });

  it('returns false when PE offset is out of range', () => {
    const bad = buildMzStub(0x10); // offset too small / overlapping
    bad[0x10] = 0x50;
    bad[0x11] = 0x45;
    // peOffset 0x10 is < 0x40 → reject
    assert.equal(isWindowsPeExecutable(bad), false);
  });
});

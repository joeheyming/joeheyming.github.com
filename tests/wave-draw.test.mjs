import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  TABLE_SIZE,
  fillPreset,
  paintLine,
  samplesToFourier,
  shortestSampleDelta
} from '../play/wave-draw/wave-table.js';

describe('fillPreset', () => {
  it('builds a sine whose DFT is concentrated on the fundamental', () => {
    const samples = fillPreset('sine');
    assert.equal(samples.length, TABLE_SIZE);
    const { real, imag } = samplesToFourier(samples);
    assert.ok(Math.abs(real[0]) < 1e-6);
    assert.ok(Math.abs(real[1]) < 1e-6);
    assert.ok(Math.abs(imag[1] + 0.5) < 1e-6);
    let other = 0;
    for (let k = 2; k < real.length; k++) other += Math.abs(real[k]) + Math.abs(imag[k]);
    assert.ok(other < 1e-5);
  });

  it('fills square, saw, triangle, and clear', () => {
    assert.equal(fillPreset('square')[0], 1);
    assert.equal(fillPreset('square')[TABLE_SIZE - 1], -1);
    assert.ok(fillPreset('saw')[TABLE_SIZE - 1] > 0.9);
    assert.ok(Math.abs(fillPreset('triangle')[0] + 1) < 1e-9);
    assert.ok(fillPreset('clear').every((v) => v === 0));
  });
});

describe('paintLine wrap', () => {
  it('wraps across the table seam with shortestSampleDelta', () => {
    assert.equal(shortestSampleDelta(250, 5, 256), 11);
    const samples = fillPreset('clear');
    paintLine(samples, 250 / 255, 0.5, 5 / 255, -0.5);
    assert.ok(samples[250] > 0.4);
    assert.ok(samples[5] < -0.4);
    const midWrap = samples[0];
    assert.ok(Math.abs(midWrap) < 0.6);
  });
});

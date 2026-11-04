import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { stageScale } from '../js/canvasManager.js';

describe('stageScale', () => {
  it('never shrinks the field below its native size', () => {
    assert.equal(stageScale(200, 150), 1);
  });

  it('is limited by height so the field keeps its visible beats', () => {
    assert.equal(stageScale(1600, 720), 1.5);
  });

  it('is limited by width on a narrow, tall stage', () => {
    assert.equal(stageScale(480, 2000), 1.5);
  });

  it('caps magnification on very large stages', () => {
    assert.equal(stageScale(4000, 4000), 2.5);
  });

  it('falls back to native size for unmeasurable stages', () => {
    assert.equal(stageScale(Number.NaN, 600), 1);
  });
});

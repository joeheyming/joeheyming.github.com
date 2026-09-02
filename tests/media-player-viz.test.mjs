import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  VIZ_MODES,
  VIZ_MODE_LABELS,
  clampVizSize,
  drawVisualizer,
  nextVizMode,
  normalizeVizMode,
  vizScale
} from '../media-player/visualizer.js';

function mockCtx() {
  /** @type {string[]} */
  const calls = [];
  /** @type {number[]} */
  const strokeWidths = [];
  return {
    calls,
    strokeWidths,
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineJoin: '',
    lineCap: '',
    clearRect(...args) {
      calls.push(`clearRect:${args.join(',')}`);
    },
    createLinearGradient() {
      return { addColorStop() {} };
    },
    fillRect(...args) {
      calls.push(`fillRect:${args.map((n) => Math.round(n)).join(',')}`);
    },
    setTransform() {},
    beginPath() {
      calls.push('beginPath');
    },
    moveTo() {
      calls.push('moveTo');
    },
    lineTo() {
      calls.push('lineTo');
    },
    stroke() {
      calls.push('stroke');
      strokeWidths.push(this.lineWidth);
    }
  };
}

function sampleFreq() {
  const freq = new Uint8Array(32);
  freq[0] = 255;
  freq[1] = 128;
  return freq;
}

function sampleTime() {
  const time = new Uint8Array(8);
  for (let i = 0; i < 8; i++) time[i] = i * 32;
  return time;
}

const colors = { barTop: '#00f', barBottom: '#f00', line: '#0f0' };

describe('normalizeVizMode', () => {
  it('accepts known modes and defaults to both', () => {
    assert.deepEqual(VIZ_MODES, ['both', 'bars', 'line', 'mirror', 'radial']);
    assert.equal(normalizeVizMode('bars'), 'bars');
    assert.equal(normalizeVizMode('nope'), 'both');
  });
});

describe('nextVizMode', () => {
  it('cycles through every mode and wraps', () => {
    let mode = 'both';
    const seen = [];
    for (let i = 0; i < VIZ_MODES.length; i++) {
      mode = nextVizMode(mode);
      seen.push(mode);
    }
    assert.deepEqual(seen.slice(0, -1), VIZ_MODES.slice(1));
    assert.equal(mode, 'both');
    assert.equal(nextVizMode('bogus'), 'bars');
  });

  it('labels every mode', () => {
    for (const m of VIZ_MODES) assert.equal(typeof VIZ_MODE_LABELS[m], 'string');
  });
});

describe('clampVizSize', () => {
  it('enforces min and max height', () => {
    assert.equal(clampVizSize(10, 10).width, 220);
    assert.equal(clampVizSize(10, 10).height, 80);
    assert.equal(clampVizSize(400, 900).height, 720);
  });

  it('falls back to a roomy default when the height is unusable', () => {
    assert.equal(clampVizSize(600, 'nope').height, 240);
  });
});

describe('vizScale', () => {
  it('grows with the box and stays clamped', () => {
    assert.equal(vizScale(520, 140), 1);
    assert.ok(vizScale(1040, 280) > 1.9);
    assert.equal(vizScale(10, 10), 0.5);
    assert.equal(vizScale(100000, 100000), 4);
  });
});

describe('drawVisualizer', () => {
  it('thickens the wave stroke as the canvas grows', () => {
    const small = mockCtx();
    const large = mockCtx();
    const args = { mode: 'line', freq: sampleFreq(), time: sampleTime(), ...colors };
    drawVisualizer(/** @type {CanvasRenderingContext2D} */ (small), {
      ...args,
      width: 520,
      height: 140
    });
    drawVisualizer(/** @type {CanvasRenderingContext2D} */ (large), {
      ...args,
      width: 1040,
      height: 280
    });
    assert.ok(large.strokeWidths[0] > small.strokeWidths[0]);
  });

  it('bars fill rectangles and skip the wave', () => {
    const ctx = mockCtx();
    drawVisualizer(/** @type {CanvasRenderingContext2D} */ (ctx), {
      mode: 'bars',
      freq: sampleFreq(),
      time: sampleTime(),
      width: 200,
      height: 100,
      ...colors
    });
    assert.ok(ctx.calls.some((c) => c.startsWith('fillRect:')));
    assert.equal(ctx.calls.includes('stroke'), false);
  });

  it('line strokes the time-domain path', () => {
    const ctx = mockCtx();
    drawVisualizer(/** @type {CanvasRenderingContext2D} */ (ctx), {
      mode: 'line',
      freq: sampleFreq(),
      time: sampleTime(),
      width: 200,
      height: 100,
      ...colors
    });
    assert.ok(ctx.calls.includes('stroke'));
    assert.equal(ctx.calls.filter((c) => c.startsWith('fillRect:')).length, 0);
  });

  it('radial draws spokes from the center', () => {
    const ctx = mockCtx();
    drawVisualizer(/** @type {CanvasRenderingContext2D} */ (ctx), {
      mode: 'radial',
      freq: sampleFreq(),
      time: sampleTime(),
      width: 200,
      height: 100,
      ...colors
    });
    assert.ok(ctx.calls.filter((c) => c === 'stroke').length > 1);
  });
});

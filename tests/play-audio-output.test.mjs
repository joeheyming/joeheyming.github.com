// Gain staging and iOS audio-session handling in play/shared/audio.js.
//
// The module reads `window` once at import time to decide the touch boost, so
// each case imports it under a fresh query string to get a fresh instance.
import assert from 'node:assert/strict';
import { test } from 'node:test';

class FakeParam {
  constructor(value) {
    this.value = value;
  }
  cancelScheduledValues() {}
  setTargetAtTime(value) {
    this.value = value;
  }
}

class FakeNode {
  constructor(kind) {
    this.kind = kind;
    this.connections = [];
  }
  connect(dest) {
    this.connections.push(dest);
    return dest;
  }
  disconnect() {}
}

class FakeGain extends FakeNode {
  constructor() {
    super('gain');
    this.gain = new FakeParam(1);
  }
}

class FakeCompressor extends FakeNode {
  constructor() {
    super('compressor');
    this.threshold = new FakeParam(0);
    this.knee = new FakeParam(0);
    this.ratio = new FakeParam(1);
    this.attack = new FakeParam(0);
    this.release = new FakeParam(0);
  }
}

class FakeAudioContext {
  constructor({ compressor = true } = {}) {
    this.state = 'running';
    this.currentTime = 0;
    this.sampleRate = 44100;
    this.destination = new FakeNode('destination');
    this.supportsCompressor = compressor;
  }
  createGain() {
    return new FakeGain();
  }
  createDynamicsCompressor() {
    if (!this.supportsCompressor) throw new Error('unsupported');
    return new FakeCompressor();
  }
  createBufferSource() {
    return { buffer: null, connect() {}, start() {} };
  }
  createBuffer() {
    return {};
  }
  resume() {
    return Promise.resolve();
  }
}

let caseId = 0;

async function loadAudio({
  coarse = false,
  maxTouchPoints = 0,
  audioSession,
  compressor = true
} = {}) {
  const ctorArgs = { compressor };
  globalThis.window = {
    AudioContext: class extends FakeAudioContext {
      constructor() {
        super(ctorArgs);
      }
    },
    matchMedia: (query) => ({ matches: coarse && query.includes('coarse') }),
    addEventListener() {},
    removeEventListener() {}
  };
  Object.defineProperty(globalThis, 'navigator', {
    value: { maxTouchPoints, audioSession },
    configurable: true,
    writable: true
  });
  caseId += 1;
  return import(`../play/shared/audio.js?case=${caseId}`);
}

const BOOST = 1.6;

test('touch devices get the output boost, desktop stays at unity', async () => {
  const touch = await loadAudio({ coarse: true });
  touch.getCtx();
  assert.equal(touch.getMaster().gain.value, 0.65 * BOOST);
  touch.setMasterVolume(1);
  assert.equal(touch.getMaster().gain.value, BOOST);

  const desktop = await loadAudio({ coarse: false });
  desktop.getCtx();
  assert.equal(desktop.getMaster().gain.value, 0.65);
  desktop.setMasterVolume(1);
  assert.equal(desktop.getMaster().gain.value, 1);
});

test('maxTouchPoints alone is enough to boost (UA-side backstop)', async () => {
  const audio = await loadAudio({ coarse: false, maxTouchPoints: 5 });
  audio.setMasterVolume(0.5);
  audio.getCtx();
  assert.equal(audio.getMaster().gain.value, 0.5 * BOOST);
});

test('master feeds a peak limiter ahead of the destination', async () => {
  const audio = await loadAudio({ coarse: true });
  const ctx = audio.getCtx();
  const [limiter] = audio.getMaster().connections;
  assert.equal(limiter.kind, 'compressor');
  assert.equal(limiter.threshold.value, -1);
  assert.equal(limiter.ratio.value, 20);
  assert.deepEqual(limiter.connections, [ctx.destination]);
});

test('falls back to the destination when the engine has no compressor', async () => {
  const audio = await loadAudio({ coarse: true, compressor: false });
  const ctx = audio.getCtx();
  assert.deepEqual(audio.getMaster().connections, [ctx.destination]);
});

test('claims the playback audio session so the ringer switch cannot mute output', async () => {
  const session = { type: 'auto' };
  const audio = await loadAudio({ coarse: true, audioSession: session });
  audio.getCtx();
  assert.equal(session.type, 'playback');
});

test('audio capture releases the session and reclaims it once every capture ends', async () => {
  const session = { type: 'auto' };
  const audio = await loadAudio({ coarse: true, audioSession: session });
  audio.getCtx();

  audio.beginAudioCapture();
  assert.equal(session.type, 'auto', 'playback rejects getUserMedia({ audio })');

  audio.beginAudioCapture();
  audio.endAudioCapture();
  assert.equal(session.type, 'auto', 'a second capture is still live');

  audio.endAudioCapture();
  assert.equal(session.type, 'playback');
});

test('a capture claimed before the context is built survives getCtx', async () => {
  const session = { type: 'auto' };
  const audio = await loadAudio({ coarse: true, audioSession: session });
  audio.beginAudioCapture();
  audio.getCtx();
  assert.equal(session.type, 'auto');
});

test('engines without navigator.audioSession are left alone', async () => {
  const audio = await loadAudio({ coarse: true, audioSession: undefined });
  audio.getCtx();
  audio.beginAudioCapture();
  audio.endAudioCapture();
  assert.equal(globalThis.navigator.audioSession, undefined);
});

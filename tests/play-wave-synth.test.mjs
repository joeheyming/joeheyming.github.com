// Audition voice for drawing on the /play/wave-draw/ wavetable.
//
// The drawn table makes no sound on its own — it is only audible through a
// voice — so a canvas gesture holds one for its duration. It must not collide
// with keys the player is holding at the same time.
import assert from 'node:assert/strict';
import { test } from 'node:test';

class FakeParam {
  constructor(value) {
    this.value = value;
  }
  setValueAtTime(value) {
    this.value = value;
    return this;
  }
  linearRampToValueAtTime(value) {
    this.value = value;
    return this;
  }
  exponentialRampToValueAtTime(value) {
    this.target = value;
    return this;
  }
  cancelScheduledValues() {
    return this;
  }
}

class FakeOscillator {
  constructor() {
    this.frequency = new FakeParam(440);
    this.wave = null;
    this.started = false;
    this.stoppedAt = null;
  }
  setPeriodicWave(wave) {
    this.wave = wave;
  }
  connect(dest) {
    return dest;
  }
  start() {
    this.started = true;
  }
  stop(when) {
    this.stoppedAt = when;
  }
}

class FakeAudioContext {
  constructor() {
    this.state = 'running';
    this.currentTime = 0;
    this.sampleRate = 44100;
    this.destination = { connect: () => {} };
    this.oscillators = [];
    this.waves = 0;
  }
  createGain() {
    return { gain: new FakeParam(1), connect: (dest) => dest, disconnect() {} };
  }
  createOscillator() {
    const osc = new FakeOscillator();
    this.oscillators.push(osc);
    return osc;
  }
  createPeriodicWave() {
    this.waves += 1;
    return { id: this.waves };
  }
  createDynamicsCompressor() {
    const param = () => new FakeParam(0);
    return {
      threshold: param(),
      knee: param(),
      ratio: param(),
      attack: param(),
      release: param(),
      connect: (dest) => dest
    };
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

async function loadSynth() {
  globalThis.window = {
    AudioContext: FakeAudioContext,
    matchMedia: () => ({ matches: false }),
    addEventListener() {},
    removeEventListener() {}
  };
  Object.defineProperty(globalThis, 'navigator', {
    value: { maxTouchPoints: 0 },
    configurable: true,
    writable: true
  });
  caseId += 1;
  const mod = await import(`../play/wave-draw/wave-synth.js?case=${caseId}`);
  return new mod.WavetableSynth();
}

test('a canvas gesture sounds a tone and releases it on gesture end', async () => {
  const synth = await loadSynth();
  synth.auditionOn(60);
  assert.ok(synth.audition, 'gesture holds a voice');
  assert.equal(synth.audition.osc.started, true);

  const { osc } = synth.audition;
  synth.auditionOff();
  assert.equal(synth.audition, null);
  assert.ok(osc.stoppedAt > 0, 'the tone is scheduled to stop');
});

test('the audition sits under a played note', async () => {
  const synth = await loadSynth();
  synth.auditionOn(60);
  synth.noteOn(60);
  assert.ok(
    synth.audition.amp.gain.value < synth.voices.get(60).amp.gain.value,
    'drawing should not drown out playing'
  );
});

test('drawing while holding a key leaves the held note alone', async () => {
  const synth = await loadSynth();
  synth.noteOn(60);
  const held = synth.voices.get(60);

  synth.auditionOn(60);
  synth.auditionOff();

  assert.equal(synth.voices.get(60), held, 'the held voice is untouched');
  assert.equal(held.osc.stoppedAt, null, 'and is still sounding');
});

test('a second gesture does not stack another tone', async () => {
  const synth = await loadSynth();
  synth.auditionOn(60);
  const first = synth.audition;
  synth.auditionOn(67);
  assert.equal(synth.audition, first);
});

test('edits during a gesture are pushed into the audition and held notes', async () => {
  const synth = await loadSynth();
  synth.noteOn(60);
  synth.auditionOn(60);
  const heldOsc = synth.voices.get(60).osc;
  const auditionOsc = synth.audition.osc;
  const before = auditionOsc.wave;

  synth.samples[10] = -1;
  synth.rebuildWave();

  assert.notEqual(auditionOsc.wave, before, 'the audition follows the edit');
  assert.equal(heldOsc.wave, auditionOsc.wave, 'so does the held note');
});

test('allOff stops the audition too, so a blur cannot leave it droning', async () => {
  const synth = await loadSynth();
  synth.noteOn(60);
  synth.auditionOn(60);
  synth.allOff();
  assert.equal(synth.audition, null);
  assert.equal(synth.voices.size, 0);
});

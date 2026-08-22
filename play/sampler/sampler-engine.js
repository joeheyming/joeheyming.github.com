import { getCtx, getMaster } from '../shared/audio.js';
import { findZoneForNote } from './dwp-parser.js';

function copyFloatPcm(ctx, zone) {
  const buffer = ctx.createBuffer(zone.channels, zone.frameCount, zone.sampleRate);
  const view = new DataView(
    zone.sampleBytes.buffer,
    zone.sampleBytes.byteOffset,
    zone.sampleBytes.byteLength
  );

  for (let channel = 0; channel < zone.channels; channel += 1) {
    const output = buffer.getChannelData(channel);
    for (let frame = 0; frame < zone.frameCount; frame += 1) {
      const sampleIndex = frame * zone.channels + channel;
      output[frame] = view.getFloat32(sampleIndex * 4, true);
    }
  }
  return buffer;
}

function generatedSample(ctx, zone) {
  const sampleRate = ctx.sampleRate;
  const duration = zone.generator === 'warm-pad' ? 3 : 1.8;
  const frameCount = Math.floor(sampleRate * duration);
  const buffer = ctx.createBuffer(1, frameCount, sampleRate);
  const output = buffer.getChannelData(0);
  const frequency = 440 * 2 ** ((zone.rootKey - 69) / 12);

  for (let frame = 0; frame < frameCount; frame += 1) {
    const t = frame / sampleRate;
    let value;
    if (zone.generator === 'glass-bell') {
      value =
        (Math.sin(2 * Math.PI * frequency * t) * 0.58 +
          Math.sin(2 * Math.PI * frequency * 2.71 * t) * 0.27 +
          Math.sin(2 * Math.PI * frequency * 4.13 * t) * 0.15) *
        Math.exp(-3.2 * t);
    } else if (zone.generator === 'pluck') {
      value =
        (Math.sin(2 * Math.PI * frequency * t) * 0.72 +
          Math.sin(2 * Math.PI * frequency * 2 * t) * 0.2 +
          Math.sin(2 * Math.PI * frequency * 3 * t) * 0.08) *
        Math.exp(-5.5 * t);
    } else {
      const fadeIn = Math.min(1, t / 0.08);
      const fadeOut = Math.min(1, (duration - t) / 0.25);
      value =
        (Math.sin(2 * Math.PI * frequency * t) * 0.72 +
          Math.sin(2 * Math.PI * frequency * 2 * t) * 0.18 +
          Math.sin(2 * Math.PI * frequency * 0.5 * t) * 0.1) *
        fadeIn *
        fadeOut *
        0.75;
    }
    output[frame] = value;
  }
  return buffer;
}

export class SamplerEngine {
  constructor() {
    this.program = null;
    this.buffers = new Map();
    this.activeNotes = new Map();
  }

  async loadProgram(program, onProgress = () => {}) {
    this.allOff();
    this.buffers.clear();
    const ctx = getCtx();

    for (let index = 0; index < program.zones.length; index += 1) {
      const zone = program.zones[index];
      const buffer = zone.generator ? generatedSample(ctx, zone) : copyFloatPcm(ctx, zone);
      this.buffers.set(zone.id, buffer);
      onProgress(index + 1, program.zones.length);
      if (index % 6 === 5) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    this.program = program;
  }

  noteOn(midi, velocityOrOptions = 1) {
    if (!this.program) return false;
    const velocity =
      typeof velocityOrOptions === 'number'
        ? velocityOrOptions
        : Number(velocityOrOptions.velocity ?? velocityOrOptions.gain ?? 1);
    const midiVelocity = Math.max(0, Math.min(127, Math.round(velocity * 127)));
    const zone = findZoneForNote(this.program, midi, midiVelocity);
    if (!zone) return false;
    const buffer = this.buffers.get(zone.id);
    if (!buffer) return false;

    this.noteOff(midi, { release: 0.015 });
    const ctx = getCtx();
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    const now = ctx.currentTime;

    source.buffer = buffer;
    source.playbackRate.value = 2 ** ((midi - zone.rootKey + zone.tuningCents / 100) / 12);
    if (zone.loop) {
      source.loop = true;
      source.loopStart = zone.loop.start / zone.sampleRate;
      source.loopEnd = zone.loop.end / zone.sampleRate;
    }

    const level = Math.max(0.0001, Math.min(1, velocity));
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(level, now + 0.008);
    source.connect(gain);
    gain.connect(getMaster());
    source.start(now);
    this.activeNotes.set(midi, { source, gain });
    source.addEventListener('ended', () => {
      if (this.activeNotes.get(midi)?.source === source) this.activeNotes.delete(midi);
    });
    return true;
  }

  noteOff(midi, { release = 0.18 } = {}) {
    const voice = this.activeNotes.get(midi);
    if (!voice) return;
    this.activeNotes.delete(midi);
    const ctx = getCtx();
    const now = ctx.currentTime;
    try {
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setValueAtTime(Math.max(0.0001, voice.gain.gain.value), now);
      voice.gain.gain.exponentialRampToValueAtTime(0.0001, now + release);
      voice.source.stop(now + release + 0.02);
    } catch {
      voice.source.stop();
    }
  }

  allOff() {
    for (const midi of [...this.activeNotes.keys()]) this.noteOff(midi, { release: 0.02 });
  }
}

/**
 * Standard MIDI File → chiptune payload.
 *
 * Notes, starts, and lengths come only from note-on / note-off pairs.
 * A note-on more than a quarter of a 16th away from the grid is rejected.
 * Closer note-ons snap to the nearest 16th. Note length is the duration
 * rounded to sixteenths, and never shorter than one step.
 * Pitches outside the grid are shifted by octaves until they fit.
 * Channel 9 is General MIDI drums and becomes the noise wave.
 * A song longer than one pattern is split into one-bar patterns.
 * Identical bars are stored once. More than six note tracks keeps the
 * six with the most notes.
 *
 * Waveform is not a MIDI note. General MIDI programs whose name is one of
 * this synth's waves are mapped (80 square, 81 saw). Every other program
 * becomes square unless the caller passes an explicit program→wave override.
 * Channel volume is the average note-on velocity, unless the track sets CC7.
 * Attack and release are the song-model defaults, because MIDI note-on
 * messages do not carry envelopes.
 */

import {
  CHANNEL_COUNT,
  MAX_STEPS,
  PITCH_MAX,
  PITCH_MIN,
  STEPS_PER_BAR,
  createChannel
} from './model.js';

/** GM programs whose instrument name is a waveform this synth can play. */
const GM_WAVE_BY_PROGRAM = {
  80: 'square',
  81: 'saw'
};

const WAVE_IDS = new Set(['square', 'pulse25', 'pulse50', 'triangle', 'saw', 'noise']);

export class MidiImportError extends Error {
  /**
   * @param {string} message
   * @param {string} code
   */
  constructor(message, code) {
    super(message);
    this.name = 'MidiImportError';
    this.code = code;
  }
}

/**
 * @typedef {{
 *   track: number,
 *   channel: number,
 *   program: number | null,
 *   wave: string,
 *   name: string,
 *   waveSource: 'gm' | 'override' | 'default' | 'gm-drums',
 *   notes: number
 * }} VoiceReport
 */

/**
 * @param {Uint8Array} bytes
 * @param {{ waves?: Record<number, string> }} [opts]
 * @returns {{
 *   payload: object,
 *   voices: VoiceReport[],
 *   warnings: string[]
 * }}
 */
export function midiToPayload(bytes, opts = {}) {
  const overrides = normalizeWaves(opts.waves);
  const smf = parseSmf(bytes);
  const ticksPerStep = smf.division / 4;
  if (!Number.isInteger(ticksPerStep) || ticksPerStep < 1) {
    throw new MidiImportError(
      `PPQ ${smf.division} is not divisible by 4, so 16th notes are not an integer tick count`,
      'division'
    );
  }

  const tempo = singleTempo(smf.tempos);
  const warnings = [];
  if (!smf.timeSignatures.length) {
    warnings.push('No time signature in the file. Pattern length is still counted in 4/4 bars.');
  }

  /** @type {Map<string, Voice>} */
  const voices = new Map();
  for (let trackIndex = 0; trackIndex < smf.tracks.length; trackIndex++) {
    absorbTrack(
      voices,
      trackIndex,
      smf.tracks[trackIndex],
      ticksPerStep,
      smf.names[trackIndex] || ''
    );
  }

  let ordered = [...voices.values()].filter((voice) => voice.notes.length);
  if (!ordered.length) {
    throw new MidiImportError('MIDI file contains no notes', 'empty');
  }

  for (const voice of ordered) collapseSameStart(voice, warnings);

  const seen = new Map();
  ordered = ordered.filter((voice) => {
    const signature = voice.notes
      .map((note) => `${note.pitch}:${note.start}:${note.length}`)
      .join('|');
    const prior = seen.get(signature);
    if (prior != null) {
      warnings.push(
        `${labelOf(
          voice
        )} matches track ${prior} after the grid is applied, so the later copy was dropped.`
      );
      return false;
    }
    seen.set(signature, voice.track);
    return true;
  });

  if (ordered.length > CHANNEL_COUNT) {
    const ranked = [...ordered].sort(
      (a, b) => b.notes.length - a.notes.length || a.track - b.track || a.channel - b.channel
    );
    const keep = new Set(ranked.slice(0, CHANNEL_COUNT));
    const dropped = ranked.slice(CHANNEL_COUNT);
    warnings.push(
      `Kept the ${CHANNEL_COUNT} tracks with the most notes. Dropped ${dropped
        .map((voice) => `${labelOf(voice)} (${voice.notes.length} notes)`)
        .join(', ')}.`
    );
    ordered = ordered.filter((voice) => keep.has(voice));
  }

  const moved = ordered.reduce((sum, voice) => sum + voice.moved, 0);
  const folded = ordered.reduce((sum, voice) => sum + voice.folded, 0);
  if (moved) {
    warnings.push(
      `${moved} note starts were within a quarter of a 16th of the grid and snapped to it.`
    );
  }
  if (folded) {
    warnings.push(`${folded} notes were shifted by octaves into MIDI ${PITCH_MIN}–${PITCH_MAX}.`);
  }

  let endStep = 0;
  for (const voice of ordered) {
    for (const note of voice.notes) endStep = Math.max(endStep, note.start + note.length);
  }
  const songSteps = Math.max(STEPS_PER_BAR, Math.ceil(endStep / STEPS_PER_BAR) * STEPS_PER_BAR);
  if (songSteps !== endStep) {
    warnings.push(
      `Last note ends on step ${endStep}. The song is padded to ${songSteps} sixteenths so it fills a whole bar. No notes were added.`
    );
  }

  const layout =
    songSteps <= MAX_STEPS ? singlePattern(ordered, songSteps) : barPatterns(ordered, songSteps);
  if (layout.patterns.length > 1) {
    warnings.push(
      `Split into ${layout.arrangement.length} bars (${layout.patterns.length} unique patterns).`
    );
  }

  const channels = [];
  /** @type {VoiceReport[]} */
  const voiceReports = [];
  for (let i = 0; i < CHANNEL_COUNT; i++) {
    const voice = ordered[i];
    if (!voice) {
      channels.push(channelRow(createChannel('square')));
      continue;
    }
    const chosen = waveFor(voice.program, voice.channel, overrides);
    const ch = createChannel(chosen.wave);
    const percent =
      voice.volumeCc == null || voice.volumeVaries
        ? averageVelocity(voice.velocities)
        : ccToVolume(voice.volumeCc);
    ch.volume = percent / 100;
    channels.push(channelRow(ch));
    voiceReports.push({
      track: voice.track,
      channel: voice.channel,
      program: voice.program,
      name: voice.name,
      wave: chosen.wave,
      waveSource: chosen.source,
      notes: voice.notes.length
    });
  }

  return {
    payload: {
      v: 1,
      t: tempo,
      s: layout.steps,
      c: channels,
      p: layout.patterns,
      a: layout.arrangement,
      ap: 0,
      ac: 0
    },
    voices: voiceReports,
    warnings
  };
}

/** @param {Voice} voice */
function labelOf(voice) {
  return voice.name ? `${voice.name} (track ${voice.track})` : `track ${voice.track}`;
}

/**
 * @param {Voice} voice
 * @param {string[]} warnings
 */
function collapseSameStart(voice, warnings) {
  /** @type {Map<string, { pitch: number, start: number, length: number }>} */
  const merged = new Map();
  let collapsed = 0;
  for (const note of voice.notes) {
    const key = `${note.pitch}:${note.start}`;
    const prev = merged.get(key);
    if (!prev) merged.set(key, note);
    else {
      prev.length = Math.max(prev.length, note.length);
      collapsed += 1;
    }
  }
  if (collapsed) {
    warnings.push(
      `${labelOf(
        voice
      )} had ${collapsed} notes land on the same step and pitch; each step keeps the longer one.`
    );
  }
  voice.notes = [...merged.values()].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
}

/**
 * @param {Voice[]} voices
 * @param {number} steps
 */
function singlePattern(voices, steps) {
  const tracks = voices.map((voice) =>
    voice.notes.map((note) => [note.pitch, note.start, note.length])
  );
  while (tracks.length < CHANNEL_COUNT) tracks.push([]);
  return {
    steps,
    patterns: [{ n: 'A', t: tracks }],
    arrangement: [0]
  };
}

/**
 * One bar per arrangement slot. Bars with the same notes share a pattern.
 * @param {Voice[]} voices
 * @param {number} songSteps
 */
function barPatterns(voices, songSteps) {
  const barCount = songSteps / STEPS_PER_BAR;
  /** @type {number[][][]} */
  const patterns = [];
  /** @type {number[]} */
  const arrangement = [];
  /** @type {Map<string, number>} */
  const seen = new Map();

  for (let bar = 0; bar < barCount; bar++) {
    const barStart = bar * STEPS_PER_BAR;
    const tracks = voices.map((voice) => notesInBar(voice, barStart));
    while (tracks.length < CHANNEL_COUNT) tracks.push([]);
    const signature = JSON.stringify(tracks);
    let index = seen.get(signature);
    if (index == null) {
      index = patterns.length;
      seen.set(signature, index);
      patterns.push({ n: patternName(index), t: tracks });
    }
    arrangement.push(index);
  }

  return { steps: STEPS_PER_BAR, patterns, arrangement };
}

/**
 * @param {Voice} voice
 * @param {number} barStart
 */
function notesInBar(voice, barStart) {
  /** @type {number[][]} */
  const notes = [];
  const barEnd = barStart + STEPS_PER_BAR;
  for (const note of voice.notes) {
    const noteEnd = note.start + note.length;
    if (noteEnd <= barStart || note.start >= barEnd) continue;
    const localStart = Math.max(0, note.start - barStart);
    const localEnd = Math.min(STEPS_PER_BAR, noteEnd - barStart);
    notes.push([note.pitch, localStart, localEnd - localStart]);
  }
  notes.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  return notes;
}

/** @param {number} index */
function patternName(index) {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  if (index < letters.length) return letters[index];
  return `P${index + 1}`;
}

/**
 * @typedef {{
 *   track: number,
 *   channel: number,
 *   name: string,
 *   program: number | null,
 *   programTick: number,
 *   volumeCc: number | null,
 *   volumeVaries: boolean,
 *   velocities: number[],
 *   moved: number,
 *   folded: number,
 *   notes: { pitch: number, start: number, length: number }[],
 *   open: Map<number, { tick: number, vel: number }[]>
 * }} Voice
 */

/**
 * @param {Map<string, Voice>} voices
 * @param {number} trackIndex
 * @param {SmfEvent[]} events
 * @param {number} ticksPerStep
 * @param {string} name
 */
function absorbTrack(voices, trackIndex, events, ticksPerStep, name) {
  for (const event of events) {
    if (event.kind === 'program') {
      const voice = voiceAt(voices, trackIndex, event.channel, name);
      if (voice.program != null && voice.program !== event.program && voice.notes.length) continue;
      voice.program = event.program;
      voice.programTick = event.tick;
      continue;
    }
    if (event.kind === 'volume') {
      const voice = voiceAt(voices, trackIndex, event.channel, name);
      if (voice.volumeCc != null && voice.volumeCc !== event.value) voice.volumeVaries = true;
      else voice.volumeCc = event.value;
      continue;
    }
    if (event.kind !== 'on' && event.kind !== 'off') continue;

    const voice = voiceAt(voices, trackIndex, event.channel, name);
    const stack = voice.open.get(event.pitch) || [];
    if (event.kind === 'on') {
      stack.push({ tick: event.tick, vel: event.velocity });
      voice.open.set(event.pitch, stack);
      continue;
    }
    const started = stack.pop();
    if (!started) {
      throw new MidiImportError(
        `Note-off for pitch ${event.pitch} at tick ${event.tick} has no matching note-on`,
        'note-off'
      );
    }
    voice.open.set(event.pitch, stack);
    const placed = quantizeStart(started.tick, ticksPerStep, event.pitch);
    const folded = foldPitch(event.pitch);
    if (placed.moved) voice.moved += 1;
    if (folded.folded) voice.folded += 1;
    voice.velocities.push(started.vel);
    voice.notes.push({
      pitch: folded.pitch,
      start: placed.start,
      length: Math.max(1, Math.round((event.tick - started.tick) / ticksPerStep))
    });
  }

  for (const voice of voices.values()) {
    if (voice.track !== trackIndex) continue;
    for (const [pitch, stack] of voice.open) {
      if (stack.length) {
        throw new MidiImportError(
          `Pitch ${pitch} on track ${trackIndex} channel ${voice.channel} never receives a note-off`,
          'note-off'
        );
      }
    }
  }
}

/**
 * @param {Map<string, Voice>} voices
 * @param {number} track
 * @param {number} channel
 * @param {string} name
 * @returns {Voice}
 */
function voiceAt(voices, track, channel, name) {
  const key = `${track}:${channel}`;
  let voice = voices.get(key);
  if (!voice) {
    voice = {
      track,
      channel,
      name,
      program: null,
      programTick: 0,
      volumeCc: null,
      volumeVaries: false,
      velocities: [],
      moved: 0,
      folded: 0,
      notes: [],
      open: new Map()
    };
    voices.set(key, voice);
  }
  return voice;
}

/**
 * @param {number} tick
 * @param {number} ticksPerStep
 * @param {number} pitch
 */
function quantizeStart(tick, ticksPerStep, pitch) {
  const exact = tick / ticksPerStep;
  const start = Math.round(exact);
  const error = Math.abs(exact - start);
  if (error > 0.25) {
    throw new MidiImportError(
      `Pitch ${pitch} at tick ${tick} is ${error.toFixed(2)} sixteenths off the grid`,
      'grid'
    );
  }
  return { start, moved: start * ticksPerStep !== tick };
}

/** @param {number} pitch */
function foldPitch(pitch) {
  let next = pitch;
  while (next < PITCH_MIN) next += 12;
  while (next > PITCH_MAX) next -= 12;
  if (next < PITCH_MIN || next > PITCH_MAX) {
    throw new MidiImportError(`MIDI note ${pitch} does not fit ${PITCH_MIN}–${PITCH_MAX}`, 'pitch');
  }
  return { pitch: next, folded: next !== pitch };
}

/** @param {{ tick: number, bpm: number }[]} tempos */
function singleTempo(tempos) {
  if (!tempos.length) {
    throw new MidiImportError('MIDI file has no tempo event', 'tempo');
  }
  const bpm = tempos[0].bpm;
  for (const tempo of tempos) {
    if (tempo.bpm !== bpm) {
      throw new MidiImportError('MIDI file has more than one tempo', 'tempo');
    }
  }
  if (!Number.isInteger(bpm) || bpm < 40 || bpm > 280) {
    throw new MidiImportError(`Tempo ${bpm} is outside 40–280 BPM`, 'tempo');
  }
  return bpm;
}

/**
 * @param {number | null} program
 * @param {number} channel
 * @param {Map<number, string>} overrides
 * @returns {{ wave: string, source: 'gm' | 'override' | 'default' | 'gm-drums' }}
 */
function waveFor(program, channel, overrides) {
  if (channel === 9) return { wave: 'noise', source: 'gm-drums' };
  if (program != null && overrides.has(program)) {
    return { wave: overrides.get(program) || 'square', source: 'override' };
  }
  if (program != null && GM_WAVE_BY_PROGRAM[program]) {
    return { wave: GM_WAVE_BY_PROGRAM[program], source: 'gm' };
  }
  return { wave: 'square', source: 'default' };
}

/** @param {Record<number, string> | undefined} waves */
function normalizeWaves(waves) {
  /** @type {Map<number, string>} */
  const out = new Map();
  if (!waves) return out;
  for (const [program, wave] of Object.entries(waves)) {
    const id = Number(program);
    if (!Number.isInteger(id) || id < 0 || id > 127) {
      throw new MidiImportError(`Program override ${program} is not a MIDI program 0–127`, 'wave');
    }
    if (!WAVE_IDS.has(wave)) {
      throw new MidiImportError(`Wave "${wave}" is not a chiptune waveform`, 'wave');
    }
    out.set(id, wave);
  }
  return out;
}

/** @param {number[]} velocities */
function averageVelocity(velocities) {
  const sum = velocities.reduce((total, vel) => total + vel, 0);
  return Math.round((sum / velocities.length / 127) * 100);
}

/** @param {number} cc */
function ccToVolume(cc) {
  return Math.round((cc / 127) * 100);
}

/** @param {import('./model.js').Channel} ch */
function channelRow(ch) {
  return [
    ch.wave,
    Math.round(ch.volume * 100),
    Math.round(ch.attack * 1000),
    Math.round(ch.release * 1000),
    ch.mute ? 1 : 0,
    ch.solo ? 1 : 0
  ];
}

/**
 * @typedef {{ tick: number, kind: 'on', channel: number, pitch: number, velocity: number }
 *   | { tick: number, kind: 'off', channel: number, pitch: number }
 *   | { tick: number, kind: 'program', channel: number, program: number }
 *   | { tick: number, kind: 'volume', channel: number, value: number }
 *   | { tick: number, kind: 'ignore' }} SmfEvent
 */

/**
 * @param {Uint8Array} bytes
 */
function parseSmf(bytes) {
  if (bytes.length < 14 || ascii(bytes, 0, 4) !== 'MThd') {
    throw new MidiImportError('Not a Standard MIDI file', 'header');
  }
  const headerLength = u32(bytes, 4);
  const format = u16(bytes, 8);
  const trackCount = u16(bytes, 10);
  const division = u16(bytes, 12);
  if (format !== 0 && format !== 1) {
    throw new MidiImportError(`MIDI format ${format} is not supported`, 'format');
  }
  if (division & 0x8000) {
    throw new MidiImportError('SMPTE time division is not supported', 'division');
  }
  let offset = 8 + headerLength;
  /** @type {SmfEvent[][]} */
  const tracks = [];
  /** @type {string[]} */
  const names = [];
  /** @type {{ tick: number, bpm: number }[]} */
  const tempos = [];
  /** @type {{ numerator: number, denominator: number }[]} */
  const timeSignatures = [];

  for (let t = 0; t < trackCount; t++) {
    if (ascii(bytes, offset, 4) !== 'MTrk') {
      throw new MidiImportError(`Track ${t} is missing an MTrk header`, 'track');
    }
    const length = u32(bytes, offset + 4);
    const end = offset + 8 + length;
    const parsed = parseTrack(bytes, offset + 8, end);
    tracks.push(parsed.events);
    names.push(parsed.name);
    tempos.push(...parsed.tempos);
    timeSignatures.push(...parsed.timeSignatures);
    offset = end;
  }

  for (const sig of timeSignatures) {
    if (sig.numerator !== 4 || sig.denominator !== 4) {
      throw new MidiImportError(
        `Time signature ${sig.numerator}/${sig.denominator} is not 4/4`,
        'meter'
      );
    }
  }

  return { division, tracks, names, tempos, timeSignatures };
}

/**
 * @param {Uint8Array} bytes
 * @param {number} start
 * @param {number} end
 */
function parseTrack(bytes, start, end) {
  /** @type {SmfEvent[]} */
  const events = [];
  /** @type {{ tick: number, bpm: number }[]} */
  const tempos = [];
  /** @type {{ numerator: number, denominator: number }[]} */
  const timeSignatures = [];
  let name = '';
  let offset = start;
  let tick = 0;
  /** @type {number | null} */
  let running = null;

  while (offset < end) {
    const delta = readVarLen(bytes, offset);
    offset = delta.next;
    tick += delta.value;
    let status = bytes[offset];
    if (status === undefined) {
      throw new MidiImportError('Truncated MIDI track', 'track');
    }
    if (status & 0x80) {
      offset += 1;
      running = status;
    } else if (running == null) {
      throw new MidiImportError('MIDI event is missing a status byte', 'track');
    } else {
      status = running;
    }

    if (status === 0xff) {
      const meta = bytes[offset];
      offset += 1;
      const len = readVarLen(bytes, offset);
      offset = len.next;
      const data = bytes.subarray(offset, offset + len.value);
      offset += len.value;
      if (meta === 0x03) {
        name = decodeMetaText(data);
      } else if (meta === 0x51 && data.length === 3) {
        const microseconds = (data[0] << 16) | (data[1] << 8) | data[2];
        const exact = 60_000_000 / microseconds;
        const bpm = Math.round(exact);
        // MIDI stores microseconds per quarter, so an integer BPM is rarely exact.
        // 0.05 BPM is far larger than that rounding error and far smaller than the
        // next integer tempo.
        if (Math.abs(exact - bpm) > 0.05) {
          throw new MidiImportError(`Tempo ${exact} BPM is not an integer`, 'tempo');
        }
        tempos.push({ tick, bpm });
      } else if (meta === 0x58 && data.length >= 2) {
        timeSignatures.push({ numerator: data[0], denominator: 2 ** data[1] });
      }
      continue;
    }

    if (status === 0xf0 || status === 0xf7) {
      const len = readVarLen(bytes, offset);
      offset = len.next + len.value;
      running = null;
      continue;
    }

    const kind = status & 0xf0;
    const channel = status & 0x0f;
    if (kind === 0xc0 || kind === 0xd0) {
      const value = bytes[offset];
      offset += 1;
      if (kind === 0xc0) events.push({ tick, kind: 'program', channel, program: value });
      continue;
    }

    const data1 = bytes[offset];
    const data2 = bytes[offset + 1];
    offset += 2;
    if (kind === 0x90 && data2 > 0) {
      events.push({ tick, kind: 'on', channel, pitch: data1, velocity: data2 });
    } else if (kind === 0x80 || (kind === 0x90 && data2 === 0)) {
      events.push({ tick, kind: 'off', channel, pitch: data1 });
    } else if (kind === 0xb0 && data1 === 7) {
      events.push({ tick, kind: 'volume', channel, value: data2 });
    }
  }

  return { events, tempos, timeSignatures, name };
}

/** @param {Uint8Array} data */
function decodeMetaText(data) {
  return new TextDecoder('latin1').decode(data).replace(/\0/g, '').trim();
}

/**
 * @param {Uint8Array} bytes
 * @param {number} offset
 */
function readVarLen(bytes, offset) {
  let value = 0;
  for (let i = 0; i < 4; i++) {
    const byte = bytes[offset++];
    if (byte === undefined) throw new MidiImportError('Truncated MIDI quantity', 'track');
    value = (value << 7) | (byte & 0x7f);
    if ((byte & 0x80) === 0) return { value, next: offset };
  }
  throw new MidiImportError('MIDI quantity is longer than 4 bytes', 'track');
}

/**
 * @param {Uint8Array} bytes
 * @param {number} offset
 * @param {number} length
 */
function ascii(bytes, offset, length) {
  let text = '';
  for (let i = 0; i < length; i++) text += String.fromCharCode(bytes[offset + i]);
  return text;
}

/**
 * @param {Uint8Array} bytes
 * @param {number} offset
 */
function u16(bytes, offset) {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

/**
 * @param {Uint8Array} bytes
 * @param {number} offset
 */
function u32(bytes, offset) {
  return (
    (bytes[offset] * 0x1000000 +
      (bytes[offset + 1] << 16) +
      (bytes[offset + 2] << 8) +
      bytes[offset + 3]) >>>
    0
  );
}

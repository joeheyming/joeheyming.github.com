/**
 * MIDI / SMAF (.mmf) helpers for Media Player.
 * SMAF score tracks are converted to a Standard MIDI File so the GM synth
 * can play Yamaha phone ringtones without a backend.
 *
 * Event decoding follows the HandyPhone / Mobile Standard grammars used by
 * real MA-1..MA-5 files (duration-then-event, gate time on notes).
 */

export const SEQUENCE_EXTENSIONS = ['mid', 'midi', 'kar', 'rmi', 'rmid', 'mmf'];

/** Slider uses 0..1 of song length; tinysynth seeks in ticks. */
export function midiProgressFromTicks(curTick, maxTick) {
  if (!maxTick || maxTick <= 0) return 0;
  return Math.max(0, Math.min(1, curTick / maxTick));
}

export function midiTickFromProgress(maxTick, progress) {
  if (!maxTick || maxTick <= 0) return 0;
  const p = Math.max(0, Math.min(1, progress));
  return Math.round(p * maxTick);
}

const SEQUENCE_MIMES = new Set([
  'audio/midi',
  'audio/mid',
  'audio/x-midi',
  'audio/sp-midi',
  'application/vnd.smaf',
  'application/x-smaf',
  'application/x-midi'
]);

const TPQ = 500;
const US_PER_BEAT = 500000; // 120 BPM → 1 tick ≈ 1 ms
const MAX_EVENTS = 400000;

/**
 * @param {string|null|undefined} fileName
 * @param {string|null|undefined} mimeType
 */
export function fileLooksLikeSequence(fileName, mimeType) {
  const mime = (mimeType || '').split(';')[0].trim().toLowerCase();
  if (SEQUENCE_MIMES.has(mime)) return true;
  const ext = extensionOf(fileName);
  return SEQUENCE_EXTENSIONS.includes(ext);
}

/**
 * @param {ArrayBuffer|Uint8Array} data
 * @returns {'midi'|'smaf'|null}
 */
export function sniffSequenceKind(data) {
  const b = toBytes(data);
  if (b.length >= 4 && b[0] === 0x4d && b[1] === 0x54 && b[2] === 0x68 && b[3] === 0x64) {
    return 'midi';
  }
  if (isRiffMidi(b)) return 'midi';
  if (b.length >= 8 && b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x4d && b[3] === 0x44) {
    return 'smaf';
  }
  return null;
}

/**
 * @param {ArrayBuffer|Uint8Array} data
 * @param {{ fileName?: string }} [opts]
 * @returns {{ midi: Uint8Array, title: string|null, artist: string|null, kind: 'midi'|'smaf', durationSec: number }}
 */
export function prepareMidiBytes(data, opts = {}) {
  const bytes = toBytes(data);
  let kind = sniffSequenceKind(bytes);
  if (!kind && fileLooksLikeSequence(opts.fileName, null)) {
    const ext = extensionOf(opts.fileName);
    kind = ext === 'mmf' ? 'smaf' : 'midi';
  }
  if (kind === 'smaf') {
    const converted = smafToMidi(bytes);
    return {
      midi: converted.midi,
      title: converted.title,
      artist: converted.artist,
      kind: 'smaf',
      durationSec: converted.durationSec
    };
  }
  if (kind === 'midi') {
    const midi = unwrapRiffMidi(bytes);
    if (sniffSequenceKind(midi) !== 'midi') {
      throw new Error('Not a valid MIDI file');
    }
    const meta = readMidiTextMeta(midi);
    return {
      midi,
      title: meta.title,
      artist: meta.copyright,
      kind: 'midi',
      durationSec: estimateMidiDurationSec(midi)
    };
  }
  throw new Error('Not a MIDI or SMAF/MMF file');
}

/**
 * @param {ArrayBuffer|Uint8Array} data
 */
export function smafToMidi(data) {
  const bytes = toBytes(data);
  const parsed = parseSmaf(bytes);
  if (!parsed) throw new Error('Not a valid SMAF/MMF file');

  /** @type {{ tick: number, status: number, data: number[] }[]} */
  const events = [];
  const rhythm = new Uint8Array(128);

  const scoreTracks = parsed.tracks.filter((t) => !t.isAudioTrack && t.sequenceData.length);
  if (!scoreTracks.length) {
    throw new Error(
      'This MMF has no playable score track (PCM-only ringtones are not supported yet)'
    );
  }

  for (const t of scoreTracks) {
    const base = t.formatType === 0x00 ? t.trackNumber * 4 : t.trackNumber * 16;
    markRhythm(t, base, rhythm);
    const tbD = timeBaseMs(t.durationTimeBase);
    const tbG = timeBaseMs(t.gateTimeBase);
    if (t.formatType === 0x00) {
      decodeHandyPhone(t.sequenceData, base, tbD, tbG, events, rhythm);
    } else if (t.formatType === 0x01) {
      const inflated = smafHuffmanInflate(t.sequenceData);
      if (!inflated.length) throw new Error('Could not decompress this MMF sequence');
      decodeMobile(inflated, base, tbD, tbG, events, rhythm);
    } else {
      decodeMobile(t.sequenceData, base, tbD, tbG, events, rhythm);
    }
  }

  const noteEvents = events.filter((e) => (e.status & 0xf0) === 0x90 || (e.status & 0xf0) === 0x80);
  if (!noteEvents.length) {
    throw new Error('This MMF did not contain any notes we could convert');
  }

  const midi = buildSmf(events);
  return {
    midi,
    title: parsed.title || null,
    artist: parsed.artist || parsed.writer || null,
    durationSec: estimateMidiDurationSec(midi)
  };
}

/**
 * @param {ArrayBuffer|Uint8Array} data
 */
export function estimateMidiDurationSec(data) {
  const bytes = unwrapRiffMidi(toBytes(data));
  if (bytes.length < 14 || sniffSequenceKind(bytes) !== 'midi') return 0;
  const view = bytes;
  const headerLen = readU32(view, 4);
  let tpq = readU16(view, 12);
  if (tpq & 0x8000) {
    // SMPTE; treat as 96 ticks/qn fallback
    tpq = 96;
  }
  let idx = 8 + headerLen;
  const ntrks = readU16(view, 10);
  let maxTick = 0;
  /** @type {{ tick: number, us: number }[]} */
  const tempos = [{ tick: 0, us: 500000 }];

  for (let tr = 0; tr < ntrks && idx + 8 <= view.length; tr++) {
    if (readFourCC(view, idx) !== 'MTrk') break;
    const len = readU32(view, idx + 4);
    const start = idx + 8;
    const end = Math.min(start + len, view.length);
    let i = start;
    let tick = 0;
    let running = 0;
    while (i < end) {
      const delta = readMidiVlq(view, i);
      i = delta.next;
      tick += delta.value;
      if (i >= end) break;
      let status = view[i];
      if (status < 0x80) {
        status = running;
      } else {
        i++;
        running = status;
      }
      if (status === 0xff) {
        if (i >= end) break;
        const type = view[i++];
        const lenV = readMidiVlq(view, i);
        i = lenV.next;
        if (type === 0x51 && lenV.value >= 3 && i + 3 <= view.length) {
          const us = (view[i] << 16) | (view[i + 1] << 8) | view[i + 2];
          tempos.push({ tick, us });
        }
        if (type === 0x2f) break;
        i += lenV.value;
      } else if (status === 0xf0 || status === 0xf7) {
        const lenV = readMidiVlq(view, i);
        i = lenV.next + lenV.value;
      } else {
        const hi = status & 0xf0;
        if (hi === 0xc0 || hi === 0xd0) i += 1;
        else i += 2;
      }
      if (tick > maxTick) maxTick = tick;
    }
    idx = start + len;
  }

  tempos.sort((a, b) => a.tick - b.tick);
  let sec = 0;
  let t0 = 0;
  let us = tempos[0].us;
  let ti = 0;
  const points = [...tempos, { tick: maxTick, us }];
  for (let p = 1; p < points.length; p++) {
    while (ti + 1 < tempos.length && tempos[ti + 1].tick <= points[p].tick) {
      const next = tempos[ti + 1];
      sec += ((next.tick - t0) * us) / (tpq * 1e6);
      t0 = next.tick;
      us = next.us;
      ti++;
    }
    sec += ((points[p].tick - t0) * us) / (tpq * 1e6);
    t0 = points[p].tick;
  }
  return sec;
}

function extensionOf(fileName) {
  if (!fileName) return '';
  const base = String(fileName).split(/[/?#]/)[0];
  const dot = base.lastIndexOf('.');
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : '';
}

function toBytes(data) {
  if (data instanceof Uint8Array) return data;
  return new Uint8Array(data);
}

function isRiffMidi(b) {
  if (b.length < 16) return false;
  if (readFourCC(b, 0) !== 'RIFF') return false;
  return readFourCC(b, 8) === 'RMID';
}

function unwrapRiffMidi(b) {
  if (!isRiffMidi(b)) return b;
  let pos = 12;
  while (pos + 8 <= b.length) {
    const id = readFourCC(b, pos);
    const sz = readU32LE(b, pos + 4);
    const body = pos + 8;
    if (
      id === 'data' &&
      body + 4 <= b.length &&
      sniffSequenceKind(b.subarray(body, body + sz)) === 'midi'
    ) {
      return b.subarray(body, Math.min(body + sz, b.length));
    }
    pos = body + sz + (sz % 2);
  }
  return b;
}

function timeBaseMs(raw) {
  switch (raw) {
    case 0x00:
      return 1;
    case 0x01:
      return 2;
    case 0x02:
      return 4;
    case 0x03:
      return 5;
    case 0x10:
      return 1;
    case 0x11:
      return 2;
    case 0x12:
      return 4;
    case 0x13:
      return 5;
    default:
      return 4;
  }
}

function parseSmaf(bytes) {
  if (sniffSequenceKind(bytes) !== 'smaf') return null;
  const declared = readU32(bytes, 4);
  const end = Math.min(8 + declared, bytes.length);
  /** @type {ReturnType<typeof emptySmaf>} */
  const file = emptySmaf();
  let pos = 8;
  while (pos + 8 <= end) {
    if (!idLooksSane(bytes, pos)) {
      pos++;
      continue;
    }
    const id3 = String.fromCharCode(bytes[pos], bytes[pos + 1], bytes[pos + 2]);
    const trackNo = bytes[pos + 3];
    let sz = readU32(bytes, pos + 4);
    const body = pos + 8;
    if (body + sz > bytes.length) sz = bytes.length - body;
    if (id3 === 'CNT') parseCnti(file, bytes.subarray(body, body + sz));
    else if (id3 === 'OPD') parseOpda(file, bytes.subarray(body, body + sz));
    else if (id3 === 'MTR') parseScoreTrack(file, bytes.subarray(body, body + sz), trackNo);
    pos = body + sz;
    if (sz === 0) pos++;
  }
  return file.tracks.length ? file : null;
}

function emptySmaf() {
  return {
    title: '',
    artist: '',
    writer: '',
    /** @type {SmafTrack[]} */
    tracks: []
  };
}

/**
 * @typedef {{ trackNumber: number, isAudioTrack: boolean, formatType: number, sequenceType: number, durationTimeBase: number, gateTimeBase: number, channelStatus: Uint8Array, sequenceData: Uint8Array }} SmafTrack
 */

function parseCnti(file, body) {
  void file;
  void body;
}

function parseOpda(file, body) {
  let pos = 0;
  while (pos + 8 <= body.length) {
    const id3 = String.fromCharCode(body[pos], body[pos + 1], body[pos + 2]);
    if (id3 !== 'Dch') {
      pos++;
      continue;
    }
    let sz = readU32(body, pos + 4);
    const start = pos + 8;
    if (start + sz > body.length) sz = body.length - start;
    const b = body.subarray(start, start + sz);
    let i = 0;
    while (i + 4 <= b.length) {
      const k0 = b[i];
      const k1 = b[i + 1];
      const isKey = k0 >= 65 && k0 <= 90 && k1 >= 65 && k1 <= 90;
      if (!isKey) {
        i++;
        continue;
      }
      const vlen = (b[i + 2] << 8) | b[i + 3];
      const vpos = i + 4;
      if (vpos + vlen > b.length) {
        i++;
        continue;
      }
      const val = asciiZ(b.subarray(vpos, vpos + vlen));
      const key = String.fromCharCode(k0, k1);
      if (key === 'ST' && !file.title) file.title = val;
      else if ((key === 'AN' || key === 'AR') && !file.artist) file.artist = val;
      else if ((key === 'SW' || key === 'WW') && !file.writer) file.writer = val;
      i = vpos + vlen;
    }
    pos = start + sz;
  }
}

function parseScoreTrack(file, body, trackNo) {
  if (body.length < 4) return;
  const formatType = body[0];
  const sequenceType = body[1];
  const durationTimeBase = body[2];
  const gateTimeBase = body[3];
  const chStatusLen = formatType === 0x00 ? 2 : formatType === 0x03 ? 32 : 16;
  let hdr = 4 + chStatusLen;
  if (hdr > body.length) hdr = body.length;
  const channelStatus = body.subarray(4, hdr);
  let sequenceData = new Uint8Array(0);
  let pos = hdr;
  while (pos + 8 <= body.length) {
    if (!idLooksSane(body, pos)) {
      pos++;
      continue;
    }
    const id4 = String.fromCharCode(body[pos], body[pos + 1], body[pos + 2], body[pos + 3]);
    let sz = readU32(body, pos + 4);
    const start = pos + 8;
    if (start + sz > body.length) sz = body.length - start;
    if (id4 === 'Mtsq') sequenceData = body.subarray(start, start + sz);
    pos = start + sz;
    if (sz === 0) pos++;
  }
  file.tracks.push({
    trackNumber: trackNo,
    isAudioTrack: false,
    formatType,
    sequenceType,
    durationTimeBase,
    gateTimeBase,
    channelStatus,
    sequenceData
  });
}

function markRhythm(track, base, rhythm) {
  if (track.formatType === 0x00) {
    for (let i = 0; i < 4 && Math.floor(i / 2) < track.channelStatus.length; i++) {
      const nib =
        i % 2 === 0
          ? track.channelStatus[Math.floor(i / 2)] >> 4
          : track.channelStatus[Math.floor(i / 2)] & 0x0f;
      if ((nib & 0x03) === 3) rhythm[(base + i) & 127] = 1;
    }
  } else {
    for (let i = 0; i < track.channelStatus.length && i < 32; i++) {
      if ((track.channelStatus[i] & 0x03) === 3) rhythm[(base + i) & 127] = 1;
    }
  }
}

function midiChannel(logical, rhythm) {
  if (rhythm[logical & 127]) return 9;
  return Math.max(0, Math.min(15, logical));
}

function pushEv(events, tick, status, data) {
  if (events.length >= MAX_EVENTS) return;
  events.push({ tick: Math.max(0, Math.round(tick)), status, data });
}

function decodeHandyPhone(seq, base, tbD, tbG, events, rhythm) {
  const p = { i: 0, b: seq };
  let curMs = 0;
  const octShift = new Int16Array(16);
  let guard = 0;
  while (p.i < seq.length && guard++ < 2e6 && events.length < MAX_EVENTS) {
    const dur = readVarHps(p);
    curMs += dur * tbD;
    if (p.i >= seq.length) break;
    const e1 = seq[p.i++];
    if (e1 === 0xff) {
      if (p.i >= seq.length) break;
      const e2 = seq[p.i++];
      if (e2 === 0x00) continue;
      if (e2 === 0xf0) {
        const len = readVarHps(p);
        p.i = Math.min(seq.length, p.i + len);
        continue;
      }
      if (p.i >= seq.length) break;
      const l = seq[p.i++];
      p.i = Math.min(seq.length, p.i + l);
      continue;
    }
    if (e1 === 0x00) {
      if (p.i >= seq.length) break;
      const e2 = seq[p.i++];
      if (e2 === 0x00) {
        if (p.i >= seq.length) break;
        const e3 = seq[p.i++];
        if (e3 === 0x00) break;
        continue;
      }
      const chLog = base + ((e2 >> 6) & 3);
      const ch = midiChannel(chLog, rhythm);
      const cls = (e2 >> 4) & 3;
      const data = e2 & 0x0f;
      const tick = curMs;
      if (cls === 3) {
        if (p.i >= seq.length) break;
        const v = seq[p.i++];
        switch (data) {
          case 0x0:
            pushEv(events, tick, 0xc0 | ch, [v & 0x7f]);
            break;
          case 0x1:
            pushEv(events, tick, 0xb0 | ch, [0x20, v & 0x7f]);
            if (v & 0x80) rhythm[chLog & 127] = 1;
            break;
          case 0x2: {
            let semis = 0;
            if (v >= 0x81 && v <= 0x84) semis = -12 * (v - 0x80);
            else if (v >= 0x01 && v <= 0x04) semis = 12 * v;
            octShift[ch] = semis;
            break;
          }
          case 0x4: {
            const pb = Math.max(0, Math.min(16383, (v - 64) * 128 + 8192));
            pushEv(events, tick, 0xe0 | ch, [pb & 0x7f, (pb >> 7) & 0x7f]);
            break;
          }
          case 0x7:
            pushEv(events, tick, 0xb0 | ch, [7, v & 0x7f]);
            break;
          case 0xa:
            pushEv(events, tick, 0xb0 | ch, [10, v & 0x7f]);
            break;
          case 0xb:
            pushEv(events, tick, 0xb0 | ch, [11, v & 0x7f]);
            break;
          default:
            break;
        }
      } else if (cls === 0) {
        const val = data <= 1 ? 0 : Math.min(0x7f, data * 8 + 15);
        pushEv(events, tick, 0xb0 | ch, [11, val]);
      } else if (cls === 1) {
        const v14 = (data * 8) << 7;
        pushEv(events, tick, 0xe0 | ch, [v14 & 0x7f, (v14 >> 7) & 0x7f]);
      } else {
        const modTab = [0, 0, 8, 16, 24, 32, 40, 48, 56, 64, 72, 80, 96, 112, 127, 127];
        pushEv(events, tick, 0xb0 | ch, [1, modTab[data & 15]]);
      }
      continue;
    }
    const chLog = base + ((e1 >> 6) & 3);
    const ch = midiChannel(chLog, rhythm);
    const octave = (e1 >> 4) & 3;
    const noteN = e1 & 0x0f;
    const gate = readVarHps(p);
    if (gate === 0) continue;
    const midiNote = clamp7(noteN + octave * 12 + 36 + octShift[ch]);
    const on = curMs;
    const off = curMs + gate * tbG;
    pushEv(events, on, 0x90 | ch, [midiNote, 127]);
    pushEv(events, off, 0x80 | ch, [midiNote, 0]);
  }
}

function decodeMobile(seq, base, tbD, tbG, events, rhythm) {
  const p = { i: 0, b: seq };
  let curMs = 0;
  const runVel = new Uint8Array(16).fill(64);
  let guard = 0;
  while (p.i < seq.length && guard++ < 4e6 && events.length < MAX_EVENTS) {
    const dur = readVlqCursor(p);
    curMs += dur * tbD;
    if (p.i >= seq.length) break;
    const s = seq[p.i++];
    if (s < 0x80) continue;
    const chLog = base + (s & 0x0f);
    const ch = midiChannel(chLog, rhythm);
    const at = curMs;
    const hi = s & 0xf0;
    if (hi === 0x80 || hi === 0x90) {
      if (p.i >= seq.length) break;
      const note = seq[p.i++] & 0x7f;
      let vel;
      if (hi === 0x90) {
        if (p.i >= seq.length) break;
        vel = seq[p.i++] & 0x7f;
        runVel[s & 0x0f] = vel;
      } else {
        vel = runVel[s & 0x0f];
      }
      const gate = readVlqCursor(p);
      if (gate === 0) continue;
      pushEv(events, at, 0x90 | ch, [note, vel || 64]);
      pushEv(events, at + gate * tbG, 0x80 | ch, [note, 0]);
    } else if (hi === 0xa0) {
      p.i = Math.min(seq.length, p.i + 2);
    } else if (hi === 0xb0) {
      if (p.i + 1 >= seq.length) break;
      const cc = seq[p.i++];
      const val = seq[p.i++];
      pushEv(events, at, 0xb0 | ch, [cc, val]);
    } else if (hi === 0xc0) {
      if (p.i >= seq.length) break;
      pushEv(events, at, 0xc0 | ch, [seq[p.i++] & 0x7f]);
    } else if (hi === 0xd0) {
      if (p.i < seq.length) p.i++;
    } else if (hi === 0xe0) {
      if (p.i + 1 >= seq.length) break;
      const lsb = seq[p.i++];
      const msb = seq[p.i++];
      pushEv(events, at, 0xe0 | ch, [lsb, msb]);
    } else if (s === 0xf0) {
      const len = readVlqCursor(p);
      p.i = Math.min(seq.length, p.i + len);
    } else if (s === 0xff) {
      if (p.i >= seq.length) break;
      const m = seq[p.i++];
      if (m === 0x00) continue;
      if (m === 0x2f) break;
      if (p.i < seq.length) {
        const l = seq[p.i++];
        p.i = Math.min(seq.length, p.i + l);
      }
    }
  }
}

function buildSmf(events) {
  const sorted = events.slice().sort((a, b) => {
    if (a.tick !== b.tick) return a.tick - b.tick;
    const aNote = (a.status & 0xf0) === 0x90 || (a.status & 0xf0) === 0x80;
    const bNote = (b.status & 0xf0) === 0x90 || (b.status & 0xf0) === 0x80;
    if (aNote !== bNote) return aNote ? 1 : -1;
    return 0;
  });
  /** @type {number[]} */
  const track = [];
  writeMeta(track, 0, 0x51, [
    (US_PER_BEAT >> 16) & 0xff,
    (US_PER_BEAT >> 8) & 0xff,
    US_PER_BEAT & 0xff
  ]);
  let last = 0;
  for (const ev of sorted) {
    const delta = Math.max(0, ev.tick - last);
    last = ev.tick;
    pushVlq(track, delta);
    track.push(ev.status);
    for (const d of ev.data) track.push(d & 0xff);
  }
  pushVlq(track, 0);
  track.push(0xff, 0x2f, 0x00);

  const header = [
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
    (TPQ >> 8) & 0xff,
    TPQ & 0xff
  ];
  const mtrk = [
    0x4d,
    0x54,
    0x72,
    0x6b,
    (track.length >> 24) & 0xff,
    (track.length >> 16) & 0xff,
    (track.length >> 8) & 0xff,
    track.length & 0xff
  ];
  return new Uint8Array([...header, ...mtrk, ...track]);
}

function writeMeta(track, delta, type, data) {
  pushVlq(track, delta);
  track.push(0xff, type);
  pushVlq(track, data.length);
  for (const d of data) track.push(d);
}

function pushVlq(out, value) {
  let v = value >>> 0;
  const bytes = [v & 0x7f];
  v >>= 7;
  while (v > 0) {
    bytes.unshift((v & 0x7f) | 0x80);
    v >>= 7;
  }
  for (const b of bytes) out.push(b);
}

function readVarHps(p) {
  const b = p.b;
  if (p.i >= b.length) return 0;
  const b0 = b[p.i++];
  if (b0 < 0x80) return b0;
  if (p.i >= b.length) return b0 & 0x7f;
  const b1 = b[p.i++];
  return (((b0 & 0x7f) + 1) << 7) | b1;
}

function readVlqCursor(p) {
  let v = 0;
  let guard = 0;
  const b = p.b;
  while (p.i < b.length && guard++ < 5) {
    const x = b[p.i++];
    v = (v << 7) | (x & 0x7f);
    if (!(x & 0x80)) break;
  }
  return v;
}

function readMidiVlq(bytes, i) {
  let v = 0;
  let n = 0;
  while (i < bytes.length && n < 4) {
    const x = bytes[i++];
    n++;
    v = (v << 7) | (x & 0x7f);
    if (!(x & 0x80)) break;
  }
  return { value: v, next: i };
}

/** Okumura-tree Huffman used by SMAF Mobile Standard compressed sequences. */
export function smafHuffmanInflate(src) {
  const p = toBytes(src);
  if (p.length < 4) return new Uint8Array();
  const decoded = readU32(p, 0);
  if (decoded === 0 || decoded > 8 << 20) return new Uint8Array();
  const bits = p.subarray(4);
  let bitPos = 0;
  const getBit = () => {
    if (bitPos >> 3 >= bits.length) return -1;
    const b = (bits[bitPos >> 3] >> (7 - (bitPos & 7))) & 1;
    bitPos++;
    return b;
  };
  const getByte = () => {
    let v = 0;
    for (let i = 0; i < 8; i++) {
      const b = getBit();
      if (b < 0) return -1;
      v = (v << 1) | b;
    }
    return v;
  };
  const left = new Int32Array(511);
  const right = new Int32Array(511);
  let internalNext = 256;
  let fail = false;
  const readTree = (depth) => {
    if (fail || depth > 256) {
      fail = true;
      return 0;
    }
    const bit = getBit();
    if (bit < 0) {
      fail = true;
      return 0;
    }
    if (bit === 1) {
      if (internalNext > 510) {
        fail = true;
        return 0;
      }
      const idx = internalNext++;
      left[idx] = readTree(depth + 1);
      right[idx] = readTree(depth + 1);
      return idx;
    }
    const val = getByte();
    if (val < 0) {
      fail = true;
      return 0;
    }
    return val;
  };
  const root = readTree(0);
  if (fail) return new Uint8Array();
  const out = new Uint8Array(decoded);
  for (let i = 0; i < decoded; i++) {
    let node = root;
    let guard = 0;
    while (node >= 256 && guard++ < 256) {
      const bit = getBit();
      if (bit < 0) return out.subarray(0, i);
      node = bit ? right[node] : left[node];
    }
    out[i] = node & 0xff;
  }
  return out;
}

function readMidiTextMeta(bytes) {
  const view = unwrapRiffMidi(toBytes(bytes));
  let title = null;
  let copyright = null;
  if (view.length < 14) return { title, copyright };
  const headerLen = readU32(view, 4);
  let idx = 8 + headerLen;
  const ntrks = readU16(view, 10);
  for (let tr = 0; tr < ntrks && idx + 8 <= view.length; tr++) {
    if (readFourCC(view, idx) !== 'MTrk') break;
    const len = readU32(view, idx + 4);
    const start = idx + 8;
    const end = Math.min(start + len, view.length);
    let i = start;
    let running = 0;
    while (i < end) {
      const delta = readMidiVlq(view, i);
      i = delta.next;
      if (i >= end) break;
      let status = view[i];
      if (status < 0x80) status = running;
      else {
        i++;
        running = status;
      }
      if (status === 0xff) {
        if (i >= end) break;
        const type = view[i++];
        const lenV = readMidiVlq(view, i);
        i = lenV.next;
        const text = asciiZ(view.subarray(i, i + lenV.value));
        if ((type === 0x03 || type === 0x01) && text && !title) title = text;
        if (type === 0x02 && text && !copyright) copyright = text;
        if (type === 0x2f) break;
        i += lenV.value;
      } else if (status === 0xf0 || status === 0xf7) {
        const lenV = readMidiVlq(view, i);
        i = lenV.next + lenV.value;
      } else {
        const hi = status & 0xf0;
        i += hi === 0xc0 || hi === 0xd0 ? 1 : 2;
      }
    }
    idx = start + len;
  }
  return { title, copyright };
}

function idLooksSane(bytes, pos) {
  for (let i = 0; i < 3; i++) {
    const c = bytes[pos + i];
    if (c < 0x20 || c > 0x7e) return false;
  }
  return true;
}

function readFourCC(b, i) {
  return String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
}

function readU16(b, i) {
  return (b[i] << 8) | b[i + 1];
}

function readU32(b, i) {
  return ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
}

function readU32LE(b, i) {
  return (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
}

function asciiZ(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i];
    if (c === 0) break;
    if (c >= 32 && c < 127) s += String.fromCharCode(c);
  }
  return s.trim();
}

function clamp7(n) {
  return Math.max(0, Math.min(127, n));
}

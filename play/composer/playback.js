/**
 * Playback engine — PianoSynth + 16th-grid scheduler.
 */
import { getCtx, resumeIfSuspended } from '../shared/audio.js';
import { MULTI_SAMPLE_TONE, PianoSynth } from '../shared/piano-synth.js';
import {
  isTieContinue,
  letterIndexFromMidi,
  naturalsForStaff,
  sortedNotes,
  soundingDuration
} from './model.js';
import { beatPositions, DYNAMIC_GAIN, resolveMidi, totalSixteenths } from './notation.js';

export function createPlayback({ onPlayhead, onStatus, onEnded }) {
  const synth = new PianoSynth();
  synth.setTone(MULTI_SAMPLE_TONE);

  const state = {
    playing: false,
    loop: false,
    metronome: false,
    playheadStart: 0,
    segmentStartCtx: 0,
    segmentStartPos: 0,
    nextIndex: 0,
    beats: [],
    nextBeatIndex: 0,
    schedulerId: null,
    rafId: null,
    releaseTimers: new Set(),
    pianoReady: false,
    score: null,
    bpm: 100
  };

  const SCHEDULER_MS = 25;
  const LOOKAHEAD_S = 0.05;

  function sixteenthsPerSec() {
    // quarter note = 4 sixteenths; bpm is quarter BPM
    return (state.bpm / 60) * 4;
  }

  function currentPos() {
    if (!state.playing) return state.playheadStart;
    const elapsed = getCtx().currentTime - state.segmentStartCtx;
    return state.segmentStartPos + elapsed * sixteenthsPerSec();
  }

  function clearReleases() {
    for (const id of state.releaseTimers) clearTimeout(id);
    state.releaseTimers.clear();
  }

  function silence() {
    clearReleases();
    synth.allOff();
  }

  function strike(midi, holdMs, gainScale = 1) {
    resumeIfSuspended();
    const gain = Math.max(0.05, Math.min(1, gainScale));
    synth.noteOn(midi, { gain });
    const id = window.setTimeout(() => {
      state.releaseTimers.delete(id);
      synth.noteOff(midi);
    }, holdMs);
    state.releaseTimers.add(id);
  }

  /** Short synthetic metronome click scheduled at an absolute ctx time. */
  function click(atTime, accent) {
    resumeIfSuspended();
    const ctx = getCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const peak = accent ? 0.3 : 0.16;
    osc.type = 'square';
    osc.frequency.value = accent ? 2000 : 1400;
    gain.gain.setValueAtTime(0.0001, atTime);
    gain.gain.exponentialRampToValueAtTime(peak, atTime + 0.001);
    gain.gain.exponentialRampToValueAtTime(0.0001, atTime + 0.05);
    osc.connect(gain).connect(ctx.destination);
    osc.start(atTime);
    osc.stop(atTime + 0.06);
  }

  /** First beat index at or after `pos` (state.beats.length when none remain). */
  function beatIndexFrom(pos) {
    const idx = state.beats.findIndex((b) => b.start >= pos - 0.001);
    return idx < 0 ? state.beats.length : idx;
  }

  function midiForNote(score, note) {
    const naturals = naturalsForStaff(note.staff);
    const naturalMidi = naturals[note.step] ?? naturals[0];
    const letter = letterIndexFromMidi(naturalMidi);
    return resolveMidi(naturalMidi, letter, note.accidental, score.keySig);
  }

  function schedule() {
    if (!state.playing || !state.score) return;
    const ctx = getCtx();
    const horizon = ctx.currentTime + LOOKAHEAD_S;
    const notes = sortedNotes(state.score).filter((n) => !n.rest && !isTieContinue(state.score, n));
    const total = totalSixteenths(state.score.measures, state.score.timeSig);
    const sps = sixteenthsPerSec();

    while (state.nextIndex < notes.length) {
      const n = notes[state.nextIndex];
      const noteTime = state.segmentStartCtx + (n.start - state.segmentStartPos) / sps;
      if (noteTime > horizon) break;
      if (n.start < total) {
        const durSix = soundingDuration(state.score, n);
        const holdMs = Math.max(80, (durSix / sps) * 1000 * 0.9);
        let gain = 1;
        if (n.dynamic && DYNAMIC_GAIN[n.dynamic]) gain = DYNAMIC_GAIN[n.dynamic];
        strike(midiForNote(state.score, n), holdMs, gain);
      }
      state.nextIndex += 1;
    }

    if (state.metronome) {
      while (state.nextBeatIndex < state.beats.length) {
        const b = state.beats[state.nextBeatIndex];
        const beatTime = state.segmentStartCtx + (b.start - state.segmentStartPos) / sps;
        if (beatTime > horizon) break;
        if (b.start < total) click(Math.max(ctx.currentTime, beatTime), b.downbeat);
        state.nextBeatIndex += 1;
      }
    }

    if (currentPos() >= total) {
      if (state.loop) {
        // Seek back to the top and keep playing instead of stopping.
        silence();
        state.segmentStartCtx = ctx.currentTime;
        state.segmentStartPos = 0;
        state.playheadStart = 0;
        state.nextIndex = 0;
        state.nextBeatIndex = 0;
        onPlayhead?.(0);
      } else {
        stop(true);
      }
    }
  }

  function startRaf() {
    const tick = () => {
      state.playheadStart = currentPos();
      onPlayhead?.(state.playheadStart);
      if (state.playing) state.rafId = requestAnimationFrame(tick);
    };
    state.rafId = requestAnimationFrame(tick);
  }

  function stopScheduler() {
    if (state.schedulerId != null) {
      clearInterval(state.schedulerId);
      state.schedulerId = null;
    }
    if (state.rafId != null) {
      cancelAnimationFrame(state.rafId);
      state.rafId = null;
    }
  }

  function play(score) {
    state.score = score;
    state.bpm = score.bpm;
    resumeIfSuspended();
    getCtx();
    const total = totalSixteenths(score.measures, score.timeSig);
    if (state.playheadStart >= total - 0.01) state.playheadStart = 0;

    state.playing = true;
    state.segmentStartCtx = getCtx().currentTime + 0.04;
    state.segmentStartPos = state.playheadStart;
    const notes = sortedNotes(score).filter((n) => !n.rest && !isTieContinue(score, n));
    state.nextIndex = notes.findIndex((n) => n.start >= state.segmentStartPos - 0.001);
    if (state.nextIndex < 0) state.nextIndex = notes.length;
    state.beats = beatPositions(score.timeSig, score.measures);
    state.nextBeatIndex = beatIndexFrom(state.segmentStartPos);

    stopScheduler();
    state.schedulerId = window.setInterval(schedule, SCHEDULER_MS);
    schedule();
    startRaf();
    onStatus?.(`Playing · ${score.bpm} BPM`);
  }

  function pause() {
    state.playheadStart = currentPos();
    state.playing = false;
    stopScheduler();
    silence();
    onPlayhead?.(state.playheadStart);
    onStatus?.('Paused');
  }

  function stop(fromEnd = false) {
    state.playing = false;
    stopScheduler();
    silence();
    state.playheadStart = 0;
    onPlayhead?.(0);
    onStatus?.(fromEnd ? 'Done' : state.pianoReady ? 'Ready' : 'Loading piano…');
    if (fromEnd) onEnded?.();
  }

  function toggle(score) {
    if (state.playing) pause();
    else play(score);
  }

  /** Enable/disable looping; returns the resulting loop state. */
  function setLoop(on) {
    state.loop = !!on;
    return state.loop;
  }

  function toggleLoop() {
    return setLoop(!state.loop);
  }

  /** Enable/disable the metronome click; returns the resulting state. */
  function setMetronome(on) {
    state.metronome = !!on;
    if (state.metronome && state.playing) {
      if (!state.beats.length && state.score) {
        state.beats = beatPositions(state.score.timeSig, state.score.measures);
      }
      state.nextBeatIndex = beatIndexFrom(currentPos());
    }
    return state.metronome;
  }

  function toggleMetronome() {
    return setMetronome(!state.metronome);
  }

  function seek(pos, { resume, score } = {}) {
    const total = score ? totalSixteenths(score.measures, score.timeSig) : 1e9;
    state.playheadStart = Math.max(0, Math.min(total, pos));
    if (state.playing && score) {
      silence();
      state.segmentStartCtx = getCtx().currentTime;
      state.segmentStartPos = state.playheadStart;
      const notes = sortedNotes(score).filter((n) => !n.rest && !isTieContinue(score, n));
      state.nextIndex = notes.findIndex((n) => n.start >= state.playheadStart - 0.001);
      if (state.nextIndex < 0) state.nextIndex = notes.length;
      state.nextBeatIndex = beatIndexFrom(state.playheadStart);
    }
    onPlayhead?.(state.playheadStart);
    if (resume && score && !state.playing) play(score);
  }

  /** Live tempo change; re-anchors the playhead so position doesn't jump. */
  function setBpm(bpm) {
    const next = Math.max(40, Math.min(280, Math.round(bpm) || 100));
    if (state.playing) {
      const pos = currentPos();
      state.playheadStart = pos;
      state.segmentStartPos = pos;
      state.segmentStartCtx = getCtx().currentTime;
      if (state.score) {
        const notes = sortedNotes(state.score).filter(
          (n) => !n.rest && !isTieContinue(state.score, n)
        );
        state.nextIndex = notes.findIndex((n) => n.start >= pos - 0.001);
        if (state.nextIndex < 0) state.nextIndex = notes.length;
        state.nextBeatIndex = beatIndexFrom(pos);
      }
      onStatus?.(`Playing · ${next} BPM`);
    }
    state.bpm = next;
    if (state.score) state.score.bpm = next;
  }

  function preview(score, note) {
    if (note.rest) return;
    const midi = midiForNote(score, note);
    strike(midi, 280, note.dynamic ? DYNAMIC_GAIN[note.dynamic] : 1);
  }

  async function initPiano() {
    try {
      await synth.ensureMultiSamplerLoaded();
      state.pianoReady = synth.isReady();
    } catch (_) {
      state.pianoReady = false;
    }
    return state.pianoReady;
  }

  return {
    state,
    synth,
    play,
    pause,
    stop,
    toggle,
    setLoop,
    toggleLoop,
    setMetronome,
    toggleMetronome,
    seek,
    setBpm,
    preview,
    initPiano,
    silence,
    midiForNote
  };
}

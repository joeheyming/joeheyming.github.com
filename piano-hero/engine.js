// Hero engine — the rAF loop that ties the clock, the chart, the synth,
// the renderer, and (in play-along mode) the judgment system together.
//
// Responsibilities each frame:
//   1. Read the current song-second from `clock.now()`.
//   2. Watch mode: schedule any newly-due note-ons through PianoSynth
//      and any newly-due note-offs (notes whose end time just passed).
//   3. Play-along mode: do not auto-play notes; instead `sweepMissed`
//      picks up overdue expected notes and records them as misses.
//   4. Hand the keyboard's `keyEls` map to the renderer along with the
//      visible note window.
//   5. End-of-song: emit gameOver via game-state.

import { PianoSynth } from '/play/shared/piano-synth.js';
import { resumeIfSuspended } from '/play/shared/audio.js';
import canvasManager from './canvas-manager.js';
import { renderFrame } from './note-renderer.js';
import gameState from './game-state.js';
import clock from './clock.js';
import { buildExpectedNotes, judge, sweepMissed } from './judgment.js';

class HeroEngine {
  constructor() {
    /** @type {PianoSynth | null} */
    this.synth = null;
    /** @type {Map<number, HTMLElement>} */
    this.keyEls = new Map();
    /** Tail-end of song padding (seconds) — keep rendering after the last
     *  note finishes so the user sees their final hits land. */
    this._endPadSec = 1.5;
    /** Pre-roll "Get Ready" lead-in (seconds). The clock starts at
     *  `-LEAD_IN_SEC` on a fresh play, so the first wave of falling
     *  notes scrolls into view before song time 0 — gives the player a
     *  beat to focus before any audio or scoring begins. Resume-from-
     *  pause skips this (we only want the breathing room at the very
     *  start of a run, not every time you tap Pause/Play). */
    this._leadInSec = 2.5;

    /** Index of the next note we haven't yet scheduled note-on for in Watch mode. */
    this._watchCursor = 0;
    /** midi -> { offTime } for notes currently sounding in Watch mode. */
    this._activeNotes = new Map();
    /** Visual highlight set, fed to the renderer. */
    this._activeHits = new Set();

    /** Play-along expected list + cursor. */
    this._expected = [];
    this._expectedCursor = { start: 0 };

    /** Active notes (the chart's active-hand subset) — re-derived per song. */
    this._notes = [];

    this._rafId = 0;
    this._gameOverEmitted = false;

    /** Hooks the page can subscribe to. */
    this._listeners = {
      tick: [],
      judgment: [],
      gameOver: []
    };
  }

  on(event, fn) {
    if (!this._listeners[event]) return () => {};
    this._listeners[event].push(fn);
    return () => {
      const arr = this._listeners[event];
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    };
  }

  _emit(event, payload) {
    const arr = this._listeners[event];
    if (!arr) return;
    for (const fn of arr.slice()) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`HeroEngine listener for ${event} threw`, err);
      }
    }
  }

  /**
   * Wire the engine to its DOM context. Call once after the page loads.
   *
   * @param {Object} args
   * @param {HTMLCanvasElement} args.canvas    The note-stage canvas.
   * @param {Map<number, HTMLElement>} args.keyEls
   * @param {{ pressVisual: (midi:number, on:boolean) => void,
   *           clearActiveVisuals?: () => void }} [args.keyboard]
   *        Optional Keyboard instance. When provided, Watch-mode auto-
   *        play also lights up the matching on-screen piano key (via
   *        the same `.active` class the play-along input toggles), so
   *        the keyboard "plays itself" visibly during a Watch run.
   */
  init({ canvas, keyEls, keyboard }) {
    this.synth = new PianoSynth();
    this.synth.setTone('grand_piano_samples');
    canvasManager.init(canvas);
    this.keyEls = keyEls;
    this.keyboard = keyboard || null;
    this._loop = this._loop.bind(this);
    this._rafId = requestAnimationFrame(this._loop);
  }

  /** Provide a fresh keyEls map (e.g. after the keyboard layout changes). */
  setKeyEls(keyEls) {
    this.keyEls = keyEls;
  }

  /**
   * Load a new chart. Resets the playhead, clears active notes,
   * rebuilds the expected list for play-along mode.
   */
  loadChart() {
    this.stop();
    this._notes = gameState.getActiveNotes();
    this._watchCursor = 0;
    this._activeNotes.clear();
    this._activeHits.clear();
    this._expected = buildExpectedNotes(gameState.chart, gameState.handsActive);
    this._expectedCursor = { start: 0 };
    this._gameOverEmitted = false;
    clock.reset();
    gameState.setStatus('idle');
  }

  /** Refresh the active-notes list and expected list when hands change. */
  refreshHandsFilter() {
    this._notes = gameState.getActiveNotes();
    this._expected = buildExpectedNotes(gameState.chart, gameState.handsActive);
    this._expectedCursor = { start: 0 };
    // Re-aim the watch cursor at the current playhead.
    const t = clock.now();
    let i = 0;
    while (i < this._notes.length && this._notes[i].time < t - 0.001) i += 1;
    this._watchCursor = i;
  }

  play() {
    if (!gameState.chart) return;
    resumeIfSuspended();
    if (gameState.status === 'finished') {
      this.restart();
      return;
    }
    // Fresh start (after loadChart / restart): seed the playhead behind
    // song time 0 so notes scroll into view before audio fires. Resume
    // from pause keeps the clock where it was.
    if (gameState.status === 'idle') {
      clock.seek(-this._leadInSec);
    }
    clock.start();
    gameState.setStatus('playing');
  }

  pause() {
    clock.pause();
    if (this.synth) this.synth.allOff();
    this._activeNotes.clear();
    this._activeHits.clear();
    if (this.keyboard && this.keyboard.clearActiveVisuals) {
      this.keyboard.clearActiveVisuals();
    }
    if (gameState.chart) gameState.setStatus('paused');
  }

  stop() {
    clock.reset();
    if (this.synth) this.synth.allOff();
    this._activeNotes.clear();
    this._activeHits.clear();
    if (this.keyboard && this.keyboard.clearActiveVisuals) {
      this.keyboard.clearActiveVisuals();
    }
    this._watchCursor = 0;
    this._expectedCursor = { start: 0 };
    if (this._expected) {
      for (const e of this._expected) {
        e.hit = false;
        e.judgmentIndex = -1;
      }
    }
    if (gameState.chart) gameState.setStatus('idle');
  }

  restart() {
    this.stop();
    gameState.resetScore();
    this._gameOverEmitted = false;
    this.play();
  }

  /** Apply tempo from game-state to the clock. */
  applyTempo() {
    clock.setRate(gameState.tempo);
  }

  /** Forward a play-along input event to the judgment engine. */
  reportInput(midi, songTime) {
    if (!gameState.chart) return null;
    if (gameState.mode !== 'play-along') return null;
    if (gameState.status !== 'playing') return null;
    const result = judge(this._expected, midi, songTime, this._expectedCursor);
    if (!result) return null;
    gameState.recordJudgment(result.judgment);
    this._emit('judgment', { ...result, source: 'press', midi });
    // Brief visual highlight on the hit key. Fades on next frame.
    this._activeHits.add(midi);
    setTimeout(() => this._activeHits.delete(midi), 150);
    return result;
  }

  /** Internal: rAF loop. */
  _loop() {
    this._rafId = requestAnimationFrame(this._loop);
    const songNow = clock.now();

    if (gameState.status === 'playing' && gameState.chart) {
      if (gameState.mode === 'watch') {
        this._tickWatch(songNow);
      } else {
        this._tickPlayAlong(songNow);
      }

      // End of song?
      const total = gameState.chart.durationSec + this._endPadSec;
      if (songNow >= total && !this._gameOverEmitted) {
        this._gameOverEmitted = true;
        clock.pause();
        gameState.setStatus('finished');
        if (this.synth) this.synth.allOff();
        this._emit('gameOver', {
          tapNoteScores: gameState.tapNoteScores.slice(),
          totalNotes: this._expected.length,
          maxCombo: gameState.maxCombo,
          mode: gameState.mode
        });
      }
    }

    this._renderFrame(songNow);
    this._emit('tick', songNow);
  }

  _tickWatch(songNow) {
    // Schedule note-ons for every note whose start has passed since the
    // last frame.
    while (
      this._watchCursor < this._notes.length &&
      this._notes[this._watchCursor].time <= songNow
    ) {
      const note = this._notes[this._watchCursor];
      this._watchCursor += 1;
      if (!this.synth) continue;
      this.synth.noteOn(note.midi);
      const wasActive = this._activeHits.has(note.midi);
      this._activeNotes.set(this._uniqueKey(note), {
        midi: note.midi,
        offTime: note.time + note.duration
      });
      this._activeHits.add(note.midi);
      // Light up the matching on-screen piano key — only on the first
      // overlapping voice for this midi (a chord with two left/right
      // hand voices on the same pitch shouldn't double-toggle the
      // `.active` class).
      if (!wasActive && this.keyboard) this.keyboard.pressVisual(note.midi, true);
    }
    // Note-off any active notes whose duration has elapsed.
    for (const [key, info] of Array.from(this._activeNotes.entries())) {
      if (info.offTime <= songNow) {
        this._activeNotes.delete(key);
        if (this.synth) this.synth.noteOff(info.midi);
        // Only clear the visual if no other active note shares the midi.
        let stillActive = false;
        for (const v of this._activeNotes.values()) {
          if (v.midi === info.midi) {
            stillActive = true;
            break;
          }
        }
        if (!stillActive) {
          this._activeHits.delete(info.midi);
          if (this.keyboard) this.keyboard.pressVisual(info.midi, false);
        }
      }
    }
  }

  _tickPlayAlong(songNow) {
    // No auto-scheduling — the player triggers notes via reportInput().
    // Just sweep for misses.
    const missed = sweepMissed(this._expected, songNow, this._expectedCursor);
    for (const idx of missed) {
      gameState.recordJudgment(this._expected[idx].judgmentIndex);
      this._emit('judgment', {
        index: idx,
        judgment: this._expected[idx].judgmentIndex,
        delta: 0,
        source: 'miss',
        midi: this._expected[idx].midi
      });
    }
  }

  _uniqueKey(note) {
    // Two notes can share a MIDI pitch and overlap (e.g. left and right
    // hand hitting the same key). Use a composite key to track them
    // independently in the active-notes map.
    return `${note.midi}|${note.time.toFixed(4)}|${note.trackIdx}`;
  }

  _renderFrame(songNow) {
    if (!gameState.chart) {
      // Empty stage — just clear and draw the strike line so the page
      // looks alive even before a song is loaded.
      renderFrame({
        canvasManager,
        keyEls: this.keyEls,
        notes: [],
        songNow: 0,
        activeHits: this._activeHits
      });
      return;
    }
    renderFrame({
      canvasManager,
      keyEls: this.keyEls,
      notes: this._notes,
      songNow,
      activeHits: this._activeHits
    });
  }
}

const engine = new HeroEngine();
export default engine;

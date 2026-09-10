import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import gameState from '../js/gameState.js';
import { SimfileParser } from '../js/simfileParser.js';
import { getMusicBeat, getMusicSeconds } from '../js/timing.js';
import {
  buildTimingData,
  getBeatFromElapsedTime,
  getElapsedTimeFromBeat,
  isWarpAtBeat,
  filterUnjudgableNotes
} from '../js/timingData.js';
import { SongClock } from '../js/songClock.js';

const pairs = (spec) =>
  spec
    .split(',')
    .filter(Boolean)
    .map((entry) => {
      const [beat, value] = entry.split('=').map(Number);
      return { beat, value };
    });

/** 120 BPM: one beat is half a second, so expected times are easy to read. */
const at120 = (extra = {}) => buildTimingData({ bpms: pairs('0=120'), ...extra });

// ==========================================================================
// Freezes (#STOPS / #DELAYS)
// ==========================================================================

describe('Freezes', () => {
  it('pushes every later beat back by the freeze length', () => {
    const timing = at120({ stops: pairs('4=1.0') });

    assert.equal(getElapsedTimeFromBeat(timing, 4), 2);
    // Without the freeze this would be 4s. This drift is what made charts
    // with stops run ahead of their music.
    assert.equal(getElapsedTimeFromBeat(timing, 8), 5);
  });

  it('holds the chart on the freeze beat while the music keeps going', () => {
    const timing = at120({ stops: pairs('4=1.0') });

    const midFreeze = getBeatFromElapsedTime(timing, 2.5);
    assert.equal(midFreeze.beat, 4);
    assert.equal(midFreeze.freeze, true);

    // Freeze over, back to normal scrolling.
    assert.equal(getBeatFromElapsedTime(timing, 3.5).beat, 5);
    assert.equal(getBeatFromElapsedTime(timing, 3.5).freeze, false);
  });

  it('accumulates across many freezes', () => {
    const timing = at120({ stops: pairs('1=0.5,2=0.5,3=0.5') });
    assert.equal(getElapsedTimeFromBeat(timing, 4), 2 + 1.5);
  });

  it('times a note on a stop as the freeze starts, and on a delay as it ends', () => {
    // The difference between the two tags is exactly this.
    assert.equal(getElapsedTimeFromBeat(at120({ stops: pairs('4=1.0') }), 4), 2);
    assert.equal(getElapsedTimeFromBeat(at120({ delays: pairs('4=1.0') }), 4), 3);
  });
});

// ==========================================================================
// Warps (negative BPMs and negative stops)
// ==========================================================================

describe('Warps', () => {
  it('converts a negative BPM span into a warp that also eats the payback', () => {
    // 4 beats at -120 owes 2 seconds, which the following 120 BPM repays
    // over 4 more beats, so beats 4 through 12 are skipped.
    const timing = at120({ bpms: pairs('0=120,4=-120,8=120') });

    assert.equal(timing.warps.length, 1);
    assert.equal(timing.warps[0].row / 48, 4);
    assert.equal(timing.warps[0].lengthBeats, 8);
  });

  it('collapses every warped beat onto one instant without rewinding time', () => {
    const timing = at120({ bpms: pairs('0=120,4=-120,8=120') });

    assert.equal(getElapsedTimeFromBeat(timing, 4), 2);
    assert.equal(getElapsedTimeFromBeat(timing, 6), 2);
    assert.equal(getElapsedTimeFromBeat(timing, 12), 2);
    assert.equal(getElapsedTimeFromBeat(timing, 13), 2.5);
  });

  it('reports which beats the song skips', () => {
    const timing = at120({ bpms: pairs('0=120,4=-120,8=120') });

    assert.equal(isWarpAtBeat(timing, 2), false);
    assert.equal(isWarpAtBeat(timing, 4), true);
    assert.equal(isWarpAtBeat(timing, 11.9), true);
    assert.equal(isWarpAtBeat(timing, 12), false);
  });

  it('drops notes the song warps past', () => {
    const timing = at120({ bpms: pairs('0=120,4=-120,8=120') });
    const notes = [
      [0, 0, {}],
      [4, 1, {}],
      [7, 2, {}],
      [12, 3, {}]
    ];

    assert.deepEqual(
      filterUnjudgableNotes(timing, notes).map((note) => note[0]),
      [0, 12]
    );
  });

  it('treats a negative stop as a warp', () => {
    const timing = at120({ stops: pairs('4=-1.0') });

    assert.equal(timing.warps.length, 1);
    assert.equal(getElapsedTimeFromBeat(timing, 4), 2);
    // The second the negative stop removed is skipped, not replayed.
    assert.equal(getElapsedTimeFromBeat(timing, 6), 2);
  });

  it('lets a freeze inside a negative span pay off part of the debt', () => {
    // The stop is swallowed by the warp rather than emitted, and it shortens
    // how far the warp reaches.
    const withStop = at120({ bpms: pairs('0=120,4=-120,8=120'), stops: pairs('6=0.5') });
    const withoutStop = at120({ bpms: pairs('0=120,4=-120,8=120') });

    assert.equal(withStop.stops.length, 0);
    assert.ok(withStop.warps[0].lengthBeats < withoutStop.warps[0].lengthBeats);
  });

  it('keeps a beat judgable when a freeze shares its row', () => {
    // SM allows stop/warp/stop chains, so a row carrying a stop is still
    // real even though the surrounding beats are skipped.
    const timing = at120({ warps: pairs('4=8'), stops: pairs('6=0.25') });

    assert.equal(isWarpAtBeat(timing, 5), true);
    assert.equal(isWarpAtBeat(timing, 6), false);
  });
});

// ==========================================================================
// The reported chart: Gangnam Style (Zenius simfile 19558)
//
// Feedback on 2026-09-09: "the BPM is ridiculously fucked on basically most
// tracks, parts play completely out of sync with the music". This chart is
// the worst case — 13 freezes plus SM3.9 negative-BPM warps.
// ==========================================================================

describe('Gangnam Style (simfile 19558) regression', () => {
  const BPMS =
    '0.000=132.000,140.000=264.000,141.000=132.000,141.500=66.000,142.000=-132.001,146.000=132.000,150.000=-132.001,154.000=132.000,158.000=-132.001,162.000=132.000,166.000=-132.001,170.000=132.000,174.000=-132.001,178.000=132.000,355.000=264.000,356.000=132.000,356.500=66.000,357.000=-132.001,361.000=132.000,365.000=-132.001,369.000=132.000,373.000=-132.001,377.000=132.000,381.000=-132.001,385.000=132.000,389.000=-132.001,393.000=132.000,494.000=264.000,494.500=132.000,494.750=66.000,495.000=132.000,532.000=264.000,532.250=132.000,532.375=66.000,532.500=132.000,597.000=264.000,597.250=132.000,597.375=66.000,597.500=132.000,598.500=-132.001,602.500=132.000';
  const STOPS =
    '142.000=1.364,150.000=0.230,158.000=0.230,166.000=0.230,174.000=0.230,357.000=1.360,365.000=0.230,373.000=0.230,381.000=0.230,389.000=0.230,495.000=0.909,532.500=0.909,597.500=0.909';

  const timing = buildTimingData({ bpms: pairs(BPMS), stops: pairs(STOPS) });

  it('keeps all 13 freezes and finds the hidden warps', () => {
    assert.equal(timing.stops.length, 13);
    assert.equal(timing.warps.length, 11);
  });

  it('never runs time backwards', () => {
    // The old converter walked the BPM list assuming time only moved
    // forward, so the first -132.001 threw every later beat off.
    let previous = -Infinity;
    for (let beat = 0; beat <= 620; beat += 0.25) {
      const seconds = getElapsedTimeFromBeat(timing, beat);
      assert.ok(seconds >= previous, `beat ${beat} went backwards to ${seconds}`);
      previous = seconds;
    }
  });

  it('plays the intro at a flat 132 BPM', () => {
    assert.ok(Math.abs(getElapsedTimeFromBeat(timing, 132) - 60) < 1e-9);
  });

  it('freezes then skips at the first gimmick instead of racing ahead', () => {
    // Beat 142 holds for its 1.364s freeze, then the song warps to beat 150.
    assert.ok(Math.abs(getBeatFromElapsedTime(timing, 64.6).beat - 142) < 0.01);
    assert.ok(Math.abs(getBeatFromElapsedTime(timing, 65.5).beat - 142) < 0.01);
    assert.equal(getBeatFromElapsedTime(timing, 65.5).freeze, true);

    // One second later the old code reported beat ~183; the arrows on
    // screen had nothing to do with what was playing.
    const afterWarp = getBeatFromElapsedTime(timing, 66).beat;
    assert.ok(afterWarp >= 150 && afterWarp < 152, `expected ~150, got ${afterWarp}`);
  });

  it('round-trips beats through time outside the gimmick sections', () => {
    for (const beat of [16, 64, 120, 200, 300, 450, 560]) {
      const seconds = getElapsedTimeFromBeat(timing, beat);
      const back = getBeatFromElapsedTime(timing, seconds).beat;
      assert.ok(Math.abs(back - beat) < 1e-6, `beat ${beat} came back as ${back}`);
    }
  });
});

// ==========================================================================
// Parser
// ==========================================================================

describe('SimfileParser timing tags', () => {
  const parser = new SimfileParser();

  const simfile = (tags) => `
#TITLE:T;
${tags}
#NOTES:
     dance-single:
     :
     Beginner:
     1:
     :
1000
0000
0000
0000
;
`;

  it('reads stops, delays, and warps', () => {
    const result = parser.parse(
      simfile(
        '#BPMS:0.000=120.000;\n#STOPS:4.000=1.000;\n#DELAYS:8.000=0.500;\n#WARPS:12.000=4.000;'
      )
    );

    assert.equal(result.timing.stops.length, 1);
    assert.equal(result.timing.delays.length, 1);
    assert.equal(result.timing.warps.length, 1);

    // 2s to beat 4, the 1s stop, 2s more to beat 8, then its own delay,
    // which a note on that row waits out before it can be hit.
    assert.equal(getElapsedTimeFromBeat(result.timing, 8), 2 + 1 + 2 + 0.5);
  });

  it('ignores zero-valued timing entries', () => {
    const result = parser.parse(simfile('#BPMS:0.000=120.000,4.000=0.000;\n#STOPS:2.000=0.000;'));

    assert.equal(result.timing.stops.length, 0);
    assert.equal(result.timing.bpms.length, 1);
  });

  it('treats a chart with no timing tags as playable', () => {
    const result = parser.parse(simfile(''));
    assert.ok(getElapsedTimeFromBeat(result.timing, 4) > 0);
  });

  it('keeps an explicit zero offset', () => {
    // `#OFFSET:0.000` is falsy, and the old loader quietly replaced it with
    // its -0.03 default, shifting the whole chart against the audio.
    assert.equal(parser.parse(simfile('#BPMS:0=120;\n#OFFSET:0.000;')).offset, 0);
    assert.equal(parser.parse(simfile('#BPMS:0=120;\n#OFFSET:-0.070;')).offset, -0.07);
  });

  it('reports a positive display BPM even when the chart opens with warps', () => {
    const result = parser.parse(simfile('#BPMS:0.000=-200.000,4.000=150.000;'));
    assert.equal(result.bpm, 150);
  });
});

// ==========================================================================
// Chart loading
// ==========================================================================

describe('Loading a chart into gameState', () => {
  const parser = new SimfileParser();

  afterEach(() => gameState.resetState());

  const simfile = (tags) => `
#TITLE:T;
${tags}
#NOTES:
     dance-single:
     :
     Beginner:
     1:
     :
1000
0000
0000
0000
;
`;

  /** Mirrors what mainPageController.loadSongIntoGame does. */
  function load(source) {
    const parsed = parser.parse(source);
    gameState.setSong({
      bpm: parsed.bpm,
      bpmChanges: parsed.bpmChanges,
      timing: parsed.timing,
      addToMusicPosition: parsed.offset + parsed.timing.beat0OffsetDelta
    });
    return parsed;
  }

  it('applies #OFFSET exactly once when reading the audio clock', () => {
    load(simfile('#BPMS:0.000=120.000;\n#OFFSET:-0.500;'));

    // A negative offset means beat 0 arrives half a second into the file.
    assert.equal(getMusicBeat(0.5), 0);
    assert.equal(getMusicBeat(1.0), 1);
    assert.equal(getMusicSeconds(1), 1.0);
  });

  it('carries freezes through to the beat the engine renders', () => {
    load(simfile('#BPMS:0.000=120.000;\n#OFFSET:0.000;\n#STOPS:4.000=1.000;'));

    assert.equal(getMusicBeat(2.5), 4);
    assert.equal(getMusicBeat(3.5), 5);
  });

  it('rebuilds timing when only BPM changes are supplied', () => {
    gameState.setSong({ bpm: 120, bpmChanges: [], addToMusicPosition: 0 });
    gameState.setBpmChanges([
      { beat: 0, bpm: 120 },
      { beat: 4, bpm: 240 }
    ]);

    assert.equal(getMusicSeconds(4), 2);
    assert.equal(getMusicSeconds(8), 3);
  });
});

// ==========================================================================
// SongClock
// ==========================================================================

describe('SongClock', () => {
  /** Audio elements report time in coarse steps, not continuously. */
  function steppedAudioTime(wallSeconds, step = 0.05) {
    return Math.floor(wallSeconds / step) * step;
  }

  it('follows the audio element exactly while paused', () => {
    const clock = new SongClock();
    assert.equal(clock.update({ audioTime: 12.5, wallSeconds: 100, paused: true }), 12.5);
  });

  it('advances smoothly across a stepping audio clock', () => {
    const clock = new SongClock();
    clock.update({ audioTime: 0, wallSeconds: 0, paused: false });

    let previous = 0;
    let smallestStep = Infinity;
    let largestStep = 0;

    for (let frame = 1; frame <= 120; frame++) {
      const wallSeconds = frame / 60;
      const time = clock.update({
        audioTime: steppedAudioTime(wallSeconds),
        wallSeconds,
        paused: false
      });
      const step = time - previous;
      smallestStep = Math.min(smallestStep, step);
      largestStep = Math.max(largestStep, step);
      previous = time;
    }

    // Reading the element directly would give a mix of 0s and 0.05s jumps
    // at 60fps. Every frame should advance by roughly one frame instead.
    assert.ok(smallestStep > 0.008, `stalled frame: ${smallestStep}`);
    assert.ok(largestStep < 0.025, `jumped frame: ${largestStep}`);
  });

  it('stays close to the audio element it is smoothing', () => {
    const clock = new SongClock();
    clock.update({ audioTime: 0, wallSeconds: 0, paused: false });

    let time = 0;
    for (let frame = 1; frame <= 600; frame++) {
      const wallSeconds = frame / 60;
      time = clock.update({
        audioTime: steppedAudioTime(wallSeconds),
        wallSeconds,
        paused: false
      });
    }

    assert.ok(Math.abs(time - 10) < 0.06, `drifted to ${time}`);
  });

  it('jumps on a seek instead of crawling to it', () => {
    const clock = new SongClock();
    clock.update({ audioTime: 5, wallSeconds: 0, paused: false });
    const time = clock.update({ audioTime: 60, wallSeconds: 0.016, paused: false });
    assert.equal(time, 60);
  });

  it('never hands back a position that moved backwards', () => {
    const clock = new SongClock();
    clock.update({ audioTime: 10, wallSeconds: 0, paused: false });

    let previous = 10;
    for (let frame = 1; frame <= 30; frame++) {
      // Audio clock jitters below the predicted position.
      const time = clock.update({
        audioTime: 10 + frame / 60 - 0.02,
        wallSeconds: frame / 60,
        paused: false
      });
      assert.ok(time >= previous, `went backwards: ${previous} -> ${time}`);
      previous = time;
    }
  });

  it('tracks a rate mod', () => {
    const clock = new SongClock();
    clock.update({ audioTime: 0, wallSeconds: 0, paused: false, rate: 1.5 });

    let time = 0;
    for (let frame = 1; frame <= 60; frame++) {
      const wallSeconds = frame / 60;
      time = clock.update({
        audioTime: steppedAudioTime(wallSeconds * 1.5),
        wallSeconds,
        paused: false,
        rate: 1.5
      });
    }

    assert.ok(Math.abs(time - 1.5) < 0.06, `expected ~1.5s of song, got ${time}`);
  });

  it('extrapolates between frames for input judgment', () => {
    const clock = new SongClock();
    clock.update({ audioTime: 0, wallSeconds: 0, paused: false });
    clock.update({ audioTime: 1, wallSeconds: 1, paused: false });

    // Halfway to the next frame is halfway through that much song.
    assert.ok(Math.abs(clock.timeAt(1.008) - clock.time - 0.008) < 1e-6);
  });
});

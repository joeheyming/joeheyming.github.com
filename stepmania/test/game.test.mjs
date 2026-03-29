import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import gameState from '../js/gameState.js';
import { SimfileParser } from '../js/simfileParser.js';
import { secondsToBeats, beatsToSeconds, getBPMAtBeat } from '../js/timing.js';

// Mirror of TAP_NOTE_POINTS from score-panel.js (avoids DOM dependency)
const TAP_NOTE_POINTS = [3, 3, 2, 1, 0, -5];

// Mirror of TIMING_WINDOWS from stepmania.js
const TIMING_WINDOWS = [0.05, 0.1, 0.15, 0.25, 0.3];

// ==========================================================================
// GameState
// ==========================================================================

describe('GameState', () => {
  beforeEach(() => gameState.resetState());

  describe('scoring', () => {
    it('increments tap note score counters', () => {
      gameState.incrementScore(0); // perfect
      gameState.incrementScore(0);
      gameState.incrementScore(1); // great
      assert.deepStrictEqual(gameState.getTapNoteScores(), [2, 1, 0, 0, 0, 0]);
    });

    it('tracks actual points', () => {
      gameState.addPoints(TAP_NOTE_POINTS[0]); // +3
      gameState.addPoints(TAP_NOTE_POINTS[2]); // +2
      assert.equal(gameState.getActualPoints(), 5);
    });

    it('ignores out-of-range score indices', () => {
      gameState.incrementScore(-1);
      gameState.incrementScore(99);
      assert.deepStrictEqual(gameState.getTapNoteScores(), [0, 0, 0, 0, 0, 0]);
    });
  });

  describe('combo system', () => {
    it('builds combo on good-or-better judgments', () => {
      gameState.applyJudgment(0); // perfect
      gameState.applyJudgment(1); // great
      gameState.applyJudgment(2); // good
      assert.equal(gameState.getCombo(), 3);
    });

    it('breaks combo on bad/miss', () => {
      for (let i = 0; i < 5; i++) gameState.applyJudgment(0);
      assert.equal(gameState.getCombo(), 5);
      gameState.applyJudgment(3); // bad
      assert.equal(gameState.getCombo(), 0);
      assert.equal(gameState.getMaxCombo(), 5);
    });

    it('applies multiplier at thresholds 10/20/30', () => {
      for (let i = 0; i < 9; i++) gameState.applyJudgment(0);
      assert.equal(gameState.getComboMultiplier(), 1);
      gameState.applyJudgment(0); // combo = 10
      assert.equal(gameState.getComboMultiplier(), 2);

      for (let i = 0; i < 10; i++) gameState.applyJudgment(0); // combo = 20
      assert.equal(gameState.getComboMultiplier(), 3);

      for (let i = 0; i < 10; i++) gameState.applyJudgment(0); // combo = 30
      assert.equal(gameState.getComboMultiplier(), 4);
    });
  });

  describe('health system', () => {
    it('starts at 50', () => {
      assert.equal(gameState.getHealth(), 50);
    });

    it('gains health on good judgments', () => {
      gameState.applyHealthChange(0); // perfect +2
      assert.equal(gameState.getHealth(), 52);
    });

    it('loses health on misses', () => {
      gameState.applyHealthChange(5); // miss -10
      assert.equal(gameState.getHealth(), 40);
    });

    it('fails when health reaches 0', () => {
      for (let i = 0; i < 5; i++) gameState.applyHealthChange(5); // 5 misses = -50
      assert.equal(gameState.hasFailed(), true);
      assert.equal(gameState.getHealth(), 0);
    });

    it('caps health at 100', () => {
      for (let i = 0; i < 50; i++) gameState.applyHealthChange(0); // +100 total
      assert.equal(gameState.getHealth(), 100);
    });

    it('stops changing after failure', () => {
      for (let i = 0; i < 5; i++) gameState.applyHealthChange(5);
      assert.equal(gameState.hasFailed(), true);
      gameState.applyHealthChange(0); // should be ignored
      assert.equal(gameState.getHealth(), 0);
    });

    it('applyDamage works for mines', () => {
      gameState.applyDamage(15);
      assert.equal(gameState.getHealth(), 35);
    });
  });

  describe('resetScores', () => {
    it('resets scores but preserves song config', () => {
      gameState.setSong({ bpm: 200 });
      gameState.addPoints(10);
      gameState.applyJudgment(0);
      gameState.applyHealthChange(5);
      gameState.resetScores();

      assert.equal(gameState.getActualPoints(), 0);
      assert.equal(gameState.getCombo(), 0);
      assert.equal(gameState.getHealth(), 50);
      assert.equal(gameState.getBpm(), 200);
    });
  });
});

// ==========================================================================
// Timing
// ==========================================================================

describe('Timing', () => {
  beforeEach(() => {
    gameState.resetState();
  });

  describe('secondsToBeats / beatsToSeconds (constant BPM)', () => {
    it('converts at 120 BPM', () => {
      gameState.setSong({ bpm: 120, bpmChanges: [] });
      assert.equal(secondsToBeats(0), 0);
      assert.equal(secondsToBeats(0.5), 1); // 120 BPM = 2 beats/sec
      assert.equal(secondsToBeats(1), 2);

      assert.equal(beatsToSeconds(0), 0);
      assert.equal(beatsToSeconds(2), 1);
    });

    it('round-trips', () => {
      gameState.setSong({ bpm: 148, bpmChanges: [] });
      for (const sec of [0, 0.5, 1.0, 2.5, 10]) {
        const beats = secondsToBeats(sec);
        const backToSec = beatsToSeconds(beats);
        assert.ok(Math.abs(backToSec - sec) < 1e-9, `round-trip failed for ${sec}s`);
      }
    });
  });

  describe('BPM changes', () => {
    beforeEach(() => {
      gameState.setSong({
        bpm: 120,
        bpmChanges: [
          { beat: 0, bpm: 120 },
          { beat: 8, bpm: 240 }
        ]
      });
    });

    it('getBPMAtBeat returns correct BPM before and after change', () => {
      assert.equal(getBPMAtBeat(0), 120);
      assert.equal(getBPMAtBeat(4), 120);
      assert.equal(getBPMAtBeat(8), 240);
      assert.equal(getBPMAtBeat(16), 240);
    });

    it('secondsToBeats accounts for BPM change', () => {
      // First 8 beats at 120 BPM = 4 seconds
      const beatsAt4s = secondsToBeats(4);
      assert.ok(Math.abs(beatsAt4s - 8) < 1e-9);

      // After beat 8, 240 BPM = 4 beats/sec, so 1 more second = beat 12
      const beatsAt5s = secondsToBeats(5);
      assert.ok(Math.abs(beatsAt5s - 12) < 1e-9);
    });
  });
});

// ==========================================================================
// SimfileParser
// ==========================================================================

describe('SimfileParser', () => {
  const parser = new SimfileParser();

  it('parses metadata', () => {
    const result = parser.parse(`
#TITLE:Test Song;
#ARTIST:Test Artist;
#BPMS:0.000=150.000;
#OFFSET:0.100;
#NOTES:
     dance-single:
     :
     Beginner:
     1:
     :
0000
0000
0000
0000
;
`);
    assert.equal(result.title, 'Test Song');
    assert.equal(result.artist, 'Test Artist');
    assert.equal(result.bpm, 150);
    assert.equal(result.offset, 0.1);
  });

  it('parses tap notes', () => {
    const result = parser.parse(`
#TITLE:T;
#BPMS:0.000=120.000;
#NOTES:
     dance-single:
     :
     Beginner:
     1:
     :
1000
0100
0010
0001
;
`);
    const chart = result.charts[0];
    assert.equal(chart.noteData.length, 4);
    assert.deepStrictEqual(chart.noteData[0].slice(0, 2), [0, 0]); // beat 0, col left
    assert.deepStrictEqual(chart.noteData[1].slice(0, 2), [1, 1]); // beat 1, col down
    assert.deepStrictEqual(chart.noteData[2].slice(0, 2), [2, 2]); // beat 2, col up
    assert.deepStrictEqual(chart.noteData[3].slice(0, 2), [3, 3]); // beat 3, col right
  });

  it('parses mines', () => {
    const result = parser.parse(`
#TITLE:T;
#BPMS:0.000=120.000;
#NOTES:
     dance-single:
     :
     Beginner:
     1:
     :
M000
0000
0000
0000
;
`);
    const mine = result.charts[0].noteData[0];
    assert.equal(mine[2].Type, 'M');
  });

  it('parses hold notes with correct duration', () => {
    const result = parser.parse(`
#TITLE:T;
#BPMS:0.000=120.000;
#NOTES:
     dance-single:
     :
     Beginner:
     1:
     :
2000
0000
0000
3000
;
`);
    const hold = result.charts[0].noteData[0];
    assert.equal(hold[0], 0); // starts at beat 0
    assert.equal(hold[2].Type, 2);
    assert.equal(hold[2].Duration, 3 * 48); // 3 beats * 48 ticks
  });

  it('parses hold spanning multiple measures', () => {
    const result = parser.parse(`
#TITLE:T;
#BPMS:0.000=120.000;
#NOTES:
     dance-single:
     :
     Beginner:
     1:
     :
2000
0000
0000
0000
,
0000
0000
3000
0000
;
`);
    const hold = result.charts[0].noteData[0];
    assert.equal(hold[2].Type, 2);
    // Starts beat 0, ends beat 6 (measure 2, line 3 of 4 = beat 4+2)
    assert.equal(hold[2].Duration, 6 * 48);
  });

  it('parses BPM changes', () => {
    const result = parser.parse(`
#TITLE:T;
#BPMS:0.000=120.000,8.000=180.000;
#NOTES:
     dance-single:
     :
     Beginner:
     1:
     :
0000
0000
0000
0000
;
`);
    assert.equal(result.bpmChanges.length, 2);
    assert.equal(result.bpmChanges[0].bpm, 120);
    assert.equal(result.bpmChanges[1].beat, 8);
    assert.equal(result.bpmChanges[1].bpm, 180);
  });

  it('sorts charts by rating', () => {
    const result = parser.parse(`
#TITLE:T;
#BPMS:0.000=120.000;
#NOTES:
     dance-single:
     :
     Hard:
     8:
     :
1000
0000
0000
0000
;
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
`);
    assert.equal(result.charts[0].difficulty, 'Beginner');
    assert.equal(result.charts[1].difficulty, 'Hard');
  });
});

// ==========================================================================
// Freeze arrow scoring regression test
// ==========================================================================

describe('Freeze arrow scoring (regression)', () => {
  /**
   * Simulates the core step() logic for a single column press.
   * This mirrors stepmania.js step() to verify hold notes don't
   * trigger handleTapNoteScore.
   */
  function simulateStep(noteData, col, songBeats) {
    let hit = false;
    let tapNoteScore = 0;
    const activeHolds = {};

    noteData.forEach(function (note) {
      const noteBeat = note[0];
      const noteCol = note[1];
      const noteProps = note[2];
      const diff = Math.abs(noteBeat - songBeats);

      if ('tapNoteScore' in noteProps) return;
      if (noteCol !== col) return;
      if (diff >= TIMING_WINDOWS[TIMING_WINDOWS.length - 1]) return;

      if (noteProps.Type === 2 && noteProps.Duration) {
        for (let j = 0; j < TIMING_WINDOWS.length; j++) {
          if (diff <= TIMING_WINDOWS[j]) {
            noteProps.tapNoteScore = j;
            activeHolds[col] = {
              note,
              startBeat: noteBeat,
              endBeat: noteBeat + noteProps.Duration / 48,
              hitScore: j,
              wasDropped: false
            };
            hit = false;
            break;
          }
        }
      } else {
        for (let j = 0; j < TIMING_WINDOWS.length; j++) {
          if (diff <= TIMING_WINDOWS[j]) {
            noteProps.tapNoteScore = j;
            tapNoteScore = j;
            hit = true;
            break;
          }
        }
      }
    });

    return { hit, tapNoteScore, activeHolds };
  }

  it('hold note head does NOT trigger tap scoring', () => {
    const noteData = [[4.0, 0, { Type: 2, Duration: 96 }]]; // hold starting at beat 4, 2 beats long
    const result = simulateStep(noteData, 0, 4.0);

    assert.equal(result.hit, false, 'hold head should not set hit=true');
    assert.ok(result.activeHolds[0], 'hold should be tracked in activeHolds');
    assert.equal(result.activeHolds[0].hitScore, 0, 'perfect timing on hold head');
  });

  it('regular tap note DOES trigger tap scoring', () => {
    const noteData = [[4.0, 0, {}]];
    const result = simulateStep(noteData, 0, 4.0);

    assert.equal(result.hit, true, 'tap note should set hit=true');
    assert.equal(result.tapNoteScore, 0, 'should be perfect');
  });

  it('hold note is not double-scored when followed by a tap in same column', () => {
    const noteData = [
      [4.0, 0, { Type: 2, Duration: 96 }], // hold
      [8.0, 0, {}] // tap later in same column (out of window)
    ];
    const result = simulateStep(noteData, 0, 4.0);

    assert.equal(result.hit, false, 'only hold is in window, hit should be false');
    assert.ok(result.activeHolds[0], 'hold should be active');
  });

  it('tap in a different column does not interfere with holds', () => {
    const noteData = [
      [4.0, 0, { Type: 2, Duration: 96 }], // hold on col 0
      [4.0, 1, {}] // tap on col 1
    ];
    // Press col 0 (the hold)
    const result = simulateStep(noteData, 0, 4.0);
    assert.equal(result.hit, false, 'hold head on col 0 should not score as tap');
  });
});

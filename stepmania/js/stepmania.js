// StepMania Game Engine - ES Module
// Main game rendering and input handling

import { Sprite } from './sprite.js';
import { Actor } from './Actor.js';
import { CanvasManager } from './canvasManager.js';
import gameState from './gameState.js';
import { songManager } from './songManager.js';
import { ARROW_WIDTH, TARGETS_Y } from './config.js';
import { TAP_NOTE_POINTS, TIMING_WINDOWS, MISS_TIMING_INDEX } from './judgmentPolicy.js';
import { adjudicateColumnPress } from './columnPressAdjudication.js';
import { ScorePanel } from './score-panel.js';
import { LoadingOverlay } from './loading-overlay.js';
import { secondsToBeats, beatsToSeconds } from './timing.js';
import { songClock } from './songClock.js';
import { GameOverModal } from './game-over-modal.js';
import {
  drawMine,
  drawHoldBody,
  calculateNoteFrameIndex,
  isNoteOnScreen,
  calculateNoteY
} from './noteRenderer.js';
import Judgment from './judgment.js';
import { videoManager } from './videoManager.js';
import { audioManager } from './audioManager.js';
import { inputManager } from './inputManager.js';

// ============================================================================
// LOCAL STATE (rendering-specific, not shared)
// ============================================================================

/**
 * Current chart position in seconds, from songClock. Chart-relative: the
 * simfile #OFFSET is already applied, so this feeds secondsToBeats directly.
 */
let currentTime = 0;

/** Speed overlay display timer (seconds remaining to show) */
let speedOverlayTimer = 0;
const SPEED_OVERLAY_DURATION = 1.5;

// ============================================================================
// CANVAS/RENDERING SETUP
// ============================================================================

// Frame timing
let lastFrameWallSeconds = 0;
let uptimeSeconds = 0;
let framesInCurrentSecond = 0;

// Column info will be set after canvas initialization
let colInfos = [];

// Hold note tracking
/** @type {Object<number, Object>} */
const activeHolds = {};

// Image directory
const imgDir = '/stepmania/img/';

// ============================================================================
// SCORING
// ============================================================================

/**
 * Handle a tap note score judgment
 * @param {number} tapNoteScore - Score index (0=perfect, 1=great, etc.)
 */
function handleTapNoteScore(tapNoteScore) {
  // Update gameState scores
  gameState.incrementScore(tapNoteScore);
  gameState.addPoints(TAP_NOTE_POINTS[tapNoteScore]);

  // Apply judgment for combo and gamified score
  const { combo, multiplier } = gameState.applyJudgment(tapNoteScore);

  // Apply health change based on judgment
  gameState.applyHealthChange(tapNoteScore);

  // Update score panel component
  const scores = gameState.getTapNoteScores();
  const noteData = gameState.getNoteData();
  ScorePanel.update(tapNoteScore, scores, gameState.getActualPoints(), noteData.length, {
    combo,
    multiplier,
    score: gameState.getScore(),
    maxCombo: gameState.getMaxCombo()
  });

  // Show judgment via Judgment module
  Judgment.showTapNote(tapNoteScore);
}

let targets = [];
let explosions = [];

/**
 * Initialize actors after canvas is ready
 */
function initializeActors() {
  colInfos = CanvasManager.getColumnInfos();

  targets = [];
  colInfos.forEach(function (colInfo) {
    targets.push(
      new Actor(
        imgDir + 'down-target.png',
        { frameWidth: 64, frameHeight: 64, numFrames: 3 },
        colInfo
      )
    );
  });

  explosions = [];
  colInfos.forEach(function (colInfo) {
    const explosion = new Actor(
      imgDir + 'down-explosion.png',
      { frameWidth: 64, frameHeight: 64, numFrames: 1 },
      colInfo
    );
    explosions.push(explosion);
    explosion.set({ alpha: 0 });
  });

  // Update judgment position
  Judgment.updatePosition();
}

const noteSprite = Sprite(imgDir + 'down-note.png', {
  frameWidth: 64,
  frameHeight: 64,
  numFrames: 16
});

function getBrowserAlertText() {
  const userAgent = navigator.userAgent;
  const isFirefox = userAgent.indexOf('Firefox') !== -1;
  const firefoxVersion = userAgent.match(/Firefox\/(\d+)/);

  if (isFirefox && firefoxVersion && parseInt(firefoxVersion[1]) < 20) {
    return 'Your version of Firefox is known to have incorrect audio sync. More info...';
  }
  const supportsAudio = !!document.createElement('audio').canPlayType;
  if (!supportsAudio) {
    return "Your browser doesn't support the HTML5 audio tag. More info...";
  }
  return '';
}

// Canvas is managed by CanvasManager

/**
 * Chart position in seconds, extrapolated to this instant instead of the
 * last rendered frame. Input arrives between frames, and judging it against
 * a stale frame time costs up to a frame of accuracy.
 *
 * @returns {number}
 */
function chartSecondsNow() {
  return songClock.timeAt(performance.now() / 1000) + gameState.getMusicOffset();
}

/**
 * Process player input for a column
 * @param {number} col - Column index (0=left, 1=down, 2=up, 3=right)
 */
function step(col) {
  const songSeconds = chartSecondsNow();
  const songBeats = secondsToBeats(songSeconds);
  const noteData = gameState.getNoteData();

  const { mineHitCount, hit, tapNoteScore } = adjudicateColumnPress({
    songSeconds,
    col,
    noteData,
    activeHolds,
    beatToSeconds: beatsToSeconds
  });

  for (let m = 0; m < mineHitCount; m++) {
    gameState.incrementMineHits();

    const currentPoints = gameState.getActualPoints();
    gameState.setActualPoints(Math.max(0, currentPoints - 10));

    gameState.breakCombo();

    ScorePanel.updatePercent(gameState.getActualPoints(), noteData.length, {
      combo: 0,
      score: gameState.getScore(),
      maxCombo: gameState.getMaxCombo()
    });

    gameState.applyDamage(15);
  }

  if (mineHitCount > 0) {
    const explosion = explosions[col];
    explosion
      .stop()
      .set({ scaleX: 1, scaleY: 1, alpha: 1 })
      .animate({ scaleX: 1.5, scaleY: 1.5 }, 0.2)
      .animate({ alpha: 0 }, 0.3);

    Judgment.showMineHit();
  } else if (hit) {
    handleTapNoteScore(tapNoteScore);

    const explosion = explosions[col];
    explosion
      .stop()
      .set({ scaleX: 1, scaleY: 1, alpha: 1 })
      .animate({ scaleX: 1.1, scaleY: 1.1 }, 0.1)
      .animate({ alpha: 0 }, 0.1);
  } else {
    const target = targets[col];
    target.stop().set({ scaleX: 0.5, scaleY: 0.5 }).animate({ scaleX: 1, scaleY: 1 }, 0.2);

    let mineNearby = false;
    noteData.forEach(function (note) {
      const noteBeat = note[0];
      const noteCol = note[1];
      const noteProps = note[2];

      if (noteProps.Type === 'M' && noteCol === col) {
        const diff = Math.abs(noteBeat - songBeats);
        if (diff < 1.0 && diff > 0.1) {
          mineNearby = true;
        }
      }
    });

    if (mineNearby) {
      Judgment.showMineWarning();
    }
  }
}

// Function to add visual feedback to buttons
function addButtonFeedback(buttonId) {
  const button = document.getElementById(buttonId);
  if (button && button.addPressedFeedback) {
    button.addPressedFeedback();
  }
}

// Functions exported at end of file

/**
 * Handle release of a hold note
 * @param {number} col - Column index
 */
function releaseHold(col) {
  if (activeHolds[col]) {
    const hold = activeHolds[col];
    const songSeconds = chartSecondsNow();
    const songBeats = secondsToBeats(songSeconds);
    const holdEndBeat = hold.endBeat;

    if (songBeats < holdEndBeat - 0.1) {
      hold.wasDropped = true;
      hold.dropTime = songSeconds;

      const finalScore = Math.max(hold.hitScore, 4);

      gameState.incrementScore(finalScore);
      gameState.addPoints(TAP_NOTE_POINTS[finalScore]);

      // Apply judgment for combo and gamified score
      const { combo, multiplier } = gameState.applyJudgment(finalScore);

      // Apply health change for dropped hold
      gameState.applyHealthChange(finalScore);

      const scores = gameState.getTapNoteScores();
      const noteData = gameState.getNoteData();
      ScorePanel.update(finalScore, scores, gameState.getActualPoints(), noteData.length, {
        combo,
        multiplier,
        score: gameState.getScore(),
        maxCombo: gameState.getMaxCombo()
      });

      showJudgment('Hold Dropped!', finalScore);

      hold.note[2].holdCompleted = true;
      delete activeHolds[col];
    }
  }
}

function showJudgment(judgmentText, scoreIndex) {
  Judgment.showHold(judgmentText, scoreIndex);
}

/**
 * Update active hold notes (called each frame)
 */
function updateHolds() {
  const songSeconds = currentTime;
  const songBeats = secondsToBeats(songSeconds);
  const noteData = gameState.getNoteData();

  for (const col in activeHolds) {
    const hold = activeHolds[col];
    let keyHeld = false;

    // In autoplay mode, holds are always held
    if (hold.isAutoplay) {
      keyHeld = true;
    } else {
      // Check if column is held via InputManager (handles keyboard, gamepad, touch)
      keyHeld = inputManager.isColumnHeld(parseInt(col));
    }

    if (!keyHeld && !hold.wasDropped) {
      hold.wasDropped = true;
      hold.dropTime = songSeconds;
    }

    if (keyHeld) {
      hold.lastCheckTime = songSeconds;
    }

    if (songBeats >= hold.endBeat) {
      let finalScore;

      if (hold.wasDropped) {
        finalScore = Math.max(hold.hitScore, 4);
      } else {
        finalScore = hold.hitScore;
      }

      gameState.incrementScore(finalScore);
      gameState.addPoints(TAP_NOTE_POINTS[finalScore]);

      // Apply judgment for combo and gamified score
      const { combo, multiplier } = gameState.applyJudgment(finalScore);

      // Apply health change for hold completion
      gameState.applyHealthChange(finalScore);

      const scores = gameState.getTapNoteScores();
      ScorePanel.update(finalScore, scores, gameState.getActualPoints(), noteData.length, {
        combo,
        multiplier,
        score: gameState.getScore(),
        maxCombo: gameState.getMaxCombo()
      });

      let judgmentText = ['Perfect!', 'Great!', 'Good', 'OK', 'Almost', 'Miss'][finalScore];
      if (hold.wasDropped) {
        judgmentText = 'Hold Broken!';
      }
      showJudgment(judgmentText, finalScore);

      hold.note[2].holdCompleted = true;
      delete activeHolds[col];
    }
  }
}

/**
 * Main update loop - called each frame
 * @param {number} deltaSeconds - Time since last frame
 * @param {number} wallSeconds - Monotonic frame timestamp in seconds
 */
function update(deltaSeconds, wallSeconds) {
  const audioSeconds = songClock.update({
    audioTime: audioManager.currentTime,
    wallSeconds,
    paused: audioManager.paused,
    rate: audioManager.playbackRate
  });
  currentTime = audioSeconds + gameState.getMusicOffset();

  updateBackgroundChanges();

  // Process autoplay if enabled
  if (gameState.isAutoplay()) {
    processAutoplay();
  }

  if (typeof updateHolds === 'function') {
    updateHolds();
  }

  targets.forEach(function (target) {
    target.update(deltaSeconds);
  });
  explosions.forEach(function (target) {
    target.update(deltaSeconds);
  });
  Judgment.update(deltaSeconds);

  // Auto-miss notes that have passed (skip in autoplay mode)
  if (!gameState.isAutoplay()) {
    const missIfOlderThanSeconds = currentTime - TIMING_WINDOWS[MISS_TIMING_INDEX];
    const missIfOlderThanBeat = secondsToBeats(missIfOlderThanSeconds);
    const noteData = gameState.getNoteData();

    noteData.forEach(function (note) {
      const noteBeat = note[0];
      const noteProps = note[2];
      if (noteBeat < missIfOlderThanBeat) {
        if (!('tapNoteScore' in noteProps)) {
          if (noteProps.Type === 'M') {
            noteProps.tapNoteScore = 5;
          } else {
            noteProps.tapNoteScore = 5;
            handleTapNoteScore(5);
          }
        }
      }
    });
  }
}

/**
 * Process autoplay - auto-hit notes at perfect timing
 */
function processAutoplay() {
  const songSeconds = currentTime;
  const noteData = gameState.getNoteData();

  noteData.forEach(function (note) {
    const noteBeat = note[0];
    const noteCol = note[1];
    const noteProps = note[2];

    // Skip already judged notes
    if ('tapNoteScore' in noteProps) return;

    // Skip mines in autoplay (don't hit them!)
    if (noteProps.Type === 'M') return;

    // Hit anything that has come due. Bounding this to a narrow window
    // would drop notes whenever a frame runs long, which turns a hitch
    // into a wall of misses.
    if (songSeconds >= beatsToSeconds(noteBeat)) {
      // Auto-hit with perfect timing
      noteProps.tapNoteScore = 0; // Perfect

      // Handle hold notes - start tracking but don't score yet
      if (noteProps.Type === 2 && noteProps.Duration) {
        activeHolds[noteCol] = {
          note: note,
          startBeat: noteBeat,
          endBeat: noteBeat + noteProps.Duration / 48,
          startTime: songSeconds,
          hitScore: 0,
          wasDropped: false,
          lastCheckTime: songSeconds,
          isAutoplay: true
        };
        // Hold notes are scored when they complete in updateHolds()
      } else {
        // Only score tap notes immediately
        handleTapNoteScore(0);
      }

      // Visual feedback
      const explosion = explosions[noteCol];
      if (explosion) {
        explosion
          .stop()
          .set({ scaleX: 1, scaleY: 1, alpha: 1 })
          .animate({ scaleX: 1.1, scaleY: 1.1 }, 0.1)
          .animate({ alpha: 0 }, 0.1);
      }
    }
  });

  // Auto-hold for hold notes in autoplay
  for (const col in activeHolds) {
    const hold = activeHolds[col];
    if (hold.isAutoplay) {
      // Simulate key being held
      hold.lastCheckTime = songSeconds;
      hold.wasDropped = false;
    }
  }
}

/**
 * Initialize managers (called once on startup)
 */
function initManagers() {
  // Initialize AudioManager first (VideoManager depends on it)
  audioManager.init();

  // Initialize VideoManager (subscribes to AudioManager events)
  videoManager.init();

  // Initialize InputManager and wire up game callbacks
  inputManager.init();
  inputManager.onStep((col) => {
    step(col);
    addButtonFeedback(col);
  });
  inputManager.onRelease((col) => {
    releaseHold(col);
  });
  inputManager.onSpeedChange((direction) => {
    if (gameState.getScrollMode() === 'cmod') {
      const newBPM = gameState.getScrollBPM() + direction * 25;
      gameState.setScrollBPM(newBPM);
    } else {
      const newSpeed = Math.max(0.5, Math.min(8, gameState.getScrollSpeed() + direction * 0.25));
      gameState.setScrollSpeed(newSpeed);
    }
    showSpeedOverlay();
  });
  inputManager.onScrollModeChange(() => {
    gameState.toggleScrollMode();
    showSpeedOverlay();
  });
  inputManager.onRateChange((direction) => {
    // 0.05× per press matches ITGmania's "rate mod" granularity. Clamping
    // happens inside audioManager.setPlaybackRate.
    const next = audioManager.playbackRate + direction * 0.05;
    audioManager.setPlaybackRate(next);
    showSpeedOverlay();
  });
  inputManager.onTogglePitchPreserve(() => {
    audioManager.setPlaybackRate(audioManager.playbackRate, !audioManager.preservesPitch);
    showSpeedOverlay();
  });
}

/**
 * Check and apply background changes based on current beat
 */
function updateBackgroundChanges() {
  const bgChanges = gameState.getBgChanges();
  if (!bgChanges || bgChanges.length === 0) return;

  const musicBeat = secondsToBeats(currentTime);

  for (let i = 0; i < bgChanges.length; i++) {
    const bgChange = bgChanges[i];
    if (bgChange.beat <= musicBeat && !bgChange.triggered) {
      bgChange.triggered = true;
      applyBackgroundChange(bgChange);
    }
  }
}

async function applyBackgroundChange(bgChange) {
  const gameArea = document.getElementById('sm-micro');

  if (bgChange.isNoBackground) {
    gameArea.style.backgroundImage = 'none';
    videoManager.stop();
  } else if (bgChange.isVideo) {
    let videoUrl = bgChange.file;
    if (!videoUrl.startsWith('http')) {
      const currentSongData = songManager.getCurrentSongData();
      if (currentSongData && currentSongData.url) {
        const baseUrl = currentSongData.url.substring(0, currentSongData.url.lastIndexOf('/') + 1);
        videoUrl = baseUrl + bgChange.file;
      }
    }

    // VideoManager handles AVI conversion internally
    videoManager.play(videoUrl);
  } else {
    let imageUrl = bgChange.file;
    if (!imageUrl.startsWith('http')) {
      const currentSongData = songManager.getCurrentSongData();
      if (currentSongData && currentSongData.url) {
        const baseUrl = currentSongData.url.substring(0, currentSongData.url.lastIndexOf('/') + 1);
        imageUrl = baseUrl + bgChange.file;
      }
    }

    gameArea.style.backgroundImage = `linear-gradient(rgba(0, 0, 0, 0.7), rgba(0, 0, 0, 0.7)), url(${imageUrl})`;
    videoManager.stop();
  }
}

function showSpeedOverlay() {
  speedOverlayTimer = SPEED_OVERLAY_DURATION;
}

function drawSpeedOverlay(deltaSeconds) {
  if (speedOverlayTimer <= 0) return;
  speedOverlayTimer -= deltaSeconds;

  const ctx = CanvasManager.ctx;
  const alpha = Math.min(1, speedOverlayTimer / 0.3);
  const scrollLabel = gameState.getScrollSpeedLabel();
  const canvasWidth = CanvasManager.width;

  // Show rate on a second line when it isn't 1.0×. The "pp" suffix means
  // pitch-preserved (Chrome/Safari/Firefox time-stretch); without it the
  // pitch slides up/down with the rate (classic chipmunk effect).
  const rate = audioManager.playbackRate;
  const showRate = Math.abs(rate - 1.0) > 0.001;
  const rateLabel = showRate
    ? `${rate.toFixed(2)}× ${audioManager.preservesPitch ? 'pp' : 'free'}`
    : null;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = 'bold 24px monospace';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';

  const scrollWidth = ctx.measureText(scrollLabel).width;
  const rateWidth = rateLabel ? ctx.measureText(rateLabel).width : 0;
  const boxWidth = Math.max(scrollWidth, rateWidth) + 14;
  const boxHeight = rateLabel ? 60 : 30;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fillRect(canvasWidth - boxWidth - 20, 6, boxWidth + 6, boxHeight);

  ctx.fillStyle = gameState.getScrollMode() === 'cmod' ? '#4fc3f7' : '#fff';
  ctx.fillText(scrollLabel, canvasWidth - 10, 10);

  if (rateLabel) {
    ctx.fillStyle = audioManager.preservesPitch ? '#fbbf24' : '#f87171';
    ctx.fillText(rateLabel, canvasWidth - 10, 40);
  }

  ctx.restore();
}

/**
 * @param {number} deltaSeconds - Time since the previous frame
 */
function draw(deltaSeconds) {
  if (!CanvasManager.ctx) return;

  CanvasManager.clear();

  targets.forEach(function (target) {
    target.draw();
  });
  explosions.forEach(function (target) {
    target.draw();
  });

  drawNoteField();

  Judgment.draw();

  // Draw health bar
  CanvasManager.drawHealthBar(gameState.getHealth());

  // Draw autoplay indicator if enabled
  if (gameState.isAutoplay()) {
    CanvasManager.drawAutoplayIndicator();
  }

  // Draw combo counter
  CanvasManager.drawCombo(gameState.getCombo(), gameState.getComboMultiplier());

  // Draw speed overlay (fades out after speed change)
  drawSpeedOverlay(deltaSeconds);
}

/**
 * Draw the note field with all notes
 */
function drawNoteField() {
  const musicBeat = secondsToBeats(currentTime);
  const scrollSpeed = gameState.getScrollSpeed();
  const scrollMode = gameState.getScrollMode();
  const noteData = gameState.getNoteData();
  const arrowSize = ARROW_WIDTH;
  const isCmod = scrollMode === 'cmod';

  let musicSeconds, cmodPxPerSec;
  if (isCmod) {
    // CMod spaces notes by clock time, so it reads the position directly
    // rather than converting through the beat. Going via the beat would
    // freeze the field for the length of every stop, because every moment
    // inside a stop maps back to the beat the stop began on.
    musicSeconds = currentTime;
    cmodPxPerSec = (gameState.getScrollBPM() / 60) * arrowSize;
  }

  // Update target lighting based on beat
  const distFromNearestBeat = Math.abs(musicBeat - Math.round(musicBeat));
  const lit = distFromNearestBeat < 0.1;
  targets.forEach((target) => {
    target.props.frameIndex = lit ? 0 : 1;
  });

  const canvasHeight = CanvasManager.height;

  // Draw each note
  for (let i = 0; i < noteData.length; i++) {
    const note = noteData[i];
    const beat = note[0];
    const col = note[1];
    const noteProps = note[2];
    const colInfo = colInfos[col];
    const beatUntilNote = beat - musicBeat;

    // Calculate note end beat for holds
    let noteEndBeat = beat;
    if (noteProps.Type === 2 && noteProps.Duration) {
      noteEndBeat = beat + noteProps.Duration / 48;
    }
    const beatUntilNoteEnd = noteEndBeat - musicBeat;

    let y, currentScrollSpeed, cmodInfo;

    if (isCmod) {
      const secondsUntilNote = beatsToSeconds(beat) - musicSeconds;
      y = TARGETS_Y + secondsUntilNote * cmodPxPerSec;

      // Pixel-based culling for CMod
      let noteEndY = y;
      if (noteEndBeat !== beat) {
        noteEndY = TARGETS_Y + (beatsToSeconds(noteEndBeat) - musicSeconds) * cmodPxPerSec;
      }
      if (y > canvasHeight + 100 || noteEndY < -100) continue;

      currentScrollSpeed = 0;
      cmodInfo = { musicSeconds, pxPerSec: cmodPxPerSec };
    } else {
      // XMod spacing is measured in beats and nothing else. The field
      // already scrolls faster through a fast section because beats pass
      // faster there; scaling the spacing by the live BPM on top of that
      // double-counts it and teleports every arrow on screen the instant
      // the BPM changes.
      currentScrollSpeed = scrollSpeed;
      if (!isNoteOnScreen(beatUntilNote, beatUntilNoteEnd, currentScrollSpeed)) continue;
      y = calculateNoteY(beatUntilNote, arrowSize, currentScrollSpeed);
      cmodInfo = null;
    }

    const frameIndex = calculateNoteFrameIndex(musicBeat, beat);

    // Determine alpha (hide if already hit)
    let alpha = 1;
    if ('tapNoteScore' in noteProps && noteProps.tapNoteScore < 5) {
      alpha = 0;
    }

    // Draw based on note type
    if (noteProps.Type === 'M') {
      // Mine
      drawMine(colInfo.x, y, currentTime, beatUntilNote, alpha);
    } else if (noteProps.Type === 2 && noteProps.Duration) {
      // Hold note
      drawHoldNote(
        note,
        col,
        colInfo,
        y,
        musicBeat,
        arrowSize,
        currentScrollSpeed,
        frameIndex,
        alpha,
        cmodInfo
      );
    } else {
      // Regular tap note
      noteSprite.draw(CanvasManager.ctx, frameIndex, colInfo.x, y, 1, 1, colInfo.rotation, alpha);
    }
  }
}

/**
 * Draw a hold note (body and head)
 */
function drawHoldNote(
  note,
  col,
  colInfo,
  y,
  musicBeat,
  arrowSize,
  scrollSpeed,
  frameIndex,
  alpha,
  cmodInfo
) {
  const noteProps = note[2];
  const holdDurationBeats = noteProps.Duration / 48;

  const isActiveHold = activeHolds[col] && activeHolds[col].note === note;
  const wasDropped = isActiveHold && activeHolds[col].wasDropped;

  // Calculate hold head position
  let holdHeadY = y;
  if (isActiveHold && !wasDropped) {
    holdHeadY = TARGETS_Y;
  }

  // Calculate hold end position
  let holdEndY;
  if (cmodInfo) {
    const noteEndBeat = note[0] + holdDurationBeats;
    const endSecondsUntil = beatsToSeconds(noteEndBeat) - cmodInfo.musicSeconds;
    holdEndY = TARGETS_Y + endSecondsUntil * cmodInfo.pxPerSec;
    if (isActiveHold && !wasDropped) {
      const remainingSeconds = beatsToSeconds(activeHolds[col].endBeat) - cmodInfo.musicSeconds;
      holdEndY = TARGETS_Y + remainingSeconds * cmodInfo.pxPerSec;
    }
  } else {
    holdEndY = holdHeadY + holdDurationBeats * arrowSize * scrollSpeed;
    if (isActiveHold && !wasDropped) {
      const remainingBeats = activeHolds[col].endBeat - musicBeat;
      holdEndY = TARGETS_Y + remainingBeats * arrowSize * scrollSpeed;
    }
  }

  // Check visibility
  const holdVisible =
    holdHeadY < CanvasManager.height + 50 && holdEndY > -50 && !noteProps.holdCompleted;

  if (holdVisible) {
    drawHoldBody(colInfo.x, holdHeadY, holdEndY, {
      isActive: isActiveHold,
      wasDropped,
      currentTime
    });
  }

  // Draw hold head (the arrow) if not active
  if (!isActiveHold && !noteProps.holdCompleted) {
    noteSprite.draw(CanvasManager.ctx, frameIndex, colInfo.x, y, 1, 1, colInfo.rotation, alpha);
  }
}

// ============================================================================
// GAME RESET
// ============================================================================

/**
 * Reset game state for a new song or restart
 */
function resetGame() {
  // Reset scores in gameState (single source of truth)
  gameState.resetScores();

  // Clear local hold tracking
  for (const col in activeHolds) {
    delete activeHolds[col];
  }
  // Reset input state
  inputManager.resetHeldKeys();

  // Update score panel component
  ScorePanel.reset();

  // Reset background change triggers
  gameState.resetBgChanges();
  const bgChanges = gameState.getBgChanges();
  if (bgChanges) {
    bgChanges.forEach(function (bgChange) {
      bgChange.triggered = false;
    });
  }

  videoManager.reset();

  currentTime = 0;
  songClock.reset(0);
  audioManager.reset();

  Judgment.reset();
}

// ============================================================================
// BOOT (explicit entry from main.js — after mainPageController import for exports)
// ============================================================================

let stepmaniaDomInitDone = false;
let stepmaniaStartRequested = false;

function applyBrowserCapabilityAlert() {
  const text = getBrowserAlertText();
  if (text) {
    const alertMessage = document.getElementById('alert-message');
    const logo = document.getElementById('logo');
    const alert = document.getElementById('alert');

    if (alertMessage) alertMessage.textContent = text;
    if (logo) logo.classList.add('hidden');
    if (alert) alert.classList.remove('hidden');
  } else {
    const logo = document.getElementById('logo');
    const alert = document.getElementById('alert');

    if (logo) logo.classList.remove('hidden');
    if (alert) alert.classList.add('hidden');
  }
}

function initStepmaniaDomAndLoop() {
  if (stepmaniaDomInitDone) return;
  stepmaniaDomInitDone = true;

  applyBrowserCapabilityAlert();

  function isMobile() {
    return window.innerWidth <= 768 || 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  }

  if (isMobile()) {
    document.body.classList.add('mobile');
  }

  window.addEventListener('resize', function () {
    if (isMobile()) {
      document.body.classList.add('mobile');
    } else {
      document.body.classList.remove('mobile');
    }
    setTimeout(initializeCanvas, 100);
  });

  function initializeCanvas() {
    CanvasManager.init('sm-micro');
    initializeActors();
  }

  initializeCanvas();

  // #sm-micro is now `flex-1` and sized from leftover space in the game
  // column. Web components (difficulty-selector, zenius-browser, etc.)
  // upgrade after this script first runs and can shift sibling heights,
  // which means the height we just read may be stale. Re-read the
  // container after the next paint — `resize` only updates dimensions
  // and does not recreate the canvas or reset actors.
  requestAnimationFrame(() => {
    setTimeout(() => CanvasManager.resize('sm-micro'), 50);
  });

  const scoreToggle = document.getElementById('scoreToggle');
  if (scoreToggle) {
    scoreToggle.addEventListener('click', function () {
      const scorePanel = document.querySelector('.score-panel');
      if (scorePanel) {
        scorePanel.classList.toggle('show');
        const isVisible = scorePanel.classList.contains('show');
        this.textContent = isVisible ? '✕ Close' : '📊 Score';
      }
    });
  }

  initManagers();

  audioManager.onPlay(() => {
    LoadingOverlay.hide();
    window.heymingAchievements?.unlockForCurrentApp('first-action');
  });

  audioManager.onEnded(() => {
    if (!gameState.hasFailed() && !gameState.isAutoplay()) {
      window.heymingAchievements?.unlockForCurrentApp('chart-cleared');
    }
    GameOverModal.show({
      failed: gameState.hasFailed(),
      onRestart: function () {
        resetGame();
        audioManager.seek(0);
        audioManager.play();
      },
      onClose: function () {
        resetGame();
      }
    });
  });

  window.CanvasManager = CanvasManager;

  startRenderLoop();
}

/**
 * Drive the game from the display's own frame callback.
 *
 * A fixed-rate timer cannot line up with the refresh rate: at 90 ticks per
 * second against a 60Hz display, some frames get two updates and some get
 * none, which reads as stutter no matter how accurate the note timing is.
 */
function startRenderLoop() {
  lastFrameWallSeconds = performance.now() / 1000;

  function frame(timestampMs) {
    requestAnimationFrame(frame);

    const wallSeconds = timestampMs / 1000;
    // Clamp so a backgrounded tab (which pauses rAF) doesn't come back with
    // a multi-second delta and fast-forward every animation at once.
    const deltaSeconds = Math.min(0.25, Math.max(0, wallSeconds - lastFrameWallSeconds));
    lastFrameWallSeconds = wallSeconds;

    update(deltaSeconds, wallSeconds);
    draw(deltaSeconds);

    framesInCurrentSecond++;
    const oldSec = Math.floor(uptimeSeconds);
    const newSec = Math.floor(uptimeSeconds + deltaSeconds);
    if (oldSec != newSec) {
      const fps = framesInCurrentSecond / (newSec - oldSec);
      const fpsElement = document.getElementById('FPS');
      if (fpsElement) fpsElement.textContent = fps;
      framesInCurrentSecond = 0;
    }
    uptimeSeconds += deltaSeconds;
  }

  requestAnimationFrame(frame);
}

/**
 * Start canvas, input/audio managers, and the render loop.
 * Call once from main.js after modules that stepmania depends on (e.g. mainPageController for same-document order).
 * Safe if DOM is still loading.
 */
export function startStepmania() {
  if (stepmaniaStartRequested) return;
  stepmaniaStartRequested = true;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initStepmaniaDomAndLoop, { once: true });
  } else {
    initStepmaniaDomAndLoop();
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

// Export functions for other modules
export { step, addButtonFeedback, resetGame };

// Export getters for score data (read from gameState)
export function getScores() {
  return gameState.getTapNoteScores();
}

export function getPoints() {
  return gameState.getActualPoints();
}

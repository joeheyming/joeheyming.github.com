// Note Renderer - ES Module
// Rendering functions for different note types (mines, holds, taps)

import { ARROW_WIDTH, TARGETS_Y, CANVAS_THEME } from './config.js';
import { CanvasManager } from './canvasManager.js';

const { mine: MINE, hold: HOLD } = CANVAS_THEME;

/**
 * Draw a mine note
 * @param {number} x - X position
 * @param {number} y - Y position
 * @param {number} currentTime - Current playback time
 * @param {number} beatUntilNote - Beats until note reaches target
 * @param {number} alpha - Opacity (0-1)
 */
export function drawMine(x, y, currentTime, beatUntilNote, alpha) {
  const arrowSize = ARROW_WIDTH;
  const minePulse = Math.sin(currentTime * 8) * 0.3 + 0.7;
  const mineSize = arrowSize * 0.6;
  const pulseAlpha = alpha * minePulse;

  // Outer glow
  const glowGradient = CanvasManager.createRadialGradient(x, y, 0, mineSize * 0.8, [
    [0, 'rgba(255, 0, 0, 0.8)'],
    [0.5, 'rgba(255, 0, 0, 0.4)'],
    [1, 'rgba(255, 0, 0, 0)']
  ]);
  CanvasManager.fillCircle(x, y, mineSize * 0.8, glowGradient, pulseAlpha);

  // Core
  CanvasManager.fillCircle(x, y, mineSize * 0.6, MINE.fill, pulseAlpha);

  // Inner highlight
  CanvasManager.fillCircle(x, y, mineSize * 0.4, MINE.innerFill, pulseAlpha);

  // Spinning arc
  const rotation = currentTime * 2;
  CanvasManager.strokeArc(x, y, mineSize * 0.5, rotation, rotation + Math.PI * 1.5, {
    stroke: MINE.stroke,
    lineWidth: 3,
    alpha: pulseAlpha
  });

  // Danger warning (when approaching)
  if (beatUntilNote < 2.0 && beatUntilNote > 0.5) {
    const dangerPulse = Math.sin(currentTime * 12) * 0.5 + 0.5;
    CanvasManager.strokeArc(x, y, mineSize * 0.9, 0, Math.PI * 2, {
      stroke: MINE.dangerColor.replace('1)', dangerPulse + ')'),
      lineWidth: 2,
      alpha: pulseAlpha,
      lineDash: [5, 5]
    });
  }

  // Exclamation mark
  CanvasManager.drawText('!', x, y, {
    alpha: pulseAlpha,
    font: mineSize * 0.3 + 'px ' + MINE.font,
    fill: MINE.text
  });
}

/**
 * Draw a hold note body
 * @param {number} x - X position (center)
 * @param {number} headY - Y position of hold head
 * @param {number} endY - Y position of hold end
 * @param {Object} options - Drawing options
 * @param {boolean} options.isActive - Whether hold is currently active
 * @param {boolean} options.wasDropped - Whether hold was dropped
 * @param {number} options.currentTime - Current playback time (for pulse effect)
 */
export function drawHoldBody(x, headY, endY, options = {}) {
  const { isActive = false, wasDropped = false, currentTime = 0 } = options;

  const bodyHeight = Math.max(0, endY - headY);
  if (bodyHeight <= 0) return;

  const holdBodyAlpha = wasDropped ? 0.5 : 0.9;

  // Determine gradient colors based on state
  let colorStops;
  if (wasDropped) {
    colorStops = [
      [0, HOLD.droppedGradient.start],
      [0.5, HOLD.droppedGradient.mid],
      [1, HOLD.droppedGradient.end]
    ];
  } else if (isActive) {
    const pulse = Math.sin(currentTime * 8) * 0.2 + 0.8;
    const startColor = HOLD.activeGradient.start.replace(/[\d.]+\)$/, pulse + ')');
    colorStops = [
      [0, startColor],
      [0.5, HOLD.activeGradient.mid],
      [1, HOLD.activeGradient.end]
    ];
  } else {
    colorStops = [
      [0, HOLD.gradient.start],
      [0.5, HOLD.gradient.mid],
      [1, HOLD.gradient.end]
    ];
  }

  // Create gradient and draw body
  const holdGradient = CanvasManager.createLinearGradient(x, headY, x, endY, colorStops);
  CanvasManager.fillRect(x - 8, headY, 16, bodyHeight, holdGradient, holdBodyAlpha);

  // Draw outline
  CanvasManager.strokeRect(x - 8, headY, 16, bodyHeight, {
    stroke: isActive ? HOLD.activeStroke : HOLD.inactiveStroke,
    lineWidth: isActive ? 3 : 2,
    alpha: holdBodyAlpha
  });

  // Draw hold end cap
  const canvasHeight = CanvasManager.height;
  if (endY > -50 && endY < canvasHeight + 50) {
    const capAlpha = wasDropped ? 0.5 : 0.9;
    const capFill = wasDropped ? HOLD.droppedCapFill : HOLD.capFill;

    CanvasManager.fillRect(x - 16, endY - 6, 32, 12, capFill, capAlpha);
    CanvasManager.strokeRect(x - 16, endY - 6, 32, 12, {
      stroke: HOLD.capStroke,
      lineWidth: 2,
      alpha: capAlpha
    });
  }
}

/**
 * Calculate note frame index based on beat timing
 * @param {number} musicBeat - Current music beat
 * @param {number} noteBeat - Beat of the note
 * @param {number} numFrames - Number of animation frames (default 16)
 * @returns {number} Frame index
 */
export function calculateNoteFrameIndex(musicBeat, noteBeat, numFrames = 16) {
  const animateOverBeats = 4;
  const musicBeatRemainder = musicBeat % animateOverBeats;
  const percentThroughAnimation = musicBeatRemainder / animateOverBeats;
  const noteFrameIndex = percentThroughAnimation * numFrames;

  const beatFraction = noteBeat - Math.floor(noteBeat);
  const frameOffset = beatFraction * numFrames;

  return Math.round(noteFrameIndex + frameOffset) % numFrames;
}

/**
 * Check if a note is on screen
 * @param {number} beatUntilNote - Beats until note reaches target
 * @param {number} beatUntilNoteEnd - Beats until note end (for holds)
 * @param {number} scrollSpeed - Current scroll speed
 * @returns {boolean} Whether note should be drawn
 */
export function isNoteOnScreen(beatUntilNote, beatUntilNoteEnd, scrollSpeed) {
  return (
    beatUntilNote < 6.2 / scrollSpeed &&
    (beatUntilNote > -0.6 / scrollSpeed || beatUntilNoteEnd > -0.1 / scrollSpeed)
  );
}

/**
 * Calculate Y position for a note
 * @param {number} beatUntilNote - Beats until note reaches target
 * @param {number} arrowSize - Size of arrows
 * @param {number} scrollSpeed - Current scroll speed
 * @returns {number} Y position
 */
export function calculateNoteY(beatUntilNote, arrowSize, scrollSpeed) {
  return TARGETS_Y + beatUntilNote * arrowSize * scrollSpeed;
}

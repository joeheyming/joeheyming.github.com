// Judgment Module - ES Module
// Handles all judgment display (tap notes, mines, holds)

import { Actor } from './Actor.js';
import { CanvasManager } from './canvasManager.js';

const IMG_DIR = '/stepmania/img/';

const MINE_MESSAGES = [
  '💥 BOOM!',
  '💣 MINE!',
  '⚠️ DANGER!',
  "🚫 DON'T STEP!",
  '💥 EXPLOSION!',
  '💣 AVOID!',
  '💥 KABOOM!',
  '💣 OUCH!',
  '⚠️ WATCH OUT!',
  '🚫 NO STEP!',
  '💥 BLAST!',
  '💣 HURT!'
];

/**
 * Judgment class - handles all judgment display (tap notes, mines, holds)
 * Exported as a singleton instance
 */
class Judgment {
  constructor() {
    /** @type {Actor|null} The judgment sprite Actor */
    this.actor = null;

    /** Text judgment state */
    this.textState = {
      text: '',
      alpha: 0,
      y: 0,
      scale: 1
    };
  }

  /**
   * Initialize the judgment Actor (called lazily)
   * @private
   */
  _ensureInitialized() {
    if (!this.actor) {
      const center = CanvasManager.getCenter();
      this.actor = new Actor(
        IMG_DIR + 'judgment.png',
        { frameWidth: 168, frameHeight: 28, numFrames: 6 },
        { x: center.x, y: center.y }
      );
      this.actor.set({ alpha: 0 });
    }
  }

  /**
   * Update judgment actor position based on current canvas dimensions
   * Call this after canvas resize
   */
  updatePosition() {
    if (this.actor) {
      const center = CanvasManager.getCenter();
      this.actor.set({ x: center.x, y: center.y });
    }
  }

  /**
   * Show judgment for a tap note score
   *
   * Position is anchored to the current canvas center on every call.
   * That matters on mobile: the canvas height is bounded by `max-height:
   * 40vh / 50vh / 55vh` (see `stepmania/css/screen.css`), so on a small
   * phone in landscape the playfield can be ~100px tall and the old
   * hardcoded `y: 160 → 210` floated entirely below the visible region.
   * It also prevents non-miss judgments from inheriting a leftover
   * `y ≈ 210` from a prior miss animation (which made every subsequent
   * Perfect/Great/Good/etc. invisible on mobile after the first miss).
   *
   * @param {number} tapNoteScore - Score index (0=perfect, 1=great, 2=good, 3=bad, 4=almost, 5=miss)
   */
  showTapNote(tapNoteScore) {
    this._ensureInitialized();
    const center = CanvasManager.getCenter();

    if (tapNoteScore === 5) {
      // Miss - drift slightly downward through center and fade
      this.actor
        .stop()
        .set({
          frameIndex: tapNoteScore,
          x: center.x,
          y: center.y - 25,
          scaleX: 1,
          scaleY: 1,
          alpha: 1
        })
        .animate({ y: center.y + 25 }, 0.5)
        .animate({ alpha: 0 }, 0);
    } else {
      // Other judgments - pop in and fade at canvas center
      this.actor
        .stop()
        .set({ frameIndex: tapNoteScore, x: center.x, y: center.y })
        .animate({ scaleX: 1.4, scaleY: 1.4, alpha: 1 }, 0)
        .animate({ scaleX: 1, scaleY: 1 }, 0.1)
        .animate({ scaleX: 1, scaleY: 1 }, 0.5)
        .animate({ alpha: 0 }, 0.2);
    }
  }

  /**
   * Show a text-based judgment (used for mines and hold messages).
   * Starts slightly above center; `update()` drifts it downward as it
   * fades, same as the old behavior but anchored to live canvas size.
   *
   * @param {string} text - Message to display
   */
  showText(text) {
    const center = CanvasManager.getCenter();
    this.textState.text = text;
    this.textState.alpha = 1;
    this.textState.y = center.y - 25;
    this.textState.scale = 1.4;
  }

  /**
   * Show judgment for hold note completion. Same center-anchored
   * positioning as `showTapNote`; see that method for the mobile
   * rationale.
   *
   * @param {string} judgmentText - Text description (e.g., "Hold Dropped!")
   * @param {number} scoreIndex - Score index for sprite display
   */
  showHold(judgmentText, scoreIndex) {
    this._ensureInitialized();
    const center = CanvasManager.getCenter();

    if (scoreIndex >= 0 && scoreIndex < 6) {
      if (scoreIndex === 5) {
        this.actor
          .stop()
          .set({
            frameIndex: scoreIndex,
            x: center.x,
            y: center.y - 25,
            scaleX: 1,
            scaleY: 1,
            alpha: 1
          })
          .animate({ y: center.y + 25 }, 0.5)
          .animate({ alpha: 0 }, 0);
      } else {
        this.actor
          .stop()
          .set({ frameIndex: scoreIndex, x: center.x, y: center.y })
          .animate({ scaleX: 1.4, scaleY: 1.4, alpha: 1 }, 0)
          .animate({ scaleX: 1, scaleY: 1 }, 0.1)
          .animate({ scaleX: 1, scaleY: 1 }, 0.5)
          .animate({ alpha: 0 }, 0.2);
      }
    }

    // Show text for dropped/broken holds
    if (judgmentText === 'Hold Dropped!' || judgmentText === 'Hold Broken!') {
      this.showText(judgmentText);
    }
  }

  /**
   * Show a random mine hit message
   */
  showMineHit() {
    const randomMessage = MINE_MESSAGES[Math.floor(Math.random() * MINE_MESSAGES.length)];
    this.showText(randomMessage);
  }

  /**
   * Show mine nearby warning
   */
  showMineWarning() {
    this.showText('⚠️ MINE NEARBY!');
  }

  /**
   * Update judgment animations
   * @param {number} deltaSeconds - Time since last frame
   */
  update(deltaSeconds) {
    this._ensureInitialized();

    // Update sprite judgment
    this.actor.update(deltaSeconds);

    // Update text judgment
    if (this.textState.alpha > 0) {
      this.textState.y += 50 * deltaSeconds;
      this.textState.scale = Math.max(1, this.textState.scale - 0.4 * deltaSeconds);
      this.textState.alpha = Math.max(0, this.textState.alpha - 0.5 * deltaSeconds);
    }
  }

  /**
   * Draw all judgments to canvas
   */
  draw() {
    this._ensureInitialized();

    // Draw sprite judgment
    this.actor.draw();

    // Draw text judgment using CanvasManager
    if (this.textState.alpha > 0) {
      CanvasManager.drawJudgmentText(
        this.textState.text,
        this.textState.y,
        this.textState.alpha,
        this.textState.scale
      );
    }
  }

  /**
   * Reset judgment state
   */
  reset() {
    this.textState.alpha = 0;
    this.textState.text = '';
    this.textState.y = 0;
    this.textState.scale = 1;

    if (this.actor) {
      this.actor.stop().set({ alpha: 0 });
    }
  }
}

// Export singleton instance
export default new Judgment();

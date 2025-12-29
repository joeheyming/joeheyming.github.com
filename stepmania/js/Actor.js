// Actor module - ES Module
import { Sprite } from './sprite.js';
import { CanvasManager } from './canvasManager.js';

// Utility functions (used internally)
function merge(o1, o2) {
  for (const attr in o2) {
    o1[attr] = o2[attr];
  }
}

function deepCopy(o) {
  const ret = {};
  merge(ret, o);
  return ret;
}

/**
 * Actor class for animated sprites with keyframe animations
 */
export class Actor {
  /**
   * Create an Actor
   * @param {string} imgUrl - URL to the sprite image
   * @param {Object} fileInfo - Sprite sheet info (frameWidth, frameHeight, numFrames)
   * @param {Object} props - Initial properties (x, y, scaleX, scaleY, rotation, alpha, frameIndex)
   */
  constructor(imgUrl, fileInfo, props = {}) {
    this.props = {
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      alpha: 1,
      frameIndex: 0
    };
    merge(this.props, props);

    this.sprite = Sprite(imgUrl, fileInfo);

    // Animation state
    this.queuedKeyFrames = [];
    this.durationSeconds = undefined;
    this.intoAnimationSeconds = undefined;
    this.beginProps = undefined;
    this.endProps = undefined;
  }

  /**
   * Draw the actor to the canvas
   */
  draw() {
    this.sprite.draw(
      CanvasManager.ctx,
      this.props.frameIndex,
      this.props.x,
      this.props.y,
      this.props.scaleX,
      this.props.scaleY,
      this.props.rotation,
      this.props.alpha
    );
  }

  /**
   * Update animation state
   * @param {number} deltaSeconds - Time since last update
   */
  update(deltaSeconds) {
    if (this.queuedKeyFrames.length > 0) {
      if (this.durationSeconds === undefined) {
        const keyFrame = this.queuedKeyFrames.shift();
        this.durationSeconds = keyFrame.durationSeconds;
        this.intoAnimationSeconds = 0;
        this.beginProps = deepCopy(this.props);
        this.endProps = deepCopy(keyFrame.props);
      }
    }

    if (this.durationSeconds !== undefined) {
      this.intoAnimationSeconds += deltaSeconds;
      const percentThrough = this.intoAnimationSeconds / this.durationSeconds;

      if (percentThrough >= 1) {
        merge(this.props, this.endProps);
        this._endKeyframe();
      } else {
        for (const attr in this.endProps) {
          this.props[attr] =
            this.beginProps[attr] + (this.endProps[attr] - this.beginProps[attr]) * percentThrough;
        }
      }
    }
  }

  /**
   * Set properties immediately
   * @param {Object} props - Properties to set
   * @returns {Actor} this (for chaining)
   */
  set(props) {
    merge(this.props, props);
    return this;
  }

  /**
   * Queue an animation keyframe
   * @param {Object} props - Target properties
   * @param {number} sec - Duration in seconds
   * @returns {Actor} this (for chaining)
   */
  animate(props, sec) {
    const keyFrame = {
      props: deepCopy(props),
      durationSeconds: sec
    };
    this.queuedKeyFrames.push(keyFrame);
    return this;
  }

  /**
   * Stop all animations
   * @returns {Actor} this (for chaining)
   */
  stop() {
    this._endKeyframe();
    this.queuedKeyFrames = [];
    return this;
  }

  /**
   * Finish current animation immediately
   * @returns {Actor} this (for chaining)
   */
  finish() {
    this._endKeyframe();
    this.queuedKeyFrames = [];
    return this;
  }

  /**
   * End the current keyframe animation
   * @private
   */
  _endKeyframe() {
    this.durationSeconds = undefined;
    this.intoAnimationSeconds = undefined;
    this.beginProps = undefined;
    this.endProps = undefined;
  }
}

// Default export
export default Actor;

// Canvas Manager - ES Module
// Centralized canvas state and drawing operations

import { ARROW_WIDTH, TARGETS_Y, CANVAS_THEME } from './config.js';

/** Canvas padding in pixels */
const CANVAS_PADDING = 64;

// ============================================================================
// CANVAS MANAGER SINGLETON
// ============================================================================

/**
 * CanvasManager - centralized canvas state and operations
 * Single source of truth for canvas element, context, and dimensions
 */
export const CanvasManager = {
  /** @type {HTMLCanvasElement|null} */
  element: null,

  /** @type {CanvasRenderingContext2D|null} */
  ctx: null,

  /** Canvas width in pixels */
  width: 320,

  /** Canvas height in pixels */
  height: 400,

  /**
   * Initialize the canvas in a container element
   * @param {string} containerId - ID of the container element
   * @returns {CanvasRenderingContext2D} The 2D context
   */
  init(containerId) {
    const container = document.getElementById(containerId);
    if (!container) {
      console.error(`CanvasManager: Container '${containerId}' not found`);
      return null;
    }

    // Remove existing canvas if present
    if (this.element) {
      this.element.remove();
    }

    // Calculate dimensions
    this._calculateDimensions(container);

    // Create canvas element
    this.element = document.createElement('canvas');
    this.element.id = 'sm-micro-canvas';
    this.element.width = this.width;
    this.element.height = this.height;
    container.prepend(this.element);

    // Get 2D context
    this.ctx = this.element.getContext('2d');

    // Ensure roundRect is available (polyfill for older browsers)
    this._ensureRoundRect(this.ctx);

    return this.ctx;
  },

  /**
   * Polyfill CanvasRenderingContext2D.roundRect for browsers that don't support it
   * (e.g. older Safari/iOS, older Chromium).
   * @param {CanvasRenderingContext2D} ctx
   * @private
   */
  _ensureRoundRect(ctx) {
    if (!ctx || typeof ctx.roundRect === 'function') return;
    const proto = Object.getPrototypeOf(ctx);
    if (!proto || typeof proto.roundRect === 'function') return;

    proto.roundRect = function (x, y, w, h, radii) {
      let tl, tr, br, bl;
      if (typeof radii === 'number') {
        tl = tr = br = bl = radii;
      } else if (Array.isArray(radii)) {
        if (radii.length === 1) tl = tr = br = bl = radii[0];
        else if (radii.length === 2) {
          tl = br = radii[0];
          tr = bl = radii[1];
        } else if (radii.length === 3) {
          tl = radii[0];
          tr = bl = radii[1];
          br = radii[2];
        } else {
          [tl, tr, br, bl] = radii;
        }
      } else {
        tl = tr = br = bl = 0;
      }

      // Clamp radii so they don't exceed half of width/height
      const maxR = Math.min(Math.abs(w), Math.abs(h)) / 2;
      tl = Math.min(tl, maxR);
      tr = Math.min(tr, maxR);
      br = Math.min(br, maxR);
      bl = Math.min(bl, maxR);

      this.moveTo(x + tl, y);
      this.lineTo(x + w - tr, y);
      this.quadraticCurveTo(x + w, y, x + w, y + tr);
      this.lineTo(x + w, y + h - br);
      this.quadraticCurveTo(x + w, y + h, x + w - br, y + h);
      this.lineTo(x + bl, y + h);
      this.quadraticCurveTo(x, y + h, x, y + h - bl);
      this.lineTo(x, y + tl);
      this.quadraticCurveTo(x, y, x + tl, y);
      this.closePath();
    };
  },

  /**
   * Calculate canvas dimensions based on container
   * @param {HTMLElement} container - Container element
   * @private
   */
  _calculateDimensions(container) {
    const containerWidth = container.offsetWidth;
    const maxCanvasWidth = ARROW_WIDTH * 4 + CANVAS_PADDING;

    this.width = Math.min(containerWidth, maxCanvasWidth);
    this.height = container.offsetHeight - 50;
  },

  /**
   * Handle window resize - recalculate dimensions and resize canvas
   * @param {string} containerId - ID of the container element
   */
  resize(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    this._calculateDimensions(container);

    if (this.element) {
      this.element.width = this.width;
      this.element.height = this.height;
    }
  },

  /**
   * Clear the entire canvas
   */
  clear() {
    if (this.ctx) {
      this.ctx.clearRect(0, 0, this.width, this.height);
    }
  },

  /**
   * Get the 2D rendering context
   * @returns {CanvasRenderingContext2D|null}
   */
  getContext() {
    return this.ctx;
  },

  /**
   * Get canvas dimensions
   * @returns {{width: number, height: number}}
   */
  getDimensions() {
    return { width: this.width, height: this.height };
  },

  /**
   * Get canvas center point
   * @returns {{x: number, y: number}}
   */
  getCenter() {
    return { x: this.width / 2, y: this.height / 2 };
  },

  /**
   * Calculate column positions based on current width
   * @returns {Array<{x: number, y: number, rotation: number}>}
   */
  getColumnInfos() {
    const colWidth = this.width / 5;
    return [
      { x: colWidth * 1, y: TARGETS_Y, rotation: 90 }, // Left
      { x: colWidth * 2, y: TARGETS_Y, rotation: 0 }, // Down
      { x: colWidth * 3, y: TARGETS_Y, rotation: 180 }, // Up
      { x: colWidth * 4, y: TARGETS_Y, rotation: -90 } // Right
    ];
  },

  // ==========================================================================
  // DRAWING UTILITIES
  // ==========================================================================

  /**
   * Execute drawing operations within a save/restore context
   * @param {Function} fn - Drawing function to execute
   */
  withContext(fn) {
    if (!this.ctx) return;
    this.ctx.save();
    fn(this.ctx);
    this.ctx.restore();
  },

  /**
   * Draw text with styling options
   * @param {string} text - Text to draw
   * @param {number} x - X position
   * @param {number} y - Y position
   * @param {Object} options - Styling options
   * @param {number} options.alpha - Opacity (0-1)
   * @param {number} options.scale - Scale factor
   * @param {string} options.font - Font string
   * @param {string} options.fill - Fill color
   * @param {string} options.align - Text alignment
   * @param {string} options.baseline - Text baseline
   * @param {Object} options.shadow - Shadow options { color, blur, offsetX, offsetY }
   */
  drawText(text, x, y, options = {}) {
    if (!this.ctx) return;

    const {
      alpha = 1,
      scale = 1,
      font = '24px Arial',
      fill = '#ffffff',
      align = 'center',
      baseline = 'middle',
      shadow = null
    } = options;

    this.ctx.save();
    this.ctx.globalAlpha = alpha;
    this.ctx.font = font;
    this.ctx.fillStyle = fill;
    this.ctx.textAlign = align;
    this.ctx.textBaseline = baseline;

    if (shadow) {
      this.ctx.shadowColor = shadow.color || 'black';
      this.ctx.shadowBlur = shadow.blur || 0;
      this.ctx.shadowOffsetX = shadow.offsetX || 0;
      this.ctx.shadowOffsetY = shadow.offsetY || 0;
    }

    if (scale !== 1) {
      this.ctx.scale(scale, scale);
      this.ctx.fillText(text, x / scale, y / scale);
    } else {
      this.ctx.fillText(text, x, y);
    }

    this.ctx.restore();
  },

  /**
   * Draw a filled circle
   * @param {number} x - Center X
   * @param {number} y - Center Y
   * @param {number} radius - Circle radius
   * @param {string|CanvasGradient} fill - Fill style
   * @param {number} alpha - Opacity
   */
  fillCircle(x, y, radius, fill, alpha = 1) {
    if (!this.ctx) return;
    this.ctx.save();
    this.ctx.globalAlpha = alpha;
    this.ctx.fillStyle = fill;
    this.ctx.beginPath();
    this.ctx.arc(x, y, radius, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.restore();
  },

  /**
   * Draw a stroked arc
   * @param {number} x - Center X
   * @param {number} y - Center Y
   * @param {number} radius - Arc radius
   * @param {number} startAngle - Start angle in radians
   * @param {number} endAngle - End angle in radians
   * @param {Object} options - Stroke options
   */
  strokeArc(x, y, radius, startAngle, endAngle, options = {}) {
    if (!this.ctx) return;
    const { stroke = '#ffffff', lineWidth = 1, alpha = 1, lineDash = null } = options;

    this.ctx.save();
    this.ctx.globalAlpha = alpha;
    this.ctx.strokeStyle = stroke;
    this.ctx.lineWidth = lineWidth;
    if (lineDash) this.ctx.setLineDash(lineDash);
    this.ctx.beginPath();
    this.ctx.arc(x, y, radius, startAngle, endAngle);
    this.ctx.stroke();
    if (lineDash) this.ctx.setLineDash([]);
    this.ctx.restore();
  },

  /**
   * Draw a filled rectangle
   * @param {number} x - X position
   * @param {number} y - Y position
   * @param {number} width - Rectangle width
   * @param {number} height - Rectangle height
   * @param {string|CanvasGradient} fill - Fill style
   * @param {number} alpha - Opacity
   */
  fillRect(x, y, width, height, fill, alpha = 1) {
    if (!this.ctx) return;
    this.ctx.save();
    this.ctx.globalAlpha = alpha;
    this.ctx.fillStyle = fill;
    this.ctx.fillRect(x, y, width, height);
    this.ctx.restore();
  },

  /**
   * Draw a stroked rectangle
   * @param {number} x - X position
   * @param {number} y - Y position
   * @param {number} width - Rectangle width
   * @param {number} height - Rectangle height
   * @param {Object} options - Stroke options
   */
  strokeRect(x, y, width, height, options = {}) {
    if (!this.ctx) return;
    const { stroke = '#ffffff', lineWidth = 1, alpha = 1 } = options;

    this.ctx.save();
    this.ctx.globalAlpha = alpha;
    this.ctx.strokeStyle = stroke;
    this.ctx.lineWidth = lineWidth;
    this.ctx.strokeRect(x, y, width, height);
    this.ctx.restore();
  },

  /**
   * Create a radial gradient
   * @param {number} x - Center X
   * @param {number} y - Center Y
   * @param {number} innerRadius - Inner radius
   * @param {number} outerRadius - Outer radius
   * @param {Array<[number, string]>} colorStops - Array of [position, color] pairs
   * @returns {CanvasGradient}
   */
  createRadialGradient(x, y, innerRadius, outerRadius, colorStops) {
    if (!this.ctx) return null;
    const gradient = this.ctx.createRadialGradient(x, y, innerRadius, x, y, outerRadius);
    colorStops.forEach(([position, color]) => gradient.addColorStop(position, color));
    return gradient;
  },

  /**
   * Create a linear gradient
   * @param {number} x1 - Start X
   * @param {number} y1 - Start Y
   * @param {number} x2 - End X
   * @param {number} y2 - End Y
   * @param {Array<[number, string]>} colorStops - Array of [position, color] pairs
   * @returns {CanvasGradient}
   */
  createLinearGradient(x1, y1, x2, y2, colorStops) {
    if (!this.ctx) return null;
    const gradient = this.ctx.createLinearGradient(x1, y1, x2, y2);
    colorStops.forEach(([position, color]) => gradient.addColorStop(position, color));
    return gradient;
  },

  /**
   * Draw judgment text (styled text with shadow, centered)
   * @param {string} text - Text to display
   * @param {number} y - Y position
   * @param {number} alpha - Opacity (0-1)
   * @param {number} scale - Scale factor
   */
  drawJudgmentText(text, y, alpha, scale) {
    const { judgment } = CANVAS_THEME;
    this.drawText(text, this.width / 2, y, {
      alpha,
      scale,
      font: judgment.font,
      fill: judgment.fill,
      shadow: {
        color: judgment.shadowColor,
        blur: judgment.shadowBlur,
        offsetX: judgment.shadowOffset,
        offsetY: judgment.shadowOffset
      }
    });
  },

  /**
   * Draw health bar at the bottom of the screen
   * @param {number} health - Health value (0-100)
   */
  drawHealthBar(health) {
    if (!this.ctx) return;

    const barWidth = this.width - 20;
    const barHeight = 8;
    const x = 10;
    const y = this.height - 16;
    const cornerRadius = 4;

    // Background (dark)
    this.ctx.save();
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    this.ctx.beginPath();
    this.ctx.roundRect(x, y, barWidth, barHeight, cornerRadius);
    this.ctx.fill();

    // Health fill
    const healthPercent = Math.max(0, Math.min(100, health)) / 100;
    const fillWidth = barWidth * healthPercent;

    if (fillWidth > 0) {
      // Color gradient based on health level
      let color;
      if (health > 60) {
        color = '#22c55e'; // Green
      } else if (health > 30) {
        color = '#eab308'; // Yellow
      } else {
        color = '#ef4444'; // Red
      }

      // Add pulsing effect when health is low
      if (health <= 20) {
        const pulse = Math.sin(Date.now() / 200) * 0.3 + 0.7;
        this.ctx.globalAlpha = pulse;
      }

      this.ctx.fillStyle = color;
      this.ctx.beginPath();
      this.ctx.roundRect(x, y, fillWidth, barHeight, cornerRadius);
      this.ctx.fill();
    }

    // Border
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.roundRect(x, y, barWidth, barHeight, cornerRadius);
    this.ctx.stroke();

    this.ctx.restore();
  },

  /**
   * Draw autoplay indicator
   */
  drawAutoplayIndicator() {
    if (!this.ctx) return;

    this.drawText('🤖 AUTOPLAY', this.width / 2, 28, {
      font: 'bold 12px Arial',
      fill: '#60a5fa',
      shadow: {
        color: 'rgba(0, 0, 0, 0.8)',
        blur: 2,
        offsetX: 1,
        offsetY: 1
      }
    });
  },

  // Combo animation state
  _lastCombo: 0,
  _comboIncreaseTime: 0,

  /**
   * Get color based on combo tier
   * @param {number} combo
   * @returns {string}
   */
  _getComboColor(combo) {
    if (combo >= 100) return '#ff00ff'; // Magenta - legendary
    if (combo >= 50) return '#ffd700'; // Gold - amazing
    if (combo >= 30) return '#00ffff'; // Cyan - great
    if (combo >= 20) return '#00ff88'; // Green - good
    if (combo >= 10) return '#88aaff'; // Blue - building
    return '#aaaaaa'; // Gray - starting
  },

  /**
   * Draw combo counter on screen
   * @param {number} combo - Current combo count
   * @param {number} multiplier - Current multiplier (1-4)
   */
  drawCombo(combo, multiplier) {
    if (!this.ctx || combo < 4) return; // Only show after 4+ combo

    const now = performance.now();

    // Track combo increases for animation
    if (combo > this._lastCombo && this._lastCombo > 0) {
      this._comboIncreaseTime = now;
    }
    this._lastCombo = combo;

    const centerX = this.width / 2;
    const comboY = this.height * 0.65;

    // Pop animation on combo increase
    const timeSinceIncrease = now - this._comboIncreaseTime;
    let scale = 1;
    if (timeSinceIncrease < 150) {
      const progress = timeSinceIncrease / 150;
      scale = 1 + 0.25 * (1 - progress); // Pop from 1.25x to 1x
    }

    // Get color based on combo tier
    const color = this._getComboColor(combo);

    // Font size based on combo
    const baseSize = combo >= 100 ? 44 : combo >= 50 ? 40 : 36;
    const fontSize = Math.round(baseSize * scale);

    this.ctx.save();

    // Glow effect for high combos
    if (combo >= 20) {
      this.ctx.shadowColor = color;
      this.ctx.shadowBlur = 15 + (combo >= 50 ? 10 : 0);
    }

    // Draw combo number
    this.drawText(combo.toString(), centerX, comboY, {
      font: `bold ${fontSize}px "Segoe UI", Arial`,
      fill: color,
      shadow: {
        color: 'rgba(0, 0, 0, 0.8)',
        blur: 4,
        offsetX: 2,
        offsetY: 2
      }
    });

    this.ctx.restore();

    // Draw "COMBO" label below
    this.drawText('COMBO', centerX, comboY + 24, {
      font: 'bold 12px "Segoe UI", Arial',
      fill: color,
      alpha: 0.9,
      shadow: {
        color: 'rgba(0, 0, 0, 0.6)',
        blur: 2,
        offsetX: 1,
        offsetY: 1
      }
    });

    // Show multiplier badge when > 1x
    if (multiplier > 1) {
      const badgeX = centerX + (combo >= 100 ? 55 : combo >= 10 ? 45 : 35);
      this.drawText(`${multiplier}x`, badgeX, comboY - 12, {
        font: 'bold 14px "Segoe UI", Arial',
        fill: color,
        shadow: {
          color: 'rgba(0, 0, 0, 0.8)',
          blur: 2,
          offsetX: 1,
          offsetY: 1
        }
      });
    }

    // Milestone indicator at 50, 100, 150...
    if (combo % 50 === 0 && timeSinceIncrease < 500) {
      const milestoneAlpha = 1 - timeSinceIncrease / 500;
      this.drawText('★ MILESTONE ★', centerX, comboY - 35, {
        font: 'bold 16px "Segoe UI", Arial',
        fill: '#ffd700',
        alpha: milestoneAlpha,
        shadow: {
          color: 'rgba(0, 0, 0, 0.8)',
          blur: 4,
          offsetX: 1,
          offsetY: 1
        }
      });
    }
  },

  /**
   * Draw game over overlay
   */
  drawGameOver() {
    if (!this.ctx) return;

    // Darken the screen
    this.ctx.save();
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    this.ctx.fillRect(0, 0, this.width, this.height);

    // Draw "FAILED" text
    this.drawText('FAILED', this.width / 2, this.height / 2 - 20, {
      font: 'bold 48px Arial',
      fill: '#ef4444',
      shadow: {
        color: 'rgba(0, 0, 0, 0.8)',
        blur: 4,
        offsetX: 2,
        offsetY: 2
      }
    });

    this.drawText('Health Depleted', this.width / 2, this.height / 2 + 20, {
      font: '16px Arial',
      fill: '#ffffff',
      alpha: 0.8
    });

    this.ctx.restore();
  }
};

export default CanvasManager;

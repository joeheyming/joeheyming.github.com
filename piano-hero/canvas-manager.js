// Canvas manager — owns the falling-notes canvas, handles devicePixelRatio
// scaling, and re-fits on viewport changes. Modeled on stepmania's
// canvasManager.js, but smaller because we only ever draw to one stage.
//
// All draw calls in note-renderer.js work in CSS pixels; this module
// transparently scales the canvas's backing store for retina displays.

class CanvasManager {
  constructor() {
    /** @type {HTMLCanvasElement | null} */
    this.element = null;
    /** @type {CanvasRenderingContext2D | null} */
    this.ctx = null;
    /** CSS-pixel width / height. */
    this.width = 0;
    this.height = 0;
    this._dpr = 1;
    this._resizeBound = this._onResize.bind(this);
  }

  /**
   * @param {HTMLCanvasElement} canvas
   */
  init(canvas) {
    this.element = canvas;
    this.ctx = canvas.getContext('2d');
    this._ensureRoundRect(this.ctx);
    this._onResize();
    window.addEventListener('resize', this._resizeBound);
  }

  destroy() {
    window.removeEventListener('resize', this._resizeBound);
    this.element = null;
    this.ctx = null;
  }

  _onResize() {
    if (!this.element) return;
    const rect = this.element.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    if (w === this.width && h === this.height && dpr === this._dpr) return;
    this.width = w;
    this.height = h;
    this._dpr = dpr;
    this.element.width = Math.floor(w * dpr);
    this.element.height = Math.floor(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Call before each frame's draws. */
  beginFrame() {
    if (!this.element) return;
    // Backing-store geometry can change between frames (CSS resize from
    // device rotation, parent reflow). Re-check.
    const rect = this.element.getBoundingClientRect();
    if (Math.floor(rect.width) !== this.width || Math.floor(rect.height) !== this.height) {
      this._onResize();
    }
    this.ctx.clearRect(0, 0, this.width, this.height);
  }

  /** Older Safari/Chromium need this polyfill for ctx.roundRect. */
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
  }
}

const canvasManager = new CanvasManager();
export default canvasManager;

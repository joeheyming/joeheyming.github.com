import { createSlide, loadIframe, unloadIframe } from './video.js';

/**
 * @typedef {Object} CarouselElements
 * @property {HTMLElement} track          Container that holds the slides.
 * @property {HTMLElement} channelValue   Current channel display (numeric).
 * @property {HTMLElement} channelTotal   Total channel count.
 * @property {HTMLElement} knob           Channel knob (rotated as videos change).
 */

/**
 * Tiny carousel state machine. The carousel knows nothing about iframe
 * rendering beyond delegating to video.js — it just keeps a current index,
 * moves the track, and notifies listeners.
 */
export class Carousel {
  /** @param {CarouselElements} els */
  constructor(els) {
    this.els = els;
    /** @type {import('./channel.js').VideoEntry[]} */
    this.videos = [];
    this.currentIndex = 0;
    /** @type {Set<(video, index) => void>} */
    this._listeners = new Set();
    /** Per-slide click handler reference for cleanup, by slide element. */
    this._stageHandlers = new WeakMap();
  }

  /** @param {import('./channel.js').VideoEntry[]} videos */
  setVideos(videos) {
    this.videos = videos.slice();
    this.els.track.replaceChildren();
    videos.forEach((video, index) => {
      const slide = createSlide(video, index);
      this._wireStage(slide);
      this.els.track.appendChild(slide);
    });
    if (this.els.channelTotal) {
      this.els.channelTotal.textContent = `/ ${String(videos.length).padStart(2, '0')}`;
    }
    if (videos.length > 0) {
      // Land on a random channel, but show its thumbnail — don't autoload the iframe yet.
      // The iframe spins up the moment the viewer clicks Play or hits an arrow key.
      this.currentIndex = Math.floor(Math.random() * videos.length);
      this._applyTransform(false);
      this._updateChannelDisplay();
      this._emit();
    }
  }

  /** @returns {import('./channel.js').VideoEntry | null} */
  get currentVideo() {
    return this.videos[this.currentIndex] || null;
  }

  /** Returns the .carousel-slide element for the current index. */
  get currentSlide() {
    return this.els.track.children[this.currentIndex] || null;
  }

  /** @param {(video: import('./channel.js').VideoEntry, index: number) => void} cb */
  onChange(cb) {
    this._listeners.add(cb);
    return () => this._listeners.delete(cb);
  }

  /**
   * @param {number} index
   * @param {{ animate?: boolean }} [opts]
   */
  goTo(index, opts = {}) {
    if (this.videos.length === 0) return;
    const clamped = ((index % this.videos.length) + this.videos.length) % this.videos.length;
    if (clamped === this.currentIndex && this.currentSlide?.querySelector('iframe')) {
      return;
    }

    // Unload all slides except the one we're moving to so we never stack
    // multiple iframes playing audio simultaneously.
    for (let i = 0; i < this.videos.length; i++) {
      if (i !== clamped) unloadIframe(this.els.track.children[i]);
    }

    this.currentIndex = clamped;
    this._applyTransform(opts.animate);
    this._updateChannelDisplay();
    loadIframe(this.els.track.children[clamped], { autoplay: opts.animate !== false });
    this._emit();
  }

  next() {
    if (this.videos.length === 0) return;
    this.goTo(this.currentIndex + 1);
  }

  prev() {
    if (this.videos.length === 0) return;
    this.goTo(this.currentIndex - 1);
  }

  shuffle() {
    if (this.videos.length <= 1) return;
    let next = this.currentIndex;
    while (next === this.currentIndex) {
      next = Math.floor(Math.random() * this.videos.length);
    }
    this.goTo(next);
  }

  _applyTransform(animate = true) {
    this.els.track.style.transition = animate
      ? 'transform 0.5s cubic-bezier(0.16, 1, 0.3, 1)'
      : 'none';
    this.els.track.style.transform = `translateX(${-this.currentIndex * 100}%)`;
  }

  _updateChannelDisplay() {
    if (this.els.channelValue) {
      // Show 1-indexed, zero-padded — looks the part on a CRT
      const n = this.currentIndex + 1;
      this.els.channelValue.textContent = String(n).padStart(2, '0');
    }
    if (this.els.knob && this.videos.length > 0) {
      // Knob rotates from 0° (channel 1) to 330° (last channel), wrapping nicely
      const deg = (this.currentIndex / this.videos.length) * 330;
      this.els.knob.style.transform = `rotate(${deg}deg)`;
    }
  }

  _wireStage(slide) {
    const stage = slide.querySelector('.video-stage');
    if (!stage) return;
    const handler = (e) => {
      // If the iframe is already loaded, the iframe captures clicks itself
      if (stage.querySelector('iframe')) return;
      const index = Number(slide.dataset.videoIndex);
      if (Number.isNaN(index)) return;
      // Spacebar/Enter trigger the same action when focused
      if (e.type === 'keydown') {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
      }
      this.goTo(index);
    };
    stage.addEventListener('click', handler);
    stage.addEventListener('keydown', handler);
    this._stageHandlers.set(slide, handler);
  }

  _emit() {
    const video = this.currentVideo;
    if (!video) return;
    for (const cb of this._listeners) {
      try {
        cb(video, this.currentIndex);
      } catch (err) {
        console.error('[carousel] listener threw:', err);
      }
    }
  }
}

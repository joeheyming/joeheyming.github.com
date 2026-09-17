/**
 * Heyming OS - Taskbar Clock
 * Shows current time in the taskbar
 */

import { patchPrefs, loadPrefs } from './prefs.js';

export class Clock {
  constructor() {
    this.element = null;
    this.intervalId = null;
    this.showSeconds = false;
  }

  /**
   * Initialize the clock
   */
  init() {
    this.element = document.getElementById('taskbar-clock');
    if (!this.element) return;

    const prefs = loadPrefs();
    this.showSeconds = Boolean(prefs.clockShowSeconds);

    this.element.addEventListener('click', () => this.toggleSeconds());
    this.element.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.toggleSeconds();
      }
    });

    // Update immediately and then every second
    this.update();
    this.intervalId = setInterval(() => this.update(), 1000);
  }

  /**
   * @param {boolean} show
   */
  setShowSeconds(show) {
    this.showSeconds = Boolean(show);
    this.update();
  }

  toggleSeconds() {
    this.setShowSeconds(!this.showSeconds);
    patchPrefs({ clockShowSeconds: this.showSeconds });
  }

  /**
   * Update the clock display
   */
  update() {
    if (!this.element) return;

    const now = new Date();
    /** @type {Intl.DateTimeFormatOptions} */
    const options = {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    };

    if (this.showSeconds) {
      options.second = '2-digit';
    }

    const timeStr = now.toLocaleTimeString(undefined, options);
    this.element.textContent = timeStr;
    /** @type {HTMLTimeElement} */ (this.element).dateTime = now.toISOString();
    this.element.setAttribute('aria-pressed', this.showSeconds ? 'true' : 'false');
    this.element.title = now.toLocaleDateString(undefined, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }

  /**
   * Stop the clock
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}

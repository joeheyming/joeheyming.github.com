/**
 * Heyming OS - Taskbar Clock
 * Shows current time in the taskbar
 */

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

    // Toggle seconds on click
    this.element.addEventListener('click', () => {
      this.showSeconds = !this.showSeconds;
      this.update();
    });

    // Update immediately and then every second
    this.update();
    this.intervalId = setInterval(() => this.update(), 1000);
  }

  /**
   * Update the clock display
   */
  update() {
    if (!this.element) return;

    const now = new Date();
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

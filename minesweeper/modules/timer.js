/**
 * Minesweeper Timer Module
 * Handles game timer functionality
 */

export class Timer {
  constructor(onTick) {
    this.time = 0;
    this.interval = null;
    this.onTick = onTick;
    this.maxTime = 999;
  }

  start() {
    if (this.interval) return;

    this.interval = setInterval(() => {
      this.time++;
      if (this.time > this.maxTime) {
        this.time = this.maxTime;
      }
      this.onTick?.(this.time);
    }, 1000);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  reset() {
    this.stop();
    this.time = 0;
    this.onTick?.(this.time);
  }

  getTime() {
    return this.time;
  }

  isRunning() {
    return this.interval !== null;
  }
}

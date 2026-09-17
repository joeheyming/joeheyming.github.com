/**
 * Idle screensaver overlay for Heyming OS.
 */

import { Constants } from './constants.js';

export class Screensaver {
  constructor() {
    this.overlay = null;
    this.clockEl = null;
    this.timerId = null;
    this.clockInterval = null;
    this.enabled = false;
    this.timeoutMs = 120000;
    this.style = 'clock';
    this.visible = false;
    this._onActivity = this._onActivity.bind(this);
    this._dismiss = this._dismiss.bind(this);
  }

  init() {
    this.overlay = document.createElement('div');
    this.overlay.id = 'os-screensaver';
    this.overlay.className = 'os-screensaver hidden';
    this.overlay.setAttribute('role', 'dialog');
    this.overlay.setAttribute('aria-label', 'Screensaver');
    this.overlay.setAttribute('aria-hidden', 'true');
    this.overlay.style.zIndex = String(Constants.Z_INDEX_SCREENSAVER);

    this.clockEl = document.createElement('div');
    this.clockEl.className = 'os-screensaver-clock';
    this.overlay.appendChild(this.clockEl);

    const host = document.getElementById('heyming-os') || document.body;
    host.appendChild(this.overlay);

    this.overlay.addEventListener('pointerdown', this._dismiss);
    document.addEventListener('pointerdown', this._onActivity, true);
    document.addEventListener('keydown', this._onActivity, true);
    document.addEventListener('mousemove', this._onActivity, true);
  }

  /**
   * @param {{ enabled?: boolean, timeoutMs?: number, style?: string }} prefs
   */
  apply(prefs) {
    this.enabled = Boolean(prefs?.enabled);
    this.timeoutMs = Number(prefs?.timeoutMs) || 120000;
    this.style = prefs?.style === 'blank' ? 'blank' : 'clock';
    this.overlay?.classList.toggle('os-screensaver-blank', this.style === 'blank');
    if (!this.enabled) {
      this._hide();
      this._clearTimer();
      return;
    }
    this._arm();
  }

  _setupWizardOpen() {
    const wizard = document.getElementById('os-setup-wizard');
    return Boolean(wizard && !wizard.classList.contains('hidden'));
  }

  _onActivity(e) {
    if (this.visible) {
      if (e.type === 'keydown' || e.type === 'pointerdown') {
        this._dismiss(e);
      }
      return;
    }
    if (!this.enabled) return;
    this._arm();
  }

  _arm() {
    this._clearTimer();
    if (!this.enabled || this._setupWizardOpen()) return;
    this.timerId = window.setTimeout(() => this._show(), this.timeoutMs);
  }

  _show() {
    if (!this.enabled || this._setupWizardOpen() || !this.overlay) return;
    this.visible = true;
    this.overlay.classList.remove('hidden');
    this.overlay.setAttribute('aria-hidden', 'false');
    this._tickClock();
    if (this.style === 'clock') {
      this.clockInterval = window.setInterval(() => this._tickClock(), 1000);
    }
  }

  _hide() {
    this.visible = false;
    this.overlay?.classList.add('hidden');
    this.overlay?.setAttribute('aria-hidden', 'true');
    if (this.clockInterval) {
      clearInterval(this.clockInterval);
      this.clockInterval = null;
    }
  }

  _dismiss(e) {
    if (!this.visible) return;
    e?.preventDefault?.();
    e?.stopPropagation?.();
    e?.stopImmediatePropagation?.();
    this._hide();
    this._arm();
  }

  _tickClock() {
    if (!this.clockEl) return;
    if (this.style === 'blank') {
      this.clockEl.textContent = '';
      return;
    }
    const now = new Date();
    this.clockEl.textContent = now.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  _clearTimer() {
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }
}

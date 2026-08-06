/**
 * Heyming OS — taskbar presence chip.
 * Shows how many people are on the site. Heartbeats as `os` only while
 * no app windows are open (open windows heartbeat via their iframes).
 */

const OS_PRESENCE_PAGE = 'os';
const OS_PRESENCE_REFRESH_MS = 60000;
const OS_PRESENCE_TIP_DELAY_MS = 60;

export class PresenceIndicator {
  /**
   * @param {{ getAllWindows?: () => unknown[] } | null} [windowManager]
   */
  constructor(windowManager = null) {
    this.windowManager = windowManager;
    this.element = null;
    this.intervalId = null;
    /** @type {HTMLElement | null} */
    this.tipEl = null;
    /** @type {ReturnType<typeof setTimeout> | null} */
    this.tipTimer = null;
  }

  init() {
    this.element = document.getElementById('taskbar-presence');
    const api = window.heymingPresence;
    if (!this.element || !api || typeof api.isConfigured !== 'function' || !api.isConfigured()) {
      if (this.element) this.element.hidden = true;
      return;
    }

    this.element.addEventListener('pointerenter', () => this.showTip());
    this.element.addEventListener('pointerleave', () => this.hideTip());
    this.element.addEventListener('focus', () => this.showTip());
    this.element.addEventListener('blur', () => this.hideTip());

    this.syncHeartbeat();
    this.refresh();
    this.intervalId = setInterval(() => this.refresh(), OS_PRESENCE_REFRESH_MS);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.refresh();
      else this.hideTip();
    });
  }

  /** True when the desktop itself should claim the presence UUID. */
  shouldHeartbeat() {
    if (!this.windowManager || typeof this.windowManager.getAllWindows !== 'function') {
      return true;
    }
    return this.windowManager.getAllWindows().length === 0;
  }

  /**
   * Call after windows open/close so the shell stops fighting iframe
   * heartbeats for the same UUID.
   */
  syncHeartbeat() {
    const api = window.heymingPresence;
    if (!api || typeof api.isConfigured !== 'function' || !api.isConfigured()) return;

    if (this.shouldHeartbeat()) {
      if (typeof api.start === 'function') api.start(OS_PRESENCE_PAGE);
      else if (typeof api.setPage === 'function') api.setPage(OS_PRESENCE_PAGE);
    } else if (typeof api.setPage === 'function') {
      // Clear page key — interval still runs but skips ping when null.
      api.setPage(null);
    }
  }

  async refresh() {
    if (!this.element) return;
    const api = window.heymingPresence;
    if (!api || typeof api.isConfigured !== 'function' || !api.isConfigured()) {
      this.element.hidden = true;
      this.hideTip();
      return;
    }

    this.syncHeartbeat();

    try {
      const counts = await api.fetchCounts(OS_PRESENCE_PAGE);
      // Include self so the chip stays visible when you're alone in /os/.
      let total = 1;
      for (const n of Object.values(counts || {})) {
        total += Number(n) || 0;
      }

      const label =
        total === 1 ? '1 person on the site right now' : total + ' people on the site right now';
      this.element.hidden = false;
      this.element.textContent = String(total);
      this.element.setAttribute('aria-label', label);
      this.element.setAttribute('data-tip', label);
      this.element.title = label;
      if (this.tipEl) this.tipEl.textContent = label;
    } catch (err) {
      console.warn('[PresenceIndicator] refresh failed', err);
      this.element.hidden = true;
      this.hideTip();
    }
  }

  showTip() {
    if (!this.element || this.element.hidden) return;
    const text = this.element.getAttribute('data-tip');
    if (!text) return;
    this.hideTip();
    this.tipTimer = setTimeout(() => {
      this.tipTimer = null;
      this.tipEl = document.createElement('div');
      this.tipEl.className = 'taskbar-presence-tip';
      this.tipEl.setAttribute('role', 'tooltip');
      this.tipEl.textContent = text;
      document.body.appendChild(this.tipEl);
      this.positionTip();
      requestAnimationFrame(() => {
        if (this.tipEl) this.tipEl.classList.add('is-visible');
      });
    }, OS_PRESENCE_TIP_DELAY_MS);
  }

  positionTip() {
    if (!this.tipEl || !this.element) return;
    const rect = this.element.getBoundingClientRect();
    const tipRect = this.tipEl.getBoundingClientRect();
    const gap = 8;
    let left = rect.left + (rect.width - tipRect.width) / 2;
    let top = rect.top - tipRect.height - gap;
    if (left < 8) left = 8;
    if (left + tipRect.width > window.innerWidth - 8) {
      left = window.innerWidth - tipRect.width - 8;
    }
    if (top < 8) top = rect.bottom + gap;
    this.tipEl.style.left = Math.round(left) + 'px';
    this.tipEl.style.top = Math.round(top) + 'px';
  }

  hideTip() {
    if (this.tipTimer != null) {
      clearTimeout(this.tipTimer);
      this.tipTimer = null;
    }
    if (this.tipEl) {
      this.tipEl.remove();
      this.tipEl = null;
    }
  }

  stop() {
    this.hideTip();
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}

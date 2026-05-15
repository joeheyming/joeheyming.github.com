/**
 * Shared toast / notification module.
 *
 * Replaces the per-app `showToast` / `toast()` / `showShareToast` helpers
 * that were drifting on three axes:
 *   • timing       — 1.8 s vs 2.4 s vs 3 s vs 4 s with no consistent rationale
 *   • a11y         — some had close buttons, role="status", or live regions; many didn't
 *   • escaping     — stock used innerHTML+escapeHtml, others used textContent;
 *                    that divergence is exactly the kind that drifts into XSS
 *
 * The visual *style* (colors, position, animations) is intentionally NOT
 * shared — each app picks its own CSS. The module owns the LOGIC and the
 * SAFETY: textContent always, ARIA always, predictable lifecycle.
 *
 * Usage (standalone page, paints into a stack DIV the page already owns):
 *
 *     import { createNotifier } from '/notifications.js';
 *     const notify = createNotifier({
 *       container: document.getElementById('toast-stack'),
 *       kindClass: (k) => `toast toast-${k}`,    // matches existing CSS
 *       defaultDurationMs: 4000,
 *       dismissible: true,
 *     });
 *     notify('Saved.', { kind: 'success' });
 *
 * Usage (HeymingOS-embedded app — see `os-embed.js`):
 *
 *     The os-embed module wires `notify()` to forward to the parent
 *     HeymingOS NotificationService instead of painting locally. Apps
 *     should not call NotificationService directly.
 */

const KINDS = new Set(['info', 'success', 'warn', 'error', 'alert']);

/**
 * @typedef {Object} NotifierConfig
 * @property {HTMLElement | string} [container]
 *   Element (or selector) the notifier appends into. Created lazily as a
 *   <div class="notify-stack"> on document.body if not provided.
 * @property {(kind: string) => string} [kindClass]
 *   Maps a notification kind ("info" / "success" / ...) to the CSS class
 *   string for the element. Default: `notify notify-${kind}`.
 * @property {number} [defaultDurationMs]
 *   How long a notification stays visible if the caller doesn't override.
 *   Defaults to 3000. Pass 0 to a single call to make that one persistent.
 * @property {{ outClass: string, outMs: number } | false} [fadeOut]
 *   When set, the notifier adds `outClass` to the element `outMs` ms
 *   before removal — gives CSS a chance to animate fade-out. Default off.
 * @property {boolean} [dismissible]
 *   When true, every notification gets a "×" close button and clicking
 *   it removes the notification. Default false.
 * @property {string} [closeLabel]
 *   ARIA label for the close button. Default "Dismiss".
 */

/**
 * @typedef {Object} NotifyOptions
 * @property {string} [kind]
 *   "info" (default), "success", "warn", "error", "alert".
 * @property {number} [durationMs]
 *   Override the default duration for this call. 0 = persistent.
 * @property {boolean} [dismissible]
 *   Override the notifier-wide dismissible setting for this call.
 */

/**
 * Create a notifier bound to a container and a CSS class policy.
 *
 * Returns `{ notify, clear }`. `notify(msg, opts)` returns the dismiss
 * function so callers can dismiss the notification programmatically
 * (e.g. tied to an in-flight request resolving). `clear()` removes all
 * outstanding notifications.
 *
 * @param {NotifierConfig} [config]
 * @returns {{ notify: (message: string, opts?: NotifyOptions) => () => void, clear: () => void }}
 */
export function createNotifier(config = {}) {
  const kindClass = config.kindClass || ((k) => `notify notify-${k}`);
  const defaultDurationMs = Number.isFinite(config.defaultDurationMs)
    ? config.defaultDurationMs
    : 3000;
  const fadeOut = config.fadeOut || null;
  const dismissibleDefault = !!config.dismissible;
  const closeLabel = typeof config.closeLabel === 'string' ? config.closeLabel : 'Dismiss';

  /** @type {HTMLElement | null} */
  let containerEl = null;
  function getContainer() {
    if (containerEl && containerEl.isConnected) return containerEl;
    if (config.container instanceof HTMLElement) {
      containerEl = config.container;
    } else if (typeof config.container === 'string') {
      containerEl = /** @type {HTMLElement | null} */ (document.querySelector(config.container));
    }
    if (!containerEl) {
      // Lazy fallback: append to body. Apps that want a custom location
      // pass `container` explicitly.
      containerEl = document.createElement('div');
      containerEl.className = 'notify-stack';
      document.body.appendChild(containerEl);
    }
    return containerEl;
  }

  /** @type {Set<HTMLElement>} */
  const live = new Set();

  function dismiss(el) {
    if (!live.has(el)) return;
    live.delete(el);
    if (fadeOut) {
      el.classList.add(fadeOut.outClass);
      setTimeout(() => el.remove(), fadeOut.outMs);
    } else {
      el.remove();
    }
  }

  /**
   * @param {string} message
   * @param {NotifyOptions} [opts]
   */
  function notify(message, opts = {}) {
    const kind = KINDS.has(opts.kind || '') ? /** @type {string} */ (opts.kind) : 'info';
    const durationMs = Number.isFinite(opts.durationMs) ? opts.durationMs : defaultDurationMs;
    const dismissible = opts.dismissible ?? dismissibleDefault;

    const el = document.createElement('div');
    el.className = kindClass(kind);
    // ARIA: assertive for error/alert (interrupts the user), polite
    // otherwise. Browsers / screen readers handle the rest.
    el.setAttribute('role', kind === 'error' || kind === 'alert' ? 'alert' : 'status');
    el.setAttribute('aria-live', kind === 'error' || kind === 'alert' ? 'assertive' : 'polite');

    const text = document.createElement('span');
    // textContent (NOT innerHTML) — the entire reason the per-app drift
    // mattered. A toast carrying a stock symbol or filename should not
    // be a script-injection vector.
    text.textContent = String(message);
    el.appendChild(text);

    if (dismissible) {
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'notify-close';
      close.setAttribute('aria-label', closeLabel);
      close.textContent = '×';
      close.addEventListener('click', () => dismiss(el));
      el.appendChild(close);
    }

    getContainer().appendChild(el);
    live.add(el);

    let timer = null;
    if (durationMs > 0) {
      timer = setTimeout(() => dismiss(el), durationMs);
    }

    return function dismissNow() {
      if (timer) clearTimeout(timer);
      dismiss(el);
    };
  }

  function clear() {
    for (const el of [...live]) dismiss(el);
  }

  return { notify, clear };
}

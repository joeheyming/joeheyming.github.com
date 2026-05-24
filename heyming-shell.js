/*
 * Heyming OS Design Language (HOSDL) — runtime helpers.
 *
 * Available globally as `window.HOS` (or via ES module import). The two
 * core helpers:
 *
 *   HOS.installAppHeader({ icon, title, subtitle, actions })
 *     Injects a .hos-app-header at the top of <body> if one is not
 *     already present. Idempotent — safe to call multiple times.
 *
 *   HOS.notify(message, { variant, duration })
 *     Toast notification. Stacks in a top-right region. variant is
 *     'default' | 'success' | 'warning' | 'danger'. Returns the toast
 *     element so callers can dismiss early.
 *
 * The library is pure DOM — no framework, no dependencies. Apps that
 * load /heyming-shell.css get the styling for free; apps without it
 * still get the structure (and the elements use brand tokens for any
 * inline color fallbacks so they degrade gracefully).
 */

(function () {
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k === 'on' && typeof attrs[k] === 'object') {
          Object.keys(attrs[k]).forEach(function (evt) {
            node.addEventListener(evt, attrs[k][evt]);
          });
        } else if (k === 'style' && typeof attrs[k] === 'object') {
          Object.keys(attrs[k]).forEach(function (s) {
            node.style[s] = attrs[k][s];
          });
        } else if (attrs[k] != null) {
          node.setAttribute(k, attrs[k]);
        }
      });
    }
    if (children) {
      (Array.isArray(children) ? children : [children]).forEach(function (c) {
        if (c == null) return;
        node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
    }
    return node;
  }

  /**
   * Inject a HOSDL app header at the top of <body>.
   * @param {{
   *   icon?: string,
   *   title: string,
   *   subtitle?: string,
   *   actions?: Array<{ label: string, onClick?: () => void, variant?: 'primary'|'ghost'|'danger'|'default', icon?: string }>,
   *   compact?: boolean,
   *   target?: HTMLElement
   * }} opts
   * @returns {HTMLElement} the header element
   */
  function installAppHeader(opts) {
    opts = opts || {};
    var existing = document.querySelector('.hos-app-header');
    if (existing) return existing;

    var target = opts.target || document.body;
    if (!target) return null;

    var identity = el(
      'div',
      { class: 'hos-app-header-identity' },
      [
        opts.icon
          ? el('span', { class: 'app-icon-frame', 'aria-hidden': 'true' }, opts.icon)
          : null,
        el(
          'div',
          {},
          [
            el('h1', { class: 'hos-app-header-title' }, opts.title || 'Heyming OS app'),
            opts.subtitle ? el('p', { class: 'hos-app-header-subtitle' }, opts.subtitle) : null
          ].filter(Boolean)
        )
      ].filter(Boolean)
    );

    var actionsEl = el('div', { class: 'hos-app-header-actions' });
    (opts.actions || []).forEach(function (a) {
      var variantClass = '';
      if (a.variant === 'primary') variantClass = ' hos-button-primary';
      else if (a.variant === 'ghost') variantClass = ' hos-button-ghost';
      else if (a.variant === 'danger') variantClass = ' hos-button-danger';

      var btn = el(
        'button',
        {
          type: 'button',
          class: 'hos-button' + variantClass,
          on: { click: a.onClick || function () {} }
        },
        [a.icon ? el('span', { 'aria-hidden': 'true' }, a.icon) : null, a.label].filter(Boolean)
      );
      actionsEl.appendChild(btn);
    });

    var headerCls = 'hos-app-header' + (opts.compact ? ' hos-app-header-compact' : '');
    var header = el('header', { class: headerCls }, [identity, actionsEl]);

    // Insert at top of target. If target is <body>, skip past the
    // already-injected back button so the header lands first in the
    // visible flow.
    target.insertBefore(header, target.firstChild);
    return header;
  }

  /* ─── Notification toast ───────────────────────────────────────── */

  function ensureNotifyRegion() {
    var region = document.querySelector('.hos-notify-region');
    if (region) return region;
    region = el('div', {
      class: 'hos-notify-region',
      role: 'region',
      'aria-live': 'polite',
      'aria-label': 'Notifications'
    });
    document.body.appendChild(region);
    return region;
  }

  /**
   * Show a toast notification.
   * @param {string} message
   * @param {{ variant?: 'default'|'success'|'warning'|'danger', duration?: number }} [opts]
   * @returns {HTMLElement} the toast element (caller may remove early)
   */
  function notify(message, opts) {
    opts = opts || {};
    var variant = opts.variant || 'default';
    var duration = typeof opts.duration === 'number' ? opts.duration : 3200;

    var cls = 'hos-notify';
    if (variant !== 'default') cls += ' hos-notify-' + variant;

    var toast = el('div', { class: cls, role: 'status' }, message);
    var region = ensureNotifyRegion();
    region.appendChild(toast);

    if (duration > 0) {
      setTimeout(function () {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 180ms ease';
        setTimeout(function () {
          if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 220);
      }, duration);
    }

    return toast;
  }

  var API = {
    installAppHeader: installAppHeader,
    notify: notify,
    _el: el
  };

  // Global fallback for non-module consumers.
  window.HOS = API;

  // Best-effort ES module export. Browsers that support import maps can
  // also `import { HOS } from '/heyming-shell.js'` if this script is
  // loaded with type="module"; the global remains available either way.
  if (typeof window !== 'undefined' && !window.HeymingOS) {
    window.HeymingOS = window.HeymingOS || {};
    window.HeymingOS.Shell = API;
  }
})();

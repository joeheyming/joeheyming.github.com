// Desktop achievement toast UI. Loaded dynamically by achievements.js.
// Subscribes to heymingAchievements so unlocks show a notification.
(function () {
  'use strict';

  if (window.HeymingAchievementToasts) return;

  const DESKTOP_QUERY = '(min-width: 769px)';
  const toastQueue = [];
  let showingToast = false;
  let wired = false;

  function shouldShowToast() {
    return (
      window.self === window.top &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia(DESKTOP_QUERY).matches
    );
  }

  function ensureToastHost() {
    let host = document.querySelector('heyming-achievement-toasts');
    if (host) return host;
    host = document.createElement('heyming-achievement-toasts');
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host {
          position: fixed;
          z-index: 2147483646;
          top: max(18px, env(safe-area-inset-top));
          right: max(18px, env(safe-area-inset-right));
          width: min(360px, calc(100vw - 36px));
          pointer-events: none;
          font-family: "Courier New", ui-monospace, monospace;
        }
        .toast {
          display: grid;
          grid-template-columns: 48px 1fr;
          gap: 12px;
          align-items: center;
          box-sizing: border-box;
          min-height: 76px;
          padding: 12px;
          color: #fff;
          text-decoration: none;
          background:
            linear-gradient(rgba(21, 21, 21, .94), rgba(7, 7, 7, .97)),
            repeating-linear-gradient(0deg, transparent 0 3px, rgba(255,255,255,.03) 3px 4px);
          border: 3px solid #8b8b8b;
          border-top-color: #c6c6c6;
          border-left-color: #c6c6c6;
          box-shadow: inset 0 0 0 2px #282828, 0 6px 20px rgba(0,0,0,.45);
          image-rendering: pixelated;
          cursor: pointer;
          pointer-events: auto;
          transform: translateX(calc(100% + 24px));
          opacity: 0;
          animation: achievement-in .28s steps(5, end) forwards;
        }
        .toast:hover,
        .toast:focus-visible {
          border-color: #ffff55;
          border-top-color: #fffbbb;
          border-left-color: #fffbbb;
          outline: none;
        }
        .toast.leaving {
          animation: achievement-out .24s steps(4, end) forwards;
        }
        .icon {
          display: grid;
          place-items: center;
          width: 44px;
          height: 44px;
          box-sizing: border-box;
          font-size: 27px;
          background: #777;
          border: 3px solid #333;
          border-top-color: #aaa;
          border-left-color: #aaa;
        }
        .eyebrow {
          margin: 0 0 4px;
          color: #ffff55;
          font-size: 13px;
          line-height: 1;
          text-shadow: 2px 2px #3f3f00;
        }
        .title {
          margin: 0;
          color: #fff;
          font-size: 17px;
          line-height: 1.2;
          text-shadow: 2px 2px #3f3f3f;
        }
        .cta {
          margin: 5px 0 0;
          color: #a8a8a8;
          font-size: 12px;
          line-height: 1;
        }
        .toast:hover .cta,
        .toast:focus-visible .cta {
          color: #ffff55;
        }
        @keyframes achievement-in {
          to { transform: translateX(0); opacity: 1; }
        }
        @keyframes achievement-out {
          from { transform: translateX(0); opacity: 1; }
          to { transform: translateX(calc(100% + 24px)); opacity: 0; }
        }
        @media (max-width: 768px) {
          :host { display: none; }
        }
        @media (prefers-reduced-motion: reduce) {
          .toast { animation: none; transform: none; opacity: 1; }
          .toast.leaving { animation: none; opacity: 0; }
        }
      </style>
      <div id="stack" role="status" aria-live="polite" aria-atomic="true"></div>
    `;
    (document.body || document.documentElement).appendChild(host);
    return host;
  }

  function enqueueToast(definition) {
    if (!definition || !shouldShowToast()) return;
    toastQueue.push(definition);
    showNextToast();
  }

  function showNextToast() {
    if (showingToast || toastQueue.length === 0 || !shouldShowToast()) return;
    showingToast = true;
    const definition = toastQueue.shift();
    const host = ensureToastHost();
    const stack = host.shadowRoot?.getElementById('stack');
    if (!stack) {
      showingToast = false;
      return;
    }

    const toast = document.createElement('a');
    toast.className = 'toast';
    toast.href = '/achievements/';
    toast.target = '_blank';
    toast.rel = 'noopener';
    toast.setAttribute(
      'aria-label',
      `Achievement awarded: ${definition.title}. Open achievements.`
    );
    const icon = document.createElement('span');
    icon.className = 'icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = definition.icon || '🏆';
    const copy = document.createElement('div');
    const eyebrow = document.createElement('p');
    eyebrow.className = 'eyebrow';
    eyebrow.textContent = 'Achievement awarded';
    const title = document.createElement('p');
    title.className = 'title';
    title.textContent = definition.title;
    const cta = document.createElement('p');
    cta.className = 'cta';
    cta.textContent = 'Open achievements ↗';
    copy.append(eyebrow, title, cta);
    toast.append(icon, copy);
    stack.appendChild(toast);

    let dismissTimer = null;
    let dismissed = false;
    function dismiss() {
      if (dismissed) return;
      dismissed = true;
      toast.classList.add('leaving');
      window.setTimeout(() => {
        toast.remove();
        showingToast = false;
        showNextToast();
      }, 280);
    }
    function scheduleDismiss() {
      if (dismissed) return;
      if (dismissTimer !== null) window.clearTimeout(dismissTimer);
      dismissTimer = window.setTimeout(dismiss, 4200);
    }
    // The toast is a link now, so a fixed 4.2s window would yank it away
    // mid-click. Hovering or focusing holds it open.
    function holdOpen() {
      if (dismissTimer === null) return;
      window.clearTimeout(dismissTimer);
      dismissTimer = null;
    }
    toast.addEventListener('pointerenter', holdOpen);
    toast.addEventListener('focus', holdOpen);
    toast.addEventListener('pointerleave', scheduleDismiss);
    toast.addEventListener('blur', scheduleDismiss);
    scheduleDismiss();
  }

  function wireToAchievements() {
    if (wired) return;
    const api = window.heymingAchievements;
    if (!api?.ready || typeof api.subscribe !== 'function') return;
    wired = true;
    api.ready.then((boot) => {
      const list = Array.isArray(boot?.catalog) ? boot.catalog : [];
      api.subscribe((detail) => {
        if (!detail || detail.source !== 'local' || typeof detail.id !== 'string') return;
        const definition = list.find((achievement) => achievement.id === detail.id);
        if (definition) enqueueToast(definition);
      });
    });
  }

  window.HeymingAchievementToasts = {
    enqueue: enqueueToast,
    wire: wireToAchievements
  };

  wireToAchievements();
})();

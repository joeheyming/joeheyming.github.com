// Site-wide achievements: persistent unlock state and desktop notifications.
(function () {
  'use strict';

  if (window.heymingAchievements) return;

  const STORAGE_KEY = 'heyming.achievements.v1';
  const DESKTOP_QUERY = '(min-width: 769px)';
  const listeners = new Set();
  const toastQueue = [];
  const blockedAnalyticsIds = new Set();
  let showingToast = false;
  let catalog = [];
  let registry = [];

  function emptyState() {
    return { version: 1, unlocked: {} };
  }

  function readState() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return emptyState();
      const parsed = JSON.parse(raw);
      if (parsed?.version !== 1 || !parsed.unlocked || typeof parsed.unlocked !== 'object') {
        return emptyState();
      }
      return parsed;
    } catch {
      return emptyState();
    }
  }

  let state = readState();

  function writeState() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch {
      return false;
    }
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        if (existing.dataset.loaded === '1' || window.HeymingRegistryPath) {
          resolve();
          return;
        }
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), {
          once: true
        });
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.async = false;
      const timer = setTimeout(() => reject(new Error(`Timeout loading ${src}`)), 3000);
      script.addEventListener('load', () => {
        clearTimeout(timer);
        script.dataset.loaded = '1';
        resolve();
      });
      script.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error(`Failed to load ${src}`));
      });
      document.head.appendChild(script);
    });
  }

  function ensureRegistryPath() {
    if (window.HeymingRegistryPath) return Promise.resolve();
    return loadScript('/shared/registry-path.js');
  }

  function getCurrentAppId() {
    const api = window.HeymingRegistryPath;
    if (!api) {
      const here = (window.location.pathname || '/')
        .replace(/\/index\.html$/i, '')
        .replace(/\/+$/, '');
      const segments = (here || '/').split('/').filter(Boolean);
      return segments[0] || 'home';
    }
    return api.resolveAppIdFromLocation(registry, {
      pathname: window.location.pathname,
      search: window.location.search
    });
  }

  function getDefinition(id) {
    return catalog.find((achievement) => achievement.id === id) || null;
  }

  function track(eventName, label, value) {
    if (typeof window.trackEvent === 'function') {
      window.trackEvent(eventName, 'Achievements', label, value);
    }
  }

  function notifySubscribers(id, source) {
    const detail = { id, source, unlocked: getUnlocked() };
    for (const listener of listeners) {
      try {
        listener(detail);
      } catch (error) {
        console.warn('[achievements] subscriber failed', error);
      }
    }
    window.dispatchEvent(new CustomEvent('heyming-achievement-change', { detail }));
  }

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
    if (!shouldShowToast()) return;
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
    toast.addEventListener('click', () => {
      track('achievement_toast_click', definition.id);
    });
    stack.appendChild(toast);
    track('achievement_toast_shown', definition.id);

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

  function getUnlocked() {
    return { ...state.unlocked };
  }

  function isUnlocked(id) {
    return Object.prototype.hasOwnProperty.call(state.unlocked, id);
  }

  async function unlock(id) {
    await ready;
    if (typeof id !== 'string' || isUnlocked(id)) return false;
    const definition = getDefinition(id);
    if (!definition) {
      console.warn(`[achievements] Unknown achievement: ${id}`);
      return false;
    }
    if (definition.requiresId && !isUnlocked(definition.requiresId)) {
      if (!blockedAnalyticsIds.has(id)) {
        blockedAnalyticsIds.add(id);
        track('achievement_unlock_blocked', id);
      }
      return false;
    }

    const unlockedAt = new Date().toISOString();
    state = {
      version: 1,
      unlocked: {
        ...state.unlocked,
        [id]: { unlockedAt }
      }
    };
    writeState();
    enqueueToast(definition);
    notifySubscribers(id, 'local');
    track('achievement_unlocked', id);
    return true;
  }

  async function unlockForCurrentApp(slug) {
    await ready;
    return unlock(`${getCurrentAppId()}:${slug}`);
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  const ready = ensureRegistryPath()
    .then(() =>
      Promise.all([
        fetch('/achievements-catalog.json').then((response) => {
          if (!response.ok) throw new Error(`catalog HTTP ${response.status}`);
          return response.json();
        }),
        fetch('/apps-registry.json').then((response) => {
          if (!response.ok) throw new Error(`registry HTTP ${response.status}`);
          return response.json();
        })
      ])
    )
    .then(([catalogDocument, registryDocument]) => {
      catalog = Array.isArray(catalogDocument?.achievements) ? catalogDocument.achievements : [];
      registry = Array.isArray(registryDocument) ? registryDocument : [];
      return { catalog: [...catalog], currentAppId: getCurrentAppId() };
    })
    .catch((error) => {
      console.warn('[achievements] initialization failed', error);
      return { catalog: [], currentAppId: getCurrentAppId() };
    });

  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return;
    state = readState();
    notifySubscribers(null, 'storage');
  });

  window.heymingAchievements = {
    ready,
    unlock,
    unlockForCurrentApp,
    isUnlocked,
    getUnlocked,
    getCurrentAppId,
    subscribe,
    storageKey: STORAGE_KEY
  };
})();
